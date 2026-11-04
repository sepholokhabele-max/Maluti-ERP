// School fees: classes, learners and their guardians (who pay), fee structure per grade, term/month billing runs
// with bursaries and sibling discounts, payments against the oldest fees, arrears per class, statements, promotion to the next class.
const express = require('express');
const db = require('../db');
const receipts = require('../services/receipts');
const { requirePerm } = require('../auth');
const { ah, bad, notFound, round2, pad, today } = require('../util');

const r = express.Router();
const S = requirePerm('school');
const PERIODS = ['term', 'year', 'month', 'once'];
async function settings() { return { sibling_discount_pct: 0, post_invoices: 1, ...((await db.getSetting('school', {})) || {}) }; }
r.get('/school/settings', S, ah(async (req, res) => res.json(await settings())));
r.put('/school/settings', requirePerm('settings'), ah(async (req, res) => {
  const v = { sibling_discount_pct: Math.max(0, Math.min(100, Number(req.body.sibling_discount_pct) || 0)), post_invoices: req.body.post_invoices ? 1 : 0 };
  await db.setSetting('school', v); res.json(v);
}));

/* ---------- classes ---------- */
r.get('/school/classes', S, ah(async (req, res) => res.json(await db.query(`SELECT c.*, n.name next_class_name,
    (SELECT COUNT(*) FROM learners l WHERE l.class_id = c.id AND l.status = 'enrolled') learners
  FROM school_classes c LEFT JOIN school_classes n ON n.id = c.next_class_id ${req.query.all ? '' : 'WHERE c.active = 1'} ORDER BY c.sort, c.name`))));
function cleanClass(b) {
  const v = { name: String(b.name || '').trim().slice(0, 60), grade: String(b.grade || b.name || '').trim().slice(0, 40) };
  if (!v.name) throw bad('Name the class, e.g. "Grade 1A"');
  v.sort = Math.round(Number(b.sort) || 0); v.teacher = b.teacher ? String(b.teacher).slice(0, 120) : null;
  v.capacity = Number(b.capacity) > 0 ? Math.round(Number(b.capacity)) : null; v.next_class_id = Number(b.next_class_id) || null;
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  return v;
}
r.post('/school/classes', S, ah(async (req, res) => { const ins = await db.query('INSERT INTO school_classes SET ?', [cleanClass(req.body)]); res.json({ id: ins.insertId }); }));
r.put('/school/classes/:id(\\d+)', S, ah(async (req, res) => {
  const c = await db.one('SELECT * FROM school_classes WHERE id = ?', [req.params.id]);
  if (!c) throw notFound();
  const v = cleanClass({ ...c, ...req.body });
  if (v.next_class_id === c.id) throw bad('A class cannot move up into itself');
  await db.query('UPDATE school_classes SET ? WHERE id = ?', [v, c.id]); res.json({ id: c.id });
}));

/* ---------- learners ---------- */
const L_SQL = `SELECT l.*, CONCAT(l.first_name, ' ', l.last_name) name, c.name class_name, c.grade, g.name guardian_name, g.phone guardian_phone, g.email guardian_email,
    (SELECT COALESCE(SUM(i.total - i.amount_paid),0) FROM invoices i WHERE i.learner_id = l.id AND i.status IN ('posted','partial')) balance
  FROM learners l LEFT JOIN school_classes c ON c.id = l.class_id JOIN partners g ON g.id = l.guardian_id`;
r.get('/learners', S, ah(async (req, res) => {
  const cond = [], args = [];
  const st = req.query.status || 'enrolled';
  if (st !== 'all') { cond.push('l.status = ?'); args.push(st); }
  if (req.query.class_id) { cond.push('l.class_id = ?'); args.push(req.query.class_id); }
  if (req.query.guardian_id) { cond.push('l.guardian_id = ?'); args.push(req.query.guardian_id); }
  if (req.query.owing) cond.push(`EXISTS (SELECT 1 FROM invoices i WHERE i.learner_id = l.id AND i.status IN ('posted','partial'))`);
  if (req.query.q) { cond.push('(l.first_name LIKE ? OR l.last_name LIKE ? OR l.admission_no LIKE ? OR g.name LIKE ? OR g.phone LIKE ?)'); for (let i = 0; i < 5; i++) args.push(`%${req.query.q}%`); }
  const rows = await db.query(`${L_SQL} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY c.sort, c.name, l.last_name, l.first_name LIMIT 3000`, args);
  rows.forEach(x => { x.balance = round2(x.balance); });
  res.json(rows);
}));
async function getLearner(id) {
  const l = await db.one(`${L_SQL} WHERE l.id = ?`, [id]);
  if (!l) throw notFound('Learner');
  l.balance = round2(l.balance);
  l.fees = (await db.query('SELECT fee_item_id FROM learner_fees WHERE learner_id = ?', [l.id])).map(x => x.fee_item_id);
  l.siblings = await db.query(`SELECT id, CONCAT(first_name, ' ', last_name) name, status FROM learners WHERE guardian_id = ? AND id <> ?`, [l.guardian_id, l.id]);
  l.statement = await statement(l);
  return l;
}
/** invoices (debits) and payments (credits) for one learner, oldest first, with running balance */
async function statement(l) {
  const inv = await db.query(`SELECT id, number, invoice_date d, notes, total, status FROM invoices WHERE learner_id = ? AND status IN ('posted','partial','paid') ORDER BY invoice_date, id`, [l.id]);
  const pay = inv.length ? await db.query(`SELECT p.created_at d, p.amount, p.reference, m.name method, i.number FROM payments p JOIN invoices i ON i.id = p.invoice_id LEFT JOIN payment_methods m ON m.id = p.method_id
    WHERE p.invoice_id IN (?) AND p.direction = 'in' AND p.status = 'completed' ORDER BY p.created_at`, [inv.map(i => i.id)]) : [];
  const rows = [...inv.map(i => ({ date: String(i.d).slice(0, 10), text: i.notes || i.number, ref: i.number, debit: Number(i.total), credit: 0 })),
    ...pay.map(p => ({ date: String(p.d).slice(0, 10), text: `Payment – ${p.method || ''}${p.reference ? ' ' + p.reference : ''}`, ref: p.number, debit: 0, credit: Number(p.amount) }))]
    .sort((a, b) => a.date.localeCompare(b.date) || b.debit - a.debit);
  let bal = 0; rows.forEach(x => { bal = round2(bal + x.debit - x.credit); x.balance = bal; });
  return rows;
}
r.get('/learners/:id(\\d+)', S, ah(async (req, res) => res.json(await getLearner(req.params.id))));
async function cleanLearner(c, b) {
  const v = { first_name: String(b.first_name || '').trim().slice(0, 80), last_name: String(b.last_name || '').trim().slice(0, 80) };
  if (!v.first_name || !v.last_name) throw bad('Enter the learner\'s first name and surname');
  v.gender = ['F', 'M'].includes(b.gender) ? b.gender : null; v.birth_date = b.birth_date || null;
  v.class_id = Number(b.class_id) || null;
  if (!v.class_id) throw bad('Choose the class');
  let gid = Number(b.guardian_id) || null;
  if (!gid) {
    const name = String(b.guardian_name || '').trim();
    if (!name || !String(b.guardian_phone || '').trim()) throw bad('Choose the parent / guardian who pays, or enter their name and phone number');
    const ex = await c.one('SELECT id FROM partners WHERE phone = ? AND name = ?', [String(b.guardian_phone).trim(), name]);
    gid = ex ? ex.id : (await c.query('INSERT INTO partners (name, phone, email, is_customer, tags) VALUES (?, ?, ?, 1, ?)', [name, String(b.guardian_phone).trim(), b.guardian_email || null, 'parent'])).insertId;
  }
  v.guardian_id = gid;
  v.guardian2 = b.guardian2 ? String(b.guardian2).slice(0, 160) : null;
  v.enrolled_on = b.enrolled_on || today();
  v.bursary_pct = Math.max(0, Math.min(100, Number(b.bursary_pct) || 0));
  v.medical = b.medical ? String(b.medical).slice(0, 255) : null; v.notes = b.notes ? String(b.notes).slice(0, 255) : null;
  if (b.admission_no) v.admission_no = String(b.admission_no).trim().slice(0, 30);
  return v;
}
r.post('/learners', S, ah(async (req, res) => {
  const id = await db.tx(async c => {
    const v = await cleanLearner(c, req.body);
    if (v.admission_no && await c.one('SELECT id FROM learners WHERE admission_no = ?', [v.admission_no])) throw bad(`Admission number ${v.admission_no} is already used`);
    const ins = await c.query('INSERT INTO learners SET ?', [v]);
    if (!v.admission_no) await c.query('UPDATE learners SET admission_no = ? WHERE id = ?', [`${new Date().getFullYear()}${pad(ins.insertId, 4)}`, ins.insertId]);
    return ins.insertId;
  });
  res.json(await getLearner(id));
}));
r.put('/learners/:id(\\d+)', S, ah(async (req, res) => {
  await db.tx(async c => {
    const l = await c.one('SELECT * FROM learners WHERE id = ?', [req.params.id]);
    if (!l) throw notFound();
    const v = await cleanLearner(c, { ...l, ...req.body });
    if (v.admission_no && await c.one('SELECT id FROM learners WHERE admission_no = ? AND id <> ?', [v.admission_no, l.id])) throw bad(`Admission number ${v.admission_no} is already used`);
    await c.query('UPDATE learners SET ? WHERE id = ?', [v, l.id]);
  });
  res.json(await getLearner(req.params.id));
}));
r.post('/learners/:id(\\d+)/leave', S, ah(async (req, res) => {
  await db.query(`UPDATE learners SET status = ?, left_on = ? WHERE id = ?`, [req.body.graduated ? 'graduated' : 'left', req.body.date || today(), req.params.id]);
  res.json(await getLearner(req.params.id));
}));
r.post('/learners/:id(\\d+)/return', S, ah(async (req, res) => { await db.query(`UPDATE learners SET status = 'enrolled', left_on = NULL WHERE id = ?`, [req.params.id]); res.json(await getLearner(req.params.id)); }));
r.put('/learners/:id(\\d+)/fees', S, ah(async (req, res) => {
  await db.tx(async c => {
    await c.query('DELETE FROM learner_fees WHERE learner_id = ?', [req.params.id]);
    for (const f of req.body.fee_item_ids || []) await c.query('INSERT IGNORE INTO learner_fees (learner_id, fee_item_id) VALUES (?, ?)', [req.params.id, f]);
  });
  res.json(await getLearner(req.params.id));
}));
// a payment from a parent: the oldest fees of this learner first (or of all their children with family = 1)
r.post('/learners/:id(\\d+)/receive', S, ah(async (req, res) => {
  const l = await db.one('SELECT * FROM learners WHERE id = ?', [req.params.id]);
  if (!l) throw notFound();
  const out = await db.tx(c => receipts.allocate(c, { partner_id: l.guardian_id, amount: req.body.amount, method_id: req.body.method_id, reference: req.body.reference, date: req.body.date,
    where: req.body.family ? 'i.learner_id IS NOT NULL' : 'i.learner_id = ?', args: req.body.family ? [] : [l.id], user: req.user, memo: `School fees ${l.first_name} ${l.last_name}` }));
  res.json({ ...out, learner: await getLearner(l.id) });
}));

/* ---------- fee structure ---------- */
r.get('/school/fees', S, ah(async (req, res) => res.json(await db.query(`SELECT f.*, (SELECT COUNT(*) FROM learner_fees x WHERE x.fee_item_id = f.id) subscribed FROM fee_items f ${req.query.all ? '' : 'WHERE f.active = 1'} ORDER BY f.grade IS NOT NULL, f.grade, f.period, f.name`))));
function cleanFee(b) {
  const v = { name: String(b.name || '').trim().slice(0, 100) };
  if (!v.name) throw bad('Name the fee, e.g. "Tuition", "Lunch", "Transport", "Exam fee"');
  v.grade = b.grade ? String(b.grade).trim().slice(0, 40) : null;
  v.amount = round2(b.amount);
  if (!(v.amount > 0)) throw bad('Enter the amount');
  v.period = PERIODS.includes(b.period) ? b.period : 'term';
  v.optional = b.optional ? 1 : 0; v.sibling_discount = b.sibling_discount === undefined ? 1 : (b.sibling_discount ? 1 : 0);
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  return v;
}
r.post('/school/fees', S, ah(async (req, res) => { const ins = await db.query('INSERT INTO fee_items SET ?', [cleanFee(req.body)]); res.json({ id: ins.insertId }); }));
r.put('/school/fees/:id(\\d+)', S, ah(async (req, res) => {
  const f = await db.one('SELECT * FROM fee_items WHERE id = ?', [req.params.id]);
  if (!f) throw notFound();
  await db.query('UPDATE fee_items SET ? WHERE id = ?', [cleanFee({ ...f, ...req.body }), f.id]); res.json({ id: f.id });
}));

/* ---------- billing runs ---------- */
/** works out every learner's fees for a run: grade fees + chosen optional fees, less bursary and sibling discount */
async function plan(b) {
  const period = PERIODS.includes(b.period) ? b.period : 'term';
  const s = await settings();
  const fees = await db.query('SELECT * FROM fee_items WHERE active = 1 AND period = ?', [period]);
  const subs = await db.query('SELECT * FROM learner_fees');
  const classIds = (b.class_ids || []).map(Number).filter(Boolean);
  const learners = await db.query(`SELECT l.*, c.grade, c.name class_name FROM learners l JOIN school_classes c ON c.id = l.class_id WHERE l.status = 'enrolled' ${classIds.length ? 'AND l.class_id IN (?)' : ''}
    ORDER BY l.guardian_id, l.birth_date IS NULL, l.birth_date, l.id`, classIds.length ? [classIds] : []);
  const seen = new Map();
  return learners.map(l => {
    const n = (seen.get(l.guardian_id) || 0) + 1; seen.set(l.guardian_id, n);
    const items = fees.filter(f => (!f.grade || f.grade === l.grade) && (!f.optional || subs.some(x => x.learner_id === l.id && x.fee_item_id === f.id)));
    const lines = items.map(f => ({ description: `${f.name} – ${b.label}`, qty: 1, unit_price: Number(f.amount), tax_rate: 0, account_code: '4700', _f: f }));
    const compulsory = round2(items.filter(f => !f.optional).reduce((t, f) => t + Number(f.amount), 0));
    if (Number(l.bursary_pct) && compulsory) lines.push({ description: `Bursary ${Number(l.bursary_pct)}%`, qty: 1, unit_price: -round2(compulsory * Number(l.bursary_pct) / 100), tax_rate: 0, account_code: '4700' });
    const sib = n > 1 && Number(s.sibling_discount_pct) ? round2(items.filter(f => f.sibling_discount && !f.optional).reduce((t, f) => t + Number(f.amount), 0) * (1 - Number(l.bursary_pct) / 100) * Number(s.sibling_discount_pct) / 100) : 0;
    if (sib) lines.push({ description: `Sibling discount ${Number(s.sibling_discount_pct)}% (child ${n})`, qty: 1, unit_price: -sib, tax_rate: 0, account_code: '4700' });
    lines.forEach(x => delete x._f);
    return { learner_id: l.id, name: `${l.first_name} ${l.last_name}`, class_name: l.class_name, guardian_id: l.guardian_id, lines, total: round2(lines.reduce((t, x) => t + x.unit_price, 0)) };
  }).filter(x => x.total > 0);
}
r.post('/school/bill', S, ah(async (req, res) => {
  const b = req.body;
  const label = String(b.label || '').trim().slice(0, 60);
  if (!label) throw bad('Name the billing run, e.g. "Term 1 2027" or "February 2027 lunch"');
  const list = await plan({ ...b, label });
  if (req.body.preview) return res.json({ label, learners: list.length, total: round2(list.reduce((t, x) => t + x.total, 0)), rows: list.map(({ lines, ...x }) => ({ ...x, lines: lines.length })) });
  if (!list.length) throw bad('No fees to bill: check the fee structure for this period and that learners are enrolled in classes');
  if (await db.one('SELECT id FROM fee_runs WHERE label = ?', [label])) throw bad(`"${label}" was already billed. Use a different name for a new run.`);
  const biz = require('./business');
  const s = await settings();
  const date = b.invoice_date || today();
  const out = await db.tx(async c => {
    const run = await c.query('INSERT INTO fee_runs (label, period, invoice_date, due_date, user_id) VALUES (?, ?, ?, ?, ?)', [label, b.period || 'term', date, b.due_date || null, req.user.id]);
    let total = 0;
    for (const x of list) {
      const inv = await biz.createInvoice(c, req.user, { kind: 'customer_invoice', partner_id: x.guardian_id, invoice_date: date, due_date: b.due_date || null,
        notes: `${x.name} (${x.class_name}) – ${label}`.slice(0, 255), lines: biz.calcLines(x.lines, 'unit_price') });
      await c.query('UPDATE invoices SET learner_id = ? WHERE id = ?', [x.learner_id, inv]);
      if (s.post_invoices) await biz.postInvoice(c, inv, req.user);
      await c.query('INSERT INTO fee_bills (run_id, learner_id, invoice_id) VALUES (?, ?, ?)', [run.insertId, x.learner_id, inv]);
      total += x.total;
    }
    await c.query('UPDATE fee_runs SET invoices = ?, total = ? WHERE id = ?', [list.length, round2(total), run.insertId]);
    return { run_id: run.insertId, invoices: list.length, total: round2(total) };
  });
  res.json(out);
}));
r.get('/school/runs', S, ah(async (req, res) => res.json(await db.query(`SELECT r.*, u.name user_name,
    (SELECT COALESCE(SUM(i.amount_paid),0) FROM fee_bills b JOIN invoices i ON i.id = b.invoice_id WHERE b.run_id = r.id) collected
  FROM fee_runs r LEFT JOIN users u ON u.id = r.user_id ORDER BY r.id DESC`))));

/* ---------- arrears, promotion ---------- */
r.get('/school/arrears', S, ah(async (req, res) => {
  const ls = await db.query(`${L_SQL} WHERE EXISTS (SELECT 1 FROM invoices i WHERE i.learner_id = l.id AND i.status IN ('posted','partial')) ${req.query.class_id ? 'AND l.class_id = ' + Number(req.query.class_id) : ''} ORDER BY c.sort, c.name, l.last_name`);
  const out = [];
  for (const l of ls) { const b = await receipts.balance(db, l.guardian_id, 'i.learner_id = ?', [l.id]); out.push({ id: l.id, admission_no: l.admission_no, name: l.name, class_name: l.class_name, status: l.status, guardian_name: l.guardian_name, guardian_phone: l.guardian_phone, due: b.due, ...b.age }); }
  const byClass = {};
  for (const x of out) { byClass[x.class_name || '–'] = round2((byClass[x.class_name || '–'] || 0) + x.due); }
  res.json({ rows: out, total: round2(out.reduce((t, x) => t + x.due, 0)), by_class: Object.entries(byClass).map(([class_name, due]) => ({ class_name, due })) });
}));
// end of year: everyone moves to their class's "next class"; classes without one graduate (if asked)
r.post('/school/promote', S, ah(async (req, res) => {
  const out = await db.tx(async c => {
    const classes = await c.query('SELECT * FROM school_classes WHERE active = 1');
    const moves = [];
    for (const k of classes) {
      const ids = (await c.query(`SELECT id FROM learners WHERE class_id = ? AND status = 'enrolled'`, [k.id])).map(x => x.id);
      if (!ids.length) continue;
      if (k.next_class_id) moves.push({ ids, to: k.next_class_id, from: k.name });
      else if (req.body.graduate_final) { await c.query(`UPDATE learners SET status = 'graduated', left_on = CURDATE() WHERE id IN (?)`, [ids]); moves.push({ ids, to: null, from: k.name }); }
    }
    // move all at once so a learner is not moved twice (Grade 1 → 2 → 3)
    for (const m of moves) if (m.to) await c.query('UPDATE learners SET class_id = ? WHERE id IN (?)', [m.to, m.ids]);
    return moves.map(m => ({ from: m.from, learners: m.ids.length, graduated: !m.to }));
  });
  res.json({ moved: out });
}));

module.exports = r;
