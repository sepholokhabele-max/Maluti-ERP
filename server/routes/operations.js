// Operations: machines & maintenance, requests for quotation (RFQ) to several suppliers, make-to-order from sales orders
const express = require('express');
const db = require('../db');
const stock = require('../services/stock');
const accounting = require('../services/accounting');
const { requirePerm, can } = require('../auth');
const { ah, bad, notFound, round2, pad, today, HttpError } = require('../util');

const r = express.Router();
const r4 = n => Math.round(Number(n) * 10000) / 10000;
const PRI = ['low', 'normal', 'high', 'urgent'];
const plus = (date, days) => stock.addDays(date, days);

/* ======================= MACHINES / EQUIPMENT ======================= */
const EQ_SQL = `SELECT e.*, l.name location_name, s.name supplier_name,
    (SELECT COUNT(*) FROM maintenance_requests m WHERE m.equipment_id = e.id AND m.status IN ('new','in_progress')) open_requests,
    (SELECT COALESCE(SUM(m.downtime_hours),0) FROM maintenance_requests m WHERE m.equipment_id = e.id AND m.done_at >= DATE_SUB(NOW(), INTERVAL 365 DAY)) downtime_12m,
    (SELECT COALESCE(SUM(m.parts_cost + m.labour_cost + m.external_cost),0) FROM maintenance_requests m WHERE m.equipment_id = e.id AND m.status = 'done' AND m.done_at >= DATE_SUB(NOW(), INTERVAL 365 DAY)) cost_12m
  FROM equipment e LEFT JOIN locations l ON l.id = e.location_id LEFT JOIN partners s ON s.id = e.supplier_id`;

r.get('/equipment', ah(async (req, res) => {
  const rows = await db.query(`${EQ_SQL} ${req.query.all ? '' : 'WHERE e.active = 1'} ORDER BY e.status = 'down' DESC, e.name`);
  const t = today();
  rows.forEach(e => { e.service_due = !!(e.next_service && String(e.next_service).slice(0, 10) <= plus(t, 7)); e.overdue = !!(e.next_service && String(e.next_service).slice(0, 10) < t); });
  res.json(rows);
}));
function cleanEq(b) {
  const v = { name: String(b.name || '').trim().slice(0, 120) };
  if (!v.name) throw bad('Give the machine a name');
  for (const k of ['code', 'category', 'serial_no', 'notes']) v[k] = b[k] ? String(b[k]).slice(0, k === 'notes' ? 255 : 80) : null;
  for (const k of ['location_id', 'supplier_id']) v[k] = Number(b[k]) || null;
  for (const k of ['purchase_date', 'warranty_until', 'last_service', 'next_service']) v[k] = b[k] ? String(b[k]).slice(0, 10) : null;
  v.cost = b.cost === '' || b.cost == null ? null : round2(b.cost);
  v.interval_days = Number(b.interval_days) > 0 ? Math.round(Number(b.interval_days)) : null;
  if (v.interval_days && !v.next_service) v.next_service = plus(v.last_service || today(), v.interval_days);
  if (b.status && ['working', 'down', 'retired'].includes(b.status)) v.status = b.status;
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  return v;
}
r.post('/equipment', requirePerm('maintenance'), ah(async (req, res) => {
  const ins = await db.query('INSERT INTO equipment SET ?', [cleanEq(req.body)]);
  res.json(await db.one(`${EQ_SQL} WHERE e.id = ?`, [ins.insertId]));
}));
r.put('/equipment/:id', requirePerm('maintenance'), ah(async (req, res) => {
  const e = await db.one('SELECT * FROM equipment WHERE id = ?', [req.params.id]);
  if (!e) throw notFound();
  await db.query('UPDATE equipment SET ? WHERE id = ?', [cleanEq({ ...e, ...req.body }), e.id]);
  res.json(await db.one(`${EQ_SQL} WHERE e.id = ?`, [e.id]));
}));

/* ======================= MAINTENANCE REQUESTS ======================= */
const MR_SQL = `SELECT m.*, e.name equipment_name, e.code equipment_code, e.status equipment_status, ur.name reported_by_name, ua.name assigned_name, l.name location_name
  FROM maintenance_requests m JOIN equipment e ON e.id = m.equipment_id LEFT JOIN users ur ON ur.id = m.reported_by LEFT JOIN users ua ON ua.id = m.assigned_to
  LEFT JOIN locations l ON l.id = e.location_id`;
async function getMr(conn, id) {
  const m = await conn.one(`${MR_SQL} WHERE m.id = ?`, [id]);
  if (!m) throw notFound('Maintenance request');
  m.parts = await conn.query('SELECT x.*, p.name product_name, p.uom, p.cost product_cost FROM maintenance_parts x JOIN products p ON p.id = x.product_id WHERE x.request_id = ?', [m.id]);
  return m;
}
r.get('/maintenance', ah(async (req, res) => {
  const cond = [], args = [];
  const st = req.query.status || 'open';
  if (st === 'open') cond.push(`m.status IN ('new','in_progress')`); else if (st !== 'all') { cond.push('m.status = ?'); args.push(st); }
  if (req.query.equipment_id) { cond.push('m.equipment_id = ?'); args.push(req.query.equipment_id); }
  if (!can(req.user, 'maintenance')) { cond.push('m.reported_by = ?'); args.push(req.user.id); }
  res.json(await db.query(`${MR_SQL} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
    ORDER BY FIELD(m.status,'in_progress','new','done','cancelled'), FIELD(m.priority,'urgent','high','normal','low'), m.id DESC LIMIT 500`, args));
}));
r.get('/maintenance/:id(\\d+)', ah(async (req, res) => res.json(await getMr(db, req.params.id))));

// anyone can report a breakdown
r.post('/maintenance', ah(async (req, res) => {
  const b = req.body;
  const e = await db.one('SELECT * FROM equipment WHERE id = ? AND active = 1', [b.equipment_id]);
  if (!e) throw bad('Choose the machine');
  if (!String(b.title || '').trim()) throw bad('Say briefly what is wrong (or what must be done)');
  const kind = b.kind === 'preventive' ? 'preventive' : 'corrective';
  const id = await db.tx(async c => {
    const ins = await c.query(`INSERT INTO maintenance_requests (equipment_id, kind, priority, title, description, machine_down, reported_by, assigned_to, scheduled_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [e.id, kind, PRI.includes(b.priority) ? b.priority : 'normal', String(b.title).slice(0, 160), b.description || null,
      b.machine_down ? 1 : 0, req.user.id, can(req.user, 'maintenance') ? (Number(b.assigned_to) || null) : null, b.scheduled_date || null]);
    await c.query('UPDATE maintenance_requests SET number = ? WHERE id = ?', [`MR/${new Date().getFullYear()}/${pad(ins.insertId, 5)}`, ins.insertId]);
    if (b.machine_down) await c.query(`UPDATE equipment SET status = 'down' WHERE id = ?`, [e.id]);
    return ins.insertId;
  });
  res.json(await getMr(db, id));
}));
r.put('/maintenance/:id(\\d+)', requirePerm('maintenance'), ah(async (req, res) => {
  const m = await db.one('SELECT * FROM maintenance_requests WHERE id = ?', [req.params.id]);
  if (!m) throw notFound();
  if (['done', 'cancelled'].includes(m.status)) throw bad('This request is closed');
  const b = req.body;
  await db.query('UPDATE maintenance_requests SET title = ?, description = ?, priority = ?, assigned_to = ?, scheduled_date = ?, machine_down = ? WHERE id = ?',
    [String(b.title || m.title).slice(0, 160), b.description !== undefined ? b.description : m.description, PRI.includes(b.priority) ? b.priority : m.priority,
      b.assigned_to !== undefined ? (Number(b.assigned_to) || null) : m.assigned_to, b.scheduled_date !== undefined ? (b.scheduled_date || null) : m.scheduled_date,
      b.machine_down !== undefined ? (b.machine_down ? 1 : 0) : m.machine_down, m.id]);
  if (b.machine_down) await db.query(`UPDATE equipment SET status = 'down' WHERE id = ?`, [m.equipment_id]);
  res.json(await getMr(db, m.id));
}));
r.post('/maintenance/:id(\\d+)/start', requirePerm('maintenance'), ah(async (req, res) => {
  const m = await db.one('SELECT * FROM maintenance_requests WHERE id = ?', [req.params.id]);
  if (!m) throw notFound();
  if (m.status !== 'new') throw bad('Already started or closed');
  await db.query(`UPDATE maintenance_requests SET status = 'in_progress', started_at = NOW(), assigned_to = COALESCE(assigned_to, ?) WHERE id = ?`, [req.user.id, m.id]);
  res.json(await getMr(db, m.id));
}));
r.post('/maintenance/:id(\\d+)/cancel', requirePerm('maintenance'), ah(async (req, res) => {
  const m = await db.one('SELECT * FROM maintenance_requests WHERE id = ?', [req.params.id]);
  if (!m) throw notFound();
  if (['done', 'cancelled'].includes(m.status)) throw bad('Already closed');
  await db.query(`UPDATE maintenance_requests SET status = 'cancelled' WHERE id = ?`, [m.id]);
  const other = await db.one(`SELECT COUNT(*) n FROM maintenance_requests WHERE equipment_id = ? AND machine_down = 1 AND status IN ('new','in_progress')`, [m.equipment_id]);
  if (!Number(other.n)) await db.query(`UPDATE equipment SET status = 'working' WHERE id = ? AND status = 'down'`, [m.equipment_id]);
  res.json(await getMr(db, m.id));
}));
/**
 * Done: spare parts come out of stock and are booked as repairs & maintenance (Dr 6900 / Cr 1200).
 * Labour and outside-repairer costs are recorded on the request for machine cost reports
 * (wages and the repairer's bill are booked through payroll and supplier bills, so they are not posted twice).
 */
r.post('/maintenance/:id(\\d+)/done', requirePerm('maintenance'), ah(async (req, res) => {
  const b = req.body;
  await db.tx(async c => {
    const m = await c.one('SELECT * FROM maintenance_requests WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!m) throw notFound();
    if (['done', 'cancelled'].includes(m.status)) throw bad('This request is already closed');
    const e = await c.one('SELECT * FROM equipment WHERE id = ?', [m.equipment_id]);
    let parts = 0;
    await c.query('DELETE FROM maintenance_parts WHERE request_id = ?', [m.id]);
    for (const p of b.parts || []) {
      const q = r4(p.qty);
      if (!p.product_id || !(q > 0)) continue;
      const prod = await c.one('SELECT id, name, type, cost FROM products WHERE id = ?', [p.product_id]);
      if (!prod) throw bad('Unknown spare part');
      let unit = Number(prod.cost);
      if (prod.type === 'stock') unit = await stock.move(c, { product_id: prod.id, qty: -q, move_type: 'adjustment', reference: m.number, user_id: req.user.id, reason: `Spare part for ${e.name}`, location_id: e.location_id });
      parts += q * unit;
      await c.query('INSERT INTO maintenance_parts (request_id, product_id, qty, unit_cost) VALUES (?, ?, ?, ?)', [m.id, prod.id, q, unit]);
    }
    parts = round2(parts);
    if (parts) await accounting.post(c, { reference: m.number, memo: `Maintenance ${m.number} – ${e.name}`, source_type: 'maintenance', source_id: m.id, user_id: req.user.id, location_id: e.location_id,
      lines: [{ code: '6900', debit: parts, description: `Spare parts: ${e.name}` }, { code: '1200', credit: parts }] });
    let downtime = b.downtime_hours !== undefined && b.downtime_hours !== '' ? Math.max(0, Number(b.downtime_hours) || 0) : null;
    if (downtime === null && m.machine_down) {
      const t0 = new Date(String(m.created_at).replace(' ', 'T')).getTime();
      downtime = Math.round((Date.now() - t0) / 36000) / 100;
    }
    await c.query(`UPDATE maintenance_requests SET status = 'done', done_at = NOW(), started_at = COALESCE(started_at, NOW()), parts_cost = ?, labour_cost = ?, external_cost = ?,
      downtime_hours = ?, resolution = ?, assigned_to = COALESCE(assigned_to, ?) WHERE id = ?`,
      [parts, round2(Math.max(0, Number(b.labour_cost) || 0)), round2(Math.max(0, Number(b.external_cost) || 0)), downtime, b.resolution ? String(b.resolution).slice(0, 255) : null, req.user.id, m.id]);
    const stillDown = await c.one(`SELECT COUNT(*) n FROM maintenance_requests WHERE equipment_id = ? AND machine_down = 1 AND status IN ('new','in_progress')`, [e.id]);
    const sets = ['last_service = CURDATE()'];
    if (!Number(stillDown.n) && e.status === 'down') sets.push(`status = 'working'`);
    if (e.interval_days) sets.push(`next_service = DATE_ADD(CURDATE(), INTERVAL ${Number(e.interval_days)} DAY)`);
    await c.query(`UPDATE equipment SET ${sets.join(', ')} WHERE id = ?`, [e.id]);
  });
  res.json(await getMr(db, req.params.id));
}));
// preventive maintenance: create requests for machines due within the next N days (default 7) that have none open
r.post('/maintenance/schedule', requirePerm('maintenance'), ah(async (req, res) => {
  const days = Math.max(0, Math.min(60, Number(req.body.days ?? 7)));
  const due = await db.query(`SELECT e.* FROM equipment e WHERE e.active = 1 AND e.status <> 'retired' AND e.next_service IS NOT NULL AND e.next_service <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
    AND NOT EXISTS (SELECT 1 FROM maintenance_requests m WHERE m.equipment_id = e.id AND m.kind = 'preventive' AND m.status IN ('new','in_progress'))`, [days]);
  const made = [];
  for (const e of due) {
    const ins = await db.query(`INSERT INTO maintenance_requests (equipment_id, kind, priority, title, reported_by, scheduled_date) VALUES (?, 'preventive', 'normal', ?, ?, ?)`,
      [e.id, `Scheduled service – ${e.name}`, req.user.id, String(e.next_service).slice(0, 10)]);
    const number = `MR/${new Date().getFullYear()}/${pad(ins.insertId, 5)}`;
    await db.query('UPDATE maintenance_requests SET number = ? WHERE id = ?', [number, ins.insertId]);
    made.push({ id: ins.insertId, number, equipment: e.name });
  }
  res.json({ created: made });
}));

/* ======================= REQUESTS FOR QUOTATION ======================= */
async function getRfq(conn, id) {
  const q = await conn.one('SELECT r.*, u.name user_name, l.name location_name FROM rfqs r LEFT JOIN users u ON u.id = r.user_id LEFT JOIN locations l ON l.id = r.location_id WHERE r.id = ?', [id]);
  if (!q) throw notFound('Request for quotation');
  q.lines = await conn.query('SELECT x.*, p.name product_name, p.uom, p.cost last_cost FROM rfq_lines x LEFT JOIN products p ON p.id = x.product_id WHERE x.rfq_id = ? ORDER BY x.id', [q.id]);
  q.suppliers = await conn.query(`SELECT s.*, p.name, p.email, p.phone, po.number po_number FROM rfq_suppliers s JOIN partners p ON p.id = s.partner_id
    LEFT JOIN purchase_orders po ON po.id = s.po_id WHERE s.rfq_id = ? ORDER BY p.name`, [q.id]);
  q.quotes = await conn.query('SELECT * FROM rfq_quotes WHERE rfq_id = ?', [q.id]);
  // best price per line, and each supplier's total for the lines they quoted
  for (const l of q.lines) {
    const qs = q.quotes.filter(x => x.line_id === l.id).sort((a, b) => Number(a.unit_cost) - Number(b.unit_cost));
    l.best_partner_id = qs.length ? qs[0].partner_id : null; l.best_price = qs.length ? Number(qs[0].unit_cost) : null;
    const aw = q.quotes.find(x => x.line_id === l.id && x.awarded); l.awarded_partner_id = aw ? aw.partner_id : null;
  }
  for (const s of q.suppliers) {
    const mine = q.quotes.filter(x => x.partner_id === s.partner_id);
    s.quoted_lines = mine.length;
    s.total = round2(mine.reduce((t, x) => t + Number(x.unit_cost) * Number((q.lines.find(l => l.id === x.line_id) || {}).qty || 0), 0));
  }
  return q;
}
r.get('/rfqs', requirePerm('purchasing'), ah(async (req, res) => {
  res.json(await db.query(`SELECT r.*, u.name user_name,
      (SELECT COUNT(*) FROM rfq_lines x WHERE x.rfq_id = r.id) line_count,
      (SELECT COUNT(*) FROM rfq_suppliers s WHERE s.rfq_id = r.id) supplier_count,
      (SELECT COUNT(*) FROM rfq_suppliers s WHERE s.rfq_id = r.id AND s.status = 'replied') replies
    FROM rfqs r LEFT JOIN users u ON u.id = r.user_id ORDER BY FIELD(r.status,'sent','draft','closed','cancelled'), r.id DESC LIMIT 300`));
}));
r.get('/rfqs/:id', requirePerm('purchasing'), ah(async (req, res) => res.json(await getRfq(db, req.params.id))));

async function saveRfq(c, id, b, user) {
  const lines = [];
  for (const l of b.lines || []) {
    const q = Math.round(Number(l.qty) * 1000) / 1000;
    if (!l.product_id && !String(l.description || '').trim()) continue;
    if (!(q > 0)) throw bad('Every line needs a quantity above 0');
    let desc = String(l.description || '').trim();
    if (!desc && l.product_id) desc = ((await c.one('SELECT name FROM products WHERE id = ?', [l.product_id])) || {}).name || 'Item';
    lines.push([Number(l.product_id) || null, desc.slice(0, 200), q]);
  }
  if (!lines.length) throw bad('Add at least one item to ask prices for');
  const sups = [...new Set((b.supplier_ids || []).map(Number).filter(Boolean))];
  if (sups.length < 1) throw bad('Choose the suppliers to ask (two or more lets you compare)');
  for (const s of sups) if (!await c.one('SELECT id FROM partners WHERE id = ? AND is_supplier = 1', [s])) throw bad('One of the chosen contacts is not a supplier');
  if (id) {
    await c.query('UPDATE rfqs SET deadline = ?, notes = ?, location_id = ? WHERE id = ?', [b.deadline || null, b.notes || null, Number(b.location_id) || null, id]);
    await c.query('DELETE FROM rfq_lines WHERE rfq_id = ?', [id]);
    await c.query('DELETE FROM rfq_suppliers WHERE rfq_id = ?', [id]);
  } else {
    const ins = await c.query('INSERT INTO rfqs (deadline, notes, location_id, user_id) VALUES (?, ?, ?, ?)', [b.deadline || null, b.notes || null, Number(b.location_id) || null, user.id]);
    id = ins.insertId;
    await c.query('UPDATE rfqs SET number = ? WHERE id = ?', [`RFQ/${new Date().getFullYear()}/${pad(id, 5)}`, id]);
  }
  for (const l of lines) await c.query('INSERT INTO rfq_lines (rfq_id, product_id, description, qty) VALUES (?, ?, ?, ?)', [id, ...l]);
  for (const s of sups) await c.query('INSERT INTO rfq_suppliers (rfq_id, partner_id) VALUES (?, ?)', [id, s]);
  return id;
}
r.post('/rfqs', requirePerm('purchasing'), ah(async (req, res) => { const id = await db.tx(c => saveRfq(c, null, req.body, req.user)); res.json(await getRfq(db, id)); }));
r.put('/rfqs/:id', requirePerm('purchasing'), ah(async (req, res) => {
  const q = await db.one('SELECT * FROM rfqs WHERE id = ?', [req.params.id]);
  if (!q) throw notFound();
  if (q.status !== 'draft') throw bad('Only a draft request can be changed');
  await db.tx(c => saveRfq(c, q.id, req.body, req.user));
  res.json(await getRfq(db, q.id));
}));
// mark as sent; e-mail suppliers that have an address (html supplied by the browser, same as quotations)
r.post('/rfqs/:id/send', requirePerm('purchasing'), ah(async (req, res) => {
  const q = await getRfq(db, req.params.id);
  if (!['draft', 'sent'].includes(q.status)) throw bad('This request is closed');
  const emailed = [], noEmail = [], failed = [];
  const mailer = require('../services/mailer');
  const smtp = !!((await mailer.getEmailSettings()) || {}).smtp_host;
  if (req.body.email && req.body.html && !smtp) noEmail.push(...q.suppliers.map(s => s.name));
  else if (req.body.email && req.body.html) {
    for (const s of q.suppliers) {
      if (!s.email) { noEmail.push(s.name); continue; }
      try { await mailer.sendMail({ to: s.email, subject: req.body.subject || `Request for quotation ${q.number}`, html: String(req.body.html).replace(/\{supplier\}/g, s.name) }); emailed.push(s.name); }
      catch (e) { failed.push(`${s.name}: ${e.message}`); }
    }
  }
  await db.query(`UPDATE rfqs SET status = 'sent' WHERE id = ?`, [q.id]);
  await db.query('UPDATE rfq_suppliers SET sent_at = COALESCE(sent_at, NOW()) WHERE rfq_id = ?', [q.id]);
  res.json({ emailed, no_email: noEmail, failed, smtp, rfq: await getRfq(db, q.id) });
}));
// record a supplier's prices (from their quote, phone call or email)
r.post('/rfqs/:id/quotes', requirePerm('purchasing'), ah(async (req, res) => {
  const b = req.body;
  await db.tx(async c => {
    const q = await c.one('SELECT * FROM rfqs WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!q) throw notFound();
    if (!['draft', 'sent'].includes(q.status)) throw bad('This request is closed');
    const s = await c.one('SELECT * FROM rfq_suppliers WHERE rfq_id = ? AND partner_id = ?', [q.id, b.partner_id]);
    if (!s) throw bad('That supplier was not asked on this request');
    await c.query('DELETE FROM rfq_quotes WHERE rfq_id = ? AND partner_id = ?', [q.id, s.partner_id]);
    if (b.declined) {
      await c.query(`UPDATE rfq_suppliers SET status = 'declined', replied_at = NOW(), notes = ? WHERE id = ?`, [b.notes || null, s.id]);
      return;
    }
    let n = 0;
    for (const p of b.prices || []) {
      if (p.unit_cost === '' || p.unit_cost == null) continue;
      const u = Number(p.unit_cost);
      if (!(u >= 0) || !isFinite(u)) throw bad('Prices must be numbers of 0 or more');
      const line = await c.one('SELECT id FROM rfq_lines WHERE id = ? AND rfq_id = ?', [p.line_id, q.id]);
      if (!line) continue;
      await c.query('INSERT INTO rfq_quotes (rfq_id, line_id, partner_id, unit_cost) VALUES (?, ?, ?, ?)', [q.id, line.id, s.partner_id, r4(u)]);
      n++;
    }
    if (!n) throw bad('Enter at least one price, or mark the supplier as declined');
    await c.query(`UPDATE rfq_suppliers SET status = 'replied', replied_at = NOW(), lead_days = ?, notes = ? WHERE id = ?`,
      [Number(b.lead_days) >= 0 && b.lead_days !== '' && b.lead_days != null ? Math.round(Number(b.lead_days)) : null, b.notes || null, s.id]);
    if (q.status === 'draft') await c.query(`UPDATE rfqs SET status = 'sent' WHERE id = ?`, [q.id]);
  });
  res.json(await getRfq(db, req.params.id));
}));
// award: each line goes to the chosen supplier (default: cheapest); one draft purchase order per supplier
r.post('/rfqs/:id/award', requirePerm('purchasing'), ah(async (req, res) => {
  const pos = await db.tx(async c => {
    const q = await getRfq(c, req.params.id);
    if (!['draft', 'sent'].includes(q.status)) throw bad('This request is closed');
    const pick = new Map((req.body.awards || []).map(a => [Number(a.line_id), Number(a.partner_id)]));
    const byS = new Map();
    for (const l of q.lines) {
      const pid = pick.has(l.id) ? pick.get(l.id) : l.best_partner_id;
      if (!pid) continue;
      const quote = q.quotes.find(x => x.line_id === l.id && x.partner_id === pid);
      if (!quote) throw bad(`No price from that supplier for ${l.description}`);
      if (!byS.has(pid)) byS.set(pid, []);
      byS.get(pid).push({ l, unit: Number(quote.unit_cost) });
      await c.query('UPDATE rfq_quotes SET awarded = (partner_id = ?) WHERE line_id = ?', [pid, l.id]);
    }
    if (!byS.size) throw bad('No prices entered yet');
    const out = [];
    for (const [pid, items] of byS) {
      const s = q.suppliers.find(x => x.partner_id === pid);
      const exp = s && s.lead_days != null ? plus(today(), s.lead_days) : null;
      const ins = await c.query('INSERT INTO purchase_orders (supplier_id, order_date, expected_date, notes, user_id, location_id) VALUES (?, CURDATE(), ?, ?, ?, ?)',
        [pid, exp, `From ${q.number}`, req.user.id, q.location_id || null]);
      const number = `PO/${new Date().getFullYear()}/${pad(ins.insertId, 5)}`;
      await c.query('UPDATE purchase_orders SET number = ? WHERE id = ?', [number, ins.insertId]);
      let sub = 0, tax = 0;
      for (const { l, unit } of items) {
        const t = l.product_id ? await c.one('SELECT t.rate FROM products p LEFT JOIN taxes t ON t.id = p.tax_id WHERE p.id = ?', [l.product_id]) : null;
        const rate = Number((t && t.rate) ?? 15), net = round2(Number(l.qty) * unit), vat = round2(net * rate / 100);
        sub += net; tax += vat;
        await c.query('INSERT INTO purchase_lines (po_id, product_id, description, qty, unit_cost, tax_rate, net_amount, tax_amount, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [ins.insertId, l.product_id, l.description, l.qty, unit, rate, net, vat, round2(net + vat)]);
      }
      await c.query('UPDATE purchase_orders SET subtotal = ?, tax_total = ?, total = ? WHERE id = ?', [round2(sub), round2(tax), round2(sub + tax), ins.insertId]);
      await c.query('UPDATE rfq_suppliers SET po_id = ? WHERE rfq_id = ? AND partner_id = ?', [ins.insertId, q.id, pid]);
      out.push({ id: ins.insertId, number, supplier: s ? s.name : '', lines: items.length, total: round2(sub + tax) });
    }
    await c.query(`UPDATE rfqs SET status = 'closed' WHERE id = ?`, [q.id]);
    return out;
  });
  res.json({ purchase_orders: pos, rfq: await getRfq(db, req.params.id) });
}));
r.post('/rfqs/:id/cancel', requirePerm('purchasing'), ah(async (req, res) => {
  const q = await db.one('SELECT * FROM rfqs WHERE id = ?', [req.params.id]);
  if (!q) throw notFound();
  if (q.status === 'closed') throw bad('Purchase orders were already made from this request');
  await db.query(`UPDATE rfqs SET status = 'cancelled' WHERE id = ?`, [q.id]);
  res.json(await getRfq(db, q.id));
}));

/* ======================= MAKE TO ORDER ======================= */
// work orders for a confirmed sales order: products that have a bill of materials; by default only what stock cannot cover
r.post('/sales/:id/manufacture', requirePerm('inventory'), ah(async (req, res) => {
  const made = await db.tx(async c => {
    const o = await c.one('SELECT * FROM sale_orders WHERE id = ?', [req.params.id]);
    if (!o) throw notFound();
    if (!['confirmed', 'invoiced'].includes(o.status)) throw bad('Confirm the order first');
    const lines = await c.query(`SELECT l.product_id, SUM(l.qty) qty, p.name FROM sale_order_lines l JOIN products p ON p.id = l.product_id WHERE l.order_id = ? AND p.type = 'stock' GROUP BY l.product_id, p.name`, [o.id]);
    const loc = await stock.resolveLocation(c, o.location_id);
    const out = [];
    for (const l of lines) {
      const bom = await c.one('SELECT * FROM boms WHERE product_id = ? AND active = 1 ORDER BY id DESC LIMIT 1', [l.product_id]);
      if (!bom) continue;
      const already = Number((await c.one(`SELECT COALESCE(SUM(COALESCE(qty_produced, qty_planned)),0) q FROM work_orders WHERE sale_order_id = ? AND product_id = ? AND status <> 'cancelled'`, [o.id, l.product_id])).q);
      let need = Number(l.qty) - already;
      if (!req.body.all) need -= Math.max(0, await stock.qtyAt(c, l.product_id, loc));
      need = r4(need);
      if (need <= 0) continue;
      const f = need / Number(bom.output_qty);
      const ins = await c.query(`INSERT INTO work_orders (bom_id, product_id, qty_planned, location_id, planned_date, labour_cost, overhead_cost, sale_order_id, notes, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [bom.id, bom.product_id, need, o.location_id || null, o.delivery_date ? String(o.delivery_date).slice(0, 10) : today(),
        round2(Number(bom.labour_cost) * f), round2(Number(bom.overhead_cost) * f), o.id, `For sales order ${o.number}`, req.user.id]);
      const number = `WO/${new Date().getFullYear()}/${pad(ins.insertId, 5)}`;
      await c.query('UPDATE work_orders SET number = ?, status = ? WHERE id = ?', [number, 'confirmed', ins.insertId]);
      for (const bl of await c.query('SELECT * FROM bom_lines WHERE bom_id = ?', [bom.id]))
        await c.query('INSERT INTO work_order_lines (wo_id, product_id, qty_planned) VALUES (?, ?, ?)', [ins.insertId, bl.product_id, r4(Number(bl.qty) * f * (1 + Number(bl.scrap_pct) / 100))]);
      out.push({ id: ins.insertId, number, product: l.name, qty: need });
    }
    return out;
  });
  res.json({ work_orders: made });
}));
r.get('/sales/:id/work-orders', requirePerm('sales'), ah(async (req, res) => {
  res.json(await db.query(`SELECT w.id, w.number, w.status, w.qty_planned, w.qty_produced, p.name product_name FROM work_orders w JOIN products p ON p.id = w.product_id WHERE w.sale_order_id = ? ORDER BY w.id`, [req.params.id]));
}));

module.exports = r;
