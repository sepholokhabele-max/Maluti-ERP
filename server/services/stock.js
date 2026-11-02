// Stock movements with moving-average costing, plus batch / expiry tracking (FEFO) for batch-tracked products.
const { round2 } = require('../util');

const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const addDays = (date, n) => { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + Number(n)); return d.toISOString().slice(0, 10); };

/**
 * Record a stock move. qty positive = in, negative = out.
 * For incoming moves with a unit_cost, the product's average cost is updated.
 * Batch-tracked products: incoming moves create a batch (opts.batch = { batch_no, expiry_date, received_date, supplier_id, source });
 * outgoing moves consume batches first-expiry-first-out (or opts.batch_id first).
 * Returns the unit cost used (for COGS on outgoing moves).
 */
async function move(conn, { product_id, qty, unit_cost, move_type, reference, user_id, reason, batch, batch_id, out }) {
  const p = await conn.one('SELECT id, type, stock_qty, cost, track_batches, shelf_life_days FROM products WHERE id = ? FOR UPDATE', [product_id]);
  if (!p || p.type !== 'stock') return Number(p ? p.cost : 0);
  qty = Number(qty);
  let cost = Number(p.cost);
  if (qty > 0 && unit_cost !== undefined && unit_cost !== null && move_type !== 'refund') {
    const oldQty = Math.max(Number(p.stock_qty), 0);
    const newQty = oldQty + qty;
    cost = newQty > 0 ? (oldQty * cost + qty * Number(unit_cost)) / newQty : Number(unit_cost);
  }
  await conn.query('UPDATE products SET stock_qty = stock_qty + ?, cost = ? WHERE id = ?', [qty, cost, product_id]);
  await conn.query(
    'INSERT INTO stock_moves (product_id, qty, unit_cost, move_type, reference, user_id, reason) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [product_id, qty, qty > 0 && unit_cost != null ? unit_cost : cost, move_type, reference || null, user_id || null, reason || null]);
  if (Number(p.track_batches) && qty !== 0) {
    if (qty > 0) { const id = await addBatch(conn, p, qty, unit_cost != null ? Number(unit_cost) : cost, move_type, reference, batch || {}); if (out) out.batch_id = id; }
    else { const used = await consumeBatches(conn, p.id, -qty, move_type, reference, batch_id); if (out) out.used = used; }
  }
  return cost;
}

async function addBatch(conn, p, qty, unitCost, moveType, reference, b) {
  const received = b.received_date || todayStr();
  const expiry = b.expiry_date || (p.shelf_life_days ? addDays(received, p.shelf_life_days) : null);
  const source = b.source || ({ purchase: 'purchase', breakdown: 'breakdown', opening: 'opening', production: 'production' }[moveType] || (moveType === 'refund' || moveType === 'adjustment' ? 'adjustment' : 'manual'));
  const ins = await conn.query(
    `INSERT INTO stock_batches (product_id, batch_no, source, reference, received_date, expiry_date, qty_in, qty_remaining, unit_cost, supplier_id, notes, live_weight)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [p.id, b.batch_no || 'PENDING', source, reference || null, received, expiry, qty, qty, unitCost, b.supplier_id || null, b.notes || null, Number(b.live_weight) > 0 ? Number(b.live_weight) : null]);
  if (!b.batch_no) await conn.query('UPDATE stock_batches SET batch_no = ? WHERE id = ?', [`B${received.replace(/-/g, '').slice(2)}-${ins.insertId}`, ins.insertId]);
  await conn.query('INSERT INTO batch_moves (batch_id, qty, move_type, reference) VALUES (?, ?, ?, ?)', [ins.insertId, qty, moveType, reference || null]);
  return ins.insertId;
}

/** First-expiry-first-out; a preferred batch is used first. Returns [{batch_id, qty}] */
async function consumeBatches(conn, productId, qty, moveType, reference, preferredBatchId) {
  const batches = await conn.query(
    `SELECT * FROM stock_batches WHERE product_id = ? AND qty_remaining > 0
     ORDER BY (id = ?) DESC, expiry_date IS NULL, expiry_date, received_date, id FOR UPDATE`, [productId, preferredBatchId || 0]);
  const used = [];
  let left = Number(qty);
  for (const b of batches) {
    if (left <= 1e-9) break;
    const take = Math.min(left, Number(b.qty_remaining));
    await conn.query('UPDATE stock_batches SET qty_remaining = qty_remaining - ? WHERE id = ?', [take, b.id]);
    await conn.query('INSERT INTO batch_moves (batch_id, qty, move_type, reference) VALUES (?, ?, ?, ?)', [b.id, -take, moveType, reference || null]);
    used.push({ batch_id: b.id, qty: take });
    left = Math.round((left - take) * 1000) / 1000;
  }
  return used;
}

const value = (qty, cost) => round2(Number(qty) * Number(cost));

module.exports = { move, value, addDays, todayStr, consumeBatches };
