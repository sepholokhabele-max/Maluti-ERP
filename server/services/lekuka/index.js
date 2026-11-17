// RSL Lekuka e-invoicing (Value Added Tax (E-Invoicing) Regulations, 2026; E-Invoicing Gateway API v1.16).
//
// How it fits into S-ERP:
//   • A merchant registers this installation as a "device": the Device ID and 8-character activation key come from
//     the RSL self-service portal. S-ERP makes its own key pair, sends a certificate request and keeps the certificate.
//   • Every sale (till receipt), customer invoice, refund and cancelled invoice becomes a Lekuka document inside the
//     same database transaction: numbered (receipt counter per fiscal day, global number), hashed into the chain and
//     signed, with the QR code and verification code printed for the customer. So numbering never has gaps.
//   • A sender then submits them to Lekuka strictly in order, opening the fiscal day first and closing it at the end
//     of the day (or on request) with the counters (Z report). Without internet, documents wait and go later.
//   • Demo mode uses the practice gateway inside S-ERP; "test" uses RSL's test environment; "live" RSL production
//     (only once S-ERP is accredited by RSL – see client.model()).
const crypto = require('crypto');
const db = require('../../db');
const { bad, round2 } = require('../../util');
const P = require('./pki');
const S = require('./sign');
const client = require('./client');

const KEY = 'lekuka';
const r2 = n => round2(Number(n) || 0);
const DEFAULTS = { enabled: false, mode: 'demo', zero_rated_as: 'vat0', auto_close_time: '23:50', include_invoices: true, include_pos: true };

let cache = null;
async function settings() { if (!cache) cache = { ...DEFAULTS, ...((await db.getSetting(KEY, {})) || {}) }; return cache; }
async function save(patch) { const s = { ...(await settings()), ...patch }; await db.setSetting(KEY, s); cache = s; return s; }
const publicSettings = s => { const { private_key, ...rest } = s; return { ...rest, has_key: !!private_key }; };

/** this installation's device serial number (max 20 characters): SERP + 16 characters of the install ID */
async function serialNo() { const a = await require('../activation').get(); return `SERP${String(a.install_id || '').replace(/-/g, '').slice(0, 16)}`.slice(0, 20); }

/* ============================== registration ============================== */
function checkInput(b) {
  const mode = ['demo', 'test', 'live'].includes(b.mode) ? b.mode : 'demo';
  const id = Number(b.device_id); if (!(id > 0 && id < 1e10)) throw bad('Enter the Device ID that RSL gave you');
  const key = String(b.activation_key || '').trim(); if (!/^[A-Za-z0-9]{8}$/.test(key)) throw bad('The activation key has 8 letters and numbers');
  return { mode, id, key };
}
const asBad = e => { if (e.status === 0 || e.status >= 500 || !e.status) return Object.assign(new Error(e.message), { status: 502 }); return bad(`${e.message}${e.errorCode ? ` (${e.errorCode})` : ''}`); };
/** step 1: which taxpayer does this device belong to? */
async function verifyTaxpayer(b) {
  const { mode, id, key } = checkInput(b);
  try { return await client.call({ mode }, 'VerifyTaxpayerInformation', id, { activationKey: key, deviceSerialNo: await serialNo() }); } catch (e) { throw asBad(e); }
}
/** step 2: register the device – new key pair, certificate request, certificate – then load the configuration */
async function register(user, b) {
  const { mode, id, key } = checkInput(b);
  const cur = await settings();
  if (cur.enabled && cur.device_id && (await db.one(`SELECT COUNT(*) n FROM lekuka_receipts WHERE device_id = ? AND status IN ('queued','failed')`, [cur.device_id])).n > 0)
    throw bad('Some documents of the current device are not yet sent to Lekuka – send them before registering another device');
  const serial = await serialNo();
  const private_key = P.newKey();
  const certificateRequest = P.csr(private_key, { C: 'LS', O: 'Revenue Services Lesotho', ST: 'Lesotho', CN: P.deviceCN(serial, id) });
  let out; try { out = await client.call({ mode }, 'RegisterDevice', id, { activationKey: key, certificateRequest }); } catch (e) { throw asBad(e); }
  const info = P.certInfo(out.certificate);
  await save({ mode, device_id: id, serial_no: serial, private_key, certificate: out.certificate, cert_valid_till: info.valid_to, registered_at: new Date().toISOString(), registered_by: user.id, enabled: true, last_error: null });
  await refreshConfig();
  await db.query(`INSERT INTO audit_log (user_id, action, entity, details) VALUES (?, 'lekuka.register', 'lekuka', ?)`, [user.id, JSON.stringify({ mode, device_id: id, serial })]);
  return status();
}
async function refreshConfig() {
  const s = await settings();
  const cfg = await client.call(s, 'GetConfig', s.device_id, {});
  await save({ config: cfg, config_at: new Date().toISOString(), cert_valid_till: cfg.certificateValidTill || s.cert_valid_till });
  return cfg;
}
async function saveOptions(b) {
  const p = {};
  if (b.zero_rated_as !== undefined) p.zero_rated_as = b.zero_rated_as === 'exempt' ? 'exempt' : 'vat0';
  if (b.auto_close_time !== undefined) { if (b.auto_close_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.auto_close_time)) throw bad('Closing time looks like 23:50'); p.auto_close_time = b.auto_close_time || null; }
  for (const k of ['include_invoices', 'include_pos']) if (b[k] !== undefined) p[k] = !!b[k];
  if (b.simulate_offline !== undefined) { if ((await settings()).mode !== 'demo') throw bad('Practice offline only exists in demo mode'); p.simulate_offline = !!b.simulate_offline; }
  if (b.enabled !== undefined) { if (b.enabled && !(await settings()).certificate) throw bad('Register the device first'); p.enabled = !!b.enabled; }
  return publicSettings(await save(p));
}

/* ============================== building documents ============================== */
const MONEY = { cash: 'Cash', card: 'Card', mobile_money: 'MobileWallet', account: 'Credit', other: 'Other' };
const moneyType = m => /voucher|coupon|gift/i.test(m.name || '') ? 'Coupon' : /bank|eft|transfer/i.test(m.name || '') ? 'BankTransfer' : MONEY[m.kind] || 'Other';
/** the Lekuka tax for an S-ERP VAT rate */
function taxFor(s, rate, date) {
  const cfg = s.config || {}; const d = String(date).slice(0, 10);
  const taxes = (cfg.applicableTaxes || []).filter(t => String(t.taxValidFrom).slice(0, 10) <= d && (!t.taxValidTill || String(t.taxValidTill).slice(0, 10) >= d));
  const r = Number(rate) || 0;
  let t;
  if (!cfg.vatNumber) t = taxes.find(x => x.taxType === 'NonVAT');
  else if (r === 0 && s.zero_rated_as === 'exempt') t = taxes.find(x => x.taxType === 'Exempt');
  else t = taxes.find(x => x.taxType === 'VAT' && Math.abs(Number(x.taxRate) - r) < 0.001);
  if (!t) throw bad(`There is no Lekuka tax for ${cfg.vatNumber ? `VAT ${r}%` : 'a non-VAT taxpayer'} – correct the item's VAT rate, or refresh the Lekuka configuration (Tax centre → Lekuka)`);
  return t;
}
/** receipt lines → Lekuka lines, taxes (rounded per receipt, prices include tax) */
function buildBody(s, lines, date, sign) {
  const out = []; let no = 0;
  for (const l of lines) {
    const total = r2(l.total) * sign, qty = Math.abs(Number(l.qty)) || 1;
    if (!total) continue;
    const t = taxFor(s, l.rate, date);
    out.push({ receiptLineType: 'Sale', receiptLineSubType: l.service ? 'Service' : 'Product', receiptLineNo: ++no, receiptLineName: String(l.name || 'Item').slice(0, 200),
      receiptLinePrice: Number((total / qty).toFixed(6)), receiptLineQuantity: Number(qty.toFixed(6)), receiptLineTotal: total, ...(t.taxType === 'Exempt' ? {} : { taxRate: Number(t.taxRate) }), taxID: t.taxID, _t: t });
  }
  // a price × quantity that does not give the total exactly (repeating decimals) is sent as one unit at the line total
  for (const l of out) if (r2(l.receiptLinePrice * l.receiptLineQuantity) !== l.receiptLineTotal) { l.receiptLineName = `${l.receiptLineName} ×${l.receiptLineQuantity}`.slice(0, 200); l.receiptLineQuantity = 1; l.receiptLinePrice = l.receiptLineTotal; }
  const taxes = [];
  for (const l of out) {
    let g = taxes.find(x => x.taxID === l.taxID);
    if (!g) taxes.push(g = { taxID: l.taxID, taxType: l._t.taxType, ...(l._t.taxType === 'Exempt' ? {} : { taxRate: Number(l._t.taxRate) }), salesAmountWithTax: 0, taxAmount: 0 });
    g.salesAmountWithTax = r2(g.salesAmountWithTax + l.receiptLineTotal);
  }
  for (const g of taxes) g.taxAmount = g.taxType === 'Exempt' ? 0 : r2(g.salesAmountWithTax / (100 + Number(g.taxRate || 0)) * Number(g.taxRate || 0));
  out.forEach(l => delete l._t);
  return { receiptLines: out, receiptTaxes: taxes, receiptTotal: r2(out.reduce((a, l) => a + l.receiptLineTotal, 0)) };
}
/** share the document total over the ways it was paid (exact to the cent, change already deducted) */
function payments(pays, total) {
  const gross = r2(pays.reduce((a, p) => a + Math.abs(Number(p.amount)), 0));
  if (!pays.length || !gross) return [{ moneyTypeCode: 'Credit', paymentAmount: total }];
  const out = new Map(); let given = 0;
  pays.forEach((p, i) => { const v = i === pays.length - 1 ? r2(total - given) : r2(total * Math.abs(Number(p.amount)) / gross); given = r2(given + v); out.set(p.type, r2((out.get(p.type) || 0) + v)); });
  return [...out].map(([moneyTypeCode, paymentAmount]) => ({ moneyTypeCode, paymentAmount }));
}
const buyerOf = p => p && p.tax_number && String(p.tax_number).replace(/\D/g, '').length >= 6
  ? { buyerRegisterName: String(p.name).slice(0, 250), buyerTIN: String(p.tax_number).replace(/\D/g, '').slice(0, 11), ...(p.phone || p.email ? { buyerContacts: { ...(p.phone ? { phoneNo: String(p.phone).slice(0, 20) } : {}), ...(p.email ? { email: String(p.email).slice(0, 100) } : {}) } } : {}) } : null;

/** what an S-ERP document looks like to Lekuka: { type, number, lines, pays, buyer, note, original } */
async function docSource(c, kind, id) {
  if (kind === 'pos_order' || kind === 'pos_refund') {
    const o = await c.one('SELECT o.*, p.name partner_name, p.tax_number, p.phone, p.email FROM orders o LEFT JOIN partners p ON p.id = o.partner_id WHERE o.id = ?', [id]);
    const lines = (await c.query(`SELECT l.name, l.qty, l.line_total total, l.tax_rate rate, (pr.type = 'service') service FROM order_lines l LEFT JOIN products pr ON pr.id = l.product_id WHERE l.order_id = ? AND l.vas_transaction_id IS NULL`, [id]));
    const pays = (await c.query(`SELECT p.amount, m.kind, m.name FROM payments p JOIN payment_methods m ON m.id = p.method_id WHERE p.order_id = ? AND p.status = 'completed'`, [id])).map(p => ({ amount: p.amount, type: moneyType(p) }));
    const partner = o.partner_id ? { name: o.partner_name, tax_number: o.tax_number, phone: o.phone, email: o.email } : null;
    if (kind === 'pos_order') return { type: 'Receipt', number: o.number, lines, pays, buyer: buyerOf(partner) };
    return { type: 'CreditNote', number: o.number, lines, pays, note: String(o.notes || 'Refund').slice(0, 500), original: ['pos_order', o.refund_of] };
  }
  if (kind === 'invoice' || kind === 'invoice_cancel') {
    const i = await c.one('SELECT i.*, p.name partner_name, p.tax_number, p.phone, p.email FROM invoices i JOIN partners p ON p.id = i.partner_id WHERE i.id = ?', [id]);
    const lines = await c.query(`SELECT l.description name, l.qty, l.line_total total, l.tax_rate rate, (pr.type = 'service') service FROM invoice_lines l LEFT JOIN products pr ON pr.id = l.product_id WHERE l.invoice_id = ?`, [id]);
    const buyer = buyerOf({ name: i.partner_name, tax_number: i.tax_number, phone: i.phone, email: i.email });
    if (kind === 'invoice') return { type: buyer ? 'FiscalInvoice' : 'Receipt', number: i.number, lines, pays: [], buyer };
    return { type: 'CreditNote', number: `${i.number}-C`, lines, pays: [], note: 'Invoice cancelled', original: ['invoice', id] };
  }
  throw bad('Unknown document');
}

/* ============================== issuing (inside the sale's transaction) ============================== */
function addCounters(counters, rc) {
  const type = rc.receiptType === 'CreditNote' ? 'CreditNote' : rc.receiptType === 'DebitNote' ? 'DebitNote' : rc.receiptType === 'Payout' ? 'Payout' : 'Sale';
  const add = (t, key, extra, v) => { if (!r2(v)) return; const k = `${t}|LSL|${key}`; const x = counters[k] || (counters[k] = { fiscalCounterType: t, fiscalCounterCurrency: 'LSL', ...extra, fiscalCounterValue: 0 }); x.fiscalCounterValue = r2(x.fiscalCounterValue + Number(v)); };
  for (const t of rc.receiptTaxes) {
    const extra = { fiscalCounterTaxID: t.taxID, ...(t.taxType === 'Exempt' ? {} : { fiscalCounterTaxRate: t.taxRate }) };
    add(`${type}ByTax`, t.taxID, extra, t.salesAmountWithTax);
    if (t.taxType !== 'Exempt') add(`${type}TaxByTax`, t.taxID, extra, t.taxAmount);
  }
  for (const p of rc.receiptPayments) add('BalanceByMoneyType', p.moneyTypeCode, { fiscalCounterMoneyType: p.moneyTypeCode }, p.paymentAmount);
  return counters;
}
const later = (a, b) => (a && b && b <= a) ? S.localTime(new Date(new Date(a + '+02:00').getTime() + 1000)) : b;
/**
 * issue the Lekuka document for an S-ERP document. Call inside the transaction that finalises the sale / invoice.
 * Returns null when e-invoicing is off or there is nothing taxable (e.g. only airtime), else the printed details.
 */
async function issue(c, kind, docId) {
  const s = await settings();
  if (!s.enabled || !s.certificate) return null;
  if (['pos_order', 'pos_refund'].includes(kind) && s.include_pos === false) return null;
  if (['invoice', 'invoice_cancel'].includes(kind) && s.include_invoices === false) return null;
  if (await c.one('SELECT id FROM lekuka_receipts WHERE doc_kind = ? AND doc_id = ?', [kind, docId])) return fiscalFor(kind, docId, c);
  const src = await docSource(c, kind, docId);
  const sign = src.type === 'CreditNote' ? -1 : 1;
  const st = await c.one('SELECT * FROM lekuka_state WHERE id = 1 FOR UPDATE');
  const date = later(st.last_receipt_date, S.localTime());
  const body = buildBody(s, src.lines.map(l => ({ ...l, total: Math.abs(Number(l.total)) })), date, sign);
  if (!body.receiptLines.length) return null;
  // the fiscal day: the open one, or a new one (also when the previous is being closed)
  let day = await c.one(`SELECT * FROM lekuka_days WHERE device_id = ? AND status IN ('open','close_failed') ORDER BY day_no DESC LIMIT 1 FOR UPDATE`, [s.device_id]);
  if (!day) {
    const no = st.last_day_no + 1;
    const id = (await c.query('INSERT INTO lekuka_days (device_id, day_no, opened_at, counters) VALUES (?, ?, ?, ?)', [s.device_id, no, date, '{}'])).insertId;
    await c.query('UPDATE lekuka_state SET last_day_no = ? WHERE id = 1', [no]);
    day = await c.one('SELECT * FROM lekuka_days WHERE id = ?', [id]);
  }
  let original = null;
  if (src.original) {
    const o = await c.one('SELECT * FROM lekuka_receipts WHERE doc_kind = ? AND doc_id = ?', src.original);
    if (o) original = o.receipt_id ? { receiptID: o.receipt_id } : { deviceID: o.device_id, receiptGlobalNo: o.global_no, fiscalDayNo: o.day_no };
    else if (src.type === 'CreditNote') return null; // the original sale was made before e-invoicing was switched on
  }
  const rc = {
    receiptType: src.type, receiptCurrency: 'LSL', receiptCounter: day.receipt_counter + 1, receiptGlobalNo: st.global_no + 1,
    invoiceNo: String(src.number || `${kind}-${docId}`).slice(0, 50), ...(src.buyer ? { buyerData: src.buyer } : {}), ...(src.note ? { receiptNotes: src.note } : {}),
    receiptDate: date, ...(original ? { creditDebitNote: original } : {}), receiptLinesTaxInclusive: true, taxRoundingType: 'PerReceipt',
    receiptLines: body.receiptLines, receiptTaxes: body.receiptTaxes, receiptPayments: payments(src.pays, body.receiptTotal), receiptTotal: body.receiptTotal,
    receiptPrintForm: kind.startsWith('invoice') ? 'InvoiceA4' : 'Receipt48'
  };
  rc.receiptDeviceSignature = S.signString(S.receiptString(s.device_id, rc, rc.receiptCounter === 1 ? null : day.last_hash), s.private_key);
  const qr = S.qrUrl((s.config || {}).qrUrl || 'https://invoice.rsl.org.ls/', s.device_id, date, rc.receiptGlobalNo, rc.receiptDeviceSignature.signature);
  await c.query(`INSERT INTO lekuka_receipts (device_id, day_id, day_no, receipt_counter, global_no, doc_kind, doc_id, doc_number, receipt_type, total, receipt, hash, qr_url, verification_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [s.device_id, day.id, day.day_no, rc.receiptCounter, rc.receiptGlobalNo, kind, docId, rc.invoiceNo, rc.receiptType, rc.receiptTotal, JSON.stringify(rc), rc.receiptDeviceSignature.hash, qr, S.verificationCode(rc.receiptDeviceSignature.signature)]);
  const counters = addCounters(typeof day.counters === 'string' ? JSON.parse(day.counters || '{}') : (day.counters || {}), rc);
  await c.query('UPDATE lekuka_days SET receipt_counter = ?, last_hash = ?, counters = ? WHERE id = ?', [rc.receiptCounter, rc.receiptDeviceSignature.hash, JSON.stringify(counters), day.id]);
  await c.query('UPDATE lekuka_state SET global_no = ?, last_receipt_date = ? WHERE id = 1', [rc.receiptGlobalNo, date]);
  setImmediate(() => pump().catch(() => {}));
  return fiscalFor(kind, docId, c);
}
/** what is printed on the receipt / invoice */
async function fiscalFor(kind, docId, c = db) {
  const r = await c.one('SELECT * FROM lekuka_receipts WHERE doc_kind = ? AND doc_id = ?', [kind, docId]); if (!r) return null;
  const s = await settings(); const cfg = s.config || {};
  return { mode: s.mode, device_id: r.device_id, serial_no: s.serial_no, day_no: r.day_no, receipt_counter: r.receipt_counter, global_no: r.global_no, invoice_no: r.doc_number, receipt_type: r.receipt_type,
    receipt_date: (typeof r.receipt === 'string' ? JSON.parse(r.receipt) : r.receipt).receiptDate, qr_url: r.qr_url, verification_code: r.verification_code, status: r.status, color: r.color,
    taxpayer: { name: cfg.taxPayerName, tin: cfg.taxPayerTIN, vat: cfg.vatNumber || null, branch: cfg.deviceBranchName }, qr_svg: await require('qrcode').toString(r.qr_url, { type: 'svg', margin: 0 }) };
}

/* ============================== sending ============================== */
let running = null;
const asJson = v => typeof v === 'string' ? JSON.parse(v || 'null') : v;
/** send what is waiting, in order: open day → receipts → close day; also ping, certificate renewal, automatic close */
function pump() { if (!running) running = doPump().finally(() => { running = null; }); return running; }
async function doPump() {
  if (!db.isConnected()) return;
  let s = await settings(); if (!s.enabled || !s.certificate) return;
  const note = async (patch) => { s = await save(patch); };
  try {
    if (s.config && s.config.deviceOperatingMode === 'Offline') return await pumpOffline(s);
    const days = await db.query(`SELECT * FROM lekuka_days WHERE device_id = ? AND status <> 'closed' ORDER BY day_no`, [s.device_id]);
    for (const day of days) {
      if (!day.open_sent) {
        if (!s.config_at || Date.now() - new Date(s.config_at).getTime() > 6 * 3600e3) { await refreshConfig(); s = await settings(); }
        try { await client.call(s, 'OpenDay', s.device_id, { fiscalDayOpened: day.opened_at, fiscalDayNo: day.day_no }); }
        catch (e) {
          if (e.errorCode !== 'FISC01') throw e;
          const st = await client.call(s, 'GetStatus', s.device_id, {}); // opened already (an earlier answer was lost)?
          if (!(st.lastFiscalDayNo === day.day_no && st.fiscalDayStatus !== 'FiscalDayClosed')) throw e;
        }
        await db.query('UPDATE lekuka_days SET open_sent = 1, error = NULL WHERE id = ?', [day.id]);
      }
      const queue = await db.query(`SELECT * FROM lekuka_receipts WHERE day_id = ? AND status IN ('queued','failed') ORDER BY receipt_counter`, [day.id]);
      for (const r of queue) {
        try {
          const out = await client.call(s, 'SubmitReceipt', s.device_id, { receipt: asJson(r.receipt) });
          const ve = out.validationErrors || [];
          const color = ve.some(v => v.validationErrorColor === 'Red') ? 'Red' : ve.some(v => v.validationErrorColor === 'Grey') ? 'Grey' : ve.length ? 'Yellow' : 'Valid';
          await db.query(`UPDATE lekuka_receipts SET status = 'sent', receipt_id = ?, server_date = ?, server_signature = ?, color = ?, validation_errors = ?, attempts = attempts + 1, last_error = NULL, sent_at = NOW() WHERE id = ?`,
            [out.receiptID, out.serverDate || null, JSON.stringify(out.receiptServerSignature || null), color, ve.length ? JSON.stringify(ve) : null, r.id]);
          // a credit note that waited for its original's receipt ID keeps the global number it was given – nothing to redo
        } catch (e) {
          await db.query(`UPDATE lekuka_receipts SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ?`, [String(e.message).slice(0, 255), r.id]);
          throw e; // strictly in order: stop here and try again later
        }
      }
      if (day.status === 'open' && shouldAutoClose(s, day)) { await db.query(`UPDATE lekuka_days SET status = 'closing', close_requested_at = NOW() WHERE id = ? AND status = 'open'`, [day.id]); day.status = 'closing'; }
      if (['closing', 'close_failed'].includes(day.status)) { await closeOnline(s, day); }
      // the next day can only be opened once this one is closed at Lekuka
      if ((await db.one('SELECT status FROM lekuka_days WHERE id = ?', [day.id])).status !== 'closed' && day !== days[days.length - 1]) break;
    }
    await housekeeping(s);
    if (s.last_error) await note({ last_error: null, last_error_at: null });
  } catch (e) {
    await note({ last_error: String(e.message).slice(0, 255), last_error_at: new Date().toISOString(), ...(e.offline ? { offline_since: s.offline_since || new Date().toISOString() } : {}) });
    return;
  }
  if (s.offline_since) await note({ offline_since: null });
}
function shouldAutoClose(s, day) {
  const now = S.localTime(), opened = day.opened_at;
  const maxH = Number((s.config || {}).taxPayerDayMaxHrs || 24), warnH = Number((s.config || {}).taxpayerDayEndNotificationHrs || 2);
  const age = (new Date(now + '+02:00') - new Date(opened + '+02:00')) / 3600e3;
  if (age >= Math.max(1, maxH - Math.min(warnH, 1))) return true; // never let a day run past its maximum length
  if (s.auto_close_time && now.slice(11, 16) >= s.auto_close_time && opened.slice(11, 16) < s.auto_close_time && opened.slice(0, 10) === now.slice(0, 10)) return true;
  if (s.auto_close_time && now.slice(0, 10) > opened.slice(0, 10) && opened.slice(11, 16) < s.auto_close_time) return true; // the closing time passed overnight
  return false;
}
function closeBody(s, day) {
  const counters = S.sortCounters(Object.values(asJson(day.counters) || {})).map(c => ({ ...c, fiscalCounterValue: r2(c.fiscalCounterValue) }));
  const sig = S.signString(S.dayString(s.device_id, day.day_no, String(day.opened_at).slice(0, 10), counters), s.private_key);
  return { fiscalDayNo: day.day_no, fiscalDayCounters: counters, fiscalDayDeviceSignature: sig, receiptCounter: day.receipt_counter };
}
async function closeOnline(s, day) {
  const pending = (await db.one(`SELECT COUNT(*) n FROM lekuka_receipts WHERE day_id = ? AND status <> 'sent'`, [day.id])).n;
  if (pending) return;
  if (!day.close_sent || day.status === 'close_failed') {
    try { await client.call(s, 'CloseDay', s.device_id, closeBody(s, day)); }
    catch (e) { if (e.errorCode !== 'FISC03') { await db.query(`UPDATE lekuka_days SET status = 'close_failed', error = ? WHERE id = ?`, [String(e.message).slice(0, 255), day.id]); throw e; } }
    await db.query(`UPDATE lekuka_days SET close_sent = 1, status = 'closing', error = NULL WHERE id = ?`, [day.id]);
  }
  // closing is checked by Lekuka in the background: ask how it went
  for (let i = 0; i < 5; i++) {
    const st = await client.call(s, 'GetStatus', s.device_id, {});
    if (st.lastFiscalDayNo !== day.day_no) break;
    if (st.fiscalDayStatus === 'FiscalDayClosed') {
      await db.query(`UPDATE lekuka_days SET status = 'closed', closed_at = ?, server_signature = ?, reconciliation = ?, error = NULL WHERE id = ?`, [st.fiscalDayClosed || S.localTime(), JSON.stringify(st.fiscalDayServerSignature || null), st.fiscalDayReconciliationMode || 'Auto', day.id]);
      return;
    }
    if (st.fiscalDayStatus === 'FiscalDayCloseFailed') { await db.query(`UPDATE lekuka_days SET status = 'close_failed', close_sent = 0, error = ? WHERE id = ?`, [`Lekuka could not close the day: ${st.fiscalDayClosingErrorCode || 'unknown reason'}`, day.id]); return; }
    await new Promise(r => setTimeout(r, s.mode === 'demo' ? 50 : 2000));
  }
}
/** offline devices: each closed day goes as one file (header, receipts, Z report) */
async function pumpOffline(s) {
  const days = await db.query(`SELECT * FROM lekuka_days WHERE device_id = ? AND status <> 'closed' ORDER BY day_no`, [s.device_id]);
  for (const day of days) {
    if (day.status === 'open' && shouldAutoClose(s, day)) { await db.query(`UPDATE lekuka_days SET status = 'closing', close_requested_at = NOW() WHERE id = ?`, [day.id]); day.status = 'closing'; }
    if (day.status === 'open') continue;
    const file = await db.one(`SELECT * FROM lekuka_files WHERE device_id = ? AND day_no = ? ORDER BY id DESC LIMIT 1`, [s.device_id, day.day_no]);
    if (!file || file.status === 'FileProcessingWithErrors' && day.status === 'close_failed') {
      const f = await offlineFile(day.id, file ? file.file_sequence + 1 : 1);
      const out = await client.call(s, 'SubmitFile', s.device_id, { file: Buffer.from(JSON.stringify(f)).toString('base64'), fileName: `${s.device_id}-${day.day_no}.json` });
      await db.query(`INSERT INTO lekuka_files (device_id, day_no, file_sequence, operation_id, status, receipts, has_footer) VALUES (?, ?, ?, ?, 'FileProcessingInProgress', ?, 1)`, [s.device_id, day.day_no, f.header.fileSequence, out.operationID, f.content.receipts.length]);
      await db.query(`UPDATE lekuka_receipts SET status = 'in_file' WHERE day_id = ?`, [day.id]);
    }
    const f2 = await db.one(`SELECT * FROM lekuka_files WHERE device_id = ? AND day_no = ? ORDER BY id DESC LIMIT 1`, [s.device_id, day.day_no]);
    const today = S.localTime().slice(0, 10), from = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    const st = await client.call(s, 'SubmittedFileList', s.device_id, { operationID: f2.operation_id, fileUploadedFrom: from, fileUploadedTill: today });
    const fs1 = (st.fileStatus || []).find(x => String(x.operationID) === String(f2.operation_id));
    if (!fs1) continue;
    await db.query('UPDATE lekuka_files SET status = ?, errors = ? WHERE id = ?', [fs1.fileProcessingStatus, JSON.stringify({ codes: fs1.fileProcessingErrorCode || [], invoices: fs1.invoicesWithValidationErrors || [] }), f2.id]);
    for (const inv of fs1.invoicesWithValidationErrors || []) {
      const ve = inv.validationErrors || [];
      await db.query(`UPDATE lekuka_receipts SET color = ?, validation_errors = ? WHERE day_id = ? AND receipt_counter = ?`, [ve.some(v => v.validationErrorColor === 'Red') ? 'Red' : 'Yellow', JSON.stringify(ve), day.id, inv.receiptCounter]);
    }
    if (fs1.fileProcessingStatus === 'FileProcessingIsSuccessful') {
      await db.query(`UPDATE lekuka_receipts SET status = 'sent', color = COALESCE(color, 'Valid'), sent_at = NOW() WHERE day_id = ?`, [day.id]);
      await db.query(`UPDATE lekuka_days SET status = 'closed', closed_at = ?, error = NULL WHERE id = ?`, [S.localTime(), day.id]);
    } else if (fs1.fileProcessingStatus === 'FileProcessingWithErrors') await db.query(`UPDATE lekuka_days SET status = 'close_failed', error = ? WHERE id = ?`, [`File not accepted: ${(fs1.fileProcessingErrorCode || []).join(', ')}`, day.id]);
  }
}
/** the file for a fiscal day (also for manual upload to the Lekuka self-service portal) */
async function offlineFile(dayId, sequence = 1) {
  const s = await settings(); const day = await db.one('SELECT * FROM lekuka_days WHERE id = ?', [dayId]); if (!day) throw bad('Fiscal day not found');
  const receipts = (await db.query('SELECT receipt FROM lekuka_receipts WHERE day_id = ? ORDER BY receipt_counter', [dayId])).map(r => asJson(r.receipt));
  const body = closeBody(s, day);
  return { header: { deviceID: s.device_id, fiscalDayNo: day.day_no, fiscalDayOpened: day.opened_at, fileSequence: sequence }, content: { receipts },
    ...(day.status !== 'open' ? { footer: { fiscalDayCounters: body.fiscalDayCounters, fiscalDayDeviceSignature: body.fiscalDayDeviceSignature, receiptCounter: body.receiptCounter, fiscalDayClosed: day.closed_at || S.localTime() } } : {}) };
}
async function housekeeping(s) {
  const now = Date.now();
  if (!s.last_ping || now - new Date(s.last_ping).getTime() > (s.ping_minutes || 5) * 60e3) {
    const p = await client.call(s, 'Ping', s.device_id, {}); await save({ last_ping: new Date().toISOString(), ping_minutes: p.reportingFrequency || 5 });
  }
  // renew the certificate a month before it ends
  if (s.cert_valid_till && new Date(s.cert_valid_till) - now < 30 * 864e5) await renewCertificate();
}
async function renewCertificate() {
  const s = await settings();
  const private_key = P.newKey();
  const out = await client.call(s, 'IssueCertificate', s.device_id, { certificateRequest: P.csr(private_key, { C: 'LS', O: 'Revenue Services Lesotho', ST: 'Lesotho', CN: P.deviceCN(s.serial_no, s.device_id) }), twoStepsProcess: false });
  await save({ private_key, certificate: out.certificate, cert_valid_till: P.certInfo(out.certificate).valid_to, cert_renewed_at: new Date().toISOString() });
  return P.certInfo(out.certificate).valid_to;
}

/* ============================== screens ============================== */
async function closeDayNow() {
  const s = await settings(); if (!s.enabled) throw bad('E-invoicing is not switched on');
  const d = await db.one(`SELECT * FROM lekuka_days WHERE device_id = ? AND status IN ('open','close_failed') ORDER BY day_no DESC LIMIT 1`, [s.device_id]);
  if (!d) throw bad('There is no open fiscal day');
  await db.query(`UPDATE lekuka_days SET status = 'closing', close_requested_at = NOW() WHERE id = ?`, [d.id]);
  await pump();
  return db.one('SELECT id, day_no, status, error, closed_at FROM lekuka_days WHERE id = ?', [d.id]);
}
async function status() {
  const s = await settings();
  const counts = await db.query(`SELECT status, color, COUNT(*) n FROM lekuka_receipts ${s.device_id ? 'WHERE device_id = ?' : ''} GROUP BY status, color`, s.device_id ? [s.device_id] : []);
  const day = s.device_id ? await db.one(`SELECT id, day_no, opened_at, status, receipt_counter, error, open_sent FROM lekuka_days WHERE device_id = ? ORDER BY day_no DESC LIMIT 1`, [s.device_id]) : null;
  const m = client.model(); const cfg = s.config || {};
  const queued = counts.filter(c => ['queued', 'failed'].includes(c.status)).reduce((a, c) => a + Number(c.n), 0);
  const hours = day && day.status !== 'closed' ? Math.round((new Date(S.localTime() + '+02:00') - new Date(day.opened_at + '+02:00')) / 360e3) / 10 : null;
  return { settings: publicSettings(s), serial_no: s.serial_no || await serialNo(), model: m, day, day_hours: hours, day_warning: hours !== null && hours >= Number(cfg.taxPayerDayMaxHrs || 24) - Number(cfg.taxpayerDayEndNotificationHrs || 2),
    queued, red: counts.filter(c => c.color === 'Red').reduce((a, c) => a + Number(c.n), 0), yellow: counts.filter(c => c.color === 'Yellow').reduce((a, c) => a + Number(c.n), 0),
    sent: counts.filter(c => c.status === 'sent').reduce((a, c) => a + Number(c.n), 0), taxes: cfg.applicableTaxes || [], urls: client.URLS };
}
const receipts = (q = {}) => db.query(`SELECT id, day_no, receipt_counter, global_no, doc_kind, doc_id, doc_number, receipt_type, total, status, color, validation_errors, last_error, attempts, qr_url, verification_code, created_at, sent_at, receipt_id
  FROM lekuka_receipts ${q.problems ? `WHERE status IN ('queued','failed') OR color IN ('Red','Grey','Yellow')` : ''} ORDER BY id DESC LIMIT ${Math.min(Number(q.limit) || 200, 1000)}`);
const days = () => db.query('SELECT id, device_id, day_no, opened_at, status, receipt_counter, closed_at, reconciliation, error FROM lekuka_days ORDER BY id DESC LIMIT 120');
async function verifyTin(tin) {
  const s = await settings(); if (!s.enabled) throw bad('Register with Lekuka first');
  try { return await client.call(s, 'VerifyByTin', s.device_id, { tin: String(tin || '').replace(/\D/g, '') }); } catch (e) { throw asBad(e); }
}

/** background sending every minute */
function startScheduler() { setInterval(() => pump().catch(() => {}), 60000).unref(); }
const _reset = () => { cache = null; };

module.exports = { settings, save, saveOptions, serialNo, verifyTaxpayer, register, refreshConfig, issue, fiscalFor, pump, closeDayNow, offlineFile, renewCertificate, status, receipts, days, verifyTin, startScheduler, buildBody, taxFor, _reset };
