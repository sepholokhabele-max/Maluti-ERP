const express = require('express');
const db = require('../db');
const pos = require('../services/pos');
const plugins = require('../services/plugins');
const mailer = require('../services/mailer');
const { requirePerm, can } = require('../auth');
const { ah, bad, today } = require('../util');

const r = express.Router();

r.get('/terminals', ah(async (req, res) => {
  res.json(await db.query(`SELECT t.*, (SELECT s.id FROM pos_sessions s WHERE s.terminal_id = t.id AND s.status = 'open' ORDER BY s.id DESC LIMIT 1) open_session_id
    FROM pos_terminals t WHERE t.active = 1 ORDER BY t.id`));
}));

// Everything a till needs to start: products, categories, payment methods, VAS services
r.get('/catalog', ah(async (req, res) => {
  const categories = await db.query('SELECT * FROM categories WHERE active = 1 ORDER BY sort_order, name');
  const products = await db.query(
    `SELECT p.id, p.sku, p.barcode, p.name, p.category_id, p.type, p.price, p.stock_qty, p.uom, p.sold_by_weight, p.plu, t.rate tax_rate, c.station
     FROM products p LEFT JOIN taxes t ON t.id = p.tax_id LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.active = 1 AND p.pos_visible = 1 ORDER BY p.name`);
  const methods = await db.query('SELECT * FROM payment_methods WHERE active = 1 ORDER BY sort_order');
  const company = await require('../services/logo').companyWithLogo();
  const vas = [];
  for (const p of plugins.list().filter(p => p.type === 'vas')) {
    const st = await plugins.getState(p.id);
    if (!st.enabled) continue;
    try { vas.push({ plugin_id: p.id, plugin_name: p.name, services: await plugins.call(p.id, 'listServices') }); }
    catch (e) { vas.push({ plugin_id: p.id, plugin_name: p.name, services: [], error: e.message }); }
  }
  const posSettings = await db.getSetting('pos', {}) || {};
  const butchery = await require('../services/butchery').settings();
  const price_rules = (await require('../services/pricing').activeRules()).filter(r => Number(r.on_pos));
  res.json({ categories, products, methods, company, vas, pos: posSettings, butchery: butchery.enabled ? butchery : { enabled: false }, price_rules });
}));

// ---- sessions ----
r.get('/sessions', ah(async (req, res) => {
  const where = req.query.status ? 'WHERE s.status = ?' : '';
  res.json(await db.query(
    `SELECT s.*, t.name terminal_name, u.name user_name FROM pos_sessions s JOIN pos_terminals t ON t.id = s.terminal_id
     JOIN users u ON u.id = s.user_id ${where} ORDER BY s.id DESC LIMIT 200`, req.query.status ? [req.query.status] : []));
}));
r.get('/sessions/:id', ah(async (req, res) => res.json(await db.tx(c => pos.sessionSummary(c, req.params.id)))));
r.post('/sessions/open', ah(async (req, res) => {
  const { terminal_id, opening_cash } = req.body;
  const t = await db.one('SELECT * FROM pos_terminals WHERE id = ? AND active = 1', [terminal_id]);
  if (!t) throw bad('Unknown terminal');
  const open = await db.one(`SELECT * FROM pos_sessions WHERE terminal_id = ? AND status = 'open'`, [terminal_id]);
  if (open) return res.json(open);
  const ins = await db.query('INSERT INTO pos_sessions (terminal_id, user_id, opening_cash) VALUES (?, ?, ?)', [terminal_id, req.user.id, Number(opening_cash || 0)]);
  res.json(await db.one('SELECT * FROM pos_sessions WHERE id = ?', [ins.insertId]));
}));
r.post('/sessions/:id/close', ah(async (req, res) => {
  const result = await db.tx(c => pos.closeSession(c, req.user, Number(req.params.id), req.body));
  const s = await mailer.getEmailSettings();
  let email = null;
  if (s.send_on_session_close && s.recipients.length) {
    email = await mailer.sendEod(today(), { kind: 'session-close' }).then(() => 'sent').catch(e => e.message);
  }
  res.json({ ...result, email });
}));

// ---- floors / tables ----
r.get('/floors', ah(async (req, res) => {
  const floors = await db.query('SELECT * FROM floors ORDER BY sort_order, id');
  const tables = await db.query(
    `SELECT t.*, o.id order_id, o.total order_total, o.guests, o.created_at order_opened, u.name waiter,
       (SELECT COUNT(*) FROM order_lines l WHERE l.order_id = o.id AND l.kitchen_status = 'ready') ready_items
     FROM restaurant_tables t
     LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'open'
     LEFT JOIN users u ON u.id = o.user_id
     WHERE t.active = 1 ORDER BY t.floor_id, t.id`);
  res.json(floors.map(f => ({ ...f, tables: tables.filter(t => t.floor_id === f.id) })));
}));

// ---- orders ----
r.get('/orders', ah(async (req, res) => {
  const cond = [], args = [];
  if (req.query.status) { cond.push('o.status = ?'); args.push(req.query.status); }
  if (req.query.mode) { cond.push('o.mode = ?'); args.push(req.query.mode); }
  if (req.query.session_id) { cond.push('o.session_id = ?'); args.push(req.query.session_id); }
  if (req.query.date) { cond.push('DATE(COALESCE(o.paid_at, o.created_at)) = ?'); args.push(req.query.date); }
  if (req.query.q) { cond.push('(o.number LIKE ? OR o.tab_name LIKE ?)'); args.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.query.tabs) cond.push('o.table_id IS NULL AND o.tab_name IS NOT NULL');
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  res.json(await db.query(
    `SELECT o.*, u.name user_name, t.name table_name, p.name partner_name FROM orders o
     LEFT JOIN users u ON u.id = o.user_id LEFT JOIN restaurant_tables t ON t.id = o.table_id LEFT JOIN partners p ON p.id = o.partner_id
     ${where} ORDER BY o.id DESC LIMIT ${Math.min(Number(req.query.limit) || 200, 1000)}`, args));
}));
r.get('/orders/:id', ah(async (req, res) => res.json(await db.tx(c => pos.getOrder(c, req.params.id)))));

r.post('/orders', ah(async (req, res) => {
  const id = await db.tx(async c => {
    const id = await pos.saveOrder(c, req.user, req.body);
    if (req.body.send_to_kitchen) await pos.sendToKitchen(c, id);
    return id;
  });
  res.json(await db.tx(c => pos.getOrder(c, id)));
}));
r.put('/orders/:id', ah(async (req, res) => {
  await db.tx(async c => {
    await pos.saveOrder(c, req.user, req.body, Number(req.params.id));
    if (req.body.send_to_kitchen) await pos.sendToKitchen(c, Number(req.params.id));
  });
  res.json(await db.tx(c => pos.getOrder(c, req.params.id)));
}));
// Pro-forma bill for an open order (table / tab) with pay-by-QR codes
r.get('/orders/:id/bill', ah(async (req, res) => {
  const o = await db.tx(c => pos.getOrder(c, req.params.id));
  const qrs = o.status === 'open' ? await require('../services/qr').payQrs({ amount: Number(o.total), reference: `BILL${o.id}` }) : [];
  res.json({ order: o, qrs });
}));
r.post('/orders/:id/send', ah(async (req, res) => {
  const n = await db.tx(c => pos.sendToKitchen(c, req.params.id));
  res.json({ sent: n });
}));
r.post('/orders/:id/pay', ah(async (req, res) => {
  const out = await db.tx(c => pos.payOrder(c, req.user, Number(req.params.id), req.body));
  res.json({ ...out, order: await db.tx(c => pos.getOrder(c, out.order_id)) });
}));
// Retail one-shot checkout: create + pay
r.post('/checkout', ah(async (req, res) => {
  const out = await db.tx(async c => {
    const id = await pos.saveOrder(c, req.user, req.body);
    return pos.payOrder(c, req.user, id, req.body);
  });
  res.json({ ...out, order: await db.tx(c => pos.getOrder(c, out.order_id)) });
}));
r.post('/orders/:id/void', requirePerm('pos.void'), ah(async (req, res) => {
  const o = await db.one('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!o || o.status !== 'open') throw bad('Only open orders can be voided');
  await db.query(`UPDATE orders SET status = 'voided', notes = CONCAT(COALESCE(notes,''), ?) WHERE id = ?`, [` [Voided by ${req.user.name}: ${req.body.reason || ''}]`, o.id]);
  await db.query(`INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES (?, 'void', 'order', ?, ?)`, [req.user.id, o.id, JSON.stringify(req.body)]);
  res.json({ ok: true });
}));
r.post('/orders/:id/refund', requirePerm('pos.refund'), ah(async (req, res) => {
  res.json(await db.tx(c => pos.refundOrder(c, req.user, Number(req.params.id), req.body)));
}));
// Split: move selected lines into a new open order (e.g. split a bill)
r.post('/orders/:id/split', ah(async (req, res) => {
  const newId = await db.tx(async c => {
    const o = await c.one('SELECT * FROM orders WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!o || o.status !== 'open') throw bad('Order is not open');
    const ids = (req.body.line_ids || []).map(Number);
    if (!ids.length) throw bad('Select lines to split');
    const ins = await c.query(`INSERT INTO orders (session_id, terminal_id, user_id, partner_id, mode, tab_name, guests) VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [o.session_id, o.terminal_id, req.user.id, o.partner_id, o.mode, `${o.tab_name || 'Split'} (split from #${o.id})`]);
    await c.query(`UPDATE order_lines SET order_id = ? WHERE order_id = ? AND id IN (?)`, [ins.insertId, o.id, ids]);
    for (const oid of [o.id, ins.insertId]) {
      await c.query(`UPDATE orders o JOIN (SELECT order_id, SUM(net_amount) n, SUM(tax_amount) t, SUM(line_total) tot,
        SUM(qty*unit_price*discount_pct/100) d FROM order_lines WHERE order_id = ?) x ON x.order_id = o.id
        SET o.subtotal = x.n, o.tax_total = x.t, o.total = x.tot, o.discount_total = ROUND(x.d,2)`, [oid]);
    }
    return ins.insertId;
  });
  res.json(await db.tx(c => pos.getOrder(c, newId)));
}));

// ---- kitchen / bar display ----
r.get('/kitchen', ah(async (req, res) => {
  const station = req.query.station || 'kitchen';
  const lines = await db.query(
    `SELECT l.id, l.order_id, l.name, l.qty, l.note, l.kitchen_status, l.sent_at, o.tab_name, o.mode, t.name table_name, u.name waiter
     FROM order_lines l JOIN orders o ON o.id = l.order_id LEFT JOIN restaurant_tables t ON t.id = o.table_id LEFT JOIN users u ON u.id = o.user_id
     WHERE l.station = ? AND l.kitchen_status IN ('sent','preparing','ready') AND o.status IN ('open','paid')
       AND l.sent_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
     ORDER BY l.sent_at, l.id`, [station]);
  const tickets = new Map();
  for (const l of lines) {
    if (!tickets.has(l.order_id)) tickets.set(l.order_id, { order_id: l.order_id, label: l.table_name || l.tab_name || `Order #${l.order_id}`, waiter: l.waiter, sent_at: l.sent_at, lines: [] });
    tickets.get(l.order_id).lines.push(l);
  }
  res.json([...tickets.values()]);
}));
r.post('/kitchen/lines/:id', requirePerm('kitchen'), ah(async (req, res) => {
  const st = req.body.status;
  if (!['preparing', 'ready', 'served'].includes(st)) throw bad('Invalid status');
  await db.query('UPDATE order_lines SET kitchen_status = ? WHERE id = ?', [st, req.params.id]);
  res.json({ ok: true });
}));
r.post('/kitchen/orders/:id', requirePerm('kitchen'), ah(async (req, res) => {
  const st = req.body.status; const station = req.body.station || 'kitchen';
  if (!['preparing', 'ready', 'served'].includes(st)) throw bad('Invalid status');
  await db.query(`UPDATE order_lines SET kitchen_status = ? WHERE order_id = ? AND station = ? AND kitchen_status IN ('sent','preparing','ready')`, [st, req.params.id, station]);
  res.json({ ok: true });
}));
// waiters mark ready items as served
r.post('/orders/:id/served', ah(async (req, res) => {
  await db.query(`UPDATE order_lines SET kitchen_status = 'served' WHERE order_id = ? AND kitchen_status = 'ready'`, [req.params.id]);
  res.json({ ok: true });
}));

module.exports = r;
