// Finance (Sage-level general ledger): classified chart of accounts with control accounts, cost centres, financial years
// with a period lock and year-end close, journal batches (draft → approval → posted, reversing, recurring), budgets,
// and the management reports: trial balance (opening / movement / closing), general ledger with running balance,
// classified income statement and balance sheet with comparatives and budget, cash flow statement (indirect), ratios,
// and a month-end close checklist.
const db = require('../db');
const accounting = require('./accounting');
const { round2, bad, notFound, pad, today } = require('../util');

const r2 = n => round2(Number(n) || 0);
const CATS = {
  current_asset: ['asset', 'Current assets'], non_current_asset: ['asset', 'Non-current assets'], current_liability: ['liability', 'Current liabilities'],
  non_current_liability: ['liability', 'Non-current liabilities'], equity: ['equity', 'Equity'], revenue: ['income', 'Revenue'], cost_of_sales: ['expense', 'Cost of sales'],
  other_income: ['income', 'Other income'], operating_expense: ['expense', 'Operating expenses'], finance_cost: ['expense', 'Finance costs'], tax_expense: ['expense', 'Income tax']
};
/** a sensible category for an account that has none yet (same rules as the migration) */
function classify(a) {
  if (a.category) return a.category;
  const c = String(a.code);
  if (a.type === 'asset') return c < '1500' ? 'current_asset' : 'non_current_asset';
  if (a.type === 'liability') return c < '2500' ? 'current_liability' : 'non_current_liability';
  if (a.type === 'equity') return 'equity';
  if (a.type === 'income') return ['4200', '4250', '4300'].includes(c) ? 'other_income' : 'revenue';
  if (c === '7100') return 'tax_expense';
  return c < '6000' ? 'cost_of_sales' : ['6400', '6460'].includes(c) ? 'finance_cost' : 'operating_expense';
}
const cashFlowOf = a => a.cash_flow || (['1000', '1010', '1020', '1050', '1170'].includes(String(a.code)) ? 'cash' : ['income', 'expense'].includes(a.type) ? 'none'
  : a.type === 'asset' && String(a.code) >= '1500' ? 'investing' : (a.type === 'liability' && String(a.code) >= '2500') || (a.type === 'equity' && String(a.code) !== '3100') ? 'financing' : 'operating');
const debitNormal = t => t === 'asset' || t === 'expense';

/* ============================== settings ============================== */
// on a new install the migrations run before the chart of accounts exists: classify once, on first use
let classified = false;
async function ensureClassified() {
  if (classified) return;
  if (await db.getSetting('finance_classified', null)) { classified = true; return; }
  if (!(await db.one('SELECT COUNT(*) n FROM accounts')).n) return;
  for (const a of await db.query('SELECT * FROM accounts WHERE category IS NULL OR cash_flow IS NULL')) await db.query('UPDATE accounts SET category = ?, cash_flow = ? WHERE id = ?', [classify(a), cashFlowOf(a), a.id]);
  await db.query(`UPDATE accounts SET is_control = 1 WHERE code IN ('1100','1200','1400','2000','2050','2100','2200','2300')`);
  await db.setSetting('finance_classified', true); classified = true; accounting.clearCache();
}
const DEFAULTS = { lock_date: null, year_end_month: 3, manual_approval_limit: 0, allow_control_manual: false, retained_earnings: '3100', backdate_days: 7, large_cash: 5000 };
async function settings() {
  await ensureClassified();
  const s = { ...DEFAULTS, ...((await db.getSetting('finance', {})) || {}) };
  if (!(await db.getSetting('finance', null))) { const t = (await db.getSetting('tax', {})) || {}; if (t.year_end_month) s.year_end_month = Number(t.year_end_month); }
  return s;
}
async function saveSettings(user, b) {
  const s = await settings(), n = { ...s };
  if (b.year_end_month !== undefined) { n.year_end_month = Math.round(Number(b.year_end_month)); if (!(n.year_end_month >= 1 && n.year_end_month <= 12)) throw bad('Year-end month is 1–12'); }
  for (const k of ['manual_approval_limit', 'backdate_days', 'large_cash']) if (b[k] !== undefined) n[k] = Math.max(0, Number(b[k]) || 0);
  if (b.allow_control_manual !== undefined) n.allow_control_manual = !!b.allow_control_manual;
  await db.setSetting('finance', n);
  return n;
}
/** close (lock) the books up to a date, or reopen by moving the date back */
async function setLock(user, date) {
  const s = await settings();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('Choose the date');
  if (date && date >= today()) throw bad('The books can only be locked up to a date in the past');
  const closed = await db.query(`SELECT name, end_date FROM fin_years WHERE status = 'closed' ORDER BY end_date DESC LIMIT 1`);
  if (closed.length && (!date || date < String(closed[0].end_date).slice(0, 10))) throw bad(`${closed[0].name} is closed at year end – reopen the year first to unlock before ${String(closed[0].end_date).slice(0, 10)}`);
  await db.setSetting('finance', { ...s, lock_date: date || null });
  await db.query(`INSERT INTO audit_log (user_id, action, entity, details) VALUES (?, 'finance.lock', 'settings', ?)`, [user.id, JSON.stringify({ from: s.lock_date, to: date || null })]);
  return { lock_date: date || null };
}

/* ============================== chart of accounts ============================== */
async function accounts() {
  await ensureClassified();
  const rows = await db.query(`SELECT a.*, COALESCE(SUM(l.debit),0) debit, COALESCE(SUM(l.credit),0) credit, COUNT(l.id) n_lines FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id GROUP BY a.id ORDER BY a.code`);
  return rows.map(a => ({ ...a, category: classify(a), cash_flow: cashFlowOf(a), category_name: CATS[classify(a)][1], balance: r2(debitNormal(a.type) ? a.debit - a.credit : a.credit - a.debit) }));
}
async function saveAccount(user, b, id = null) {
  const v = {};
  if (!id) {
    v.code = String(b.code || '').trim(); if (!/^[0-9A-Za-z.\-]{2,20}$/.test(v.code)) throw bad('Account code: 2–20 letters or digits');
    if (await db.one('SELECT id FROM accounts WHERE code = ?', [v.code])) throw bad(`Account ${v.code} already exists`);
  }
  if (b.name !== undefined || !id) { v.name = String(b.name || '').trim().slice(0, 120); if (!v.name) throw bad('Name the account'); }
  if (b.category !== undefined || !id) {
    if (!CATS[b.category]) throw bad('Choose where the account appears in the financial statements');
    v.category = b.category; v.type = CATS[b.category][0];
    if (id) { const cur = await db.one('SELECT type FROM accounts WHERE id = ?', [id]); const used = await db.one('SELECT COUNT(*) n FROM journal_lines WHERE account_id = ?', [id]);
      if (cur && cur.type !== v.type && Number(used.n)) throw bad('This account has postings – it cannot move between assets, liabilities, equity, income and expenses. Make a new account and journal the balance across.'); }
  }
  if (b.cash_flow !== undefined) v.cash_flow = ['cash', 'operating', 'investing', 'financing', 'none'].includes(b.cash_flow) ? b.cash_flow : null;
  if (b.is_control !== undefined) v.is_control = b.is_control ? 1 : 0;
  if (b.active !== undefined) {
    v.active = b.active ? 1 : 0;
    if (!v.active && id) { const bal = await db.one('SELECT COALESCE(SUM(debit - credit),0) b FROM journal_lines WHERE account_id = ?', [id]); if (Math.abs(Number(bal.b)) > 0.004) throw bad('The account still has a balance – clear it before making it inactive'); }
  }
  for (const [k, n] of [['description', 255], ['report_group', 80]]) if (b[k] !== undefined) v[k] = b[k] ? String(b[k]).slice(0, n) : null;
  if (id) await db.query('UPDATE accounts SET ? WHERE id = ?', [v, id]); else id = (await db.query('INSERT INTO accounts SET ?', [v])).insertId;
  accounting.clearCache();
  await db.query(`INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES (?, ?, 'accounts', ?, ?)`, [user.id, b.code ? 'account.create' : 'account.update', id, JSON.stringify(v)]);
  return id;
}

/* ============================== cost centres ============================== */
const costCentres = () => db.query('SELECT * FROM cost_centres ORDER BY code');
async function saveCostCentre(b, id = null) {
  const v = { code: String(b.code || '').trim().toUpperCase().slice(0, 20), name: String(b.name || '').trim().slice(0, 100) };
  if (!v.code || !v.name) throw bad('Give the cost centre a code and a name');
  v.kind = ['department', 'project', 'branch', 'fund', 'other'].includes(b.kind) ? b.kind : 'department';
  v.manager = b.manager || null; if (b.active !== undefined) v.active = b.active ? 1 : 0;
  if (await db.one('SELECT id FROM cost_centres WHERE code = ? AND id <> ?', [v.code, id || 0])) throw bad(`Code ${v.code} is already used`);
  if (id) await db.query('UPDATE cost_centres SET ? WHERE id = ?', [v, id]); else id = (await db.query('INSERT INTO cost_centres SET ?', [v])).insertId;
  return id;
}

/* ============================== financial years ============================== */
const ymd = d => d.toISOString().slice(0, 10);
function yearFor(date, endMonth) {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  const endY = m > endMonth ? y + 1 : y;
  const end = ymd(new Date(Date.UTC(endY, endMonth, 0)));
  const start = ymd(new Date(Date.UTC(endY - 1, endMonth, 1)));
  return { start, end, name: endMonth === 12 ? `FY ${endY}` : `FY ${endY - 1}/${String(endY).slice(2)}` };
}
async function years() {
  const s = await settings();
  // make sure the current year (and every year with postings) exists
  const first = await db.one('SELECT MIN(entry_date) d FROM journal_entries');
  const from = first && first.d ? String(first.d).slice(0, 10) : today();
  let y = yearFor(from, s.year_end_month);
  while (y.start <= today()) {
    await db.query('INSERT IGNORE INTO fin_years (name, start_date, end_date) VALUES (?, ?, ?)', [y.name, y.start, y.end]);
    const nx = new Date(y.end + 'T12:00:00Z'); nx.setUTCDate(nx.getUTCDate() + 1); y = yearFor(ymd(nx), s.year_end_month);
  }
  return db.query('SELECT f.*, u.name closed_by_name FROM fin_years f LEFT JOIN users u ON u.id = f.closed_by ORDER BY start_date DESC');
}
/** year-end: income and expenses for the year are closed to retained earnings, and the year is locked */
async function closeYear(user, id) {
  const s = await settings();
  return db.tx(async c => {
    const y = await c.one('SELECT * FROM fin_years WHERE id = ? FOR UPDATE', [id]); if (!y) throw notFound('Financial year');
    if (y.status === 'closed') throw bad('Already closed');
    const end = String(y.end_date).slice(0, 10), start = String(y.start_date).slice(0, 10);
    if (end >= today()) throw bad('A year can be closed only after its last day');
    const prev = await c.one(`SELECT id FROM fin_years WHERE end_date < ? AND status = 'open' AND EXISTS (SELECT 1 FROM journal_entries e WHERE e.entry_date BETWEEN fin_years.start_date AND fin_years.end_date) LIMIT 1`, [start]);
    if (prev) throw bad('Close the earlier year first');
    const pend = await c.one(`SELECT COUNT(*) n FROM journal_batches WHERE status IN ('draft','submitted') AND entry_date BETWEEN ? AND ?`, [start, end]);
    if (Number(pend.n)) throw bad(`${pend.n} journal(s) dated in this year are still waiting – post or cancel them first`);
    const bals = await c.query(`SELECT a.code, a.type, COALESCE(SUM(l.debit - l.credit),0) b FROM accounts a JOIN journal_lines l ON l.account_id = a.id JOIN journal_entries e ON e.id = l.entry_id
      WHERE a.type IN ('income','expense') AND e.entry_date BETWEEN ? AND ? AND (e.source_type IS NULL OR e.source_type <> 'year_end') GROUP BY a.id HAVING ABS(b) > 0.004`, [start, end]);
    const lines = []; let profit = 0;
    for (const x of bals) { const b = r2(x.b); profit = r2(profit - b); lines.push(b > 0 ? { code: x.code, credit: b } : { code: x.code, debit: -b }); }
    let entry = null;
    if (lines.length) {
      lines.push(profit >= 0 ? { code: s.retained_earnings, credit: profit, description: 'Profit for the year' } : { code: s.retained_earnings, debit: -profit, description: 'Loss for the year' });
      entry = await accounting.post(c, { date: end, reference: `YE ${y.name}`, memo: `Year-end close ${y.name}: profit ${profit.toFixed(2)} to retained earnings`, source_type: 'year_end', source_id: y.id, user_id: user.id, lines, allowLocked: true });
    }
    await c.query(`UPDATE fin_years SET status = 'closed', closing_entry_id = ?, closed_by = ?, closed_at = NOW() WHERE id = ?`, [entry, user.id, y.id]);
    const cur = (await c.one(`SELECT v FROM settings WHERE k = 'finance'`)) || {};
    const fs = { ...DEFAULTS, ...(cur.v ? (typeof cur.v === 'string' ? JSON.parse(cur.v) : cur.v) : {}) };
    if (!fs.lock_date || fs.lock_date < end) await c.query(`INSERT INTO settings (k, v) VALUES ('finance', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)`, [JSON.stringify({ ...s, ...fs, lock_date: end })]);
    await c.query(`INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES (?, 'finance.year_close', 'fin_years', ?, ?)`, [user.id, y.id, JSON.stringify({ profit, entry })]);
    return { profit, closing_entry_id: entry, lock_date: end };
  });
}
async function reopenYear(user, id) {
  if (!user.permissions.includes('*')) throw bad('Only an administrator can reopen a closed year');
  return db.tx(async c => {
    const y = await c.one('SELECT * FROM fin_years WHERE id = ? FOR UPDATE', [id]); if (!y || y.status !== 'closed') throw bad('This year is not closed');
    const later = await c.one(`SELECT name FROM fin_years WHERE start_date > ? AND status = 'closed' LIMIT 1`, [y.start_date]); if (later) throw bad(`Reopen ${later.name} first`);
    if (y.closing_entry_id) { // reversed, never deleted: the ledger is sealed (audit hash chain)
      const ls = await c.query('SELECT a.code, l.debit, l.credit, l.description FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ?', [y.closing_entry_id]);
      await accounting.post(c, { date: String(y.end_date).slice(0, 10), reference: `YE ${y.name} reopened`, memo: `Year ${y.name} reopened – closing entry reversed`, source_type: 'year_end', source_id: y.id, user_id: user.id,
        lines: ls.map(l => ({ code: l.code, debit: l.credit, credit: l.debit, description: l.description })), reverses_id: y.closing_entry_id, allowLocked: true });
    }
    await c.query(`UPDATE fin_years SET status = 'open', closing_entry_id = NULL, closed_by = NULL, closed_at = NULL WHERE id = ?`, [y.id]);
    const prevEnd = await c.one(`SELECT MAX(end_date) d FROM fin_years WHERE status = 'closed'`);
    const s = await settings(); await c.query(`INSERT INTO settings (k, v) VALUES ('finance', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)`, [JSON.stringify({ ...s, lock_date: prevEnd && prevEnd.d ? String(prevEnd.d).slice(0, 10) : null })]);
    await c.query(`INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES (?, 'finance.year_reopen', 'fin_years', ?)`, [user.id, y.id]);
  });
}

/* ============================== journals ============================== */
async function cleanLines(c, lines, s) {
  const acc = new Map((await c.query('SELECT id, code, name, active, is_control FROM accounts')).map(a => [a.code, a]));
  const ccs = new Set((await c.query('SELECT id FROM cost_centres WHERE active = 1')).map(x => x.id));
  const out = [];
  for (const l of lines || []) {
    const dr = r2(l.debit), cr = r2(l.credit);
    if (!dr && !cr) continue;
    if (dr < 0 || cr < 0) throw bad('Amounts cannot be negative');
    if (dr && cr) throw bad('A line is either a debit or a credit, not both');
    const a = acc.get(String(l.code)); if (!a) throw bad(`Account ${l.code} does not exist`);
    if (!a.active) throw bad(`Account ${a.code} ${a.name} is inactive`);
    if (a.is_control && !s.allow_control_manual) throw bad(`${a.code} ${a.name} is a control account – it is posted only by its own documents (invoices, bills, stock, VAT returns, payroll). Use those, or allow manual control postings in Finance → Settings.`);
    const cc = Number(l.cost_centre_id) || null; if (cc && !ccs.has(cc)) throw bad('Unknown or inactive cost centre');
    out.push({ code: a.code, debit: dr, credit: cr, description: l.description ? String(l.description).slice(0, 255) : null, cost_centre_id: cc, partner_id: Number(l.partner_id) || null });
  }
  if (out.length < 2) throw bad('A journal needs at least two lines');
  const d = r2(out.reduce((x, l) => x + l.debit, 0)), k = r2(out.reduce((x, l) => x + l.credit, 0));
  if (Math.abs(d - k) > 0.004) throw bad(`The journal does not balance: debits ${d.toFixed(2)}, credits ${k.toFixed(2)}`);
  return { lines: out, total: d };
}
async function saveBatch(user, b, id = null) {
  const s = await settings();
  return db.tx(async c => {
    const cur = id ? await c.one('SELECT * FROM journal_batches WHERE id = ? FOR UPDATE', [id]) : null;
    if (id && !cur) throw notFound('Journal');
    if (cur && !['draft', 'rejected'].includes(cur.status)) throw bad('Only a draft journal can be changed');
    const date = String(b.entry_date || today()).slice(0, 10);
    const lock = await accounting.lockDate(c); if (lock && date <= lock) throw bad(`The books are closed up to ${lock}`);
    const { lines, total } = await cleanLines(c, b.lines, s);
    const reverse = b.reverse_on ? String(b.reverse_on).slice(0, 10) : null;
    if (reverse && reverse <= date) throw bad('The reversal date must be after the journal date');
    const v = { entry_date: date, reference: b.reference ? String(b.reference).slice(0, 80) : null, memo: b.memo ? String(b.memo).slice(0, 255) : null, lines: JSON.stringify(lines), total, reverse_on: reverse, status: 'draft' };
    if (cur) { await c.query('UPDATE journal_batches SET ? WHERE id = ?', [v, id]); return id; }
    const nid = (await c.query('INSERT INTO journal_batches SET ?', [{ ...v, created_by: user.id, recurring_id: b.recurring_id || null }])).insertId;
    await c.query('UPDATE journal_batches SET number = ? WHERE id = ?', [`JNL/${date.slice(0, 4)}/${pad(nid, 5)}`, nid]);
    return nid;
  });
}
async function postBatchTx(c, user, j) {
  const lines = typeof j.lines === 'string' ? JSON.parse(j.lines) : j.lines;
  const e = await accounting.post(c, { date: String(j.entry_date).slice(0, 10), reference: j.reference || j.number, memo: j.memo || 'Journal', source_type: 'manual', source_id: j.id, user_id: j.created_by || user.id, lines, number: j.number, batch_id: j.id });
  let rev = null;
  if (j.reverse_on) rev = await accounting.post(c, { date: String(j.reverse_on).slice(0, 10), reference: `REV ${j.number}`, memo: `Auto-reversal of ${j.number}${j.memo ? ' – ' + j.memo : ''}`, source_type: 'manual_reversal', source_id: j.id, user_id: user.id,
    lines: lines.map(l => ({ ...l, debit: l.credit, credit: l.debit })), reverses_id: e, batch_id: j.id });
  await c.query(`UPDATE journal_batches SET status = 'posted', entry_id = ?, reversal_entry_id = ?, approved_by = COALESCE(approved_by, ?), approved_at = COALESCE(approved_at, NOW()) WHERE id = ?`, [e, rev, user.id, j.id]);
  return { entry_id: e, reversal_entry_id: rev };
}
/** submit: posts straight away below the approval limit; otherwise waits for someone else to approve */
async function submitBatch(user, id) {
  const s = await settings();
  return db.tx(async c => {
    const j = await c.one('SELECT * FROM journal_batches WHERE id = ? FOR UPDATE', [id]); if (!j) throw notFound('Journal');
    if (!['draft', 'rejected'].includes(j.status)) throw bad('This journal has already been submitted');
    const gov = require('./governance');
    // governed: the organogram decides who approves journals at or above the limit (all journals when no limit is set)
    if (await gov.isGoverned('journal') && !(s.manual_approval_limit > 0 && Number(j.total) < s.manual_approval_limit)) {
      await c.query(`UPDATE journal_batches SET status = 'submitted' WHERE id = ?`, [id]);
      const r = await gov.request(c, { doc_type: 'journal', doc_id: id, amount: Number(j.total), requester_id: j.created_by || user.id, summary: `${j.number} – ${j.memo || 'Journal'} – M ${Number(j.total).toFixed(2)}`, link: '#/finance?tab=journals' });
      return { status: 'submitted', needs_approval: true, message: `Waiting for approval by ${r.next}` };
    }
    if (s.manual_approval_limit > 0 && Number(j.total) >= s.manual_approval_limit) {
      await c.query(`UPDATE journal_batches SET status = 'submitted' WHERE id = ?`, [id]);
      return { status: 'submitted', needs_approval: true };
    }
    return { status: 'posted', ...(await postBatchTx(c, user, j)) };
  });
}
async function approveBatch(user, id, b = {}) {
  return db.tx(async c => {
    const j = await c.one('SELECT * FROM journal_batches WHERE id = ? FOR UPDATE', [id]); if (!j) throw notFound('Journal');
    if (j.status !== 'submitted') throw bad('This journal is not waiting for approval');
    if (j.created_by === user.id) throw bad('Someone other than the person who prepared the journal must approve it');
    const gov = require('./governance');
    if (b.reject) { await gov.reject(c, user, { doc_type: 'journal', doc_id: id, note: b.note }); await c.query(`UPDATE journal_batches SET status = 'rejected', note = ? WHERE id = ?`, [b.note || null, id]); return { status: 'rejected' }; }
    const g = await gov.authorize(c, user, { doc_type: 'journal', doc_id: id, amount: Number(j.total), requester_id: j.created_by, summary: `${j.number} – ${j.memo || 'Journal'}`, link: '#/finance?tab=journals', note: b.note });
    if (!g.final) return { status: 'submitted', message: g.message };
    await c.query('UPDATE journal_batches SET approved_by = ?, approved_at = NOW(), note = ? WHERE id = ?', [user.id, b.note || null, id]);
    return { status: 'posted', ...(await postBatchTx(c, user, { ...j })) };
  });
}
async function cancelBatch(user, id) {
  const j = await db.one('SELECT * FROM journal_batches WHERE id = ?', [id]); if (!j) throw notFound('Journal');
  if (!['draft', 'submitted', 'rejected'].includes(j.status)) throw bad('A posted journal cannot be cancelled – reverse it instead');
  await db.query(`UPDATE journal_batches SET status = 'cancelled' WHERE id = ?`, [id]);
}
/** reverse a posted manual journal entry (posted entries are never edited or deleted) */
async function reverseEntry(user, entryId, b = {}) {
  return db.tx(async c => {
    const e = await c.one('SELECT * FROM journal_entries WHERE id = ? FOR UPDATE', [entryId]); if (!e) throw notFound('Journal entry');
    if (!['manual', 'manual_reversal', 'opening'].includes(e.source_type || 'manual')) throw bad('This entry belongs to a document (invoice, bill, sale…) – cancel or credit that document instead');
    if (e.reversed_by_id) throw bad('Already reversed');
    if (e.reverses_id) throw bad('This entry is itself a reversal');
    const lines = await c.query('SELECT a.code, l.debit, l.credit, l.partner_id, l.description, l.cost_centre_id FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ?', [e.id]);
    const date = String(b.date || today()).slice(0, 10);
    const id = await accounting.post(c, { date, reference: `REV ${e.number || e.reference || e.id}`, memo: `Reversal of entry #${e.id}${b.reason ? ' – ' + b.reason : ''}`, source_type: 'manual_reversal', source_id: e.source_id, user_id: user.id,
      lines: lines.map(l => ({ ...l, debit: l.credit, credit: l.debit })), reverses_id: e.id });
    return { id };
  });
}
const batches = q => db.query(`SELECT j.*, u.name created_by_name, a.name approved_by_name FROM journal_batches j LEFT JOIN users u ON u.id = j.created_by LEFT JOIN users a ON a.id = j.approved_by
  ${q.status ? 'WHERE j.status = ?' : ''} ORDER BY j.id DESC LIMIT 500`, q.status ? [q.status] : []);

/* ---- recurring journals ---- */
const addPeriod = (d, f) => { const x = new Date(d + 'T12:00:00Z'); const m = f === 'quarterly' ? 3 : f === 'yearly' ? 12 : 1; const day = x.getUTCDate(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + m); const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); x.setUTCDate(Math.min(day, last)); return ymd(x); };
async function saveRecurring(user, b, id = null) {
  const s = await settings();
  const { lines } = await cleanLines(db, b.lines, s);
  const v = { name: String(b.name || '').trim().slice(0, 120), reference: b.reference || null, memo: b.memo || null, lines: JSON.stringify(lines),
    frequency: ['monthly', 'quarterly', 'yearly'].includes(b.frequency) ? b.frequency : 'monthly', next_date: String(b.next_date || today()).slice(0, 10), end_date: b.end_date || null, auto_post: b.auto_post ? 1 : 0 };
  if (!v.name) throw bad('Name the recurring journal (e.g. "Monthly rent accrual")');
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  if (id) await db.query('UPDATE recurring_journals SET ? WHERE id = ?', [v, id]); else id = (await db.query('INSERT INTO recurring_journals SET ?', [{ ...v, created_by: user.id }])).insertId;
  return id;
}
/** make the journals that are due (drafts, or posted when the template says so) */
async function runRecurring(user) {
  const due = await db.query(`SELECT * FROM recurring_journals WHERE active = 1 AND next_date <= CURDATE() AND (end_date IS NULL OR next_date <= end_date)`);
  const made = [];
  for (const r of due) {
    let d = String(r.next_date).slice(0, 10);
    while (d <= today() && (!r.end_date || d <= String(r.end_date).slice(0, 10)) && made.length < 500) {
      const id = await saveBatch(user, { entry_date: d, reference: r.reference || r.name, memo: `${r.name} (${d.slice(0, 7)})`, lines: typeof r.lines === 'string' ? JSON.parse(r.lines) : r.lines, recurring_id: r.id });
      let status = 'draft';
      if (r.auto_post) status = (await submitBatch(user, id)).status;
      made.push({ id, name: r.name, date: d, status });
      d = addPeriod(d, r.frequency);
    }
    await db.query('UPDATE recurring_journals SET next_date = ? WHERE id = ?', [d, r.id]);
  }
  return made;
}

/* ============================== reports ============================== */
const NOT_CLOSE = `(e.source_type IS NULL OR e.source_type <> 'year_end')`;
/** balances per account between dates (inclusive), optionally for one cost centre; year-end closing entries left out when asked */
async function balances(from, to, { cc = null, skipClose = false } = {}) {
  const rows = await db.query(`SELECT l.account_id, COALESCE(SUM(l.debit),0) debit, COALESCE(SUM(l.credit),0) credit FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
    WHERE e.entry_date BETWEEN ? AND ? ${cc ? 'AND l.cost_centre_id = ?' : ''} ${skipClose ? 'AND ' + NOT_CLOSE : ''} GROUP BY l.account_id`, cc ? [from, to, cc] : [from, to]);
  return new Map(rows.map(r => [r.account_id, { debit: Number(r.debit), credit: Number(r.credit) }]));
}
async function accountList() { await ensureClassified(); return (await db.query('SELECT * FROM accounts ORDER BY code')).map(a => ({ ...a, category: classify(a), cash_flow: cashFlowOf(a) })); }
const dayBefore = d => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return ymd(x); };

async function trialBalance(from, to, cc) {
  const [acc, open, mov] = await Promise.all([accountList(), balances('1900-01-01', dayBefore(from), { cc }), balances(from, to, { cc })]);
  const rows = acc.map(a => {
    const o = open.get(a.id) || { debit: 0, credit: 0 }, m = mov.get(a.id) || { debit: 0, credit: 0 };
    const ob = r2(o.debit - o.credit), cb = r2(ob + m.debit - m.credit);
    return { id: a.id, code: a.code, name: a.name, type: a.type, category: a.category, opening: ob, debit: r2(m.debit), credit: r2(m.credit), closing: cb,
      closing_dr: cb > 0 ? cb : 0, closing_cr: cb < 0 ? -cb : 0 };
  }).filter(r => r.opening || r.debit || r.credit || r.closing);
  const t = k => r2(rows.reduce((s, r) => s + r[k], 0));
  return { from, to, rows, totals: { opening: t('opening'), debit: t('debit'), credit: t('credit'), closing_dr: t('closing_dr'), closing_cr: t('closing_cr') }, balanced: Math.abs(t('closing_dr') - t('closing_cr')) < 0.01 && Math.abs(t('debit') - t('credit')) < 0.01 };
}
async function generalLedger(from, to, { accounts: codes = [], cc = null } = {}) {
  const acc = (await accountList()).filter(a => !codes.length || codes.includes(a.code));
  const out = [];
  for (const a of acc) {
    const o = await db.one(`SELECT COALESCE(SUM(l.debit - l.credit),0) b FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.account_id = ? AND e.entry_date < ? ${cc ? 'AND l.cost_centre_id = ?' : ''}`, cc ? [a.id, from, cc] : [a.id, from]);
    const tx = await db.query(`SELECT e.id entry_id, e.entry_date, e.number, e.reference, e.memo, e.source_type, e.source_id, l.description, l.debit, l.credit, p.name partner, c.code cost_centre, u.name user_name
      FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id LEFT JOIN partners p ON p.id = l.partner_id LEFT JOIN cost_centres c ON c.id = l.cost_centre_id LEFT JOIN users u ON u.id = e.user_id
      WHERE l.account_id = ? AND e.entry_date BETWEEN ? AND ? ${cc ? 'AND l.cost_centre_id = ?' : ''} ORDER BY e.entry_date, e.id, l.id LIMIT 20000`, cc ? [a.id, from, to, cc] : [a.id, from, to]);
    if (!tx.length && !Number(o.b)) continue;
    let run = r2(o.b);
    for (const t of tx) { run = r2(run + Number(t.debit) - Number(t.credit)); t.balance = run; }
    out.push({ code: a.code, name: a.name, type: a.type, opening: r2(o.b), debit: r2(tx.reduce((s, t) => s + Number(t.debit), 0)), credit: r2(tx.reduce((s, t) => s + Number(t.credit), 0)), closing: run, transactions: tx });
  }
  return { from, to, accounts: out };
}
/** budget for an account over a date range (whole months of the financial year the budget belongs to) */
async function budgetMap(from, to, budgetId, cc) {
  if (!budgetId) return null;
  const b = await db.one('SELECT b.*, f.start_date FROM budgets b JOIN fin_years f ON f.id = b.fin_year_id WHERE b.id = ?', [budgetId]); if (!b) return null;
  const start = String(b.start_date).slice(0, 10), mi = d => (Number(d.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(d.slice(5, 7)) - Number(start.slice(5, 7)) + 1;
  const p1 = Math.max(1, mi(from)), p2 = Math.min(12, mi(to));
  const rows = await db.query(`SELECT account_id, SUM(amount) amt FROM budget_lines WHERE budget_id = ? AND period BETWEEN ? AND ? ${cc ? 'AND cost_centre_id = ?' : ''} GROUP BY account_id`, cc ? [budgetId, p1, p2, cc] : [budgetId, p1, p2]);
  return new Map(rows.map(r => [r.account_id, Number(r.amt)]));
}
const prevYear = d => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`;
async function incomeStatement(from, to, { compare = 'prior_year', cc = null, budget_id = null } = {}) {
  const acc = (await accountList()).filter(a => ['income', 'expense'].includes(a.type));
  const cur = await balances(from, to, { cc, skipClose: true });
  const cmpFrom = compare === 'prior_period' ? (() => { const days = (new Date(to) - new Date(from)) / 864e5 + 1; const x = new Date(from + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - days); return ymd(x); })() : prevYear(from);
  const cmpTo = compare === 'prior_period' ? dayBefore(from) : prevYear(to);
  const cmp = compare === 'none' ? new Map() : await balances(cmpFrom, cmpTo, { cc, skipClose: true });
  const bud = await budgetMap(from, to, budget_id, cc);
  const amt = (m, a) => { const x = m.get(a.id) || { debit: 0, credit: 0 }; return r2(a.type === 'income' ? x.credit - x.debit : x.debit - x.credit); };
  const sections = ['revenue', 'cost_of_sales', 'other_income', 'operating_expense', 'finance_cost', 'tax_expense'].map(k => {
    const lines = acc.filter(a => a.category === k).map(a => ({ code: a.code, name: a.name, amount: amt(cur, a), compare: amt(cmp, a), budget: bud ? r2(bud.get(a.id) || 0) : null }))
      .filter(l => l.amount || l.compare || l.budget);
    return { key: k, name: CATS[k][1], lines, total: r2(lines.reduce((s, l) => s + l.amount, 0)), compare: r2(lines.reduce((s, l) => s + l.compare, 0)), budget: bud ? r2(lines.reduce((s, l) => s + (l.budget || 0), 0)) : null };
  });
  const S = k => sections.find(x => x.key === k), sum = (f, ...ks) => r2(ks.reduce((t, k) => t + (k.startsWith('-') ? -S(k.slice(1))[f] : S(k)[f]), 0));
  const tot = f => ({ gross_profit: sum(f, 'revenue', '-cost_of_sales'), operating_profit: sum(f, 'revenue', '-cost_of_sales', 'other_income', '-operating_expense'),
    profit_before_tax: sum(f, 'revenue', '-cost_of_sales', 'other_income', '-operating_expense', '-finance_cost'), net_profit: sum(f, 'revenue', '-cost_of_sales', 'other_income', '-operating_expense', '-finance_cost', '-tax_expense') });
  return { from, to, compare, compare_from: compare === 'none' ? null : cmpFrom, compare_to: compare === 'none' ? null : cmpTo, cost_centre_id: cc, budget_id, sections, totals: tot('total'), compare_totals: tot('compare'), budget_totals: bud ? tot('budget') : null };
}
/** income statement by month: 12 columns for trends */
async function monthlyIncome(year_id, cc) {
  const y = await db.one('SELECT * FROM fin_years WHERE id = ?', [year_id]); if (!y) throw notFound('Financial year');
  const acc = (await accountList()).filter(a => ['income', 'expense'].includes(a.type));
  const months = []; let d = String(y.start_date).slice(0, 10);
  for (let i = 0; i < 12; i++) { const end = ymd(new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0))); months.push({ from: d, to: end, label: d.slice(0, 7) }); const n = new Date(end + 'T12:00:00Z'); n.setUTCDate(n.getUTCDate() + 1); d = ymd(n); }
  const maps = await Promise.all(months.map(m => balances(m.from, m.to, { cc, skipClose: true })));
  const rows = acc.map(a => ({ code: a.code, name: a.name, category: a.category, values: maps.map(mp => { const x = mp.get(a.id) || { debit: 0, credit: 0 }; return r2(a.type === 'income' ? x.credit - x.debit : x.debit - x.credit); }) }))
    .filter(r => r.values.some(v => v));
  const net = months.map((m, i) => r2(rows.reduce((s, r) => s + (['revenue', 'other_income'].includes(r.category) ? r.values[i] : -r.values[i]), 0)));
  return { year: y.name, months: months.map(m => m.label), rows, net_profit: net };
}
async function balanceSheet(asOf, compareAsOf) {
  const acc = await accountList();
  const at = async d => { const m = await balances('1900-01-01', d); return a => { const x = m.get(a.id) || { debit: 0, credit: 0 }; return r2(debitNormal(a.type) ? x.debit - x.credit : x.credit - x.debit); }; };
  const cur = await at(asOf), cmp = compareAsOf ? await at(compareAsOf) : null;
  const sec = k => { const lines = acc.filter(a => a.category === k).map(a => ({ code: a.code, name: a.name, amount: cur(a), compare: cmp ? cmp(a) : null })).filter(l => l.amount || l.compare);
    return { key: k, name: CATS[k][1], lines, total: r2(lines.reduce((s, l) => s + l.amount, 0)), compare: cmp ? r2(lines.reduce((s, l) => s + (l.compare || 0), 0)) : null }; };
  // profit not yet closed to retained earnings (open years)
  const earn = f => r2(acc.filter(a => ['income', 'expense'].includes(a.type)).reduce((s, a) => s + (a.type === 'income' ? f(a) : -f(a)), 0));
  const equity = sec('equity');
  const e1 = earn(cur), e0 = cmp ? earn(cmp) : null;
  equity.lines.push({ code: '', name: 'Profit for the period not yet closed', amount: e1, compare: e0 }); equity.total = r2(equity.total + e1); if (cmp) equity.compare = r2(equity.compare + e0);
  const S = { nca: sec('non_current_asset'), ca: sec('current_asset'), equity, ncl: sec('non_current_liability'), cl: sec('current_liability') };
  const tA = f => r2((S.nca[f] || 0) + (S.ca[f] || 0)), tL = f => r2((S.ncl[f] || 0) + (S.cl[f] || 0));
  return { as_of: asOf, compare_as_of: compareAsOf || null, sections: S, total_assets: tA('total'), total_equity_liabilities: r2(S.equity.total + tL('total')),
    compare_total_assets: cmp ? tA('compare') : null, compare_total_equity_liabilities: cmp ? r2(S.equity.compare + tL('compare')) : null, balanced: Math.abs(tA('total') - S.equity.total - tL('total')) < 0.01 };
}
/** cash flow statement – indirect method, from the balance movements of each account's cash-flow class */
async function cashFlow(from, to) {
  const acc = await accountList();
  const open = await balances('1900-01-01', dayBefore(from)), close = await balances('1900-01-01', to), mov = await balances(from, to, { skipClose: true });
  const bal = (m, a) => { const x = m.get(a.id) || { debit: 0, credit: 0 }; return r2(x.debit - x.credit); }; // debit-positive
  const change = a => r2(bal(close, a) - bal(open, a));
  const profit = r2(acc.filter(a => ['income', 'expense'].includes(a.type)).reduce((s, a) => { const x = mov.get(a.id) || { debit: 0, credit: 0 }; return s + Number(x.credit) - Number(x.debit); }, 0));
  const depAcc = acc.filter(a => a.code === '6950' || /depreciation/i.test(a.name) && a.type === 'expense');
  const dep = r2(depAcc.reduce((s, a) => { const x = mov.get(a.id) || { debit: 0, credit: 0 }; return s + Number(x.debit) - Number(x.credit); }, 0));
  const lossOnDisposal = r2(acc.filter(a => a.code === '6960').reduce((s, a) => { const x = mov.get(a.id) || { debit: 0, credit: 0 }; return s + Number(x.debit) - Number(x.credit); }, 0));
  const gainOnDisposal = r2(acc.filter(a => a.code === '4250').reduce((s, a) => { const x = mov.get(a.id) || { debit: 0, credit: 0 }; return s + Number(x.credit) - Number(x.debit); }, 0));
  const isAccDep = a => a.type === 'asset' && a.cash_flow === 'investing' && /accumulated depreciation/i.test(a.name);
  const lines = k => acc.filter(a => a.cash_flow === k && a.type !== 'income' && a.type !== 'expense' && !isAccDep(a)).map(a => ({ code: a.code, name: a.name, amount: r2(-change(a)) })).filter(l => l.amount);
  // retained earnings movements other than the year-end close (e.g. dividends) are financing
  const re = acc.find(a => a.code === '3100');
  const reMove = re ? await db.one(`SELECT COALESCE(SUM(l.credit - l.debit),0) b FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.account_id = ? AND e.entry_date BETWEEN ? AND ? AND ${NOT_CLOSE}`, [re.id, from, to]) : { b: 0 };
  const operating = [{ name: 'Profit for the period', amount: profit }, ...(dep ? [{ name: 'Depreciation', amount: dep }] : []), ...(lossOnDisposal ? [{ name: 'Loss on disposal of assets', amount: lossOnDisposal }] : []), ...(gainOnDisposal ? [{ name: 'Gain on disposal of assets', amount: -gainOnDisposal }] : []),
    ...lines('operating').map(l => ({ ...l, name: `Change in ${l.name}` }))];
  const investing = lines('investing').map(l => ({ ...l, amount: l.amount })), financing = [...lines('financing'), ...(Number(reMove.b) ? [{ name: 'Other retained earnings movements (e.g. dividends)', amount: r2(reMove.b) }] : [])];
  // proceeds from disposals sit in the investing section as the reduction in asset cost net of accumulated depreciation
  const accDepChange = r2(acc.filter(isAccDep).reduce((s, a) => s - change(a), 0)); // credit build-up = positive
  // investing cash = −(change in book value) − depreciation − loss + gain on disposals (the asset lines above carry −change in cost)
  const adj = r2(accDepChange - dep - lossOnDisposal + gainOnDisposal);
  if (adj) investing.push({ name: 'Disposals at book value less depreciation charged', amount: adj });
  const sum = l => r2(l.reduce((s, x) => s + x.amount, 0));
  const cashAcc = acc.filter(a => a.cash_flow === 'cash');
  const cashOpen = r2(cashAcc.reduce((s, a) => s + bal(open, a), 0)), cashClose = r2(cashAcc.reduce((s, a) => s + bal(close, a), 0));
  const net = r2(sum(operating) + sum(investing) + sum(financing));
  return { from, to, operating, investing, financing, net_operating: sum(operating), net_investing: sum(investing), net_financing: sum(financing), net_change: net,
    cash_open: cashOpen, cash_close: cashClose, difference: r2(cashClose - cashOpen - net), cash_accounts: cashAcc.map(a => `${a.code} ${a.name}`) };
}
async function ratios(asOf, from) {
  from = from || `${asOf.slice(0, 4)}-01-01`;
  const bs = await balanceSheet(asOf), is = await incomeStatement(from, asOf, { compare: 'none' });
  const acc = await accountList(), m = await balances('1900-01-01', asOf);
  const b = code => { const a = acc.find(x => x.code === code); if (!a) return 0; const x = m.get(a.id) || { debit: 0, credit: 0 }; return r2(debitNormal(a.type) ? x.debit - x.credit : x.credit - x.debit); };
  const S = bs.sections, rev = is.sections.find(s => s.key === 'revenue').total, cos = is.sections.find(s => s.key === 'cost_of_sales').total;
  const days = Math.max(1, (new Date(asOf) - new Date(from)) / 864e5 + 1);
  const div = (a, c) => c ? r2(a / c) : null;
  return { as_of: asOf, from, current_ratio: div(S.ca.total, S.cl.total), quick_ratio: div(S.ca.total - b('1200'), S.cl.total),
    gross_margin_pct: rev ? r2(is.totals.gross_profit / rev * 100) : null, net_margin_pct: rev ? r2(is.totals.net_profit / rev * 100) : null,
    debtor_days: rev ? Math.round(b('1100') / rev * days) : null, creditor_days: cos ? Math.round(b('2000') / cos * days) : null, stock_days: cos ? Math.round(b('1200') / cos * days) : null,
    debt_to_equity: div(S.cl.total + S.ncl.total, S.equity.total), return_on_assets_pct: bs.total_assets ? r2(is.totals.net_profit / bs.total_assets * 100) : null };
}

/* ============================== budgets ============================== */
const budgets = () => db.query('SELECT b.*, f.name year_name, (SELECT COALESCE(SUM(amount),0) FROM budget_lines l WHERE l.budget_id = b.id) total FROM budgets b JOIN fin_years f ON f.id = b.fin_year_id ORDER BY f.start_date DESC, b.id DESC');
async function budget(id) {
  const b = await db.one('SELECT b.*, f.name year_name, f.start_date, f.end_date FROM budgets b JOIN fin_years f ON f.id = b.fin_year_id WHERE b.id = ?', [id]); if (!b) throw notFound('Budget');
  b.lines = await db.query('SELECT l.*, a.code, a.name account_name, c.code cc_code FROM budget_lines l JOIN accounts a ON a.id = l.account_id LEFT JOIN cost_centres c ON c.id = l.cost_centre_id WHERE l.budget_id = ? ORDER BY a.code, l.period', [id]);
  return b;
}
async function createBudget(user, b) {
  const y = await db.one('SELECT * FROM fin_years WHERE id = ?', [b.fin_year_id]); if (!y) throw bad('Choose the financial year');
  const id = (await db.query('INSERT INTO budgets (name, fin_year_id, created_by) VALUES (?, ?, ?)', [String(b.name || `Budget ${y.name}`).slice(0, 80), y.id, user.id])).insertId;
  // optional: start from last year's actual figures, plus a % increase
  if (b.from_actuals) {
    const start = String(y.start_date).slice(0, 10), pf = prevYear(start), uplift = 1 + (Number(b.uplift_pct) || 0) / 100;
    const acc = (await accountList()).filter(a => ['income', 'expense'].includes(a.type));
    for (let p = 1; p <= 12; p++) {
      const ms = new Date(pf + 'T12:00:00Z'); ms.setUTCMonth(ms.getUTCMonth() + p - 1); const mf = ymd(ms), mt = ymd(new Date(Date.UTC(ms.getUTCFullYear(), ms.getUTCMonth() + 1, 0)));
      const mp = await balances(mf, mt, { skipClose: true });
      for (const a of acc) { const x = mp.get(a.id); if (!x) continue; const v = r2((a.type === 'income' ? x.credit - x.debit : x.debit - x.credit) * uplift); if (v) await db.query('INSERT INTO budget_lines (budget_id, account_id, period, amount) VALUES (?, ?, ?, ?)', [id, a.id, p, v]); }
    }
  }
  return id;
}
/** save a budget grid: [{ account_id, cost_centre_id, amounts: [12] }] */
async function saveBudgetLines(user, id, rows) {
  const b = await db.one('SELECT * FROM budgets WHERE id = ?', [id]); if (!b) throw notFound('Budget');
  if (b.status === 'approved') throw bad('An approved budget cannot be changed – copy it into a new version');
  await db.tx(async c => {
    for (const r of rows || []) {
      const a = await c.one('SELECT id, type FROM accounts WHERE id = ?', [r.account_id]); if (!a) throw bad('Unknown account');
      if (!['income', 'expense'].includes(a.type)) throw bad('Budgets are for income and expense accounts');
      const cc = Number(r.cost_centre_id) || null;
      await c.query(`DELETE FROM budget_lines WHERE budget_id = ? AND account_id = ? AND ${cc ? 'cost_centre_id = ?' : 'cost_centre_id IS NULL'}`, cc ? [id, a.id, cc] : [id, a.id]);
      const am = (r.amounts || []).slice(0, 12);
      for (let i = 0; i < am.length; i++) if (Number(am[i])) await c.query('INSERT INTO budget_lines (budget_id, account_id, cost_centre_id, period, amount) VALUES (?, ?, ?, ?, ?)', [id, a.id, cc, i + 1, r2(am[i])]);
    }
  });
}
async function approveBudget(user, id, o = {}) {
  const b = await db.one('SELECT * FROM budgets WHERE id = ?', [id]); if (!b) throw notFound('Budget');
  if (b.status === 'approved') throw bad('Already approved');
  if (b.created_by === user.id && !user.permissions.includes('*')) throw bad('Someone other than the preparer approves the budget');
  const gov = require('./governance');
  return db.tx(async c => {
    if (o.reject) { await gov.reject(c, user, { doc_type: 'budget', doc_id: id, note: o.note }); return { status: b.status }; }
    const g = await gov.authorize(c, user, { doc_type: 'budget', doc_id: id, amount: 0, requester_id: b.created_by, summary: `Budget: ${b.name}`, link: '#/finance?tab=budgets', note: o.note });
    if (!g.governed && !user.permissions.includes('*') && !user.permissions.includes('accounting')) throw Object.assign(new Error('You do not have permission: accounting'), { status: 403 });
    if (!g.final) return { status: b.status, message: g.message };
    await c.query(`UPDATE budgets SET status = 'approved', approved_by = ? WHERE id = ?`, [user.id, id]);
    return { status: 'approved' };
  });
}

/* ============================== month-end close checklist ============================== */
async function closeChecklist(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw bad('Choose the month');
  const from = `${month}-01`, to = ymd(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)));
  const s = await settings();
  const q = async (sql, args) => (await db.one(sql, args).catch(() => ({ n: 0 }))).n;
  const items = [];
  const add = (key, label, ok, detail, link) => items.push({ key, label, ok: !!ok, detail, link });
  const bankOpen = await q(`SELECT COUNT(*) n FROM bank_statement_lines l JOIN bank_statements s ON s.id = l.statement_id WHERE l.line_date BETWEEN ? AND ? AND l.journal_line_id IS NULL`, [from, to]);
  add('bank', 'Bank statements reconciled', Number(bankOpen) === 0, Number(bankOpen) ? `${bankOpen} statement lines not matched` : 'All matched', '#/bank');
  const dep = await q(`SELECT COUNT(*) n FROM fixed_assets WHERE status = 'active' AND method <> 'none' AND in_service_date <= ? AND (last_dep_period IS NULL OR last_dep_period < ?)`, [to, month]);
  add('dep', 'Depreciation run', Number(dep) === 0, Number(dep) ? `${dep} assets not depreciated for ${month}` : 'Up to date', '#/assets?tab=depreciation');
  const drafts = await q(`SELECT COUNT(*) n FROM journal_batches WHERE status IN ('draft','submitted') AND entry_date BETWEEN ? AND ?`, [from, to]);
  add('journals', 'Journals posted', Number(drafts) === 0, Number(drafts) ? `${drafts} journals waiting` : 'None waiting', '#/finance?tab=journals');
  const rec = await q(`SELECT COUNT(*) n FROM recurring_journals WHERE active = 1 AND next_date <= ?`, [to]);
  add('recurring', 'Recurring journals made', Number(rec) === 0, Number(rec) ? `${rec} recurring journals due` : 'Done', '#/finance?tab=recurring');
  const sess = await q(`SELECT COUNT(*) n FROM pos_sessions WHERE status = 'open' AND opened_at <= ?`, [to + ' 23:59:59']);
  add('tills', 'Till sessions closed', Number(sess) === 0, Number(sess) ? `${sess} till sessions still open` : 'All closed', '#/recon');
  const vat = await q(`SELECT COUNT(*) n FROM tax_returns WHERE tax = 'vat' AND period_to = ? AND status IN ('filed','paid','part_paid')`, [to]);
  add('vat', 'VAT return prepared', Number(vat) > 0, Number(vat) ? 'Filed' : 'Not filed yet', '#/tax');
  const pay = await q(`SELECT COUNT(*) n FROM payroll_runs WHERE period = ? AND status IN ('approved','paid')`, [month]);
  add('payroll', 'Payroll posted', Number(pay) > 0, Number(pay) ? 'Posted' : 'No payroll posted for the month', '#/hrm');
  const tb = await trialBalance(from, to);
  add('tb', 'Trial balance balances', tb.balanced, tb.balanced ? 'Debits = credits' : 'Out of balance', '#/finance?tab=tb');
  const locked = s.lock_date && s.lock_date >= to;
  add('lock', 'Period locked', locked, locked ? `Locked up to ${s.lock_date}` : 'Lock the month when everything above is done', '#/finance?tab=periods');
  return { month, from, to, items, done: items.filter(i => i.ok).length, total: items.length };
}

module.exports = { CATS, classify, settings, saveSettings, setLock, accounts, saveAccount, costCentres, saveCostCentre, years, closeYear, reopenYear,
  saveBatch, submitBatch, approveBatch, cancelBatch, reverseEntry, batches, saveRecurring, runRecurring,
  trialBalance, generalLedger, incomeStatement, monthlyIncome, balanceSheet, cashFlow, ratios, budgets, budget, createBudget, saveBudgetLines, approveBudget, closeChecklist, balances, accountList };
