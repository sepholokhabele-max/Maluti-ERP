// HR & Payroll: employees, recurring pay items, leave, payroll runs with Lesotho PAYE
const express = require('express');
const db = require('../db');
const payroll = require('../services/payroll');
const { requirePerm } = require('../auth');
const { ah, bad, notFound, round2, pick, today } = require('../util');

const r = express.Router();

// ---------- module settings (reachable even when the module is off, so it can be turned back on) ----------
r.get('/settings', requirePerm('hrm'), ah(async (req, res) => {
  res.json({ settings: await payroll.settings(), paye_tables: await db.query('SELECT * FROM paye_tables ORDER BY effective_from DESC') });
}));
r.put('/settings', requirePerm('settings'), ah(async (req, res) => {
  const cur = await payroll.settings();
  const v = { ...cur, ...pick(req.body, ['enabled', 'paye_enabled', 'working_days_per_month']) };
  v.enabled = !!v.enabled; v.paye_enabled = !!v.paye_enabled;
  await db.setSetting('hrm', v);
  await db.query(`INSERT INTO audit_log (user_id, action, entity, details) VALUES (?, 'hrm.settings', 'settings', ?)`, [req.user.id, JSON.stringify(v)]);
  res.json(v);
}));
// public-ish flag for the UI (any logged-in user)
r.get('/status', ah(async (req, res) => { const s = await payroll.settings(); res.json({ enabled: s.enabled, paye_enabled: s.paye_enabled }); }));

r.post('/paye-tables', requirePerm('settings'), ah(async (req, res) => {
  const b = req.body;
  for (const k of ['name', 'effective_from', 'band_monthly', 'lower_rate', 'upper_rate', 'credit_monthly']) if (b[k] === undefined || b[k] === '') throw bad(`${k} is required`);
  await db.query(`INSERT INTO paye_tables (name, effective_from, band_monthly, lower_rate, upper_rate, credit_monthly, source) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [b.name, b.effective_from, b.band_monthly, b.lower_rate, b.upper_rate, b.credit_monthly, b.source || null]);
  res.json({ ok: true });
}));
r.put('/paye-tables/:id', requirePerm('settings'), ah(async (req, res) => {
  const used = await db.one(`SELECT id FROM payroll_runs WHERE paye_table_id = ? AND status <> 'draft' LIMIT 1`, [req.params.id]);
  if (used) throw bad('This table was used by an approved payroll run. Add a new table with a later effective date instead.');
  const d = pick(req.body, ['name', 'effective_from', 'band_monthly', 'lower_rate', 'upper_rate', 'credit_monthly', 'source']);
  await db.query('UPDATE paye_tables SET ? WHERE id = ?', [d, req.params.id]);
  res.json({ ok: true });
}));
// PAYE calculator (for checking figures)
r.get('/paye-calc', requirePerm('hrm'), ah(async (req, res) => {
  const period = req.query.period || today().slice(0, 7);
  const t = await payroll.tableFor(db, payroll.checkPeriod(period));
  res.json({ table: t, ...payroll.calcPaye(Number(req.query.taxable || 0), t) });
}));

// everything below needs the module switched on
r.use(ah(async (req, res, next) => { await payroll.requireEnabled(); next(); }));

// ---------- departments ----------
r.get('/departments', requirePerm('hrm'), ah(async (req, res) => res.json(await db.query('SELECT * FROM departments WHERE active = 1 ORDER BY name'))));
r.post('/departments', requirePerm('hrm'), ah(async (req, res) => {
  if (!req.body.name) throw bad('Name required');
  await db.query('INSERT INTO departments (name) VALUES (?)', [req.body.name]); res.json({ ok: true });
}));
r.delete('/departments/:id', requirePerm('hrm'), ah(async (req, res) => { await db.query('UPDATE departments SET active = 0 WHERE id = ?', [req.params.id]); res.json({ ok: true }); }));

// ---------- employees ----------
const EMP_FIELDS = ['code', 'first_name', 'last_name', 'id_number', 'tin', 'gender', 'birth_date', 'phone', 'email', 'address', 'department_id', 'job_title',
  'employment_type', 'hire_date', 'termination_date', 'status', 'basic_salary', 'paye_applies', 'pay_method', 'bank_name', 'bank_account',
  'mobile_money_number', 'emergency_contact', 'notes', 'user_id'];
const clean = d => { for (const k of ['code', 'birth_date', 'hire_date', 'termination_date', 'gender', 'department_id', 'user_id']) if (d[k] === '') d[k] = null; return d; };

r.get('/employees', requirePerm('hrm'), ah(async (req, res) => {
  const cond = [], args = [];
  if (req.query.status) { cond.push('e.status = ?'); args.push(req.query.status); }
  if (req.query.q) { cond.push('(e.first_name LIKE ? OR e.last_name LIKE ? OR e.code LIKE ? OR e.job_title LIKE ?)'); for (let i = 0; i < 4; i++) args.push(`%${req.query.q}%`); }
  res.json(await db.query(
    `SELECT e.*, d.name department, CONCAT(e.first_name, ' ', e.last_name) full_name,
       (SELECT COALESCE(SUM(CASE WHEN kind = 'earning' THEN amount ELSE 0 END),0) FROM employee_pay_items WHERE employee_id = e.id AND active = 1) recurring_earnings,
       (SELECT COALESCE(SUM(CASE WHEN kind = 'deduction' THEN amount ELSE 0 END),0) FROM employee_pay_items WHERE employee_id = e.id AND active = 1) recurring_deductions
     FROM employees e LEFT JOIN departments d ON d.id = e.department_id
     ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY e.status, e.last_name, e.first_name`, args));
}));
r.get('/employees/:id', requirePerm('hrm'), ah(async (req, res) => {
  const e = await db.one(`SELECT e.*, d.name department FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE e.id = ?`, [req.params.id]);
  if (!e) throw notFound('Employee');
  e.pay_items = await db.query('SELECT * FROM employee_pay_items WHERE employee_id = ? ORDER BY kind DESC, id', [e.id]);
  e.leave_balances = await leaveBalances(e.id);
  e.leave = await db.query(`SELECT l.*, t.name type FROM leave_requests l JOIN leave_types t ON t.id = l.leave_type_id WHERE employee_id = ? ORDER BY start_date DESC LIMIT 50`, [e.id]);
  e.payslips = await db.query(`SELECT p.id, p.gross, p.paye, p.other_deductions, p.net, r.period, r.status, r.id run_id FROM payslips p JOIN payroll_runs r ON r.id = p.run_id WHERE p.employee_id = ? ORDER BY r.period DESC LIMIT 24`, [e.id]);
  // preview this month's pay
  const s = await payroll.settings();
  const period = today().slice(0, 7);
  const t = await payroll.tableFor(db, period);
  const earn = e.pay_items.filter(i => i.active && i.kind === 'earning'), ded = e.pay_items.filter(i => i.active && i.kind === 'deduction');
  const taxable = Math.max(0, Number(e.basic_salary) + earn.filter(i => i.taxable).reduce((a, i) => a + Number(i.amount), 0) - ded.filter(i => i.pre_tax).reduce((a, i) => a + Number(i.amount), 0));
  const gross = Number(e.basic_salary) + earn.reduce((a, i) => a + Number(i.amount), 0);
  const tax = s.paye_enabled && e.paye_applies ? payroll.calcPaye(taxable, t) : { paye: 0 };
  const other = ded.reduce((a, i) => a + Number(i.amount), 0);
  e.pay_preview = { period, gross: round2(gross), taxable: round2(taxable), paye: tax.paye, other_deductions: round2(other), net: round2(gross - tax.paye - other), table: t && t.name };
  res.json(e);
}));
r.post('/employees', requirePerm('hrm'), ah(async (req, res) => {
  const d = clean(pick(req.body, EMP_FIELDS));
  if (!d.first_name || !d.last_name) throw bad('First and last name are required');
  const ins = await db.query('INSERT INTO employees SET ?', [d]);
  if (!d.code) await db.query('UPDATE employees SET code = ? WHERE id = ?', [`EMP${String(ins.insertId).padStart(4, '0')}`, ins.insertId]);
  res.json({ id: ins.insertId });
}));
r.put('/employees/:id', requirePerm('hrm'), ah(async (req, res) => {
  const d = clean(pick(req.body, EMP_FIELDS));
  if (d.status === 'terminated' && !d.termination_date) d.termination_date = today();
  if (Object.keys(d).length) await db.query('UPDATE employees SET ? WHERE id = ?', [d, req.params.id]);
  res.json({ ok: true });
}));

// recurring pay items
r.post('/employees/:id/pay-items', requirePerm('payroll'), ah(async (req, res) => {
  const b = req.body;
  if (!['earning', 'deduction'].includes(b.kind) || !b.name || !(Number(b.amount) >= 0)) throw bad('Kind, name and amount are required');
  await db.query('INSERT INTO employee_pay_items (employee_id, kind, name, amount, taxable, pre_tax) VALUES (?, ?, ?, ?, ?, ?)',
    [req.params.id, b.kind, b.name, round2(b.amount), b.kind === 'earning' ? (b.taxable ? 1 : 0) : 0, b.kind === 'deduction' ? (b.pre_tax ? 1 : 0) : 0]);
  res.json({ ok: true });
}));
r.put('/pay-items/:id', requirePerm('payroll'), ah(async (req, res) => {
  const d = pick(req.body, ['name', 'amount', 'taxable', 'pre_tax', 'active']);
  await db.query('UPDATE employee_pay_items SET ? WHERE id = ?', [d, req.params.id]); res.json({ ok: true });
}));
r.delete('/pay-items/:id', requirePerm('payroll'), ah(async (req, res) => { await db.query('DELETE FROM employee_pay_items WHERE id = ?', [req.params.id]); res.json({ ok: true }); }));

// ---------- leave ----------
async function leaveBalances(employeeId) {
  const y = new Date().getFullYear();
  return db.query(
    `SELECT t.id, t.name, t.days_per_year, t.paid,
       COALESCE((SELECT SUM(days) FROM leave_requests WHERE employee_id = ? AND leave_type_id = t.id AND status = 'approved' AND YEAR(start_date) = ?),0) taken,
       COALESCE((SELECT SUM(days) FROM leave_requests WHERE employee_id = ? AND leave_type_id = t.id AND status = 'pending' AND YEAR(start_date) = ?),0) pending,
       t.days_per_year - COALESCE((SELECT SUM(days) FROM leave_requests WHERE employee_id = ? AND leave_type_id = t.id AND status = 'approved' AND YEAR(start_date) = ?),0) balance
     FROM leave_types t WHERE t.active = 1 ORDER BY t.id`, [employeeId, y, employeeId, y, employeeId, y]);
}
r.get('/leave-types', requirePerm('hrm'), ah(async (req, res) => res.json(await db.query('SELECT * FROM leave_types WHERE active = 1 ORDER BY id'))));
r.post('/leave-types', requirePerm('hrm'), ah(async (req, res) => {
  if (!req.body.name) throw bad('Name required');
  await db.query('INSERT INTO leave_types (name, days_per_year, paid) VALUES (?, ?, ?)', [req.body.name, Number(req.body.days_per_year || 0), req.body.paid ? 1 : 0]);
  res.json({ ok: true });
}));
r.put('/leave-types/:id', requirePerm('hrm'), ah(async (req, res) => {
  await db.query('UPDATE leave_types SET ? WHERE id = ?', [pick(req.body, ['name', 'days_per_year', 'paid', 'active']), req.params.id]); res.json({ ok: true });
}));
r.get('/leave', requirePerm('hrm'), ah(async (req, res) => {
  const cond = [], args = [];
  if (req.query.status) { cond.push('l.status = ?'); args.push(req.query.status); }
  res.json(await db.query(
    `SELECT l.*, t.name type, t.paid, CONCAT(e.first_name, ' ', e.last_name) employee, u.name decided_by_name
     FROM leave_requests l JOIN leave_types t ON t.id = l.leave_type_id JOIN employees e ON e.id = l.employee_id LEFT JOIN users u ON u.id = l.decided_by
     ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY l.status = 'pending' DESC, l.start_date DESC LIMIT 500`, args));
}));
r.post('/leave', requirePerm('hrm'), ah(async (req, res) => {
  const b = req.body;
  if (!b.employee_id || !b.leave_type_id || !b.start_date || !b.end_date) throw bad('Employee, leave type and dates are required');
  if (b.end_date < b.start_date) throw bad('End date is before start date');
  const days = b.days !== undefined && b.days !== '' ? Number(b.days) : payroll.workingDays(b.start_date, b.end_date);
  if (!(days > 0)) throw bad('Leave must cover at least one working day');
  const overlap = await db.one(`SELECT id FROM leave_requests WHERE employee_id = ? AND status IN ('pending','approved') AND start_date <= ? AND end_date >= ?`, [b.employee_id, b.end_date, b.start_date]);
  if (overlap) throw bad('This employee already has leave booked in those dates');
  const ins = await db.query('INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [b.employee_id, b.leave_type_id, b.start_date, b.end_date, days, b.reason || null, req.user.id]);
  res.json({ id: ins.insertId, days });
}));
r.post('/leave/:id/:action(approve|reject|cancel)', requirePerm('hrm'), ah(async (req, res) => {
  const l = await db.one('SELECT * FROM leave_requests WHERE id = ?', [req.params.id]);
  if (!l) throw notFound('Leave request');
  const to = { approve: 'approved', reject: 'rejected', cancel: 'cancelled' }[req.params.action];
  if (req.params.action !== 'cancel' && l.status !== 'pending') throw bad('Only pending requests can be approved or rejected');
  if (req.params.action === 'approve') {
    const bal = (await leaveBalances(l.employee_id)).find(b => b.id === l.leave_type_id);
    if (bal && Number(bal.days_per_year) > 0 && Number(l.days) > Number(bal.balance) && !req.body.allow_negative)
      throw bad(`Only ${bal.balance} day(s) of ${bal.name} left. Approve anyway with "allow negative".`);
  }
  await db.query('UPDATE leave_requests SET status = ?, decided_by = ?, decided_at = NOW() WHERE id = ?', [to, req.user.id, l.id]);
  res.json({ ok: true });
}));

// ---------- payroll runs ----------
r.get('/payroll', requirePerm('payroll'), ah(async (req, res) => {
  res.json(await db.query(`SELECT r.*, t.name paye_table FROM payroll_runs r LEFT JOIN paye_tables t ON t.id = r.paye_table_id ORDER BY r.period DESC`));
}));
r.get('/payroll/:id', requirePerm('payroll'), ah(async (req, res) => {
  const run = await db.one(`SELECT r.*, t.name paye_table, t.band_monthly, t.credit_monthly, u.name approved_by_name FROM payroll_runs r
    LEFT JOIN paye_tables t ON t.id = r.paye_table_id LEFT JOIN users u ON u.id = r.approved_by WHERE r.id = ?`, [req.params.id]);
  if (!run) throw notFound('Payroll run');
  run.payslips = await db.query(
    `SELECT p.*, e.code, CONCAT(e.first_name, ' ', e.last_name) name, e.job_title, e.id_number, e.tin, e.pay_method, e.bank_name, e.bank_account,
       e.mobile_money_number, d.name department
     FROM payslips p JOIN employees e ON e.id = p.employee_id LEFT JOIN departments d ON d.id = e.department_id
     WHERE p.run_id = ? ORDER BY e.last_name, e.first_name`, [run.id]);
  for (const p of run.payslips) { p.lines = typeof p.detail === 'string' ? JSON.parse(p.detail) : (p.detail || []); delete p.detail; }
  run.adjustments = await db.query(`SELECT a.*, CONCAT(e.first_name, ' ', e.last_name) employee FROM payslip_adjustments a JOIN employees e ON e.id = a.employee_id WHERE run_id = ?`, [run.id]);
  res.json(run);
}));
r.post('/payroll', requirePerm('payroll'), ah(async (req, res) => res.json({ id: await payroll.createRun(req.user, req.body) })));
r.post('/payroll/:id/recalculate', requirePerm('payroll'), ah(async (req, res) => { await payroll.recalc(Number(req.params.id)); res.json({ ok: true }); }));
r.post('/payroll/:id/adjustments', requirePerm('payroll'), ah(async (req, res) => {
  const b = req.body;
  const run = await db.one('SELECT status FROM payroll_runs WHERE id = ?', [req.params.id]);
  if (!run || run.status !== 'draft') throw bad('Only draft runs can be changed');
  if (!b.employee_id || !['earning', 'deduction'].includes(b.kind) || !b.name || !(Number(b.amount) > 0)) throw bad('Employee, type, description and amount are required');
  await db.query('INSERT INTO payslip_adjustments (run_id, employee_id, kind, name, amount, taxable, pre_tax) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [req.params.id, b.employee_id, b.kind, b.name, round2(b.amount), b.kind === 'earning' ? (b.taxable ? 1 : 0) : 0, b.kind === 'deduction' ? (b.pre_tax ? 1 : 0) : 0]);
  await payroll.recalc(Number(req.params.id));
  res.json({ ok: true });
}));
r.delete('/payroll/:id/adjustments/:aid', requirePerm('payroll'), ah(async (req, res) => {
  const run = await db.one('SELECT status FROM payroll_runs WHERE id = ?', [req.params.id]);
  if (!run || run.status !== 'draft') throw bad('Only draft runs can be changed');
  await db.query('DELETE FROM payslip_adjustments WHERE id = ? AND run_id = ?', [req.params.aid, req.params.id]);
  await payroll.recalc(Number(req.params.id));
  res.json({ ok: true });
}));
r.put('/payroll/:id', requirePerm('payroll'), ah(async (req, res) => {
  const run = await db.one('SELECT status FROM payroll_runs WHERE id = ?', [req.params.id]);
  if (!run || run.status !== 'draft') throw bad('Only draft runs can be changed');
  const d = pick(req.body, ['pay_date', 'notes', 'paye_enabled']);
  if (d.paye_enabled !== undefined) d.paye_enabled = d.paye_enabled ? 1 : 0;
  await db.query('UPDATE payroll_runs SET ? WHERE id = ?', [d, req.params.id]);
  await payroll.recalc(Number(req.params.id));
  res.json({ ok: true });
}));
r.delete('/payroll/:id', requirePerm('payroll'), ah(async (req, res) => {
  const x = await db.query(`DELETE FROM payroll_runs WHERE id = ? AND status = 'draft'`, [req.params.id]);
  if (!x.affectedRows) throw bad('Only draft runs can be deleted');
  res.json({ ok: true });
}));
r.post('/payroll/:id/approve', requirePerm('payroll'), ah(async (req, res) => { await payroll.approve(req.user, Number(req.params.id)); res.json({ ok: true }); }));
r.post('/payroll/:id/pay', requirePerm('payroll'), ah(async (req, res) => { await payroll.markPaid(req.user, Number(req.params.id), req.body); res.json({ ok: true }); }));
r.post('/payroll/:id/reopen', requirePerm('payroll'), ah(async (req, res) => { await payroll.reopen(req.user, Number(req.params.id)); res.json({ ok: true }); }));

r.get('/paye-report', requirePerm('payroll'), ah(async (req, res) => res.json(await payroll.payeReport(req.query.period || today().slice(0, 7)))));
r.post('/paye-remit', requirePerm('payroll'), ah(async (req, res) => { await payroll.remitPaye(req.user, req.body); res.json({ ok: true }); }));

module.exports = r;
