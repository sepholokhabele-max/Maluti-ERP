// Business types & modules, branches / warehouses / vans, stock per location, transfers and branch profit
const express = require('express');
const db = require('../db');
const stock = require('../services/stock');
const accounting = require('../services/accounting');
const modules = require('../services/modules');
const { requirePerm, can } = require('../auth');
const { ah, bad, notFound, round2, pad, today } = require('../util');

const r = express.Router();
const KINDS = ['shop', 'warehouse', 'branch', 'van', 'farm', 'site'];

// ---------------------------------------------------------------- business types & modules
r.get('/business', ah(async (req, res) => res.json(await modules.catalog())));
r.put('/business', requirePerm('settings'), ah(async (req, res) => {
  const out = await modules.save(req.body || {});
  await db.query(`INSERT INTO audit_log (user_id, action, entity, details) VALUES (?, 'business.modules', 'settings', ?)`,
    [req.user.id, JSON.stringify({ types: out.types, modules: out.modules })]).catch(() => {});
  res.json(out);
}));

// ---------------------------------------------------------------- locations
r.get('/locations', ah(async (req, res) => {
  const rows = await db.query(`SELECT l.*,
      (SELECT COUNT(*) FROM product_locations pl WHERE pl.location_id = l.id AND pl.qty <> 0) items,
      (SELECT COALESCE(SUM(pl.qty * p.cost), 0) FROM product_locations pl JOIN products p ON p.id = pl.product_id WHERE pl.location_id = l.id) value,
      (SELECT COUNT(*) FROM pos_terminals t WHERE t.location_id = l.id AND t.active = 1) tills
    FROM locations l ${req.query.all ? '' : 'WHERE l.active = 1'} ORDER BY l.kind = 'transit', l.is_default DESC, l.name`);
  rows.forEach(x => { x.value = round2(x.value); });
  res.json(rows);
}));

function cleanLocation(b) {
  const v = {
    code: String(b.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20),
    name: String(b.name || '').trim().slice(0, 100),
    kind: KINDS.includes(b.kind) ? b.kind : 'shop',
    address: b.address ? String(b.address).slice(0, 255) : null,
    phone: b.phone ? String(b.phone).slice(0, 40) : null,
    sellable: b.sellable === undefined ? 1 : (b.sellable ? 1 : 0),
    active: b.active === undefined ? 1 : (b.active ? 1 : 0)
  };
  if (!v.name) throw bad('Give the location a name');
  if (!v.code) v.code = v.name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'LOC';
  return v;
}

r.post('/locations', requirePerm('settings'), ah(async (req, res) => {
  const v = cleanLocation(req.body);
  if (await db.one('SELECT id FROM locations WHERE code = ?', [v.code])) throw bad(`Code ${v.code} is already used – choose another`);
  const ins = await db.query('INSERT INTO locations SET ?', [v]);
  if (req.body.is_default) await setDefault(ins.insertId);
  res.json(await db.one('SELECT * FROM locations WHERE id = ?', [ins.insertId]));
}));
r.put('/locations/:id', requirePerm('settings'), ah(async (req, res) => {
  const l = await db.one('SELECT * FROM locations WHERE id = ?', [req.params.id]);
  if (!l) throw notFound();
  if (l.kind === 'transit') throw bad('"In transit" is managed by the system');
  const v = cleanLocation({ ...l, ...req.body });
  if (await db.one('SELECT id FROM locations WHERE code = ? AND id <> ?', [v.code, l.id])) throw bad(`Code ${v.code} is already used – choose another`);
  if (!v.active) await checkCanClose(l);
  await db.query('UPDATE locations SET ? WHERE id = ?', [v, l.id]);
  if (req.body.is_default && v.active) await setDefault(l.id);
  res.json(await db.one('SELECT * FROM locations WHERE id = ?', [l.id]));
}));
r.delete('/locations/:id', requirePerm('settings'), ah(async (req, res) => {
  const l = await db.one('SELECT * FROM locations WHERE id = ?', [req.params.id]);
  if (!l) throw notFound();
  if (l.kind === 'transit') throw bad('"In transit" is managed by the system');
  await checkCanClose(l);
  await db.query('UPDATE locations SET active = 0 WHERE id = ?', [l.id]);
  res.json({ ok: true });
}));
async function checkCanClose(l) {
  if (Number(l.is_default)) throw bad('This is the default location. Make another location the default first.');
  const s = await db.one('SELECT COUNT(*) c FROM product_locations WHERE location_id = ? AND ABS(qty) > 0.0001', [l.id]);
  if (Number(s.c)) throw bad(`${l.name} still has stock of ${s.c} product(s). Transfer or count it out first.`);
  const t = await db.one('SELECT COUNT(*) c FROM pos_terminals WHERE location_id = ? AND active = 1', [l.id]);
  if (Number(t.c)) throw bad(`${t.c} till(s) are linked to ${l.name}. Move them to another branch first.`);
}
async function setDefault(id) {
  await db.query('UPDATE locations SET is_default = (id = ?)', [id]);
}

// stock per location: one row per product, a column per location
r.get('/locations/stock', requirePerm('inventory'), ah(async (req, res) => {
  const locs = await db.query(`SELECT id, code, name, kind FROM locations WHERE active = 1 ORDER BY kind = 'transit', is_default DESC, name`);
  const cond = [`p.type = 'stock'`, 'p.active = 1'], args = [];
  if (req.query.q) { cond.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)'); args.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.query.category_id) { cond.push('p.category_id = ?'); args.push(req.query.category_id); }
  const prods = await db.query(`SELECT p.id, p.sku, p.name, p.uom, p.cost, p.stock_qty, p.reorder_level, c.name category
    FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE ${cond.join(' AND ')} ORDER BY p.name LIMIT 2000`, args);
  const pl = await db.query('SELECT product_id, location_id, qty, min_qty, bin FROM product_locations');
  const map = new Map(pl.map(x => [`${x.product_id}:${x.location_id}`, x]));
  const rows = prods.map(p => {
    const at = {};
    for (const l of locs) { const x = map.get(`${p.id}:${l.id}`); at[l.id] = { qty: x ? Number(x.qty) : 0, min_qty: x && x.min_qty != null ? Number(x.min_qty) : null, bin: x ? x.bin : null }; }
    const low = locs.filter(l => l.kind !== 'transit' && at[l.id].min_qty != null && at[l.id].qty < at[l.id].min_qty).map(l => l.id);
    return { ...p, stock_qty: Number(p.stock_qty), at, low };
  });
  if (req.query.low) return res.json({ locations: locs, rows: rows.filter(x => x.low.length) });
  res.json({ locations: locs, rows });
}));
// batches (lots / expiry) of one product at each location
r.get('/locations/batches', requirePerm('inventory'), ah(async (req, res) => {
  if (!req.query.product_id) throw bad('Choose a product');
  res.json(await db.query(`SELECT b.id, b.batch_no, b.expiry_date, b.received_date, b.qty_remaining, b.unit_cost, b.location_id, COALESCE(l.name, d.name) location_name
    FROM stock_batches b LEFT JOIN locations l ON l.id = b.location_id LEFT JOIN locations d ON d.is_default = 1 AND b.location_id IS NULL
    WHERE b.product_id = ? AND b.qty_remaining > 0 ORDER BY location_name, b.expiry_date IS NULL, b.expiry_date, b.id`, [req.query.product_id]));
}));

// minimum level and shelf/bin per product per location
r.put('/locations/:id/levels', requirePerm('inventory'), ah(async (req, res) => {
  const l = await db.one('SELECT * FROM locations WHERE id = ?', [req.params.id]);
  if (!l) throw notFound();
  for (const x of req.body.lines || []) {
    const min = x.min_qty === '' || x.min_qty == null ? null : Math.max(0, Number(x.min_qty));
    await db.query(`INSERT INTO product_locations (product_id, location_id, qty, min_qty, bin) VALUES (?, ?, 0, ?, ?)
      ON DUPLICATE KEY UPDATE min_qty = VALUES(min_qty), bin = VALUES(bin)`, [x.product_id, l.id, min, x.bin ? String(x.bin).slice(0, 40) : null]);
  }
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- transfers
const TR_SQL = `SELECT t.*, lf.name from_name, lt.name to_name, u.name user_name, ur.name received_by_name,
    (SELECT COUNT(*) FROM stock_transfer_lines x WHERE x.transfer_id = t.id) line_count,
    (SELECT COALESCE(SUM(x.qty * COALESCE(x.unit_cost, 0)), 0) FROM stock_transfer_lines x WHERE x.transfer_id = t.id) value
  FROM stock_transfers t JOIN locations lf ON lf.id = t.from_location_id JOIN locations lt ON lt.id = t.to_location_id
  LEFT JOIN users u ON u.id = t.user_id LEFT JOIN users ur ON ur.id = t.received_by`;

r.get('/transfers', requirePerm('inventory'), ah(async (req, res) => {
  const cond = [], args = [];
  if (req.query.status && req.query.status !== 'all') { cond.push('t.status = ?'); args.push(req.query.status); }
  if (req.query.location_id) { cond.push('(t.from_location_id = ? OR t.to_location_id = ?)'); args.push(req.query.location_id, req.query.location_id); }
  const rows = await db.query(`${TR_SQL} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY t.id DESC LIMIT 500`, args);
  rows.forEach(x => { x.value = round2(x.value); });
  res.json(rows);
}));
async function getTransfer(conn, id) {
  const t = await conn.one(`${TR_SQL} WHERE t.id = ?`, [id]);
  if (!t) throw notFound('Transfer');
  t.value = round2(t.value);
  t.lines = await conn.query(`SELECT x.*, p.name product_name, p.sku, p.uom, p.cost product_cost, p.track_batches,
      COALESCE((SELECT qty FROM product_locations pl WHERE pl.product_id = x.product_id AND pl.location_id = ?), 0) available
    FROM stock_transfer_lines x JOIN products p ON p.id = x.product_id WHERE x.transfer_id = ? ORDER BY x.id`, [t.from_location_id, t.id]);
  return t;
}
r.get('/transfers/:id', requirePerm('inventory'), ah(async (req, res) => res.json(await getTransfer(db, req.params.id))));

async function saveTransfer(c, b, id) {
  const from = await c.one('SELECT * FROM locations WHERE id = ? AND active = 1', [b.from_location_id]);
  const to = await c.one('SELECT * FROM locations WHERE id = ? AND active = 1', [b.to_location_id]);
  if (!from || !to) throw bad('Choose where the stock comes from and where it goes');
  if (from.id === to.id) throw bad('From and To must be different locations');
  if (from.kind === 'transit' || to.kind === 'transit') throw bad('"In transit" is used automatically – choose real locations');
  const lines = [];
  for (const l of b.lines || []) {
    const q = Number(l.qty);
    if (!l.product_id) continue;
    if (!(q > 0) || !isFinite(q)) throw bad('Every line needs a quantity above 0');
    const p = await c.one('SELECT id, name, type FROM products WHERE id = ?', [l.product_id]);
    if (!p || p.type !== 'stock') throw bad(`${p ? p.name : 'This product'} is not a stocked product`);
    lines.push({ product_id: p.id, qty: Math.round(q * 10000) / 10000 });
  }
  if (!lines.length) throw bad('Add at least one product');
  if (id) {
    await c.query('UPDATE stock_transfers SET from_location_id = ?, to_location_id = ?, notes = ? WHERE id = ?', [from.id, to.id, b.notes || null, id]);
    await c.query('DELETE FROM stock_transfer_lines WHERE transfer_id = ?', [id]);
  } else {
    const ins = await c.query('INSERT INTO stock_transfers (from_location_id, to_location_id, notes, user_id) VALUES (?, ?, ?, ?)', [from.id, to.id, b.notes || null, b.user_id]);
    id = ins.insertId;
  }
  for (const l of lines) await c.query('INSERT INTO stock_transfer_lines (transfer_id, product_id, qty) VALUES (?, ?, ?)', [id, l.product_id, l.qty]);
  return id;
}
r.post('/transfers', requirePerm('inventory'), ah(async (req, res) => {
  const id = await db.tx(c => saveTransfer(c, { ...req.body, user_id: req.user.id }));
  if (req.body.send) await db.tx(c => send(c, id, req.user, req.body.allow_negative));
  res.json(await getTransfer(db, id));
}));
r.put('/transfers/:id', requirePerm('inventory'), ah(async (req, res) => {
  await db.tx(async c => {
    const t = await c.one('SELECT * FROM stock_transfers WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!t) throw notFound();
    if (t.status !== 'draft') throw bad('Only a draft transfer can be changed');
    await saveTransfer(c, req.body, t.id);
  });
  res.json(await getTransfer(db, req.params.id));
}));

async function send(c, id, user, allowNegative) {
  const t = await c.one('SELECT * FROM stock_transfers WHERE id = ? FOR UPDATE', [id]);
  if (!t) throw notFound();
  if (t.status !== 'draft') throw bad('This transfer has already been sent');
  const transit = await stock.transitLocation(c);
  const number = t.number || `TR/${new Date().getFullYear()}/${pad(t.id, 5)}`;
  const lines = await c.query('SELECT x.*, p.name, p.uom, p.cost FROM stock_transfer_lines x JOIN products p ON p.id = x.product_id WHERE x.transfer_id = ?', [t.id]);
  for (const l of lines) {
    const have = await stock.qtyAt(c, l.product_id, t.from_location_id);
    if (have + 0.0005 < Number(l.qty) && !allowNegative)
      throw bad(`Only ${round2(have)} ${l.uom || ''} of ${l.name} at the sending location (sending ${Number(l.qty)}). Tick "allow negative stock" to send anyway.`);
  }
  for (const l of lines) {
    await stock.relocate(c, { product_id: l.product_id, qty: l.qty, from: t.from_location_id, to: transit, reference: number, user_id: user.id, reason: 'Sent' });
    await c.query('UPDATE stock_transfer_lines SET unit_cost = ? WHERE id = ?', [l.cost, l.id]);
  }
  await c.query(`UPDATE stock_transfers SET status = 'sent', number = ?, sent_at = NOW() WHERE id = ?`, [number, t.id]);
  return number;
}
r.post('/transfers/:id/send', requirePerm('inventory'), ah(async (req, res) => {
  const number = await db.tx(c => send(c, req.params.id, req.user, req.body.allow_negative));
  res.json({ number, transfer: await getTransfer(db, req.params.id) });
}));

// receive: what arrived goes to the destination; anything short is written off (Dr Transfer shortages / Cr Inventory)
r.post('/transfers/:id/receive', requirePerm('inventory'), ah(async (req, res) => {
  const out = await db.tx(async c => {
    const t = await c.one('SELECT * FROM stock_transfers WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!t) throw notFound();
    if (t.status !== 'sent') throw bad(t.status === 'draft' ? 'Send the transfer first' : 'This transfer is already closed');
    if (req.user.location_id && req.user.location_id !== t.to_location_id && !can(req.user, 'settings') && req.user.role !== 'manager')
      throw bad('Only staff at the receiving branch (or a manager) can receive this transfer');
    const transit = await stock.transitLocation(c);
    const got = new Map((req.body.lines || []).map(x => [Number(x.line_id), x.qty_received]));
    const lines = await c.query('SELECT x.*, p.name FROM stock_transfer_lines x JOIN products p ON p.id = x.product_id WHERE x.transfer_id = ?', [t.id]);
    let shortValue = 0; const short = [];
    for (const l of lines) {
      const raw = got.has(l.id) ? got.get(l.id) : l.qty;
      const q = Math.round(Number(raw) * 10000) / 10000;
      if (!isFinite(q) || q < 0) throw bad(`Received quantity for ${l.name} must be 0 or more`);
      if (q > Number(l.qty) + 1e-6) throw bad(`More ${l.name} received (${q}) than was sent (${Number(l.qty)}). Make a new transfer for the extra.`);
      if (q > 0) await stock.relocate(c, { product_id: l.product_id, qty: q, from: transit, to: t.to_location_id, reference: t.number, user_id: req.user.id, reason: 'Received' });
      const missing = Math.round((Number(l.qty) - q) * 10000) / 10000;
      if (missing > 0) {
        const cost = await stock.move(c, { product_id: l.product_id, qty: -missing, move_type: 'adjustment', reference: t.number, user_id: req.user.id, reason: 'Short on transfer', location_id: transit });
        shortValue += missing * Number(cost);
        short.push({ product: l.name, missing });
      }
      await c.query('UPDATE stock_transfer_lines SET qty_received = ? WHERE id = ?', [q, l.id]);
    }
    shortValue = round2(shortValue);
    if (shortValue) await accounting.post(c, { reference: t.number, memo: `Short on transfer ${t.number}`, source_type: 'transfer', source_id: t.id, user_id: req.user.id,
      location_id: t.to_location_id, lines: [{ code: '5150', debit: shortValue, description: short.map(x => `${x.product} ${x.missing}`).join(', ').slice(0, 250) }, { code: '1200', credit: shortValue }] });
    await c.query(`UPDATE stock_transfers SET status = 'received', received_at = NOW(), received_by = ?, notes = CONCAT(COALESCE(notes, ''), ?) WHERE id = ?`,
      [req.user.id, req.body.note ? ` · ${String(req.body.note).slice(0, 120)}` : '', t.id]);
    return { short, short_value: shortValue };
  });
  res.json({ ...out, transfer: await getTransfer(db, req.params.id) });
}));

// cancel: a draft is simply closed; a sent transfer brings the goods back to where they came from
r.post('/transfers/:id/cancel', requirePerm('inventory'), ah(async (req, res) => {
  await db.tx(async c => {
    const t = await c.one('SELECT * FROM stock_transfers WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!t) throw notFound();
    if (!['draft', 'sent'].includes(t.status)) throw bad('A received transfer cannot be cancelled – make a transfer back instead');
    if (t.status === 'sent') {
      const transit = await stock.transitLocation(c);
      const lines = await c.query('SELECT * FROM stock_transfer_lines WHERE transfer_id = ?', [t.id]);
      for (const l of lines) await stock.relocate(c, { product_id: l.product_id, qty: l.qty, from: transit, to: t.from_location_id, reference: `CANCEL ${t.number}`, user_id: req.user.id, reason: 'Transfer cancelled' });
    }
    await c.query(`UPDATE stock_transfers SET status = 'cancelled' WHERE id = ?`, [t.id]);
  });
  res.json(await getTransfer(db, req.params.id));
}));

// ---------------------------------------------------------------- profit per branch
r.get('/reports/branches', requirePerm('reports'), ah(async (req, res) => {
  const to = req.query.to || today(); const from = req.query.from || `${to.slice(0, 8)}01`;
  const rows = await db.query(`SELECT e.location_id, a.type, a.code, SUM(l.credit - l.debit) amt
    FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
    WHERE e.entry_date BETWEEN ? AND ? AND a.type IN ('income','expense') GROUP BY e.location_id, a.type, a.code`, [from, to]);
  const locs = await db.query(`SELECT id, name, kind FROM locations WHERE kind <> 'transit' ORDER BY is_default DESC, name`);
  const by = new Map();
  const get = id => { if (!by.has(id)) by.set(id, { location_id: id, income: 0, cogs: 0, expenses: 0 }); return by.get(id); };
  for (const x of rows) {
    const g = get(x.location_id || null); const v = Number(x.amt);
    if (x.type === 'income') g.income += v;
    else if (String(x.code).startsWith('5')) g.cogs += -v;
    else g.expenses += -v;
  }
  const out = [...locs.map(l => ({ ...get(l.id), name: l.name, kind: l.kind })), ...(by.has(null) ? [{ ...get(null), name: 'Not linked to a branch (head office)', kind: 'none' }] : [])]
    .map(g => ({ ...g, income: round2(g.income), cogs: round2(g.cogs), expenses: round2(g.expenses), gross: round2(g.income - g.cogs), profit: round2(g.income - g.cogs - g.expenses) }));
  const sum = k => round2(out.reduce((s, x) => s + x[k], 0));
  res.json({ from, to, rows: out, total: { income: sum('income'), cogs: sum('cogs'), expenses: sum('expenses'), gross: sum('gross'), profit: sum('profit') } });
}));

module.exports = r;
