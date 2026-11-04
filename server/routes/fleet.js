// Fleet & trips for transport businesses (trucks, buses, taxis, couriers, car hire): vehicles with licence / insurance /
// fitness / permit expiry, fuel with km per litre, trips charged per trip / km / ton / seat / day and invoiced,
// daily takings for taxis and buses, and income vs. costs per vehicle. Each vehicle is also a machine in Maintenance.
const express = require('express');
const db = require('../db');
const stock = require('../services/stock');
const accounting = require('../services/accounting');
const { requirePerm } = require('../auth');
const { ah, bad, notFound, round2, pad, today } = require('../util');

const r = express.Router();
const F = requirePerm('fleet');
const KINDS = ['car', 'bakkie', 'truck', 'bus', 'taxi', 'motorbike', 'trailer', 'other'];
const methodOf = async (c, id) => { const m = await c.one('SELECT * FROM payment_methods WHERE id = ?', [id]); if (!m || m.kind === 'account') throw bad('Choose cash, card, mobile money or bank'); return m; };
const DOCS = [['licence_expiry', 'Licence disc'], ['insurance_expiry', 'Insurance'], ['fitness_expiry', 'Certificate of fitness'], ['permit_expiry', 'Operating permit']];

r.get('/fleet/staff', F, ah(async (req, res) => res.json(await db.query(`SELECT id, first_name, last_name, phone FROM employees WHERE status = 'active' ORDER BY first_name`))));
r.get('/vehicles', F, ah(async (req, res) => {
  const rows = await db.query(`SELECT v.*, CONCAT(e.first_name, ' ', e.last_name) driver_name,
      (SELECT COUNT(*) FROM maintenance_requests m WHERE m.equipment_id = v.equipment_id AND m.status IN ('new','in_progress')) open_repairs
    FROM vehicles v LEFT JOIN employees e ON e.id = v.driver_id ${req.query.all ? '' : 'WHERE v.active = 1'} ORDER BY v.reg_no`);
  const soon = stock.addDays(today(), 30);
  rows.forEach(v => { v.expiring = DOCS.filter(([k]) => v[k] && String(v[k]).slice(0, 10) <= soon).map(([k, l]) => ({ doc: l, date: String(v[k]).slice(0, 10), expired: String(v[k]).slice(0, 10) < today() })); });
  res.json(rows);
}));
function cleanVehicle(b) {
  const v = { reg_no: String(b.reg_no || '').trim().toUpperCase().slice(0, 20) };
  if (!v.reg_no) throw bad('Enter the registration number, e.g. "A 123 BCD"');
  v.name = b.name ? String(b.name).slice(0, 80) : null; v.kind = KINDS.includes(b.kind) ? b.kind : 'bakkie';
  for (const k of ['make', 'model']) v[k] = b[k] ? String(b[k]).slice(0, 40) : null;
  v.year = Number(b.year) > 1950 ? Math.round(Number(b.year)) : null; v.fuel = ['diesel', 'petrol', 'other'].includes(b.fuel) ? b.fuel : 'diesel';
  v.seats = Number(b.seats) > 0 ? Math.round(Number(b.seats)) : null; v.capacity_tons = Number(b.capacity_tons) > 0 ? round2(b.capacity_tons) : null;
  v.odometer = Math.max(0, Math.round(Number(b.odometer) || 0)); v.driver_id = Number(b.driver_id) || null;
  for (const [k] of DOCS) v[k] = b[k] ? String(b[k]).slice(0, 10) : null;
  if (b.status && ['available', 'on_trip', 'in_repair', 'sold'].includes(b.status)) v.status = b.status;
  v.notes = b.notes ? String(b.notes).slice(0, 255) : null; if (b.active !== undefined) v.active = b.active ? 1 : 0;
  return v;
}
r.post('/vehicles', F, ah(async (req, res) => {
  const v = cleanVehicle(req.body);
  if (await db.one('SELECT id FROM vehicles WHERE reg_no = ?', [v.reg_no])) throw bad(`${v.reg_no} is already registered`);
  const id = await db.tx(async c => {
    // the vehicle is also a machine in Maintenance, so services and breakdowns are tracked there
    const eq = await c.query(`INSERT INTO equipment (name, code, category, serial_no, interval_days) VALUES (?, ?, 'Vehicles', ?, ?)`, [`${v.reg_no} ${v.make || ''} ${v.model || ''}`.trim(), v.reg_no, req.body.vin || null, Number(req.body.service_days) || null]);
    return (await c.query('INSERT INTO vehicles SET ?', [{ ...v, equipment_id: eq.insertId }])).insertId;
  });
  res.json({ id });
}));
r.put('/vehicles/:id(\\d+)', F, ah(async (req, res) => {
  const x = await db.one('SELECT * FROM vehicles WHERE id = ?', [req.params.id]);
  if (!x) throw notFound();
  const v = cleanVehicle({ ...x, ...req.body });
  if (await db.one('SELECT id FROM vehicles WHERE reg_no = ? AND id <> ?', [v.reg_no, x.id])) throw bad(`${v.reg_no} is already registered`);
  await db.query('UPDATE vehicles SET ? WHERE id = ?', [v, x.id]);
  if (x.equipment_id) await db.query(`UPDATE equipment SET name = ?, code = ?, active = ? WHERE id = ?`, [`${v.reg_no} ${v.make || ''} ${v.model || ''}`.trim(), v.reg_no, v.status === 'sold' || v.active === 0 ? 0 : 1, x.equipment_id]);
  res.json({ id: x.id });
}));
r.get('/vehicles/:id(\\d+)', F, ah(async (req, res) => {
  const v = await db.one(`SELECT v.*, CONCAT(e.first_name, ' ', e.last_name) driver_name FROM vehicles v LEFT JOIN employees e ON e.id = v.driver_id WHERE v.id = ?`, [req.params.id]);
  if (!v) throw notFound();
  v.fuel_logs = await db.query(`SELECT f.*, CONCAT(e.first_name, ' ', e.last_name) driver_name FROM fuel_logs f LEFT JOIN employees e ON e.id = f.driver_id WHERE f.vehicle_id = ? ORDER BY f.fill_date DESC, f.id DESC LIMIT 50`, [v.id]);
  v.trips = await db.query(`SELECT t.*, p.name customer FROM trips t LEFT JOIN partners p ON p.id = t.partner_id WHERE t.vehicle_id = ? ORDER BY t.trip_date DESC, t.id DESC LIMIT 50`, [v.id]);
  v.takings = await db.query(`SELECT k.*, CONCAT(e.first_name, ' ', e.last_name) driver_name FROM vehicle_takings k LEFT JOIN employees e ON e.id = k.driver_id WHERE k.vehicle_id = ? ORDER BY k.take_date DESC LIMIT 60`, [v.id]);
  v.repairs = v.equipment_id ? await db.query('SELECT id, number, title, status, created_at, parts_cost + labour_cost + external_cost cost FROM maintenance_requests WHERE equipment_id = ? ORDER BY id DESC LIMIT 20', [v.equipment_id]) : [];
  res.json(v);
}));

/* ---------- fuel ---------- */
r.post('/vehicles/:id(\\d+)/fuel', F, ah(async (req, res) => {
  const b = req.body;
  const out = await db.tx(async c => {
    const v = await c.one('SELECT * FROM vehicles WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!v) throw notFound();
    const litres = round2(b.litres), amount = round2(b.amount);
    if (!(litres > 0) || !(amount > 0)) throw bad('Enter litres and the amount paid');
    const odo = b.odometer !== undefined && b.odometer !== '' ? Math.round(Number(b.odometer)) : null;
    if (odo !== null && odo < Number(v.odometer)) throw bad(`The odometer cannot go back – last reading was ${v.odometer} km`);
    // paid now (cash / card / fuel card on a bank account) or on the fuel station's account (supplier bill later)
    let credit;
    if (b.supplier_id) credit = { code: '2000', credit: amount, partner_id: Number(b.supplier_id) };
    else { const m = await methodOf(c, b.method_id); credit = { code: m.account_code, credit: amount }; }
    const ins = await c.query('INSERT INTO fuel_logs (vehicle_id, fill_date, litres, amount, odometer, full_tank, station, driver_id, method_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [v.id, b.date || today(), litres, amount, odo, b.full_tank === undefined ? 1 : (b.full_tank ? 1 : 0), b.station ? String(b.station).slice(0, 80) : null, Number(b.driver_id) || v.driver_id, Number(b.method_id) || null, req.user.id]);
    await accounting.post(c, { date: b.date || null, reference: v.reg_no, memo: `Fuel ${v.reg_no} ${litres} l`, source_type: 'fuel', source_id: ins.insertId, user_id: req.user.id,
      lines: [{ code: '6800', debit: amount, description: `${v.reg_no} ${litres} l` }, credit] });
    if (odo !== null) await c.query('UPDATE vehicles SET odometer = ? WHERE id = ?', [odo, v.id]);
    // km per litre since the previous full tank
    let kml = null;
    if (odo !== null) {
      const prev = await c.one('SELECT odometer FROM fuel_logs WHERE vehicle_id = ? AND id < ? AND odometer IS NOT NULL AND full_tank = 1 ORDER BY id DESC LIMIT 1', [v.id, ins.insertId]);
      if (prev && odo > prev.odometer) kml = round2((odo - prev.odometer) / litres);
    }
    return { id: ins.insertId, km_per_litre: kml };
  });
  res.json(out);
}));

/* ---------- trips ---------- */
const TR_SQL = `SELECT t.*, v.reg_no, v.kind, p.name customer, CONCAT(e.first_name, ' ', e.last_name) driver_name, i.number invoice_number,
    ROUND(t.qty * t.rate, 2) amount, CASE WHEN t.odo_in IS NOT NULL AND t.odo_out IS NOT NULL THEN t.odo_in - t.odo_out END km
  FROM trips t JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN partners p ON p.id = t.partner_id LEFT JOIN employees e ON e.id = t.driver_id LEFT JOIN invoices i ON i.id = t.invoice_id`;
r.get('/trips', F, ah(async (req, res) => {
  const cond = [], args = [];
  const st = req.query.status || 'open';
  if (st === 'open') cond.push(`t.status IN ('planned','on_trip')`); else if (st === 'uninvoiced') cond.push(`t.status = 'done' AND t.invoice_id IS NULL AND t.partner_id IS NOT NULL`); else if (st !== 'all') { cond.push('t.status = ?'); args.push(st); }
  if (req.query.vehicle_id) { cond.push('t.vehicle_id = ?'); args.push(req.query.vehicle_id); }
  res.json(await db.query(`${TR_SQL} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY t.trip_date DESC, t.id DESC LIMIT 1000`, args));
}));
function cleanTrip(b) {
  const v = { vehicle_id: Number(b.vehicle_id) || null };
  if (!v.vehicle_id) throw bad('Choose the vehicle');
  v.driver_id = Number(b.driver_id) || null; v.partner_id = Number(b.partner_id) || null;
  v.trip_date = String(b.trip_date || today()).slice(0, 10); v.return_date = b.return_date ? String(b.return_date).slice(0, 10) : null;
  for (const [k, n] of [['from_place', 120], ['to_place', 120], ['load_desc', 160], ['notes', 255]]) v[k] = b[k] ? String(b[k]).slice(0, n) : null;
  v.charge_by = ['trip', 'km', 'ton', 'seat', 'day'].includes(b.charge_by) ? b.charge_by : 'trip';
  v.qty = round2(b.qty === undefined || b.qty === '' ? 1 : b.qty); v.rate = round2(Math.max(0, Number(b.rate) || 0)); v.costs = round2(Math.max(0, Number(b.costs) || 0));
  return v;
}
r.post('/trips', F, ah(async (req, res) => {
  const v = cleanTrip(req.body);
  const veh = await db.one('SELECT * FROM vehicles WHERE id = ?', [v.vehicle_id]);
  if (!veh) throw bad('Unknown vehicle');
  if (!v.driver_id) v.driver_id = veh.driver_id;
  const ins = await db.query('INSERT INTO trips SET ?', [{ ...v, user_id: req.user.id }]);
  await db.query('UPDATE trips SET number = ? WHERE id = ?', [`TRP/${new Date().getFullYear()}/${pad(ins.insertId, 5)}`, ins.insertId]);
  res.json(await db.one(`${TR_SQL} WHERE t.id = ?`, [ins.insertId]));
}));
r.put('/trips/:id(\\d+)', F, ah(async (req, res) => {
  const t = await db.one('SELECT * FROM trips WHERE id = ?', [req.params.id]);
  if (!t) throw notFound();
  if (t.invoice_id) throw bad('This trip is invoiced');
  await db.query('UPDATE trips SET ? WHERE id = ?', [cleanTrip({ ...t, ...req.body }), t.id]);
  res.json(await db.one(`${TR_SQL} WHERE t.id = ?`, [t.id]));
}));
r.post('/trips/:id(\\d+)/depart', F, ah(async (req, res) => {
  await db.tx(async c => {
    const t = await c.one('SELECT * FROM trips WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!t || t.status !== 'planned') throw bad('Only a planned trip can leave');
    const v = await c.one('SELECT * FROM vehicles WHERE id = ?', [t.vehicle_id]);
    if (v.status === 'on_trip') throw bad(`${v.reg_no} is already out on a trip`);
    if (v.status === 'in_repair') throw bad(`${v.reg_no} is in for repairs`);
    const odo = req.body.odometer !== undefined && req.body.odometer !== '' ? Math.round(Number(req.body.odometer)) : Number(v.odometer);
    if (odo < Number(v.odometer)) throw bad(`The odometer cannot go back – last reading was ${v.odometer} km`);
    await c.query(`UPDATE trips SET status = 'on_trip', odo_out = ? WHERE id = ?`, [odo, t.id]);
    await c.query(`UPDATE vehicles SET status = 'on_trip', odometer = ? WHERE id = ?`, [odo, v.id]);
  });
  res.json(await db.one(`${TR_SQL} WHERE t.id = ?`, [req.params.id]));
}));
r.post('/trips/:id(\\d+)/arrive', F, ah(async (req, res) => {
  await db.tx(async c => {
    const t = await c.one('SELECT * FROM trips WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!t || !['on_trip', 'planned'].includes(t.status)) throw bad('This trip is not on the road');
    const odo = Math.round(Number(req.body.odometer));
    if (!(odo > 0)) throw bad('Enter the odometer reading on return');
    if (t.odo_out !== null && odo < t.odo_out) throw bad(`Return reading is lower than when it left (${t.odo_out} km)`);
    const sets = { status: 'done', odo_in: odo, return_date: req.body.return_date || today(), costs: req.body.costs !== undefined ? round2(req.body.costs) : t.costs };
    if (t.charge_by === 'km' && t.odo_out !== null && (req.body.qty === undefined || req.body.qty === '')) sets.qty = odo - t.odo_out;
    if (req.body.qty !== undefined && req.body.qty !== '') sets.qty = round2(req.body.qty);
    await c.query('UPDATE trips SET ? WHERE id = ?', [sets, t.id]);
    await c.query(`UPDATE vehicles SET status = 'available', odometer = GREATEST(odometer, ?) WHERE id = ?`, [odo, t.vehicle_id]);
  });
  res.json(await db.one(`${TR_SQL} WHERE t.id = ?`, [req.params.id]));
}));
r.post('/trips/:id(\\d+)/cancel', F, ah(async (req, res) => {
  const t = await db.one('SELECT * FROM trips WHERE id = ?', [req.params.id]);
  if (!t || !['planned', 'on_trip'].includes(t.status)) throw bad('Only an open trip can be cancelled');
  await db.query(`UPDATE trips SET status = 'cancelled' WHERE id = ?`, [t.id]);
  if (t.status === 'on_trip') await db.query(`UPDATE vehicles SET status = 'available' WHERE id = ?`, [t.vehicle_id]);
  res.json({ ok: true });
}));
// one invoice for a customer's finished trips
r.post('/trips/invoice', requirePerm('invoicing'), ah(async (req, res) => {
  const biz = require('./business');
  const out = await db.tx(async c => {
    const ids = (req.body.trip_ids || []).map(Number).filter(Boolean);
    if (!ids.length) throw bad('Tick the trips to invoice');
    const ts = await c.query(`${TR_SQL} WHERE t.id IN (?) FOR UPDATE`, [ids]);
    if (ts.some(t => t.status !== 'done' || t.invoice_id)) throw bad('Only finished trips that are not yet invoiced');
    const cust = [...new Set(ts.map(t => t.partner_id))];
    if (cust.length !== 1 || !cust[0]) throw bad('Choose trips of one customer');
    const vat = Number(((await db.getSetting('company', {})) || {}).default_vat ?? 15);
    const unit = { trip: 'trip', km: 'km', ton: 'ton', seat: 'seat', day: 'day' };
    const lines = ts.map(t => ({ description: `${t.number} ${t.trip_date ? String(t.trip_date).slice(0, 10) : ''} ${t.from_place || ''} → ${t.to_place || ''} (${t.reg_no})${t.load_desc ? ' – ' + t.load_desc : ''}${t.charge_by !== 'trip' ? ` · ${t.qty} ${unit[t.charge_by]}` : ''}`.slice(0, 200),
      qty: Number(t.qty), unit_price: Number(t.rate), tax_rate: Number(req.body.tax_rate ?? vat), account_code: '4800' }));
    const inv = await biz.createInvoice(c, req.user, { kind: 'customer_invoice', partner_id: cust[0], due_date: stock.addDays(today(), 30), notes: `Transport – ${ts.length} trip(s)`, lines: biz.calcLines(lines, 'unit_price') });
    await c.query('UPDATE trips SET invoice_id = ? WHERE id IN (?)', [inv, ids]);
    return { invoice_id: inv };
  });
  res.json(out);
}));

/* ---------- daily takings (taxis, buses) ---------- */
r.post('/vehicles/:id(\\d+)/takings', F, ah(async (req, res) => {
  const b = req.body;
  await db.tx(async c => {
    const v = await c.one('SELECT * FROM vehicles WHERE id = ?', [req.params.id]);
    if (!v) throw notFound();
    const amt = round2(b.amount); if (!(amt > 0)) throw bad('Enter the amount handed in');
    const m = await methodOf(c, b.method_id);
    const date = b.date || today(); const drv = Number(b.driver_id) || v.driver_id;
    if (await c.one('SELECT id FROM vehicle_takings WHERE vehicle_id = ? AND take_date = ? AND driver_id <=> ?', [v.id, date, drv])) throw bad(`Takings for ${v.reg_no} on ${date} are already recorded`);
    const ins = await c.query('INSERT INTO vehicle_takings (vehicle_id, take_date, driver_id, amount, method_id, trips, notes, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [v.id, date, drv, amt, m.id, Number(b.trips) || null, b.notes ? String(b.notes).slice(0, 160) : null, req.user.id]);
    await accounting.post(c, { date, reference: v.reg_no, memo: `Takings ${v.reg_no} ${date}`, source_type: 'vehicle_takings', source_id: ins.insertId, user_id: req.user.id,
      lines: [{ code: m.account_code, debit: amt }, { code: '4800', credit: amt, description: `${v.reg_no} takings` }] });
    if (b.odometer) await c.query('UPDATE vehicles SET odometer = GREATEST(odometer, ?) WHERE id = ?', [Math.round(Number(b.odometer)), v.id]);
  });
  res.json({ ok: true });
}));

/* ---------- per vehicle report ---------- */
r.get('/fleet/report', F, ah(async (req, res) => {
  const to = req.query.to || today(); const from = req.query.from || `${to.slice(0, 8)}01`;
  const vs = await db.query('SELECT * FROM vehicles WHERE active = 1 ORDER BY reg_no');
  const out = [];
  for (const v of vs) {
    const fuel = await db.one('SELECT COALESCE(SUM(litres),0) l, COALESCE(SUM(amount),0) a, MIN(odometer) o1, MAX(odometer) o2 FROM fuel_logs WHERE vehicle_id = ? AND fill_date BETWEEN ? AND ?', [v.id, from, to]);
    const tr = await db.one(`SELECT COUNT(*) n, COALESCE(SUM(qty * rate),0) income, COALESCE(SUM(costs),0) costs, COALESCE(SUM(CASE WHEN odo_in IS NOT NULL AND odo_out IS NOT NULL THEN odo_in - odo_out END),0) km
      FROM trips WHERE vehicle_id = ? AND status = 'done' AND trip_date BETWEEN ? AND ?`, [v.id, from, to]);
    const tk = await db.one('SELECT COALESCE(SUM(amount),0) a FROM vehicle_takings WHERE vehicle_id = ? AND take_date BETWEEN ? AND ?', [v.id, from, to]);
    const rp = v.equipment_id ? await db.one(`SELECT COALESCE(SUM(parts_cost + labour_cost + external_cost),0) a FROM maintenance_requests WHERE equipment_id = ? AND status = 'done' AND DATE(done_at) BETWEEN ? AND ?`, [v.equipment_id, from, to]) : { a: 0 };
    const km = Math.max(Number(tr.km), Number(fuel.o2 || 0) - Number(fuel.o1 || 0));
    const income = round2(Number(tr.income) + Number(tk.a)), costs = round2(Number(fuel.a) + Number(tr.costs) + Number(rp.a));
    out.push({ vehicle_id: v.id, reg_no: v.reg_no, kind: v.kind, trips: Number(tr.n), km, litres: round2(fuel.l), km_per_litre: Number(fuel.l) && km ? round2(km / Number(fuel.l)) : null,
      fuel: round2(fuel.a), trip_costs: round2(tr.costs), repairs: round2(rp.a), income, profit: round2(income - costs), per_km: km ? round2(costs / km) : null });
  }
  res.json({ from, to, rows: out });
}));

module.exports = r;
