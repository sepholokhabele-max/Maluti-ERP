// Manufacturing: bills of materials (BOM), work orders, quality check, material shortages → purchase orders
const express = require('express');
const db = require('../db');
const stock = require('../services/stock');
const accounting = require('../services/accounting');
const { requirePerm } = require('../auth');
const { ah, bad, notFound, round2, pad, today } = require('../util');

const r = express.Router();
const r4 = n => Math.round(Number(n) * 10000) / 10000;
const PERM = requirePerm('inventory');

// ---------------------------------------------------------------- BOMs
async function bomCost(conn, bom, lines) {
  let material = 0;
  for (const l of lines) material += Number(l.qty) * (1 + Number(l.scrap_pct || 0) / 100) * Number(l.cost || 0);
  const total = material + Number(bom.labour_cost || 0) + Number(bom.overhead_cost || 0);
  const out = Number(bom.output_qty) || 1;
  return { material: round2(material), labour: round2(bom.labour_cost), overhead: round2(bom.overhead_cost), total: round2(total), unit: r4(total / out) };
}
async function getBom(conn, id) {
  const b = await conn.one(`SELECT b.*, p.name product_name, p.uom, p.price product_price FROM boms b JOIN products p ON p.id = b.product_id WHERE b.id = ?`, [id]);
  if (!b) throw notFound('Bill of materials');
  b.lines = await conn.query(`SELECT l.*, p.name product_name, p.uom, p.cost, p.stock_qty, p.type FROM bom_lines l JOIN products p ON p.id = l.product_id WHERE l.bom_id = ? ORDER BY l.id`, [b.id]);
  b.cost = await bomCost(conn, b, b.lines);
  b.margin_pct = Number(b.product_price) > 0 ? round2((1 - b.cost.unit * 1.15 / Number(b.product_price)) * 100) : null; // shelf prices include VAT
  return b;
}
r.get('/mrp/boms', PERM, ah(async (req, res) => {
  const rows = await db.query(`SELECT b.*, p.name product_name, p.uom, p.price product_price,
      (SELECT COUNT(*) FROM bom_lines l WHERE l.bom_id = b.id) line_count FROM boms b JOIN products p ON p.id = b.product_id
    ${req.query.all ? '' : 'WHERE b.active = 1'} ORDER BY p.name, b.name`);
  for (const b of rows) b.cost = await bomCost(db, b, await db.query('SELECT l.qty, l.scrap_pct, p.cost FROM bom_lines l JOIN products p ON p.id = l.product_id WHERE l.bom_id = ?', [b.id]));
  res.json(rows);
}));
r.get('/mrp/boms/:id', PERM, ah(async (req, res) => res.json(await getBom(db, req.params.id))));

async function saveBom(c, id, b) {
  const p = await c.one('SELECT id, name, type FROM products WHERE id = ?', [b.product_id]);
  if (!p) throw bad('Choose the product this makes');
  if (p.type !== 'stock') throw bad(`${p.name} must be a stocked product so made goods can be counted`);
  const out = r4(b.output_qty);
  if (!(out > 0)) throw bad('Enter how much one batch makes');
  const lines = [];
  for (const l of b.lines || []) {
    if (!l.product_id) continue;
    if (Number(l.product_id) === p.id) throw bad('A product cannot be a component of itself');
    const q = r4(l.qty);
    if (!(q > 0)) throw bad('Every component needs a quantity above 0');
    const sp = Math.max(0, Math.min(90, Number(l.scrap_pct) || 0));
    lines.push([Number(l.product_id), q, sp, l.notes ? String(l.notes).slice(0, 120) : null]);
  }
  if (!lines.length) throw bad('Add at least one component (raw material or part)');
  const v = { product_id: p.id, name: String(b.name || p.name).slice(0, 120), code: b.code ? String(b.code).slice(0, 40) : null, output_qty: out,
    labour_cost: round2(Math.max(0, Number(b.labour_cost) || 0)), overhead_cost: round2(Math.max(0, Number(b.overhead_cost) || 0)),
    minutes: Number(b.minutes) > 0 ? Math.round(Number(b.minutes)) : null, shelf_life_days: Number(b.shelf_life_days) > 0 ? Math.round(Number(b.shelf_life_days)) : null,
    instructions: b.instructions ? String(b.instructions).slice(0, 5000) : null, active: b.active === undefined ? 1 : (b.active ? 1 : 0) };
  if (id) { await c.query('UPDATE boms SET ? WHERE id = ?', [v, id]); await c.query('DELETE FROM bom_lines WHERE bom_id = ?', [id]); }
  else id = (await c.query('INSERT INTO boms SET ?', [v])).insertId;
  for (const l of lines) await c.query('INSERT INTO bom_lines (bom_id, product_id, qty, scrap_pct, notes) VALUES (?, ?, ?, ?, ?)', [id, ...l]);
  return id;
}
r.post('/mrp/boms', PERM, ah(async (req, res) => { const id = await db.tx(c => saveBom(c, null, req.body)); res.json(await getBom(db, id)); }));
r.put('/mrp/boms/:id', PERM, ah(async (req, res) => {
  if (!await db.one('SELECT id FROM boms WHERE id = ?', [req.params.id])) throw notFound();
  const id = await db.tx(c => saveBom(c, Number(req.params.id), req.body)); res.json(await getBom(db, id));
}));
r.delete('/mrp/boms/:id', PERM, ah(async (req, res) => { await db.query('UPDATE boms SET active = 0 WHERE id = ?', [req.params.id]); res.json({ ok: true }); }));

// ---------------------------------------------------------------- work orders
const WO_SQL = `SELECT w.*, p.name product_name, p.uom, b.name bom_name, l.name location_name, u.name user_name, so.number sale_order_number, eq.name equipment_name, eq.status equipment_status
  FROM work_orders w LEFT JOIN equipment eq ON eq.id = w.equipment_id JOIN products p ON p.id = w.product_id LEFT JOIN boms b ON b.id = w.bom_id LEFT JOIN locations l ON l.id = w.location_id
  LEFT JOIN users u ON u.id = w.user_id LEFT JOIN sale_orders so ON so.id = w.sale_order_id`;

async function getWo(conn, id) {
  const w = await conn.one(`${WO_SQL} WHERE w.id = ?`, [id]);
  if (!w) throw notFound('Work order');
  const loc = w.location_id || await stock.defaultLocation(conn);
  w.lines = await conn.query(`SELECT x.*, p.name product_name, p.uom, p.cost product_cost, p.type,
      COALESCE((SELECT qty FROM product_locations pl WHERE pl.product_id = x.product_id AND pl.location_id = ?), 0) available
    FROM work_order_lines x JOIN products p ON p.id = x.product_id WHERE x.wo_id = ? ORDER BY x.id`, [loc, w.id]);
  w.short = w.lines.filter(l => l.type === 'stock' && ['draft', 'confirmed', 'in_progress'].includes(w.status) && Number(l.available) + 1e-6 < Number(l.qty_planned))
    .map(l => ({ product_id: l.product_id, product_name: l.product_name, need: Number(l.qty_planned), available: Number(l.available), missing: r4(Number(l.qty_planned) - Number(l.available)) }));
  w.est_material = round2(w.lines.reduce((s, l) => s + Number(l.qty_planned) * Number(l.product_cost), 0));
  return w;
}
r.get('/mrp/work-orders', PERM, ah(async (req, res) => {
  const cond = [], args = [];
  if (req.query.status === 'open') cond.push(`w.status IN ('draft','confirmed','in_progress')`);
  else if (req.query.status && req.query.status !== 'all') { cond.push('w.status = ?'); args.push(req.query.status); }
  res.json(await db.query(`${WO_SQL} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY FIELD(w.status,'in_progress','confirmed','draft','done','cancelled'), w.planned_date IS NULL, w.planned_date, w.id DESC LIMIT 500`, args));
}));
r.get('/mrp/work-orders/:id', PERM, ah(async (req, res) => res.json(await getWo(db, req.params.id))));

/** new work order from a BOM: component quantities scaled to the quantity to make (plus expected scrap) */
r.post('/mrp/work-orders', PERM, ah(async (req, res) => {
  const b = req.body;
  const id = await db.tx(async c => {
    const bom = await c.one('SELECT * FROM boms WHERE id = ? AND active = 1', [b.bom_id]);
    if (!bom) throw bad('Choose a bill of materials');
    const q = r4(b.qty);
    if (!(q > 0)) throw bad('Enter how much to make');
    const factor = q / Number(bom.output_qty);
    const loc = b.location_id ? Number(b.location_id) : null;
    const ins = await c.query(`INSERT INTO work_orders (bom_id, product_id, qty_planned, location_id, planned_date, labour_cost, overhead_cost, sale_order_id, notes, user_id, equipment_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [bom.id, bom.product_id, q, loc, b.planned_date || today(), round2(Number(bom.labour_cost) * factor), round2(Number(bom.overhead_cost) * factor),
      b.sale_order_id || null, b.notes ? String(b.notes).slice(0, 255) : null, req.user.id, Number(b.equipment_id) || null]);
    await c.query('UPDATE work_orders SET number = ? WHERE id = ?', [`WO/${new Date().getFullYear()}/${pad(ins.insertId, 5)}`, ins.insertId]);
    for (const l of await c.query('SELECT * FROM bom_lines WHERE bom_id = ?', [bom.id]))
      await c.query('INSERT INTO work_order_lines (wo_id, product_id, qty_planned) VALUES (?, ?, ?)', [ins.insertId, l.product_id, r4(Number(l.qty) * factor * (1 + Number(l.scrap_pct) / 100))]);
    return ins.insertId;
  });
  res.json(await getWo(db, id));
}));
r.put('/mrp/work-orders/:id', PERM, ah(async (req, res) => {
  const b = req.body;
  await db.tx(async c => {
    const w = await c.one('SELECT * FROM work_orders WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!w) throw notFound();
    if (!['draft', 'confirmed'].includes(w.status)) throw bad('Only a draft or confirmed work order can be changed');
    const q = b.qty_planned !== undefined ? r4(b.qty_planned) : Number(w.qty_planned);
    if (!(q > 0)) throw bad('Enter how much to make');
    // a new quantity rescales the components and labour
    if (Math.abs(q - Number(w.qty_planned)) > 1e-9) {
      const f = q / Number(w.qty_planned);
      await c.query('UPDATE work_order_lines SET qty_planned = ROUND(qty_planned * ?, 4) WHERE wo_id = ?', [f, w.id]);
      await c.query('UPDATE work_orders SET labour_cost = ROUND(labour_cost * ?, 2), overhead_cost = ROUND(overhead_cost * ?, 2) WHERE id = ?', [f, f, w.id]);
    }
    await c.query('UPDATE work_orders SET qty_planned = ?, location_id = ?, planned_date = ?, notes = ?, equipment_id = ? WHERE id = ?',
      [q, b.location_id !== undefined ? (b.location_id || null) : w.location_id, b.planned_date || w.planned_date, b.notes !== undefined ? (b.notes || null) : w.notes,
        b.equipment_id !== undefined ? (Number(b.equipment_id) || null) : w.equipment_id, w.id]);
  });
  res.json(await getWo(db, req.params.id));
}));
const setStatus = (from, to, extra = '') => ah(async (req, res) => {
  const w = await db.one('SELECT * FROM work_orders WHERE id = ?', [req.params.id]);
  if (!w) throw notFound();
  if (!from.includes(w.status)) throw bad(`This work order is ${w.status.replace('_', ' ')}`);
  await db.query(`UPDATE work_orders SET status = ?${extra} WHERE id = ?`, [to, w.id]);
  res.json(await getWo(db, w.id));
});
r.post('/mrp/work-orders/:id/confirm', PERM, setStatus(['draft'], 'confirmed'));
r.post('/mrp/work-orders/:id/start', PERM, ah(async (req, res, next) => {
  const w = await db.one('SELECT w.equipment_id, e.name, e.status FROM work_orders w LEFT JOIN equipment e ON e.id = w.equipment_id WHERE w.id = ?', [req.params.id]);
  if (w && w.equipment_id && w.status === 'down' && !req.body.force) throw bad(`${w.name} is broken down (open maintenance request). Fix it first, or start anyway.`);
  return setStatus(['draft', 'confirmed'], 'in_progress', ', started_at = NOW()')(req, res, next);
}));
r.post('/mrp/work-orders/:id/cancel', PERM, setStatus(['draft', 'confirmed', 'in_progress'], 'cancelled'));

/**
 * Finish: components used come out of stock (first-expiry-first-out), the good quantity goes into stock as a new batch
 * at material + labour + overhead cost per unit. Labour and overhead are moved out of expenses into stock
 * (Dr Inventory / Cr 5210). Rejected units are costed and written off (Dr 5220 / Cr Inventory).
 */
r.post('/mrp/work-orders/:id/finish', PERM, ah(async (req, res) => {
  const b = req.body;
  const out = await db.tx(async c => {
    const w = await c.one('SELECT * FROM work_orders WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!w) throw notFound();
    if (!['confirmed', 'in_progress', 'draft'].includes(w.status)) throw bad(`This work order is ${w.status.replace('_', ' ')}`);
    const good = r4(b.qty_produced ?? w.qty_planned), rejected = r4(b.qty_rejected || 0);
    if (!(good >= 0) || !(rejected >= 0) || !(good + rejected > 0)) throw bad('Enter the quantity made (good units) and any rejects');
    const qc = ['passed', 'failed', 'none'].includes(b.qc_status) ? b.qc_status : 'none';
    if (qc === 'failed' && good > 0) throw bad('Quality check failed: record all units as rejected, or correct the check');
    const loc = await stock.resolveLocation(c, w.location_id);
    const used = new Map((b.lines || []).map(x => [Number(x.line_id), x.qty_used]));
    const lines = await c.query('SELECT x.*, p.name, p.type FROM work_order_lines x JOIN products p ON p.id = x.product_id WHERE x.wo_id = ?', [w.id]);
    let material = 0; const parents = [];
    for (const l of lines) {
      const q = r4(used.has(l.id) ? used.get(l.id) : l.qty_planned);
      if (!(q >= 0) || !isFinite(q)) throw bad(`Quantity used for ${l.name} must be 0 or more`);
      let unit = 0, batches = null;
      if (q > 0 && l.type === 'stock') {
        if (!b.allow_negative) {
          const have = await stock.qtyAt(c, l.product_id, loc);
          if (have + 0.0005 < q) throw bad(`Only ${r4(have)} of ${l.name} at the production location (need ${q}). Receive or transfer it first, or tick "allow negative stock".`);
        }
        const o = {};
        unit = await stock.move(c, { product_id: l.product_id, qty: -q, move_type: 'production', reference: w.number, user_id: req.user.id, location_id: loc, out: o, reason: 'Used in production' });
        if (o.used && o.used.length) {
          parents.push(...o.used);
          batches = (await c.query('SELECT batch_no FROM stock_batches WHERE id IN (?)', [o.used.map(u => u.batch_id)])).map(x => x.batch_no).join(', ').slice(0, 255);
        }
      } else if (q > 0) unit = Number((await c.one('SELECT cost FROM products WHERE id = ?', [l.product_id])).cost) || 0;
      const lc = round2(q * unit); material += lc;
      await c.query('UPDATE work_order_lines SET qty_used = ?, unit_cost = ?, cost_total = ?, batches = ? WHERE id = ?', [q, unit, lc, batches, l.id]);
    }
    material = round2(material);
    const labour = round2(b.labour_cost !== undefined ? Math.max(0, Number(b.labour_cost) || 0) : w.labour_cost);
    const overhead = round2(b.overhead_cost !== undefined ? Math.max(0, Number(b.overhead_cost) || 0) : w.overhead_cost);
    const total = round2(material + labour + overhead);
    const units = good + rejected;
    const unitCost = r4(total / units);
    const rejectValue = round2(rejected * unitCost);
    const goodValue = round2(total - rejectValue);
    let batchId = null;
    if (good > 0) {
      const bom = w.bom_id ? await c.one('SELECT shelf_life_days FROM boms WHERE id = ?', [w.bom_id]) : null;
      const expiry = b.expiry_date || (bom && bom.shelf_life_days ? stock.addDays(today(), bom.shelf_life_days) : null);
      const o = {};
      await stock.move(c, { product_id: w.product_id, qty: good, unit_cost: goodValue / good, move_type: 'production', reference: w.number, user_id: req.user.id, location_id: loc, out: o,
        batch: { batch_no: b.batch_no || null, expiry_date: expiry, received_date: today(), source: 'production', notes: `${w.number}${qc === 'passed' ? ' · QC passed' : ''}` } });
      batchId = o.batch_id || null;
      if (batchId) for (const u of parents)
        await c.query('INSERT INTO batch_links (child_batch_id, parent_batch_id, qty, via, reference) VALUES (?, ?, ?, ?, ?)', [batchId, u.batch_id, Math.round(u.qty * 1000) / 1000, 'production', w.number]);
    }
    // books: materials stay inside inventory (1200 → 1200); labour/overhead absorbed into stock; rejects written off
    const jl = [];
    if (labour + overhead) { jl.push({ code: '1200', debit: labour + overhead, description: `Labour & overhead into ${w.number}` }); jl.push({ code: '5210', credit: labour + overhead }); }
    if (rejectValue) { jl.push({ code: '5220', debit: rejectValue, description: `${rejected} rejected on ${w.number}` }); jl.push({ code: '1200', credit: rejectValue }); }
    if (jl.length) await accounting.post(c, { reference: w.number, memo: `Production ${w.number}`, source_type: 'work_order', source_id: w.id, user_id: req.user.id, location_id: loc, lines: jl });
    const batchNo = batchId ? (await c.one('SELECT batch_no FROM stock_batches WHERE id = ?', [batchId])).batch_no : (b.batch_no || null);
    await c.query(`UPDATE work_orders SET status = 'done', qty_produced = ?, qty_rejected = ?, material_cost = ?, labour_cost = ?, overhead_cost = ?, unit_cost = ?,
      batch_no = ?, output_batch_id = ?, qc_status = ?, qc_notes = ?, location_id = ?, started_at = COALESCE(started_at, NOW()), finished_at = NOW() WHERE id = ?`,
      [good, rejected, material, labour, overhead, good > 0 ? r4(goodValue / good) : null, batchNo, batchId, qc, b.qc_notes ? String(b.qc_notes).slice(0, 255) : null, loc, w.id]);
    return { material, labour, overhead, total, unit_cost: good > 0 ? r4(goodValue / good) : null, reject_value: rejectValue };
  });
  res.json({ ...out, work_order: await getWo(db, req.params.id) });
}));

// ---------------------------------------------------------------- shortages → purchase order
async function shortages() {
  const rows = await db.query(`SELECT x.product_id, p.name, p.uom, p.cost, COALESCE(w.location_id, (SELECT id FROM locations WHERE is_default = 1 LIMIT 1)) loc, SUM(x.qty_planned) need
    FROM work_order_lines x JOIN work_orders w ON w.id = x.wo_id JOIN products p ON p.id = x.product_id
    WHERE w.status IN ('draft','confirmed','in_progress') AND p.type = 'stock' GROUP BY x.product_id, loc`);
  const out = [];
  for (const x of rows) {
    const have = await stock.qtyAt(db, x.product_id, x.loc);
    const onOrder = Number((await db.one(`SELECT COALESCE(SUM(l.qty - l.qty_received), 0) q FROM purchase_lines l JOIN purchase_orders o ON o.id = l.po_id
      WHERE l.product_id = ? AND o.status IN ('draft','to_approve','confirmed','partial')`, [x.product_id])).q);
    const missing = r4(Number(x.need) - have - onOrder);
    if (missing > 0) out.push({ product_id: x.product_id, name: x.name, uom: x.uom, cost: Number(x.cost), location_id: x.loc, need: r4(x.need), available: r4(have), on_order: r4(onOrder), missing });
  }
  return out;
}
r.get('/mrp/shortages', PERM, ah(async (req, res) => res.json(await shortages())));
r.post('/mrp/shortages/purchase', requirePerm('purchasing'), ah(async (req, res) => {
  const sup = await db.one('SELECT id FROM partners WHERE id = ? AND is_supplier = 1', [req.body.supplier_id]);
  if (!sup) throw bad('Choose a supplier');
  const want = new Set((req.body.product_ids || []).map(Number));
  const list = (await shortages()).filter(s => !want.size || want.has(s.product_id));
  if (!list.length) throw bad('Nothing is short');
  const id = await db.tx(async c => {
    const ins = await c.query('INSERT INTO purchase_orders (supplier_id, order_date, notes, user_id, location_id) VALUES (?, CURDATE(), ?, ?, ?)', [sup.id, 'Materials for production', req.user.id, list[0].location_id || null]);
    await c.query('UPDATE purchase_orders SET number = ? WHERE id = ?', [`PO/${new Date().getFullYear()}/${pad(ins.insertId, 5)}`, ins.insertId]);
    let sub = 0, tax = 0;
    for (const s of list) {
      const p = await c.one('SELECT p.*, t.rate FROM products p LEFT JOIN taxes t ON t.id = p.tax_id WHERE p.id = ?', [s.product_id]);
      const q = Math.ceil(s.missing * 1000) / 1000;
      const rate = Number(p.rate || 0), net = round2(q * s.cost), vat = round2(net * rate / 100);
      sub += net; tax += vat;
      await c.query('INSERT INTO purchase_lines (po_id, product_id, description, qty, unit_cost, tax_rate, net_amount, tax_amount, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ins.insertId, s.product_id, s.name, q, s.cost, rate, net, vat, round2(net + vat)]);
    }
    await c.query('UPDATE purchase_orders SET subtotal = ?, tax_total = ?, total = ? WHERE id = ?', [round2(sub), round2(tax), round2(sub + tax), ins.insertId]);
    return ins.insertId;
  });
  res.json({ id, lines: list.length });
}));

r.get('/mrp/summary', PERM, ah(async (req, res) => {
  const c = await db.query(`SELECT status, COUNT(*) n FROM work_orders GROUP BY status`);
  const m = Object.fromEntries(c.map(x => [x.status, Number(x.n)]));
  const done30 = await db.one(`SELECT COUNT(*) n, COALESCE(SUM(qty_produced),0) good, COALESCE(SUM(qty_rejected),0) rej FROM work_orders WHERE status = 'done' AND finished_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`);
  res.json({ draft: m.draft || 0, confirmed: m.confirmed || 0, in_progress: m.in_progress || 0, done_30: Number(done30.n), good_30: Number(done30.good), rejected_30: Number(done30.rej),
    reject_rate: Number(done30.good) + Number(done30.rej) ? round2(Number(done30.rej) / (Number(done30.good) + Number(done30.rej)) * 100) : 0 });
}));

module.exports = r;
