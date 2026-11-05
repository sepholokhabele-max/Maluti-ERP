/**
 * Payroll with Lesotho PAYE.
 *
 * PAYE (monthly): 20% on taxable income up to the band, 30% on the excess, less a non-refundable monthly tax credit.
 * Bands/credits are stored per tax year in `paye_tables` (2025/26 and 2026/27 seeded from Revenue Services Lesotho)
 * and the table in force for the pay period is used. Contributions flagged "pre-tax" (e.g. approved pension fund /
 * retirement annuity) reduce taxable income. PAYE can be switched off company-wide (Settings) or per employee.
 */
const db = require('../db');
const accounting = require('./accounting');
const { round2, bad, notFound, HttpError } = require('../util');

const DEFAULT_HRM = { enabled: true, paye_enabled: true, working_days_per_month: 21.67 };

async function settings() { return { ...DEFAULT_HRM, ...((await db.getSetting('hrm', {})) || {}) }; }

async function requireEnabled() {
  const s = await settings();
  if (!s.enabled) throw new HttpError(403, 'The HR & Payroll module is turned off. An administrator can turn it on in Settings → HR & Payroll.');
  return s;
}

/** Lesotho PAYE for one month */
function calcPaye(taxable, t) {
  taxable = Math.max(0, round2(taxable));
  if (!t || taxable <= 0) return { tax_before_credit: 0, tax_credit: 0, paye: 0 };
  const band = Number(t.band_monthly);
  const lower = Math.min(taxable, band) * Number(t.lower_rate) / 100;
  const upper = Math.max(0, taxable - band) * Number(t.upper_rate) / 100;
  const before = round2(lower + upper);
  const credit = round2(Math.min(before, Number(t.credit_monthly)));
  return { tax_before_credit: before, tax_credit: credit, paye: round2(before - credit) };
}

const periodStart = p => `${p}-01`;
function periodEnd(p) { const [y, m] = p.split('-').map(Number); const d = new Date(y, m, 0).getDate(); return `${p}-${String(d).padStart(2, '0')}`; }
function checkPeriod(p) { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(p || ''))) throw bad('Period must look like 2026-11'); return p; }

async function tableFor(conn, period) {
  return conn.one('SELECT * FROM paye_tables WHERE effective_from <= ? ORDER BY effective_from DESC LIMIT 1', [periodEnd(period)]);
}

/** Fraction of the month an employee was employed (pro-rata for joiners/leavers) */
function workedFraction(emp, period) {
  const s = new Date(periodStart(period) + 'T00:00:00'), e = new Date(periodEnd(period) + 'T00:00:00');
  const days = Math.round((e - s) / 86400000) + 1;
  const from = emp.hire_date && new Date(emp.hire_date + 'T00:00:00') > s ? new Date(emp.hire_date + 'T00:00:00') : s;
  const to = emp.termination_date && new Date(emp.termination_date + 'T00:00:00') < e ? new Date(emp.termination_date + 'T00:00:00') : e;
  if (to < from) return 0;
  return Math.min(1, (Math.round((to - from) / 86400000) + 1) / days);
}

/** Compute one payslip */
function computeSlip(emp, items, adjustments, table, payeOn) {
  const frac = workedFraction(emp, emp._period);
  const basic = round2(Number(emp.basic_salary) * frac);
  const lines = [{ kind: 'earning', name: frac < 1 ? `Basic salary (${Math.round(frac * 100)}% of month)` : 'Basic salary', amount: basic, taxable: 1 }];
  for (const it of [...items, ...adjustments]) {
    lines.push({ kind: it.kind, name: it.name, amount: round2(it.amount), taxable: it.kind === 'earning' ? Number(it.taxable) : 0,
      pre_tax: it.kind === 'deduction' ? Number(it.pre_tax) : 0, once: !!it.run_id });
  }
  const earnings = lines.filter(l => l.kind === 'earning');
  const deductions = lines.filter(l => l.kind === 'deduction');
  const gross = round2(earnings.reduce((s, l) => s + l.amount, 0));
  const taxableEarn = round2(earnings.filter(l => l.taxable).reduce((s, l) => s + l.amount, 0));
  const preTax = round2(deductions.filter(l => l.pre_tax).reduce((s, l) => s + l.amount, 0));
  const taxable = Math.max(0, round2(taxableEarn - preTax));
  const tax = payeOn && Number(emp.paye_applies) ? calcPaye(taxable, table) : { tax_before_credit: 0, tax_credit: 0, paye: 0 };
  const other = round2(deductions.reduce((s, l) => s + l.amount, 0));
  if (tax.paye) lines.push({ kind: 'tax', name: 'PAYE', amount: tax.paye });
  return { basic, earnings_total: round2(gross - basic), gross, pre_tax_deductions: preTax, taxable_income: taxable, ...tax,
    other_deductions: other, net: round2(gross - tax.paye - other), lines };
}

async function compute(conn, runId) {
  const run = await conn.one('SELECT * FROM payroll_runs WHERE id = ? FOR UPDATE', [runId]);
  if (!run) throw notFound('Payroll run');
  if (run.status !== 'draft') throw bad('Only draft payroll runs can be recalculated');
  const table = await tableFor(conn, run.period);
  if (run.paye_enabled && !table) throw bad(`No PAYE table covers ${run.period}. Add one under HR & Payroll → Settings.`);
  const emps = await conn.query(
    `SELECT * FROM employees WHERE status <> 'terminated' OR (termination_date IS NOT NULL AND termination_date >= ?)`, [periodStart(run.period)]);
  const eligible = emps.filter(e => (!e.hire_date || e.hire_date <= periodEnd(run.period)) && e.status !== 'suspended');
  await conn.query('DELETE FROM payslips WHERE run_id = ?', [run.id]);
  const tot = { gross: 0, paye: 0, ded: 0, net: 0 };
  for (const e of eligible) {
    e._period = run.period;
    const items = await conn.query('SELECT * FROM employee_pay_items WHERE employee_id = ? AND active = 1', [e.id]);
    const adj = await conn.query('SELECT * FROM payslip_adjustments WHERE run_id = ? AND employee_id = ?', [run.id, e.id]);
    const s = computeSlip(e, items, adj, table, !!run.paye_enabled);
    if (s.gross === 0 && !adj.length) continue;
    await conn.query(
      `INSERT INTO payslips (run_id, employee_id, basic, earnings_total, gross, pre_tax_deductions, taxable_income, tax_before_credit, tax_credit, paye, other_deductions, net, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [run.id, e.id, s.basic, s.earnings_total, s.gross, s.pre_tax_deductions, s.taxable_income, s.tax_before_credit, s.tax_credit, s.paye, s.other_deductions, s.net, JSON.stringify(s.lines)]);
    tot.gross += s.gross; tot.paye += s.paye; tot.ded += s.other_deductions; tot.net += s.net;
  }
  const n = (await conn.one('SELECT COUNT(*) n FROM payslips WHERE run_id = ?', [run.id])).n;
  await conn.query(`UPDATE payroll_runs SET paye_table_id = ?, gross_total = ?, paye_total = ?, deductions_total = ?, net_total = ?, employees = ? WHERE id = ?`,
    [table ? table.id : null, round2(tot.gross), round2(tot.paye), round2(tot.ded), round2(tot.net), n, run.id]);
}

async function createRun(user, { period, pay_date, notes }) {
  checkPeriod(period);
  const s = await requireEnabled();
  if (await db.one('SELECT id FROM payroll_runs WHERE period = ?', [period])) throw bad(`A payroll run for ${period} already exists`);
  return db.tx(async c => {
    const r = await c.query('INSERT INTO payroll_runs (period, pay_date, paye_enabled, notes, created_by) VALUES (?, ?, ?, ?, ?)',
      [period, pay_date || periodEnd(period), s.paye_enabled ? 1 : 0, notes || null, user.id]);
    await compute(c, r.insertId);
    return r.insertId;
  });
}

async function recalc(id) { await db.tx(c => compute(c, id)); }

async function approve(user, id) {
  await db.tx(async c => {
    const run = await c.one('SELECT * FROM payroll_runs WHERE id = ? FOR UPDATE', [id]);
    if (!run) throw notFound('Payroll run');
    if (run.status !== 'draft') throw bad('Run is already approved');
    await compute(c, id);
    const r = await c.one('SELECT * FROM payroll_runs WHERE id = ?', [id]);
    if (!r.employees) throw bad('There are no payslips in this run');
    const entry = await accounting.post(c, {
      date: r.pay_date, reference: `PAYROLL ${r.period}`, memo: `Payroll ${r.period} (${r.employees} employees)`, source_type: 'payroll', source_id: r.id, user_id: user.id,
      lines: [
        { code: '6200', debit: r.gross_total, description: 'Gross salaries & wages' },
        { code: '2200', credit: r.paye_total, description: 'PAYE withheld' },
        { code: '2210', credit: r.deductions_total, description: 'Other payroll deductions' },
        { code: '2300', credit: r.net_total, description: 'Net pay due to employees' }
      ] });
    await c.query(`UPDATE payroll_runs SET status = 'approved', approved_by = ?, approved_at = NOW(), journal_entry_id = ? WHERE id = ?`, [user.id, entry, id]);
  });
}

const PAY_ACCOUNT = { bank: '1050', cash: '1000', mobile_money: '1020' };

async function markPaid(user, id, { date } = {}) {
  await db.tx(async c => {
    const r = await c.one('SELECT * FROM payroll_runs WHERE id = ? FOR UPDATE', [id]);
    if (!r) throw notFound('Payroll run');
    if (r.status !== 'approved') throw bad('Approve the run before paying it');
    // wages already paid through a MyWallet bulk batch (Smartel) were booked line by line – leave them out here
    const viaBulk = await require('./smartel').bulkPaidForRun(c, id);
    const bulkBy = new Map(viaBulk.map(b => [b.employee_id, Number(b.amount)]));
    const slips = await c.query(`SELECT p.employee_id, p.net, e.pay_method FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.run_id = ?`, [id]);
    const byMethod = new Map();
    for (const sl of slips) { const left = round2(Number(sl.net) - (bulkBy.get(sl.employee_id) || 0)); if (left > 0) byMethod.set(sl.pay_method, round2((byMethod.get(sl.pay_method) || 0) + left)); }
    const toPay = round2([...byMethod.values()].reduce((a, v) => a + v, 0));
    const lines = toPay > 0 ? [{ code: '2300', debit: toPay, description: 'Net salaries paid' }] : [];
    for (const [method, net] of byMethod) lines.push({ code: PAY_ACCOUNT[method] || '1050', credit: net, description: `Salaries paid by ${method.replace('_', ' ')}` });
    const entry = lines.length ? await accounting.post(c, { date: date || r.pay_date, reference: `SALARIES ${r.period}`, memo: `Salary payments ${r.period}`,
      source_type: 'payroll_payment', source_id: r.id, user_id: user.id, lines }) : null;
    await c.query(`UPDATE payroll_runs SET status = 'paid', payment_entry_id = ? WHERE id = ?`, [entry, id]);
  });
}

async function reverseEntry(c, entryId, ref, user) {
  const lines = await c.query(`SELECT a.code, l.debit, l.credit, l.description FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ?`, [entryId]);
  await accounting.post(c, { reference: ref, memo: 'Reversal', source_type: 'payroll_reversal', user_id: user.id,
    lines: lines.map(l => ({ code: l.code, debit: l.credit, credit: l.debit, description: l.description })) });
}

async function reopen(user, id) {
  if (user.role !== 'admin') throw new HttpError(403, 'Only an administrator can reopen a payroll run');
  await db.tx(async c => {
    const r = await c.one('SELECT * FROM payroll_runs WHERE id = ? FOR UPDATE', [id]);
    if (!r) throw notFound('Payroll run');
    if (r.status === 'draft') throw bad('Run is already a draft');
    if ((await require('./smartel').bulkPaidForRun(c, id)).length) throw bad('Some wages in this run were already paid through MyWallet bulk. They cannot be taken back here – make a correction in the next run.');
    if (r.payment_entry_id) await reverseEntry(c, r.payment_entry_id, `SALARIES ${r.period} REVERSED`, user);
    if (r.journal_entry_id) await reverseEntry(c, r.journal_entry_id, `PAYROLL ${r.period} REVERSED`, user);
    await c.query(`UPDATE payroll_runs SET status = 'draft', journal_entry_id = NULL, payment_entry_id = NULL, approved_by = NULL, approved_at = NULL WHERE id = ?`, [id]);
  });
}

/** Monthly PAYE return figures for RSL */
async function payeReport(period) {
  checkPeriod(period);
  const run = await db.one('SELECT * FROM payroll_runs WHERE period = ?', [period]);
  if (!run) return { period, run: null, rows: [], totals: { gross: 0, taxable: 0, paye: 0 } };
  const rows = await db.query(
    `SELECT e.code, CONCAT(e.first_name, ' ', e.last_name) name, e.id_number, e.tin, p.gross, p.taxable_income, p.tax_before_credit, p.tax_credit, p.paye
     FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.run_id = ? ORDER BY e.last_name, e.first_name`, [run.id]);
  const [y, m] = period.split('-').map(Number);
  const due = new Date(y, m, 15);
  const sum = k => round2(rows.reduce((s, r) => s + Number(r[k]), 0));
  return { period, run, rows, due_date: `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-15`,
    totals: { gross: sum('gross'), taxable: sum('taxable_income'), paye: sum('paye') } };
}

/** Pay PAYE over to RSL: Dr PAYE payable, Cr bank */
async function remitPaye(user, { period, amount, from_account, reference }) {
  amount = round2(amount);
  if (!(amount > 0)) throw bad('Amount required');
  await db.tx(c => accounting.post(c, { reference: reference || `PAYE ${period}`, memo: `PAYE paid to RSL for ${period}`, source_type: 'paye_remittance', user_id: user.id,
    lines: [{ code: '2200', debit: amount }, { code: from_account || '1050', credit: amount }] }));
}

/** Count Monday–Friday days between two dates (inclusive) */
function workingDays(from, to) {
  let n = 0; const d = new Date(from + 'T00:00:00'), e = new Date(to + 'T00:00:00');
  if (e < d) return 0;
  for (; d <= e; d.setDate(d.getDate() + 1)) { const w = d.getDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}

module.exports = { DEFAULT_HRM, settings, requireEnabled, calcPaye, tableFor, createRun, recalc, approve, markPaid, reopen, payeReport, remitPaye,
  workingDays, checkPeriod, periodEnd, workedFraction };
