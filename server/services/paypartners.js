// Payment partners: third parties (M-Pesa, EcoCash, banks, agents, shops) that collect money for this business on
// their own platforms and tell S-ERP through the collections API (routes/paypartners.js, /api/collect/v1).
//
// What a partner can pay:
//   water_bill  – a postpaid water account (oldest water bills first; anything over stays as credit on the account)
//   water_token – a prepaid water account: S-ERP sells the water (debt recovery, standing charge, sewerage) and returns the token
//   invoice     – any open customer invoice by its number
// Every payment is posted to the partner's own payment method, whose account is 1180 "Collections due from payment
// partners". When the partner pays the money over, a settlement moves it to the bank and books their commission (6420).
// Each payment carries the partner's own transaction reference; the same reference never posts twice (idempotent).
const crypto = require('crypto');
const db = require('../db');
const accounting = require('./accounting');
const receipts = require('./receipts');
const { round2, bad, notFound, today } = require('../util');

const KINDS = ['mobile_money', 'bank', 'agent', 'retail', 'other'];
const SCOPES = ['water_bill', 'water_token', 'invoice'];
const REF = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;
const hash = k => crypto.createHash('sha256').update(String(k)).digest('hex');

class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const E = (status, code, message) => new ApiError(status, code, message);

/* ---------------- keys ---------------- */
function newKey(mode) {
  const key = `sk_${mode}_${crypto.randomBytes(24).toString('hex')}`;
  return { key, prefix: key.slice(0, 16), hash: hash(key) };
}
async function byKey(key) {
  if (!/^sk_(test|live)_[a-f0-9]{48}$/.test(String(key || ''))) return null;
  const p = await db.one('SELECT * FROM pay_partners WHERE key_hash = ?', [hash(key)]);
  // the key's own mode must match the partner's mode, so a test key can never move real money
  return p && key.startsWith(`sk_${p.mode}_`) ? p : null;
}
function ipAllowed(p, ip) {
  const list = String(p.ip_allow || '').split(/[\s,]+/).filter(Boolean);
  if (!list.length) return true;
  const clean = String(ip || '').replace(/^::ffff:/, '');
  return list.some(x => x === clean || (x.endsWith('*') && clean.startsWith(x.slice(0, -1))));
}
const scopesOf = p => String(p.scopes || '').split(',').filter(x => SCOPES.includes(x));
async function apiUser(p) {
  const u = (p.created_by && await db.one('SELECT id, name FROM users WHERE id = ?', [p.created_by])) || await db.one(`SELECT id, name FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`);
  return { id: u.id, name: `${p.name} (API)` };
}
const mask = name => { const w = String(name || '').trim().split(/\s+/); return w.length > 1 ? `${w[0]} ${w[w.length - 1][0]}.` : (w[0] || '').slice(0, 3) + '***'; };

/* ---------------- what is this account number? ---------------- */
async function resolve(ref) {
  ref = String(ref || '').trim();
  if (!ref) return null;
  const wa = await db.one(`SELECT a.*, p.name customer_name, m.serial meter_serial, m.kind meter_kind FROM water_accounts a JOIN partners p ON p.id = a.partner_id
    LEFT JOIN water_meters m ON m.id = a.meter_id WHERE a.account_no = ? OR (m.serial = ? AND m.status = 'installed') ORDER BY a.status = 'active' DESC LIMIT 1`, [ref, ref]).catch(() => null);
  if (wa) return { kind: wa.billing === 'prepaid' ? 'water_token' : 'water_bill', water: wa, customer_id: wa.partner_id, name: wa.customer_name, account: wa.account_no };
  const inv = await db.one(`SELECT i.*, p.name customer_name FROM invoices i JOIN partners p ON p.id = i.partner_id WHERE i.number = ? AND i.kind = 'customer_invoice' AND i.status IN ('posted','partial','paid')`, [ref]);
  if (inv) return { kind: 'invoice', invoice: inv, customer_id: inv.partner_id, name: inv.customer_name, account: inv.number };
  return null;
}

/** the answer to "who is this and how much do they owe?" – what the partner shows its customer before they pay */
async function lookup(p, ref) {
  const r = await resolve(ref);
  if (!r) throw E(404, 'ACCOUNT_NOT_FOUND', 'No account, meter or invoice with that number');
  if (!scopesOf(p).includes(r.kind)) throw E(403, 'NOT_ALLOWED', 'This partner may not take this kind of payment');
  const out = { account: r.account, type: r.kind, customer: mask(r.name), currency: 'LSL', min_amount: Number(p.min_amount), max_amount: Number(p.max_amount), can_pay: true, message: null };
  if (r.kind === 'water_bill' || r.kind === 'water_token') {
    const due = await db.one(`SELECT COALESCE(SUM(total - amount_paid),0) d FROM invoices WHERE water_account_id = ? AND status IN ('posted','partial')`, [r.water.id]);
    out.amount_due = round2(due.d);
    out.status = r.water.status;
    if (r.kind === 'water_token') {
      const s = await require('./water').settings();
      out.min_amount = Math.max(out.min_amount, Number(s.min_vend)); if (Number(s.max_vend)) out.max_amount = Math.min(out.max_amount, Number(s.max_vend));
      out.meter = r.water.meter_serial;
      if (r.water.status !== 'active' || r.water.meter_kind !== 'prepaid') { out.can_pay = false; out.message = 'This connection cannot buy water right now – the customer must contact the office'; }
      else if (out.amount_due > 0) out.message = 'Part of each purchase pays the old debt on this account';
    } else if (r.water.status === 'closed') { out.can_pay = false; out.message = 'This account is closed'; }
  } else {
    out.amount_due = round2(Number(r.invoice.total) - Number(r.invoice.amount_paid));
    if (out.amount_due <= 0) { out.can_pay = false; out.message = 'This invoice is already paid'; }
  }
  return out;
}

/* ---------------- take a payment ---------------- */
const txnOut = t => ({ reference: t.reference, status: t.status, account: t.account_ref, type: t.kind, amount: Number(t.amount), created_at: t.created_at,
  ...(t.result ? (typeof t.result === 'string' ? JSON.parse(t.result) : t.result) : {}), ...(t.error ? { error: t.error } : {}) });

async function pay(p, b) {
  const reference = String(b.reference || '').trim();
  if (!REF.test(reference)) throw E(422, 'REFERENCE_INVALID', 'reference is your own unique transaction id: 1–80 letters, digits or . _ : / -');
  const amount = round2(b.amount);
  if (!(amount > 0) || Math.abs(Number(b.amount) - amount) > 0.0001) throw E(422, 'AMOUNT_INVALID', 'amount must be a positive number with at most 2 decimals');
  if (amount < Number(p.min_amount) || amount > Number(p.max_amount)) throw E(422, 'AMOUNT_OUT_OF_RANGE', `amount must be between ${Number(p.min_amount).toFixed(2)} and ${Number(p.max_amount).toFixed(2)}`);
  const accountRef = String(b.account || '').trim().slice(0, 80);

  // idempotency: the partner's reference is unique – a retry gets the first answer back
  const prev = await db.one('SELECT * FROM pay_partner_txns WHERE partner_id = ? AND reference = ?', [p.id, reference]);
  if (prev) {
    if (['completed', 'test'].includes(prev.status)) {
      if (prev.account_ref !== accountRef || Number(prev.amount) !== amount) throw E(409, 'REFERENCE_REUSED', 'This reference was already used for a different account or amount');
      return { ...txnOut(prev), duplicate: true };
    }
    if (prev.status === 'pending') throw E(409, 'IN_PROGRESS', 'This payment is still being processed – ask again with GET /payments/{reference}');
  }
  const info = await lookup(p, accountRef); // throws when unknown / not allowed
  if (!info.can_pay) throw E(422, 'CANNOT_PAY', info.message);
  if (info.type === 'water_token' && (amount < info.min_amount || amount > info.max_amount)) throw E(422, 'AMOUNT_OUT_OF_RANGE', `Water purchases must be between ${info.min_amount.toFixed(2)} and ${info.max_amount.toFixed(2)}`);
  const r = await resolve(accountRef);
  const commission = round2(amount * Number(p.commission_pct) / 100 + Number(p.commission_fixed));
  const paidAt = b.paid_at && !isNaN(Date.parse(b.paid_at)) ? new Date(b.paid_at).toISOString().slice(0, 19).replace('T', ' ') : null;
  const phone = b.payer_phone ? String(b.payer_phone).replace(/[^0-9+]/g, '').slice(0, 40) : null;
  let id;
  if (prev) { id = prev.id; await db.query(`UPDATE pay_partner_txns SET status = 'pending', error = NULL, account_ref = ?, amount = ?, commission = ? WHERE id = ?`, [accountRef, amount, commission, id]); }
  else {
    try {
      id = (await db.query(`INSERT INTO pay_partner_txns (partner_id, reference, account_ref, kind, customer_id, water_account_id, invoice_id, amount, commission, status, payer_phone, paid_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`, [p.id, reference, accountRef, r.kind, r.customer_id, r.water ? r.water.id : null, r.invoice ? r.invoice.id : null, amount, commission, phone, paidAt])).insertId;
    } catch (e) { if (e.code === 'ER_DUP_ENTRY') throw E(409, 'IN_PROGRESS', 'This payment is already being processed'); throw e; }
  }
  try {
    let result;
    if (p.mode === 'test') {
      // test mode: everything is checked, nothing is posted
      result = { receipt: `TEST-${id}`, test: true, message: 'Test mode – no money was recorded' };
      if (r.kind === 'water_token') { const q = await require('./water').quote(r.water.id, amount); result = { ...result, units_m3: q.units_m3, debt_recovered: q.debt_recovered, token: 'TEST 0000-0000-0000-0000-0000' }; }
      await db.query(`UPDATE pay_partner_txns SET status = 'test', result = ?, commission = 0 WHERE id = ?`, [JSON.stringify(result), id]);
    } else {
      const user = await apiUser(p);
      if (r.kind === 'water_token') {
        const v = await require('./water').vend(user, { account_id: r.water.id, amount, method_id: p.method_id, reference });
        result = { receipt: v.number, token: v.token, units_m3: v.units_m3, debt_recovered: v.debt_recovered, standing_charge: v.service_recovered, meter: v.meter_serial };
        await db.query(`UPDATE pay_partner_txns SET status = 'completed', result = ?, vend_id = ? WHERE id = ?`, [JSON.stringify(result), v.id, id]);
      } else {
        const where = r.kind === 'water_bill' ? ['i.water_account_id = ?', [r.water.id]] : ['i.id = ?', [r.invoice.id]];
        const x = await db.tx(c => receipts.allocate(c, { partner_id: r.customer_id, amount, method_id: p.method_id, reference, where: where[0], args: where[1], user,
          date: paidAt ? paidAt.slice(0, 10) : null, memo: `Payment through ${p.name} for ${r.account}`, source_type: 'partner_payment', source_id: id }));
        const left = await lookup({ ...p, scopes: SCOPES.join(',') }, accountRef);
        result = { receipt: `PP-${id}`, paid_invoices: x.paid.map(i => ({ invoice: i.number, amount: i.amount })), credit: x.credit_left, balance_after: left.amount_due };
        await db.query(`UPDATE pay_partner_txns SET status = 'completed', result = ? WHERE id = ?`, [JSON.stringify(result), id]);
      }
    }
    await db.query('UPDATE pay_partners SET last_used_at = NOW() WHERE id = ?', [p.id]);
    return txnOut(await db.one('SELECT * FROM pay_partner_txns WHERE id = ?', [id]));
  } catch (e) {
    await db.query(`UPDATE pay_partner_txns SET status = 'failed', error = ? WHERE id = ?`, [String(e.message).slice(0, 250), id]);
    if (e instanceof ApiError) throw e;
    throw E(e.status && e.status < 500 ? 422 : 500, 'PAYMENT_FAILED', e.status && e.status < 500 ? e.message : 'The payment could not be recorded – nothing was charged on our side. Try again with the same reference.');
  }
}
async function status(p, reference) {
  const t = await db.one('SELECT * FROM pay_partner_txns WHERE partner_id = ? AND reference = ?', [p.id, String(reference || '')]);
  if (!t) throw E(404, 'NOT_FOUND', 'No payment with that reference');
  return txnOut(t);
}
/** the partner's own list for reconciliation */
async function statement(p, from, to) {
  const d = x => /^\d{4}-\d{2}-\d{2}$/.test(x || '') ? x : null;
  from = d(from) || today(); to = d(to) || from;
  const rows = await db.query(`SELECT * FROM pay_partner_txns WHERE partner_id = ? AND created_at BETWEEN ? AND ? ORDER BY id`, [p.id, from + ' 00:00:00', to + ' 23:59:59']);
  const ok = rows.filter(t => t.status === (p.mode === 'test' ? 'test' : 'completed')); // totals: real money for a live key, test payments for a test key
  return { from, to, count: ok.length, total: round2(ok.reduce((s, t) => s + Number(t.amount), 0)), commission: round2(ok.reduce((s, t) => s + Number(t.commission), 0)),
    transactions: rows.map(t => ({ reference: t.reference, account: t.account_ref, type: t.kind, amount: Number(t.amount), commission: Number(t.commission), status: t.status, created_at: t.created_at, settled: !!t.settlement_id })) };
}

/* ---------------- back office ---------------- */
function clean(b, cur) {
  const v = {};
  if (b.name !== undefined || !cur) { v.name = String(b.name || '').trim().slice(0, 80); if (!v.name) throw bad('Name the payment partner, e.g. "M-Pesa (Vodacom Lesotho)"'); }
  if (b.kind !== undefined) v.kind = KINDS.includes(b.kind) ? b.kind : 'other';
  if (b.status !== undefined) v.status = b.status === 'suspended' ? 'suspended' : 'active';
  for (const k of ['commission_pct', 'commission_fixed', 'min_amount', 'max_amount']) if (b[k] !== undefined && b[k] !== '') v[k] = Math.max(0, Number(b[k]) || 0);
  if (v.commission_pct > 20) throw bad('Commission looks too high – it is a % of each payment');
  if (b.scopes !== undefined) { const sc = (Array.isArray(b.scopes) ? b.scopes : String(b.scopes).split(',')).filter(x => SCOPES.includes(x)); if (!sc.length) throw bad('Tick at least one kind of payment the partner may take'); v.scopes = sc.join(','); }
  if (b.ip_allow !== undefined) v.ip_allow = String(b.ip_allow || '').replace(/[^0-9a-fA-F.:*,\s]/g, '').trim().slice(0, 255) || null;
  for (const [k, n] of [['contact_name', 80], ['contact_phone', 40], ['contact_email', 120], ['notes', 255]]) if (b[k] !== undefined) v[k] = b[k] ? String(b[k]).slice(0, n) : null;
  return v;
}
async function list() {
  return db.query(`SELECT p.id, p.name, p.kind, p.mode, p.status, p.key_prefix, p.ip_allow, p.scopes, p.commission_pct, p.commission_fixed, p.min_amount, p.max_amount,
      p.contact_name, p.contact_phone, p.contact_email, p.notes, p.last_used_at, p.created_at, p.method_id, m.name method_name,
      (SELECT COUNT(*) FROM pay_partner_txns t WHERE t.partner_id = p.id AND t.status = 'completed' AND DATE(t.created_at) = CURDATE()) today_count,
      (SELECT COALESCE(SUM(t.amount),0) FROM pay_partner_txns t WHERE t.partner_id = p.id AND t.status = 'completed' AND DATE(t.created_at) = CURDATE()) today_amount,
      (SELECT COALESCE(SUM(t.amount),0) FROM pay_partner_txns t WHERE t.partner_id = p.id AND t.status = 'completed' AND t.settlement_id IS NULL) unsettled,
      (SELECT COALESCE(SUM(t.commission),0) FROM pay_partner_txns t WHERE t.partner_id = p.id AND t.status = 'completed' AND t.settlement_id IS NULL) unsettled_commission
    FROM pay_partners p LEFT JOIN payment_methods m ON m.id = p.method_id ORDER BY p.name`);
}
async function create(user, b) {
  const v = clean({ kind: 'mobile_money', ...b });
  v.mode = 'test'; v.created_by = user.id;
  const k = newKey('test'); v.key_prefix = k.prefix; v.key_hash = k.hash;
  return db.tx(async c => {
    // its own payment method: the money is owed by the partner (1180) until it settles
    const m = await c.query(`INSERT INTO payment_methods (name, kind, account_code, requires_reference, active, sort_order) VALUES (?, ?, '1180', 0, 1, 90)`,
      [`${v.name} (partner)`.slice(0, 60), v.kind === 'mobile_money' ? 'mobile_money' : 'other']);
    v.method_id = m.insertId;
    const id = (await c.query('INSERT INTO pay_partners SET ?', [v])).insertId;
    return { id, key: k.key, mode: 'test' };
  });
}
async function update(id, b) {
  const cur = await db.one('SELECT * FROM pay_partners WHERE id = ?', [id]); if (!cur) throw notFound('Payment partner');
  const v = clean(b, cur);
  if (Object.keys(v).length) await db.query('UPDATE pay_partners SET ? WHERE id = ?', [v, id]);
  if (v.name) await db.query('UPDATE payment_methods SET name = ? WHERE id = ?', [`${v.name} (partner)`.slice(0, 60), cur.method_id]);
  return { ok: true };
}
/** a new key (the old one stops working at once); mode 'live' moves real money, 'test' only checks */
async function newPartnerKey(id, mode) {
  const cur = await db.one('SELECT * FROM pay_partners WHERE id = ?', [id]); if (!cur) throw notFound('Payment partner');
  const md = mode === 'live' ? 'live' : mode === 'test' ? 'test' : cur.mode;
  const k = newKey(md);
  await db.query('UPDATE pay_partners SET mode = ?, key_prefix = ?, key_hash = ? WHERE id = ?', [md, k.prefix, k.hash, id]);
  return { key: k.key, mode: md };
}
async function txns(q) {
  const where = ['1=1'], args = [];
  if (q.partner_id) { where.push('t.partner_id = ?'); args.push(q.partner_id); }
  if (q.status) { where.push('t.status = ?'); args.push(q.status); }
  if (q.from) { where.push('t.created_at >= ?'); args.push(q.from + ' 00:00:00'); }
  if (q.to) { where.push('t.created_at <= ?'); args.push(q.to + ' 23:59:59'); }
  if (q.unsettled) where.push(`t.status = 'completed' AND t.settlement_id IS NULL`);
  return db.query(`SELECT t.*, p.name partner_name, c.name customer_name FROM pay_partner_txns t JOIN pay_partners p ON p.id = t.partner_id LEFT JOIN partners c ON c.id = t.customer_id
    WHERE ${where.join(' AND ')} ORDER BY t.id DESC LIMIT 2000`, args);
}
/** the partner paid over what it collected up to a date: bank up, commission booked, 1180 cleared */
async function settle(user, partnerId, b) {
  const upto = /^\d{4}-\d{2}-\d{2}$/.test(b.upto_date || '') ? b.upto_date : today();
  return db.tx(async c => {
    const p = await c.one('SELECT * FROM pay_partners WHERE id = ? FOR UPDATE', [partnerId]); if (!p) throw notFound('Payment partner');
    const rows = await c.query(`SELECT id, amount, commission FROM pay_partner_txns WHERE partner_id = ? AND status = 'completed' AND settlement_id IS NULL AND created_at <= ? FOR UPDATE`, [p.id, upto + ' 23:59:59']);
    if (!rows.length) throw bad('Nothing to settle up to that date');
    const collected = round2(rows.reduce((s, t) => s + Number(t.amount), 0)), expected = round2(rows.reduce((s, t) => s + Number(t.commission), 0));
    const received = b.received === undefined || b.received === '' ? round2(collected - expected) : round2(b.received);
    if (!(received > 0) || received > collected) throw bad(`The amount received must be more than 0 and at most what was collected (${collected.toFixed(2)})`);
    const m = await c.one('SELECT * FROM payment_methods WHERE id = ?', [b.method_id]);
    if (!m || m.kind === 'account' || m.account_code === '1180') throw bad('Choose the bank account (payment method) the money came into');
    const commission = round2(collected - received);
    const sid = (await c.query(`INSERT INTO pay_partner_settlements (partner_id, settle_date, upto_date, txns, collected, commission, received, account_code, reference, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.id, b.settle_date || today(), upto, rows.length, collected, commission, received, m.account_code, b.reference ? String(b.reference).slice(0, 80) : null, user.id])).insertId;
    await c.query('UPDATE pay_partner_txns SET settlement_id = ? WHERE id IN (?)', [sid, rows.map(t => t.id)]);
    await accounting.post(c, { date: b.settle_date || today(), reference: b.reference || `SETTLE-${sid}`, memo: `${p.name} settlement up to ${upto} (${rows.length} payments)`, source_type: 'partner_settlement', source_id: sid, user_id: user.id,
      lines: [{ code: m.account_code, debit: received }, ...(commission > 0 ? [{ code: '6420', debit: commission, description: `${p.name} commission` }] : []), { code: '1180', credit: collected }] });
    return { id: sid, txns: rows.length, collected, commission, expected_commission: expected, received };
  });
}

module.exports = { KINDS, SCOPES, ApiError, byKey, ipAllowed, lookup, pay, status, statement, list, create, update, newPartnerKey, txns, settle, hash };
