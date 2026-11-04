// Sales: quotations → sales orders → invoices, and pricing rules / promotions
const express = require('express');
const db = require('../db');
const { requirePerm } = require('../auth');
const { ah, bad, notFound, today, pad, round2, lineAmounts, pick } = require('../util');
const pricing = require('../services/pricing');

const r = express.Router();

function calc(lines) {
  return (lines || []).filter(l => Number(l.qty) > 0 && (l.product_id || l.description)).map(l => {
    const d = Math.max(0, Math.min(100, Number(l.discount_pct || 0)));
    const a = lineAmounts({ qty: l.qty, unit_price: l.unit_price, discount_pct: d, tax_rate: l.tax_rate || 0, price_includes_tax: 0 });
    return { ...l, discount_pct: d, net_amount: a.net, tax_amount: a.tax, line_total: a.total, discount_amount: round2(Number(l.qty) * Number(l.unit_price) * d / 100) };
  });
}

async function saveLines(c, id, lines) {
  const ls = calc(lines);
  if (!ls.length) throw bad('Add at least one line');
  await c.query('DELETE FROM sale_order_lines WHERE order_id = ?', [id]);
  for (const l of ls) {
    let desc = l.description;
    if (!desc && l.product_id) desc = (await c.one('SELECT name FROM products WHERE id = ?', [l.product_id]) || {}).name;
    await c.query(`INSERT INTO sale_order_lines (order_id, product_id, description, qty, unit_price, discount_pct, tax_rate, net_amount, tax_amount, line_total, rule_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, l.product_id || null, desc || 'Item', l.qty, l.unit_price, l.discount_pct, l.tax_rate || 0, l.net_amount, l.tax_amount, l.line_total, l.rule_id || null]);
  }
  const sum = k => round2(ls.reduce((s, l) => s + Number(l[k]), 0));
  await c.query('UPDATE sale_orders SET subtotal = ?, tax_total = ?, total = ?, discount_total = ? WHERE id = ?', [sum('net_amount'), sum('tax_amount'), sum('line_total'), sum('discount_amount'), id]);
}

async function getOrder(id) {
  const o = await db.one(`SELECT s.*, p.name partner_name, p.email partner_email, p.phone partner_phone, p.address partner_address, p.tax_number partner_tax, p.tags partner_tags,
      u.name user_name, i.number invoice_number, i.status invoice_status
    FROM sale_orders s JOIN partners p ON p.id = s.partner_id LEFT JOIN users u ON u.id = s.user_id LEFT JOIN invoices i ON i.id = s.invoice_id WHERE s.id = ?`, [id]);
  if (!o) throw notFound('Quotation');
  o.lines = await db.query(`SELECT l.*, r.name rule_name FROM sale_order_lines l LEFT JOIN price_rules r ON r.id = l.rule_id WHERE order_id = ? ORDER BY l.id`, [id]);
  o.expired = o.status === 'quote' || o.status === 'sent' ? !!(o.valid_until && String(o.valid_until).slice(0, 10) < today()) : false;
  return o;
}

r.get('/sales', requirePerm('sales'), ah(async (req, res) => {
  const cond = [], args = [];
  if (req.query.stage === 'quotes') cond.push("s.status IN ('quote','sent','declined')");
  if (req.query.stage === 'orders') cond.push("s.status IN ('confirmed','invoiced')");
  if (req.query.partner_id) { cond.push('s.partner_id = ?'); args.push(req.query.partner_id); }
  res.json(await db.query(`SELECT s.*, p.name partner_name, u.name user_name, i.number invoice_number,
      (s.status IN ('quote','sent') AND s.valid_until IS NOT NULL AND s.valid_until < CURDATE()) expired
    FROM sale_orders s JOIN partners p ON p.id = s.partner_id LEFT JOIN users u ON u.id = s.user_id LEFT JOIN invoices i ON i.id = s.invoice_id
    ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY s.id DESC LIMIT 1000`, args));
}));
r.get('/sales/summary', requirePerm('sales'), ah(async (req, res) => {
  res.json(await db.one(`SELECT
      COALESCE(SUM(status IN ('quote','sent') AND (valid_until IS NULL OR valid_until >= CURDATE())),0) open_quotes,
      COALESCE(SUM(CASE WHEN status IN ('quote','sent') AND (valid_until IS NULL OR valid_until >= CURDATE()) THEN total END),0) open_quotes_value,
      COALESCE(SUM(status = 'confirmed'),0) to_invoice, COALESCE(SUM(CASE WHEN status = 'confirmed' THEN total END),0) to_invoice_value,
      COALESCE(SUM(status IN ('confirmed','invoiced') AND confirmed_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)),0) won_90,
      COALESCE(SUM(status = 'declined' AND created_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)),0) lost_90
    FROM sale_orders`));
}));
r.get('/sales/:id', requirePerm('sales'), ah(async (req, res) => res.json(await getOrder(req.params.id))));

r.post('/sales', requirePerm('sales'), ah(async (req, res) => {
  const b = req.body;
  if (!b.partner_id) throw bad('Choose the customer');
  const id = await db.tx(async c => {
    const date = b.order_date || today();
    const ins = await c.query(`INSERT INTO sale_orders (partner_id, order_date, valid_until, delivery_date, customer_ref, notes, terms, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [b.partner_id, date, b.valid_until || null, b.delivery_date || null, b.customer_ref || null, b.notes || null, b.terms || null, req.user.id]);
    await c.query('UPDATE sale_orders SET quote_number = ? WHERE id = ?', [`Q/${date.slice(0, 4)}/${pad(ins.insertId, 5)}`, ins.insertId]);
    await saveLines(c, ins.insertId, b.lines);
    return ins.insertId;
  });
  res.json(await getOrder(id));
}));
r.put('/sales/:id', requirePerm('sales'), ah(async (req, res) => {
  const b = req.body;
  await db.tx(async c => {
    const o = await c.one('SELECT * FROM sale_orders WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!o) throw notFound();
    if (!['quote', 'sent', 'confirmed'].includes(o.status)) throw bad('This document can no longer be changed');
    await c.query('UPDATE sale_orders SET partner_id = ?, order_date = ?, valid_until = ?, delivery_date = ?, customer_ref = ?, notes = ?, terms = ? WHERE id = ?',
      [b.partner_id || o.partner_id, b.order_date || o.order_date, b.valid_until || null, b.delivery_date || null, b.customer_ref || null, b.notes || null, b.terms || null, o.id]);
    await saveLines(c, o.id, b.lines);
  });
  res.json(await getOrder(req.params.id));
}));

const setStatus = (from, to, extra = '') => ah(async (req, res) => {
  const o = await db.one('SELECT * FROM sale_orders WHERE id = ?', [req.params.id]);
  if (!o) throw notFound();
  if (!from.includes(o.status)) throw bad(`Cannot do that while the document is "${o.status}"`);
  await db.query(`UPDATE sale_orders SET status = ? ${extra} WHERE id = ?`, [to, o.id]);
  res.json(await getOrder(o.id));
});
r.post('/sales/:id/sent', requirePerm('sales'), setStatus(['quote', 'sent'], 'sent'));
r.post('/sales/:id/decline', requirePerm('sales'), (req, res, next) => {
  db.query(`UPDATE leads SET status = 'lost', closed_at = NOW(), lost_reason = ? WHERE sale_order_id = ? AND status = 'open' AND EXISTS (SELECT 1 FROM sale_orders so WHERE so.id = ? AND so.status IN ('quote','sent'))`, [String(req.body.reason || 'Quotation declined').slice(0, 160), req.params.id, req.params.id])
    .catch(() => {}).finally(next);
}, setStatus(['quote', 'sent'], 'declined'));
r.post('/sales/:id/reopen', requirePerm('sales'), setStatus(['declined', 'cancelled'], 'quote'));
r.post('/sales/:id/cancel', requirePerm('sales'), setStatus(['quote', 'sent', 'confirmed'], 'cancelled'));

// customer accepted: the quotation becomes a sales order
r.post('/sales/:id/confirm', requirePerm('sales'), ah(async (req, res) => {
  await db.tx(async c => {
    const o = await c.one('SELECT * FROM sale_orders WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!o) throw notFound();
    if (!['quote', 'sent'].includes(o.status)) throw bad('Only open quotations can be confirmed');
    await c.query(`UPDATE sale_orders SET status = 'confirmed', number = ?, confirmed_at = NOW(), customer_ref = COALESCE(?, customer_ref) WHERE id = ?`,
      [`SO/${new Date().getFullYear()}/${pad(o.id, 5)}`, req.body.customer_ref || null, o.id]);
    // the opportunity in the CRM pipeline is won, at the value of the order
    await c.query(`UPDATE leads SET status = 'won', closed_at = NOW(), lost_reason = NULL, expected_value = ? WHERE sale_order_id = ? AND status <> 'won'`, [o.total, o.id]).catch(() => {});
  });
  res.json(await getOrder(req.params.id));
}));

// sales order → draft customer invoice (stock leaves when the invoice is posted)
r.post('/sales/:id/invoice', requirePerm('invoicing'), ah(async (req, res) => {
  const invId = await db.tx(async c => {
    const o = await c.one('SELECT * FROM sale_orders WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!o) throw notFound();
    if (o.status !== 'confirmed') throw bad('Confirm the order first');
    const lines = await c.query('SELECT * FROM sale_order_lines WHERE order_id = ? ORDER BY id', [o.id]);
    const ins = await c.query(`INSERT INTO invoices (kind, partner_id, invoice_date, due_date, notes, user_id, sale_order_id, location_id) VALUES ('customer_invoice', ?, CURDATE(), ?, ?, ?, ?, ?)`,
      [o.partner_id, req.body.due_date || null, `${o.number}${o.customer_ref ? ' · your ref ' + o.customer_ref : ''}`.slice(0, 255), req.user.id, o.id, o.location_id || null]);
    let sub = 0, tax = 0, tot = 0;
    for (const l of lines) {
      const unit = Number(l.unit_price) * (1 - Number(l.discount_pct) / 100);
      await c.query(`INSERT INTO invoice_lines (invoice_id, product_id, description, qty, unit_price, discount_pct, tax_rate, net_amount, tax_amount, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ins.insertId, l.product_id, Number(l.discount_pct) ? `${l.description} (less ${Number(l.discount_pct)}%)` : l.description, l.qty, Math.round(unit * 10000) / 10000,
          l.discount_pct, l.tax_rate, l.net_amount, l.tax_amount, l.line_total]);
      sub += Number(l.net_amount); tax += Number(l.tax_amount); tot += Number(l.line_total);
    }
    await c.query('UPDATE invoices SET subtotal = ?, tax_total = ?, total = ? WHERE id = ?', [round2(sub), round2(tax), round2(tot), ins.insertId]);
    await c.query(`UPDATE sale_orders SET status = 'invoiced', invoice_id = ? WHERE id = ?`, [ins.insertId, o.id]);
    return ins.insertId;
  });
  res.json({ invoice_id: invId });
}));

// email the quotation / order to the customer
r.post('/sales/:id/email', requirePerm('sales'), ah(async (req, res) => {
  const o = await getOrder(req.params.id);
  const to = req.body.to || o.partner_email;
  if (!to) throw bad('This customer has no email address');
  if (!req.body.html) throw bad('Nothing to send');
  const mailer = require('../services/mailer');
  const doc = o.number || o.quote_number;
  await mailer.sendMail({ to, subject: req.body.subject || `${o.number ? 'Order' : 'Quotation'} ${doc}`, html: req.body.html });
  if (['quote'].includes(o.status)) await db.query(`UPDATE sale_orders SET status = 'sent' WHERE id = ?`, [o.id]);
  res.json({ ok: true, to });
}));

/* ======================= PRICING RULES ======================= */
const RULE_FIELDS = ['name', 'kind', 'value', 'applies_to', 'product_id', 'category_id', 'min_qty', 'free_qty', 'customer_scope', 'partner_id', 'partner_tag',
  'days', 'time_from', 'time_to', 'date_from', 'date_to', 'on_pos', 'on_invoice', 'active'];
function cleanRule(b) {
  const d = pick(b, RULE_FIELDS);
  for (const k of ['product_id', 'category_id', 'partner_id', 'partner_tag', 'days', 'time_from', 'time_to', 'date_from', 'date_to']) if (d[k] === '' || d[k] === undefined) d[k] = null;
  if (Array.isArray(d.days)) d.days = d.days.join(',') || null;
  if (!d.name) throw bad('Give the promotion a name, e.g. "Happy hour 17:00–19:00"');
  if (!['percent', 'fixed_price', 'amount_off', 'multibuy'].includes(d.kind)) throw bad('Choose the type of price rule');
  if (d.kind === 'percent' && !(Number(d.value) > 0 && Number(d.value) <= 100)) throw bad('Percentage must be between 0 and 100');
  if (d.kind === 'multibuy' && !(Number(d.min_qty) >= 2 && Number(d.free_qty) >= 1 && Number(d.free_qty) < Number(d.min_qty))) throw bad('Multi-buy: "buy" must be at least 2 and "free" less than "buy", e.g. buy 3, 1 free');
  if (d.applies_to === 'product' && !d.product_id) throw bad('Choose the product');
  if (d.applies_to === 'category' && !d.category_id) throw bad('Choose the category');
  if (d.customer_scope === 'partner' && !d.partner_id) throw bad('Choose the customer');
  if (d.customer_scope === 'tag' && !d.partner_tag) throw bad('Enter the customer tag, e.g. wholesale');
  if ((d.time_from && !d.time_to) || (!d.time_from && d.time_to)) throw bad('Enter both a start and end time, or neither');
  return d;
}
r.get('/price-rules', requirePerm('catalog'), ah(async (req, res) => {
  res.json(await db.query(`SELECT r.*, p.name product_name, c.name category_name, pa.name partner_name FROM price_rules r
    LEFT JOIN products p ON p.id = r.product_id LEFT JOIN categories c ON c.id = r.category_id LEFT JOIN partners pa ON pa.id = r.partner_id
    ${req.query.all ? '' : 'WHERE r.active = 1'} ORDER BY r.active DESC, r.name`));
}));
r.get('/price-rules/active', ah(async (req, res) => res.json(await pricing.activeRules())));
r.post('/price-rules', requirePerm('catalog'), ah(async (req, res) => {
  const ins = await db.query('INSERT INTO price_rules SET ?', [cleanRule(req.body)]);
  res.json(await db.one('SELECT * FROM price_rules WHERE id = ?', [ins.insertId]));
}));
r.put('/price-rules/:id', requirePerm('catalog'), ah(async (req, res) => {
  await db.query('UPDATE price_rules SET ? WHERE id = ?', [cleanRule(req.body), req.params.id]);
  res.json(await db.one('SELECT * FROM price_rules WHERE id = ?', [req.params.id]));
}));
r.delete('/price-rules/:id', requirePerm('catalog'), ah(async (req, res) => { await db.query('UPDATE price_rules SET active = 0 WHERE id = ?', [req.params.id]); res.json({ ok: true }); }));
// price check: what would a product cost for this customer and quantity right now?
r.get('/price-check', ah(async (req, res) => {
  const p = await db.one('SELECT id, name, price, category_id FROM products WHERE id = ?', [req.query.product_id]);
  if (!p) throw notFound('Product');
  const partner = req.query.partner_id ? await db.one('SELECT id, tags FROM partners WHERE id = ?', [req.query.partner_id]) : null;
  const b = pricing.best(await pricing.activeRules(), { product: p, price: p.price, qty: Number(req.query.qty || 1), partner, when: new Date(), channel: req.query.channel || 'pos' });
  res.json({ product: p.name, price: Number(p.price), discount_pct: b.pct, rule: b.rule ? { id: b.rule.id, name: b.rule.name, text: pricing.describe(b.rule) } : null,
    unit_after: round2(Number(p.price) * (1 - b.pct / 100)) });
}));

module.exports = r;
