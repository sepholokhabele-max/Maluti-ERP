// Water utility routes. Permissions: 'water' (office: accounts, billing, tariffs, jobs), 'water.read' (meter readers),
// 'water.vend' (cashiers selling prepaid water and taking bill payments at the till).
const express = require('express');
const db = require('../db');
const W = require('../services/water');
const receipts = require('../services/receipts');
const { requirePerm, can } = require('../auth');
const { ah, bad, notFound, round2, today } = require('../util');

const r = express.Router();
const OFFICE = requirePerm('water');
const anyOf = (...perms) => (req, res, next) => perms.some(p => can(req.user, p)) ? next() : next(Object.assign(new Error(`You do not have permission: ${perms[0]}`), { status: 403 }));
const READ = anyOf('water', 'water.read');
const VEND = anyOf('water', 'water.vend');

/* settings */
r.get('/water/settings', READ, ah(async (req, res) => res.json({ settings: await W.settings(), job_kinds: W.JOB_KINDS, categories: W.CATEGORIES,
  token_plugins: require('../services/plugins').list().filter(p => p.type === 'water').map(p => ({ id: p.id, name: p.name })) })));
r.put('/water/settings', requirePerm('settings'), ah(async (req, res) => res.json(await W.saveSettings(req.body || {}))));
r.get('/water/dashboard', OFFICE, ah(async (req, res) => res.json(await W.dashboard(req.query.period))));

/* zones */
r.get('/water/zones', READ, ah(async (req, res) => res.json(await db.query(`SELECT z.*, u.name reader_name,
    (SELECT COUNT(*) FROM water_accounts a WHERE a.zone_id = z.id AND a.status IN ('active','disconnected')) accounts
  FROM water_zones z LEFT JOIN users u ON u.id = z.reader_id ORDER BY z.active DESC, z.name`))));
function cleanZone(b) {
  const v = { name: String(b.name || '').trim().slice(0, 80) };
  if (!v.name) throw bad('Name the zone, e.g. "Ha Thetsane"');
  for (const [k, n] of [['code', 20], ['bulk_meter_no', 60], ['notes', 255]]) v[k] = b[k] ? String(b[k]).slice(0, n) : null;
  v.reader_id = Number(b.reader_id) || null;
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  return v;
}
r.post('/water/zones', OFFICE, ah(async (req, res) => res.json({ id: (await db.query('INSERT INTO water_zones SET ?', [cleanZone(req.body)])).insertId })));
r.put('/water/zones/:id(\\d+)', OFFICE, ah(async (req, res) => { await db.query('UPDATE water_zones SET ? WHERE id = ?', [cleanZone(req.body), req.params.id]); res.json({ ok: true }); }));
r.put('/water/zones/:id(\\d+)/bulk', OFFICE, ah(async (req, res) => {
  const p = String(req.body.period || ''), m3 = Number(req.body.bulk_m3);
  if (!/^\d{4}-\d{2}$/.test(p)) throw bad('Choose the month'); if (!(m3 >= 0)) throw bad('Type the m³ the zone meter supplied');
  await db.query('INSERT INTO water_zone_readings (zone_id, period, bulk_m3, notes) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE bulk_m3 = VALUES(bulk_m3), notes = VALUES(notes)',
    [req.params.id, p, m3, req.body.notes ? String(req.body.notes).slice(0, 255) : null]);
  res.json({ ok: true });
}));
r.get('/water/nrw', OFFICE, ah(async (req, res) => res.json(await W.nrw(req.query.period))));

/* tariffs */
r.get('/water/tariffs', READ, ah(async (req, res) => {
  const rows = await db.query(`SELECT t.*, (SELECT COUNT(*) FROM water_accounts a WHERE a.tariff_id = t.id AND a.status <> 'closed') accounts FROM water_tariffs t ORDER BY t.active DESC, t.name`);
  rows.forEach(t => { t.blocks = W.blocksOf(t); }); res.json(rows);
}));
r.post('/water/tariffs', OFFICE, ah(async (req, res) => res.json({ id: (await db.query('INSERT INTO water_tariffs SET ?', [W.cleanTariff(req.body)])).insertId })));
r.put('/water/tariffs/:id(\\d+)', OFFICE, ah(async (req, res) => {
  const t = await db.one('SELECT * FROM water_tariffs WHERE id = ?', [req.params.id]); if (!t) throw notFound('Tariff');
  await db.query('UPDATE water_tariffs SET ? WHERE id = ?', [W.cleanTariff({ ...t, blocks: W.blocksOf(t), ...req.body }), t.id]); res.json({ ok: true });
}));
r.get('/water/tariffs/:id(\\d+)/calc', READ, ah(async (req, res) => {
  const t = await db.one('SELECT * FROM water_tariffs WHERE id = ?', [req.params.id]); if (!t) throw notFound('Tariff');
  const m3 = Math.max(0, Number(req.query.m3) || 0), ch = W.charges(t, req.query.sewer_type || 'none', Math.max(m3, Number(t.min_m3)), m3);
  const net = round2(ch.water + ch.service + ch.sewer), vat = round2(net * Number(t.tax_rate) / 100);
  res.json({ m3, water: ch.water, service: ch.service, sewer: ch.sewer, sewer_m3: ch.sewer_m3, net, vat, total: round2(net + vat) });
}));
// the WASCO tariff (approved by LEWA) as ready-made tariffs: adds them, or updates the prices of tariffs with the same name
r.post('/water/tariffs/preset/wasco', OFFICE, ah(async (req, res) => {
  const vat = req.body && req.body.tax_rate !== undefined ? Number(req.body.tax_rate) : 15;
  const sew = { sewer_pct: 0, sewer_rate: 9.85, sewer_wb_pct: 85, sewer_nwb_pct: 65, tax_rate: vat, min_m3: 0, active: 1 };
  const P = [
    { name: 'WASCO Domestic', category: 'domestic', blocks: [{ upto: 5, price: 6.11 }, { upto: 10, price: 10.39 }, { upto: 15, price: 18.29 }, { upto: null, price: 25.24 }], service_charge: 49.82, service_free_upto: 5,
      notes: 'Band A 0–5 kl M6.11 (no standing charge), B >5–10 M10.39, C >10–15 M18.29, D >15 M25.24; standing charge M49.82 in bands B–D' },
    { name: 'WASCO Industry & business', category: 'commercial', blocks: [{ upto: null, price: 16.64 }], service_charge: 479.17, notes: 'Industries, business, hotels, construction' },
    { name: 'WASCO Government', category: 'government', blocks: [{ upto: null, price: 16.64 }], service_charge: 331.73 },
    { name: 'WASCO Schools', category: 'school', blocks: [{ upto: null, price: 16.49 }], service_charge: 331.73 },
    { name: 'WASCO Churches', category: 'church', blocks: [{ upto: null, price: 16.49 }], service_charge: 239.64, notes: 'Religious institutions' },
    { name: 'WASCO Standpipes', category: 'standpipe', blocks: [{ upto: null, price: 8.29 }], service_charge: 0, notes: 'Public standpipes' }
  ];
  const out = [];
  for (const x of P) {
    const v = W.cleanTariff({ ...sew, ...x, effective_from: req.body && req.body.effective_from });
    const cur = await db.one('SELECT id FROM water_tariffs WHERE name = ?', [v.name]);
    if (cur) await db.query('UPDATE water_tariffs SET ? WHERE id = ?', [v, cur.id]); else await db.query('INSERT INTO water_tariffs SET ?', [v]);
    out.push({ name: v.name, updated: !!cur });
  }
  res.json({ tariffs: out });
}));


/* accounts */
r.get('/water/accounts', anyOf('water', 'water.read', 'water.vend'), ah(async (req, res) => {
  const cond = [], args = [];
  if (req.query.q) { cond.push('(a.account_no LIKE ? OR p.name LIKE ? OR p.phone LIKE ? OR m.serial LIKE ? OR a.address LIKE ?)'); for (let i = 0; i < 5; i++) args.push(`%${req.query.q}%`); }
  for (const k of ['zone_id', 'billing', 'status', 'tariff_id']) if (req.query[k]) { cond.push(`a.${k} = ?`); args.push(req.query[k]); }
  if (!req.query.status) cond.push(`a.status <> 'closed'`);
  if (req.query.owing) cond.push(`EXISTS (SELECT 1 FROM invoices i WHERE i.water_account_id = a.id AND i.status IN ('posted','partial'))`);
  const rows = await db.query(`${W.ACC_SQL} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY a.zone_id, a.route_seq, a.account_no LIMIT 3000`, args);
  rows.forEach(a => { a.arrears = round2(a.arrears); }); res.json(rows);
}));
r.get('/water/accounts/:id(\\d+)', anyOf('water', 'water.read', 'water.vend'), ah(async (req, res) => res.json(await W.account(req.params.id))));
r.post('/water/accounts', OFFICE, ah(async (req, res) => res.json({ id: await W.saveAccount(req.user, req.body || {}) })));
r.put('/water/accounts/:id(\\d+)', OFFICE, ah(async (req, res) => res.json({ id: await W.saveAccount(req.user, req.body || {}, Number(req.params.id)) })));
r.post('/water/accounts/:id(\\d+)/deposit', OFFICE, ah(async (req, res) => res.json(await W.takeDeposit(req.user, req.params.id, req.body || {}))));
r.post('/water/accounts/:id(\\d+)/close', OFFICE, ah(async (req, res) => res.json(await W.closeAccount(req.user, req.params.id, req.body || {}))));
r.post('/water/accounts/:id(\\d+)/pay', VEND, ah(async (req, res) => {
  // a postpaid bill payment at the office or the till (session_id), oldest water bills first
  const a = await db.one('SELECT * FROM water_accounts WHERE id = ?', [req.params.id]); if (!a) throw notFound('Water account');
  const b = req.body || {};
  if (b.session_id) { const s = await db.one(`SELECT id FROM pos_sessions WHERE id = ? AND status = 'open'`, [b.session_id]); if (!s) throw bad('The till session is closed'); }
  const out = await db.tx(c => receipts.allocate(c, { partner_id: a.partner_id, amount: b.amount, method_id: b.method_id, reference: b.reference, where: 'i.water_account_id = ?', args: [a.id],
    user: req.user, memo: `Water bill payment ${a.account_no}`, session_id: b.session_id || null, source_type: 'water_payment', source_id: a.id }));
  res.json({ ...out, account_no: a.account_no });
}));

/* meters */
r.get('/water/meters', OFFICE, ah(async (req, res) => res.json(await db.query(`SELECT m.*, a.account_no, p.name customer_name FROM water_meters m
  LEFT JOIN water_accounts a ON a.id = m.account_id LEFT JOIN partners p ON p.id = a.partner_id ${req.query.status ? 'WHERE m.status = ?' : ''} ORDER BY m.status, m.serial LIMIT 3000`, req.query.status ? [req.query.status] : []))));
r.post('/water/meters', OFFICE, ah(async (req, res) => {
  const serials = String(req.body.serials || req.body.serial || '').split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
  if (!serials.length) throw bad('Type one or more meter serial numbers');
  const kind = req.body.kind === 'prepaid' ? 'prepaid' : 'postpaid'; let added = 0;
  for (const s of serials) { const x = await db.query('INSERT IGNORE INTO water_meters (serial, kind, make, size_mm) VALUES (?, ?, ?, ?)', [s.slice(0, 60), kind, req.body.make || null, Number(req.body.size_mm) || null]); added += x.affectedRows; }
  res.json({ added, skipped: serials.length - added });
}));

/* readings */
r.get('/water/route', READ, ah(async (req, res) => {
  // reading sheet: postpaid connections of a zone in walking order, with last reading and this month's reading if taken
  const period = /^\d{4}-\d{2}$/.test(req.query.period || '') ? req.query.period : today().slice(0, 7);
  const rows = await db.query(`SELECT a.id, a.account_no, a.address, a.plot_no, a.route_seq, a.gps, p.name customer_name, m.serial meter_serial, z.name zone_name,
      (SELECT r.reading FROM water_readings r WHERE r.account_id = a.id AND r.meter_id = a.meter_id AND r.reading_date < ? ORDER BY r.reading_date DESC, r.id DESC LIMIT 1) prev_reading,
      (SELECT r.reading_date FROM water_readings r WHERE r.account_id = a.id AND r.meter_id = a.meter_id AND r.reading_date < ? ORDER BY r.reading_date DESC, r.id DESC LIMIT 1) prev_date,
      (SELECT CONCAT(r.id, '|', r.reading, '|', COALESCE(r.consumption,''), '|', COALESCE(r.flag,'')) FROM water_readings r WHERE r.account_id = a.id AND r.reading_date BETWEEN ? AND ? AND r.kind IN ('actual','customer') ORDER BY r.id DESC LIMIT 1) this_month
    FROM water_accounts a JOIN partners p ON p.id = a.partner_id LEFT JOIN water_meters m ON m.id = a.meter_id LEFT JOIN water_zones z ON z.id = a.zone_id
    WHERE a.billing = 'postpaid' AND a.status = 'active' AND a.meter_id IS NOT NULL ${req.query.zone_id ? 'AND a.zone_id = ?' : ''} ORDER BY z.name, a.route_seq, a.account_no`,
    [period + '-01', period + '-01', period + '-01', W.monthEnd(period), ...(req.query.zone_id ? [req.query.zone_id] : [])]);
  rows.forEach(x => { if (x.this_month) { const [id, rd, cons, flag] = x.this_month.split('|'); x.this_month = { id: Number(id), reading: Number(rd), consumption: cons === '' ? null : Number(cons), flag: flag || null }; } });
  res.json({ period, rows, read: rows.filter(x => x.this_month).length });
}));
r.post('/water/readings', READ, ah(async (req, res) => res.json(await W.addReading(req.user, req.body || {}))));
r.post('/water/readings/batch', READ, ah(async (req, res) => {
  const out = [];
  for (const x of (req.body.readings || [])) {
    if (x.reading === '' || x.reading === null || x.reading === undefined) continue;
    try { out.push({ account_id: x.account_id, ok: true, ...(await W.addReading(req.user, { ...x, reading_date: x.reading_date || req.body.reading_date })) }); }
    catch (e) { out.push({ account_id: x.account_id, ok: false, error: e.message }); }
  }
  res.json({ saved: out.filter(x => x.ok).length, results: out });
}));
r.delete('/water/readings/:id(\\d+)', OFFICE, ah(async (req, res) => {
  const x = await db.one('SELECT * FROM water_readings WHERE id = ?', [req.params.id]); if (!x) throw notFound('Reading');
  if (x.bill_id !== null || x.kind === 'initial') throw bad('This reading is already on a bill (or is the meter\'s first reading) and cannot be removed');
  const later = await db.one('SELECT id FROM water_readings WHERE account_id = ? AND (reading_date > ? OR (reading_date = ? AND id > ?))', [x.account_id, x.reading_date, x.reading_date, x.id]);
  if (later) throw bad('Only the latest reading can be removed');
  await db.query('DELETE FROM water_readings WHERE id = ?', [x.id]); res.json({ ok: true });
}));

/* billing */
r.get('/water/billing/preview', OFFICE, ah(async (req, res) => res.json(await W.billPreview(req.query.period))));
r.post('/water/billing/run', OFFICE, ah(async (req, res) => res.json(await W.billRun(req.user, req.body || {}))));
r.get('/water/billing/runs', OFFICE, ah(async (req, res) => res.json(await db.query('SELECT r.*, u.name user_name FROM water_bill_runs r LEFT JOIN users u ON u.id = r.user_id ORDER BY r.id DESC LIMIT 60'))));
r.get('/water/billing/runs/:id(\\d+)', OFFICE, ah(async (req, res) => {
  const run = await db.one('SELECT * FROM water_bill_runs WHERE id = ?', [req.params.id]); if (!run) throw notFound('Billing run');
  run.bills = await db.query(`SELECT b.*, a.account_no, a.address, p.name customer_name, p.phone, p.email, i.number invoice_number, i.due_date, t.name tariff_name
    FROM water_bills b JOIN water_accounts a ON a.id = b.account_id JOIN partners p ON p.id = a.partner_id JOIN water_tariffs t ON t.id = a.tariff_id
    LEFT JOIN invoices i ON i.id = b.invoice_id WHERE b.run_id = ? ORDER BY a.zone_id, a.route_seq, a.account_no`, [run.id]);
  res.json(run);
}));

/* prepaid */
r.get('/water/vend/quote', VEND, ah(async (req, res) => {
  const a = await db.one(`SELECT a.id FROM water_accounts a LEFT JOIN water_meters m ON m.id = a.meter_id WHERE a.id = ? OR a.account_no = ? OR m.serial = ?`, [Number(req.query.account_id) || 0, String(req.query.lookup || ''), String(req.query.lookup || '')]);
  if (!a) throw bad('No water account with that number or meter');
  res.json({ ...(await W.quote(a.id, req.query.amount)), account: await W.account(a.id).then(x => ({ id: x.id, account_no: x.account_no, customer_name: x.customer_name, meter_serial: x.meter_serial, billing: x.billing, status: x.status, tariff_name: x.tariff_name, arrears: x.arrears, address: x.address })) });
}));
r.post('/water/vend', VEND, ah(async (req, res) => res.json(await W.vend(req.user, req.body || {}))));
r.get('/water/vends', OFFICE, ah(async (req, res) => {
  const from = req.query.from || today().slice(0, 8) + '01', to = req.query.to || today();
  res.json(await db.query(`SELECT v.*, a.account_no, p.name customer_name, m.name method_name, u.name user_name FROM water_vends v JOIN water_accounts a ON a.id = v.account_id
    JOIN partners p ON p.id = a.partner_id LEFT JOIN payment_methods m ON m.id = v.method_id LEFT JOIN users u ON u.id = v.user_id
    WHERE v.created_at BETWEEN ? AND ? ORDER BY v.id DESC LIMIT 2000`, [from, to + ' 23:59:59']));
}));
r.get('/water/vends/:id(\\d+)', VEND, ah(async (req, res) => {
  const v = await db.one(`SELECT v.*, a.account_no, a.address, p.name customer_name, mt.serial meter_serial, m.name method_name, t.name tariff_name FROM water_vends v
    JOIN water_accounts a ON a.id = v.account_id JOIN partners p ON p.id = a.partner_id LEFT JOIN water_meters mt ON mt.id = v.meter_id
    LEFT JOIN payment_methods m ON m.id = v.method_id JOIN water_tariffs t ON t.id = a.tariff_id WHERE v.id = ?`, [req.params.id]);
  if (!v) throw notFound('Purchase'); res.json(v);
}));

/* jobs */
r.get('/water/jobs', anyOf('water', 'water.read'), ah(async (req, res) => {
  const st = req.query.status || 'open';
  const where = st === 'open' ? `j.status IN ('open','assigned')` : st === 'all' ? '1=1' : 'j.status = ?';
  const args = st === 'open' || st === 'all' ? [] : [st];
  if (!can(req.user, 'water')) { args.push(req.user.id); }
  res.json(await db.query(`SELECT j.*, a.account_no, a.address, p.name customer_name, p.phone, u.name assigned_name, i.number invoice_number, i.status invoice_status
    FROM water_jobs j LEFT JOIN water_accounts a ON a.id = j.account_id LEFT JOIN partners p ON p.id = a.partner_id LEFT JOIN users u ON u.id = j.assigned_to
    LEFT JOIN invoices i ON i.id = j.invoice_id WHERE ${where} ${can(req.user, 'water') ? '' : 'AND j.assigned_to = ?'}
    ORDER BY FIELD(j.priority,'urgent','high','normal','low'), j.id DESC LIMIT 1000`, args));
}));
r.post('/water/jobs', OFFICE, ah(async (req, res) => res.json(await W.createJob(req.user, req.body || {}))));
r.put('/water/jobs/:id(\\d+)', OFFICE, ah(async (req, res) => {
  const j = await db.one('SELECT * FROM water_jobs WHERE id = ?', [req.params.id]); if (!j) throw notFound('Job');
  if (['done', 'cancelled'].includes(j.status)) throw bad('This job is closed');
  const b = req.body || {}, v = {};
  if (b.assigned_to !== undefined) { v.assigned_to = Number(b.assigned_to) || null; v.status = v.assigned_to ? 'assigned' : 'open'; }
  for (const k of ['priority']) if (b[k]) v[k] = b[k];
  for (const [k, n] of [['description', 500], ['location', 255]]) if (b[k] !== undefined) v[k] = b[k] ? String(b[k]).slice(0, n) : null;
  if (b.due_date !== undefined) v.due_date = b.due_date || null;
  if (b.status === 'cancelled') { if (j.invoice_id) { const i = await db.one('SELECT amount_paid FROM invoices WHERE id = ?', [j.invoice_id]); if (Number(i.amount_paid) > 0) throw bad('The fee for this job has been paid – refund it first'); } v.status = 'cancelled'; }
  if (Object.keys(v).length) await db.query('UPDATE water_jobs SET ? WHERE id = ?', [v, j.id]);
  if (v.status === 'cancelled' && j.invoice_id) {
    const i = await db.one('SELECT status FROM invoices WHERE id = ?', [j.invoice_id]);
    if (i && i.status === 'posted') await db.tx(async c => { await require('../services/accounting').reverseSource(c, 'invoice', j.invoice_id, { user_id: req.user.id }); await c.query(`UPDATE invoices SET status = 'cancelled' WHERE id = ?`, [j.invoice_id]); });
  }
  res.json({ ok: true });
}));
r.post('/water/jobs/:id(\\d+)/done', anyOf('water', 'water.read'), ah(async (req, res) => {
  const j = await db.one('SELECT * FROM water_jobs WHERE id = ?', [req.params.id]); if (!j) throw notFound('Job');
  if (!can(req.user, 'water') && j.assigned_to !== req.user.id) throw bad('This job is not assigned to you');
  res.json(await W.completeJob(req.user, j.id, req.body || {}));
}));
r.get('/water/disconnections', OFFICE, ah(async (req, res) => {
  const due = await W.disconnectionList();
  const ready = await db.query(`SELECT a.id, a.account_no, p.name customer_name, p.phone FROM water_accounts a JOIN partners p ON p.id = a.partner_id
    WHERE a.status = 'disconnected' AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.water_account_id = a.id AND i.status IN ('posted','partial') AND i.due_date < CURDATE())
      AND NOT EXISTS (SELECT 1 FROM water_jobs j WHERE j.account_id = a.id AND j.kind = 'reconnection' AND j.status IN ('open','assigned'))`);
  res.json({ due: due.map(x => ({ ...x, arrears: round2(x.arrears) })), ready_to_reconnect: ready });
}));
r.post('/water/disconnections', OFFICE, ah(async (req, res) => {
  const ids = (req.body.account_ids || []).map(Number).filter(Boolean); if (!ids.length) throw bad('Tick the accounts to disconnect');
  const made = [];
  for (const id of ids) made.push(await W.createJob(req.user, { kind: 'disconnection', account_id: id, assigned_to: req.body.assigned_to, description: 'Unpaid water bills' }));
  res.json({ jobs: made });
}));

module.exports = r;
