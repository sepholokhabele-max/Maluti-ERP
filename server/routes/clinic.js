// Patients & dispensing for clinics, surgeries, pharmacies, dentists, optometrists and vets: patient files with allergies
// and medical aid, a waiting queue, consultation notes with vital signs and diagnosis, services and medicines prescribed,
// allergy and expired-stock checks when dispensing, billing to the patient or the medical aid (with co-payment),
// medicine labels, prescriptions and sick notes, a dispensing register and medical-aid claims.
const express = require('express');
const db = require('../db');
const receipts = require('../services/receipts');
const { requirePerm } = require('../auth');
const { ah, bad, notFound, round2, pad, today } = require('../util');

const r = express.Router();
const C = requirePerm('patients');
const s = (x, n) => x === undefined || x === null || String(x).trim() === '' ? null : String(x).trim().slice(0, n);
const int = x => x === undefined || x === null || x === '' ? null : Math.round(Number(x));
const dec = x => x === undefined || x === null || x === '' ? null : round2(x);
const age = dob => { if (!dob) return null; const b = new Date(String(dob).slice(0, 10) + 'T12:00:00'), n = new Date(); let a = n.getFullYear() - b.getFullYear(); if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--; return a; };

/* ---------- allergy check ---------- */
// medicines that belong to a class patients are often allergic to
const CLASSES = {
  penicillin: ['penicillin', 'amoxicillin', 'amoxil', 'ampicillin', 'cloxacillin', 'flucloxacillin', 'augmentin', 'co-amoxiclav', 'benzathine', 'piperacillin'],
  sulfa: ['sulfa', 'sulpha', 'sulfamethoxazole', 'cotrimoxazole', 'co-trimoxazole', 'bactrim', 'sulfadiazine', 'sulfasalazine'],
  nsaid: ['ibuprofen', 'brufen', 'diclofenac', 'voltaren', 'aspirin', 'disprin', 'naproxen', 'indomethacin', 'mefenamic', 'ponstan', 'piroxicam', 'meloxicam'],
  aspirin: ['aspirin', 'disprin', 'ecotrin'],
  cephalosporin: ['cef', 'ceph', 'ceftriaxone', 'cefuroxime', 'cephalexin', 'cefalexin'],
  codeine: ['codeine', 'tramadol', 'morphine', 'pethidine']
};
function allergyHit(allergies, name) {
  if (!allergies) return null;
  const n = String(name).toLowerCase();
  for (const raw of String(allergies).toLowerCase().split(/[,;/\n]+|\band\b/)) {
    const a = raw.trim().replace(/s$/, ''); if (a.length < 3 || /^(none|nil|no known|nkda|n\/a)/.test(a)) continue;
    const words = [a, ...Object.entries(CLASSES).filter(([k, v]) => a.includes(k) || v.some(w => w.length > 4 && a.includes(w))).flatMap(([, v]) => v)];
    const hit = words.find(w => n.includes(w));
    if (hit) return raw.trim();
  }
  return null;
}

/* ---------- patients ---------- */
const PSQL = `SELECT pt.*, ma.name medical_aid FROM patients pt LEFT JOIN partners ma ON ma.id = pt.medical_aid_id`;
r.get('/patients', C, ah(async (req, res) => {
  const q = String(req.query.q || '').trim(); const args = [];
  let where = req.query.all ? '1=1' : 'pt.active = 1';
  if (q) { where += ` AND (pt.file_no LIKE ? OR pt.first_name LIKE ? OR pt.last_name LIKE ? OR CONCAT(pt.first_name, ' ', COALESCE(pt.last_name, '')) LIKE ? OR pt.phone LIKE ? OR pt.id_number LIKE ? OR pt.medical_aid_no LIKE ?)`; args.push(...Array(7).fill(`%${q}%`)); }
  const rows = await db.query(`${PSQL} WHERE ${where} ORDER BY pt.last_name, pt.first_name LIMIT 300`, args);
  rows.forEach(p => { p.age = age(p.dob); });
  res.json(rows);
}));
function cleanPatient(b) {
  const v = { first_name: s(b.first_name, 80) };
  if (!v.first_name) throw bad('Enter the patient\'s first name');
  v.last_name = s(b.last_name, 80); v.dob = b.dob ? String(b.dob).slice(0, 10) : null; v.sex = ['F', 'M', 'X'].includes(b.sex) ? b.sex : null;
  for (const [k, n] of [['id_number', 40], ['phone', 40], ['email', 120], ['address', 255], ['next_of_kin', 120], ['next_of_kin_phone', 40], ['allergies', 255], ['chronic', 255], ['blood_group', 5], ['species', 40], ['medical_aid_no', 40], ['main_member', 120], ['notes', 255]]) v[k] = s(b[k], n);
  v.medical_aid_id = Number(b.medical_aid_id) || null;
  if (v.medical_aid_id && !v.medical_aid_no) throw bad('Enter the medical aid membership number');
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  return v;
}
async function createPatient(c, b) {
  const v = cleanPatient(b);
  const name = `${v.first_name} ${v.last_name || ''}`.trim();
  // the patient's own account for bills and payments
  v.partner_id = (await c.query(`INSERT INTO partners (name, phone, email, address, is_customer, tags) VALUES (?, ?, ?, ?, 1, 'patient')`, [name, v.phone, v.email, v.address])).insertId;
  const ins = await c.query('INSERT INTO patients SET ?', [v]);
  if (!s(b.file_no, 30)) await c.query('UPDATE patients SET file_no = ? WHERE id = ?', [`P${pad(ins.insertId, 5)}`, ins.insertId]);
  else await c.query('UPDATE patients SET file_no = ? WHERE id = ?', [s(b.file_no, 30), ins.insertId]);
  return ins.insertId;
}
r.post('/patients', C, ah(async (req, res) => {
  if (req.body.file_no && await db.one('SELECT id FROM patients WHERE file_no = ?', [s(req.body.file_no, 30)])) throw bad('That file number is already used');
  const id = await db.tx(c => createPatient(c, req.body));
  res.json(await getPatient(id));
}));
r.put('/patients/:id(\\d+)', C, ah(async (req, res) => {
  const p = await db.one('SELECT * FROM patients WHERE id = ?', [req.params.id]);
  if (!p) throw notFound();
  const v = cleanPatient({ ...p, ...req.body });
  if (req.body.file_no && req.body.file_no !== p.file_no) { if (await db.one('SELECT id FROM patients WHERE file_no = ? AND id <> ?', [s(req.body.file_no, 30), p.id])) throw bad('That file number is already used'); v.file_no = s(req.body.file_no, 30); }
  await db.query('UPDATE patients SET ? WHERE id = ?', [v, p.id]);
  if (p.partner_id) await db.query('UPDATE partners SET name = ?, phone = ?, email = ?, address = ? WHERE id = ?', [`${v.first_name} ${v.last_name || ''}`.trim(), v.phone, v.email, v.address, p.partner_id]);
  res.json(await getPatient(p.id));
}));
async function getPatient(id) {
  const p = await db.one(`${PSQL} WHERE pt.id = ?`, [id]);
  if (!p) throw notFound();
  p.age = age(p.dob);
  p.visits = await db.query(`SELECT v.id, v.number, v.visit_date, v.kind, v.status, v.reason, v.diagnosis, v.icd10, u.name practitioner, i.number invoice_number, i.total
    FROM visits v LEFT JOIN users u ON u.id = v.practitioner_id LEFT JOIN invoices i ON i.id = v.invoice_id WHERE v.patient_id = ? ORDER BY v.visit_date DESC, v.id DESC LIMIT 100`, [id]);
  p.medicines = await db.query(`SELECT x.description, x.qty, x.dosage, x.duration, v.visit_date FROM visit_items x JOIN visits v ON v.id = x.visit_id WHERE v.patient_id = ? AND x.kind = 'medicine' AND x.dispensed = 1 ORDER BY v.visit_date DESC, x.id DESC LIMIT 50`, [id]);
  p.balance = p.partner_id ? round2((await db.one(`SELECT COALESCE(SUM(total - amount_paid), 0) b FROM invoices WHERE partner_id = ? AND kind = 'customer_invoice' AND status IN ('posted','partial')`, [p.partner_id])).b) : 0;
  return p;
}
r.get('/patients/:id(\\d+)', C, ah(async (req, res) => res.json(await getPatient(req.params.id))));

/* ---------- medical aids ---------- */
r.get('/medical-aids', C, ah(async (req, res) => res.json(await db.query(`SELECT id, name, phone, email FROM partners WHERE active = 1 AND FIND_IN_SET('medical_aid', REPLACE(COALESCE(tags, ''), ' ', '')) ORDER BY name`))));
r.post('/medical-aids', C, ah(async (req, res) => {
  const name = s(req.body.name, 160); if (!name) throw bad('Enter the medical aid\'s name');
  const ex = await db.one('SELECT id FROM partners WHERE name = ?', [name]);
  if (ex) { await db.query(`UPDATE partners SET is_customer = 1, tags = TRIM(BOTH ',' FROM CONCAT(COALESCE(tags, ''), ',medical_aid')) WHERE id = ? AND NOT FIND_IN_SET('medical_aid', REPLACE(COALESCE(tags, ''), ' ', ''))`, [ex.id]); return res.json({ id: ex.id }); }
  const ins = await db.query(`INSERT INTO partners (name, phone, email, is_customer, tags) VALUES (?, ?, ?, 1, 'medical_aid')`, [name, s(req.body.phone, 40), s(req.body.email, 120)]);
  res.json({ id: ins.insertId });
}));

/* ---------- visits & queue ---------- */
const VSQL = `SELECT v.*, pt.file_no, pt.first_name, pt.last_name, CONCAT(pt.first_name, ' ', COALESCE(pt.last_name, '')) patient_name, pt.dob, pt.sex, pt.phone, pt.allergies, pt.chronic, pt.species,
    pt.medical_aid_id, pt.medical_aid_no, ma.name medical_aid, u.name practitioner, i.number invoice_number, i.total invoice_total, i.status invoice_status,
    (SELECT COALESCE(SUM(x.qty * x.unit_price), 0) FROM visit_items x WHERE x.visit_id = v.id) items_total
  FROM visits v JOIN patients pt ON pt.id = v.patient_id LEFT JOIN partners ma ON ma.id = pt.medical_aid_id LEFT JOIN users u ON u.id = v.practitioner_id LEFT JOIN invoices i ON i.id = v.invoice_id`;
r.get('/visits', C, ah(async (req, res) => {
  const view = req.query.view || 'today'; const cond = [], args = [];
  const day = req.query.date ? String(req.query.date).slice(0, 10) : today();
  if (view === 'today') { cond.push('(v.visit_date = ? OR v.status IN (\'waiting\',\'in_consult\'))'); args.push(day); }
  else if (view === 'queue') cond.push(`v.status IN ('waiting','in_consult')`);
  else if (view === 'tobill') cond.push(`v.status = 'done'`);
  else if (view === 'mine') { cond.push(`v.status IN ('waiting','in_consult') AND (v.practitioner_id = ? OR v.practitioner_id IS NULL)`); args.push(req.user.id); }
  if (req.query.patient_id) { cond.push('v.patient_id = ?'); args.push(req.query.patient_id); }
  if (req.query.q) { cond.push('(pt.first_name LIKE ? OR pt.last_name LIKE ? OR pt.file_no LIKE ? OR v.number LIKE ? OR v.diagnosis LIKE ?)'); args.push(...Array(5).fill(`%${req.query.q}%`)); }
  const rows = await db.query(`${VSQL} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
    ORDER BY FIELD(v.status, 'in_consult', 'waiting', 'done', 'billed', 'cancelled'), v.visit_date DESC, v.queue_no, v.id LIMIT 500`, args);
  rows.forEach(v => { v.age = age(v.dob); v.items_total = round2(v.items_total); });
  res.json(rows);
}));
async function getVisit(id) {
  const v = await db.one(`${VSQL} WHERE v.id = ?`, [id]);
  if (!v) throw notFound();
  v.age = age(v.dob);
  v.items = await db.query('SELECT x.*, p.type product_type, p.stock_qty FROM visit_items x LEFT JOIN products p ON p.id = x.product_id WHERE x.visit_id = ? ORDER BY x.kind DESC, x.id', [v.id]);
  v.items.forEach(x => { x.amount = round2(Number(x.qty) * Number(x.unit_price)); });
  v.total = round2(v.items.reduce((t, x) => t + x.amount, 0));
  v.previous = await db.query(`SELECT id, number, visit_date, reason, diagnosis, plan FROM visits WHERE patient_id = ? AND id <> ? AND status IN ('done','billed') ORDER BY visit_date DESC, id DESC LIMIT 5`, [v.patient_id, v.id]);
  if (v.copay_invoice_id) v.copay = await db.one('SELECT id, number, total, amount_paid, status FROM invoices WHERE id = ?', [v.copay_invoice_id]);
  return v;
}
r.get('/visits/:id(\\d+)', C, ah(async (req, res) => res.json(await getVisit(req.params.id))));
// arrival: a patient joins today's queue (new patients are registered on the spot)
r.post('/visits', C, ah(async (req, res) => {
  const b = req.body;
  const id = await db.tx(async c => {
    let pid = Number(b.patient_id) || null;
    if (!pid) pid = await createPatient(c, b.patient || b);
    const pt = await c.one('SELECT * FROM patients WHERE id = ?', [pid]); if (!pt) throw bad('Unknown patient');
    if (await c.one(`SELECT id FROM visits WHERE patient_id = ? AND status IN ('waiting','in_consult')`, [pid])) throw bad(`${pt.first_name} is already in the queue`);
    const day = today();
    const q = Number((await c.one('SELECT COALESCE(MAX(queue_no), 0) + 1 n FROM visits WHERE visit_date = ? FOR UPDATE', [day])).n);
    const kind = ['consultation', 'pharmacy', 'follow_up', 'procedure'].includes(b.kind) ? b.kind : 'consultation';
    const ins = await c.query('INSERT INTO visits (patient_id, visit_date, queue_no, kind, practitioner_id, reason, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [pid, day, q, kind, Number(b.practitioner_id) || null, s(b.reason, 255), req.user.id]);
    await c.query('UPDATE visits SET number = ? WHERE id = ?', [`V/${new Date().getFullYear()}/${pad(ins.insertId, 6)}`, ins.insertId]);
    // vitals taken at reception / triage
    const vit = vitals(b); if (Object.keys(vit).length) await c.query('UPDATE visits SET ? WHERE id = ?', [vit, ins.insertId]);
    return ins.insertId;
  });
  res.json(await getVisit(id));
}));
function vitals(b) {
  const v = {};
  for (const k of ['bp_sys', 'bp_dia', 'pulse', 'resp', 'spo2']) if (b[k] !== undefined) v[k] = int(b[k]);
  for (const k of ['temp', 'weight', 'height', 'glucose']) if (b[k] !== undefined) v[k] = dec(b[k]);
  if (v.temp !== undefined && v.temp !== null && (v.temp < 25 || v.temp > 45)) throw bad('Temperature looks wrong – enter it in °C, e.g. 36.8');
  if (v.spo2 !== undefined && v.spo2 !== null && (v.spo2 < 30 || v.spo2 > 100)) throw bad('Oxygen saturation is a % between 30 and 100');
  return v;
}
// consultation notes (anyone treating the patient)
r.put('/visits/:id(\\d+)', C, ah(async (req, res) => {
  const v = await db.one('SELECT * FROM visits WHERE id = ?', [req.params.id]);
  if (!v) throw notFound();
  if (['billed', 'cancelled'].includes(v.status) && !req.body.notes_only) throw bad('This visit is closed');
  const b = req.body; const sets = vitals(b);
  for (const [k, n] of [['reason', 255], ['diagnosis', 255], ['icd10', 20]]) if (b[k] !== undefined) sets[k] = s(b[k], n);
  for (const k of ['history', 'exam', 'plan']) if (b[k] !== undefined) sets[k] = s(b[k], 8000);
  if (b.practitioner_id !== undefined) sets.practitioner_id = Number(b.practitioner_id) || null;
  if (b.sick_note_days !== undefined) sets.sick_note_days = int(b.sick_note_days);
  if (b.follow_up !== undefined) sets.follow_up = b.follow_up ? String(b.follow_up).slice(0, 10) : null;
  if (b.kind && ['consultation', 'pharmacy', 'follow_up', 'procedure'].includes(b.kind)) sets.kind = b.kind;
  if (Object.keys(sets).length) await db.query('UPDATE visits SET ? WHERE id = ?', [sets, v.id]);
  res.json(await getVisit(v.id));
}));
r.post('/visits/:id(\\d+)/start', C, ah(async (req, res) => {
  const v = await db.one('SELECT * FROM visits WHERE id = ?', [req.params.id]);
  if (!v || v.status !== 'waiting') throw bad('Only a waiting patient can be called in');
  await db.query(`UPDATE visits SET status = 'in_consult', started_at = NOW(), practitioner_id = COALESCE(practitioner_id, ?) WHERE id = ?`, [req.user.id, v.id]);
  res.json(await getVisit(v.id));
}));
r.post('/visits/:id(\\d+)/done', C, ah(async (req, res) => {
  const v = await db.one('SELECT * FROM visits WHERE id = ?', [req.params.id]);
  if (!v || !['waiting', 'in_consult'].includes(v.status)) throw bad('This visit is not open');
  if (v.kind !== 'pharmacy' && !v.diagnosis && !req.body.no_diagnosis) throw bad('Enter the diagnosis (or what was done) before finishing');
  await db.query(`UPDATE visits SET status = 'done', done_at = NOW(), practitioner_id = COALESCE(practitioner_id, ?) WHERE id = ?`, [req.user.id, v.id]);
  res.json(await getVisit(v.id));
}));
r.post('/visits/:id(\\d+)/reopen', C, ah(async (req, res) => {
  const v = await db.one('SELECT * FROM visits WHERE id = ?', [req.params.id]);
  if (!v || v.status !== 'done') throw bad('Only a finished, unbilled visit can be reopened');
  await db.query(`UPDATE visits SET status = 'in_consult' WHERE id = ?`, [v.id]);
  res.json(await getVisit(v.id));
}));
r.post('/visits/:id(\\d+)/cancel', C, ah(async (req, res) => {
  const v = await db.one('SELECT * FROM visits WHERE id = ?', [req.params.id]);
  if (!v || !['waiting', 'in_consult', 'done'].includes(v.status)) throw bad('Only an open visit can be cancelled');
  await db.query(`UPDATE visits SET status = 'cancelled', plan = CONCAT(COALESCE(plan, ''), ?) WHERE id = ?`, [req.body.reason ? `\nCancelled: ${String(req.body.reason).slice(0, 120)}` : '', v.id]);
  res.json(await getVisit(v.id));
}));

/* ---------- services & medicines on the visit ---------- */
async function productPrice(c, productId) {
  const p = await c.one('SELECT p.*, t.rate tax_rate, t.price_includes_tax FROM products p LEFT JOIN taxes t ON t.id = p.tax_id WHERE p.id = ?', [productId]);
  if (!p) throw bad('Unknown item');
  const rate = Number(p.tax_rate || 0);
  const incl = p.price_includes_tax === null || p.price_includes_tax === undefined || Number(p.price_includes_tax) ? Number(p.price) : round2(Number(p.price) * (1 + rate / 100));
  return { p, rate, incl };
}
async function stockProblem(c, productId, qty, alsoOnVisit = 0) {
  const p = await c.one('SELECT id, name, type, stock_qty, track_batches FROM products WHERE id = ?', [productId]);
  if (!p || p.type !== 'stock') return null;
  if (Number(p.stock_qty) - alsoOnVisit < Number(qty) - 0.0001) return `Only ${Number(p.stock_qty) - alsoOnVisit} ${p.name} in stock`;
  if (Number(p.track_batches)) {
    const exp = await c.one('SELECT batch_no, expiry_date FROM stock_batches WHERE product_id = ? AND qty_remaining > 0 AND expiry_date IS NOT NULL AND expiry_date < CURDATE() ORDER BY expiry_date LIMIT 1', [p.id]);
    // first-expiry-first-out would hand out the expired batch first
    if (exp) return `${p.name}: batch ${exp.batch_no} expired on ${String(exp.expiry_date).slice(0, 10)} – take it off the shelf and write it off (Inventory → Batches) before dispensing`;
    const ok = Number((await c.one('SELECT COALESCE(SUM(qty_remaining), 0) q FROM stock_batches WHERE product_id = ? AND qty_remaining > 0 AND (expiry_date IS NULL OR expiry_date >= CURDATE())', [p.id])).q);
    if (ok - alsoOnVisit < Number(qty) - 0.0001) return `Only ${ok - alsoOnVisit} ${p.name} in date`;
  }
  return null;
}
r.post('/visits/:id(\\d+)/items', C, ah(async (req, res) => {
  const b = req.body;
  await db.tx(async c => {
    const v = await c.one('SELECT v.*, pt.allergies FROM visits v JOIN patients pt ON pt.id = v.patient_id WHERE v.id = ? FOR UPDATE', [req.params.id]);
    if (!v) throw notFound();
    if (['billed', 'cancelled'].includes(v.status)) throw bad('This visit is closed');
    const kind = b.kind === 'medicine' ? 'medicine' : 'service';
    const q = Number(b.qty) > 0 ? Number(b.qty) : 1;
    let desc = s(b.description, 200), price = b.unit_price !== undefined && b.unit_price !== '' ? round2(b.unit_price) : null, rate = null, pid = Number(b.product_id) || null;
    if (pid) {
      const pp = await productPrice(c, pid);
      desc = desc || pp.p.name; if (price === null) price = pp.incl; rate = pp.rate;
      if (kind === 'medicine') {
        const hit = allergyHit(v.allergies, pp.p.name);
        if (hit && !b.override_allergy) throw bad(`ALLERGY: the patient is allergic to "${hit}" – ${pp.p.name} may cause a reaction. Prescribe something else, or confirm you have checked.`);
        const onVisit = Number((await c.one(`SELECT COALESCE(SUM(qty), 0) q FROM visit_items WHERE visit_id = ? AND product_id = ?`, [v.id, pid])).q);
        const prob = await stockProblem(c, pid, q, onVisit); if (prob) throw bad(prob);
      }
    }
    if (!desc) throw bad('Choose the service or medicine');
    if (price === null) price = 0;
    if (rate === null) rate = Number(((await db.getSetting('company', {})) || {}).default_vat ?? 15);
    await c.query('INSERT INTO visit_items (visit_id, kind, product_id, description, qty, unit_price, tax_rate, dosage, duration, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [v.id, kind, pid, desc, q, price, rate, s(b.dosage, 160), s(b.duration, 40), req.user.id]);
  });
  res.json(await getVisit(req.params.id));
}));
r.delete('/visits/:id(\\d+)/items/:item(\\d+)', C, ah(async (req, res) => {
  const v = await db.one('SELECT * FROM visits WHERE id = ?', [req.params.id]);
  if (!v || ['billed', 'cancelled'].includes(v.status)) throw bad('This visit is closed');
  await db.query('DELETE FROM visit_items WHERE id = ? AND visit_id = ?', [req.params.item, v.id]);
  res.json(await getVisit(v.id));
}));

/**
 * Bill and dispense: one invoice for services and medicines (stock goes out first-expiry-first-out when it is posted),
 * to the patient or to the medical aid – a co-payment is then billed to the patient and taken off the medical aid's bill.
 */
r.post('/visits/:id(\\d+)/bill', C, ah(async (req, res) => {
  const biz = require('./business');
  const b = req.body;
  const out = await db.tx(async c => {
    const v = await c.one('SELECT v.*, pt.partner_id, pt.medical_aid_id, pt.medical_aid_no, pt.first_name, pt.last_name, pt.file_no FROM visits v JOIN patients pt ON pt.id = v.patient_id WHERE v.id = ? FOR UPDATE', [req.params.id]);
    if (!v) throw notFound();
    if (!['done', 'in_consult', 'waiting'].includes(v.status)) throw bad('This visit is already billed or cancelled');
    const items = await c.query('SELECT * FROM visit_items WHERE visit_id = ?', [v.id]);
    if (!items.length) throw bad('Add the consultation fee, services or medicines first');
    for (const x of items.filter(i => i.kind === 'medicine' && i.product_id)) {
      const need = items.filter(i => i.product_id === x.product_id).reduce((t, i) => t + Number(i.qty), 0);
      const prob = await stockProblem(c, x.product_id, need); if (prob) throw bad(prob);
    }
    const toAid = b.bill_to === 'medical_aid';
    if (toAid && !v.medical_aid_id) throw bad('This patient has no medical aid on file');
    const name = `${v.first_name} ${v.last_name || ''}`.trim();
    const lines = items.map(x => ({ product_id: x.product_id, description: `${x.description}${x.dosage ? ' – ' + x.dosage : ''}${x.duration ? ' (' + x.duration + ')' : ''}`.slice(0, 200),
      qty: Number(x.qty), unit_price: Math.round(Number(x.unit_price) / (1 + Number(x.tax_rate) / 100) * 10000) / 10000, gross_total: round2(Number(x.qty) * Number(x.unit_price)),
      tax_rate: Number(x.tax_rate), account_code: x.kind === 'service' ? '4960' : null }));
    const total = round2(lines.reduce((t, l) => t + l.gross_total, 0));
    const copay = toAid ? round2(Math.min(total, Math.max(0, Number(b.copay) || 0))) : 0;
    if (copay) lines.push({ description: `Less co-payment by the patient`, qty: 1, unit_price: -copay, gross_total: -copay, tax_rate: 0, account_code: '4960' });
    const notes = `${v.number} · ${name} (${v.file_no})${toAid ? ` · member no. ${v.medical_aid_no}` : ''}${v.diagnosis ? ` · ${v.icd10 ? v.icd10 + ' ' : ''}${v.diagnosis}` : ''}`.slice(0, 250);
    const inv = await biz.createInvoice(c, req.user, { kind: 'customer_invoice', partner_id: toAid ? v.medical_aid_id : v.partner_id, invoice_date: today(), due_date: toAid ? null : (b.due_date || today()), notes, lines: biz.calcLines(lines, 'unit_price') });
    await c.query('UPDATE invoices SET visit_id = ? WHERE id = ?', [v.id, inv]);
    const number = (await biz.postInvoice(c, inv, req.user)).number;
    let copayInv = null;
    if (copay) {
      copayInv = await biz.createInvoice(c, req.user, { kind: 'customer_invoice', partner_id: v.partner_id, invoice_date: today(), due_date: today(), notes: `${v.number} co-payment (medical aid invoice ${number})`,
        lines: biz.calcLines([{ description: `Co-payment ${v.number}`, qty: 1, unit_price: copay, gross_total: copay, tax_rate: 0, account_code: '4960' }], 'unit_price') });
      await c.query('UPDATE invoices SET visit_id = ? WHERE id = ?', [v.id, copayInv]);
      await biz.postInvoice(c, copayInv, req.user);
    }
    await c.query('UPDATE visit_items SET dispensed = 1 WHERE visit_id = ? AND kind = \'medicine\'', [v.id]);
    await c.query(`UPDATE visits SET status = 'billed', bill_to = ?, invoice_id = ?, copay_invoice_id = ?, done_at = COALESCE(done_at, NOW()), practitioner_id = COALESCE(practitioner_id, ?) WHERE id = ?`,
      [toAid ? 'medical_aid' : 'patient', inv, copayInv, req.user.id, v.id]);
    let payment = null;
    const payInv = toAid ? copayInv : inv;
    if (Number(b.amount) > 0) {
      if (!payInv) throw bad('Nothing for the patient to pay – the medical aid is billed');
      payment = await receipts.allocate(c, { partner_id: v.partner_id, amount: b.amount, method_id: b.method_id, reference: b.reference, user: req.user, memo: `${v.number} ${name}`, where: 'i.id = ?', args: [payInv] });
    }
    return { invoice_id: inv, number, copay_invoice_id: copayInv, payment };
  });
  res.json({ ...out, visit: await getVisit(req.params.id) });
}));

/* ---------- figures ---------- */
r.get('/clinic/stats', C, ah(async (req, res) => {
  const t = today();
  const x = await db.one(`SELECT SUM(status = 'waiting') waiting, SUM(status = 'in_consult') in_consult, SUM(status = 'done') to_bill, SUM(visit_date = ? AND status IN ('done','billed')) seen_today FROM visits`, [t]);
  const rev = await db.one(`SELECT COALESCE(SUM(total), 0) a FROM invoices WHERE visit_id IS NOT NULL AND invoice_date = ? AND status <> 'draft' AND status <> 'cancelled'`, [t]);
  const claims = await db.one(`SELECT COUNT(*) n, COALESCE(SUM(i.total - i.amount_paid), 0) a FROM invoices i JOIN visits v ON v.invoice_id = i.id WHERE v.bill_to = 'medical_aid' AND i.status IN ('posted','partial')`);
  const out = Object.fromEntries(Object.entries(x).map(([k, v]) => [k, Number(v || 0)]));
  res.json({ ...out, revenue_today: round2(rev.a), claims_open: Number(claims.n), claims_amount: round2(claims.a) });
}));
r.get('/clinic/report', C, ah(async (req, res) => {
  const to = req.query.to || today(); const from = req.query.from || `${to.slice(0, 8)}01`;
  const byPractitioner = await db.query(`SELECT COALESCE(u.name, '—') name, COUNT(*) visits, SUM(v.kind = 'consultation') consultations, SUM(v.kind = 'pharmacy') pharmacy,
      COALESCE(SUM((SELECT SUM(x.qty * x.unit_price) FROM visit_items x WHERE x.visit_id = v.id)), 0) billed
    FROM visits v LEFT JOIN users u ON u.id = v.practitioner_id WHERE v.status = 'billed' AND v.visit_date BETWEEN ? AND ? GROUP BY u.name ORDER BY visits DESC`, [from, to]);
  const diagnoses = await db.query(`SELECT COALESCE(NULLIF(icd10, ''), '') icd10, LOWER(TRIM(diagnosis)) diagnosis, COUNT(*) n FROM visits WHERE status IN ('done','billed') AND diagnosis IS NOT NULL AND visit_date BETWEEN ? AND ?
    GROUP BY COALESCE(NULLIF(icd10, ''), ''), LOWER(TRIM(diagnosis)) ORDER BY n DESC LIMIT 20`, [from, to]);
  const pid = Number(req.query.product_id) || null;
  const register = await db.query(`SELECT v.visit_date, v.number, pt.file_no, CONCAT(pt.first_name, ' ', COALESCE(pt.last_name, '')) patient, x.description, x.qty, x.dosage, x.duration, u.name practitioner, i.number invoice_number
    FROM visit_items x JOIN visits v ON v.id = x.visit_id JOIN patients pt ON pt.id = v.patient_id LEFT JOIN users u ON u.id = v.practitioner_id LEFT JOIN invoices i ON i.id = v.invoice_id
    WHERE x.kind = 'medicine' AND x.dispensed = 1 AND v.visit_date BETWEEN ? AND ? ${pid ? 'AND x.product_id = ?' : ''} ORDER BY v.visit_date, v.id, x.id LIMIT 3000`, pid ? [from, to, pid] : [from, to]);
  const totals = await db.one(`SELECT COUNT(*) visits, COUNT(DISTINCT patient_id) patients, SUM(kind = 'pharmacy') pharmacy FROM visits WHERE status = 'billed' AND visit_date BETWEEN ? AND ?`, [from, to]);
  res.json({ from, to, by_practitioner: byPractitioner.map(x => ({ ...x, billed: round2(x.billed), visits: Number(x.visits), consultations: Number(x.consultations), pharmacy: Number(x.pharmacy) })),
    diagnoses: diagnoses.map(d => ({ ...d, n: Number(d.n) })), register, totals: { visits: Number(totals.visits || 0), patients: Number(totals.patients || 0), pharmacy: Number(totals.pharmacy || 0) } });
}));
// medical-aid claims still unpaid
r.get('/clinic/claims', C, ah(async (req, res) => {
  const rows = await db.query(`SELECT i.id invoice_id, i.number, i.invoice_date, i.total, i.amount_paid, ROUND(i.total - i.amount_paid, 2) open, DATEDIFF(CURDATE(), i.invoice_date) days, i.status,
      ma.name medical_aid, ma.id medical_aid_id, v.number visit_number, v.id visit_id, CONCAT(pt.first_name, ' ', COALESCE(pt.last_name, '')) patient, pt.medical_aid_no, v.icd10, v.diagnosis
    FROM visits v JOIN invoices i ON i.id = v.invoice_id JOIN partners ma ON ma.id = i.partner_id JOIN patients pt ON pt.id = v.patient_id
    WHERE v.bill_to = 'medical_aid' ${req.query.all ? '' : `AND i.status IN ('posted','partial')`} ORDER BY ma.name, i.invoice_date LIMIT 2000`);
  res.json(rows);
}));
r.get('/clinic/practitioners', C, ah(async (req, res) => res.json(await db.query(`SELECT id, name, role FROM users WHERE active = 1 AND role IN ('admin','manager','clinician') ORDER BY name`))));
r.get('/clinic/settings', C, ah(async (req, res) => res.json({ practice_no: '', label_note: 'Keep out of reach of children', ...((await db.getSetting('clinic', {})) || {}) })));
r.put('/clinic/settings', requirePerm('settings'), ah(async (req, res) => {
  await db.setSetting('clinic', { practice_no: s(req.body.practice_no, 40) || '', label_note: s(req.body.label_note, 120) || '', practitioner_title: s(req.body.practitioner_title, 60) || '' });
  res.json({ ok: true });
}));

module.exports = r;
module.exports.allergyHit = allergyHit;
