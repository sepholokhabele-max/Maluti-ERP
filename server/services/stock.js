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
async function move(conn, { product_id, qty, unit_cost, move_type, reference, user_id, reason, batch, batch_id, out, location_id }) {
  const p = await conn.one('SELECT id, type, stock_qty, cost, track_batches, shelf_life_days FROM products WHERE id = ? FOR UPDATE', [product_id]);
  if (!p || p.type !== 'stock') return Number(p ? p.cost : 0);
  qty = Number(qty);
  const loc = await resolveLocation(conn, location_id);
  let cost = Number(p.cost);
  if (qty > 0 && unit_cost !== undefined && unit_cost !== null && move_type !== 'refund') {
    const oldQty = Math.max(Number(p.stock_qty), 0);
    const newQty = oldQty + qty;
    cost = newQty > 0 ? (oldQty * cost + qty * Number(unit_cost)) / newQty : Number(unit_cost);
  }
  await conn.query('UPDATE products SET stock_qty = stock_qty + ?, cost = ? WHERE id = ?', [qty, cost, product_id]);
  await bumpLocation(conn, product_id, loc, qty);
  await conn.query(
    'INSERT INTO stock_moves (product_id, qty, unit_cost, move_type, reference, user_id, reason, location_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [product_id, qty, qty > 0 && unit_cost != null ? unit_cost : cost, move_type, reference || null, user_id || null, reason || null, loc]);
  if (Number(p.track_batches) && qty !== 0) {
    if (qty > 0) { const id = await addBatch(conn, p, qty, unit_cost != null ? Number(unit_cost) : cost, move_type, reference, { ...(batch || {}), location_id: loc }); if (out) out.batch_id = id; }
    else { const used = await consumeBatches(conn, p.id, -qty, move_type, reference, batch_id, loc); if (out) out.used = used; }
  }
  return cost;
}

async function addBatch(conn, p, qty, unitCost, moveType, reference, b) {
  const received = b.received_date || todayStr();
  const expiry = b.expiry_date || (p.shelf_life_days ? addDays(received, p.shelf_life_days) : null);
  const source = b.source || ({ purchase: 'purchase', breakdown: 'breakdown', opening: 'opening', production: 'production' }[moveType] || (moveType === 'refund' || moveType === 'adjustment' ? 'adjustment' : 'manual'));
  const ins = await conn.query(
    `INSERT INTO stock_batches (product_id, batch_no, source, reference, received_date, expiry_date, qty_in, qty_remaining, unit_cost, supplier_id, notes, live_weight, location_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [p.id, b.batch_no || 'PENDING', source, reference || null, received, expiry, qty, qty, unitCost, b.supplier_id || null, b.notes || null, Number(b.live_weight) > 0 ? Number(b.live_weight) : null, b.location_id || null]);
  if (!b.batch_no) await conn.query('UPDATE stock_batches SET batch_no = ? WHERE id = ?', [`B${received.replace(/-/g, '').slice(2)}-${ins.insertId}`, ins.insertId]);
  await conn.query('INSERT INTO batch_moves (batch_id, qty, move_type, reference) VALUES (?, ?, ?, ?)', [ins.insertId, qty, moveType, reference || null]);
  return ins.insertId;
}

/** First-expiry-first-out; a preferred batch is used first. Returns [{batch_id, qty}] */
async function consumeBatches(conn, productId, qty, moveType, reference, preferredBatchId, locationId) {
  // batches at this location (older batches without a location count as the default location's)
  const loc = locationId ? await resolveLocation(conn, locationId) : null;
  const def = loc ? await defaultLocation(conn) : null;
  const batches = await conn.query(
    `SELECT * FROM stock_batches WHERE product_id = ? AND qty_remaining > 0 ${moveType === 'sale' || moveType === 'invoice' ? 'AND recalled = 0' : ''}
     ${loc ? 'AND (location_id = ? OR (location_id IS NULL AND ? = ?))' : ''}
     ORDER BY (id = ?) DESC, expiry_date IS NULL, expiry_date, received_date, id FOR UPDATE`,
    [productId, ...(loc ? [loc, loc, def] : []), preferredBatchId || 0]);
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

// ---------------------------------------------------------------- locations
async function defaultLocation(conn) {
  const r = await conn.one('SELECT id FROM locations WHERE is_default = 1 AND active = 1 ORDER BY id LIMIT 1').catch(() => null);
  if (r) return r.id;
  const any = await conn.one(`SELECT id FROM locations WHERE kind <> 'transit' ORDER BY id LIMIT 1`).catch(() => null);
  return any ? any.id : null;
}
async function transitLocation(conn) {
  const r = await conn.one(`SELECT id FROM locations WHERE kind = 'transit' ORDER BY id LIMIT 1`);
  if (r) return r.id;
  const ins = await conn.query(`INSERT INTO locations (code, name, kind, sellable) VALUES ('TRANSIT', 'In transit', 'transit', 0)`);
  return ins.insertId;
}
async function resolveLocation(conn, id) {
  if (id) { const r = await conn.one('SELECT id FROM locations WHERE id = ?', [id]); if (r) return r.id; }
  return defaultLocation(conn);
}
async function bumpLocation(conn, productId, locationId, qty) {
  if (!locationId || !Number(qty)) return;
  await conn.query('INSERT INTO product_locations (product_id, location_id, qty) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty)', [productId, locationId, qty]);
}
async function qtyAt(conn, productId, locationId) {
  const r = await conn.one('SELECT qty FROM product_locations WHERE product_id = ? AND location_id = ?', [productId, locationId]);
  return r ? Number(r.qty) : 0;
}

/**
 * Move stock between two locations without changing the company's total or its average cost.
 * Batch-tracked products: the batches leave the source first-expiry-first-out and arrive with the same batch number and expiry.
 * Returns the value moved (qty × average cost).
 */
async function relocate(conn, { product_id, qty, from, to, reference, user_id, reason }) {
  const p = await conn.one('SELECT id, type, cost, track_batches FROM products WHERE id = ? FOR UPDATE', [product_id]);
  qty = Number(qty);
  if (!p || p.type !== 'stock' || !(qty > 0)) return 0;
  await bumpLocation(conn, p.id, from, -qty);
  await bumpLocation(conn, p.id, to, qty);
  await conn.query(`INSERT INTO stock_moves (product_id, qty, unit_cost, move_type, reference, user_id, reason, location_id) VALUES (?, ?, ?, 'transfer', ?, ?, ?, ?), (?, ?, ?, 'transfer', ?, ?, ?, ?)`,
    [p.id, -qty, p.cost, reference || null, user_id || null, reason || null, from, p.id, qty, p.cost, reference || null, user_id || null, reason || null, to]);
  if (Number(p.track_batches)) {
    const used = await consumeBatches(conn, p.id, qty, 'transfer', reference, null, from);
    let moved = 0;
    for (const u of used) {
      const b = await conn.one('SELECT * FROM stock_batches WHERE id = ?', [u.batch_id]);
      const ins = await conn.query(`INSERT INTO stock_batches (product_id, batch_no, source, reference, received_date, expiry_date, qty_in, qty_remaining, unit_cost, supplier_id, notes, live_weight, location_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [p.id, b.batch_no, b.source, reference || b.reference, b.received_date, b.expiry_date, u.qty, u.qty, b.unit_cost, b.supplier_id, b.notes, b.live_weight, to]);
      await conn.query('INSERT INTO batch_moves (batch_id, qty, move_type, reference) VALUES (?, ?, ?, ?)', [ins.insertId, u.qty, 'transfer', reference || null]);
      moved += u.qty;
    }
    // not enough batch stock at the source: the rest arrives as an unbatched top-up so the counts still agree
    if (qty - moved > 1e-6) await addBatch(conn, p, qty - moved, Number(p.cost), 'adjustment', reference, { location_id: to, notes: 'Transferred without a batch at the source' });
  }
  return round2(qty * Number(p.cost));
}

/** Puts any difference between a product's total stock and the sum over its locations into the default location
 *  (for stock created before locations existed, or imported straight into the products table). */
async function syncLocations(conn) {
  const def = await defaultLocation(conn);
  if (!def) return 0;
  const rows = await conn.query(`SELECT p.id, p.stock_qty - COALESCE(SUM(pl.qty), 0) diff FROM products p LEFT JOIN product_locations pl ON pl.product_id = p.id
    WHERE p.type = 'stock' GROUP BY p.id HAVING ABS(diff) > 0.00001`);
  for (const r of rows) await bumpLocation(conn, r.id, def, Number(r.diff));
  return rows.length;
}

const value = (qty, cost) => round2(Number(qty) * Number(cost));

module.exports = { move, value, addDays, todayStr, consumeBatches, relocate, defaultLocation, transitLocation, resolveLocation, qtyAt, bumpLocation, syncLocations };
