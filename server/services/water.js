// Water utility: connections (prepaid and postpaid), meters, block tariffs, readings, billing runs, prepaid token
// vending, deposits, field jobs (new connections, disconnections, reconnections, meter changes, leaks) and
// non-revenue water per zone. Postpaid bills are ordinary customer invoices (invoices.water_account_id), so statements,
// receipts, payment reminders, the customer portal, MyWallet portal payments, VAT and the books all work unchanged.
//
// Prepaid tokens: real STS meters need a token from an STS vending server that holds the utility's meter keys.
// S-ERP asks a "water" plugin for the token (plugins/<id>: vendToken(config, { meter, units_m3, amount, reference }));
// the built-in "sandbox" provider makes clearly marked TEST tokens for training, and "none" records credit for smart
// meters that are topped up from the meter supplier's own system.
const crypto = require('crypto');
const db = require('../db');
const accounting = require('./accounting');
const receipts = require('./receipts');
const stock = require('./stock');
const plugins = require('./plugins');
const { round2, bad, notFound, pad, today } = require('../util');

const DEFAULTS = {
  account_prefix: 'W', due_days: 21, high_use_factor: 3, estimate_months: 3,
  debt_recovery_pct: 25, min_vend: 5, max_vend: 5000, token_provider: 'sandbox', token_plugin_id: '',
  connection_fee: 0, reconnection_fee: 0, deposit_postpaid: 0, disconnect_after_days: 30, disconnect_min_amount: 100
};
const CATEGORIES = ['domestic', 'commercial', 'industrial', 'institutional', 'government', 'school', 'church', 'standpipe', 'other'];
const SEWER_TYPES = ['none', 'waterborne', 'non_waterborne'];
const JOB_KINDS = { new_connection: 'New connection', disconnection: 'Disconnection', reconnection: 'Reconnection', meter_install: 'Install meter',
  meter_replace: 'Replace meter', leak: 'Leak', burst: 'Burst pipe', complaint: 'Complaint', inspection: 'Inspection', other: 'Other' };
const r3 = n => Math.round(Number(n || 0) * 1000) / 1000;
const ym = d => String(d).slice(0, 7);
const monthEnd = p => { const [y, m] = p.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

async function settings() { return { ...DEFAULTS, ...((await db.getSetting('water', {})) || {}) }; }
async function saveSettings(p) {
  const s = await settings(), n = { ...s };
  for (const k of Object.keys(DEFAULTS)) if (p[k] !== undefined) n[k] = typeof DEFAULTS[k] === 'number' ? Math.max(0, Number(p[k]) || 0) : String(p[k] || '').slice(0, 60);
  if (!['sandbox', 'plugin', 'none'].includes(n.token_provider)) n.token_provider = 'sandbox';
  if (n.token_provider === 'plugin' && !n.token_plugin_id) throw bad('Choose the token plugin (the STS vending connector) or another token method');
  if (n.debt_recovery_pct > 100) throw bad('Debt recovery is a percentage of each purchase – at most 100');
  if (!n.account_prefix) n.account_prefix = 'W';
  await db.setSetting('water', n);
  return n;
}

/* ---------------- tariffs: stepped (block) prices per m³, counted per calendar month ---------------- */
function cleanBlocks(blocks) {
  const out = []; let last = 0;
  for (const b of (Array.isArray(blocks) ? blocks : [])) {
    const price = round2(b.price), upto = b.upto === null || b.upto === '' || b.upto === undefined ? null : r3(b.upto);
    if (!(price >= 0) || isNaN(price)) throw bad('Every block needs a price per m³');
    if (upto !== null && !(upto > last)) throw bad('Each block must end above the one before (e.g. 0–6 m³, 6–15 m³, above 15 m³)');
    out.push({ upto, price });
    if (upto === null) break;
    last = upto;
  }
  if (!out.length) throw bad('Add at least one price block');
  if (out[out.length - 1].upto !== null) out.push({ upto: null, price: out[out.length - 1].price });
  return out;
}
const blocksOf = t => (typeof t.blocks === 'string' ? JSON.parse(t.blocks) : t.blocks) || [];
/** price (excl. VAT) of m3 used, starting after `from` m3 already used this month */
function priceFor(blocks, from, m3) {
  let amt = 0, pos = from, left = m3, lo = 0;
  for (const b of blocks) {
    const hi = b.upto === null ? Infinity : b.upto;
    if (pos < hi && left > 0) { const take = Math.min(left, hi - Math.max(pos, lo)); if (take > 0) { amt += take * b.price; left -= take; pos += take; } }
    lo = hi;
  }
  return round2(amt);
}
/** m3 a net (excl. VAT) amount buys, starting after `from` m3 already bought this month */
function unitsFor(blocks, from, net) {
  let m3 = 0, pos = from, money = net, lo = 0;
  for (const b of blocks) {
    const hi = b.upto === null ? Infinity : b.upto;
    if (pos < hi && money > 0) {
      const room = hi - Math.max(pos, lo);
      if (b.price <= 0) { m3 += room === Infinity ? 0 : room; pos += room === Infinity ? 0 : room; }
      else { const can = money / b.price, take = Math.min(can, room); m3 += take; money -= take * b.price; pos += take; }
    }
    lo = hi;
  }
  return r3(m3);
}
/** share of the water used that is charged sewerage (waterborne 85%, non-waterborne 65% under the WASCO tariff) */
const sewerShare = (t, sewerType) => sewerType === 'waterborne' ? Number(t.sewer_wb_pct || 0) : sewerType === 'non_waterborne' ? Number(t.sewer_nwb_pct || 0) : 0;
/** sewerage per m³ of water used (excl. VAT) for this connection */
const sewerPerM3 = (t, sewerType) => round2(Number(t.sewer_rate || 0) * sewerShare(t, sewerType) / 100 * 10000) / 10000;
/** monthly charges (excl. VAT) for m3 used: stepped water price, standing charge (free while use stays within service_free_upto),
 *  sewerage as a % of the water charge (old style) plus per-m³ sewerage on the waterborne / non-waterborne share of the water used */
function charges(t, sewerType, billedM3, usedM3 = billedM3) {
  const water = priceFor(blocksOf(t), 0, billedM3);
  const free = t.service_free_upto === null || t.service_free_upto === undefined || t.service_free_upto === '' ? null : Number(t.service_free_upto);
  const service = free !== null && usedM3 <= free ? 0 : round2(t.service_charge);
  const sewerM3 = r3(usedM3 * sewerShare(t, sewerType) / 100);
  const sewer = round2(Number((water * Number(t.sewer_pct || 0) / 100 + sewerM3 * Number(t.sewer_rate || 0)).toFixed(6))); // 6.5 × 9.85 = 64.025 → 64.03, not 64.02
  return { water, service, sewer, sewer_m3: sewerM3 };
}
function cleanTariff(b) {
  const v = { name: String(b.name || '').trim().slice(0, 80) };
  if (!v.name) throw bad('Name the tariff, e.g. "Domestic"');
  v.category = CATEGORIES.includes(b.category) ? b.category : 'domestic';
  v.blocks = JSON.stringify(cleanBlocks(typeof b.blocks === 'string' ? JSON.parse(b.blocks) : b.blocks));
  for (const k of ['service_charge', 'sewer_pct', 'tax_rate']) v[k] = round2(Math.max(0, Number(b[k]) || 0));
  if (v.sewer_pct > 200) throw bad('Sewerage is a % of the water charge');
  v.service_free_upto = b.service_free_upto === null || b.service_free_upto === undefined || b.service_free_upto === '' ? null : r3(Math.max(0, Number(b.service_free_upto) || 0));
  v.sewer_rate = Math.round(Math.max(0, Number(b.sewer_rate) || 0) * 10000) / 10000;
  for (const k of ['sewer_wb_pct', 'sewer_nwb_pct']) { v[k] = b[k] === undefined || b[k] === '' || b[k] === null ? (k === 'sewer_wb_pct' ? 85 : 65) : round2(Math.max(0, Number(b[k]) || 0)); if (v[k] > 100) throw bad('The sewer share is a % of the water used – at most 100'); }
  v.effective_from = b.effective_from ? String(b.effective_from).slice(0, 10) : null;
  if (v.tax_rate > 30) throw bad('VAT rate looks wrong');
  v.min_m3 = r3(Math.max(0, Number(b.min_m3) || 0));
  v.notes = b.notes ? String(b.notes).slice(0, 255) : null;
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  return v;
}

/* ---------------- accounts ---------------- */
async function nextAccountNo(c) {
  const s = await settings();
  const r = await c.one('SELECT COUNT(*) n FROM water_accounts');
  let n = Number(r.n) + 1, no;
  do { no = `${s.account_prefix}${pad(n, 6)}`; n++; } while (await c.one('SELECT id FROM water_accounts WHERE account_no = ?', [no]));
  return no;
}
const ACC_SQL = `SELECT a.*, p.name customer_name, p.phone, p.email, t.name tariff_name, t.category, z.name zone_name, m.serial meter_serial, m.kind meter_kind,
    (SELECT COALESCE(SUM(i.total - i.amount_paid),0) FROM invoices i WHERE i.water_account_id = a.id AND i.status IN ('posted','partial')) arrears,
    (SELECT r.reading FROM water_readings r WHERE r.account_id = a.id ORDER BY r.reading_date DESC, r.id DESC LIMIT 1) last_reading,
    (SELECT r.reading_date FROM water_readings r WHERE r.account_id = a.id ORDER BY r.reading_date DESC, r.id DESC LIMIT 1) last_reading_date
  FROM water_accounts a JOIN partners p ON p.id = a.partner_id JOIN water_tariffs t ON t.id = a.tariff_id
  LEFT JOIN water_zones z ON z.id = a.zone_id LEFT JOIN water_meters m ON m.id = a.meter_id`;

async function account(id) {
  const a = await db.one(`${ACC_SQL} WHERE a.id = ?`, [id]);
  if (!a) throw notFound('Water account');
  a.arrears = round2(a.arrears);
  a.tariff = await db.one('SELECT * FROM water_tariffs WHERE id = ?', [a.tariff_id]); a.tariff.blocks = blocksOf(a.tariff);
  a.readings = await db.query(`SELECT r.*, m.serial meter_serial, u.name user_name FROM water_readings r LEFT JOIN water_meters m ON m.id = r.meter_id LEFT JOIN users u ON u.id = r.user_id
    WHERE r.account_id = ? ORDER BY r.reading_date DESC, r.id DESC LIMIT 24`, [id]);
  a.bills = await db.query(`SELECT b.*, i.number invoice_number, i.status invoice_status, i.total - i.amount_paid open FROM water_bills b LEFT JOIN invoices i ON i.id = b.invoice_id
    WHERE b.account_id = ? ORDER BY b.period DESC LIMIT 24`, [id]);
  a.vends = await db.query('SELECT v.*, u.name user_name FROM water_vends v LEFT JOIN users u ON u.id = v.user_id WHERE v.account_id = ? ORDER BY v.id DESC LIMIT 30', [id]);
  a.jobs = await db.query('SELECT j.*, u.name assigned_name FROM water_jobs j LEFT JOIN users u ON u.id = j.assigned_to WHERE j.account_id = ? ORDER BY j.id DESC LIMIT 30', [id]);
  a.meters = await db.query('SELECT * FROM water_meters WHERE account_id = ? ORDER BY id DESC', [id]);
  a.balance = await receipts.balance(db, a.partner_id, 'i.water_account_id = ?', [id]);
  a.month_m3 = Number((await db.one(`SELECT COALESCE(SUM(units_m3),0) m FROM water_vends WHERE account_id = ? AND status = 'completed' AND created_at >= ?`, [id, today().slice(0, 8) + '01'])).m);
  return a;
}

async function saveAccount(user, b, id = null) {
  return db.tx(async c => {
    const cur = id ? await c.one('SELECT * FROM water_accounts WHERE id = ? FOR UPDATE', [id]) : null;
    if (id && !cur) throw notFound('Water account');
    const v = {};
    let partner = Number(b.partner_id) || (cur && cur.partner_id);
    if (!partner && b.customer_name) {
      const name = String(b.customer_name).trim().slice(0, 120); if (!name) throw bad('Enter the customer name');
      partner = (await c.query('INSERT INTO partners (name, phone, email, address, is_customer, is_supplier) VALUES (?, ?, ?, ?, 1, 0)',
        [name, b.phone ? String(b.phone).slice(0, 40) : null, b.email ? String(b.email).slice(0, 120) : null, b.address ? String(b.address).slice(0, 255) : null])).insertId;
    }
    if (!partner) throw bad('Choose the customer or type a new customer\'s name');
    v.partner_id = partner;
    const tariff = await c.one('SELECT id FROM water_tariffs WHERE id = ? AND active = 1', [b.tariff_id || (cur && cur.tariff_id)]);
    if (!tariff) throw bad('Choose the tariff');
    v.tariff_id = tariff.id;
    v.zone_id = Number(b.zone_id ?? (cur && cur.zone_id)) || null;
    v.billing = ['prepaid', 'postpaid'].includes(b.billing) ? b.billing : (cur ? cur.billing : 'postpaid');
    if (b.sewer_type !== undefined || !cur) v.sewer_type = SEWER_TYPES.includes(b.sewer_type) ? b.sewer_type : 'none';
    for (const [k, n] of [['address', 255], ['plot_no', 60], ['gps', 60], ['notes', 255]]) if (b[k] !== undefined || !cur) v[k] = b[k] ? String(b[k]).slice(0, n) : null;
    if (b.route_seq !== undefined) v.route_seq = Math.max(0, Math.round(Number(b.route_seq) || 0));
    if (b.debt_recovery_pct !== undefined) v.debt_recovery_pct = b.debt_recovery_pct === '' || b.debt_recovery_pct === null ? null : Math.min(100, Math.max(0, Number(b.debt_recovery_pct) || 0));
    if (cur && cur.billing !== v.billing && cur.meter_id) {
      const m = await c.one('SELECT kind FROM water_meters WHERE id = ?', [cur.meter_id]);
      if (m && m.kind !== v.billing) throw bad(`This connection has a ${m.kind} meter. Replace the meter (a "Replace meter" job) to change between prepaid and postpaid.`);
    }
    if (cur) { await c.query('UPDATE water_accounts SET ? WHERE id = ?', [v, id]); return id; }
    v.account_no = b.account_no ? String(b.account_no).trim().slice(0, 30) : await nextAccountNo(c);
    if (await c.one('SELECT id FROM water_accounts WHERE account_no = ?', [v.account_no])) throw bad(`Account number ${v.account_no} is already used`);
    v.status = 'pending';
    const ins = await c.query('INSERT INTO water_accounts SET ?', [v]);
    // with a meter already on site (moving in from another system): install it straight away
    if (b.meter_serial) await installMeter(c, user, ins.insertId, { serial: b.meter_serial, reading: b.initial_reading, date: b.connection_date || today(), kind: v.billing });
    return ins.insertId;
  });
}

async function installMeter(c, user, accountId, { serial, reading, date, kind, make, size_mm }) {
  const a = await c.one('SELECT * FROM water_accounts WHERE id = ? FOR UPDATE', [accountId]);
  serial = String(serial || '').trim().slice(0, 60);
  if (!serial) throw bad('Enter the meter serial number');
  let m = await c.one('SELECT * FROM water_meters WHERE serial = ? FOR UPDATE', [serial]);
  if (m && m.status === 'installed' && m.account_id !== accountId) throw bad(`Meter ${serial} is already installed on another connection`);
  const k = kind || a.billing;
  if (m && m.kind !== k) throw bad(`Meter ${serial} is a ${m.kind} meter but this connection is ${k}`);
  const rd = r3(reading || 0), dt = String(date || today()).slice(0, 10);
  if (!m) m = { id: (await c.query('INSERT INTO water_meters (serial, kind, make, size_mm) VALUES (?, ?, ?, ?)', [serial, k, make || null, Number(size_mm) || null])).insertId };
  await c.query(`UPDATE water_meters SET status = 'installed', account_id = ?, install_date = ?, initial_reading = ? WHERE id = ?`, [accountId, dt, rd, m.id]);
  await c.query('UPDATE water_accounts SET meter_id = ?, status = IF(status = \'pending\', \'active\', status), connection_date = COALESCE(connection_date, ?) WHERE id = ?', [m.id, dt, accountId]);
  await c.query(`INSERT INTO water_readings (account_id, meter_id, reading_date, reading, consumption, kind, user_id, notes) VALUES (?, ?, ?, ?, NULL, 'initial', ?, 'Meter installed')`, [accountId, m.id, dt, rd, user.id]);
  return m.id;
}

/* ---------------- readings ---------------- */
async function lastReading(c, accountId, meterId) {
  return c.one(`SELECT * FROM water_readings WHERE account_id = ? ${meterId ? 'AND meter_id = ?' : ''} ORDER BY reading_date DESC, id DESC LIMIT 1`, meterId ? [accountId, meterId] : [accountId]);
}
async function avgUse(c, accountId) {
  const s = await settings();
  const rows = await c.query(`SELECT consumption FROM water_bills WHERE account_id = ? AND estimated = 0 ORDER BY period DESC LIMIT ?`, [accountId, Number(s.estimate_months) || 3]);
  if (rows.length) return r3(rows.reduce((t, r) => t + Number(r.consumption), 0) / rows.length);
  const rr = await c.query(`SELECT consumption FROM water_readings WHERE account_id = ? AND kind = 'actual' AND consumption IS NOT NULL ORDER BY reading_date DESC LIMIT 3`, [accountId]);
  return rr.length ? r3(rr.reduce((t, r) => t + Number(r.consumption), 0) / rr.length) : 0;
}
async function addReading(user, b) {
  return db.tx(async c => {
    const a = await c.one('SELECT * FROM water_accounts WHERE id = ? FOR UPDATE', [b.account_id]);
    if (!a) throw bad('Unknown water account');
    if (!a.meter_id) throw bad(`${a.account_no} has no meter yet – complete its connection job first`);
    const reading = r3(b.reading), date = String(b.reading_date || today()).slice(0, 10);
    if (b.reading === '' || b.reading === null || b.reading === undefined || isNaN(reading) || reading < 0) throw bad('Type the number on the meter');
    if (date > today()) throw bad('The reading date cannot be in the future');
    const prev = await lastReading(c, a.id, a.meter_id);
    if (prev && date < String(prev.reading_date).slice(0, 10)) throw bad(`There is already a later reading (${String(prev.reading_date).slice(0, 10)})`);
    let cons = prev ? r3(reading - Number(prev.reading)) : null, flag = null;
    if (cons !== null && cons < 0) {
      if (!b.rollover) throw bad(`The meter shows less than last time (${Number(prev.reading)}). Check the number – or tick "meter went round" if it passed 99999.`);
      cons = r3(Number(b.rollover) - Number(prev.reading) + reading); flag = 'rollover';
    }
    if (cons !== null && !flag) {
      const s = await settings(), avg = await avgUse(c, a.id);
      if (cons === 0) flag = 'zero';
      else if (avg > 0 && cons > avg * Number(s.high_use_factor || 3)) flag = 'high';
    }
    const kind = ['actual', 'customer'].includes(b.kind) ? b.kind : 'actual';
    const ins = await c.query(`INSERT INTO water_readings (account_id, meter_id, reading_date, reading, consumption, kind, flag, user_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [a.id, a.meter_id, date, reading, cons, kind, flag, user.id, b.notes ? String(b.notes).slice(0, 255) : null]);
    return { id: ins.insertId, consumption: cons, flag };
  });
}

/* ---------------- postpaid billing ---------------- */
async function computeBill(c, a, t, period) {
  const end = monthEnd(period);
  const billed = await c.one(`SELECT r.* FROM water_readings r WHERE r.account_id = ? AND r.meter_id = ? AND (r.bill_id IS NOT NULL OR r.kind = 'initial') ORDER BY r.reading_date DESC, r.id DESC LIMIT 1`, [a.id, a.meter_id]);
  const latest = await c.one(`SELECT r.* FROM water_readings r WHERE r.account_id = ? AND r.meter_id = ? AND r.reading_date <= ? AND r.bill_id IS NULL AND r.kind IN ('actual','customer','final') ORDER BY r.reading_date DESC, r.id DESC LIMIT 1`, [a.id, a.meter_id, end]);
  const prev = billed ? Number(billed.reading) : 0;
  let curr, cons, estimated = 0;
  if (latest && (!billed || String(latest.reading_date) >= String(billed.reading_date)) && latest.id !== (billed && billed.id)) {
    curr = Number(latest.reading);
    // readings since the last bill (a rolled-over meter adds up its consumptions)
    const since = await c.query(`SELECT consumption FROM water_readings WHERE account_id = ? AND meter_id = ? AND bill_id IS NULL AND kind IN ('actual','customer','final') AND reading_date <= ? ${billed ? 'AND (reading_date > ? OR (reading_date = ? AND id > ?))' : ''}`,
      billed ? [a.id, a.meter_id, end, billed.reading_date, billed.reading_date, billed.id] : [a.id, a.meter_id, end]);
    cons = r3(since.reduce((s, r) => s + Number(r.consumption || 0), 0));
  } else {
    cons = await avgUse(c, a.id); curr = r3(prev + cons); estimated = 1;
  }
  const billedM3 = Math.max(cons, Number(t.min_m3) || 0);
  const ch = charges(t, a.sewer_type, billedM3, cons), water = ch.water, service = ch.service, sewer = ch.sewer;
  const tax = Number(t.tax_rate) || 0;
  const total = round2((water + service + sewer) * (1 + tax / 100));
  return { account_id: a.id, account_no: a.account_no, customer_name: a.customer_name, partner_id: a.partner_id, period, prev_reading: prev, curr_reading: curr, consumption: cons,
    billed_m3: r3(billedM3), estimated, water_amount: water, service_amount: service, sewer_amount: sewer, sewer_m3: ch.sewer_m3, tax_rate: tax, total, latest_id: latest && !estimated ? latest.id : null, meter_id: a.meter_id };
}
async function billPreview(period) {
  if (!/^\d{4}-\d{2}$/.test(period || '')) throw bad('Choose the month to bill');
  return db.tx(async c => {
    const accs = await c.query(`SELECT a.*, p.name customer_name FROM water_accounts a JOIN partners p ON p.id = a.partner_id
      WHERE a.billing = 'postpaid' AND a.status = 'active' AND a.meter_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM water_bills b WHERE b.account_id = a.id AND b.period = ?) ORDER BY a.zone_id, a.route_seq, a.account_no`, [period]);
    const out = [];
    for (const a of accs) out.push(await computeBill(c, a, await c.one('SELECT * FROM water_tariffs WHERE id = ?', [a.tariff_id]), period));
    return { period, bills: out, total: round2(out.reduce((s, b) => s + b.total, 0)), m3: r3(out.reduce((s, b) => s + b.billed_m3, 0)), estimated: out.filter(b => b.estimated).length };
  });
}
async function billRun(user, { period, run_date, account_ids }) {
  const biz = require('../routes/business');
  const s = await settings();
  if (!/^\d{4}-\d{2}$/.test(period || '')) throw bad('Choose the month to bill');
  const rd = String(run_date || today()).slice(0, 10), due = stock.addDays(rd, Number(s.due_days) || 21);
  return db.tx(async c => {
    const accs = await c.query(`SELECT a.*, p.name customer_name FROM water_accounts a JOIN partners p ON p.id = a.partner_id
      WHERE a.billing = 'postpaid' AND a.status = 'active' AND a.meter_id IS NOT NULL ${Array.isArray(account_ids) && account_ids.length ? 'AND a.id IN (?)' : ''}
        AND NOT EXISTS (SELECT 1 FROM water_bills b WHERE b.account_id = a.id AND b.period = ?) ORDER BY a.zone_id, a.route_seq, a.account_no FOR UPDATE`,
      Array.isArray(account_ids) && account_ids.length ? [account_ids.map(Number), period] : [period]);
    if (!accs.length) throw bad('Nothing to bill – every active postpaid connection already has a bill for this month');
    const run = (await c.query('INSERT INTO water_bill_runs (period, run_date, due_date, user_id) VALUES (?, ?, ?, ?)', [period, rd, due, user.id])).insertId;
    let n = 0, m3 = 0, tot = 0;
    for (const a of accs) {
      const t = await c.one('SELECT * FROM water_tariffs WHERE id = ?', [a.tariff_id]);
      const b = await computeBill(c, a, t, period);
      if (b.estimated) {
        const est = await c.query(`INSERT INTO water_readings (account_id, meter_id, reading_date, reading, consumption, kind, user_id, notes) VALUES (?, ?, ?, ?, ?, 'estimated', ?, 'Estimated – no reading this month')`,
          [a.id, a.meter_id, monthEnd(period) < rd ? monthEnd(period) : rd, b.curr_reading, b.consumption, user.id]);
        b.latest_id = est.insertId;
      }
      const lines = [];
      const what = `${b.billed_m3} m³ (meter ${b.prev_reading} → ${b.curr_reading}${b.estimated ? ', estimated' : ''}${b.billed_m3 > b.consumption ? `, minimum ${Number(t.min_m3)} m³` : ''})`;
      if (b.water_amount > 0) lines.push({ description: `Water ${period}: ${what}`, qty: 1, unit_price: b.water_amount, tax_rate: b.tax_rate, account_code: '4870' });
      if (b.service_amount > 0) lines.push({ description: `Service charge ${period}`, qty: 1, unit_price: b.service_amount, tax_rate: b.tax_rate, account_code: '4875' });
      if (b.sewer_amount > 0) lines.push({ description: `Sewerage ${period}${b.sewer_m3 > 0 ? ` (${b.sewer_m3} m³ = ${sewerShare(t, a.sewer_type)}% of water used, ${a.sewer_type.replace('_', '-')})` : ` (${Number(t.sewer_pct)}% of water)`}`, qty: 1, unit_price: b.sewer_amount, tax_rate: b.tax_rate, account_code: '4875' });
      let invId = null;
      if (lines.length) {
        invId = await biz.createInvoice(c, user, { kind: 'customer_invoice', partner_id: a.partner_id, invoice_date: rd, due_date: due,
          notes: `Water account ${a.account_no} – ${period}${a.address ? ' – ' + a.address : ''}`, lines: biz.calcLines(lines, 'unit_price') });
        await c.query('UPDATE invoices SET water_account_id = ? WHERE id = ?', [a.id, invId]);
        await biz.postInvoice(c, invId, user);
      }
      const billId = (await c.query(`INSERT INTO water_bills (run_id, account_id, period, prev_reading, curr_reading, consumption, billed_m3, estimated, water_amount, service_amount, sewer_amount, sewer_m3, total, invoice_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [run, a.id, period, b.prev_reading, b.curr_reading, b.consumption, b.billed_m3, b.estimated, b.water_amount, b.service_amount, b.sewer_amount, b.sewer_m3, b.total, invId])).insertId;
      if (b.latest_id) await c.query(`UPDATE water_readings SET bill_id = ? WHERE account_id = ? AND meter_id = ? AND bill_id IS NULL AND kind <> 'initial' AND id <= ?`, [billId, a.id, a.meter_id, b.latest_id]);
      n++; m3 += b.billed_m3; tot += b.total;
    }
    await c.query('UPDATE water_bill_runs SET bills = ?, m3 = ?, total = ? WHERE id = ?', [n, r3(m3), round2(tot), run]);
    return { run_id: run, bills: n, m3: r3(m3), total: round2(tot) };
  });
}

/* ---------------- prepaid vending ---------------- */
function sandboxToken(meter, units, seq) {
  const h = crypto.createHmac('sha256', 'S-ERP-sandbox').update(`${meter}|${units}|${seq}|${Date.now()}`).digest();
  let digits = ''; for (let i = 0; digits.length < 20; i++) digits += String(h[i % h.length] % 10);
  return digits.match(/.{4}/g).join('-');
}
async function quote(accountId, amount) {
  const a = await db.one('SELECT * FROM water_accounts WHERE id = ?', [accountId]);
  if (!a) throw bad('Unknown water account');
  return db.tx(c => splitVend(c, a, round2(amount)));
}
async function splitVend(c, a, amount) {
  const s = await settings();
  const t = await c.one('SELECT * FROM water_tariffs WHERE id = ?', [a.tariff_id]);
  const tax = Number(t.tax_rate) || 0, gross = n => n * (1 + tax / 100);
  const debt = round2((await c.one(`SELECT COALESCE(SUM(total - amount_paid),0) d FROM invoices WHERE water_account_id = ? AND status IN ('posted','partial')`, [a.id])).d);
  const pct = a.debt_recovery_pct !== null && a.debt_recovery_pct !== undefined ? Number(a.debt_recovery_pct) : Number(s.debt_recovery_pct);
  const debtTake = round2(Math.min(debt, amount * pct / 100));
  const monthStart = today().slice(0, 8) + '01';
  const mtd = r3((await c.one(`SELECT COALESCE(SUM(units_m3),0) m FROM water_vends WHERE account_id = ? AND status = 'completed' AND created_at >= ?`, [a.id, monthStart])).m);
  // each m³ costs its block price, plus sewerage as a % of that price (old style) and per-m³ sewerage on the connection's share
  const blocks = blocksOf(t), perM3 = sewerPerM3(t, a.sewer_type), sp = Number(t.sewer_pct || 0) / 100;
  const priced = blocks.map(b => ({ upto: b.upto, price: Number(b.price) * (1 + sp) + perM3 }));
  const buy = money => unitsFor(priced, mtd, Math.max(0, money) / (1 + tax / 100));
  // the monthly standing charge: once a month, from the first purchase – or, when the tariff makes it free in the
  // first band (WASCO domestic band A), only once this month's water goes past that band
  const scDue = round2(gross(Number(t.service_charge)));
  const scPaid = round2((await c.one(`SELECT COALESCE(SUM(service_recovered),0) s FROM water_vends WHERE account_id = ? AND status = 'completed' AND created_at >= ?`, [a.id, monthStart])).s);
  const free = t.service_free_upto === null || t.service_free_upto === undefined ? null : Number(t.service_free_upto);
  let scTake = round2(Math.max(0, Math.min(amount - debtTake, scDue - scPaid)));
  if (scTake > 0 && free !== null && mtd + buy(amount - debtTake) <= free) scTake = 0;
  const waterGross = round2(amount - debtTake - scTake);
  const units = buy(waterGross);
  const allNet = round2(waterGross / (1 + tax / 100));
  const waterNet = perM3 || sp ? Math.min(allNet, priceFor(blocks, mtd, units)) : allNet, sewerNet = round2(allNet - waterNet);
  const net = round2(waterNet + sewerNet);
  return { amount, debt, debt_recovered: debtTake, service_recovered: scTake, water_gross: waterGross, water_net: waterNet, sewer_net: Math.max(0, sewerNet), tax_rate: tax,
    tax: round2(waterGross - net + (scTake - round2(scTake / (1 + tax / 100)))), units_m3: units, month_m3_before: mtd };
}
async function vend(user, b) {
  await require('./activation').assertCanSell();
  const s = await settings();
  const amount = round2(b.amount);
  if (!(amount >= Number(s.min_vend))) throw bad(`The smallest purchase is ${Number(s.min_vend).toFixed(2)}`);
  if (Number(s.max_vend) && amount > Number(s.max_vend)) throw bad(`The largest single purchase is ${Number(s.max_vend).toFixed(2)}`);
  return db.tx(async c => {
    const a = await c.one(`SELECT a.*, p.name customer_name, m.serial meter_serial, m.kind meter_kind FROM water_accounts a JOIN partners p ON p.id = a.partner_id
      LEFT JOIN water_meters m ON m.id = a.meter_id WHERE ${b.account_id ? 'a.id = ?' : '(a.account_no = ? OR m.serial = ?)'} FOR UPDATE`,
      b.account_id ? [b.account_id] : [String(b.lookup || ''), String(b.lookup || '')]);
    if (!a) throw bad('No water account with that number or meter');
    if (a.billing !== 'prepaid') throw bad(`${a.account_no} is a postpaid (billed) account – take its payment against the bill instead`);
    if (a.status !== 'active') throw bad(`${a.account_no} is ${a.status} – it cannot buy water until it is reconnected`);
    if (!a.meter_id || a.meter_kind !== 'prepaid') throw bad(`${a.account_no} has no prepaid meter installed`);
    const m = await c.one('SELECT * FROM payment_methods WHERE id = ?', [b.method_id]);
    if (!m || m.kind === 'account') throw bad('Choose how the customer pays (cash, card, mobile money)');
    if (m.requires_reference && !b.reference) throw bad(`${m.name} needs a reference (e.g. the M-Pesa transaction number)`);
    if (b.session_id) { const ss = await c.one(`SELECT id FROM pos_sessions WHERE id = ? AND status = 'open'`, [b.session_id]); if (!ss) throw bad('The till session is closed – open a session first'); }
    const q = await splitVend(c, a, amount);
    if (!(q.units_m3 > 0) && q.water_gross > 0) throw bad('That amount buys no water at this tariff');
    const ins = await c.query(`INSERT INTO water_vends (account_id, meter_id, amount, debt_recovered, service_recovered, water_amount, sewer_amount, tax_amount, units_m3, method_id, session_id, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [a.id, a.meter_id, amount, q.debt_recovered, q.service_recovered, q.water_net, q.sewer_net, q.tax, q.units_m3, m.id, b.session_id || null, user.id]);
    const number = `WV/${today().slice(0, 4)}/${pad(ins.insertId, 6)}`;
    // the token
    let token = null, provider = s.token_provider, ref = null;
    if (q.units_m3 > 0) {
      if (s.token_provider === 'plugin') {
        const r = await plugins.call(s.token_plugin_id, 'vendToken', { meter: a.meter_serial, units_m3: q.units_m3, amount: q.water_gross, reference: number, account_no: a.account_no });
        if (!r || r.status === 'failed' || !r.token) throw bad(`The token server did not give a token${r && r.message ? ': ' + r.message : ''}. Nothing was charged.`);
        token = String(r.token).slice(0, 60); ref = r.provider_ref ? String(r.provider_ref).slice(0, 80) : null;
      } else if (s.token_provider === 'sandbox') token = 'TEST ' + sandboxToken(a.meter_serial, q.units_m3, ins.insertId);
    }
    await c.query('UPDATE water_vends SET number = ?, token = ?, provider = ?, provider_ref = ? WHERE id = ?', [number, token, provider, ref, ins.insertId]);
    // debt recovery pays the oldest water bills
    if (q.debt_recovered > 0) await receipts.allocate(c, { partner_id: a.partner_id, amount: q.debt_recovered, method_id: m.id, reference: b.reference || number, where: 'i.water_account_id = ?', args: [a.id],
      user, memo: `Debt recovered on water purchase ${number}`, session_id: b.session_id || null, source_type: 'water_vend', source_id: ins.insertId });
    const rest = round2(amount - q.debt_recovered);
    if (rest > 0) {
      await c.query(`INSERT INTO payments (direction, partner_id, method_id, amount, reference, user_id, session_id) VALUES ('in', ?, ?, ?, ?, ?, ?)`,
        [a.partner_id, m.id, rest, b.reference || number, user.id, b.session_id || null]);
      const scNet = round2(q.service_recovered / (1 + q.tax_rate / 100));
      await accounting.post(c, { reference: number, memo: `Prepaid water ${a.account_no}`, source_type: 'water_vend', source_id: ins.insertId, user_id: user.id,
        lines: [{ code: m.account_code, debit: rest }, { code: '4870', credit: q.water_net, description: `${q.units_m3} m³ prepaid water` },
          { code: '4875', credit: round2(scNet + q.sewer_net), description: 'Standing charge and sewerage (prepaid)' }, { code: '2100', credit: round2(rest - q.water_net - scNet - q.sewer_net) }] });
    }
    return { id: ins.insertId, number, token, provider, provider_ref: ref, account_no: a.account_no, customer_name: a.customer_name, meter_serial: a.meter_serial, method: m.name, ...q };
  });
}

/* ---------------- deposits & closing ---------------- */
async function takeDeposit(user, accountId, { amount, method_id, reference }) {
  const amt = round2(amount);
  if (!(amt > 0)) throw bad('Enter the deposit amount');
  return db.tx(async c => {
    const a = await c.one('SELECT * FROM water_accounts WHERE id = ? FOR UPDATE', [accountId]);
    if (!a) throw notFound('Water account');
    const m = await c.one('SELECT * FROM payment_methods WHERE id = ?', [method_id]);
    if (!m || m.kind === 'account') throw bad('Choose how the deposit was paid');
    if (m.requires_reference && !reference) throw bad(`${m.name} needs a reference`);
    await c.query(`INSERT INTO payments (direction, partner_id, method_id, amount, reference, user_id) VALUES ('in', ?, ?, ?, ?, ?)`, [a.partner_id, m.id, amt, reference || a.account_no, user.id]);
    await accounting.post(c, { reference: a.account_no, memo: `Water deposit ${a.account_no}`, source_type: 'water_deposit', source_id: a.id, user_id: user.id,
      lines: [{ code: m.account_code, debit: amt }, { code: '2430', credit: amt, partner_id: a.partner_id }] });
    await c.query('UPDATE water_accounts SET deposit_held = deposit_held + ? WHERE id = ?', [amt, a.id]);
    return { deposit_held: round2(Number(a.deposit_held) + amt) };
  });
}
async function closeAccount(user, accountId, { final_reading, refund_method_id }) {
  const biz = require('../routes/business');
  return db.tx(async c => {
    const a = await c.one('SELECT a.*, p.name customer_name FROM water_accounts a JOIN partners p ON p.id = a.partner_id WHERE a.id = ? FOR UPDATE', [accountId]);
    if (!a) throw notFound('Water account');
    if (a.status === 'closed') throw bad('Already closed');
    let finalBill = null;
    if (a.billing === 'postpaid' && a.meter_id && final_reading !== undefined && final_reading !== '') {
      const prev = await lastReading(c, a.id, a.meter_id), rd = r3(final_reading);
      if (prev && rd < Number(prev.reading)) throw bad(`The final reading is less than the last one (${Number(prev.reading)})`);
      await c.query(`INSERT INTO water_readings (account_id, meter_id, reading_date, reading, consumption, kind, user_id, notes) VALUES (?, ?, ?, ?, ?, 'final', ?, 'Final reading – account closed')`,
        [a.id, a.meter_id, today(), rd, prev ? r3(rd - Number(prev.reading)) : null, user.id]);
      const t = await c.one('SELECT * FROM water_tariffs WHERE id = ?', [a.tariff_id]);
      const b = await computeBill(c, a, { ...t, service_charge: 0, min_m3: 0 }, today().slice(0, 7));
      if (b.water_amount + b.sewer_amount > 0 && !b.estimated) {
        const lines = [{ description: `Water – final reading ${b.prev_reading} → ${b.curr_reading} (${b.consumption} m³)`, qty: 1, unit_price: b.water_amount, tax_rate: b.tax_rate, account_code: '4870' }];
        if (b.sewer_amount > 0) lines.push({ description: 'Sewerage – final', qty: 1, unit_price: b.sewer_amount, tax_rate: b.tax_rate, account_code: '4875' });
        const inv = await biz.createInvoice(c, user, { kind: 'customer_invoice', partner_id: a.partner_id, invoice_date: today(), due_date: today(), notes: `Water account ${a.account_no} – final bill`, lines: biz.calcLines(lines, 'unit_price') });
        await c.query('UPDATE invoices SET water_account_id = ? WHERE id = ?', [a.id, inv]);
        await biz.postInvoice(c, inv, user);
        await c.query(`UPDATE water_readings SET bill_id = 0 WHERE account_id = ? AND bill_id IS NULL AND kind <> 'initial'`, [a.id]);
        finalBill = inv;
      }
    }
    let applied = 0, refunded = 0, dep = round2(a.deposit_held);
    if (dep > 0) {
      const debt = round2((await c.one(`SELECT COALESCE(SUM(total - amount_paid),0) d FROM invoices WHERE water_account_id = ? AND status IN ('posted','partial')`, [a.id])).d);
      if (debt > 0) { applied = round2(Math.min(dep, debt)); await receipts.allocate(c, { partner_id: a.partner_id, amount: applied, debit_code: '2430', where: 'i.water_account_id = ?', args: [a.id], user, reference: a.account_no, memo: `Deposit used for final water account ${a.account_no}` }); }
      refunded = round2(dep - applied);
      if (refunded > 0) {
        const m = await c.one('SELECT * FROM payment_methods WHERE id = ?', [refund_method_id]);
        if (!m || m.kind === 'account') throw bad(`Choose how to refund the rest of the deposit (${refunded.toFixed(2)})`);
        await c.query(`INSERT INTO payments (direction, partner_id, method_id, amount, reference, user_id) VALUES ('out', ?, ?, ?, ?, ?)`, [a.partner_id, m.id, refunded, `Deposit refund ${a.account_no}`, user.id]);
        await accounting.post(c, { reference: a.account_no, memo: `Water deposit refunded ${a.account_no}`, source_type: 'water_deposit', source_id: a.id, user_id: user.id,
          lines: [{ code: '2430', debit: refunded, partner_id: a.partner_id }, { code: m.account_code, credit: refunded }] });
      }
    }
    if (a.meter_id) await c.query(`UPDATE water_meters SET status = 'removed' WHERE id = ?`, [a.meter_id]);
    await c.query(`UPDATE water_accounts SET status = 'closed', deposit_held = 0 WHERE id = ?`, [a.id]);
    return { final_invoice_id: finalBill, deposit_applied: applied, deposit_refunded: refunded };
  });
}

/* ---------------- field jobs ---------------- */
async function createJob(user, b) {
  const biz = require('../routes/business');
  const s = await settings();
  const kind = JOB_KINDS[b.kind] ? b.kind : null;
  if (!kind) throw bad('Choose what kind of job it is');
  return db.tx(async c => {
    const a = b.account_id ? await c.one('SELECT * FROM water_accounts WHERE id = ?', [b.account_id]) : null;
    if (b.account_id && !a) throw bad('Unknown water account');
    if (['new_connection', 'disconnection', 'reconnection', 'meter_install', 'meter_replace'].includes(kind) && !a) throw bad('This job needs the water account');
    if (a && ['disconnection', 'reconnection', 'new_connection', 'meter_replace'].includes(kind)) {
      const open = await c.one(`SELECT number FROM water_jobs WHERE account_id = ? AND kind = ? AND status IN ('open','assigned')`, [a.id, kind]);
      if (open) throw bad(`There is already an open ${JOB_KINDS[kind].toLowerCase()} job (${open.number}) for this account`);
    }
    if (kind === 'reconnection' && a && a.status !== 'disconnected') throw bad('Only a disconnected connection can be reconnected');
    if (kind === 'disconnection' && a && a.status !== 'active') throw bad('Only an active connection can be disconnected');
    let fee = b.fee !== undefined && b.fee !== '' ? round2(b.fee) : kind === 'new_connection' ? Number(s.connection_fee) : kind === 'reconnection' ? Number(s.reconnection_fee) : 0;
    fee = Math.max(0, fee || 0);
    const v = { kind, account_id: a ? a.id : null, priority: ['low', 'normal', 'high', 'urgent'].includes(b.priority) ? b.priority : (['burst'].includes(kind) ? 'urgent' : 'normal'),
      location: b.location ? String(b.location).slice(0, 255) : (a && a.address) || null, description: b.description ? String(b.description).slice(0, 500) : null,
      assigned_to: Number(b.assigned_to) || null, due_date: b.due_date || null, fee, user_id: user.id };
    if (v.assigned_to) v.status = 'assigned';
    const id = (await c.query('INSERT INTO water_jobs SET ?', [v])).insertId;
    const number = `WJ/${today().slice(0, 4)}/${pad(id, 5)}`;
    await c.query('UPDATE water_jobs SET number = ? WHERE id = ?', [number, id]);
    if (fee > 0 && a) {
      const t = await c.one('SELECT tax_rate FROM water_tariffs WHERE id = ?', [a.tariff_id]);
      const inv = await biz.createInvoice(c, user, { kind: 'customer_invoice', partner_id: a.partner_id, due_date: today(), notes: `${number} – ${JOB_KINDS[kind]} – water account ${a.account_no}`,
        lines: biz.calcLines([{ description: `${JOB_KINDS[kind]} fee (${number})`, qty: 1, gross_total: fee, unit_price: round2(fee / (1 + (Number(t.tax_rate) || 0) / 100)), tax_rate: Number(t.tax_rate) || 0, account_code: '4876' }], 'unit_price') });
      await c.query('UPDATE invoices SET water_account_id = ? WHERE id = ?', [a.id, inv]);
      await biz.postInvoice(c, inv, user);
      await c.query('UPDATE water_jobs SET invoice_id = ? WHERE id = ?', [inv, id]);
    }
    return { id, number };
  });
}
async function completeJob(user, id, b) {
  return db.tx(async c => {
    const j = await c.one('SELECT * FROM water_jobs WHERE id = ? FOR UPDATE', [id]);
    if (!j) throw notFound('Job');
    if (['done', 'cancelled'].includes(j.status)) throw bad('This job is already closed');
    const a = j.account_id ? await c.one('SELECT * FROM water_accounts WHERE id = ? FOR UPDATE', [j.account_id]) : null;
    if (['new_connection', 'meter_install'].includes(j.kind)) await installMeter(c, user, a.id, { serial: b.meter_serial, reading: b.reading, date: today(), make: b.make, size_mm: b.size_mm });
    if (j.kind === 'meter_replace') {
      if (b.old_reading === undefined || b.old_reading === '') throw bad('Type the last reading on the old meter');
      if (a.meter_id) {
        const prev = await lastReading(c, a.id, a.meter_id), or = r3(b.old_reading);
        if (prev && or < Number(prev.reading)) throw bad(`The old meter's last reading is less than its previous one (${Number(prev.reading)})`);
        await c.query(`INSERT INTO water_readings (account_id, meter_id, reading_date, reading, consumption, kind, user_id, notes) VALUES (?, ?, ?, ?, ?, 'final', ?, 'Old meter removed')`,
          [a.id, a.meter_id, today(), or, prev ? r3(or - Number(prev.reading)) : null, user.id]);
        await c.query(`UPDATE water_meters SET status = ?, account_id = NULL WHERE id = ?`, [b.old_meter_faulty ? 'faulty' : 'removed', a.meter_id]);
      }
      await installMeter(c, user, a.id, { serial: b.meter_serial, reading: b.reading, date: today(), kind: b.new_billing || a.billing, make: b.make, size_mm: b.size_mm });
      if (b.new_billing && b.new_billing !== a.billing) await c.query('UPDATE water_accounts SET billing = ? WHERE id = ?', [b.new_billing, a.id]);
    }
    if (j.kind === 'disconnection') await c.query(`UPDATE water_accounts SET status = 'disconnected' WHERE id = ?`, [a.id]);
    if (j.kind === 'reconnection') await c.query(`UPDATE water_accounts SET status = 'active' WHERE id = ?`, [a.id]);
    // materials taken from the store
    let cost = 0; const used = [];
    for (const it of b.materials || []) {
      const q = Number(it.qty);
      if (!it.product_id || !(q > 0)) continue;
      const p = await c.one('SELECT id, name, type, cost FROM products WHERE id = ?', [it.product_id]);
      if (!p) throw bad('Unknown material');
      const unit = p.type === 'stock' ? await stock.move(c, { product_id: p.id, qty: -q, move_type: 'adjustment', reference: j.number, user_id: user.id, reason: `Water job ${j.number}` }) : Number(p.cost);
      cost += q * unit; used.push({ product_id: p.id, name: p.name, qty: q, unit_cost: round2(unit) });
    }
    cost = round2(cost);
    if (cost > 0) await accounting.post(c, { reference: j.number, memo: `Materials for ${JOB_KINDS[j.kind]} ${j.number}`, source_type: 'water_job', source_id: j.id, user_id: user.id,
      lines: [{ code: '5500', debit: cost }, { code: '1200', credit: cost }] });
    await c.query(`UPDATE water_jobs SET status = 'done', done_at = NOW(), result = ?, materials = ?, materials_cost = ? WHERE id = ?`,
      [b.result ? String(b.result).slice(0, 500) : null, used.length ? JSON.stringify(used) : null, cost, j.id]);
    return { id: j.id, materials_cost: cost };
  });
}

/** accounts to cut off: postpaid, active, owing at least the minimum on water bills overdue by the set number of days */
async function disconnectionList() {
  const s = await settings();
  return db.query(`SELECT a.id, a.partner_id, a.account_no, a.address, p.name customer_name, p.phone, z.name zone_name,
      SUM(i.total - i.amount_paid) arrears, MAX(DATEDIFF(CURDATE(), i.due_date)) days_overdue
    FROM water_accounts a JOIN partners p ON p.id = a.partner_id LEFT JOIN water_zones z ON z.id = a.zone_id
    JOIN invoices i ON i.water_account_id = a.id AND i.status IN ('posted','partial') AND i.due_date < CURDATE()
    WHERE a.status = 'active' AND a.billing = 'postpaid'
      AND NOT EXISTS (SELECT 1 FROM water_jobs j WHERE j.account_id = a.id AND j.kind = 'disconnection' AND j.status IN ('open','assigned'))
    GROUP BY a.id HAVING arrears >= ? AND days_overdue >= ? ORDER BY arrears DESC`, [Number(s.disconnect_min_amount) || 0, Number(s.disconnect_after_days) || 0]);
}

/* ---------------- reports ---------------- */
async function dashboard(period) {
  period = /^\d{4}-\d{2}$/.test(period || '') ? period : today().slice(0, 7);
  const from = period + '-01', to = monthEnd(period);
  const n = async (sql, a = []) => Number(Object.values((await db.one(sql, a)) || { x: 0 })[0]) || 0;
  const byStatus = await db.query(`SELECT billing, status, COUNT(*) n FROM water_accounts GROUP BY billing, status`);
  const billed = await db.one(`SELECT COUNT(*) bills, COALESCE(SUM(billed_m3),0) m3, COALESCE(SUM(total),0) amt, SUM(estimated) est FROM water_bills WHERE period = ?`, [period]);
  const pre = await db.one(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) amt, COALESCE(SUM(units_m3),0) m3 FROM water_vends WHERE status = 'completed' AND created_at BETWEEN ? AND ?`, [from, to + ' 23:59:59']);
  const collected = await n(`SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.water_account_id IS NOT NULL AND p.direction = 'in' AND p.status = 'completed' AND p.created_at BETWEEN ? AND ?`, [from, to + ' 23:59:59']);
  const arrears = await db.one(`SELECT COALESCE(SUM(i.total - i.amount_paid),0) total,
      COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) <= 0 THEN i.total - i.amount_paid END),0) current,
      COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) BETWEEN 1 AND 30 THEN i.total - i.amount_paid END),0) d30,
      COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) BETWEEN 31 AND 60 THEN i.total - i.amount_paid END),0) d60,
      COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) > 60 THEN i.total - i.amount_paid END),0) d90
    FROM invoices i WHERE i.water_account_id IS NOT NULL AND i.status IN ('posted','partial')`);
  const toRead = await n(`SELECT COUNT(*) FROM water_accounts a WHERE a.billing = 'postpaid' AND a.status = 'active' AND a.meter_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM water_readings r WHERE r.account_id = a.id AND r.reading_date BETWEEN ? AND ? AND r.kind IN ('actual','customer','initial'))`, [from, to]);
  const flags = await db.query(`SELECT r.id, r.reading_date, r.reading, r.consumption, r.flag, a.id account_id, a.account_no, p.name customer_name FROM water_readings r
    JOIN water_accounts a ON a.id = r.account_id JOIN partners p ON p.id = a.partner_id WHERE r.flag IN ('high','zero','rollover') AND r.reading_date BETWEEN ? AND ? ORDER BY r.flag, r.consumption DESC LIMIT 50`, [from, to]);
  const jobs = await db.query(`SELECT kind, COUNT(*) n FROM water_jobs WHERE status IN ('open','assigned') GROUP BY kind`);
  const billedAmt = round2(billed.amt);
  return { period, accounts: byStatus, billed: { bills: Number(billed.bills), m3: r3(billed.m3), amount: billedAmt, estimated: Number(billed.est) || 0 },
    prepaid: { sales: Number(pre.n), amount: round2(pre.amt), m3: r3(pre.m3) }, collected: round2(collected),
    collection_rate: billedAmt > 0 ? Math.round(collected / billedAmt * 100) : null,
    arrears: Object.fromEntries(Object.entries(arrears).map(([k, v]) => [k, round2(v)])), to_read: toRead, flags, open_jobs: jobs,
    disconnect_candidates: (await disconnectionList()).length };
}
/** non-revenue water: what the zone's bulk meter supplied against what was billed or sold */
async function nrw(period) {
  period = /^\d{4}-\d{2}$/.test(period || '') ? period : today().slice(0, 7);
  const from = period + '-01', to = monthEnd(period) + ' 23:59:59';
  const zones = await db.query('SELECT * FROM water_zones WHERE active = 1 ORDER BY name');
  const out = [];
  for (const z of zones) {
    const bulk = await db.one('SELECT bulk_m3 FROM water_zone_readings WHERE zone_id = ? AND period = ?', [z.id, period]);
    const billed = Number((await db.one(`SELECT COALESCE(SUM(b.consumption),0) m FROM water_bills b JOIN water_accounts a ON a.id = b.account_id WHERE a.zone_id = ? AND b.period = ?`, [z.id, period])).m);
    const sold = Number((await db.one(`SELECT COALESCE(SUM(v.units_m3),0) m FROM water_vends v JOIN water_accounts a ON a.id = v.account_id WHERE a.zone_id = ? AND v.status = 'completed' AND v.created_at BETWEEN ? AND ?`, [z.id, from, to])).m);
    const supplied = bulk ? Number(bulk.bulk_m3) : null, used = r3(billed + sold);
    out.push({ zone_id: z.id, zone: z.name, bulk_meter_no: z.bulk_meter_no, supplied, billed_m3: r3(billed), prepaid_m3: r3(sold), accounted: used,
      lost: supplied === null ? null : r3(supplied - used), loss_pct: supplied ? Math.round((supplied - used) / supplied * 1000) / 10 : null });
  }
  return { period, zones: out };
}

module.exports = { DEFAULTS, CATEGORIES, SEWER_TYPES, charges, sewerPerM3, JOB_KINDS, settings, saveSettings, cleanTariff, blocksOf, priceFor, unitsFor, account, saveAccount, installMeter, addReading,
  billPreview, billRun, quote, vend, takeDeposit, closeAccount, createJob, completeJob, disconnectionList, dashboard, nrw, ACC_SQL, monthEnd };
