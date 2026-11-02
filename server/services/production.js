// Production (processing) runs: turn weighed ingredients – meat, fat, casings, water, soy, spices… – into a new product
// (boerewors, sausages, patties, biltong). Ingredient batches are consumed and linked to the output batch for traceability.
const db = require('../db');
const stock = require('./stock');
const { round2, bad, notFound, pad } = require('../util');

const r3 = n => Math.round(Number(n) * 1000) / 1000;
const KINDS = ['meat', 'fat', 'casing', 'water', 'binder', 'spice', 'other'];

async function recipes() {
  const rs = await db.query(`SELECT r.*, p.name output_name, p.uom FROM recipes r JOIN products p ON p.id = r.output_product_id WHERE r.active = 1 ORDER BY r.name`);
  for (const r of rs) r.lines = await db.query(`SELECT l.*, p.name product_name, p.type product_type, p.cost FROM recipe_lines l LEFT JOIN products p ON p.id = l.product_id WHERE recipe_id = ? ORDER BY l.id`, [r.id]);
  return rs;
}

async function saveRecipe(id, b) {
  if (!b.name || !b.output_product_id) throw bad('Name and output product are required');
  if (!(Number(b.output_qty) > 0)) throw bad('Enter the batch size (kg of product the recipe makes)');
  const lines = (b.lines || []).filter(l => (l.product_id || l.name) && Number(l.qty) > 0);
  if (!lines.length) throw bad('Add at least one ingredient');
  return db.tx(async c => {
    if (id) await c.query('UPDATE recipes SET name = ?, output_product_id = ?, output_qty = ?, notes = ? WHERE id = ?', [b.name, b.output_product_id, r3(b.output_qty), b.notes || null, id]);
    else id = (await c.query('INSERT INTO recipes (name, output_product_id, output_qty, notes) VALUES (?, ?, ?, ?)', [b.name, b.output_product_id, r3(b.output_qty), b.notes || null])).insertId;
    await c.query('DELETE FROM recipe_lines WHERE recipe_id = ?', [id]);
    for (const l of lines) {
      let name = l.name;
      if (!name && l.product_id) name = (await c.one('SELECT name FROM products WHERE id = ?', [l.product_id]) || {}).name;
      await c.query('INSERT INTO recipe_lines (recipe_id, product_id, name, kind, qty) VALUES (?, ?, ?, ?, ?)',
        [id, l.product_id || null, name || 'Ingredient', KINDS.includes(l.kind) ? l.kind : 'other', r3(l.qty)]);
    }
    return id;
  });
}

async function createRun(user, b) {
  const outQty = r3(b.output_qty);
  if (!(outQty > 0)) throw bad('Weigh the finished product (output kg)');
  const lines = (b.lines || []).map(l => ({ ...l, actual_qty: r3(l.actual_qty || 0), planned_qty: r3(l.planned_qty || 0), kind: KINDS.includes(l.kind) ? l.kind : 'other' }))
    .filter(l => l.actual_qty > 0);
  if (!lines.length) throw bad('Weigh at least one ingredient');
  const date = b.run_date || stock.todayStr();
  return db.tx(async c => {
    const outP = await c.one('SELECT * FROM products WHERE id = ?', [b.output_product_id]);
    if (!outP) throw notFound('Output product');
    if (outP.type !== 'stock') throw bad(`${outP.name} must be a stocked product`);
    const ins = await c.query('INSERT INTO production_runs (recipe_id, output_product_id, output_qty, run_date, notes, user_id) VALUES (?, ?, ?, ?, ?, ?)',
      [b.recipe_id || null, outP.id, outQty, date, b.notes || null, user.id]);
    const id = ins.insertId;
    const number = `PRD/${date.slice(0, 4)}/${pad(id, 5)}`;
    await c.query('UPDATE production_runs SET number = ? WHERE id = ?', [number, id]);
    let cost = 0, inQty = 0, meat = 0;
    const used = [];
    for (const l of lines) {
      let unitCost = 0, batchesTxt = null;
      if (l.product_id) {
        const p = await c.one('SELECT * FROM products WHERE id = ? FOR UPDATE', [l.product_id]);
        if (!p) throw bad('Ingredient product not found');
        if (Number(p.id) === Number(outP.id)) throw bad(`${p.name} cannot be an ingredient of itself`);
        l.name = l.name || p.name;
        if (p.type === 'stock') {
          if (Number(p.stock_qty) + 0.0005 < l.actual_qty && !b.allow_negative)
            throw bad(`Only ${Number(p.stock_qty)} ${p.uom} of ${p.name} in stock (need ${l.actual_qty}). Tick "allow negative stock" to post anyway.`);
          const o = {};
          unitCost = await stock.move(c, { product_id: p.id, qty: -l.actual_qty, move_type: 'production', reference: number, user_id: user.id, batch_id: l.batch_id || null, out: o });
          for (const u of o.used || []) used.push(u);
          if (o.used && o.used.length) batchesTxt = (await c.query('SELECT batch_no FROM stock_batches WHERE id IN (?)', [o.used.map(u => u.batch_id)])).map(x => x.batch_no).join(', ').slice(0, 255);
        }
        // non-stock ingredients (e.g. tap water) add weight but no stock cost
      }
      const lineCost = round2(l.actual_qty * unitCost);
      cost += lineCost; inQty += l.actual_qty;
      if (l.kind === 'meat') meat += l.actual_qty;
      l.unit_cost = unitCost; l.cost_total = lineCost; l.batches = batchesTxt;
    }
    cost = round2(cost);
    const o = {};
    await stock.move(c, { product_id: outP.id, qty: outQty, unit_cost: cost / outQty, move_type: 'production', reference: number, user_id: user.id, out: o,
      batch: { batch_no: b.batch_no || null, expiry_date: b.expiry_date || null, received_date: date, source: 'production',
        notes: `${number}: ${lines.map(l => `${l.name} ${l.actual_qty}`).join(', ')}`.slice(0, 255) } });
    if (o.batch_id) for (const u of used)
      await c.query('INSERT INTO batch_links (child_batch_id, parent_batch_id, qty, via, reference) VALUES (?, ?, ?, ?, ?)', [o.batch_id, u.batch_id, r3(u.qty), 'production', number]);
    for (const l of lines)
      await c.query(`INSERT INTO production_lines (run_id, product_id, name, kind, planned_qty, actual_qty, unit_cost, cost_total, batches) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, l.product_id || null, l.name || 'Ingredient', l.kind, l.planned_qty, l.actual_qty, l.unit_cost, l.cost_total, l.batches]);
    // inventory → inventory: the ingredients' cost moves into the product, so no journal entry
    await c.query('UPDATE production_runs SET output_batch_id = ?, input_qty_total = ?, meat_qty = ?, cost_total = ? WHERE id = ?', [o.batch_id || null, r3(inQty), r3(meat), cost, id]);
    return { id, number };
  });
}

async function getRun(id) {
  const r = await db.one(`SELECT r.*, p.name output_name, p.uom, p.price, rc.name recipe_name, u.name user_name, b.batch_no, b.expiry_date
    FROM production_runs r JOIN products p ON p.id = r.output_product_id LEFT JOIN recipes rc ON rc.id = r.recipe_id
    LEFT JOIN users u ON u.id = r.user_id LEFT JOIN stock_batches b ON b.id = r.output_batch_id WHERE r.id = ?`, [id]);
  if (!r) throw notFound('Production run');
  r.lines = await db.query('SELECT * FROM production_lines WHERE run_id = ? ORDER BY id', [id]);
  const out = Number(r.output_qty);
  for (const l of r.lines) l.pct_of_output = out ? Math.round(Number(l.actual_qty) / out * 1000) / 10 : 0;
  r.meat_pct = out ? Math.round(Number(r.meat_qty) / out * 1000) / 10 : 0;
  r.yield_pct = Number(r.input_qty_total) ? Math.round(out / Number(r.input_qty_total) * 1000) / 10 : 0;
  r.by_kind = KINDS.map(k => ({ kind: k, qty: r3(r.lines.filter(l => l.kind === k).reduce((s, l) => s + Number(l.actual_qty), 0)) })).filter(x => x.qty > 0)
    .map(x => ({ ...x, pct: out ? Math.round(x.qty / out * 1000) / 10 : 0 }));
  return r;
}

async function runs() {
  return db.query(`SELECT r.*, p.name output_name, p.uom, u.name user_name, b.batch_no,
      ROUND(r.meat_qty / r.output_qty * 100, 1) meat_pct, ROUND(r.output_qty / NULLIF(r.input_qty_total, 0) * 100, 1) yield_pct, ROUND(r.cost_total / r.output_qty, 2) cost_per_kg
    FROM production_runs r JOIN products p ON p.id = r.output_product_id LEFT JOIN users u ON u.id = r.user_id LEFT JOIN stock_batches b ON b.id = r.output_batch_id
    ORDER BY r.id DESC LIMIT 300`);
}

module.exports = { KINDS, recipes, saveRecipe, createRun, getRun, runs };
