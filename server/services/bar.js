// Bar: spirits & wine sold by measure (tots / glasses) out of bottle stock, and bottle stocktakes by weight.
const db = require('../db');
const stock = require('./stock');
const accounting = require('./accounting');
const { round2, bad, notFound, pad } = require('../util');

const r4 = n => Math.round(Number(n) * 10000) / 10000;
const r1 = n => Math.round(Number(n) * 10) / 10;

/** grams per ml of the liquid: explicit density, else from full & empty weights, else a typical 40% spirit */
function density(p) {
  if (Number(p.liquid_density) > 0) return Number(p.liquid_density);
  if (Number(p.bottle_full_g) > 0 && Number(p.bottle_empty_g) > 0 && Number(p.bottle_ml) > 0) return (Number(p.bottle_full_g) - Number(p.bottle_empty_g)) / Number(p.bottle_ml);
  return 0.95;
}

/** ml left in an open bottle that weighs `grams` on the scale (bottle + pourer, as set up in the product) */
function mlFromWeight(p, grams) {
  const empty = Number(p.bottle_empty_g || 0);
  if (!(empty > 0)) throw bad(`Set the empty bottle weight for ${p.name} first (Products → edit → Bar)`);
  const ml = (Number(grams) - empty) / density(p);
  return r1(Math.max(0, Math.min(Number(p.bottle_ml), ml)));
}

async function bottles() {
  const ps = await db.query(`SELECT p.*, c.name category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.bottle_ml > 0 AND p.active = 1 ORDER BY c.name, p.name`);
  const measures = await db.query(`SELECT m.id, m.name, m.price, m.pour_from_id, m.pour_ml, COALESCE(t.rate, 0) tax_rate FROM products m LEFT JOIN taxes t ON t.id = m.tax_id WHERE m.pour_from_id IS NOT NULL AND m.pour_ml > 0 AND m.active = 1 ORDER BY m.pour_ml`);
  return ps.map(p => {
    const dens = density(p);
    const full = Number(p.bottle_full_g) > 0 ? Number(p.bottle_full_g) : (Number(p.bottle_empty_g) > 0 ? r1(Number(p.bottle_empty_g) + Number(p.bottle_ml) * dens) : null);
    const ms = measures.filter(m => m.pour_from_id === p.id).map(m => ({ ...m, per_bottle: Math.floor(Number(p.bottle_ml) / Number(m.pour_ml) * 10) / 10,
      cost: round2(Number(p.cost) * Number(m.pour_ml) / Number(p.bottle_ml)), gp_pct: Number(m.price) ? Math.round((1 - Number(p.cost) * Number(m.pour_ml) / Number(p.bottle_ml) / (Number(m.price) / (1 + Number(m.tax_rate) / 100))) * 1000) / 10 : null }));
    return { id: p.id, name: p.name, category_name: p.category_name, uom: p.uom, bottle_ml: Number(p.bottle_ml), bottle_empty_g: p.bottle_empty_g == null ? null : Number(p.bottle_empty_g),
      bottle_full_g: full, density: Math.round(dens * 1000) / 1000, cost: Number(p.cost), stock_qty: Number(p.stock_qty), stock_ml: r1(Number(p.stock_qty) * Number(p.bottle_ml)), measures: ms };
  });
}

async function computeLines(c, lines) {
  const out = [];
  for (const l of lines || []) {
    const p = await c.one('SELECT * FROM products WHERE id = ?', [l.product_id]);
    if (!p) throw bad('Product not found');
    if (!(Number(p.bottle_ml) > 0)) throw bad(`${p.name} has no bottle size set`);
    const weights = (Array.isArray(l.open_weights) ? l.open_weights : String(l.open_weights || '').split(/[\s,;]+/)).map(Number).filter(g => g > 0);
    const openMl = weights.reduce((s, g) => s + mlFromWeight(p, g), 0);
    const full = Number(l.full_bottles || 0);
    if (full < 0) throw bad('Full bottles cannot be negative');
    const counted = r4(full + openMl / Number(p.bottle_ml));
    const system = r4(p.stock_qty);
    const v = r4(counted - system);
    out.push({ product_id: p.id, name: p.name, full_bottles: full, open_weights: weights.join(', '), open_ml: r1(openMl), counted_qty: counted, system_qty: system,
      variance_qty: v, variance_ml: r1(v * Number(p.bottle_ml)), unit_cost: Number(p.cost), variance_value: round2(v * Number(p.cost)), bottle_ml: Number(p.bottle_ml) });
  }
  return out;
}

async function saveCount(user, id, b) {
  return db.tx(async c => {
    if (id) {
      const cur = await c.one('SELECT * FROM bar_counts WHERE id = ? FOR UPDATE', [id]);
      if (!cur) throw notFound('Count');
      if (cur.status !== 'draft') throw bad('This count is already posted');
      await c.query('UPDATE bar_counts SET count_date = ?, notes = ? WHERE id = ?', [b.count_date || stock.todayStr(), b.notes || null, id]);
    } else {
      id = (await c.query('INSERT INTO bar_counts (count_date, notes, user_id) VALUES (?, ?, ?)', [b.count_date || stock.todayStr(), b.notes || null, user.id])).insertId;
      await c.query('UPDATE bar_counts SET number = ? WHERE id = ?', [`BAR/${String(b.count_date || stock.todayStr()).slice(0, 4)}/${pad(id, 5)}`, id]);
    }
    const lines = await computeLines(c, b.lines);
    await c.query('DELETE FROM bar_count_lines WHERE count_id = ?', [id]);
    for (const l of lines)
      await c.query(`INSERT INTO bar_count_lines (count_id, product_id, full_bottles, open_weights, open_ml, counted_qty, system_qty, variance_qty, variance_ml, unit_cost, variance_value)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, l.product_id, l.full_bottles, l.open_weights, l.open_ml, l.counted_qty, l.system_qty, l.variance_qty, l.variance_ml, l.unit_cost, l.variance_value]);
    await c.query('UPDATE bar_counts SET variance_value = ? WHERE id = ?', [round2(lines.reduce((s, l) => s + l.variance_value, 0)), id]);
    return id;
  });
}

async function getCount(id) {
  const k = await db.one('SELECT b.*, u.name user_name FROM bar_counts b LEFT JOIN users u ON u.id = b.user_id WHERE b.id = ?', [id]);
  if (!k) throw notFound('Count');
  k.lines = await db.query(`SELECT l.*, p.name, p.bottle_ml, p.stock_qty current_qty FROM bar_count_lines l JOIN products p ON p.id = l.product_id WHERE count_id = ? ORDER BY p.name`, [id]);
  return k;
}

/** Post: re-read system stock (sales may have happened since saving), then adjust stock to what was counted */
async function postCount(user, id) {
  return db.tx(async c => {
    const k = await c.one('SELECT * FROM bar_counts WHERE id = ? FOR UPDATE', [id]);
    if (!k) throw notFound('Count');
    if (k.status !== 'draft') throw bad('Already posted');
    const saved = await c.query('SELECT * FROM bar_count_lines WHERE count_id = ?', [id]);
    let loss = 0, gain = 0;
    for (const l of saved) {
      const p = await c.one('SELECT * FROM products WHERE id = ? FOR UPDATE', [l.product_id]);
      const v = r4(Number(l.counted_qty) - Number(p.stock_qty));
      const cost = Number(p.cost);
      if (Math.abs(v) >= 0.0001) await stock.move(c, { product_id: p.id, qty: v, unit_cost: v > 0 ? cost : undefined, move_type: 'count', reference: k.number, user_id: user.id, reason: v < 0 ? 'Bar count shortage' : 'Bar count surplus' });
      const val = round2(v * cost);
      if (val < 0) loss += -val; else gain += val;
      await c.query('UPDATE bar_count_lines SET system_qty = ?, variance_qty = ?, variance_ml = ?, unit_cost = ?, variance_value = ? WHERE id = ?',
        [r4(p.stock_qty), v, r1(v * Number(p.bottle_ml)), cost, val, l.id]);
    }
    loss = round2(loss); gain = round2(gain);
    const jl = [];
    if (loss) jl.push({ code: '5150', debit: loss, description: 'Bar stock shortage' }, { code: '1200', credit: loss });
    if (gain) jl.push({ code: '1200', debit: gain }, { code: '4950', credit: gain, description: 'Bar stock surplus' });
    if (jl.length) await accounting.post(c, { date: k.count_date, reference: k.number, memo: `Bar stock count ${k.number}`, source_type: 'bar_count', source_id: k.id, user_id: user.id, lines: jl });
    await c.query(`UPDATE bar_counts SET status = 'posted', posted_at = NOW(), variance_value = ? WHERE id = ?`, [round2(gain - loss), id]);
    return { loss, gain, net: round2(gain - loss) };
  });
}

/** ml sold per bottle product between two dates (from measures and whole-bottle sales) */
async function pourReport(from, to) {
  return db.query(`SELECT p.id, p.name, p.bottle_ml, ROUND(SUM(-m.qty), 4) bottles, ROUND(SUM(-m.qty) * p.bottle_ml, 1) ml, ROUND(SUM(-m.qty * m.unit_cost), 2) cost
    FROM stock_moves m JOIN products p ON p.id = m.product_id
    WHERE p.bottle_ml > 0 AND m.move_type IN ('sale','refund') AND m.created_at BETWEEN ? AND ? GROUP BY p.id ORDER BY ml DESC`, [from + ' 00:00:00', to + ' 23:59:59']);
}

module.exports = { density, mlFromWeight, bottles, saveCount, getCount, postCount, pourReport };
