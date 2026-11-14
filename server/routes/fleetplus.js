// Fleet management (adds to routes/fleet.js): service schedules and service / repair records, driver licences,
// pool-vehicle requests with approval and logbook, fines / accidents / insurance claims, a "due" list and cost per km
// with fuel efficiency (and depreciation when the vehicle is in the asset register).
const express = require('express');
const db = require('../db');
const stock = require('../services/stock');
const accounting = require('../services/accounting');
const { requirePerm } = require('../auth');
const { ah, bad, notFound, round2, pad, today } = require('../util');

const r = express.Router();
const F = requirePerm('fleet');
const can = (u, p) => u.permissions.includes('*') || u.permissions.includes(p);
const r2 = n => round2(Number(n) || 0);
const methodOf = async (c, id) => { const m = await c.one('SELECT * FROM payment_methods WHERE id = ?', [id]); if (!m || m.kind === 'account') throw bad('Choose cash, card, mobile money or bank'); return m; };
const dt = v => { if (!v) return null; const d = new Date(v); if (isNaN(d)) throw bad('A date / time is not valid'); return d.toISOString().slice(0, 19).replace('T', ' '); };

/* ---------------- service schedule ---------------- */
function schedule(v) {
  const next_km = v.service_interval_km ? Number(v.last_service_km || 0) + Number(v.service_interval_km) : null;
  const next_date = v.service_interval_months && v.last_service_date ? (() => { const d = new Date(String(v.last_service_date).slice(0, 10) + 'T12:00:00'); d.setMonth(d.getMonth() + Number(v.service_interval_months)); return d.toISOString().slice(0, 10); })() : null;
  const km_left = next_km !== null ? next_km - Number(v.odometer) : null;
  const due = (km_left !== null && km_left <= 500) || (next_date && next_date <= stock.addDays(today(), 14));
  const overdue = (km_left !== null && km_left <= 0) || (next_date && next_date < today());
  return { next_km, next_date, km_left, due: !!due, overdue: !!overdue };
}
r.put('/vehicles/:id(\\d+)/setup', F, ah(async (req, res) => {
  const b = req.body || {}, v = {};
  for (const k of ['service_interval_km', 'service_interval_months', 'last_service_km']) if (b[k] !== undefined) v[k] = b[k] === '' || b[k] === null ? null : Math.max(0, Math.round(Number(b[k])));
  if (b.last_service_date !== undefined) v.last_service_date = b.last_service_date || null;
  for (const [k, n] of [['vin', 40], ['fuel_card', 40], ['department', 80]]) if (b[k] !== undefined) v[k] = b[k] ? String(b[k]).slice(0, n) : null;
  if (b.pool !== undefined) v.pool = b.pool ? 1 : 0;
  if (b.expected_km_per_litre !== undefined) v.expected_km_per_litre = b.expected_km_per_litre === '' || b.expected_km_per_litre === null ? null : r2(b.expected_km_per_litre);
  if (!Object.keys(v).length) throw bad('Nothing to change');
  const x = await db.query('UPDATE vehicles SET ? WHERE id = ?', [v, req.params.id]); if (!x.affectedRows) throw notFound();
  res.json({ ok: true });
}));
r.post('/vehicles/:id(\\d+)/services', F, ah(async (req, res) => {
  const b = req.body || {};
  const out = await db.tx(async c => {
    const v = await c.one('SELECT * FROM vehicles WHERE id = ? FOR UPDATE', [req.params.id]); if (!v) throw notFound();
    const kind = ['service', 'repair', 'tyres', 'battery', 'inspection', 'accident_repair', 'other'].includes(b.kind) ? b.kind : 'service';
    const cost = r2(b.cost), date = String(b.date || today()).slice(0, 10);
    if (date > today()) throw bad('The date cannot be in the future');
    const odo = b.odometer !== undefined && b.odometer !== '' ? Math.round(Number(b.odometer)) : null;
    if (odo !== null && odo < 0) throw bad('Odometer not valid');
    let credit = null;
    if (cost > 0) {
      if (b.supplier_id) credit = { code: '2000', credit: cost, partner_id: Number(b.supplier_id) };
      else if (b.method_id) credit = { code: (await methodOf(c, b.method_id)).account_code, credit: cost };
      else if (!b.on_bill) throw bad('Say how it was paid: paid now, on the workshop\'s account, or already on a supplier bill');
    }
    const id = (await c.query('INSERT INTO vehicle_services (vehicle_id, service_date, odometer, kind, description, workshop, supplier_id, cost, method_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [v.id, date, odo, kind, b.description ? String(b.description).slice(0, 255) : null, b.workshop ? String(b.workshop).slice(0, 120) : null, Number(b.supplier_id) || null, cost, Number(b.method_id) || null, req.user.id])).insertId;
    if (credit) await accounting.post(c, { date, reference: v.reg_no, memo: `${kind.replace('_', ' ')} ${v.reg_no}${b.description ? ' – ' + b.description : ''}`.slice(0, 250), source_type: 'vehicle_service', source_id: id, user_id: req.user.id,
      lines: [{ code: '6610', debit: cost, description: v.reg_no }, credit] });
    if (odo !== null && odo > Number(v.odometer)) await c.query('UPDATE vehicles SET odometer = ? WHERE id = ?', [odo, v.id]);
    if (kind === 'service') await c.query('UPDATE vehicles SET last_service_date = ?, last_service_km = COALESCE(?, odometer) WHERE id = ?', [date, odo, v.id]);
    return { id };
  });
  res.json(out);
}));

/* ---------------- drivers ---------------- */
r.get('/fleet/drivers', F, ah(async (req, res) => {
  const rows = await db.query(`SELECT e.id employee_id, e.first_name, e.last_name, e.phone, d.licence_no, d.licence_codes, d.licence_expiry, d.prdp_expiry, d.notes,
      (SELECT GROUP_CONCAT(v.reg_no) FROM vehicles v WHERE v.driver_id = e.id AND v.active = 1) vehicles,
      (SELECT COUNT(*) FROM vehicle_incidents i WHERE i.driver_id = e.id) incidents
    FROM employees e LEFT JOIN fleet_drivers d ON d.employee_id = e.id WHERE e.status = 'active' AND (d.employee_id IS NOT NULL OR EXISTS (SELECT 1 FROM vehicles v WHERE v.driver_id = e.id)) ORDER BY e.first_name`);
  res.json(rows);
}));
r.put('/fleet/drivers/:id(\\d+)', F, ah(async (req, res) => {
  const b = req.body || {};
  if (!await db.one('SELECT id FROM employees WHERE id = ?', [req.params.id])) throw notFound('Employee');
  const v = { employee_id: Number(req.params.id), licence_no: b.licence_no || null, licence_codes: b.licence_codes ? String(b.licence_codes).toUpperCase().slice(0, 40) : null,
    licence_expiry: b.licence_expiry || null, prdp_expiry: b.prdp_expiry || null, notes: b.notes ? String(b.notes).slice(0, 255) : null };
  await db.query('INSERT INTO fleet_drivers SET ? ON DUPLICATE KEY UPDATE licence_no = VALUES(licence_no), licence_codes = VALUES(licence_codes), licence_expiry = VALUES(licence_expiry), prdp_expiry = VALUES(prdp_expiry), notes = VALUES(notes)', [v]);
  res.json({ ok: true });
}));

/* ---------------- pool vehicle requests ---------------- */
const REQ_SQL = `SELECT q.*, u.name requester, v.reg_no, v.make, v.model, CONCAT(e.first_name, ' ', e.last_name) driver_name, du.name decided_by_name,
    CASE WHEN q.odo_in IS NOT NULL AND q.odo_out IS NOT NULL THEN q.odo_in - q.odo_out END km
  FROM vehicle_requests q JOIN users u ON u.id = q.user_id LEFT JOIN vehicles v ON v.id = q.vehicle_id LEFT JOIN employees e ON e.id = q.driver_id LEFT JOIN users du ON du.id = q.decided_by`;
r.get('/fleet/requests', ah(async (req, res) => {
  const all = can(req.user, 'fleet'), where = [], args = [];
  if (!all) { where.push('q.user_id = ?'); args.push(req.user.id); }
  if (req.query.status === 'open') where.push(`q.status IN ('requested','approved','out')`); else if (req.query.status) { where.push('q.status = ?'); args.push(req.query.status); }
  res.json(await db.query(`${REQ_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY q.depart_at DESC LIMIT 500`, args));
}));
r.post('/fleet/requests', ah(async (req, res) => {
  const b = req.body || {};
  const purpose = String(b.purpose || '').trim(); if (purpose.length < 5) throw bad('Say what the vehicle is needed for');
  const dep = dt(b.depart_at), ret = dt(b.return_at); if (!dep || !ret) throw bad('Give the departure and return date and time'); if (ret <= dep) throw bad('The return must be after the departure');
  const ins = await db.query('INSERT INTO vehicle_requests (user_id, department, purpose, destination, depart_at, return_at, passengers) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [req.user.id, b.department || null, purpose.slice(0, 255), b.destination ? String(b.destination).slice(0, 160) : null, dep, ret, Math.max(1, Math.round(Number(b.passengers) || 1))]);
  const number = `VR/${new Date().getFullYear()}/${pad(ins.insertId, 5)}`;
  await db.query('UPDATE vehicle_requests SET number = ? WHERE id = ?', [number, ins.insertId]);
  res.json({ id: ins.insertId, number });
}));
r.get('/fleet/available', F, ah(async (req, res) => {
  // vehicles free for a time window (not booked, not in repair)
  const dep = dt(req.query.from), ret = dt(req.query.to);
  const vs = await db.query(`SELECT v.id, v.reg_no, v.make, v.model, v.kind, v.seats, v.pool, v.status FROM vehicles v WHERE v.active = 1 AND v.status <> 'in_repair' AND v.status <> 'sold'
    AND NOT EXISTS (SELECT 1 FROM vehicle_requests q WHERE q.vehicle_id = v.id AND q.status IN ('approved','out') AND q.depart_at < ? AND q.return_at > ?) ORDER BY v.pool DESC, v.reg_no`, [ret, dep]);
  res.json(vs);
}));
r.post('/fleet/requests/:id(\\d+)/decide', F, ah(async (req, res) => {
  const b = req.body || {};
  await db.tx(async c => {
    const q = await c.one('SELECT * FROM vehicle_requests WHERE id = ? FOR UPDATE', [req.params.id]); if (!q) throw notFound();
    if (q.status !== 'requested') throw bad('This request has already been decided');
    if (q.user_id === req.user.id && !req.user.permissions.includes('*')) throw bad('Someone else must approve your own request');
    if (!b.approve) { await c.query(`UPDATE vehicle_requests SET status = 'rejected', decided_by = ?, decision_note = ? WHERE id = ?`, [req.user.id, b.note || null, q.id]); return; }
    const v = await c.one('SELECT * FROM vehicles WHERE id = ? AND active = 1', [b.vehicle_id]); if (!v) throw bad('Choose the vehicle');
    if (v.status === 'in_repair') throw bad(`${v.reg_no} is in repair`);
    if (v.seats && Number(v.seats) < q.passengers) throw bad(`${v.reg_no} has ${v.seats} seats – ${q.passengers} people are travelling`);
    const clash = await c.one(`SELECT number FROM vehicle_requests WHERE vehicle_id = ? AND id <> ? AND status IN ('approved','out') AND depart_at < ? AND return_at > ?`, [v.id, q.id, q.return_at, q.depart_at]);
    if (clash) throw bad(`${v.reg_no} is already booked then (${clash.number})`);
    if (b.driver_id) {
      const d = await c.one('SELECT licence_expiry FROM fleet_drivers WHERE employee_id = ?', [b.driver_id]);
      if (d && d.licence_expiry && String(d.licence_expiry) < String(q.return_at).slice(0, 10)) throw bad('That driver\'s licence will have expired – choose another driver');
    }
    await c.query(`UPDATE vehicle_requests SET status = 'approved', vehicle_id = ?, driver_id = ?, decided_by = ?, decision_note = ? WHERE id = ?`, [v.id, Number(b.driver_id) || null, req.user.id, b.note || null, q.id]);
  });
  res.json({ ok: true });
}));
r.post('/fleet/requests/:id(\\d+)/out', F, ah(async (req, res) => {
  await db.tx(async c => {
    const q = await c.one('SELECT * FROM vehicle_requests WHERE id = ? FOR UPDATE', [req.params.id]); if (!q) throw notFound();
    if (q.status !== 'approved') throw bad('Only an approved request can go out');
    const v = await c.one('SELECT * FROM vehicles WHERE id = ? FOR UPDATE', [q.vehicle_id]);
    const odo = Math.round(Number((req.body || {}).odo_out ?? v.odometer));
    if (odo < Number(v.odometer)) throw bad(`The odometer cannot go back – it shows ${v.odometer} km`);
    await c.query(`UPDATE vehicle_requests SET status = 'out', odo_out = ?, out_at = NOW() WHERE id = ?`, [odo, q.id]);
    await c.query(`UPDATE vehicles SET status = 'on_trip', odometer = ? WHERE id = ?`, [odo, v.id]);
  });
  res.json({ ok: true });
}));
r.post('/fleet/requests/:id(\\d+)/in', F, ah(async (req, res) => {
  const out = await db.tx(async c => {
    const q = await c.one('SELECT * FROM vehicle_requests WHERE id = ? FOR UPDATE', [req.params.id]); if (!q) throw notFound();
    if (q.status !== 'out') throw bad('This vehicle is not out on this request');
    const odo = Math.round(Number((req.body || {}).odo_in));
    if (!(odo >= q.odo_out)) throw bad(`The odometer on return must be at least ${q.odo_out} km`);
    await c.query(`UPDATE vehicle_requests SET status = 'returned', odo_in = ?, in_at = NOW() WHERE id = ?`, [odo, q.id]);
    await c.query(`UPDATE vehicles SET status = 'available', odometer = GREATEST(odometer, ?) WHERE id = ?`, [odo, q.vehicle_id]);
    return { km: odo - q.odo_out };
  });
  res.json(out);
}));
r.post('/fleet/requests/:id(\\d+)/cancel', ah(async (req, res) => {
  const q = await db.one('SELECT * FROM vehicle_requests WHERE id = ?', [req.params.id]); if (!q) throw notFound();
  if (q.user_id !== req.user.id && !can(req.user, 'fleet')) throw bad('Only the person who asked, or the fleet office, can cancel it');
  if (!['requested', 'approved'].includes(q.status)) throw bad('It can no longer be cancelled');
  await db.query(`UPDATE vehicle_requests SET status = 'cancelled' WHERE id = ?`, [q.id]);
  res.json({ ok: true });
}));

/* ---------------- fines, accidents, claims ---------------- */
r.post('/vehicles/:id(\\d+)/incidents', F, ah(async (req, res) => {
  const b = req.body || {};
  const out = await db.tx(async c => {
    const v = await c.one('SELECT * FROM vehicles WHERE id = ?', [req.params.id]); if (!v) throw notFound();
    const kind = ['fine', 'accident', 'theft', 'damage', 'breakdown'].includes(b.kind) ? b.kind : null; if (!kind) throw bad('Choose what happened');
    const desc = String(b.description || '').trim(); if (!desc) throw bad('Describe what happened');
    const amt = r2(b.amount);
    const id = (await c.query(`INSERT INTO vehicle_incidents (vehicle_id, driver_id, incident_date, kind, description, place, reference, amount, paid, method_id, recover_from_driver, claim_no, claim_status, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [v.id, Number(b.driver_id) || v.driver_id || null, String(b.date || today()).slice(0, 10), kind, desc.slice(0, 255), b.place || null, b.reference || null, amt, b.method_id && amt > 0 ? 1 : 0, Number(b.method_id) || null,
        b.recover_from_driver ? 1 : 0, b.claim_no || null, b.claim_no ? 'lodged' : 'none', req.user.id])).insertId;
    if (b.method_id && amt > 0) {
      const m = await methodOf(c, b.method_id);
      await accounting.post(c, { date: String(b.date || today()).slice(0, 10), reference: b.reference || v.reg_no, memo: `${kind} ${v.reg_no}: ${desc}`.slice(0, 250), source_type: 'vehicle_incident', source_id: id, user_id: req.user.id,
        lines: [{ code: kind === 'fine' ? '6490' : '6610', debit: amt, description: v.reg_no }, { code: m.account_code, credit: amt }] });
    }
    if (['accident', 'theft'].includes(kind) && b.off_road) await c.query(`UPDATE vehicles SET status = 'in_repair' WHERE id = ?`, [v.id]);
    return { id };
  });
  res.json(out);
}));
r.put('/fleet/incidents/:id(\\d+)', F, ah(async (req, res) => {
  const b = req.body || {};
  await db.tx(async c => {
    const i = await c.one('SELECT i.*, v.reg_no FROM vehicle_incidents i JOIN vehicles v ON v.id = i.vehicle_id WHERE i.id = ? FOR UPDATE', [req.params.id]); if (!i) throw notFound();
    const v = {};
    if (b.claim_no !== undefined) { v.claim_no = b.claim_no || null; if (b.claim_no && i.claim_status === 'none') v.claim_status = 'lodged'; }
    if (b.claim_status !== undefined) {
      if (!['none', 'lodged', 'paid', 'rejected'].includes(b.claim_status)) throw bad('Unknown claim status');
      if (b.claim_status === 'paid' && i.claim_status !== 'paid') {
        const amt = r2(b.claim_amount); if (!(amt > 0)) throw bad('Enter what the insurer paid');
        const m = await methodOf(c, b.method_id);
        await accounting.post(c, { reference: i.claim_no || i.reg_no, memo: `Insurance claim paid – ${i.reg_no} ${i.kind}`, source_type: 'vehicle_incident', source_id: i.id, user_id: req.user.id,
          lines: [{ code: m.account_code, debit: amt }, { code: '4200', credit: amt, description: 'Insurance claim' }] });
        v.claim_amount = amt;
      }
      v.claim_status = b.claim_status;
    }
    if (b.status !== undefined) v.status = b.status === 'closed' ? 'closed' : 'open';
    if (Object.keys(v).length) await c.query('UPDATE vehicle_incidents SET ? WHERE id = ?', [v, i.id]);
  });
  res.json({ ok: true });
}));
r.get('/fleet/incidents', F, ah(async (req, res) => res.json(await db.query(`SELECT i.*, v.reg_no, CONCAT(e.first_name, ' ', e.last_name) driver_name FROM vehicle_incidents i JOIN vehicles v ON v.id = i.vehicle_id
  LEFT JOIN employees e ON e.id = i.driver_id ${req.query.open ? `WHERE i.status = 'open'` : ''} ORDER BY i.incident_date DESC, i.id DESC LIMIT 500`))));

/* ---------------- one vehicle: everything added here ---------------- */
r.get('/vehicles/:id(\\d+)/more', F, ah(async (req, res) => {
  const v = await db.one('SELECT * FROM vehicles WHERE id = ?', [req.params.id]); if (!v) throw notFound();
  const services = await db.query('SELECT s.*, p.name supplier_name FROM vehicle_services s LEFT JOIN partners p ON p.id = s.supplier_id WHERE s.vehicle_id = ? ORDER BY s.service_date DESC, s.id DESC LIMIT 100', [v.id]);
  const incidents = await db.query(`SELECT i.*, CONCAT(e.first_name, ' ', e.last_name) driver_name FROM vehicle_incidents i LEFT JOIN employees e ON e.id = i.driver_id WHERE i.vehicle_id = ? ORDER BY i.incident_date DESC LIMIT 100`, [v.id]);
  const requests = await db.query(`${REQ_SQL} WHERE q.vehicle_id = ? ORDER BY q.depart_at DESC LIMIT 50`, [v.id]);
  const asset = v.asset_id ? await db.one('SELECT id, asset_no, cost, accum_dep, ROUND(cost - accum_dep, 2) nbv, in_service_date FROM fixed_assets WHERE id = ?', [v.asset_id]) : null;
  res.json({ schedule: schedule(v), setup: { service_interval_km: v.service_interval_km, service_interval_months: v.service_interval_months, last_service_km: v.last_service_km, last_service_date: v.last_service_date, vin: v.vin, fuel_card: v.fuel_card, pool: v.pool, department: v.department, expected_km_per_litre: v.expected_km_per_litre }, services, incidents, requests, asset });
}));

/* ---------------- what needs attention ---------------- */
r.get('/fleet/due', F, ah(async (req, res) => {
  const soon = stock.addDays(today(), 30);
  const vs = await db.query('SELECT * FROM vehicles WHERE active = 1 ORDER BY reg_no');
  const items = [];
  for (const v of vs) {
    const s = schedule(v);
    if (s.due) items.push({ vehicle_id: v.id, reg_no: v.reg_no, what: 'Service', when: [s.next_km !== null ? `at ${s.next_km.toLocaleString('en-US')} km (${s.km_left.toLocaleString('en-US')} km left)` : '', s.next_date ? `by ${s.next_date}` : ''].filter(Boolean).join(' or '), overdue: s.overdue });
    for (const [k, l] of [['licence_expiry', 'Licence disc'], ['insurance_expiry', 'Insurance'], ['fitness_expiry', 'Certificate of fitness'], ['permit_expiry', 'Operating permit']])
      if (v[k] && String(v[k]) <= soon) items.push({ vehicle_id: v.id, reg_no: v.reg_no, what: l, when: String(v[k]).slice(0, 10), overdue: String(v[k]) < today() });
  }
  const drivers = await db.query(`SELECT d.*, CONCAT(e.first_name, ' ', e.last_name) name FROM fleet_drivers d JOIN employees e ON e.id = d.employee_id WHERE e.status = 'active' AND ((d.licence_expiry IS NOT NULL AND d.licence_expiry <= ?) OR (d.prdp_expiry IS NOT NULL AND d.prdp_expiry <= ?))`, [soon, soon]);
  for (const d of drivers) {
    if (d.licence_expiry && String(d.licence_expiry) <= soon) items.push({ driver: d.name, what: 'Driving licence', when: String(d.licence_expiry), overdue: String(d.licence_expiry) < today() });
    if (d.prdp_expiry && String(d.prdp_expiry) <= soon) items.push({ driver: d.name, what: 'Professional driving permit', when: String(d.prdp_expiry), overdue: String(d.prdp_expiry) < today() });
  }
  const pending = await db.one(`SELECT COUNT(*) n FROM vehicle_requests WHERE status = 'requested'`);
  const claims = await db.one(`SELECT COUNT(*) n FROM vehicle_incidents WHERE claim_status = 'lodged'`);
  res.json({ items: items.sort((a, b) => (b.overdue - a.overdue) || String(a.when).localeCompare(String(b.when))), pending_requests: Number(pending.n), open_claims: Number(claims.n) });
}));

/* ---------------- cost per km ---------------- */
r.get('/fleet/costs', F, ah(async (req, res) => {
  const to = req.query.to || today(), from = req.query.from || `${to.slice(0, 4)}-01-01`;
  const vs = await db.query('SELECT * FROM vehicles WHERE active = 1 OR id IN (SELECT vehicle_id FROM fuel_logs WHERE fill_date BETWEEN ? AND ?) ORDER BY reg_no', [from, to]);
  const rows = [];
  for (const v of vs) {
    const f = await db.one('SELECT COALESCE(SUM(litres),0) l, COALESCE(SUM(amount),0) a, MIN(odometer) o1, MAX(odometer) o2 FROM fuel_logs WHERE vehicle_id = ? AND fill_date BETWEEN ? AND ?', [v.id, from, to]);
    const sv = await db.one('SELECT COALESCE(SUM(cost),0) a, MIN(odometer) o1, MAX(odometer) o2 FROM vehicle_services WHERE vehicle_id = ? AND service_date BETWEEN ? AND ?', [v.id, from, to]);
    const rp = v.equipment_id ? await db.one(`SELECT COALESCE(SUM(parts_cost + labour_cost + external_cost),0) a FROM maintenance_requests WHERE equipment_id = ? AND status = 'done' AND DATE(done_at) BETWEEN ? AND ?`, [v.equipment_id, from, to]) : { a: 0 };
    const inc = await db.one(`SELECT COALESCE(SUM(CASE WHEN kind = 'fine' THEN amount ELSE 0 END),0) fines, COALESCE(SUM(CASE WHEN kind <> 'fine' THEN amount ELSE 0 END),0) dmg, COUNT(*) n FROM vehicle_incidents WHERE vehicle_id = ? AND incident_date BETWEEN ? AND ?`, [v.id, from, to]);
    const tr = await db.one(`SELECT COALESCE(SUM(odo_in - odo_out),0) km FROM trips WHERE vehicle_id = ? AND status = 'done' AND odo_in IS NOT NULL AND trip_date BETWEEN ? AND ?`, [v.id, from, to]);
    const rq = await db.one(`SELECT COALESCE(SUM(odo_in - odo_out),0) km FROM vehicle_requests WHERE vehicle_id = ? AND status = 'returned' AND DATE(depart_at) BETWEEN ? AND ?`, [v.id, from, to]);
    const dep = v.asset_id ? await db.one('SELECT COALESCE(SUM(amount),0) a FROM asset_depreciation WHERE asset_id = ? AND period BETWEEN ? AND ?', [v.asset_id, from.slice(0, 7), to.slice(0, 7)]) : { a: 0 };
    const odos = [f.o1, f.o2, sv.o1, sv.o2].filter(x => x !== null && x !== undefined).map(Number);
    const km = Math.max(Number(tr.km) + Number(rq.km), odos.length ? Math.max(...odos) - Math.min(...odos) : 0);
    // fuel efficiency: the first fill in the period was burnt before the km measured from it, so it is left out
    const first = await db.one('SELECT litres FROM fuel_logs WHERE vehicle_id = ? AND fill_date BETWEEN ? AND ? AND odometer IS NOT NULL ORDER BY fill_date, id LIMIT 1', [v.id, from, to]);
    const fills = await db.one('SELECT COUNT(*) n FROM fuel_logs WHERE vehicle_id = ? AND fill_date BETWEEN ? AND ? AND odometer IS NOT NULL', [v.id, from, to]);
    const effL = Number(fills.n) > 1 && first ? Number(f.l) - Number(first.litres) : Number(f.l);
    const kml = effL > 0 && km ? r2(km / effL) : null;
    const total = r2(Number(f.a) + Number(sv.a) + Number(rp.a) + Number(inc.fines) + Number(inc.dmg) + Number(dep.a));
    rows.push({ vehicle_id: v.id, reg_no: v.reg_no, kind: v.kind, km, litres: r2(f.l), km_per_litre: kml, expected_km_per_litre: v.expected_km_per_litre ? Number(v.expected_km_per_litre) : null,
      fuel_flag: !!(kml && v.expected_km_per_litre && kml < Number(v.expected_km_per_litre) * 0.8),
      fuel: r2(f.a), servicing: r2(Number(sv.a) + Number(rp.a)), fines: r2(inc.fines), damage: r2(inc.dmg), depreciation: r2(dep.a), incidents: Number(inc.n), total, per_km: km ? r2(total / km) : null });
  }
  res.json({ from, to, rows });
}));

module.exports = r;
