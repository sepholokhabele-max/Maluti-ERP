// Master data: products, categories, taxes, partners, inventory, floors/tables, terminals, payment methods
const express = require('express');
const db = require('../db');
const stock = require('../services/stock');
const accounting = require('../services/accounting');
const { requirePerm } = require('../auth');
const { ah, bad, notFound, round2, pick } = require('../util');

const r = express.Router();

/** Simple CRUD for a table with whitelisted fields */
function crud(path, table, fields, { perm, readPerm, orderBy = 'id', search = [], softDelete = true, readSql } = {}) {
  r.get(`/${path}`, readPerm ? requirePerm(readPerm) : (q, s, n) => n(), ah(async (req, res) => {
    const cond = [], args = [];
    if (req.query.q && search.length) { cond.push('(' + search.map(f => `x.${f} LIKE ?`).join(' OR ') + ')'); search.forEach(() => args.push(`%${req.query.q}%`)); }
    if (req.query.active !== 'all' && softDelete) cond.push('x.active = 1');
    for (const f of fields) if (req.query[f] !== undefined && req.query[f] !== 'all') { cond.push(`x.${f} = ?`); args.push(req.query[f]); }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    res.json(await db.query(`${readSql || `SELECT x.* FROM ${table} x`} ${where} ORDER BY x.${orderBy} LIMIT 2000`, args));
  }));
  r.get(`/${path}/:id`, ah(async (req, res) => {
    const row = await db.one(`${readSql || `SELECT x.* FROM ${table} x`} WHERE x.id = ?`, [req.params.id]);
    if (!row) throw notFound();
    res.json(row);
  }));
  r.post(`/${path}`, requirePerm(perm), ah(async (req, res) => {
    const data = pick(req.body, fields);
    if (!Object.keys(data).length) throw bad('No data');
    const ins = await db.query(`INSERT INTO ${table} SET ?`, [data]);
    res.json(await db.one(`SELECT * FROM ${table} WHERE id = ?`, [ins.insertId]));
  }));
  r.put(`/${path}/:id`, requirePerm(perm), ah(async (req, res) => {
    const data = pick(req.body, fields);
    if (Object.keys(data).length) await db.query(`UPDATE ${table} SET ? WHERE id = ?`, [data, req.params.id]);
    res.json(await db.one(`SELECT * FROM ${table} WHERE id = ?`, [req.params.id]));
  }));
  r.delete(`/${path}/:id`, requirePerm(perm), ah(async (req, res) => {
    if (softDelete) await db.query(`UPDATE ${table} SET active = 0 WHERE id = ?`, [req.params.id]);
    else await db.query(`DELETE FROM ${table} WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  }));
}

crud('categories', 'categories', ['name', 'color', 'station', 'sort_order', 'active'], { perm: 'catalog', orderBy: 'sort_order', search: ['name'] });
crud('taxes', 'taxes', ['name', 'rate', 'price_includes_tax', 'active'], { perm: 'settings' });
crud('partners', 'partners', ['name', 'is_customer', 'is_supplier', 'phone', 'email', 'address', 'tax_number', 'credit_limit', 'notes', 'active',
  'contact_person', 'birthday', 'tags', 'owner_id', 'marketing_opt_out'],
  { perm: 'partners', orderBy: 'name', search: ['name', 'phone', 'email', 'tags'] });
crud('terminals', 'pos_terminals', ['name', 'mode', 'active', 'location_id'], { perm: 'settings' });
crud('payment-methods', 'payment_methods', ['name', 'kind', 'account_code', 'requires_reference', 'plugin_id', 'active', 'sort_order', 'qr_payload', 'qr_label'], { perm: 'settings', orderBy: 'sort_order' });
crud('floors', 'floors', ['name', 'sort_order'], { perm: 'settings', softDelete: false, orderBy: 'sort_order' });
crud('tables', 'restaurant_tables', ['floor_id', 'name', 'seats', 'active'], { perm: 'settings' });

// ---- products (custom because of opening stock) ----
const PRODUCT_FIELDS = ['sku', 'barcode', 'name', 'category_id', 'type', 'uom', 'price', 'cost', 'tax_id', 'reorder_level', 'pos_visible', 'active',
  'sold_by_weight', 'plu', 'track_batches', 'shelf_life_days', 'is_carcass', 'bottle_ml', 'bottle_empty_g', 'bottle_full_g', 'liquid_density', 'pour_from_id', 'pour_ml', 'species'];
r.get('/products', ah(async (req, res) => {
  const cond = [], args = [];
  if (req.query.active !== 'all') cond.push('p.active = 1');
  if (req.query.q) { cond.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode = ?)'); args.push(`%${req.query.q}%`, `%${req.query.q}%`, req.query.q); }
  if (req.query.category_id) { cond.push('p.category_id = ?'); args.push(req.query.category_id); }
  if (req.query.low) cond.push(`p.type = 'stock' AND p.stock_qty <= p.reorder_level`);
  res.json(await db.query(
    `SELECT p.*, c.name category_name, t.name tax_name, t.rate tax_rate FROM products p
     LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN taxes t ON t.id = p.tax_id
     ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY p.name LIMIT 5000`, args));
}));
r.get('/products/:id', ah(async (req, res) => {
  const p = await db.one('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (!p) throw notFound('Product');
  p.moves = await db.query('SELECT m.*, u.name user_name FROM stock_moves m LEFT JOIN users u ON u.id = m.user_id WHERE product_id = ? ORDER BY id DESC LIMIT 100', [p.id]);
  res.json(p);
}));
r.post('/products', requirePerm('catalog'), ah(async (req, res) => {
  const data = pick(req.body, PRODUCT_FIELDS);
  if (!data.name) throw bad('Name is required');
  for (const k of ['sku', 'barcode', 'plu']) if (data[k] === '') data[k] = null;
  if (data.shelf_life_days === '' || data.shelf_life_days === 0) data.shelf_life_days = null;
  if (data.species === '') data.species = null;
  for (const k of ['bottle_ml', 'bottle_empty_g', 'bottle_full_g', 'liquid_density', 'pour_from_id', 'pour_ml']) if (data[k] === '' || data[k] === 0 || data[k] === '0') data[k] = null;
  if (data.pour_from_id && (data.id || req.params.id) && Number(data.pour_from_id) === Number(req.params.id)) throw bad('A measure cannot pour from itself');
  const id = await db.tx(async c => {
    const ins = await c.query('INSERT INTO products SET ?', [data]);
    const q = Number(req.body.opening_qty || 0);
    if (q && (data.type || 'stock') === 'stock') {
      // an imported opening balance may come with its batch number and expiry date (medicines, food)
      const batch = req.body.opening_batch_no || req.body.opening_expiry ? { batch_no: req.body.opening_batch_no || null, expiry_date: req.body.opening_expiry || null, source: 'opening' } : undefined;
      await stock.move(c, { product_id: ins.insertId, qty: q, unit_cost: Number(data.cost || 0), move_type: 'opening', reference: 'Opening stock', user_id: req.user.id, batch, location_id: req.body.location_id || undefined });
      const v = round2(q * Number(data.cost || 0));
      await accounting.post(c, { reference: 'OPENING', memo: `Opening stock ${data.name}`, source_type: 'stock_opening', source_id: ins.insertId, user_id: req.user.id,
        lines: [{ code: '1200', debit: v }, { code: '3000', credit: v }] });
    }
    return ins.insertId;
  });
  res.json(await db.one('SELECT * FROM products WHERE id = ?', [id]));
}));
r.put('/products/:id', requirePerm('catalog'), ah(async (req, res) => {
  const data = pick(req.body, PRODUCT_FIELDS);
  delete data.cost; // cost is maintained by stock moves (moving average); adjust via purchasing or stock adjustment
  if (req.body.cost !== undefined) {
    const p = await db.one('SELECT stock_qty, type FROM products WHERE id = ?', [req.params.id]);
    if (p && (p.type !== 'stock' || Number(p.stock_qty) === 0)) data.cost = req.body.cost;
  }
  for (const k of ['sku', 'barcode', 'plu']) if (data[k] === '') data[k] = null;
  if (data.shelf_life_days === '' || data.shelf_life_days === 0) data.shelf_life_days = null;
  if (data.species === '') data.species = null;
  for (const k of ['bottle_ml', 'bottle_empty_g', 'bottle_full_g', 'liquid_density', 'pour_from_id', 'pour_ml']) if (data[k] === '' || data[k] === 0 || data[k] === '0') data[k] = null;
  if (data.pour_from_id && (data.id || req.params.id) && Number(data.pour_from_id) === Number(req.params.id)) throw bad('A measure cannot pour from itself');
  if (Object.keys(data).length) await db.query('UPDATE products SET ? WHERE id = ?', [data, req.params.id]);
  res.json(await db.one('SELECT * FROM products WHERE id = ?', [req.params.id]));
}));
r.delete('/products/:id', requirePerm('catalog'), ah(async (req, res) => {
  await db.query('UPDATE products SET active = 0 WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

// ---- inventory ----
r.post('/inventory/adjust', requirePerm('inventory'), ah(async (req, res) => {
  // body: { lines: [{ product_id, counted_qty }], reason, location_id } -> sets stock at that location (default: main) to the counted quantity
  const out = await db.tx(async c => {
    let value = 0; const changes = [];
    const loc = await stock.resolveLocation(c, req.body.location_id);
    for (const l of req.body.lines || []) {
      const p = await c.one('SELECT * FROM products WHERE id = ? FOR UPDATE', [l.product_id]);
      if (!p || p.type !== 'stock') continue;
      const before = loc ? await stock.qtyAt(c, p.id, loc) : Number(p.stock_qty);
      // add_qty: add to what is there (opening stock brought in batch by batch); counted_qty: set it to the count
      if (l.add_qty !== undefined && l.add_qty !== null && l.add_qty !== '') l.counted_qty = before + Number(l.add_qty);
      if (!isFinite(Number(l.counted_qty)) || l.counted_qty === '' || l.counted_qty === null) continue;
      const diff = Number(l.counted_qty) - before;
      if (Math.abs(diff) < 1e-9) continue;
      // opening stock taken over from another system: valued at the given cost and booked against opening balances, not as a loss/gain
      const opening = !!req.body.opening && diff > 0;
      const uc = opening && Number(l.unit_cost) > 0 ? Number(l.unit_cost) : undefined;
      await stock.move(c, { product_id: p.id, qty: diff, unit_cost: uc, move_type: opening ? 'opening' : 'adjustment', reference: req.body.reason || (opening ? 'Opening stock' : 'Stock count'), user_id: req.user.id, location_id: loc,
        batch: opening && (l.batch_no || l.expiry_date) ? { batch_no: l.batch_no || null, expiry_date: l.expiry_date || null, source: 'opening' } : undefined });
      value += diff * (uc !== undefined ? uc : Number(p.cost));
      changes.push({ product: p.name, from: before, to: Number(l.counted_qty) });
    }
    value = round2(value);
    if (value) await accounting.post(c, { reference: 'STOCK-ADJ', memo: req.body.reason || 'Stock adjustment', source_type: 'stock_adjust', user_id: req.user.id, location_id: loc,
      lines: value > 0 ? [{ code: '1200', debit: value }, { code: req.body.opening ? '3000' : '5100', credit: value }] : [{ code: '5100', debit: -value }, { code: '1200', credit: -value }] });
    return { changes, value };
  });
  res.json(out);
}));
r.get('/inventory/valuation', requirePerm('inventory'), ah(async (req, res) => {
  const loc = Number(req.query.location_id) || null;
  const rows = loc
    ? await db.query(`SELECT p.id, p.sku, p.name, c.name category, COALESCE(pl.qty,0) stock_qty, p.cost, ROUND(COALESCE(pl.qty,0)*p.cost,2) value, COALESCE(pl.min_qty, p.reorder_level) reorder_level
        FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN product_locations pl ON pl.product_id = p.id AND pl.location_id = ?
        WHERE p.type = 'stock' AND p.active = 1 ORDER BY p.name`, [loc])
    : await db.query(`SELECT p.id, p.sku, p.name, c.name category, p.stock_qty, p.cost, ROUND(p.stock_qty*p.cost,2) value, p.reorder_level
        FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.type = 'stock' AND p.active = 1 ORDER BY p.name`);
  res.json({ rows, total: round2(rows.reduce((s, r) => s + Number(r.value), 0)) });
}));
r.get('/inventory/moves', requirePerm('inventory'), ah(async (req, res) => {
  const loc = Number(req.query.location_id) || null;
  res.json(await db.query(`SELECT m.*, p.name product, u.name user_name, l.name location_name FROM stock_moves m JOIN products p ON p.id = m.product_id
    LEFT JOIN users u ON u.id = m.user_id LEFT JOIN locations l ON l.id = m.location_id ${loc ? 'WHERE m.location_id = ?' : ''} ORDER BY m.id DESC LIMIT 500`, loc ? [loc] : []));
}));

// partner ledger balance (AR/AP)
r.get('/partners/:id/balance', ah(async (req, res) => {
  const rows = await db.query(
    `SELECT a.code, SUM(l.debit - l.credit) bal FROM journal_lines l JOIN accounts a ON a.id = l.account_id
     WHERE l.partner_id = ? AND a.code IN ('1100','2000') GROUP BY a.code`, [req.params.id]);
  const get = c => Number((rows.find(r => r.code === c) || {}).bal || 0);
  res.json({ receivable: round2(get('1100')), payable: round2(-get('2000')) });
}));

module.exports = r;
