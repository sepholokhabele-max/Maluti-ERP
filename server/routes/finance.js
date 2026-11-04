// Finance: bank / mobile-money statement reconciliation, staff expense claims and the approvals inbox
const express = require('express');
const db = require('../db');
const accounting = require('../services/accounting');
const { requirePerm, can } = require('../auth');
const { ah, bad, notFound, today, pad, round2, lineAmounts } = require('../util');

const r = express.Router();
const RECON_ACCOUNTS = ['1050', '1020', '1010', '1000'];

/* ======================= BANK / M-PESA RECONCILIATION ======================= */
const addDays = (d, n) => { const x = new Date(String(d).slice(0, 10) + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

/** unreconciled ledger lines on the account that equal a statement amount (+ = money in = debit) */
async function candidates(c, code, amount, date, days = 7, excludeIds = []) {
  const col = amount > 0 ? 'l.debit' : 'l.credit';
  return c.query(`SELECT l.id, l.debit, l.credit, l.description, e.entry_date, e.reference, e.memo, e.source_type, p.name partner_name,
      ABS(DATEDIFF(e.entry_date, ?)) days_apart
    FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id LEFT JOIN partners p ON p.id = l.partner_id
    WHERE a.code = ? AND l.reconciled = 0 AND ${col} = ? AND e.entry_date BETWEEN ? AND ? ${excludeIds.length ? 'AND l.id NOT IN (?)' : ''}
    ORDER BY days_apart, l.id LIMIT 20`,
    [String(date).slice(0, 10), code, Math.abs(amount), addDays(date, -days), addDays(date, days), ...(excludeIds.length ? [excludeIds] : [])]);
}

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
async function autoMatch(c, statementId) {
  const st = await c.one('SELECT * FROM bank_statements WHERE id = ?', [statementId]);
  const lines = await c.query('SELECT * FROM bank_statement_lines WHERE statement_id = ? AND journal_line_id IS NULL ORDER BY line_date, id', [statementId]);
  let n = 0;
  for (const bl of lines) {
    const cands = await candidates(c, st.account_code, Number(bl.amount), bl.line_date, 5);
    if (!cands.length) continue;
    // a reference that appears in the ledger entry wins; otherwise take the only / closest candidate
    const ref = norm(bl.reference);
    let pick = ref.length >= 4 ? cands.find(x => norm(`${x.reference} ${x.memo} ${x.description}`).includes(ref)) : null;
    if (!pick && (cands.length === 1 || cands[0].days_apart < (cands[1] || {}).days_apart)) pick = cands[0];
    if (!pick) continue;
    await c.query(`UPDATE bank_statement_lines SET journal_line_id = ?, match_kind = 'auto' WHERE id = ?`, [pick.id, bl.id]);
    await c.query('UPDATE journal_lines SET reconciled = 1 WHERE id = ?', [pick.id]);
    n++;
  }
  return n;
}

async function bookBalance(c, code, to) {
  const r2 = await c.one(`SELECT COALESCE(SUM(l.debit - l.credit),0) b FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
    WHERE a.code = ? ${to ? 'AND e.entry_date <= ?' : ''}`, to ? [code, to] : [code]);
  return round2(r2.b);
}

async function getStatement(id) {
  const st = await db.one(`SELECT s.*, a.name account_name FROM bank_statements s LEFT JOIN accounts a ON a.code = s.account_code WHERE s.id = ?`, [id]);
  if (!st) throw notFound('Statement');
  st.lines = await db.query(`SELECT b.*, e.reference je_reference, e.memo je_memo, e.entry_date je_date, p.name partner_name
    FROM bank_statement_lines b LEFT JOIN journal_lines l ON l.id = b.journal_line_id LEFT JOIN journal_entries e ON e.id = l.entry_id LEFT JOIN partners p ON p.id = l.partner_id
    WHERE b.statement_id = ? ORDER BY b.line_date, b.id`, [id]);
  const used = st.lines.filter(x => x.journal_line_id).map(x => x.journal_line_id);
  for (const l of st.lines.filter(x => !x.journal_line_id)) l.suggestions = await candidates(db, st.account_code, Number(l.amount), l.line_date, 31, used);
  st.matched = st.lines.filter(x => x.journal_line_id).length;
  st.total_in = round2(st.lines.filter(x => x.amount > 0).reduce((s, x) => s + Number(x.amount), 0));
  st.total_out = round2(st.lines.filter(x => x.amount < 0).reduce((s, x) => s - Number(x.amount), 0));
  st.book_balance = await bookBalance(db, st.account_code, st.date_to);
  st.outstanding = await db.query(`SELECT l.id, l.debit, l.credit, e.entry_date, e.reference, e.memo FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
    WHERE a.code = ? AND l.reconciled = 0 ${st.date_to ? 'AND e.entry_date <= ?' : ''} ORDER BY e.entry_date LIMIT 300`, st.date_to ? [st.account_code, st.date_to] : [st.account_code]);
  return st;
}

r.get('/bank-statements', requirePerm('accounting'), ah(async (req, res) => {
  res.json(await db.query(`SELECT s.*, a.name account_name, (SELECT COUNT(*) FROM bank_statement_lines b WHERE b.statement_id = s.id) line_count,
      (SELECT COUNT(*) FROM bank_statement_lines b WHERE b.statement_id = s.id AND b.journal_line_id IS NOT NULL) matched
    FROM bank_statements s LEFT JOIN accounts a ON a.code = s.account_code ORDER BY s.id DESC LIMIT 200`));
}));
r.get('/bank-statements/:id', requirePerm('accounting'), ah(async (req, res) => res.json(await getStatement(req.params.id))));
r.post('/bank-statements', requirePerm('accounting'), ah(async (req, res) => {
  const b = req.body;
  if (!RECON_ACCOUNTS.includes(String(b.account_code))) throw bad('Choose the bank, mobile money, card or cash account');
  const lines = (b.lines || []).map(l => ({ date: String(l.date || '').slice(0, 10), description: String(l.description || '').slice(0, 255), reference: String(l.reference || '').slice(0, 120), amount: round2(l.amount) }))
    .filter(l => /^\d{4}-\d{2}-\d{2}$/.test(l.date) && l.amount);
  if (!lines.length) throw bad('No statement lines with a date and an amount were found');
  const id = await db.tx(async c => {
    const dates = lines.map(l => l.date).sort();
    const ins = await c.query(`INSERT INTO bank_statements (account_code, name, date_from, date_to, opening_balance, closing_balance, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [b.account_code, b.name || `Statement ${dates[0]} – ${dates[dates.length - 1]}`, dates[0], dates[dates.length - 1],
        b.opening_balance === '' || b.opening_balance == null ? null : round2(b.opening_balance), b.closing_balance === '' || b.closing_balance == null ? null : round2(b.closing_balance), req.user.id]);
    for (const l of lines) await c.query('INSERT INTO bank_statement_lines (statement_id, line_date, description, reference, amount) VALUES (?, ?, ?, ?, ?)', [ins.insertId, l.date, l.description, l.reference || null, l.amount]);
    await autoMatch(c, ins.insertId);
    return ins.insertId;
  });
  res.json(await getStatement(id));
}));
r.post('/bank-statements/:id/auto', requirePerm('accounting'), ah(async (req, res) => { await db.tx(c => autoMatch(c, req.params.id)); res.json(await getStatement(req.params.id)); }));
r.post('/bank-statements/:id/lines/:lid/match', requirePerm('accounting'), ah(async (req, res) => {
  await db.tx(async c => {
    const bl = await c.one('SELECT b.*, s.account_code FROM bank_statement_lines b JOIN bank_statements s ON s.id = b.statement_id WHERE b.id = ? AND b.statement_id = ? FOR UPDATE', [req.params.lid, req.params.id]);
    if (!bl) throw notFound();
    if (bl.journal_line_id) throw bad('Already matched');
    const jl = await c.one('SELECT l.*, a.code FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.id = ? FOR UPDATE', [req.body.journal_line_id]);
    if (!jl || jl.code !== bl.account_code) throw bad('That ledger line is not on this account');
    if (Number(jl.reconciled)) throw bad('That ledger line is already reconciled');
    if (Math.abs((Number(jl.debit) - Number(jl.credit)) - Number(bl.amount)) > 0.005) throw bad('Amounts differ – use "Create entry" for the difference');
    await c.query(`UPDATE bank_statement_lines SET journal_line_id = ?, match_kind = 'manual' WHERE id = ?`, [jl.id, bl.id]);
    await c.query('UPDATE journal_lines SET reconciled = 1 WHERE id = ?', [jl.id]);
  });
  res.json(await getStatement(req.params.id));
}));
r.post('/bank-statements/:id/lines/:lid/unmatch', requirePerm('accounting'), ah(async (req, res) => {
  await db.tx(async c => {
    const bl = await c.one('SELECT * FROM bank_statement_lines WHERE id = ? AND statement_id = ? FOR UPDATE', [req.params.lid, req.params.id]);
    if (!bl || !bl.journal_line_id) throw bad('Not matched');
    const st = await c.one('SELECT status FROM bank_statements WHERE id = ?', [req.params.id]);
    if (st.status === 'done') throw bad('This statement is closed');
    if (bl.match_kind === 'created') throw bad('This line created its own journal entry – reverse it in Accounting instead');
    await c.query('UPDATE journal_lines SET reconciled = 0 WHERE id = ?', [bl.journal_line_id]);
    await c.query('UPDATE bank_statement_lines SET journal_line_id = NULL, match_kind = NULL WHERE id = ?', [bl.id]);
  });
  res.json(await getStatement(req.params.id));
}));
// bank charges, interest, cash deposits, payments not yet in the books → post the entry and match it
r.post('/bank-statements/:id/lines/:lid/create', requirePerm('accounting'), ah(async (req, res) => {
  await db.tx(async c => {
    const bl = await c.one('SELECT b.*, s.account_code FROM bank_statement_lines b JOIN bank_statements s ON s.id = b.statement_id WHERE b.id = ? AND b.statement_id = ? FOR UPDATE', [req.params.lid, req.params.id]);
    if (!bl) throw notFound();
    if (bl.journal_line_id) throw bad('Already matched');
    const code = String(req.body.account_code || '');
    if (!code || code === bl.account_code) throw bad('Choose what this line is (bank charges, interest, customer payment …)');
    if (['1100', '2000'].includes(code) && !req.body.partner_id) throw bad('Choose the customer or supplier');
    const amt = Math.abs(Number(bl.amount)), inflow = Number(bl.amount) > 0;
    const desc = (req.body.description || bl.description || 'Statement line').slice(0, 200);
    const jid = await accounting.post(c, { date: String(bl.line_date instanceof Date ? today() : bl.line_date).slice(0, 10), reference: bl.reference || `STMT-${req.params.id}`, memo: desc, source_type: 'bank_statement', source_id: bl.id, user_id: req.user.id,
      lines: [{ code: bl.account_code, debit: inflow ? amt : 0, credit: inflow ? 0 : amt, description: desc },
        { code, debit: inflow ? 0 : amt, credit: inflow ? amt : 0, partner_id: req.body.partner_id || null, description: desc }] });
    await c.query('UPDATE journal_entries SET entry_date = ? WHERE id = ?', [bl.line_date, jid]);
    const jl = await c.one('SELECT l.id FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ? AND a.code = ?', [jid, bl.account_code]);
    await c.query(`UPDATE bank_statement_lines SET journal_line_id = ?, match_kind = 'created' WHERE id = ?`, [jl.id, bl.id]);
    await c.query('UPDATE journal_lines SET reconciled = 1 WHERE id = ?', [jl.id]);
  });
  res.json(await getStatement(req.params.id));
}));
r.post('/bank-statements/:id/done', requirePerm('accounting'), ah(async (req, res) => {
  const st = await getStatement(req.params.id);
  if (st.matched < st.lines.length) throw bad(`${st.lines.length - st.matched} line(s) still need matching`);
  await db.query(`UPDATE bank_statements SET status = 'done' WHERE id = ?`, [st.id]);
  res.json(await getStatement(st.id));
}));
r.delete('/bank-statements/:id', requirePerm('accounting'), ah(async (req, res) => {
  await db.tx(async c => {
    const st = await c.one('SELECT * FROM bank_statements WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!st) throw notFound();
    if (st.status === 'done') throw bad('A finished reconciliation cannot be deleted');
    if ((await c.one(`SELECT COUNT(*) n FROM bank_statement_lines WHERE statement_id = ? AND match_kind = 'created'`, [st.id])).n > 0)
      throw bad('Entries were created from this statement – keep it, or reverse those entries first');
    await c.query('UPDATE journal_lines SET reconciled = 0 WHERE id IN (SELECT journal_line_id FROM bank_statement_lines WHERE statement_id = ? AND journal_line_id IS NOT NULL)', [st.id]);
    await c.query('DELETE FROM bank_statements WHERE id = ?', [st.id]);
  });
  res.json({ ok: true });
}));

/* ======================= EXPENSE CLAIMS ======================= */
const RECEIPT_MAX = 2.5 * 1024 * 1024;
const claimSql = `SELECT x.id, x.number, x.user_id, x.claim_date, x.description, x.account_code, x.amount, x.tax_rate, x.paid_by, x.company_method_id, x.supplier,
    x.status, x.approver_id, x.decided_at, x.reject_reason, x.reimbursed_method_id, x.reimbursed_at, x.created_at, (x.receipt IS NOT NULL) has_receipt,
    u.name user_name, ap.name approver_name, a.name account_name, m.name company_method_name
  FROM expense_claims x JOIN users u ON u.id = x.user_id LEFT JOIN users ap ON ap.id = x.approver_id LEFT JOIN accounts a ON a.code = x.account_code
  LEFT JOIN payment_methods m ON m.id = x.company_method_id`;

r.get('/expense-claims', ah(async (req, res) => {
  const cond = [], args = [];
  if (!can(req.user, 'expenses.approve') || req.query.mine) { cond.push('x.user_id = ?'); args.push(req.user.id); }
  if (req.query.status) { cond.push('x.status = ?'); args.push(req.query.status); }
  res.json(await db.query(`${claimSql} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY x.id DESC LIMIT 500`, args));
}));
r.get('/expense-claims/:id/receipt', ah(async (req, res) => {
  const x = await db.one('SELECT user_id, receipt FROM expense_claims WHERE id = ?', [req.params.id]);
  if (!x || !x.receipt) throw notFound('Receipt');
  if (x.user_id !== req.user.id && !can(req.user, 'expenses.approve')) throw bad('Not your claim');
  res.json({ data_url: x.receipt });
}));
r.post('/expense-claims', ah(async (req, res) => {
  const b = req.body;
  const amount = round2(b.amount);
  if (!(amount > 0)) throw bad('Enter the amount you spent');
  if (!b.description) throw bad('Say what the money was spent on');
  if (b.receipt && (!/^data:(image\/(png|jpeg|webp)|application\/pdf);base64,/.test(b.receipt) || b.receipt.length > RECEIPT_MAX)) throw bad('Receipt must be a photo or PDF under 2 MB');
  const acc = await db.one(`SELECT code FROM accounts WHERE code = ? AND type = 'expense'`, [b.account_code || '6000']);
  if (!acc) throw bad('Choose an expense category');
  if (b.paid_by === 'company' && !b.company_method_id) throw bad('Choose how the company paid');
  const ins = await db.query(`INSERT INTO expense_claims (user_id, claim_date, description, account_code, amount, tax_rate, paid_by, company_method_id, supplier, receipt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user.id, b.claim_date || today(), String(b.description).slice(0, 255), acc.code, amount, Number(b.tax_rate || 0), b.paid_by === 'company' ? 'company' : 'own',
      b.paid_by === 'company' ? b.company_method_id : null, b.supplier || null, b.receipt || null]);
  await db.query('UPDATE expense_claims SET number = ? WHERE id = ?', [`EXP/${String(b.claim_date || today()).slice(0, 4)}/${pad(ins.insertId, 5)}`, ins.insertId]);
  res.json(await db.one(`${claimSql} WHERE x.id = ?`, [ins.insertId]));
}));
r.delete('/expense-claims/:id', ah(async (req, res) => {
  const x = await db.one('SELECT * FROM expense_claims WHERE id = ?', [req.params.id]);
  if (!x) throw notFound();
  if (x.user_id !== req.user.id || x.status !== 'submitted') throw bad('Only your own claims that are not yet approved can be withdrawn');
  await db.query('DELETE FROM expense_claims WHERE id = ?', [x.id]);
  res.json({ ok: true });
}));
r.post('/expense-claims/:id/approve', requirePerm('expenses.approve'), ah(async (req, res) => {
  await db.tx(async c => {
    const x = await c.one('SELECT * FROM expense_claims WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!x) throw notFound();
    if (x.status !== 'submitted') throw bad('Already decided');
    if (x.user_id === req.user.id && req.user.role !== 'admin') throw bad('Someone else must approve your own claim');
    const a = lineAmounts({ qty: 1, unit_price: x.amount, tax_rate: x.tax_rate, price_includes_tax: 1 });
    let credit = '2250';
    if (x.paid_by === 'company') { const m = await c.one('SELECT account_code FROM payment_methods WHERE id = ?', [x.company_method_id]); credit = m ? m.account_code : '1000'; }
    await accounting.post(c, { date: String(x.claim_date instanceof Date ? today() : x.claim_date).slice(0, 10), reference: x.number, memo: `Expense claim: ${x.description}`, source_type: 'expense_claim', source_id: x.id, user_id: req.user.id,
      lines: [{ code: x.account_code, debit: a.net }, { code: '1400', debit: a.tax }, { code: credit, credit: a.total }] });
    await c.query(`UPDATE expense_claims SET status = ?, approver_id = ?, decided_at = NOW() WHERE id = ?`, [x.paid_by === 'company' ? 'reimbursed' : 'approved', req.user.id, x.id]);
  });
  res.json(await db.one(`${claimSql} WHERE x.id = ?`, [req.params.id]));
}));
r.post('/expense-claims/:id/reject', requirePerm('expenses.approve'), ah(async (req, res) => {
  const x = await db.one('SELECT * FROM expense_claims WHERE id = ?', [req.params.id]);
  if (!x) throw notFound();
  if (x.status !== 'submitted') throw bad('Already decided');
  if (!req.body.reason) throw bad('Say why the claim is rejected');
  await db.query(`UPDATE expense_claims SET status = 'rejected', approver_id = ?, decided_at = NOW(), reject_reason = ? WHERE id = ?`, [req.user.id, String(req.body.reason).slice(0, 255), x.id]);
  res.json(await db.one(`${claimSql} WHERE x.id = ?`, [x.id]));
}));
r.post('/expense-claims/:id/reimburse', requirePerm('expenses.approve'), ah(async (req, res) => {
  await db.tx(async c => {
    const x = await c.one('SELECT * FROM expense_claims WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!x) throw notFound();
    if (x.status !== 'approved') throw bad('Only approved claims paid from own money are reimbursed');
    const m = await c.one('SELECT * FROM payment_methods WHERE id = ?', [req.body.method_id]);
    if (!m || m.kind === 'account') throw bad('Choose how the staff member is paid back');
    await accounting.post(c, { reference: x.number, memo: `Reimbursed expense claim ${x.number}`, source_type: 'expense_claim_paid', source_id: x.id, user_id: req.user.id,
      lines: [{ code: '2250', debit: x.amount }, { code: m.account_code, credit: x.amount }] });
    await c.query(`INSERT INTO payments (direction, method_id, amount, reference, user_id) VALUES ('out', ?, ?, ?, ?)`, [m.id, x.amount, `Expense claim ${x.number}`, req.user.id]);
    await c.query(`UPDATE expense_claims SET status = 'reimbursed', reimbursed_method_id = ?, reimbursed_at = NOW() WHERE id = ?`, [m.id, x.id]);
  });
  res.json(await db.one(`${claimSql} WHERE x.id = ?`, [req.params.id]));
}));

/* ======================= APPROVALS ======================= */
r.get('/approvals/settings', ah(async (req, res) => res.json({ po_limit: 0, ...((await db.getSetting('approvals', {})) || {}) })));
r.put('/approvals/settings', requirePerm('settings'), ah(async (req, res) => {
  const v = { po_limit: Math.max(0, Number(req.body.po_limit || 0)) };
  await db.setSetting('approvals', v); res.json(v);
}));
r.get('/approvals', ah(async (req, res) => {
  const out = { expense_claims: [], purchase_orders: [], recon: 0 };
  if (can(req.user, 'expenses.approve')) out.expense_claims = await db.query(`${claimSql} WHERE x.status = 'submitted' AND (x.user_id <> ? OR ? = 'admin') ORDER BY x.id`, [req.user.id, req.user.role]);
  if (can(req.user, 'purchase.approve')) out.purchase_orders = await db.query(`SELECT po.*, p.name supplier_name, u.name user_name FROM purchase_orders po JOIN partners p ON p.id = po.supplier_id LEFT JOIN users u ON u.id = po.user_id WHERE po.status = 'to_approve' ORDER BY po.id`);
  if (can(req.user, 'recon.approve')) out.recon = Number((await db.one(`SELECT COUNT(*) n FROM sales_recons WHERE status = 'submitted'`).catch(() => ({ n: 0 }))).n);
  out.to_reimburse = can(req.user, 'expenses.approve') ? await db.query(`${claimSql} WHERE x.status = 'approved' ORDER BY x.id`) : [];
  out.count = out.expense_claims.length + out.purchase_orders.length + out.recon;
  res.json(out);
}));

module.exports = { router: r, RECON_ACCOUNTS };
