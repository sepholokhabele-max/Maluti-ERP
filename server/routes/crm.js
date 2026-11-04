// CRM: customer 360 view, activities (notes, calls, meetings, tasks), emailing customers
const express = require('express');
const db = require('../db');
const mailer = require('../services/mailer');
const { requirePerm } = require('../auth');
const { ah, bad, notFound, round2 } = require('../util');

const r = express.Router();
r.use(requirePerm('crm'));

const TYPES = ['note', 'call', 'meeting', 'task', 'email', 'sms', 'visit'];
const SALES = `o.status IN ('paid','refunded')`;
const AR_BAL = `(SELECT COALESCE(SUM(l.debit - l.credit),0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '1100' AND l.partner_id = p.id)`;

// lightweight user list for "assign to"
r.get('/users', ah(async (req, res) => res.json(await db.query('SELECT id, name, role FROM users WHERE active = 1 ORDER BY name'))));

// ---------- customers with stats ----------
r.get('/customers', ah(async (req, res) => {
  const cond = ['p.is_customer = 1', 'p.active = 1'], args = [];
  if (req.query.q) { cond.push('(p.name LIKE ? OR p.phone LIKE ? OR p.email LIKE ? OR p.tags LIKE ?)'); for (let i = 0; i < 4; i++) args.push(`%${req.query.q}%`); }
  if (req.query.tag) { cond.push('CONCAT(",", REPLACE(COALESCE(p.tags,""), ", ", ","), ",") LIKE ?'); args.push(`%,${req.query.tag},%`); }
  if (req.query.owner_id) { cond.push('p.owner_id = ?'); args.push(req.query.owner_id); }
  const rows = await db.query(
    `SELECT p.id, p.name, p.phone, p.email, p.tags, p.birthday, p.owner_id, ow.name owner_name,
       (SELECT COUNT(*) FROM orders o WHERE o.partner_id = p.id AND ${SALES} AND o.refund_of IS NULL) pos_orders,
       (SELECT COALESCE(SUM(o.total),0) FROM orders o WHERE o.partner_id = p.id AND ${SALES}) pos_spent,
       (SELECT COALESCE(SUM(i.total),0) FROM invoices i WHERE i.partner_id = p.id AND i.kind = 'customer_invoice' AND i.status IN ('posted','partial','paid')) invoiced,
       (SELECT MAX(o.paid_at) FROM orders o WHERE o.partner_id = p.id AND ${SALES}) last_visit,
       (SELECT COUNT(*) FROM crm_activities a WHERE a.partner_id = p.id AND a.done = 0) open_activities,
       ${AR_BAL} balance
     FROM partners p LEFT JOIN users ow ON ow.id = p.owner_id
     WHERE ${cond.join(' AND ')} ORDER BY p.name LIMIT 5000`, args);
  let out = rows.map(x => ({ ...x, total_spent: round2(Number(x.pos_spent) + Number(x.invoiced)), balance: round2(x.balance) }));
  if (req.query.inactive_days) {
    const cutoff = Date.now() - Number(req.query.inactive_days) * 86400000;
    out = out.filter(x => !x.last_visit || new Date(String(x.last_visit).replace(' ', 'T')).getTime() < cutoff);
  }
  const sort = req.query.sort || 'name';
  const cmp = { spent: (a, b) => b.total_spent - a.total_spent, last_visit: (a, b) => String(b.last_visit || '').localeCompare(String(a.last_visit || '')),
    balance: (a, b) => b.balance - a.balance, orders: (a, b) => b.pos_orders - a.pos_orders }[sort];
  if (cmp) out.sort(cmp);
  res.json(out);
}));

// ---------- customer 360 ----------
r.get('/customers/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  const p = await db.one('SELECT p.*, ow.name owner_name FROM partners p LEFT JOIN users ow ON ow.id = p.owner_id WHERE p.id = ?', [id]);
  if (!p) throw notFound('Customer');
  const st = await db.one(
    `SELECT COUNT(CASE WHEN o.refund_of IS NULL THEN 1 END) orders, COALESCE(SUM(o.total),0) pos_spent,
       MIN(o.paid_at) first_visit, MAX(o.paid_at) last_visit,
       COUNT(DISTINCT CASE WHEN o.paid_at >= DATE_SUB(NOW(), INTERVAL 90 DAY) AND o.refund_of IS NULL THEN DATE(o.paid_at) END) visits_90d,
       COALESCE(SUM(CASE WHEN o.refund_of IS NOT NULL THEN -o.total ELSE 0 END),0) refunds
     FROM orders o WHERE o.partner_id = ? AND ${SALES}`, [id]);
  const inv = await db.one(
    `SELECT COUNT(*) n, COALESCE(SUM(total),0) invoiced, COALESCE(SUM(total - amount_paid),0) open_amount,
       COALESCE(SUM(CASE WHEN COALESCE(due_date, invoice_date) < CURDATE() THEN total - amount_paid ELSE 0 END),0) overdue
     FROM invoices WHERE partner_id = ? AND kind = 'customer_invoice' AND status IN ('posted','partial','paid')`, [id]);
  const bal = await db.one(`SELECT COALESCE(SUM(l.debit - l.credit),0) b FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '1100' AND l.partner_id = ?`, [id]);
  const spent = round2(Number(st.pos_spent) + Number(inv.invoiced));
  const txCount = Number(st.orders) + Number(inv.n);

  const monthlyPos = await db.query(
    `SELECT DATE_FORMAT(o.paid_at, '%Y-%m') m, SUM(o.total) total FROM orders o WHERE o.partner_id = ? AND ${SALES}
       AND o.paid_at >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 11 MONTH), '%Y-%m-01') GROUP BY m`, [id]);
  const monthlyInv = await db.query(
    `SELECT DATE_FORMAT(invoice_date, '%Y-%m') m, SUM(total) total FROM invoices WHERE partner_id = ? AND kind = 'customer_invoice'
       AND status IN ('posted','partial','paid') AND invoice_date >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 11 MONTH), '%Y-%m-01') GROUP BY m`, [id]);
  const monthly = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const t = [...monthlyPos, ...monthlyInv].filter(x => x.m === m).reduce((s, x) => s + Number(x.total), 0);
    monthly.push({ month: m, total: round2(t) });
  }

  const favourites = await db.query(
    `SELECT l.product_id, l.name, SUM(l.qty) qty, SUM(l.line_total) total, MAX(o.paid_at) last_bought
     FROM order_lines l JOIN orders o ON o.id = l.order_id
     WHERE o.partner_id = ? AND ${SALES} AND l.vas_transaction_id IS NULL
     GROUP BY l.product_id, l.name HAVING SUM(l.qty) > 0 ORDER BY qty DESC LIMIT 10`, [id]);
  const orders = await db.query(
    `SELECT o.id, o.number, o.mode, o.status, o.total, o.refund_of, COALESCE(o.paid_at, o.created_at) at, u.name user_name, t.name table_name, o.tab_name
     FROM orders o LEFT JOIN users u ON u.id = o.user_id LEFT JOIN restaurant_tables t ON t.id = o.table_id
     WHERE o.partner_id = ? ORDER BY o.id DESC LIMIT 30`, [id]);
  const invoices = await db.query(
    `SELECT id, number, invoice_date, due_date, status, total, amount_paid FROM invoices
     WHERE partner_id = ? AND kind = 'customer_invoice' ORDER BY id DESC LIMIT 30`, [id]);
  const payments = await db.query(
    `SELECT p.id, p.created_at, p.direction, p.amount, p.reference, p.order_id, p.invoice_id, m.name method FROM payments p
     JOIN payment_methods m ON m.id = p.method_id WHERE p.partner_id = ? AND p.status = 'completed' ORDER BY p.id DESC LIMIT 30`, [id]);
  const activities = await db.query(
    `SELECT a.*, au.name assigned_name, cu.name created_name FROM crm_activities a
     LEFT JOIN users au ON au.id = a.assigned_to LEFT JOIN users cu ON cu.id = a.created_by
     WHERE a.partner_id = ? ORDER BY a.id DESC LIMIT 300`, [id]);

  res.json({
    customer: p,
    stats: {
      total_spent: spent, pos_spent: round2(st.pos_spent), invoiced: round2(inv.invoiced), orders: Number(st.orders), invoices: Number(inv.n),
      avg_ticket: txCount ? round2(spent / txCount) : 0, first_visit: st.first_visit, last_visit: st.last_visit, visits_90d: Number(st.visits_90d),
      refunds: round2(st.refunds), balance: round2(bal.b), open_invoices: round2(inv.open_amount), overdue: round2(inv.overdue)
    },
    monthly, favourites, orders, invoices, payments, activities
  });
}));

// ---------- activities ----------
function cleanActivity(b, partial) {
  const out = {};
  if (b.type !== undefined) { if (!TYPES.includes(b.type)) throw bad('Invalid activity type'); out.type = b.type; }
  if (b.subject !== undefined) { if (!String(b.subject).trim()) throw bad('Subject is required'); out.subject = String(b.subject).slice(0, 200); }
  if (b.body !== undefined) out.body = b.body || null;
  if (b.due_at !== undefined) out.due_at = b.due_at ? String(b.due_at).replace('T', ' ').slice(0, 19) : null;
  if (b.assigned_to !== undefined) out.assigned_to = b.assigned_to ? Number(b.assigned_to) : null;
  if (b.done !== undefined) { out.done = b.done ? 1 : 0; }
  if (!partial && !out.subject) throw bad('Subject is required');
  return out;
}

r.get('/activities', ah(async (req, res) => {
  const cond = [], args = [];
  if (req.query.scope !== 'all') { cond.push('a.assigned_to = ?'); args.push(req.user.id); }
  if (req.query.status === 'done') cond.push('a.done = 1');
  else if (req.query.status !== 'any') cond.push('a.done = 0');
  if (req.query.partner_id) { cond.push('a.partner_id = ?'); args.push(req.query.partner_id); }
  if (req.query.lead_id) { cond.push('a.lead_id = ?'); args.push(req.query.lead_id); }
  if (req.query.type) { cond.push('a.type = ?'); args.push(req.query.type); }
  res.json(await db.query(
    `SELECT a.*, COALESCE(p.name, l.company, l.contact_name, l.title) partner_name, COALESCE(p.phone, l.phone) partner_phone, l.title lead_title, au.name assigned_name, cu.name created_name,
       (a.done = 0 AND a.due_at IS NOT NULL AND a.due_at < NOW()) overdue
     FROM crm_activities a LEFT JOIN partners p ON p.id = a.partner_id LEFT JOIN leads l ON l.id = a.lead_id
     LEFT JOIN users au ON au.id = a.assigned_to LEFT JOIN users cu ON cu.id = a.created_by
     ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
     ORDER BY a.done, a.due_at IS NULL, a.due_at, a.id DESC LIMIT 500`, args));
}));

r.get('/summary', ah(async (req, res) => {
  const x = await db.one(
    `SELECT COALESCE(SUM(due_at < NOW()),0) overdue, COALESCE(SUM(DATE(due_at) = CURDATE() AND due_at >= NOW()),0) today, COUNT(*) open
     FROM crm_activities WHERE done = 0 AND assigned_to = ?`, [req.user.id]);
  const bdays = await db.query(
    `SELECT id, name, birthday FROM partners WHERE is_customer = 1 AND active = 1 AND birthday IS NOT NULL`);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const upcoming = bdays.map(b => {
    const [, mm, dd] = String(b.birthday).split('-').map(Number);
    let next = new Date(now.getFullYear(), mm - 1, dd);
    if (next < now) next = new Date(now.getFullYear() + 1, mm - 1, dd);
    return { ...b, in_days: Math.round((next - now) / 86400000) };
  }).filter(b => b.in_days <= 7).sort((a, b) => a.in_days - b.in_days);
  res.json({ overdue: Number(x.overdue), today: Number(x.today), open: Number(x.open), birthdays: upcoming });
}));

r.post('/activities', ah(async (req, res) => {
  const a = cleanActivity(req.body);
  const lead = req.body.lead_id ? await db.one('SELECT id, partner_id FROM leads WHERE id = ?', [req.body.lead_id]) : null;
  const partner = await db.one('SELECT id FROM partners WHERE id = ?', [req.body.partner_id || (lead && lead.partner_id) || 0]);
  if (!partner && !lead) throw bad('Choose a customer');
  // notes / logged calls default to done; tasks default to open and assigned to the creator
  const done = a.done !== undefined ? a.done : (['note', 'email', 'sms', 'visit'].includes(a.type || 'note') ? 1 : 0);
  const ins = await db.query(
    `INSERT INTO crm_activities (partner_id, lead_id, type, subject, body, due_at, done, done_at, assigned_to, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [partner ? partner.id : null, lead ? lead.id : null, a.type || 'note', a.subject, a.body || null, a.due_at || null, done, done ? new Date() : null,
      a.assigned_to !== undefined ? a.assigned_to : req.user.id, req.user.id]);
  res.json(await db.one('SELECT * FROM crm_activities WHERE id = ?', [ins.insertId]));
}));

r.put('/activities/:id', ah(async (req, res) => {
  const a = cleanActivity(req.body, true);
  if (a.done !== undefined) a.done_at = a.done ? new Date() : null;
  if (Object.keys(a).length) await db.query('UPDATE crm_activities SET ? WHERE id = ?', [a, req.params.id]);
  res.json(await db.one('SELECT * FROM crm_activities WHERE id = ?', [req.params.id]));
}));

r.delete('/activities/:id', ah(async (req, res) => {
  const a = await db.one('SELECT * FROM crm_activities WHERE id = ?', [req.params.id]);
  if (!a) throw notFound('Activity');
  if (a.created_by !== req.user.id && !['admin', 'manager'].includes(req.user.role)) throw bad('Only the author or a manager can delete this');
  await db.query('DELETE FROM crm_activities WHERE id = ?', [a.id]);
  res.json({ ok: true });
}));

// ---------- email a customer (logged as an activity) ----------
r.post('/customers/:id/email', ah(async (req, res) => {
  const p = await db.one('SELECT * FROM partners WHERE id = ?', [req.params.id]);
  if (!p) throw notFound('Customer');
  if (!p.email) throw bad('This customer has no email address');
  const subject = String(req.body.subject || '').trim();
  if (!subject || !req.body.body) throw bad('Subject and message are required');
  await mailer.sendMail({ to: p.email, subject, text: req.body.body, kind: 'crm' });
  await db.query(
    `INSERT INTO crm_activities (partner_id, type, subject, body, done, done_at, assigned_to, created_by) VALUES (?, 'email', ?, ?, 1, NOW(), ?, ?)`,
    [p.id, subject, req.body.body, req.user.id, req.user.id]);
  res.json({ ok: true });
}));

module.exports = r;
