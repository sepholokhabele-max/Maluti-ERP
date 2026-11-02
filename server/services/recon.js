/**
 * Daily sales reconciliation, per payment method.
 *
 * Expected = what the system recorded as received (POS sales, VAS sales, invoice & account payments) minus refunds paid out,
 *            for each payment method on the day. "Charge to account" is excluded (no money changes hands).
 * Actual   = what was really received: counted / banked cash, card settlement batch, mobile money statement total.
 *
 * Cash over/short is already posted when each cashier session is closed, so for cash the adjustment posted on
 * approval is only the part of the variance not already booked at session close.
 *
 * Workflow: draft → submitted (preparer) → approved (a different person with recon.approve, unless admin).
 * Approval posts one journal entry with all variances against 6900 Cash Over/Short. Admin can reopen (reverses it).
 */
const db = require('../db');
const accounting = require('./accounting');
const { round2, bad, HttpError, notFound } = require('../util');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAY_FILTER = `p.status = 'completed' AND (p.order_id IS NOT NULL OR p.direction = 'in')`;
const checkDate = d => { if (!DATE_RE.test(String(d || ''))) throw bad('Invalid date'); return d; };

/** Live system figures for a date. conn must expose query() */
async function compute(conn, date) {
  const range = [date + ' 00:00:00', date + ' 23:59:59'];
  const rows = await conn.query(
    `SELECT m.id method_id, m.name, m.kind, m.account_code, m.active, m.sort_order,
        COUNT(p.id) txn_count,
        COALESCE(SUM(CASE WHEN p.direction = 'in' THEN p.amount ELSE 0 END), 0) received,
        COALESCE(SUM(CASE WHEN p.direction = 'out' THEN p.amount ELSE 0 END), 0) refunded
     FROM payment_methods m
     LEFT JOIN payments p ON p.method_id = m.id AND ${PAY_FILTER} AND p.created_at BETWEEN ? AND ?
     WHERE m.kind <> 'account'
     GROUP BY m.id ORDER BY m.sort_order, m.id`, range);
  const sessions = await conn.query(
    `SELECT s.id, t.name terminal, u.name user, s.status, s.opening_cash, s.expected_cash, s.counted_cash, s.opened_at, s.closed_at,
        ROUND(s.counted_cash - s.expected_cash, 2) difference
     FROM pos_sessions s JOIN pos_terminals t ON t.id = s.terminal_id JOIN users u ON u.id = s.user_id
     WHERE s.status = 'closed' AND s.closed_at BETWEEN ? AND ? ORDER BY s.closed_at`, range);
  const openSessions = await conn.query(
    `SELECT s.id, t.name terminal, u.name user, s.opened_at FROM pos_sessions s
     JOIN pos_terminals t ON t.id = s.terminal_id JOIN users u ON u.id = s.user_id
     WHERE s.status = 'open' AND s.opened_at <= ?`, [range[1]]);
  const account = await conn.query(
    `SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN p.direction='in' THEN p.amount ELSE -p.amount END),0) amount
     FROM payments p JOIN payment_methods m ON m.id = p.method_id
     WHERE m.kind = 'account' AND ${PAY_FILTER} AND p.created_at BETWEEN ? AND ?`, range);

  const sessionVariance = round2(sessions.reduce((s, x) => s + Number(x.difference || 0), 0));
  let cashAssigned = false;
  const lines = rows
    .filter(r => r.active || Number(r.txn_count) > 0)
    .map(r => {
      const expected = round2(Number(r.received) - Number(r.refunded));
      let already_posted = 0, suggested_actual = null;
      if (r.kind === 'cash' && !cashAssigned) {
        cashAssigned = true;
        already_posted = sessionVariance;
        suggested_actual = round2(expected + sessionVariance); // = what the cashiers counted
      }
      if (Number(r.txn_count) === 0) suggested_actual = suggested_actual ?? 0;
      return { method_id: r.method_id, name: r.name, kind: r.kind, account_code: r.account_code, txn_count: Number(r.txn_count),
        received: round2(r.received), refunded: round2(r.refunded), expected, already_posted, suggested_actual };
    });
  return { date, lines, sessions, open_sessions: openSessions, session_variance: sessionVariance,
    account_charges: { count: Number(account[0].n), amount: round2(account[0].amount) } };
}

function totals(lines) {
  const exp = round2(lines.reduce((s, l) => s + Number(l.expected), 0));
  const withActual = lines.filter(l => l.actual !== null && l.actual !== undefined && l.actual !== '');
  const act = round2(withActual.reduce((s, l) => s + Number(l.actual), 0));
  const varr = round2(withActual.reduce((s, l) => s + (Number(l.actual) - Number(l.expected)), 0));
  return { expected_total: exp, actual_total: act, variance_total: varr };
}

async function loadRecon(conn, date, lock) {
  return conn.one(
    `SELECT r.*, pu.name prepared_by_name, au.name approved_by_name FROM sales_recons r
     LEFT JOIN users pu ON pu.id = r.prepared_by LEFT JOIN users au ON au.id = r.approved_by
     WHERE r.recon_date = ? ${lock ? 'FOR UPDATE' : ''}`, [date]);
}

async function get(date) {
  checkDate(date);
  const comp = await compute(db, date);
  const rec = await loadRecon(db, date);
  if (!rec) {
    const lines = comp.lines.map(l => ({ ...l, actual: l.suggested_actual, note: '' }));
    return { ...comp, status: 'not_started', recon: null, lines, ...totals(lines), stale: false };
  }
  const saved = await db.query(
    `SELECT l.*, m.name, m.kind, m.account_code FROM sales_recon_lines l JOIN payment_methods m ON m.id = l.method_id
     WHERE l.recon_id = ? ORDER BY m.sort_order, m.id`, [rec.id]);
  let lines;
  if (rec.status === 'draft') {
    // live expected figures, keep what the user typed
    lines = comp.lines.map(l => {
      const s = saved.find(x => x.method_id === l.method_id);
      return { ...l, actual: s ? s.actual : l.suggested_actual, note: s ? s.note : '' };
    });
  } else {
    lines = saved.map(s => {
      const live = comp.lines.find(l => l.method_id === s.method_id);
      return { method_id: s.method_id, name: s.name, kind: s.kind, account_code: s.account_code, txn_count: s.txn_count,
        received: Number(s.received), refunded: Number(s.refunded), expected: Number(s.expected), actual: s.actual == null ? null : Number(s.actual),
        already_posted: Number(s.already_posted), adjustment_posted: Number(s.adjustment_posted), note: s.note,
        suggested_actual: live ? live.suggested_actual : null, live_expected: live ? live.expected : 0 };
    });
  }
  // transactions recorded after the recon was frozen?
  const stale = rec.status !== 'draft' && (
    comp.lines.some(l => { const s = lines.find(x => x.method_id === l.method_id); return Math.abs((s ? s.expected : 0) - l.expected) > 0.009; }));
  return { ...comp, status: rec.status, recon: rec, lines, ...totals(lines), stale };
}

async function save(user, date, body = {}) {
  checkDate(date);
  return db.tx(async c => {
    let rec = await loadRecon(c, date, true);
    if (rec && rec.status !== 'draft') throw bad(`This day is already ${rec.status}. ${rec.status === 'submitted' ? 'Ask the approver to send it back.' : ''}`);
    if (!rec) {
      await c.query(`INSERT INTO sales_recons (recon_date, status, prepared_by) VALUES (?, 'draft', ?)`, [date, user.id]);
      rec = await loadRecon(c, date, true);
    }
    const comp = await compute(c, date);
    const input = new Map((body.lines || []).map(l => [Number(l.method_id), l]));
    const lines = comp.lines.map(l => {
      const i = input.get(l.method_id) || {};
      const raw = i.actual;
      const actual = raw === '' || raw === null || raw === undefined ? null : round2(raw);
      if (actual !== null && !isFinite(actual)) throw bad(`Invalid amount for ${l.name}`);
      return { ...l, actual, note: i.note ? String(i.note).slice(0, 250) : null };
    });
    await c.query('DELETE FROM sales_recon_lines WHERE recon_id = ?', [rec.id]);
    for (const l of lines) {
      await c.query(
        `INSERT INTO sales_recon_lines (recon_id, method_id, txn_count, received, refunded, expected, actual, already_posted, variance, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [rec.id, l.method_id, l.txn_count, l.received, l.refunded, l.expected, l.actual, l.already_posted,
          l.actual === null ? 0 : round2(l.actual - l.expected), l.note]);
    }
    const t = totals(lines);
    await c.query('UPDATE sales_recons SET expected_total = ?, actual_total = ?, variance_total = ?, notes = COALESCE(?, notes) WHERE id = ?',
      [t.expected_total, t.actual_total, t.variance_total, body.notes ?? null, rec.id]);
    return { id: rec.id, lines };
  });
}

async function submit(user, date, body) {
  const { lines } = await save(user, date, body);
  const missing = lines.filter(l => l.actual === null);
  if (missing.length) throw bad(`Enter the actual amount for: ${missing.map(l => l.name).join(', ')}`);
  await db.query(`UPDATE sales_recons SET status = 'submitted', prepared_by = ?, prepared_at = NOW() WHERE recon_date = ?`, [user.id, date]);
  await audit(user, 'recon.submit', date);
}

async function approve(user, date, { notes } = {}) {
  checkDate(date);
  await db.tx(async c => {
    const rec = await loadRecon(c, date, true);
    if (!rec) throw notFound('Reconciliation');
    if (rec.status !== 'submitted') throw bad('Only submitted reconciliations can be approved');
    if (rec.prepared_by === user.id && user.role !== 'admin')
      throw new HttpError(403, 'A different person must approve the reconciliation they prepared');
    const lines = await c.query(
      `SELECT l.*, m.name, m.account_code FROM sales_recon_lines l JOIN payment_methods m ON m.id = l.method_id WHERE recon_id = ?`, [rec.id]);
    const jl = [];
    for (const l of lines) {
      const adj = round2(Number(l.actual) - Number(l.expected) - Number(l.already_posted));
      l.adj = adj;
      if (!adj) continue;
      if (adj > 0) jl.push({ code: l.account_code, debit: adj, description: `${l.name} over` }, { code: '6900', credit: adj, description: `${l.name} over` });
      else jl.push({ code: '6900', debit: -adj, description: `${l.name} short` }, { code: l.account_code, credit: -adj, description: `${l.name} short` });
    }
    const entryId = jl.length ? await accounting.post(c, { date, reference: `RECON ${date}`, memo: `Sales reconciliation ${date}`,
      source_type: 'sales_recon', source_id: rec.id, user_id: user.id, lines: jl }) : null;
    for (const l of lines) await c.query('UPDATE sales_recon_lines SET adjustment_posted = ? WHERE id = ?', [l.adj, l.id]);
    await c.query(`UPDATE sales_recons SET status = 'approved', approved_by = ?, approved_at = NOW(), adjust_entry_id = ?,
      notes = CASE WHEN ? IS NULL OR ? = '' THEN notes ELSE CONCAT(COALESCE(notes,''), IF(notes IS NULL OR notes = '', '', '\\n'), ?) END WHERE id = ?`,
      [user.id, entryId, notes || null, notes || null, notes ? `Approver: ${notes}` : null, rec.id]);
  });
  await audit(user, 'recon.approve', date);
}

async function reject(user, date, { reason } = {}) {
  checkDate(date);
  const rec = await loadRecon(db, date);
  if (!rec || rec.status !== 'submitted') throw bad('Only submitted reconciliations can be sent back');
  await db.query(`UPDATE sales_recons SET status = 'draft', notes = CONCAT(COALESCE(notes,''), ?) WHERE id = ?`,
    [`${rec.notes ? '\n' : ''}Sent back by ${user.name}: ${reason || '(no reason)'}`, rec.id]);
  await audit(user, 'recon.reject', date, { reason });
}

async function reopen(user, date) {
  checkDate(date);
  if (user.role !== 'admin') throw new HttpError(403, 'Only an administrator can reopen an approved reconciliation');
  await db.tx(async c => {
    const rec = await loadRecon(c, date, true);
    if (!rec || rec.status !== 'approved') throw bad('Only approved reconciliations can be reopened');
    if (rec.adjust_entry_id) {
      const lines = await c.query(
        `SELECT a.code, l.debit, l.credit, l.description FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ?`, [rec.adjust_entry_id]);
      await accounting.post(c, { date, reference: `RECON ${date} REOPEN`, memo: `Reversal of reconciliation ${date}`,
        source_type: 'sales_recon_reversal', source_id: rec.id, user_id: user.id,
        lines: lines.map(l => ({ code: l.code, debit: l.credit, credit: l.debit, description: l.description })) });
    }
    await c.query(`UPDATE sales_recon_lines SET adjustment_posted = 0 WHERE recon_id = ?`, [rec.id]);
    await c.query(`UPDATE sales_recons SET status = 'draft', approved_by = NULL, approved_at = NULL, adjust_entry_id = NULL WHERE id = ?`, [rec.id]);
  });
  await audit(user, 'recon.reopen', date);
}

/** Individual payments for one method on one day, with duplicate-reference detection */
async function transactions(date, methodId) {
  checkDate(date);
  const rows = await db.query(
    `SELECT p.id, p.created_at, p.direction, p.amount, p.reference, p.phone, p.session_id, u.name user_name,
        o.number order_number, o.id order_id, i.number invoice_number, pa.name partner_name, t.name terminal
     FROM payments p LEFT JOIN users u ON u.id = p.user_id LEFT JOIN orders o ON o.id = p.order_id
     LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN partners pa ON pa.id = p.partner_id
     LEFT JOIN pos_sessions s ON s.id = p.session_id LEFT JOIN pos_terminals t ON t.id = s.terminal_id
     WHERE p.method_id = ? AND ${PAY_FILTER} AND p.created_at BETWEEN ? AND ? ORDER BY p.created_at, p.id`,
    [methodId, date + ' 00:00:00', date + ' 23:59:59']);
  const refs = [...new Set(rows.filter(r => r.direction === 'in' && r.reference).map(r => r.reference))];
  let dups = [];
  if (refs.length) {
    dups = await db.query(
      `SELECT reference, COUNT(*) n FROM payments WHERE method_id = ? AND direction = 'in' AND status = 'completed' AND reference IN (?)
       GROUP BY reference HAVING COUNT(*) > 1`, [methodId, refs]);
  }
  const dupMap = new Map(dups.map(d => [d.reference, Number(d.n)]));
  return rows.map(r => ({ ...r, duplicate_count: r.direction === 'in' && r.reference ? (dupMap.get(r.reference) || 0) : 0 }));
}

/** One row per day for the last `days` days that had sales or a recon */
async function list(days = 45) {
  days = Math.min(Math.max(Number(days) || 45, 1), 366);
  const sales = await db.query(
    `SELECT DATE(p.created_at) d, COUNT(*) txns, COALESCE(SUM(CASE WHEN p.direction='in' THEN p.amount ELSE -p.amount END),0) amount
     FROM payments p JOIN payment_methods m ON m.id = p.method_id
     WHERE ${PAY_FILTER} AND m.kind <> 'account' AND p.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(p.created_at)`, [days]);
  const recs = await db.query(
    `SELECT r.*, pu.name prepared_by_name, au.name approved_by_name FROM sales_recons r
     LEFT JOIN users pu ON pu.id = r.prepared_by LEFT JOIN users au ON au.id = r.approved_by
     WHERE r.recon_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`, [days]);
  const map = new Map();
  for (const s of sales) map.set(s.d, { date: s.d, txns: Number(s.txns), amount: round2(s.amount), status: 'not_started' });
  for (const r of recs) {
    const row = map.get(r.recon_date) || { date: r.recon_date, txns: 0, amount: 0 };
    Object.assign(row, { status: r.status, expected_total: Number(r.expected_total), actual_total: Number(r.actual_total),
      variance_total: Number(r.variance_total), prepared_by_name: r.prepared_by_name, approved_by_name: r.approved_by_name });
    map.set(r.recon_date, row);
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** Days before today that had sales but are not approved */
async function pendingCount(days = 30) {
  const t = new Date(); const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  return (await list(days)).filter(r => r.date < today && r.status !== 'approved').length;
}

async function audit(user, action, date, details) {
  await db.query(`INSERT INTO audit_log (user_id, action, entity, details) VALUES (?, ?, 'sales_recon', ?)`,
    [user.id, action, JSON.stringify({ date, ...(details || {}) })]);
}

module.exports = { compute, get, save, submit, approve, reject, reopen, transactions, list, pendingCount, checkDate };
