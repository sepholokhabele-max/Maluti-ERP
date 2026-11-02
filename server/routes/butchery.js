const express = require('express');
const db = require('../db');
const B = require('../services/butchery');
const T = require('../services/trace');
const P = require('../services/production');
const SPC = require('../services/species');
const { requirePerm, can } = require('../auth');
const { ah, bad, notFound, pick, today, round2 } = require('../util');

const r = express.Router();

// status/settings for every logged-in user (tills need scale + barcode settings)
r.get('/status', ah(async (req, res) => {
  const s = await B.settings();
  res.json(s.enabled ? s : { enabled: false });
}));
r.get('/species', ah(async (req, res) => res.json(SPC.SPECIES)));
r.get('/settings', requirePerm('inventory'), ah(async (req, res) => res.json(await B.settings())));
r.put('/settings', requirePerm('settings'), ah(async (req, res) => {
  const cur = await B.settings();
  const v = { ...cur, ...pick(req.body, Object.keys(B.DEFAULTS)) };
  for (const k of ['enabled', 'scale_enabled', 'auto_read']) v[k] = !!v[k];
  for (const k of ['baud_rate', 'data_bits', 'stop_bits', 'barcode_item_digits', 'barcode_value_digits', 'label_width_mm', 'label_height_mm', 'expiry_warning_days']) v[k] = Number(v[k]);
  if (typeof v.waste_reasons === 'string') v.waste_reasons = v.waste_reasons.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
  const prefixes = String(v.barcode_prefixes).split(',').map(s => s.trim()).filter(Boolean);
  if (!prefixes.length || prefixes.some(p => !/^\d+$/.test(p) || p.length !== prefixes[0].length)) throw bad('Barcode prefixes must be digits of equal length, e.g. 20,21,22');
  if (prefixes[0].length + v.barcode_item_digits + v.barcode_value_digits + 1 !== 13) throw bad(`Prefix (${prefixes[0].length}) + item code + value + 1 check digit must add up to 13 digits`);
  if (!['price', 'weight'].includes(v.barcode_value_type)) throw bad('Barcode value must be price or weight');
  if (!/^\d+$/.test(String(v.label_barcode_prefix)) || String(v.label_barcode_prefix).length !== prefixes[0].length) throw bad('Label barcode prefix must be one of the scale prefixes');
  await db.setSetting('butchery', v);
  res.json(v);
}));

r.use(ah(async (req, res, next) => { await B.requireEnabled(); next(); }));

// ---------- cutting templates (expected yields) ----------
r.get('/templates', requirePerm('inventory'), ah(async (req, res) => {
  const ts = await db.query(`SELECT t.*, p.name source_name, p.uom FROM cut_templates t JOIN products p ON p.id = t.source_product_id WHERE t.active = 1 ORDER BY t.name`);
  for (const t of ts) t.lines = await db.query(`SELECT l.*, p.name product_name, p.price FROM cut_template_lines l LEFT JOIN products p ON p.id = l.product_id WHERE template_id = ? ORDER BY is_waste, id`, [t.id]);
  res.json(ts);
}));
async function saveTemplateLines(c, id, lines) {
  await c.query('DELETE FROM cut_template_lines WHERE template_id = ?', [id]);
  let total = 0;
  for (const l of lines || []) {
    const pct = Number(l.yield_pct || 0);
    if (!l.name && !l.product_id) continue;
    if (pct < 0) throw bad('Yield % cannot be negative');
    total += pct;
    let name = l.name;
    if (!name && l.product_id) name = (await c.one('SELECT name FROM products WHERE id = ?', [l.product_id]) || {}).name;
    await c.query('INSERT INTO cut_template_lines (template_id, product_id, name, yield_pct, is_waste) VALUES (?, ?, ?, ?, ?)',
      [id, l.is_waste ? (l.product_id || null) : l.product_id, name || 'Cut', pct, l.is_waste ? 1 : 0]);
  }
  if (total > 100.001) throw bad(`Yields add up to ${round2(total)}% – they cannot exceed 100%`);
}
r.post('/templates', requirePerm('inventory'), ah(async (req, res) => {
  const b = req.body;
  if (!b.name || !b.source_product_id) throw bad('Name and source product are required');
  const id = await db.tx(async c => {
    const ins = await c.query('INSERT INTO cut_templates (name, source_product_id, notes) VALUES (?, ?, ?)', [b.name, b.source_product_id, b.notes || null]);
    await saveTemplateLines(c, ins.insertId, b.lines);
    return ins.insertId;
  });
  res.json({ id });
}));
r.put('/templates/:id', requirePerm('inventory'), ah(async (req, res) => {
  const b = req.body;
  await db.tx(async c => {
    await c.query('UPDATE cut_templates SET name = ?, source_product_id = ?, notes = ? WHERE id = ?', [b.name, b.source_product_id, b.notes || null, req.params.id]);
    await saveTemplateLines(c, req.params.id, b.lines);
  });
  res.json({ ok: true });
}));
r.delete('/templates/:id', requirePerm('inventory'), ah(async (req, res) => { await db.query('UPDATE cut_templates SET active = 0 WHERE id = ?', [req.params.id]); res.json({ ok: true }); }));

// ---------- breakdowns ----------
r.get('/breakdowns', requirePerm('inventory'), ah(async (req, res) => {
  res.json(await db.query(`SELECT b.*, p.name source_name, p.uom, u.name user_name,
      ROUND(b.output_qty_total / b.source_qty * 100, 1) yield_pct,
      ROUND(b.sale_value_total - b.source_cost_total, 2) margin
    FROM breakdowns b JOIN products p ON p.id = b.source_product_id LEFT JOIN users u ON u.id = b.user_id ORDER BY b.id DESC LIMIT 300`));
}));
r.get('/breakdowns/:id', requirePerm('inventory'), ah(async (req, res) => res.json(await B.getBreakdown(req.params.id))));
r.post('/breakdowns', requirePerm('inventory'), ah(async (req, res) => res.json(await B.createBreakdown(req.user, req.body))));

// ---------- waste ----------
r.post('/waste', ah(async (req, res) => {
  if (!can(req.user, 'inventory') && !can(req.user, 'pos.void')) throw bad('You do not have permission to write off stock');
  res.json(await B.writeOff(req.user, req.body));
}));
r.get('/waste-report', requirePerm('inventory'), ah(async (req, res) => {
  const from = req.query.from || today(), to = req.query.to || from;
  res.json(await B.wasteReport(from, to));
}));

// ---------- batches ----------
r.get('/batches', ah(async (req, res) => res.json(await B.batches(req.query))));
r.get('/batches/:id', requirePerm('inventory'), ah(async (req, res) => res.json(await B.batchTrace(req.params.id))));
r.put('/batches/:id', requirePerm('inventory'), ah(async (req, res) => {
  const d = pick(req.body, ['batch_no', 'expiry_date', 'notes', 'live_weight']);
  if (d.live_weight === '' || Number(d.live_weight) <= 0) d.live_weight = null;
  if (d.expiry_date === '') d.expiry_date = null;
  await db.query('UPDATE stock_batches SET ? WHERE id = ?', [d, req.params.id]);
  res.json({ ok: true });
}));
r.post('/batches/:id/write-off', requirePerm('inventory'), ah(async (req, res) => {
  const b = await db.one('SELECT * FROM stock_batches WHERE id = ?', [req.params.id]);
  if (!b) throw notFound('Batch');
  if (!(Number(b.qty_remaining) > 0)) throw bad('Nothing left in this batch');
  res.json(await B.writeOff(req.user, { lines: [{ product_id: b.product_id, qty: b.qty_remaining, reason: req.body.reason || 'Expired', batch_id: b.id, note: `batch ${b.batch_no}` }] }));
}));

r.get('/batches/:id/origins', requirePerm('inventory'), ah(async (req, res) => res.json(await T.origins(req.params.id))));

// ---------- carcass traceability: every kg accounted for ----------
r.get('/carcasses', requirePerm('inventory'), ah(async (req, res) => res.json(await T.carcasses(req.query))));
r.get('/trace/:batchId', requirePerm('inventory'), ah(async (req, res) => res.json(await T.ledger(req.params.batchId))));

// ---------- production: recipes & runs (sausage, patties, biltong…) ----------
r.get('/recipes', requirePerm('inventory'), ah(async (req, res) => res.json(await P.recipes())));
r.post('/recipes', requirePerm('inventory'), ah(async (req, res) => res.json({ id: await P.saveRecipe(null, req.body) })));
r.put('/recipes/:id', requirePerm('inventory'), ah(async (req, res) => res.json({ id: await P.saveRecipe(Number(req.params.id), req.body) })));
r.delete('/recipes/:id', requirePerm('inventory'), ah(async (req, res) => { await db.query('UPDATE recipes SET active = 0 WHERE id = ?', [req.params.id]); res.json({ ok: true }); }));
r.get('/production', requirePerm('inventory'), ah(async (req, res) => res.json(await P.runs())));
r.get('/production/:id', requirePerm('inventory'), ah(async (req, res) => res.json(await P.getRun(req.params.id))));
r.post('/production', requirePerm('inventory'), ah(async (req, res) => res.json(await P.createRun(req.user, req.body))));

// ---------- animals: starter templates & report by animal ----------
r.get('/starters', requirePerm('inventory'), ah(async (req, res) => res.json(SPC.starters())));
r.post('/starters', requirePerm('catalog'), ah(async (req, res) => res.json(await SPC.installStarters(req.body.species))));
r.get('/species-report', requirePerm('inventory'), ah(async (req, res) => { const from = req.query.from || today(); res.json(await SPC.report(from, req.query.to || from)); }));

module.exports = r;
