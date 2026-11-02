// Carcass / batch traceability: follows every kg of a batch through breakdowns and production runs
// down to sales, waste, losses and what is still in stock – so a whole carcass can be accounted for.
const db = require('../db');
const { round2, notFound } = require('../util');

const r3 = n => Math.round(Number(n) * 1000) / 1000;
const SOLD = new Set(['sale', 'invoice']);
const PROCESS = new Set(['breakdown', 'production']);

async function loadBatch(id) {
  return db.one(`SELECT b.*, p.name product, p.uom, p.price, p.is_carcass, p.species, s.name supplier FROM stock_batches b JOIN products p ON p.id = b.product_id
    LEFT JOIN partners s ON s.id = b.supplier_id WHERE b.id = ?`, [id]);
}

// net selling price (ex VAT) per unit of a product on a sales document, for carcass revenue
async function salePrice(cache, reference, productId, fallback) {
  const k = reference + '|' + productId;
  if (cache.has(k)) return cache.get(k);
  let row = await db.one(`SELECT SUM(l.net_amount) net, SUM(l.qty) qty FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.number = ? AND l.product_id = ?`, [reference, productId]);
  if (!row || !Number(row.qty)) row = await db.one(`SELECT SUM(l.net_amount) net, SUM(l.qty) qty FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE i.number = ? AND l.product_id = ?`, [reference, productId]).catch(() => null);
  const v = row && Number(row.qty) ? Number(row.net) / Number(row.qty) : fallback;
  cache.set(k, v);
  return v;
}

/**
 * Where did this batch go? Every kg of the root batch ends up as: sold, written off, processing loss
 * (bone/fat/drip at breakdown, cooking/drying in production), adjusted, or still in stock.
 * `share` = kg of the root batch contained in one unit of the current batch.
 */
async function ledger(rootId) {
  const root = await loadBatch(rootId);
  if (!root) throw notFound('Batch');
  const Q = Number(root.qty_in);
  const T = { sold: 0, waste: 0, loss: 0, adjusted: 0, in_stock: 0, revenue: 0, cost: round2(Q * Number(root.unit_cost)) };
  const events = [];
  const cache = new Map();
  const seen = new Set();

  async function walk(b, share, depth, path) {
    const node = { batch_id: b.id, batch_no: b.batch_no, product: b.product, uom: b.uom, qty_in: Number(b.qty_in), share: Math.round(share * 1e6) / 1e6,
      root_kg: r3(Number(b.qty_in) * share), sold: 0, waste: 0, adjusted: 0, processed: 0, in_stock: r3(Number(b.qty_remaining) * share), revenue: 0, children: [], processes: [] };
    T.in_stock += Number(b.qty_remaining) * share;
    if (path.has(b.id) || depth > 8) return node; // guard against loops
    const p2 = new Set(path).add(b.id);
    const moves = await db.query('SELECT * FROM batch_moves WHERE batch_id = ? AND qty < 0 ORDER BY id', [b.id]);
    const byRef = new Map();
    for (const m of moves) {
      const q = -Number(m.qty), kg = q * share;
      if (SOLD.has(m.move_type)) {
        const price = await salePrice(cache, m.reference, b.product_id, Number(b.price) / 1.15);
        // revenue attributed to the root batch by weight: sold qty × net price × share of the root in this product
        const attributable = q * price * share;
        node.sold += kg; T.sold += kg;
        node.revenue += attributable; T.revenue += attributable;
        events.push({ when: m.created_at, type: 'sold', reference: m.reference, product: b.product, batch_no: b.batch_no, qty: r3(q), root_kg: r3(kg), value: round2(attributable), depth });
      } else if (m.move_type === 'waste') {
        node.waste += kg; T.waste += kg;
        events.push({ when: m.created_at, type: 'waste', reference: m.reference, product: b.product, batch_no: b.batch_no, qty: r3(q), root_kg: r3(kg), depth });
      } else if (PROCESS.has(m.move_type)) {
        node.processed += kg;
        const x = byRef.get(m.reference) || { reference: m.reference, via: m.move_type, qty: 0, root_kg: 0, when: m.created_at };
        x.qty += q; x.root_kg += kg; byRef.set(m.reference, x);
      } else {
        node.adjusted += kg; T.adjusted += kg;
        events.push({ when: m.created_at, type: 'adjusted', reference: m.reference, product: b.product, batch_no: b.batch_no, qty: r3(q), root_kg: r3(kg), depth });
      }
    }
    // follow each processing step into its outputs
    for (const proc of byRef.values()) {
      const links = await db.query(`SELECT l.*, cb.qty_in child_qty_in FROM batch_links l JOIN stock_batches cb ON cb.id = l.child_batch_id WHERE l.parent_batch_id = ? AND l.reference = ?`, [b.id, proc.reference]);
      const carried = links.reduce((s, l) => s + Number(l.qty), 0);
      const lossKg = Math.max(0, (proc.qty - carried) * share);
      proc.loss_kg = r3(lossKg); T.loss += lossKg;
      if (proc.via === 'breakdown') {
        const bd = await db.one('SELECT id, source_qty, waste_qty FROM breakdowns WHERE number = ?', [proc.reference]);
        if (bd) {
          const wl = await db.query('SELECT name, actual_qty FROM breakdown_lines WHERE breakdown_id = ? AND is_waste = 1', [bd.id]);
          const f = proc.qty / Number(bd.source_qty) * share;
          proc.loss_detail = wl.map(w => ({ name: w.name, kg: r3(Number(w.actual_qty) * f) }));
          const rec = wl.reduce((s, w) => s + Number(w.actual_qty), 0);
          const other = (Number(bd.waste_qty) - rec) * f;
          if (other > 0.0005) proc.loss_detail.push({ name: 'Unrecorded loss (drip, bone dust, trim)', kg: r3(other) });
        }
      } else {
        const run = await db.one('SELECT id, output_qty, input_qty_total FROM production_runs WHERE number = ?', [proc.reference]);
        if (run) proc.run = { output_qty: Number(run.output_qty), input_qty: Number(run.input_qty_total) };
      }
      events.push({ when: proc.when, type: proc.via, reference: proc.reference, product: b.product, batch_no: b.batch_no, qty: r3(proc.qty), root_kg: r3(proc.root_kg), loss_kg: proc.loss_kg, depth });
      for (const l of links) {
        const child = await loadBatch(l.child_batch_id);
        if (!child) continue;
        // root kg carried into the child, spread over the child's own quantity
        const childShare = Number(child.qty_in) > 0 ? Number(l.qty) * share / Number(child.qty_in) : 0;
        const n = await walk(child, childShare, depth + 1, p2);
        n.via = proc.via; n.reference = proc.reference; n.link_qty = r3(l.qty);
        if (seen.has(child.id)) n.repeat = true;
        seen.add(child.id);
        node.children.push(n);
      }
      proc.root_kg = r3(proc.root_kg); proc.qty = r3(proc.qty);
      node.processes.push(proc);
    }
    for (const k of ['sold', 'waste', 'adjusted', 'processed']) node[k] = r3(node[k]);
    node.revenue = round2(node.revenue);
    return node;
  }

  const tree = await walk(root, 1, 0, new Set());
  for (const k of ['sold', 'waste', 'loss', 'adjusted', 'in_stock']) T[k] = r3(T[k]);
  T.revenue = round2(T.revenue);
  const accounted = r3(T.sold + T.waste + T.loss + T.adjusted + T.in_stock);
  return {
    batch: root, qty: Q, uom: root.uom, totals: T, accounted, unaccounted: r3(Q - accounted),
    accounted_pct: Q ? Math.min(100, Math.round(accounted / Q * 1000) / 10) : 0,
    closed_pct: Q ? Math.round((Q - T.in_stock) / Q * 1000) / 10 : 0,
    margin: round2(T.revenue - T.cost), tree, events: events.sort((a, b) => new Date(a.when) - new Date(b.when))
  };
}

/** Where did this batch come from? Ancestor batches with the kg of each contained in this batch. */
async function origins(batchId) {
  const out = [];
  async function up(id, factor, depth) {
    if (depth > 8) return;
    const links = await db.query(`SELECT l.*, pb.batch_no, pb.qty_in, pb.received_date, pb.source, p.name product, p.is_carcass, s.name supplier, c.qty_in child_qty
      FROM batch_links l JOIN stock_batches pb ON pb.id = l.parent_batch_id JOIN products p ON p.id = pb.product_id
      JOIN stock_batches c ON c.id = l.child_batch_id LEFT JOIN partners s ON s.id = pb.supplier_id WHERE l.child_batch_id = ?`, [id]);
    for (const l of links) {
      const f = factor * Number(l.qty) / Number(l.child_qty || 1); // parent kg per unit of the starting batch
      out.push({ batch_id: l.parent_batch_id, batch_no: l.batch_no, product: l.product, is_carcass: l.is_carcass, supplier: l.supplier, received_date: l.received_date,
        via: l.via, reference: l.reference, kg_per_unit: Math.round(f * 1e6) / 1e6, depth });
      await up(l.parent_batch_id, f, depth + 1);
    }
  }
  await up(batchId, 1, 1);
  return out;
}

/** Carcasses (batches of products flagged as carcass, or that have been broken down) with how much is accounted for */
async function carcasses({ status = 'open', limit = 100, species } = {}) {
  const rows = await db.query(`SELECT b.*, p.name product, p.uom, p.species, s.name supplier FROM stock_batches b JOIN products p ON p.id = b.product_id
    LEFT JOIN partners s ON s.id = b.supplier_id
    WHERE (p.is_carcass = 1 OR EXISTS (SELECT 1 FROM batch_links l WHERE l.parent_batch_id = b.id AND l.via = 'breakdown'))
      AND b.source <> 'breakdown' AND b.source <> 'production' ${species ? 'AND p.species = ?' : ''}
    ORDER BY b.received_date DESC, b.id DESC LIMIT ?`, species ? [species, Number(limit) || 100] : [Number(limit) || 100]);
  const out = [];
  for (const r of rows) {
    const L = await ledger(r.id);
    const item = { id: r.id, batch_no: r.batch_no, product: r.product, uom: r.uom, species: r.species, supplier: r.supplier,
      live_weight: r.live_weight == null ? null : Number(r.live_weight), dressing_pct: Number(r.live_weight) > 0 ? Math.round(Number(r.qty_in) / Number(r.live_weight) * 1000) / 10 : null, received_date: r.received_date, qty_in: Number(r.qty_in),
      in_stock: L.totals.in_stock, sold: L.totals.sold, waste: L.totals.waste, loss: L.totals.loss, adjusted: L.totals.adjusted, unaccounted: L.unaccounted,
      closed_pct: L.closed_pct, revenue: L.totals.revenue, cost: L.totals.cost, margin: L.margin, uncut: r3(Number(r.qty_remaining)) };
    if (status === 'open' && item.in_stock < 0.0005) continue;
    if (status === 'closed' && item.in_stock >= 0.0005) continue;
    out.push(item);
  }
  return out;
}

module.exports = { ledger, origins, carcasses };
