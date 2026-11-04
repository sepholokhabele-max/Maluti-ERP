// Services: projects, tasks, timesheets (with invoicing by the hour) and helpdesk / repairs (job cards)
const express = require('express');
const db = require('../db');
const { requirePerm, can } = require('../auth');
const { ah, bad, notFound, round2, pad, today, HttpError } = require('../util');

const r = express.Router();
const PRI = ['low', 'normal', 'high', 'urgent'];
const forbid = m => new HttpError(403, m || 'Not allowed');

/** what an hour of this person costs the business (basic salary → hourly, using the attendance weekly hours) */
async function costRate(userId) {
  const emp = await db.one(`SELECT basic_salary FROM employees WHERE user_id = ? AND status = 'active'`, [userId]).catch(() => null);
  if (!emp || !Number(emp.basic_salary)) return 0;
  const att = { weekly_hours: 45, ...((await db.getSetting('attendance', {})) || {}) };
  return round2(Number(emp.basic_salary) * 12 / 52 / Number(att.weekly_hours || 45));
}
const vatRate = async () => Number(((await db.getSetting('company', {})) || {}).default_vat ?? 15);

/* ======================= PROJECTS ======================= */
const PJ_SQL = `SELECT p.*, c.name partner_name, u.name manager_name,
    (SELECT COALESCE(SUM(t.hours),0) FROM timesheets t WHERE t.project_id = p.id) hours,
    (SELECT COALESCE(SUM(t.hours),0) FROM timesheets t WHERE t.project_id = p.id AND t.billable = 1 AND t.invoice_id IS NULL) to_invoice_hours,
    (SELECT COALESCE(SUM(t.hours * t.rate),0) FROM timesheets t WHERE t.project_id = p.id AND t.billable = 1 AND t.invoice_id IS NULL) to_invoice_amount,
    (SELECT COALESCE(SUM(t.hours * t.cost_rate),0) FROM timesheets t WHERE t.project_id = p.id) labour_cost,
    (SELECT COALESCE(SUM(i.subtotal),0) FROM invoices i WHERE i.project_id = p.id AND i.kind = 'customer_invoice' AND i.status IN ('posted','partial','paid')) invoiced,
    (SELECT COALESCE(SUM(x.amount),0) FROM expense_claims x WHERE x.project_id = p.id AND x.status IN ('approved','reimbursed')) expenses,
    (SELECT COUNT(*) FROM tasks k WHERE k.project_id = p.id AND k.status <> 'done') open_tasks,
    (SELECT COUNT(*) FROM tasks k WHERE k.project_id = p.id) all_tasks
  FROM projects p LEFT JOIN partners c ON c.id = p.partner_id LEFT JOIN users u ON u.id = p.manager_id`;
const num = p => { for (const k of ['hours', 'to_invoice_hours', 'to_invoice_amount', 'labour_cost', 'invoiced', 'expenses']) p[k] = round2(p[k]); p.profit = round2(p.invoiced - p.labour_cost - p.expenses); return p; };

r.get('/projects', ah(async (req, res) => {
  const cond = [], args = [];
  const st = req.query.status || 'active';
  if (st !== 'all') { cond.push('p.status = ?'); args.push(st); }
  // people without project rights only see projects they have tasks on
  if (!can(req.user, 'projects')) { cond.push('(p.manager_id = ? OR EXISTS (SELECT 1 FROM tasks k WHERE k.project_id = p.id AND k.assigned_to = ?))'); args.push(req.user.id, req.user.id); }
  res.json((await db.query(`${PJ_SQL} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY p.end_date IS NULL, p.end_date, p.name`, args)).map(num));
}));
async function getProject(id, user) {
  const p = await db.one(`${PJ_SQL} WHERE p.id = ?`, [id]);
  if (!p) throw notFound('Project');
  if (!can(user, 'projects') && p.manager_id !== user.id && !(await db.one('SELECT 1 x FROM tasks WHERE project_id = ? AND assigned_to = ? LIMIT 1', [p.id, user.id]))) throw forbid();
  num(p);
  p.tasks = await db.query(`SELECT k.*, u.name assigned_name, (SELECT COALESCE(SUM(t.hours),0) FROM timesheets t WHERE t.task_id = k.id) hours
    FROM tasks k LEFT JOIN users u ON u.id = k.assigned_to WHERE k.project_id = ? ORDER BY FIELD(k.status,'doing','todo','review','done'), k.sort, FIELD(k.priority,'urgent','high','normal','low'), k.due_date IS NULL, k.due_date, k.id`, [p.id]);
  p.by_person = await db.query(`SELECT u.name, SUM(t.hours) hours, SUM(t.hours * t.cost_rate) cost FROM timesheets t JOIN users u ON u.id = t.user_id WHERE t.project_id = ? GROUP BY u.id, u.name ORDER BY hours DESC`, [p.id]);
  p.invoices = await db.query(`SELECT id, number, status, invoice_date, subtotal, total FROM invoices WHERE project_id = ? AND kind = 'customer_invoice' ORDER BY id DESC`, [p.id]);
  p.budget_used_pct = p.budget_hours ? round2(p.hours / Number(p.budget_hours) * 100) : null;
  return p;
}
r.get('/projects/:id(\\d+)', ah(async (req, res) => res.json(await getProject(req.params.id, req.user))));
function cleanProject(b) {
  const v = { name: String(b.name || '').trim().slice(0, 160) };
  if (!v.name) throw bad('Give the project a name');
  v.code = b.code ? String(b.code).trim().toUpperCase().slice(0, 30) : null;
  for (const k of ['partner_id', 'manager_id', 'location_id', 'sale_order_id']) v[k] = Number(b[k]) || null;
  v.status = ['active', 'on_hold', 'done', 'cancelled'].includes(b.status) ? b.status : 'active';
  v.billing = ['hourly', 'fixed', 'none'].includes(b.billing) ? b.billing : 'hourly';
  v.hourly_rate = round2(Math.max(0, Number(b.hourly_rate) || 0));
  v.budget_hours = Number(b.budget_hours) > 0 ? round2(b.budget_hours) : null;
  v.budget_amount = Number(b.budget_amount) > 0 ? round2(b.budget_amount) : null;
  v.start_date = b.start_date || null; v.end_date = b.end_date || null;
  if (v.start_date && v.end_date && v.end_date < v.start_date) throw bad('The end date is before the start date');
  v.description = b.description ? String(b.description).slice(0, 5000) : null;
  if (v.billing !== 'none' && !v.partner_id) throw bad('Choose the customer to bill (or set billing to "not billed" for internal projects)');
  return v;
}
r.post('/projects', requirePerm('projects'), ah(async (req, res) => {
  const v = cleanProject(req.body);
  if (v.code && await db.one('SELECT id FROM projects WHERE code = ?', [v.code])) throw bad(`Code ${v.code} is already used`);
  const ins = await db.query('INSERT INTO projects SET ?', [v]);
  if (!v.code) await db.query('UPDATE projects SET code = ? WHERE id = ?', [`PRJ-${pad(ins.insertId, 4)}`, ins.insertId]);
  res.json(await getProject(ins.insertId, req.user));
}));
r.put('/projects/:id(\\d+)', requirePerm('projects'), ah(async (req, res) => {
  const p = await db.one('SELECT * FROM projects WHERE id = ?', [req.params.id]);
  if (!p) throw notFound();
  const v = cleanProject({ ...p, ...req.body });
  if (!v.code) v.code = p.code;
  if (v.code && await db.one('SELECT id FROM projects WHERE code = ? AND id <> ?', [v.code, p.id])) throw bad(`Code ${v.code} is already used`);
  await db.query('UPDATE projects SET ? WHERE id = ?', [v, p.id]);
  res.json(await getProject(p.id, req.user));
}));

/**
 * Invoice a project. Hourly: all billable, not yet invoiced hours up to `to`, one line per task and rate.
 * Fixed price: `amount` (or `percent` of the budget) as a progress / milestone line.
 */
r.post('/projects/:id(\\d+)/invoice', requirePerm('invoicing'), ah(async (req, res) => {
  const biz = require('./business');
  const out = await db.tx(async c => {
    const p = await c.one('SELECT * FROM projects WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!p) throw notFound();
    if (!p.partner_id) throw bad('Set the customer on the project first');
    const vat = await vatRate();
    const lines = []; let ids = [];
    if (p.billing === 'fixed' || req.body.amount || req.body.percent) {
      let amt = Number(req.body.amount) || 0;
      if (!amt && req.body.percent && p.budget_amount) amt = round2(Number(p.budget_amount) * Number(req.body.percent) / 100);
      if (!(amt > 0)) throw bad('Enter the amount (or % of the contract value) to invoice');
      lines.push({ description: (req.body.description || `${p.name} – progress invoice${req.body.percent ? ` (${Number(req.body.percent)}%)` : ''}`).slice(0, 200), qty: 1, unit_price: amt, tax_rate: vat });
    } else {
      const to = req.body.to || today();
      const ts = await c.query(`SELECT t.*, k.title task_title FROM timesheets t LEFT JOIN tasks k ON k.id = t.task_id
        WHERE t.project_id = ? AND t.billable = 1 AND t.invoice_id IS NULL AND t.work_date <= ? FOR UPDATE`, [p.id, to]);
      if (!ts.length) throw bad('No billable hours to invoice yet');
      const groups = new Map();
      for (const t of ts) {
        const rate = Number(t.rate) || Number(p.hourly_rate);
        const key = `${t.task_id || 0}:${rate}`;
        if (!groups.has(key)) groups.set(key, { description: `${p.name}${t.task_title ? ' – ' + t.task_title : ''}`.slice(0, 190), hours: 0, rate });
        groups.get(key).hours += Number(t.hours);
      }
      for (const g of groups.values()) lines.push({ description: `${g.description} (hours)`, qty: round2(g.hours), unit_price: g.rate, tax_rate: vat });
      ids = ts.map(t => t.id);
      if (lines.every(l => !(l.unit_price > 0))) throw bad('These hours have no rate. Set the hourly rate on the project first.');
    }
    const invId = await biz.createInvoice(c, req.user, { kind: 'customer_invoice', partner_id: p.partner_id, lines: biz.calcLines(lines, 'unit_price'), notes: `Project ${p.code || ''} ${p.name}`.trim().slice(0, 255), location_id: p.location_id });
    await c.query('UPDATE invoices SET project_id = ? WHERE id = ?', [p.id, invId]);
    if (ids.length) await c.query('UPDATE timesheets SET invoice_id = ? WHERE id IN (?)', [invId, ids]);
    return { invoice_id: invId, hours_lines: ids.length };
  });
  res.json(out);
}));

/* ======================= TASKS ======================= */
async function canTask(user, task) {
  if (can(user, 'projects')) return true;
  if (task.assigned_to === user.id) return true;
  const p = await db.one('SELECT manager_id FROM projects WHERE id = ?', [task.project_id]);
  return p && p.manager_id === user.id;
}
r.get('/tasks', ah(async (req, res) => {
  const cond = [], args = [];
  if (req.query.project_id) { cond.push('k.project_id = ?'); args.push(req.query.project_id); }
  if (req.query.mine || !can(req.user, 'projects')) { cond.push('k.assigned_to = ?'); args.push(req.user.id); }
  if (req.query.open) cond.push(`k.status <> 'done'`);
  res.json(await db.query(`SELECT k.*, p.name project_name, p.code project_code, u.name assigned_name, (SELECT COALESCE(SUM(t.hours),0) FROM timesheets t WHERE t.task_id = k.id) hours
    FROM tasks k JOIN projects p ON p.id = k.project_id LEFT JOIN users u ON u.id = k.assigned_to
    ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY FIELD(k.status,'doing','todo','review','done'), FIELD(k.priority,'urgent','high','normal','low'), k.due_date IS NULL, k.due_date LIMIT 1000`, args));
}));
function cleanTask(b) {
  const v = { title: String(b.title || '').trim().slice(0, 200) };
  if (!v.title) throw bad('Give the task a title');
  v.description = b.description ? String(b.description).slice(0, 5000) : null;
  v.status = ['todo', 'doing', 'review', 'done'].includes(b.status) ? b.status : 'todo';
  v.priority = PRI.includes(b.priority) ? b.priority : 'normal';
  v.assigned_to = Number(b.assigned_to) || null;
  v.due_date = b.due_date || null;
  v.estimate_hours = Number(b.estimate_hours) > 0 ? round2(b.estimate_hours) : null;
  return v;
}
r.post('/tasks', ah(async (req, res) => {
  const p = await db.one('SELECT * FROM projects WHERE id = ?', [req.body.project_id]);
  if (!p) throw bad('Choose the project');
  if (!can(req.user, 'projects') && p.manager_id !== req.user.id) throw forbid('Only the project manager can add tasks');
  const v = cleanTask(req.body);
  const ins = await db.query('INSERT INTO tasks SET ?', [{ ...v, project_id: p.id, created_by: req.user.id, done_at: v.status === 'done' ? new Date() : null }]);
  res.json(await db.one('SELECT * FROM tasks WHERE id = ?', [ins.insertId]));
}));
r.put('/tasks/:id(\\d+)', ah(async (req, res) => {
  const k = await db.one('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
  if (!k) throw notFound();
  if (!await canTask(req.user, k)) throw forbid('This task is not yours');
  // the person doing a task may only move it along; managers can change everything
  const full = can(req.user, 'projects') || (await db.one('SELECT manager_id FROM projects WHERE id = ?', [k.project_id])).manager_id === req.user.id;
  const v = full ? cleanTask({ ...k, ...req.body }) : { status: ['todo', 'doing', 'review', 'done'].includes(req.body.status) ? req.body.status : k.status };
  v.done_at = v.status === 'done' ? (k.done_at || new Date()) : null;
  await db.query('UPDATE tasks SET ? WHERE id = ?', [v, k.id]);
  res.json(await db.one('SELECT * FROM tasks WHERE id = ?', [k.id]));
}));
r.delete('/tasks/:id(\\d+)', requirePerm('projects'), ah(async (req, res) => {
  const used = await db.one('SELECT COUNT(*) n FROM timesheets WHERE task_id = ?', [req.params.id]);
  if (Number(used.n)) throw bad('Hours were logged on this task – mark it done instead of deleting it');
  await db.query('DELETE FROM tasks WHERE id = ?', [req.params.id]); res.json({ ok: true });
}));

/* ======================= TIMESHEETS ======================= */
r.get('/timesheets', ah(async (req, res) => {
  const cond = [], args = [];
  const to = req.query.to || today(); const from = req.query.from || to;
  cond.push('t.work_date BETWEEN ? AND ?'); args.push(from, to);
  if (!can(req.user, 'projects') || req.query.mine) { cond.push('t.user_id = ?'); args.push(req.user.id); }
  else if (req.query.user_id) { cond.push('t.user_id = ?'); args.push(req.query.user_id); }
  if (req.query.project_id) { cond.push('t.project_id = ?'); args.push(req.query.project_id); }
  const rows = await db.query(`SELECT t.*, u.name user_name, p.name project_name, p.code project_code, k.title task_title, tk.number ticket_number, i.number invoice_number
    FROM timesheets t JOIN users u ON u.id = t.user_id LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN tasks k ON k.id = t.task_id
    LEFT JOIN tickets tk ON tk.id = t.ticket_id LEFT JOIN invoices i ON i.id = t.invoice_id
    WHERE ${cond.join(' AND ')} ORDER BY t.work_date DESC, t.id DESC LIMIT 2000`, args);
  const sum = k => round2(rows.reduce((s, x) => s + Number(x[k] === undefined ? 0 : x[k]), 0));
  res.json({ from, to, rows, total_hours: sum('hours'), billable_hours: round2(rows.filter(x => x.billable).reduce((s, x) => s + Number(x.hours), 0)) });
}));
async function cleanTs(b, user) {
  const hours = round2(b.hours);
  if (!(hours > 0) || hours > 24) throw bad('Hours must be between 0 and 24');
  const date = String(b.work_date || today()).slice(0, 10);
  if (date > today()) throw bad('You cannot log hours for a future date');
  let uid = user.id;
  if (b.user_id && Number(b.user_id) !== user.id) { if (!can(user, 'projects')) throw forbid('You can only log your own hours'); uid = Number(b.user_id); }
  const v = { user_id: uid, work_date: date, hours, description: b.description ? String(b.description).slice(0, 255) : null, billable: b.billable === undefined ? 1 : (b.billable ? 1 : 0), project_id: null, task_id: null, ticket_id: null, rate: 0 };
  if (b.task_id) {
    const k = await db.one('SELECT * FROM tasks WHERE id = ?', [b.task_id]);
    if (!k) throw bad('Unknown task');
    v.task_id = k.id; v.project_id = k.project_id;
  } else if (b.project_id) v.project_id = Number(b.project_id);
  if (b.ticket_id) { const t = await db.one('SELECT id, project_id FROM tickets WHERE id = ?', [b.ticket_id]); if (!t) throw bad('Unknown ticket'); v.ticket_id = t.id; if (!v.project_id && t.project_id) v.project_id = t.project_id; }
  if (!v.project_id && !v.ticket_id) throw bad('Choose the project (or ticket) the hours were for');
  if (v.project_id) {
    const p = await db.one('SELECT * FROM projects WHERE id = ?', [v.project_id]);
    if (!p) throw bad('Unknown project');
    if (['done', 'cancelled'].includes(p.status) && !can(user, 'projects')) throw bad('This project is closed');
    v.rate = p.billing === 'hourly' ? Number(p.hourly_rate) : 0;
    if (p.billing === 'none') v.billable = 0;
  }
  if (v.ticket_id && !v.project_id) v.rate = Number(((await db.getSetting('helpdesk', {})) || {}).labour_rate || 0);
  if (b.rate !== undefined && b.rate !== '' && can(user, 'projects')) v.rate = round2(Math.max(0, Number(b.rate) || 0));
  v.cost_rate = await costRate(uid);
  return v;
}
r.post('/timesheets', ah(async (req, res) => {
  const v = await cleanTs(req.body, req.user);
  const day = await db.one('SELECT COALESCE(SUM(hours),0) h FROM timesheets WHERE user_id = ? AND work_date = ?', [v.user_id, v.work_date]);
  if (Number(day.h) + v.hours > 24) throw bad(`That would be more than 24 hours on ${v.work_date}`);
  const ins = await db.query('INSERT INTO timesheets SET ?', [v]);
  res.json(await db.one('SELECT * FROM timesheets WHERE id = ?', [ins.insertId]));
}));
r.put('/timesheets/:id(\\d+)', ah(async (req, res) => {
  const t = await db.one('SELECT * FROM timesheets WHERE id = ?', [req.params.id]);
  if (!t) throw notFound();
  if (t.user_id !== req.user.id && !can(req.user, 'projects')) throw forbid();
  if (t.invoice_id) throw bad('These hours are already invoiced');
  const v = await cleanTs({ ...t, ...req.body, user_id: req.body.user_id || t.user_id }, req.user);
  await db.query('UPDATE timesheets SET ? WHERE id = ?', [v, t.id]);
  res.json(await db.one('SELECT * FROM timesheets WHERE id = ?', [t.id]));
}));
r.delete('/timesheets/:id(\\d+)', ah(async (req, res) => {
  const t = await db.one('SELECT * FROM timesheets WHERE id = ?', [req.params.id]);
  if (!t) throw notFound();
  if (t.user_id !== req.user.id && !can(req.user, 'projects')) throw forbid();
  if (t.invoice_id) throw bad('These hours are already invoiced');
  await db.query('DELETE FROM timesheets WHERE id = ?', [t.id]); res.json({ ok: true });
}));

/* ======================= HELPDESK & REPAIRS ======================= */
const HD_DEFAULTS = { sla_hours: { urgent: 4, high: 8, normal: 24, low: 72 }, labour_rate: 0 };
async function hdSettings() { const s = (await db.getSetting('helpdesk', {})) || {}; return { ...HD_DEFAULTS, ...s, sla_hours: { ...HD_DEFAULTS.sla_hours, ...(s.sla_hours || {}) } }; }
r.get('/helpdesk/settings', requirePerm('helpdesk'), ah(async (req, res) => res.json(await hdSettings())));
r.put('/helpdesk/settings', requirePerm('settings'), ah(async (req, res) => {
  const cur = await hdSettings(); const b = req.body;
  const v = { labour_rate: round2(Math.max(0, Number(b.labour_rate ?? cur.labour_rate) || 0)), sla_hours: {} };
  for (const p of PRI) { const h = Number((b.sla_hours || {})[p] ?? cur.sla_hours[p]); if (!(h > 0)) throw bad('Response times must be more than 0 hours'); v.sla_hours[p] = h; }
  await db.setSetting('helpdesk', v); res.json(v);
}));

const TK_SQL = `SELECT t.*, p.name partner_name, p.phone partner_phone, p.email partner_email, u.name assigned_name, c.name created_by_name, pr.name project_name, i.number invoice_number, i.status invoice_status,
    (t.sla_due IS NOT NULL AND t.status IN ('new','open','waiting') AND t.sla_due < NOW()) overdue
  FROM tickets t LEFT JOIN partners p ON p.id = t.partner_id LEFT JOIN users u ON u.id = t.assigned_to LEFT JOIN users c ON c.id = t.created_by
  LEFT JOIN projects pr ON pr.id = t.project_id LEFT JOIN invoices i ON i.id = t.invoice_id`;
async function getTicket(id) {
  const t = await db.one(`${TK_SQL} WHERE t.id = ?`, [id]);
  if (!t) throw notFound('Ticket');
  t.messages = await db.query('SELECT m.*, u.name user_name FROM ticket_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.ticket_id = ? ORDER BY m.id', [t.id]);
  t.parts = await db.query('SELECT x.*, p.name product_name, p.uom, p.type FROM ticket_parts x JOIN products p ON p.id = x.product_id WHERE x.ticket_id = ? ORDER BY x.id', [t.id]);
  t.time = await db.query('SELECT s.*, u.name user_name FROM timesheets s JOIN users u ON u.id = s.user_id WHERE s.ticket_id = ? ORDER BY s.work_date, s.id', [t.id]);
  t.hours = round2(t.time.reduce((s, x) => s + Number(x.hours), 0));
  return t;
}
r.get('/tickets', requirePerm('helpdesk'), ah(async (req, res) => {
  const cond = [], args = [];
  const st = req.query.status || 'open';
  if (st === 'open') cond.push(`t.status IN ('new','open','waiting')`); else if (st !== 'all') { cond.push('t.status = ?'); args.push(st); }
  if (req.query.mine) { cond.push('t.assigned_to = ?'); args.push(req.user.id); }
  if (req.query.kind) { cond.push('t.kind = ?'); args.push(req.query.kind); }
  if (req.query.partner_id) { cond.push('t.partner_id = ?'); args.push(req.query.partner_id); }
  if (req.query.q) { cond.push('(t.subject LIKE ? OR t.number LIKE ? OR t.contact_name LIKE ? OR t.phone LIKE ? OR t.serial_no LIKE ? OR p.name LIKE ?)'); for (let i = 0; i < 6; i++) args.push(`%${req.query.q}%`); }
  res.json(await db.query(`${TK_SQL} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
    ORDER BY FIELD(t.status,'new','open','waiting','solved','closed'), overdue DESC, FIELD(t.priority,'urgent','high','normal','low'), t.sla_due IS NULL, t.sla_due, t.id DESC LIMIT 500`, args));
}));
r.get('/tickets/summary', requirePerm('helpdesk'), ah(async (req, res) => {
  const s = await db.one(`SELECT SUM(status = 'new') new_, SUM(status IN ('new','open','waiting')) open_, SUM(status IN ('new','open','waiting') AND sla_due < NOW()) overdue,
      SUM(status IN ('new','open','waiting') AND assigned_to = ?) mine, SUM(status IN ('solved','closed') AND solved_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) solved_30,
      AVG(CASE WHEN solved_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN TIMESTAMPDIFF(MINUTE, created_at, solved_at) END) avg_solve_min,
      AVG(CASE WHEN first_response_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN (first_response_at <= sla_due) END) sla_met
    FROM tickets`, [req.user.id]);
  res.json({ new: Number(s.new_ || 0), open: Number(s.open_ || 0), overdue: Number(s.overdue || 0), mine: Number(s.mine || 0), solved_30: Number(s.solved_30 || 0),
    avg_solve_hours: s.avg_solve_min == null ? null : round2(Number(s.avg_solve_min) / 60), sla_met_pct: s.sla_met == null ? null : Math.round(Number(s.sla_met) * 100) });
}));
r.get('/tickets/:id(\\d+)', requirePerm('helpdesk'), ah(async (req, res) => res.json(await getTicket(req.params.id))));
function cleanTicket(b) {
  const v = { subject: String(b.subject || '').trim().slice(0, 200) };
  if (!v.subject) throw bad('Write a short subject, e.g. "Laptop does not charge"');
  v.partner_id = Number(b.partner_id) || null;
  for (const k of ['contact_name', 'phone', 'email', 'item', 'serial_no']) v[k] = b[k] ? String(b[k]).trim().slice(0, k === 'item' ? 160 : 120) : null;
  if (!v.partner_id && !v.contact_name && !v.phone) throw bad('Choose the customer, or enter a name or phone number');
  v.description = b.description ? String(b.description).slice(0, 10000) : null;
  v.channel = ['phone', 'walk_in', 'email', 'whatsapp', 'other'].includes(b.channel) ? b.channel : 'phone';
  v.kind = ['question', 'problem', 'repair', 'request'].includes(b.kind) ? b.kind : 'problem';
  v.priority = PRI.includes(b.priority) ? b.priority : 'normal';
  v.assigned_to = Number(b.assigned_to) || null;
  v.project_id = Number(b.project_id) || null;
  return v;
}
r.post('/tickets', requirePerm('helpdesk'), ah(async (req, res) => {
  const v = cleanTicket(req.body); const s = await hdSettings();
  const ins = await db.query(`INSERT INTO tickets SET ?, sla_due = DATE_ADD(NOW(), INTERVAL ? MINUTE)`, [{ ...v, created_by: req.user.id, status: v.assigned_to ? 'open' : 'new' }, Math.round(s.sla_hours[v.priority] * 60)]);
  await db.query('UPDATE tickets SET number = ? WHERE id = ?', [`TCK/${new Date().getFullYear()}/${pad(ins.insertId, 5)}`, ins.insertId]);
  res.json(await getTicket(ins.insertId));
}));
r.put('/tickets/:id(\\d+)', requirePerm('helpdesk'), ah(async (req, res) => {
  const t = await db.one('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
  if (!t) throw notFound();
  const v = cleanTicket({ ...t, ...req.body });
  const s = await hdSettings();
  // a new priority gives a new response deadline counted from when the ticket came in
  await db.query(`UPDATE tickets SET ?${v.priority !== t.priority ? ', sla_due = DATE_ADD(created_at, INTERVAL ? MINUTE)' : ''} WHERE id = ?`,
    v.priority !== t.priority ? [v, Math.round(s.sla_hours[v.priority] * 60), t.id] : [v, t.id]);
  if (v.assigned_to && t.status === 'new') await db.query(`UPDATE tickets SET status = 'open' WHERE id = ?`, [t.id]);
  res.json(await getTicket(t.id));
}));
// a reply to the customer (counts as first response) or an internal note; optional new status
r.post('/tickets/:id(\\d+)/messages', requirePerm('helpdesk'), ah(async (req, res) => {
  const t = await db.one('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
  if (!t) throw notFound();
  const body = String(req.body.body || '').trim();
  if (!body) throw bad('Write the message');
  const internal = req.body.internal ? 1 : 0;
  await db.query('INSERT INTO ticket_messages (ticket_id, user_id, body, internal) VALUES (?, ?, ?, ?)', [t.id, req.user.id, body.slice(0, 10000), internal]);
  if (!internal && !t.first_response_at) await db.query('UPDATE tickets SET first_response_at = NOW() WHERE id = ?', [t.id]);
  if (!internal && req.body.email) {
    const to = t.email || (t.partner_id ? ((await db.one('SELECT email FROM partners WHERE id = ?', [t.partner_id])) || {}).email : null);
    if (!to) throw bad('The message is saved, but this customer has no email address');
    await require('../services/mailer').sendMail({ to, subject: `Re: ${t.subject} [${t.number}]`, text: body });
  }
  if (req.body.status) await setTicketStatus(t, req.body.status, req.user);
  else if (t.status === 'new') await db.query(`UPDATE tickets SET status = 'open', assigned_to = COALESCE(assigned_to, ?) WHERE id = ?`, [req.user.id, t.id]);
  res.json(await getTicket(t.id));
}));
async function setTicketStatus(t, st, user) {
  if (!['new', 'open', 'waiting', 'solved', 'closed'].includes(st)) throw bad('Unknown status');
  await db.query(`UPDATE tickets SET status = ?, solved_at = ${['solved', 'closed'].includes(st) ? 'COALESCE(solved_at, NOW())' : 'NULL'}, assigned_to = COALESCE(assigned_to, ?),
    first_response_at = ${['solved', 'closed'].includes(st) ? 'COALESCE(first_response_at, NOW())' : 'first_response_at'} WHERE id = ?`, [st, user.id, t.id]);
}
r.post('/tickets/:id(\\d+)/status', requirePerm('helpdesk'), ah(async (req, res) => {
  const t = await db.one('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
  if (!t) throw notFound();
  await setTicketStatus(t, req.body.status, req.user);
  res.json(await getTicket(t.id));
}));
// spare parts used on a repair (they leave stock when the repair is invoiced)
r.put('/tickets/:id(\\d+)/parts', requirePerm('helpdesk'), ah(async (req, res) => {
  const t = await db.one('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
  if (!t) throw notFound();
  if (t.invoice_id) throw bad('This job is already invoiced');
  await db.tx(async c => {
    await c.query('DELETE FROM ticket_parts WHERE ticket_id = ?', [t.id]);
    for (const p of req.body.parts || []) {
      const q = Math.round(Number(p.qty) * 10000) / 10000;
      if (!p.product_id || !(q > 0)) continue;
      const prod = await c.one('SELECT id, price, tax_id FROM products WHERE id = ?', [p.product_id]);
      if (!prod) throw bad('Unknown part');
      const price = p.unit_price !== undefined && p.unit_price !== '' ? Math.max(0, Number(p.unit_price) || 0) : Number(prod.price);
      await c.query('INSERT INTO ticket_parts (ticket_id, product_id, qty, unit_price) VALUES (?, ?, ?, ?)', [t.id, prod.id, q, price]);
    }
  });
  res.json(await getTicket(t.id));
}));
/** draft invoice for a repair / call-out: parts (shelf prices incl. VAT converted to excl.) + labour hours logged on the ticket */
r.post('/tickets/:id(\\d+)/invoice', requirePerm('invoicing'), ah(async (req, res) => {
  const biz = require('./business');
  const id = await db.tx(async c => {
    const t = await c.one('SELECT * FROM tickets WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!t) throw notFound();
    if (t.invoice_id) throw bad('Already invoiced');
    let partner = t.partner_id;
    if (!partner) {
      if (!t.contact_name && !t.phone) throw bad('Choose the customer first');
      const ins = await c.query('INSERT INTO partners (name, phone, email, is_customer) VALUES (?, ?, ?, 1)', [t.contact_name || t.phone, t.phone, t.email]);
      partner = ins.insertId;
      await c.query('UPDATE tickets SET partner_id = ? WHERE id = ?', [partner, t.id]);
    }
    const vat = await vatRate(); const s = await hdSettings();
    const lines = [];
    for (const p of await c.query('SELECT x.*, pr.name, t.rate tax_rate, t.price_includes_tax FROM ticket_parts x JOIN products pr ON pr.id = x.product_id LEFT JOIN taxes t ON t.id = pr.tax_id WHERE x.ticket_id = ?', [t.id])) {
      const rate = Number(p.tax_rate ?? vat);
      const unit = Number(p.price_includes_tax ?? 1) ? Number(p.unit_price) / (1 + rate / 100) : Number(p.unit_price);
      lines.push({ product_id: p.product_id, description: p.name, qty: Number(p.qty), unit_price: Math.round(unit * 10000) / 10000, tax_rate: rate });
    }
    const time = await c.query('SELECT * FROM timesheets WHERE ticket_id = ? AND billable = 1 AND invoice_id IS NULL', [t.id]);
    const byRate = new Map();
    for (const x of time) { const rt = Number(x.rate) || Number(s.labour_rate); byRate.set(rt, (byRate.get(rt) || 0) + Number(x.hours)); }
    for (const [rt, h] of byRate) if (rt > 0) lines.push({ description: `Labour – ${t.subject}`.slice(0, 200), qty: round2(h), unit_price: rt, tax_rate: vat });
    if (req.body.callout) lines.push({ description: 'Call-out fee', qty: 1, unit_price: round2(req.body.callout), tax_rate: vat });
    if (!lines.length) throw bad('Nothing to invoice: add parts or log billable hours on this ticket');
    const invId = await biz.createInvoice(c, req.user, { kind: 'customer_invoice', partner_id: partner, lines: biz.calcLines(lines, 'unit_price'),
      notes: `${t.number} ${t.subject}${t.item ? ' · ' + t.item : ''}${t.serial_no ? ' S/N ' + t.serial_no : ''}`.slice(0, 255) });
    await c.query('UPDATE invoices SET ticket_id = ?, project_id = ? WHERE id = ?', [t.id, t.project_id, invId]);
    await c.query('UPDATE tickets SET invoice_id = ? WHERE id = ?', [invId, t.id]);
    if (time.length) await c.query('UPDATE timesheets SET invoice_id = ? WHERE id IN (?)', [invId, time.map(x => x.id)]);
    return invId;
  });
  res.json({ invoice_id: id });
}));

module.exports = r;
