// Butchery: carcass breakdown (yield & cost allocation), waste with reasons, batches/expiry, scale settings.
const db = require('../db');
const stock = require('./stock');
const accounting = require('./accounting');
const { round2, bad, notFound, HttpError, pad } = require('../util');

const DEFAULTS = {
  enabled: false,
  // scale (read through Web Serial in the desktop app / Chrome)
  scale_enabled: false, baud_rate: 9600, data_bits: 8, parity: 'none', stop_bits: 1, request_cmd: '', auto_read: true,
  // price/weight-embedded EAN-13 labels: prefix + item code + value + check digit
  barcode_prefixes: '20,21,22,23,24,25,26,27,28,29', barcode_item_digits: 5, barcode_value_type: 'price', barcode_value_digits: 5,
  // labels
  label_width_mm: 60, label_height_mm: 40, label_barcode_prefix: '21',
  waste_reasons: ['Trimming', 'Spoilage', 'Drip loss', 'Expired', 'Damaged', 'Theft / unknown', 'Staff meal', 'Other'],
  expiry_warning_days: 2
};

async function settings() { return { ...DEFAULTS, ...((await db.getSetting('butchery', {})) || {}) }; }
async function requireEnabled() {
  const s = await settings();
  if (!s.enabled) throw new HttpError(403, 'Butchery mode is turned off. Turn it on in Butchery → Settings.');
  return s;
}

const r3 = n => Math.round(Number(n) * 1000) / 1000;

// ------------------------------------------------------------ carcass breakdown
async function createBreakdown(user, b) {
  const qty = r3(b.source_qty);
  if (!(qty > 0)) throw bad('Enter the weight of the carcass / primal being cut');
  const lines = (b.lines || []).map(l => ({ ...l, actual_qty: r3(l.actual_qty || 0), expected_qty: r3(l.expected_qty || 0), is_waste: l.is_waste ? 1 : 0 }))
    .filter(l => l.actual_qty > 0 || l.expected_qty > 0);
  const outputs = lines.filter(l => !l.is_waste && l.product_id && l.actual_qty > 0);
  if (!outputs.length) throw bad('Enter the weight of at least one cut');
  const outQty = r3(lines.filter(l => !l.is_waste).reduce((s, l) => s + l.actual_qty, 0));
  const recordedWaste = r3(lines.filter(l => l.is_waste).reduce((s, l) => s + l.actual_qty, 0));
  if (outQty + recordedWaste > qty + 0.001) throw bad(`Cuts and waste (${r3(outQty + recordedWaste)} kg) weigh more than the input (${qty} kg)`);
  const date = b.breakdown_date || stock.todayStr();

  return db.tx(async c => {
    const src = await c.one('SELECT * FROM products WHERE id = ? FOR UPDATE', [b.source_product_id]);
    if (!src) throw notFound('Source product');
    if (src.type === 'stock' && Number(src.stock_qty) + 0.0005 < qty && !b.allow_negative)
      throw bad(`Only ${Number(src.stock_qty)} ${src.uom} of ${src.name} in stock. Receive it first (Purchasing) or tick "allow negative stock".`);
    const ins = await c.query(`INSERT INTO breakdowns (template_id, source_product_id, source_batch_id, source_qty, breakdown_date, notes, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [b.template_id || null, src.id, b.source_batch_id || null, qty, date, b.notes || null, user.id]);
    const id = ins.insertId;
    const number = `BRK/${date.slice(0, 4)}/${pad(id, 5)}`;
    await c.query('UPDATE breakdowns SET number = ? WHERE id = ?', [number, id]);
    const srcOut = {};
    const unitCost = await stock.move(c, { product_id: src.id, qty: -qty, move_type: 'breakdown', reference: number, user_id: user.id, batch_id: b.source_batch_id, out: srcOut });
    const srcUsed = srcOut.used || [];
    const totalCost = round2(qty * unitCost);

    // relative sales value (ex VAT) decides how the carcass cost is shared between cuts
    for (const l of outputs) {
      const p = await c.one('SELECT p.*, t.rate tax_rate, t.price_includes_tax FROM products p LEFT JOIN taxes t ON t.id = p.tax_id WHERE p.id = ?', [l.product_id]);
      if (!p) throw bad(`Cut product ${l.product_id} not found`);
      l.product = p;
      const exVat = Number(p.price_includes_tax ?? 1) ? Number(p.price) / (1 + Number(p.tax_rate || 0) / 100) : Number(p.price);
      l.sale_value = round2(l.actual_qty * exVat);
    }
    const sv = outputs.reduce((s, l) => s + l.sale_value, 0);
    // a cut without a selling price would get no cost at all – then share the cost by weight instead
    const unpriced = outputs.filter(l => !(l.sale_value > 0)).map(l => l.product.name);
    const byWeight = unpriced.length > 0;
    let allocated = 0;
    outputs.forEach((l, i) => {
      const share = byWeight ? l.actual_qty / outQty : l.sale_value / sv;
      l.cost_total = i === outputs.length - 1 ? round2(totalCost - allocated) : round2(totalCost * share);
      allocated = round2(allocated + l.cost_total);
      l.unit_cost = l.actual_qty ? l.cost_total / l.actual_qty : 0;
    });
    const srcBatchNos = srcUsed.length ? (await c.query('SELECT batch_no FROM stock_batches WHERE id IN (?)', [srcUsed.map(u => u.batch_id)])).map(x => x.batch_no).join(', ') : '';
    for (const l of outputs) {
      const o = {};
      await stock.move(c, { product_id: l.product_id, qty: l.actual_qty, unit_cost: l.unit_cost, move_type: 'breakdown', reference: number, user_id: user.id, out: o,
        batch: { source: 'breakdown', received_date: date, notes: `From ${src.name} ${number}${srcBatchNos ? ' (' + srcBatchNos + ')' : ''}`.slice(0, 255) } });
      l.batch_id = o.batch_id || null;
      // lineage: each cut carries its share of every source batch (bone/fat loss stays with the breakdown)
      if (l.batch_id) for (const u of srcUsed) {
        await c.query('INSERT INTO batch_links (child_batch_id, parent_batch_id, qty, via, reference) VALUES (?, ?, ?, ?, ?)',
          [l.batch_id, u.batch_id, r3(u.qty * l.actual_qty / qty), 'breakdown', number]);
      }
    }
    // cuts inherit the animal type of the carcass they came from
    if (src.species) await c.query('UPDATE products SET species = ? WHERE id IN (?) AND species IS NULL', [src.species, outputs.map(l => l.product_id)]);
    const wasteQty = r3(qty - outQty);
    for (const l of lines) {
      await c.query(`INSERT INTO breakdown_lines (breakdown_id, product_id, name, is_waste, expected_qty, actual_qty, unit_cost, cost_total, sale_value, batch_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, l.product_id || null, l.name || (l.product && l.product.name) || 'Cut', l.is_waste, l.expected_qty, l.actual_qty, l.unit_cost || 0, l.cost_total || 0, l.sale_value || 0, l.batch_id || null]);
    }
    // product cost of a whole carcass ends up in the cuts: inventory → inventory, so no ledger entry is needed
    await c.query('UPDATE breakdowns SET source_cost_total = ?, output_qty_total = ?, waste_qty = ?, sale_value_total = ? WHERE id = ?',
      [totalCost, outQty, wasteQty, round2(sv), id]);
    return { id, number, cost_split: byWeight ? 'weight' : 'value', ...(byWeight ? { warning: `No selling price on ${unpriced.join(', ')} – cost was shared by weight. Set prices to share it by value.` } : {}) };
  });
}

async function getBreakdown(id) {
  const b = await db.one(`SELECT b.*, p.name source_name, p.uom, t.name template_name, u.name user_name, sb.batch_no source_batch_no
    FROM breakdowns b JOIN products p ON p.id = b.source_product_id LEFT JOIN cut_templates t ON t.id = b.template_id
    LEFT JOIN users u ON u.id = b.user_id LEFT JOIN stock_batches sb ON sb.id = b.source_batch_id WHERE b.id = ?`, [id]);
  if (!b) throw notFound('Breakdown');
  b.lines = await db.query(`SELECT l.*, sb.batch_no, sb.expiry_date FROM breakdown_lines l LEFT JOIN stock_batches sb ON sb.id = l.batch_id WHERE breakdown_id = ? ORDER BY is_waste, id`, [id]);
  return b;
}

// ------------------------------------------------------------ waste / shrinkage
async function writeOff(user, { lines, date, reference }) {
  const s = await settings();
  if (!Array.isArray(lines) || !lines.length) throw bad('Nothing to write off');
  return db.tx(async c => {
    const ref = reference || `WASTE ${date || stock.todayStr()}`;
    let value = 0; const done = [];
    for (const l of lines) {
      const q = r3(l.qty);
      if (!(q > 0)) continue;
      const reason = String(l.reason || 'Other').slice(0, 40);
      const p = await c.one('SELECT id, name, cost, type FROM products WHERE id = ?', [l.product_id]);
      if (!p) throw bad('Product not found');
      if (p.type !== 'stock') throw bad(`${p.name} is not a stocked item`);
      const cost = await stock.move(c, { product_id: p.id, qty: -q, move_type: 'waste', reference: ref + (l.note ? ` – ${String(l.note).slice(0, 40)}` : ''), user_id: user.id, reason, batch_id: l.batch_id });
      value += q * cost;
      done.push({ product: p.name, qty: q, reason, value: round2(q * cost) });
    }
    value = round2(value);
    if (value) await accounting.post(c, { date: date || null, reference: ref, memo: `Stock written off (${done.map(d => d.reason).filter((x, i, a) => a.indexOf(x) === i).join(', ')})`,
      source_type: 'waste', user_id: user.id, lines: [{ code: '5150', debit: value }, { code: '1200', credit: value }] });
    return { lines: done, value, reasons: s.waste_reasons };
  });
}

async function wasteReport(from, to) {
  const range = [from + ' 00:00:00', to + ' 23:59:59'];
  const rows = await db.query(
    `SELECT m.id, m.created_at, p.name product, p.uom, -m.qty qty, m.unit_cost, ROUND(-m.qty * m.unit_cost, 2) value, COALESCE(m.reason, 'Other') reason, m.reference, u.name user_name
     FROM stock_moves m JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.user_id
     WHERE m.move_type = 'waste' AND m.created_at BETWEEN ? AND ? ORDER BY m.id DESC`, range);
  const by = k => Object.values(rows.reduce((a, r) => { const x = a[r[k]] || (a[r[k]] = { [k]: r[k], qty: 0, value: 0, count: 0 }); x.qty = r3(x.qty + Number(r.qty)); x.value = round2(x.value + Number(r.value)); x.count++; return a; }, {}))
    .sort((a, b) => b.value - a.value);
  // breakdown bone/fat loss is waste too
  const yieldLoss = await db.one(`SELECT COALESCE(SUM(waste_qty),0) qty, COUNT(*) n FROM breakdowns WHERE breakdown_date BETWEEN ? AND ?`, [from, to]);
  const sales = await db.one(`SELECT COALESCE(SUM(cost_total),0) cogs FROM orders WHERE status IN ('paid','refunded') AND paid_at BETWEEN ? AND ?`, range);
  const total = round2(rows.reduce((s, r) => s + Number(r.value), 0));
  return { from, to, rows, by_reason: by('reason'), by_product: by('product'), total_value: total,
    pct_of_cogs: Number(sales.cogs) ? round2(total / Number(sales.cogs) * 100) : null, breakdown_loss_kg: r3(yieldLoss.qty), breakdowns: yieldLoss.n };
}

// ------------------------------------------------------------ batches & expiry
async function batches({ status = 'open', product_id, days } = {}) {
  const s = await settings();
  const warn = Number(days ?? s.expiry_warning_days);
  const cond = ['b.qty_remaining > 0'], args = [];
  if (status === 'expired') cond.push('b.expiry_date < CURDATE()');
  if (status === 'expiring') { cond.push('b.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)'); args.push(warn); }
  if (status === 'all') cond.shift();
  if (product_id) { cond.push('b.product_id = ?'); args.push(product_id); }
  return db.query(
    `SELECT b.*, p.name product, p.uom, p.price, s.name supplier, DATEDIFF(b.expiry_date, CURDATE()) days_left,
       ROUND(b.qty_remaining * b.unit_cost, 2) value
     FROM stock_batches b JOIN products p ON p.id = b.product_id LEFT JOIN partners s ON s.id = b.supplier_id
     WHERE ${cond.join(' AND ')} ORDER BY b.expiry_date IS NULL, b.expiry_date, b.id LIMIT 1000`, args);
}

async function batchTrace(id) {
  const b = await db.one(`SELECT b.*, p.name product, p.uom, s.name supplier FROM stock_batches b JOIN products p ON p.id = b.product_id LEFT JOIN partners s ON s.id = b.supplier_id WHERE b.id = ?`, [id]);
  if (!b) throw notFound('Batch');
  b.moves = await db.query('SELECT * FROM batch_moves WHERE batch_id = ? ORDER BY id', [id]);
  return b;
}

async function expiryCounts() {
  const s = await settings();
  if (!s.enabled) return null;
  const r = await db.one(`SELECT COALESCE(SUM(expiry_date < CURDATE()),0) expired,
      COALESCE(SUM(expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)),0) expiring
    FROM stock_batches WHERE qty_remaining > 0 AND expiry_date IS NOT NULL`, [Number(s.expiry_warning_days)]);
  return { expired: Number(r.expired), expiring: Number(r.expiring) };
}

module.exports = { DEFAULTS, settings, requireEnabled, createBreakdown, getBreakdown, writeOff, wasteReport, batches, batchTrace, expiryCounts };
