// Sites & shifts for security and cleaning companies: client sites, staff rosters, check-in / check-out, absences and relief,
// occurrence book, incident reports, cleaning inspections with checklists, consumables issued to sites, billing per shift / hour,
// and hours & profit per site.
const express = require('express');
const db = require('../db');
const stock = require('../services/stock');
const accounting = require('../services/accounting');
const { requirePerm } = require('../auth');
const { ah, bad, notFound, round2, pad, today } = require('../util');

const r = express.Router();
const S = requirePerm('sites');
const ROLES = ['guard', 'supervisor', 'cleaner', 'driver', 'other'];
const INC = ['theft', 'break_in', 'trespass', 'fire', 'injury', 'damage', 'alarm', 'complaint', 'other'];
const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;
const hrs = (a, b) => Math.max(0, (new Date(String(b).replace(' ', 'T')) - new Date(String(a).replace(' ', 'T'))) / 3600000);
const shiftHours = s => round2(hrs(s.check_in_at || s.start_at, s.check_out_at || s.end_at));
async function costRates() {
  const att = { weekly_hours: 45, ...((await db.getSetting('attendance', {})) || {}) };
  const rows = await db.query(`SELECT id, basic_salary FROM employees`);
  return new Map(rows.map(e => [e.id, Number(e.basic_salary) ? Number(e.basic_salary) * 12 / 52 / Number(att.weekly_hours || 45) : 0]));
}

/* ======================= SITES ======================= */
// staff list for rosters (supervisors may not have HR rights)
r.get('/sites/staff', S, ah(async (req, res) => res.json(await db.query(`SELECT id, first_name, last_name, phone, job_title FROM employees WHERE status = 'active' ORDER BY first_name, last_name`))));
r.get('/sites', S, ah(async (req, res) => {
  const rows = await db.query(`SELECT s.*, p.name client_name,
      (SELECT COUNT(*) FROM shifts x WHERE x.site_id = s.id AND x.status = 'on_duty') on_duty,
      (SELECT COUNT(*) FROM shifts x WHERE x.site_id = s.id AND x.status IN ('planned','on_duty') AND x.start_at <= NOW() AND x.end_at > NOW()) should_be_on,
      (SELECT COUNT(*) FROM shifts x WHERE x.site_id = s.id AND x.status = 'planned' AND x.start_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE) AND x.end_at > NOW()) late,
      (SELECT COUNT(*) FROM incidents i WHERE i.site_id = s.id AND i.status = 'open') open_incidents,
      (SELECT score FROM inspections n WHERE n.site_id = s.id ORDER BY n.at DESC LIMIT 1) last_score
    FROM sites s JOIN partners p ON p.id = s.partner_id ${req.query.all ? '' : 'WHERE s.active = 1'} ORDER BY s.name`);
  res.json(rows);
}));
r.get('/sites/:id(\\d+)', S, ah(async (req, res) => {
  const s = await db.one('SELECT s.*, p.name client_name, p.phone client_phone, k.number contract_number, k.status contract_status FROM sites s JOIN partners p ON p.id = s.partner_id LEFT JOIN contracts k ON k.id = s.contract_id WHERE s.id = ?', [req.params.id]);
  if (!s) throw notFound('Site');
  s.shifts = await db.query(`SELECT x.*, CONCAT(e.first_name, ' ', e.last_name) employee_name, CONCAT(rp.first_name, ' ', rp.last_name) replaced_by_name FROM shifts x JOIN employees e ON e.id = x.employee_id
    LEFT JOIN employees rp ON rp.id = x.replaced_by WHERE x.site_id = ? AND x.end_at >= DATE_SUB(NOW(), INTERVAL 2 DAY) AND x.start_at <= DATE_ADD(NOW(), INTERVAL 7 DAY) ORDER BY x.start_at, x.id`, [s.id]);
  s.log = await db.query(`SELECT g.*, CONCAT(e.first_name, ' ', e.last_name) employee_name, u.name user_name FROM site_log g LEFT JOIN employees e ON e.id = g.employee_id LEFT JOIN users u ON u.id = g.user_id
    WHERE g.site_id = ? ORDER BY g.at DESC LIMIT 60`, [s.id]);
  s.incidents = await db.query(`SELECT i.*, CONCAT(e.first_name, ' ', e.last_name) employee_name FROM incidents i LEFT JOIN employees e ON e.id = i.employee_id WHERE i.site_id = ? ORDER BY i.occurred_at DESC LIMIT 30`, [s.id]);
  s.inspections = await db.query('SELECT n.*, u.name user_name FROM inspections n LEFT JOIN users u ON u.id = n.user_id WHERE n.site_id = ? ORDER BY n.at DESC LIMIT 20', [s.id]);
  s.inspections.forEach(n => { try { n.items = JSON.parse(n.items); } catch (_) { n.items = []; } });
  s.consumables = await db.query(`SELECT m.created_at, p.name, -m.qty qty, p.uom, ROUND(-m.qty * m.unit_cost, 2) cost FROM stock_moves m JOIN products p ON p.id = m.product_id WHERE m.reference = ? ORDER BY m.id DESC LIMIT 50`, [`SITE-${s.id}`]);
  s.checklist_items = String(s.checklist || '').split('\n').map(x => x.trim()).filter(Boolean);
  res.json(s);
}));
function cleanSite(b) {
  const v = { name: String(b.name || '').trim().slice(0, 120) };
  if (!v.name) throw bad('Name the site, e.g. "LNDC Kingsway offices – main gate"');
  v.partner_id = Number(b.partner_id) || null;
  if (!v.partner_id) throw bad('Choose the client');
  v.kind = ['security', 'cleaning', 'both'].includes(b.kind) ? b.kind : 'security';
  for (const [k, n] of [['address', 255], ['contact_name', 120], ['contact_phone', 40]]) v[k] = b[k] ? String(b[k]).slice(0, n) : null;
  v.staff_day = Math.max(0, Math.round(Number(b.staff_day) || 0)); v.staff_night = Math.max(0, Math.round(Number(b.staff_night) || 0));
  v.billing = ['contract', 'per_shift', 'per_hour'].includes(b.billing) ? b.billing : 'contract';
  v.rate = round2(Math.max(0, Number(b.rate) || 0));
  if (v.billing !== 'contract' && !v.rate) throw bad('Enter the rate per shift or per hour');
  v.contract_id = Number(b.contract_id) || null;
  v.checklist = b.checklist ? String(b.checklist).slice(0, 5000) : null; v.instructions = b.instructions ? String(b.instructions).slice(0, 5000) : null;
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  return v;
}
r.post('/sites', S, ah(async (req, res) => { const ins = await db.query('INSERT INTO sites SET ?', [cleanSite(req.body)]); res.json({ id: ins.insertId }); }));
r.put('/sites/:id(\\d+)', S, ah(async (req, res) => {
  const s = await db.one('SELECT * FROM sites WHERE id = ?', [req.params.id]);
  if (!s) throw notFound();
  await db.query('UPDATE sites SET ? WHERE id = ?', [cleanSite({ ...s, ...req.body }), s.id]); res.json({ id: s.id });
}));

/* ======================= ROSTER & SHIFTS ======================= */
/** plan shifts for staff over a date range: same times on chosen weekdays; overlapping shifts of the same person are skipped */
r.post('/sites/:id(\\d+)/roster', S, ah(async (req, res) => {
  const b = req.body;
  const s = await db.one('SELECT * FROM sites WHERE id = ? AND active = 1', [req.params.id]);
  if (!s) throw notFound();
  const emps = [...new Set((b.employee_ids || []).map(Number).filter(Boolean))];
  if (!emps.length) throw bad('Choose the staff for these shifts');
  const from = String(b.from || today()).slice(0, 10), to = String(b.to || from).slice(0, 10);
  if (to < from) throw bad('The last day is before the first day');
  if ((new Date(to) - new Date(from)) / 86400000 > 62) throw bad('Plan at most two months at a time');
  if (!/^\d{2}:\d{2}$/.test(b.start_time || '') || !/^\d{2}:\d{2}$/.test(b.end_time || '')) throw bad('Enter start and end times, e.g. 06:00 and 18:00');
  const days = (b.days && b.days.length ? b.days : [1, 2, 3, 4, 5, 6, 7]).map(Number);
  const role = ROLES.includes(b.role) ? b.role : (s.kind === 'cleaning' ? 'cleaner' : 'guard');
  const made = [], skipped = [];
  await db.tx(async c => {
    for (let d = new Date(from + 'T12:00:00'); d <= new Date(to + 'T12:00:00'); d.setDate(d.getDate() + 1)) {
      const dow = ((d.getDay() + 6) % 7) + 1;
      if (!days.includes(dow)) continue;
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const start = `${day} ${b.start_time}:00`;
      let end = `${day} ${b.end_time}:00`;
      if (b.end_time <= b.start_time) end = `${stock.addDays(day, 1)} ${b.end_time}:00`; // night shift ends the next morning
      for (const e of emps) {
        const clash = await c.one(`SELECT x.id, s.name FROM shifts x JOIN sites s ON s.id = x.site_id WHERE x.employee_id = ? AND x.status NOT IN ('cancelled','absent') AND x.start_at < ? AND x.end_at > ?`, [e, end, start]);
        if (clash) { skipped.push({ employee_id: e, day, site: clash.name }); continue; }
        const ins = await c.query('INSERT INTO shifts (site_id, employee_id, role, start_at, end_at) VALUES (?, ?, ?, ?, ?)', [s.id, e, role, start, end]);
        made.push(ins.insertId);
      }
    }
  });
  res.json({ created: made.length, skipped });
}));
const SH_SQL = `SELECT x.*, s.name site_name, s.kind site_kind, CONCAT(e.first_name, ' ', e.last_name) employee_name, e.phone employee_phone FROM shifts x JOIN sites s ON s.id = x.site_id JOIN employees e ON e.id = x.employee_id`;
r.get('/shifts', S, ah(async (req, res) => {
  const from = req.query.from || today(), to = req.query.to || from;
  const cond = ['x.start_at < ?', 'x.end_at > ?'], args = [stock.addDays(to, 1) + ' 00:00:00', from + ' 00:00:00'];
  if (req.query.site_id) { cond.push('x.site_id = ?'); args.push(req.query.site_id); }
  if (req.query.employee_id) { cond.push('x.employee_id = ?'); args.push(req.query.employee_id); }
  if (req.query.status) { cond.push('x.status = ?'); args.push(req.query.status); }
  const rows = await db.query(`${SH_SQL} WHERE ${cond.join(' AND ')} ORDER BY x.start_at, s.name LIMIT 3000`, args);
  const now = new Date();
  rows.forEach(x => { x.late = x.status === 'planned' && new Date(String(x.start_at).replace(' ', 'T')) < new Date(now - 15 * 60000) && new Date(String(x.end_at).replace(' ', 'T')) > now; x.hours = shiftHours(x); });
  res.json(rows);
}));
async function getShift(c, id) { const x = await c.one('SELECT * FROM shifts WHERE id = ? FOR UPDATE', [id]); if (!x) throw notFound('Shift'); return x; }
const log = (c, siteId, kind, employeeId, text, user, at) => c.query('INSERT INTO site_log (site_id, kind, at, employee_id, text, user_id) VALUES (?, ?, COALESCE(?, NOW()), ?, ?, ?)', [siteId, kind, at || null, employeeId, text.slice(0, 500), user.id]);
r.post('/shifts/:id(\\d+)/checkin', S, ah(async (req, res) => {
  await db.tx(async c => {
    const x = await getShift(c, req.params.id);
    if (x.status !== 'planned') throw bad(`This shift is ${x.status.replace('_', ' ')}`);
    await c.query(`UPDATE shifts SET status = 'on_duty', check_in_at = COALESCE(?, NOW()) WHERE id = ?`, [req.body.at || null, x.id]);
    const e = await c.one(`SELECT CONCAT(first_name, ' ', last_name) n FROM employees WHERE id = ?`, [x.employee_id]);
    await log(c, x.site_id, 'on_duty', x.employee_id, `${e.n} reported on duty${req.body.note ? ' – ' + req.body.note : ''}`, req.user, req.body.at);
  });
  res.json({ ok: true });
}));
r.post('/shifts/:id(\\d+)/checkout', S, ah(async (req, res) => {
  await db.tx(async c => {
    const x = await getShift(c, req.params.id);
    if (!['on_duty', 'planned'].includes(x.status)) throw bad(`This shift is ${x.status.replace('_', ' ')}`);
    await c.query(`UPDATE shifts SET status = 'done', check_in_at = COALESCE(check_in_at, start_at), check_out_at = COALESCE(?, NOW()), note = COALESCE(?, note) WHERE id = ?`, [req.body.at || null, req.body.note || null, x.id]);
    const e = await c.one(`SELECT CONCAT(first_name, ' ', last_name) n FROM employees WHERE id = ?`, [x.employee_id]);
    await log(c, x.site_id, 'off_duty', x.employee_id, `${e.n} went off duty${req.body.note ? ' – ' + req.body.note : ''}`, req.user, req.body.at);
  });
  res.json({ ok: true });
}));
// no-show: the shift is marked absent; a relief can take it over (a new shift for them)
r.post('/shifts/:id(\\d+)/absent', S, ah(async (req, res) => {
  const out = await db.tx(async c => {
    const x = await getShift(c, req.params.id);
    if (!['planned', 'on_duty'].includes(x.status)) throw bad(`This shift is ${x.status.replace('_', ' ')}`);
    let relief = null;
    if (req.body.replacement_id) {
      const rid = Number(req.body.replacement_id);
      if (rid === x.employee_id) throw bad('Choose somebody else as relief');
      const clash = await c.one(`SELECT id FROM shifts WHERE employee_id = ? AND status NOT IN ('cancelled','absent') AND start_at < ? AND end_at > ?`, [rid, x.end_at, x.start_at]);
      if (clash) throw bad('The relief already has a shift at that time');
      relief = (await c.query('INSERT INTO shifts (site_id, employee_id, role, start_at, end_at, note) VALUES (?, ?, ?, ?, ?, ?)', [x.site_id, rid, x.role, x.start_at, x.end_at, `Relief for shift #${x.id}`])).insertId;
    }
    await c.query(`UPDATE shifts SET status = 'absent', replaced_by = ?, note = ? WHERE id = ?`, [req.body.replacement_id || null, req.body.reason || 'Did not report for duty', x.id]);
    const e = await c.one(`SELECT CONCAT(first_name, ' ', last_name) n FROM employees WHERE id = ?`, [x.employee_id]);
    await log(c, x.site_id, 'note', x.employee_id, `${e.n} absent${req.body.reason ? ' (' + req.body.reason + ')' : ''}${relief ? ' – relief sent' : ' – NO RELIEF'}`, req.user);
    return { relief_shift_id: relief };
  });
  res.json(out);
}));
r.post('/shifts/:id(\\d+)/cancel', S, ah(async (req, res) => {
  const x = await db.one('SELECT * FROM shifts WHERE id = ?', [req.params.id]);
  if (!x) throw notFound();
  if (x.status !== 'planned') throw bad('Only a planned shift can be cancelled');
  await db.query(`UPDATE shifts SET status = 'cancelled' WHERE id = ?`, [x.id]); res.json({ ok: true });
}));

/* ======================= OCCURRENCE BOOK, INCIDENTS, INSPECTIONS ======================= */
r.post('/sites/:id(\\d+)/log', S, ah(async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) throw bad('Write the entry');
  const kind = ['patrol', 'visitor', 'handover', 'note'].includes(req.body.kind) ? req.body.kind : 'note';
  await db.query('INSERT INTO site_log (site_id, kind, at, employee_id, text, user_id) VALUES (?, ?, COALESCE(?, NOW()), ?, ?, ?)', [req.params.id, kind, req.body.at || null, Number(req.body.employee_id) || null, text.slice(0, 500), req.user.id]);
  res.json({ ok: true });
}));
r.get('/incidents', S, ah(async (req, res) => {
  const cond = [], args = [];
  if (req.query.status && req.query.status !== 'all') { cond.push('i.status = ?'); args.push(req.query.status); }
  if (req.query.site_id) { cond.push('i.site_id = ?'); args.push(req.query.site_id); }
  res.json(await db.query(`SELECT i.*, s.name site_name, p.name client_name, CONCAT(e.first_name, ' ', e.last_name) employee_name FROM incidents i JOIN sites s ON s.id = i.site_id JOIN partners p ON p.id = s.partner_id
    LEFT JOIN employees e ON e.id = i.employee_id ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY i.status = 'open' DESC, i.occurred_at DESC LIMIT 500`, args));
}));
function cleanIncident(b) {
  const v = { description: String(b.description || '').trim().slice(0, 10000) };
  if (!v.description) throw bad('Describe what happened');
  v.occurred_at = String(b.occurred_at || '').replace('T', ' ').slice(0, 19) || fmt(new Date());
  if (v.occurred_at.length === 16) v.occurred_at += ':00';
  v.kind = INC.includes(b.kind) ? b.kind : 'other'; v.severity = ['low', 'medium', 'high'].includes(b.severity) ? b.severity : 'medium';
  v.employee_id = Number(b.employee_id) || null; v.action_taken = b.action_taken ? String(b.action_taken).slice(0, 5000) : null;
  v.police_case = b.police_case ? String(b.police_case).slice(0, 60) : null; v.client_informed = b.client_informed ? 1 : 0;
  return v;
}
r.post('/sites/:id(\\d+)/incidents', S, ah(async (req, res) => {
  const s = await db.one('SELECT id FROM sites WHERE id = ?', [req.params.id]);
  if (!s) throw notFound();
  const v = cleanIncident(req.body);
  const ins = await db.query('INSERT INTO incidents SET ?', [{ ...v, site_id: s.id, user_id: req.user.id }]);
  const number = `INC/${new Date().getFullYear()}/${pad(ins.insertId, 5)}`;
  await db.query('UPDATE incidents SET number = ? WHERE id = ?', [number, ins.insertId]);
  await db.query(`INSERT INTO site_log (site_id, kind, at, employee_id, text, user_id) VALUES (?, 'note', ?, ?, ?, ?)`, [s.id, v.occurred_at, v.employee_id, `INCIDENT ${number}: ${v.kind.replace('_', ' ')} – ${v.description.slice(0, 200)}`, req.user.id]);
  res.json({ id: ins.insertId, number });
}));
r.put('/incidents/:id(\\d+)', S, ah(async (req, res) => {
  const i = await db.one('SELECT * FROM incidents WHERE id = ?', [req.params.id]);
  if (!i) throw notFound();
  const v = cleanIncident({ ...i, ...req.body, occurred_at: req.body.occurred_at || String(i.occurred_at) });
  if (req.body.status && ['open', 'closed'].includes(req.body.status)) v.status = req.body.status;
  await db.query('UPDATE incidents SET ? WHERE id = ?', [v, i.id]); res.json({ ok: true });
}));
// cleaning (or guard post) inspection against the site's checklist
r.post('/sites/:id(\\d+)/inspections', S, ah(async (req, res) => {
  const s = await db.one('SELECT id FROM sites WHERE id = ?', [req.params.id]);
  if (!s) throw notFound();
  const items = (req.body.items || []).filter(x => String(x.item || '').trim()).map(x => ({ item: String(x.item).slice(0, 120), ok: x.ok ? 1 : 0, note: x.note ? String(x.note).slice(0, 200) : '' }));
  if (!items.length) throw bad('Add checklist items to the site first (edit the site → checklist)');
  const score = Math.round(items.filter(x => x.ok).length / items.length * 1000) / 10;
  await db.query('INSERT INTO inspections (site_id, at, items, score, signed_by, notes, user_id) VALUES (?, NOW(), ?, ?, ?, ?, ?)',
    [s.id, JSON.stringify(items), score, req.body.signed_by ? String(req.body.signed_by).slice(0, 120) : null, req.body.notes ? String(req.body.notes).slice(0, 500) : null, req.user.id]);
  res.json({ score });
}));

/* ======================= CONSUMABLES & BILLING ======================= */
// chemicals, toilet paper, refuse bags… taken from stock for a site: Dr 5300 Consumables used on sites / Cr 1200 Inventory
r.post('/sites/:id(\\d+)/issue', S, ah(async (req, res) => {
  const out = await db.tx(async c => {
    const s = await c.one('SELECT * FROM sites WHERE id = ?', [req.params.id]);
    if (!s) throw notFound();
    let value = 0; const lines = [];
    for (const l of req.body.lines || []) {
      const q = Number(l.qty);
      if (!l.product_id || !(q > 0)) continue;
      const p = await c.one('SELECT id, name, type FROM products WHERE id = ?', [l.product_id]);
      if (!p || p.type !== 'stock') throw bad('Only stocked products can be issued to a site');
      const cost = await stock.move(c, { product_id: p.id, qty: -q, move_type: 'adjustment', reference: `SITE-${s.id}`, user_id: req.user.id, reason: `Issued to ${s.name}`.slice(0, 120), location_id: req.body.location_id });
      value += q * cost; lines.push({ product: p.name, qty: q });
    }
    if (!lines.length) throw bad('Add what was issued');
    value = round2(value);
    if (value) await accounting.post(c, { reference: `SITE-${s.id}`, memo: `Consumables issued to ${s.name}`, source_type: 'site_issue', source_id: s.id, user_id: req.user.id,
      lines: [{ code: '5300', debit: value, description: s.name }, { code: '1200', credit: value }] });
    return { value, lines };
  });
  res.json(out);
}));
/** invoice a site billed per shift or per hour: every finished, not yet invoiced shift in the period */
r.post('/sites/:id(\\d+)/invoice', requirePerm('invoicing'), ah(async (req, res) => {
  const biz = require('./business');
  const out = await db.tx(async c => {
    const s = await c.one('SELECT * FROM sites WHERE id = ?', [req.params.id]);
    if (!s) throw notFound();
    if (s.billing === 'contract') throw bad('This site is billed by its contract (Contracts & repeat invoices)');
    const from = String(req.body.from || '').slice(0, 10), to = String(req.body.to || today()).slice(0, 10);
    if (!from) throw bad('Choose the period');
    const sh = await c.query(`SELECT * FROM shifts WHERE site_id = ? AND status = 'done' AND invoice_id IS NULL AND DATE(start_at) BETWEEN ? AND ? FOR UPDATE`, [s.id, from, to]);
    if (!sh.length) throw bad('No finished shifts to invoice in this period');
    const qty = s.billing === 'per_shift' ? sh.length : round2(sh.reduce((t, x) => t + shiftHours(x), 0));
    const vat = Number(((await db.getSetting('company', {})) || {}).default_vat ?? 15);
    const inv = await biz.createInvoice(c, req.user, { kind: 'customer_invoice', partner_id: s.partner_id, due_date: stock.addDays(today(), 30), notes: `${s.name} – ${from} to ${to}`,
      lines: biz.calcLines([{ description: `${s.kind === 'cleaning' ? 'Cleaning' : 'Guarding'} services at ${s.name}, ${from} to ${to} (${s.billing === 'per_shift' ? qty + ' shifts' : qty + ' hours'})`.slice(0, 200), qty, unit_price: Number(s.rate), tax_rate: vat }], 'unit_price') });
    await c.query('UPDATE invoices SET site_id = ? WHERE id = ?', [s.id, inv]);
    await c.query('UPDATE shifts SET invoice_id = ? WHERE id IN (?)', [inv, sh.map(x => x.id)]);
    return { invoice_id: inv, qty, shifts: sh.length };
  });
  res.json(out);
}));

/* ======================= REPORTS ======================= */
r.get('/sites/report', S, ah(async (req, res) => {
  const to = req.query.to || today(); const from = req.query.from || `${to.slice(0, 8)}01`;
  const rates = await costRates();
  const sh = await db.query(`${SH_SQL} WHERE DATE(x.start_at) BETWEEN ? AND ? AND x.status IN ('done','on_duty','absent')`, [from, to]);
  const people = new Map(), sites = new Map();
  for (const x of sh) {
    const p = people.get(x.employee_id) || { employee_id: x.employee_id, name: x.employee_name, shifts: 0, hours: 0, absent: 0, sites: new Set() };
    const s = sites.get(x.site_id) || { site_id: x.site_id, name: x.site_name, shifts: 0, hours: 0, absent: 0, labour: 0 };
    if (x.status === 'absent') { p.absent++; s.absent++; } else { const h = shiftHours(x); p.shifts++; p.hours += h; s.shifts++; s.hours += h; s.labour += h * (rates.get(x.employee_id) || 0); p.sites.add(x.site_name); }
    people.set(x.employee_id, p); sites.set(x.site_id, s);
  }
  const all = await db.query('SELECT id, name, contract_id FROM sites');
  for (const st of all) {
    const s = sites.get(st.id) || { site_id: st.id, name: st.name, shifts: 0, hours: 0, absent: 0, labour: 0 };
    const inc = await db.one(`SELECT COALESCE(SUM(subtotal),0) v FROM invoices WHERE kind = 'customer_invoice' AND status IN ('posted','partial','paid') AND invoice_date BETWEEN ? AND ? AND (site_id = ? OR (contract_id IS NOT NULL AND contract_id = ?))`, [from, to, st.id, st.contract_id || 0]);
    const cons = await db.one(`SELECT COALESCE(SUM(-qty * unit_cost),0) v FROM stock_moves WHERE reference = ? AND DATE(created_at) BETWEEN ? AND ?`, [`SITE-${st.id}`, from, to]);
    s.income = round2(inc.v); s.consumables = round2(cons.v); s.labour = round2(s.labour); s.hours = round2(s.hours);
    s.profit = round2(s.income - s.labour - s.consumables);
    if (s.shifts || s.absent || s.income || s.consumables) sites.set(st.id, s); else sites.delete(st.id);
  }
  res.json({ from, to, people: [...people.values()].map(p => ({ ...p, hours: round2(p.hours), sites: [...p.sites].join(', ') })).sort((a, b) => b.hours - a.hours), sites: [...sites.values()] });
}));

module.exports = r;
