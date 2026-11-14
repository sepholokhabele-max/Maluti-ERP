// Audit: a tamper-evident ledger (every journal entry is sealed into a SHA-256 hash chain), integrity checks, control
// account reconciliations, computer-assisted audit tests (exception reports, Benford's law, number-sequence gaps),
// the audit trail and login history, auditor queries, and the year-end audit pack.
const crypto = require('crypto');
const db = require('../db');
const { round2, bad, notFound, today } = require('../util');

const r2 = n => round2(Number(n) || 0);

/* ============================== hash chain ============================== */
// An entry is sealed once it is at least a minute old (so no transaction is still writing it). The seal covers the date,
// reference, source and every line (account, amounts, partner, cost centre) plus the previous seal: changing or deleting
// any sealed entry breaks every seal after it.
async function canonical(e) {
  const lines = await db.query('SELECT a.code, l.debit, l.credit, l.partner_id, l.cost_centre_id, l.description FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ? ORDER BY l.id', [e.id]);
  return JSON.stringify([e.id, String(e.entry_date).slice(0, 10), e.reference || '', e.memo || '', e.source_type || '', e.source_id || null, e.user_id || null,
    lines.map(l => [l.code, Number(l.debit).toFixed(2), Number(l.credit).toFixed(2), l.partner_id || null, l.cost_centre_id || null, l.description || ''])]);
}
const sha = (prev, body) => crypto.createHash('sha256').update((prev || 'GENESIS') + '|' + body).digest('hex');
let sealing = false;
async function seal({ all = false } = {}) {
  if (sealing) return { sealed: 0 };
  sealing = true;
  try {
    const last = await db.one('SELECT hash, seal_seq FROM journal_entries WHERE seal_seq IS NOT NULL ORDER BY seal_seq DESC LIMIT 1');
    let prev = last ? last.hash : null, seq = last ? Number(last.seal_seq) : 0, n = 0;
    const rows = await db.query(`SELECT * FROM journal_entries WHERE seal_seq IS NULL ${all ? '' : 'AND created_at < DATE_SUB(NOW(), INTERVAL 1 MINUTE)'} ORDER BY id LIMIT 5000`);
    for (const e of rows) {
      const h = sha(prev, await canonical(e)); seq++;
      const u = await db.query('UPDATE journal_entries SET hash = ?, seal_seq = ? WHERE id = ? AND seal_seq IS NULL', [h, seq, e.id]);
      if (u.affectedRows) { prev = h; n++; } else seq--;
    }
    return { sealed: n };
  } finally { sealing = false; }
}
async function verifyChain() {
  await seal();
  const rows = await db.query('SELECT * FROM journal_entries WHERE seal_seq IS NOT NULL ORDER BY seal_seq');
  let prev = null, expectSeq = 1; const broken = [];
  for (const e of rows) {
    if (Number(e.seal_seq) !== expectSeq) broken.push({ id: e.id, problem: `sealed entry missing before #${e.id} (sequence ${expectSeq})` });
    expectSeq = Number(e.seal_seq) + 1;
    const h = sha(prev, await canonical(e));
    if (h !== e.hash) { broken.push({ id: e.id, number: e.number, date: String(e.entry_date).slice(0, 10), reference: e.reference, problem: 'entry or one of its lines was changed after it was sealed' }); }
    prev = e.hash; // continue from the stored seal so one change is reported once
    if (broken.length > 200) break;
  }
  const unsealed = await db.one('SELECT COUNT(*) n FROM journal_entries WHERE seal_seq IS NULL');
  return { checked: rows.length, unsealed: Number(unsealed.n), intact: !broken.length, broken, at: new Date().toISOString() };
}

/* ============================== integrity & control accounts ============================== */
async function integrity() {
  const unbalanced = await db.query(`SELECT e.id, e.entry_date, e.reference, SUM(l.debit) dr, SUM(l.credit) cr FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id GROUP BY e.id HAVING ABS(SUM(l.debit) - SUM(l.credit)) > 0.009 LIMIT 100`);
  const empty = await db.query(`SELECT e.id, e.entry_date, e.reference FROM journal_entries e LEFT JOIN journal_lines l ON l.entry_id = e.id WHERE l.id IS NULL LIMIT 100`);
  const tot = await db.one('SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c FROM journal_lines');
  const inactive = await db.query(`SELECT a.code, a.name, COUNT(*) n FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.active = 0 GROUP BY a.id`);
  return { unbalanced, empty_entries: empty, ledger_debits: r2(tot.d), ledger_credits: r2(tot.c), ledger_balanced: Math.abs(Number(tot.d) - Number(tot.c)) < 0.01, postings_to_inactive: inactive, chain: await verifyChain() };
}
/** control account vs. the documents behind it (the sub-ledger) */
async function controlRecon(asOf) {
  asOf = asOf || today();
  const bal = async code => r2((await db.one(`SELECT COALESCE(SUM(l.debit - l.credit),0) b FROM journal_lines l JOIN accounts a ON a.id = l.account_id JOIN journal_entries e ON e.id = l.entry_id WHERE a.code = ? AND e.entry_date <= ?`, [code, asOf])).b);
  const out = [];
  // receivables: open customer invoices, less money received but not yet matched to an invoice
  const ar = await bal('1100');
  const arInv = r2((await db.one(`SELECT COALESCE(SUM(total - amount_paid),0) s FROM invoices WHERE kind = 'customer_invoice' AND status IN ('posted','partial') AND invoice_date <= ?`, [asOf])).s);
  const arByP = await db.query(`SELECT p.id, p.name, ROUND(COALESCE((SELECT SUM(l.debit - l.credit) FROM journal_lines l JOIN accounts a ON a.id = l.account_id JOIN journal_entries e ON e.id = l.entry_id WHERE a.code = '1100' AND l.partner_id = p.id AND e.entry_date <= ?),0), 2) ledger,
      ROUND(COALESCE((SELECT SUM(i.total - i.amount_paid) FROM invoices i WHERE i.partner_id = p.id AND i.kind = 'customer_invoice' AND i.status IN ('posted','partial') AND i.invoice_date <= ?),0), 2) documents FROM partners p HAVING ABS(ledger - documents) > 0.009 ORDER BY ABS(ledger - documents) DESC LIMIT 30`, [asOf, asOf]);
  const noPartner = r2((await db.one(`SELECT COALESCE(SUM(l.debit - l.credit),0) b FROM journal_lines l JOIN accounts a ON a.id = l.account_id JOIN journal_entries e ON e.id = l.entry_id WHERE a.code = '1100' AND l.partner_id IS NULL AND e.entry_date <= ?`, [asOf])).b);
  out.push({ code: '1100', name: 'Accounts receivable', ledger: ar, subledger: arInv, difference: r2(ar - arInv), explained_by: 'Customer credits (money received before an invoice) and postings without a customer', no_partner: noPartner, by_partner: arByP });
  // payables
  const ap = r2(-(await bal('2000')));
  const apInv = r2((await db.one(`SELECT COALESCE(SUM(total - amount_paid),0) s FROM invoices WHERE kind = 'supplier_bill' AND status IN ('posted','partial') AND invoice_date <= ?`, [asOf])).s);
  const apByP = await db.query(`SELECT p.id, p.name, ROUND(-COALESCE((SELECT SUM(l.debit - l.credit) FROM journal_lines l JOIN accounts a ON a.id = l.account_id JOIN journal_entries e ON e.id = l.entry_id WHERE a.code = '2000' AND l.partner_id = p.id AND e.entry_date <= ?),0), 2) ledger,
      ROUND(COALESCE((SELECT SUM(i.total - i.amount_paid) FROM invoices i WHERE i.partner_id = p.id AND i.kind = 'supplier_bill' AND i.status IN ('posted','partial') AND i.invoice_date <= ?),0), 2) documents FROM partners p HAVING ABS(ledger - documents) > 0.009 ORDER BY ABS(ledger - documents) DESC LIMIT 30`, [asOf, asOf]);
  out.push({ code: '2000', name: 'Accounts payable', ledger: ap, subledger: apInv, difference: r2(ap - apInv), explained_by: 'Payments on account, fuel and services on suppliers\' accounts not yet billed', by_partner: apByP });
  // inventory: today only (stock quantities are kept as at now)
  if (asOf === today()) {
    const inv = await bal('1200');
    const st = r2((await db.one(`SELECT COALESCE(SUM(stock_qty * cost),0) v FROM products WHERE type = 'stock' AND active = 1`).catch(() => ({ v: 0 }))).v);
    out.push({ code: '1200', name: 'Inventory', ledger: inv, subledger: st, difference: r2(inv - st), explained_by: 'Stock bought before S-ERP without an opening balance, cost changes and negative stock' });
  }
  // fixed assets: cost and accumulated depreciation per account vs the register
  const fa = await db.query(`SELECT k.asset_code, k.accum_code, ROUND(SUM(a.cost),2) cost, ROUND(SUM(a.accum_dep),2) acc FROM fixed_assets a JOIN asset_categories k ON k.id = a.category_id WHERE a.status = 'active' GROUP BY k.asset_code, k.accum_code`).catch(() => []);
  const faCost = new Map(), faAcc = new Map();
  for (const x of fa) { faCost.set(x.asset_code, r2((faCost.get(x.asset_code) || 0) + Number(x.cost))); faAcc.set(x.accum_code, r2((faAcc.get(x.accum_code) || 0) + Number(x.acc))); }
  for (const [code, v] of faCost) { const l = await bal(code); out.push({ code, name: 'Fixed assets at cost', ledger: l, subledger: v, difference: r2(l - v), explained_by: 'Assets bought on supplier bills to another account, or not in the register' }); }
  for (const [code, v] of faAcc) { const l = r2(-(await bal(code))); out.push({ code, name: 'Accumulated depreciation', ledger: l, subledger: v, difference: r2(l - v), explained_by: 'Depreciation posted by hand' }); }
  return { as_of: asOf, accounts: out };
}

/* ============================== exception reports (CAATs) ============================== */
async function exceptions(from, to) {
  const F = require('./ledger'); const s = await F.settings();
  const T = [];
  const add = (key, title, risk, why, rows, cols) => T.push({ key, title, risk, why, count: rows.length, rows: rows.slice(0, 500), cols });
  const range = [from, to];
  add('control_manual', 'Manual journals posted to control accounts', 'high', 'Control accounts should only be changed by their documents (invoices, bills, stock, VAT returns, payroll).',
    await db.query(`SELECT e.id entry_id, e.entry_date, e.number, e.reference, a.code, a.name account, l.debit, l.credit, u.name user_name FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id JOIN accounts a ON a.id = l.account_id LEFT JOIN users u ON u.id = e.user_id
      WHERE e.source_type IN ('manual','manual_reversal') AND a.is_control = 1 AND e.entry_date BETWEEN ? AND ? ORDER BY e.entry_date`, range), ['entry_date', 'number', 'reference', 'code', 'account', 'debit', 'credit', 'user_name']);
  add('backdated', `Entries dated more than ${s.backdate_days} days before they were captured`, 'medium', 'Back-dating can move income or costs between periods.',
    await db.query(`SELECT e.id entry_id, e.entry_date, DATE(e.created_at) captured, DATEDIFF(DATE(e.created_at), e.entry_date) days, e.number, e.reference, e.source_type, u.name user_name, (SELECT SUM(debit) FROM journal_lines WHERE entry_id = e.id) amount
      FROM journal_entries e LEFT JOIN users u ON u.id = e.user_id WHERE DATEDIFF(DATE(e.created_at), e.entry_date) > ? AND e.entry_date BETWEEN ? AND ? AND COALESCE(e.source_type,'') NOT IN ('opening','year_end','depreciation') ORDER BY days DESC`, [s.backdate_days, from, to]), ['entry_date', 'captured', 'days', 'number', 'reference', 'source_type', 'amount', 'user_name']);
  add('after_hours', 'Manual journals captured at weekends or outside 06:00–20:00', 'medium', 'Unusual timing can point to journals made without review.',
    await db.query(`SELECT e.id entry_id, e.entry_date, e.created_at, e.number, e.reference, u.name user_name, (SELECT SUM(debit) FROM journal_lines WHERE entry_id = e.id) amount FROM journal_entries e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.source_type = 'manual' AND e.entry_date BETWEEN ? AND ? AND (DAYOFWEEK(e.created_at) IN (1,7) OR HOUR(e.created_at) < 6 OR HOUR(e.created_at) >= 20) ORDER BY e.created_at`, range), ['entry_date', 'created_at', 'number', 'reference', 'amount', 'user_name']);
  add('round', 'Round-amount manual journals (M 10 000 and above, whole thousands)', 'low', 'Estimates and plugs are often round numbers – check the support.',
    await db.query(`SELECT e.id entry_id, e.entry_date, e.number, e.reference, e.memo, u.name user_name, x.amount FROM journal_entries e JOIN (SELECT entry_id, SUM(debit) amount FROM journal_lines GROUP BY entry_id) x ON x.entry_id = e.id LEFT JOIN users u ON u.id = e.user_id
      WHERE e.source_type = 'manual' AND e.entry_date BETWEEN ? AND ? AND x.amount >= 10000 AND MOD(x.amount, 1000) = 0 ORDER BY x.amount DESC`, range), ['entry_date', 'number', 'reference', 'memo', 'amount', 'user_name']);
  add('self_posted', 'Large manual journals posted by the person who prepared them', 'medium', 'Above the approval limit a second person should approve (Finance → Settings).',
    await db.query(`SELECT j.id batch_id, j.entry_date, j.number, j.reference, j.total amount, u.name user_name FROM journal_batches j LEFT JOIN users u ON u.id = j.created_by
      WHERE j.status = 'posted' AND j.approved_by = j.created_by AND j.total >= ? AND j.entry_date BETWEEN ? AND ? ORDER BY j.total DESC`, [Math.max(10000, s.manual_approval_limit || 0), from, to]), ['entry_date', 'number', 'reference', 'amount', 'user_name']);
  add('dup_bills', 'Possible duplicate supplier bills (same supplier and amount within 30 days)', 'high', 'Paying the same bill twice is a common loss.',
    await db.query(`SELECT a.id, a.number, b.number other, p.name supplier, a.total amount, a.invoice_date, b.invoice_date other_date FROM invoices a JOIN invoices b ON b.partner_id = a.partner_id AND b.kind = 'supplier_bill' AND b.id > a.id AND b.total = a.total AND ABS(DATEDIFF(a.invoice_date, b.invoice_date)) <= 30 AND b.status <> 'cancelled'
      JOIN partners p ON p.id = a.partner_id WHERE a.kind = 'supplier_bill' AND a.status <> 'cancelled' AND a.invoice_date BETWEEN ? AND ? ORDER BY a.total DESC`, range), ['supplier', 'number', 'invoice_date', 'other', 'other_date', 'amount']);
  add('supplier_staff', 'Suppliers sharing a phone number, ID / TIN with an employee', 'high', 'May indicate a fictitious supplier or a conflict of interest.',
    await db.query(`SELECT p.name supplier, p.phone supplier_phone, p.tax_number supplier_tin, CONCAT(e.first_name, ' ', e.last_name) employee, e.phone employee_phone FROM partners p JOIN employees e ON
      ((p.phone IS NOT NULL AND e.phone IS NOT NULL AND RIGHT(REPLACE(REPLACE(p.phone,' ',''),'+',''), 8) = RIGHT(REPLACE(REPLACE(e.phone,' ',''),'+',''), 8)) OR (p.tax_number IS NOT NULL AND p.tax_number <> '' AND (p.tax_number = e.tin OR p.tax_number = e.id_number)))
      WHERE p.is_supplier = 1`).catch(() => []), ['supplier', 'supplier_phone', 'supplier_tin', 'employee', 'employee_phone']);
  add('large_cash', `Cash payments out of M ${Number(s.large_cash).toLocaleString('en-US')} or more`, 'medium', 'Large cash payments are hard to trace – check the authority and support.',
    await db.query(`SELECT y.id, DATE(y.created_at) date, y.amount, p.name partner, y.reference, u.name user_name FROM payments y JOIN payment_methods m ON m.id = y.method_id LEFT JOIN partners p ON p.id = y.partner_id LEFT JOIN users u ON u.id = y.user_id
      WHERE y.direction = 'out' AND m.kind = 'cash' AND y.amount >= ? AND DATE(y.created_at) BETWEEN ? AND ? ORDER BY y.amount DESC`, [s.large_cash, from, to]), ['date', 'partner', 'reference', 'amount', 'user_name']);
  add('refunds', 'Till refunds and voids by cashier', 'medium', 'A cashier with many refunds or voids should be reviewed.',
    await db.query(`SELECT u.name user_name, SUM(o.refund_of IS NOT NULL) refunds, ROUND(SUM(CASE WHEN o.refund_of IS NOT NULL THEN ABS(o.total) ELSE 0 END),2) refunded, SUM(o.status = 'voided') voids FROM orders o JOIN users u ON u.id = o.user_id
      WHERE DATE(o.created_at) BETWEEN ? AND ? GROUP BY u.id HAVING refunds > 0 OR voids > 0 ORDER BY refunded DESC`, range).catch(() => []), ['user_name', 'refunds', 'refunded', 'voids']);
  add('gaps', 'Gaps in invoice number sequences', 'medium', 'Missing numbers may be deleted or unrecorded invoices.', await sequenceGaps(), ['series', 'missing', 'between']);
  add('failed_logins', 'Failed login attempts', 'low', 'Many failed attempts on one user name may be password guessing.',
    await db.query(`SELECT JSON_UNQUOTE(JSON_EXTRACT(details, '$.username')) username, COUNT(*) attempts, MAX(created_at) last, GROUP_CONCAT(DISTINCT ip) ips FROM audit_log WHERE action = 'login_failed' AND DATE(created_at) BETWEEN ? AND ? GROUP BY username ORDER BY attempts DESC`, range), ['username', 'attempts', 'last', 'ips']);
  return { from, to, tests: T, flagged: T.filter(t => t.count).length };
}
async function sequenceGaps() {
  const rows = await db.query(`SELECT number FROM invoices WHERE number REGEXP '^[A-Z]+/[0-9]{4}/[0-9]+$'`);
  const series = new Map();
  for (const r of rows) { const [p, y, n] = r.number.split('/'); const k = `${p}/${y}`; if (!series.has(k)) series.set(k, []); series.get(k).push(Number(n)); }
  const out = [];
  for (const [k, ns] of series) { ns.sort((a, b) => a - b); for (let i = 1; i < ns.length; i++) if (ns[i] - ns[i - 1] > 1) out.push({ series: k, missing: ns[i] - ns[i - 1] - 1, between: `${ns[i - 1]} and ${ns[i]}` }); }
  return out;
}
/** Benford's law: first digits of amounts should follow log10(1 + 1/d); large deviations suggest made-up numbers */
async function benford(from, to, source = 'all') {
  const where = source === 'manual' ? `AND e.source_type = 'manual'` : source === 'bills' ? `AND e.source_type IN ('supplier_bill','bill','expense')` : '';
  const rows = await db.query(`SELECT GREATEST(l.debit, l.credit) amt FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.entry_date BETWEEN ? AND ? ${where} AND GREATEST(l.debit, l.credit) >= 10`, [from, to]);
  const cnt = Array(10).fill(0);
  for (const r of rows) { const d = Number(String(Math.floor(Number(r.amt))).charAt(0)); if (d >= 1) cnt[d]++; }
  const n = cnt.reduce((a, b) => a + b, 0);
  const digits = []; let mad = 0;
  for (let d = 1; d <= 9; d++) { const exp = Math.log10(1 + 1 / d), act = n ? cnt[d] / n : 0; mad += Math.abs(act - exp); digits.push({ digit: d, count: cnt[d], actual_pct: r2(act * 100), expected_pct: r2(exp * 100) }); }
  mad = n ? mad / 9 : 0;
  // Nigrini's first-digit conformity bands
  const conformity = !n ? 'no data' : n < 300 ? 'too few amounts for a reliable test (need 300+)' : mad <= 0.006 ? 'close conformity' : mad <= 0.012 ? 'acceptable conformity' : mad <= 0.015 ? 'marginal – look closer' : 'nonconformity – investigate';
  return { from, to, source, amounts: n, digits, mad: Math.round(mad * 10000) / 10000, conformity };
}

/* ============================== audit trail ============================== */
async function trail(q) {
  const w = ['1=1'], a = [];
  if (q.user_id) { w.push('l.user_id = ?'); a.push(q.user_id); }
  if (q.action) { w.push('l.action LIKE ?'); a.push(q.action + '%'); }
  if (q.entity) { w.push('l.entity = ?'); a.push(q.entity); }
  if (q.from) { w.push('l.created_at >= ?'); a.push(q.from + ' 00:00:00'); }
  if (q.to) { w.push('l.created_at <= ?'); a.push(q.to + ' 23:59:59'); }
  if (q.q) { w.push('(l.details LIKE ? OR l.action LIKE ?)'); a.push(`%${q.q}%`, `%${q.q}%`); }
  return db.query(`SELECT l.*, u.name user_name FROM audit_log l LEFT JOIN users u ON u.id = l.user_id WHERE ${w.join(' AND ')} ORDER BY l.id DESC LIMIT 2000`, a);
}

/* ============================== queries ============================== */
const queries = q => db.query(`SELECT x.*, r.name raised_by_name, s.name assigned_name, w.name answered_by_name FROM audit_queries x LEFT JOIN users r ON r.id = x.raised_by LEFT JOIN users s ON s.id = x.assigned_to LEFT JOIN users w ON w.id = x.answered_by
  WHERE ${q.mine ? '(x.assigned_to = ? OR x.raised_by = ?)' : '1=1'} ${q.status ? 'AND x.status = ?' : ''} ORDER BY x.id DESC LIMIT 1000`, [...(q.mine ? [q.mine, q.mine] : []), ...(q.status ? [q.status] : [])]);
async function raiseQuery(user, b) {
  const subject = String(b.subject || '').trim(), question = String(b.question || '').trim();
  if (!subject || !question) throw bad('Give the subject and the question');
  return (await db.query('INSERT INTO audit_queries (entity, entity_id, subject, question, raised_by, assigned_to, risk) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [String(b.entity || 'general').slice(0, 40), Number(b.entity_id) || null, subject.slice(0, 200), question, user.id, Number(b.assigned_to) || null, ['low', 'medium', 'high'].includes(b.risk) ? b.risk : 'medium'])).insertId;
}
async function answerQuery(user, id, b) {
  const q = await db.one('SELECT * FROM audit_queries WHERE id = ?', [id]); if (!q) throw notFound('Query');
  if (q.status === 'closed') throw bad('This query is closed');
  const a = String(b.answer || '').trim(); if (!a) throw bad('Type the answer');
  await db.query(`UPDATE audit_queries SET answer = ?, answered_by = ?, answered_at = NOW(), status = 'answered' WHERE id = ?`, [a, user.id, id]);
}
async function closeQuery(user, id, b) {
  const q = await db.one('SELECT * FROM audit_queries WHERE id = ?', [id]); if (!q) throw notFound('Query');
  if (q.raised_by !== user.id && !user.permissions.includes('*')) throw bad('Only the auditor who raised the query closes it');
  await db.query(`UPDATE audit_queries SET status = ?, closed_at = IF(? = 'closed', NOW(), NULL) WHERE id = ?`, [b.reopen ? 'open' : 'closed', b.reopen ? 'open' : 'closed', id]);
}

/* ============================== audit pack ============================== */
async function pack(from, to) {
  const L = require('./ledger');
  const [tb, is, bs, cf, cr, ex, chain] = await Promise.all([L.trialBalance(from, to), L.incomeStatement(from, to), L.balanceSheet(to, `${Number(to.slice(0, 4)) - 1}${to.slice(4)}`), L.cashFlow(from, to), controlRecon(to <= today() ? to : today()), exceptions(from, to), verifyChain()]);
  const journals = await db.query(`SELECT e.id, e.entry_date, e.number, e.reference, e.memo, e.source_type, u.name user_name, a.code, a.name account, l.debit, l.credit, c.code cost_centre, p.name partner, e.created_at, e.hash
    FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id JOIN accounts a ON a.id = l.account_id LEFT JOIN users u ON u.id = e.user_id LEFT JOIN cost_centres c ON c.id = l.cost_centre_id LEFT JOIN partners p ON p.id = l.partner_id
    WHERE e.entry_date BETWEEN ? AND ? ORDER BY e.entry_date, e.id, l.id LIMIT 200000`, [from, to]);
  const aged = kind => db.query(`SELECT p.name, i.number, i.invoice_date, i.due_date, ROUND(i.total - i.amount_paid, 2) open, DATEDIFF(?, COALESCE(i.due_date, i.invoice_date)) days FROM invoices i JOIN partners p ON p.id = i.partner_id
    WHERE i.kind = ? AND i.status IN ('posted','partial') AND i.invoice_date <= ? ORDER BY p.name, i.invoice_date`, [to, kind, to]);
  const assets = await db.query(`SELECT a.asset_no, a.name, k.name category, a.location, a.in_service_date, a.cost, a.accum_dep, ROUND(a.cost - a.accum_dep, 2) nbv, a.status FROM fixed_assets a JOIN asset_categories k ON k.id = a.category_id ORDER BY a.asset_no`).catch(() => []);
  const queries_ = await db.query('SELECT id, subject, risk, status, question, answer FROM audit_queries ORDER BY id').catch(() => []);
  return { from, to, generated_at: new Date().toISOString(), company: (await db.getSetting('company', {})) || {}, trial_balance: tb, income_statement: is, balance_sheet: bs, cash_flow: cf,
    control_reconciliations: cr, exceptions: ex, chain, journals, receivables: await aged('customer_invoice'), payables: await aged('supplier_bill'), fixed_assets: assets, queries: queries_ };
}

module.exports = { seal, verifyChain, integrity, controlRecon, exceptions, benford, trail, queries, raiseQuery, answerQuery, closeQuery, pack, sequenceGaps };
