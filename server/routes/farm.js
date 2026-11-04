// Farm: herds and flocks (cattle, sheep for wool, goats for mohair, pigs, layers, broilers, dairy), tagged animals with
// births and exits, health treatments with the next vaccination due, feed and other inputs taken from stock, produce
// (eggs, milk, wool, mohair, harvested crops) put into stock, fields and crop seasons, and cost / income per flock or field.
//
// Books: inputs used  Dr 5400 Farm inputs used / Cr 1200 Stock (at cost)
//        produce in   Dr 1200 Stock / Cr 5400 (at the produce's cost price – it moves cost from the season into stock)
//        animal sold  invoice to the buyer on 4910 Farm sales
const express = require('express');
const db = require('../db');
const stock = require('../services/stock');
const accounting = require('../services/accounting');
const { requirePerm } = require('../auth');
const { ah, bad, notFound, round2, today } = require('../util');

const r = express.Router();
const FM = requirePerm('farm');
const s = (x, n) => x === undefined || x === null || String(x).trim() === '' ? null : String(x).trim().slice(0, n);
const d10 = x => x ? String(x).slice(0, 10) : null;
const INPUT_KINDS = ['feed', 'vaccinate', 'treat', 'plant', 'fertilise', 'spray', 'other'];
const KINDS = ['feed', 'vaccinate', 'treat', 'weigh', 'production', 'plant', 'fertilise', 'spray', 'harvest', 'labour', 'expense', 'birth', 'death', 'sale', 'other'];

/* ---------- herds & flocks ---------- */
const GSQL = `SELECT g.*, p.name produce_name, p.uom produce_uom,
    (SELECT COUNT(*) FROM farm_animals a WHERE a.group_id = g.id AND a.status = 'alive') tagged,
    (SELECT COALESCE(SUM(cost), 0) FROM farm_logs l WHERE l.group_id = g.id AND l.log_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)) cost_30,
    (SELECT COALESCE(SUM(produced_qty), 0) FROM farm_logs l WHERE l.group_id = g.id AND l.kind = 'production' AND l.log_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)) produced_30,
    (SELECT COALESCE(SUM(produced_qty), 0) FROM farm_logs l WHERE l.group_id = g.id AND l.kind = 'production' AND l.log_date = CURDATE()) produced_today
  FROM farm_groups g LEFT JOIN products p ON p.id = g.produce_id`;
const headCount = g => Number(g.tagged) > 0 ? Number(g.tagged) : Number(g.head_count || 0);
r.get('/farm/groups', FM, ah(async (req, res) => {
  const rows = await db.query(`${GSQL} ${req.query.all ? '' : 'WHERE g.active = 1'} ORDER BY g.kind, g.name`);
  rows.forEach(g => { g.heads = headCount(g); g.cost_30 = round2(g.cost_30); g.produced_30 = Number(g.produced_30); g.produced_today = Number(g.produced_today); });
  res.json(rows);
}));
function cleanGroup(b) {
  const v = { name: s(b.name, 80) };
  if (!v.name) throw bad('Name the herd or flock, e.g. "Layers house 1", "Merino flock", "Dairy cows"');
  v.kind = ['livestock', 'poultry', 'other'].includes(b.kind) ? b.kind : 'livestock';
  v.species = s(b.species, 40); v.purpose = s(b.purpose, 40); v.place = s(b.place, 120); v.notes = s(b.notes, 255);
  v.head_count = b.head_count === '' || b.head_count == null ? null : Math.max(0, Math.round(Number(b.head_count)));
  v.started_on = d10(b.started_on); v.produce_id = Number(b.produce_id) || null;
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  return v;
}
r.post('/farm/groups', FM, ah(async (req, res) => res.json({ id: (await db.query('INSERT INTO farm_groups SET ?', [cleanGroup(req.body)])).insertId })));
r.put('/farm/groups/:id(\\d+)', FM, ah(async (req, res) => {
  const g = await db.one('SELECT * FROM farm_groups WHERE id = ?', [req.params.id]); if (!g) throw notFound();
  await db.query('UPDATE farm_groups SET ? WHERE id = ?', [cleanGroup({ ...g, ...req.body }), g.id]); res.json({ id: g.id });
}));
r.get('/farm/groups/:id(\\d+)', FM, ah(async (req, res) => {
  const g = await db.one(`${GSQL} WHERE g.id = ?`, [req.params.id]); if (!g) throw notFound();
  g.heads = headCount(g);
  g.animals = await db.query(`SELECT * FROM farm_animals WHERE group_id = ? AND status = 'alive' ORDER BY tag`, [g.id]);
  g.logs = await logs({ group_id: g.id });
  g.daily = await db.query(`SELECT log_date, SUM(produced_qty) qty FROM farm_logs WHERE group_id = ? AND kind = 'production' AND log_date >= DATE_SUB(CURDATE(), INTERVAL 13 DAY) GROUP BY log_date ORDER BY log_date`, [g.id]);
  res.json(g);
}));

/* ---------- animals ---------- */
const ASQL = `SELECT a.*, g.name group_name, m.tag mother_tag, TIMESTAMPDIFF(MONTH, a.birth_date, CURDATE()) age_months FROM farm_animals a LEFT JOIN farm_groups g ON g.id = a.group_id LEFT JOIN farm_animals m ON m.id = a.mother_id`;
r.get('/farm/animals', FM, ah(async (req, res) => {
  const cond = [], args = [];
  if (req.query.status !== 'all') { cond.push('a.status = ?'); args.push(req.query.status || 'alive'); }
  for (const k of ['group_id', 'species']) if (req.query[k]) { cond.push(`a.${k} = ?`); args.push(req.query[k]); }
  if (req.query.q) { cond.push('(a.tag LIKE ? OR a.name LIKE ? OR a.breed LIKE ?)'); args.push(...Array(3).fill(`%${req.query.q}%`)); }
  res.json(await db.query(`${ASQL} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY a.species, a.tag LIMIT 3000`, args));
}));
async function cleanAnimal(b, id) {
  const v = { tag: s(b.tag, 40) };
  if (!v.tag) throw bad('Enter the ear tag or brand number');
  if (await db.one('SELECT id FROM farm_animals WHERE tag = ? AND id <> ?', [v.tag, id || 0])) throw bad(`Tag ${v.tag} is already used`);
  v.species = s(b.species, 40); if (!v.species) throw bad('Enter the species, e.g. cattle, sheep, goat, pig');
  v.name = s(b.name, 60); v.breed = s(b.breed, 60); v.sex = ['F', 'M'].includes(b.sex) ? b.sex : null; v.birth_date = d10(b.birth_date);
  v.group_id = Number(b.group_id) || null; v.mother_id = Number(b.mother_id) || null;
  v.acquired = ['born', 'bought', 'other'].includes(b.acquired) ? b.acquired : 'bought'; v.cost = round2(Math.max(0, Number(b.cost) || 0));
  v.weight = b.weight === '' || b.weight == null ? null : round2(b.weight); v.notes = s(b.notes, 255);
  return v;
}
r.post('/farm/animals', FM, ah(async (req, res) => {
  const ins = await db.query('INSERT INTO farm_animals SET ?', [await cleanAnimal(req.body)]);
  res.json(await db.one(`${ASQL} WHERE a.id = ?`, [ins.insertId]));
}));
r.put('/farm/animals/:id(\\d+)', FM, ah(async (req, res) => {
  const a = await db.one('SELECT * FROM farm_animals WHERE id = ?', [req.params.id]); if (!a) throw notFound();
  await db.query('UPDATE farm_animals SET ? WHERE id = ?', [await cleanAnimal({ ...a, ...req.body }, a.id), a.id]);
  res.json(await db.one(`${ASQL} WHERE a.id = ?`, [a.id]));
}));
r.get('/farm/animals/:id(\\d+)', FM, ah(async (req, res) => {
  const a = await db.one(`${ASQL} WHERE a.id = ?`, [req.params.id]); if (!a) throw notFound();
  a.logs = await logs({ animal_id: a.id });
  a.offspring = await db.query('SELECT id, tag, sex, birth_date, status FROM farm_animals WHERE mother_id = ? ORDER BY birth_date DESC', [a.id]);
  res.json(a);
}));
// births: one or more young registered under the mother (lambing, kidding, calving, farrowing)
r.post('/farm/animals/:id(\\d+)/birth', FM, ah(async (req, res) => {
  const m = await db.one('SELECT * FROM farm_animals WHERE id = ?', [req.params.id]); if (!m) throw notFound();
  if (m.sex === 'M') throw bad('A male cannot give birth – choose the mother');
  const young = (req.body.young || []).filter(y => s(y.tag, 40));
  if (!young.length) throw bad('Enter a tag for each young animal');
  const date = d10(req.body.date) || today();
  const ids = await db.tx(async c => {
    const out = [];
    for (const y of young) {
      if (await c.one('SELECT id FROM farm_animals WHERE tag = ?', [s(y.tag, 40)])) throw bad(`Tag ${y.tag} is already used`);
      out.push((await c.query('INSERT INTO farm_animals SET ?', [{ tag: s(y.tag, 40), species: m.species, breed: m.breed, sex: ['F', 'M'].includes(y.sex) ? y.sex : null, birth_date: date, group_id: m.group_id, mother_id: m.id, acquired: 'born', weight: y.weight ? round2(y.weight) : null }])).insertId);
    }
    await c.query('INSERT INTO farm_logs (log_date, kind, group_id, animal_id, qty, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [date, 'birth', m.group_id, m.id, out.length, s(req.body.note, 255) || `${out.length} born`, req.user.id]);
    return out;
  });
  res.json({ ids });
}));
// animal leaves: sold (invoiced to the buyer), died or slaughtered for own use / the butchery
r.post('/farm/animals/:id(\\d+)/exit', FM, ah(async (req, res) => {
  const biz = require('./business');
  const out = await db.tx(async c => {
    const a = await c.one('SELECT * FROM farm_animals WHERE id = ? FOR UPDATE', [req.params.id]); if (!a) throw notFound();
    if (a.status !== 'alive') throw bad(`${a.tag} is already ${a.status}`);
    const kind = ['sold', 'died', 'slaughtered'].includes(req.body.kind) ? req.body.kind : null; if (!kind) throw bad('Sold, died or slaughtered?');
    const date = d10(req.body.date) || today(); let invoice_id = null;
    if (kind === 'sold') {
      const amt = round2(req.body.amount); if (!(amt > 0)) throw bad('Enter the selling price');
      const pid = Number(req.body.partner_id) || null; if (!pid) throw bad('Choose the buyer');
      const vat = Number(req.body.tax_rate || 0);
      invoice_id = await biz.createInvoice(c, req.user, { kind: 'customer_invoice', partner_id: pid, invoice_date: date, due_date: d10(req.body.due_date) || date, notes: `Animal ${a.tag} (${a.species})`,
        lines: biz.calcLines([{ description: `${a.species} ${a.breed || ''} – tag ${a.tag}${req.body.weight ? `, ${req.body.weight} kg` : ''}`.replace(/\s+/g, ' '), qty: 1, unit_price: Math.round(amt / (1 + vat / 100) * 10000) / 10000, gross_total: amt, tax_rate: vat, account_code: '4910' }], 'unit_price') });
      await biz.postInvoice(c, invoice_id, req.user);
    }
    await c.query('UPDATE farm_animals SET status = ?, exit_date = ?, exit_note = ?, weight = COALESCE(?, weight) WHERE id = ?', [kind, date, s(req.body.note, 160), req.body.weight ? round2(req.body.weight) : null, a.id]);
    await c.query('INSERT INTO farm_logs (log_date, kind, group_id, animal_id, value, weight, invoice_id, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [date, kind === 'sold' ? 'sale' : kind === 'died' ? 'death' : 'other', a.group_id, a.id, kind === 'sold' ? round2(req.body.amount) : 0, req.body.weight ? round2(req.body.weight) : null, invoice_id, s(req.body.note, 255) || kind, req.user.id]);
    return { invoice_id };
  });
  res.json(out);
}));

/* ---------- fields & crop seasons ---------- */
r.get('/farm/fields', FM, ah(async (req, res) => {
  const fs = await db.query(`SELECT f.*, (SELECT CONCAT(x.crop, ' (', x.status, ')') FROM farm_seasons x WHERE x.field_id = f.id ORDER BY x.id DESC LIMIT 1) current FROM farm_fields f ${req.query.all ? '' : 'WHERE f.active = 1'} ORDER BY f.name`);
  res.json(fs);
}));
function cleanField(b) {
  const v = { name: s(b.name, 80) }; if (!v.name) throw bad('Name the field, e.g. "Lower field by the river"');
  v.size_ha = b.size_ha === '' || b.size_ha == null ? null : round2(b.size_ha); v.place = s(b.place, 120); v.irrigated = b.irrigated ? 1 : 0; v.notes = s(b.notes, 255);
  if (b.active !== undefined) v.active = b.active ? 1 : 0; return v;
}
r.post('/farm/fields', FM, ah(async (req, res) => res.json({ id: (await db.query('INSERT INTO farm_fields SET ?', [cleanField(req.body)])).insertId })));
r.put('/farm/fields/:id(\\d+)', FM, ah(async (req, res) => {
  const f = await db.one('SELECT * FROM farm_fields WHERE id = ?', [req.params.id]); if (!f) throw notFound();
  await db.query('UPDATE farm_fields SET ? WHERE id = ?', [cleanField({ ...f, ...req.body }), f.id]); res.json({ id: f.id });
}));
const SSQL = `SELECT x.*, f.name field_name, f.size_ha field_ha, p.name produce_name, p.uom produce_uom,
    (SELECT COALESCE(SUM(cost), 0) FROM farm_logs l WHERE l.season_id = x.id) cost,
    (SELECT COALESCE(SUM(produced_qty), 0) FROM farm_logs l WHERE l.season_id = x.id AND l.kind = 'harvest') harvested,
    (SELECT COALESCE(SUM(value), 0) FROM farm_logs l WHERE l.season_id = x.id AND l.kind = 'harvest') harvest_value
  FROM farm_seasons x JOIN farm_fields f ON f.id = x.field_id LEFT JOIN products p ON p.id = x.produce_id`;
r.get('/farm/seasons', FM, ah(async (req, res) => {
  const rows = await db.query(`${SSQL} ${req.query.all ? '' : `WHERE x.status IN ('planned','growing') OR x.planted_on >= DATE_SUB(CURDATE(), INTERVAL 18 MONTH)`} ORDER BY FIELD(x.status, 'growing', 'planned', 'harvested', 'failed'), x.planted_on DESC`);
  rows.forEach(x => { x.cost = round2(x.cost); x.harvested = Number(x.harvested); x.harvest_value = round2(x.harvest_value); const ha = Number(x.area_ha || x.field_ha) || 0; x.yield_per_ha = ha && x.harvested ? round2(x.harvested / ha) : null; });
  res.json(rows);
}));
function cleanSeason(b) {
  const v = { field_id: Number(b.field_id) || null }; if (!v.field_id) throw bad('Choose the field');
  v.crop = s(b.crop, 60); if (!v.crop) throw bad('Enter the crop, e.g. maize, beans, wheat, potatoes');
  v.variety = s(b.variety, 60); v.area_ha = b.area_ha === '' || b.area_ha == null ? null : round2(b.area_ha); v.planted_on = d10(b.planted_on); v.expected_harvest = d10(b.expected_harvest);
  v.produce_id = Number(b.produce_id) || null; v.status = ['planned', 'growing', 'harvested', 'failed'].includes(b.status) ? b.status : (v.planted_on ? 'growing' : 'planned'); v.notes = s(b.notes, 255);
  return v;
}
r.post('/farm/seasons', FM, ah(async (req, res) => res.json({ id: (await db.query('INSERT INTO farm_seasons SET ?', [cleanSeason(req.body)])).insertId })));
r.put('/farm/seasons/:id(\\d+)', FM, ah(async (req, res) => {
  const x = await db.one('SELECT * FROM farm_seasons WHERE id = ?', [req.params.id]); if (!x) throw notFound();
  await db.query('UPDATE farm_seasons SET ? WHERE id = ?', [cleanSeason({ ...x, ...req.body }), x.id]); res.json({ id: x.id });
}));
r.get('/farm/seasons/:id(\\d+)', FM, ah(async (req, res) => {
  const x = await db.one(`${SSQL} WHERE x.id = ?`, [req.params.id]); if (!x) throw notFound();
  x.logs = await logs({ season_id: x.id }); res.json(x);
}));

/* ---------- the farm diary ---------- */
async function logs(where) {
  const cond = [], args = [];
  for (const [k, v] of Object.entries(where)) if (v) { cond.push(`l.${k} = ?`); args.push(v); }
  return db.query(`SELECT l.*, p.name product_name, p.uom, g.name group_name, a.tag animal_tag, CONCAT(x.crop, ' – ', f.name) season_name, u.name user_name
    FROM farm_logs l LEFT JOIN products p ON p.id = l.product_id LEFT JOIN farm_groups g ON g.id = l.group_id LEFT JOIN farm_animals a ON a.id = l.animal_id
    LEFT JOIN farm_seasons x ON x.id = l.season_id LEFT JOIN farm_fields f ON f.id = x.field_id LEFT JOIN users u ON u.id = l.user_id
    ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY l.log_date DESC, l.id DESC LIMIT 500`, args);
}
r.get('/farm/logs', FM, ah(async (req, res) => {
  const w = {}; for (const k of ['group_id', 'season_id', 'animal_id', 'kind']) if (req.query[k]) w[k] = req.query[k];
  res.json(await logs(w));
}));
/**
 * One diary entry. Inputs (feed, vaccine, medicine, seed, fertiliser, spray) come out of stock at cost; production and
 * harvest go into stock at the produce's cost price; labour / other expenses are only recorded against the flock or field.
 */
r.post('/farm/logs', FM, ah(async (req, res) => {
  const b = req.body;
  const id = await db.tx(async c => {
    const kind = KINDS.includes(b.kind) ? b.kind : null; if (!kind) throw bad('What was done?');
    const date = d10(b.date) || today(); if (date > today()) throw bad('The date cannot be in the future');
    const group_id = Number(b.group_id) || null, animal_id = Number(b.animal_id) || null, season_id = Number(b.season_id) || null;
    if (!group_id && !animal_id && !season_id) throw bad('Choose the herd / flock, animal or crop');
    let gid = group_id; if (animal_id && !gid) gid = ((await c.one('SELECT group_id FROM farm_animals WHERE id = ?', [animal_id])) || {}).group_id || null;
    const v = { log_date: date, kind, group_id: gid, animal_id, season_id, note: s(b.note, 255), user_id: req.user.id, next_due: d10(b.next_due), product_id: Number(b.product_id) || null };
    const ref = `FARM ${date}`;
    if (INPUT_KINDS.includes(kind) && v.product_id) {
      const qty = Number(b.qty); if (!(qty > 0)) throw bad('Enter how much was used');
      const p = await c.one('SELECT * FROM products WHERE id = ?', [v.product_id]); if (!p) throw bad('Unknown product');
      if (p.type === 'stock' && Number(p.stock_qty) < qty - 0.0001 && !b.allow_negative) throw bad(`Only ${Number(p.stock_qty)} ${p.uom} ${p.name} in stock – receive the purchase first`);
      const unit = await stock.move(c, { product_id: p.id, qty: -qty, move_type: 'adjustment', reference: ref, reason: `Farm ${kind}`, user_id: req.user.id, location_id: b.location_id || undefined });
      v.qty = qty; v.cost = round2(qty * Number(unit || p.cost));
      if (v.cost && p.type === 'stock') await accounting.post(c, { date, reference: ref, memo: `Farm ${kind}: ${qty} ${p.uom} ${p.name}`, source_type: 'farm', user_id: req.user.id,
        lines: [{ code: '5400', debit: v.cost }, { code: '1200', credit: v.cost }] });
    } else if (['labour', 'expense'].includes(kind) || (INPUT_KINDS.includes(kind) && !v.product_id)) {
      v.cost = round2(Math.max(0, Number(b.cost) || 0)); // paid elsewhere (wages, contractor) – recorded here for the cost per flock / field
    }
    if (['production', 'harvest'].includes(kind)) {
      const qty = Number(b.produced_qty ?? b.qty); if (!(qty > 0)) throw bad('Enter how much was produced');
      v.produced_qty = qty;
      let pid = v.product_id;
      if (!pid && season_id) pid = ((await c.one('SELECT produce_id FROM farm_seasons WHERE id = ?', [season_id])) || {}).produce_id;
      if (!pid && gid) pid = ((await c.one('SELECT produce_id FROM farm_groups WHERE id = ?', [gid])) || {}).produce_id;
      if (pid) {
        const p = await c.one('SELECT * FROM products WHERE id = ?', [pid]);
        if (p && p.type === 'stock') {
          const uc = b.unit_cost !== undefined && b.unit_cost !== '' ? Number(b.unit_cost) : Number(p.cost);
          await stock.move(c, { product_id: p.id, qty, unit_cost: uc, move_type: 'adjustment', reference: ref, reason: `Farm ${kind}`, user_id: req.user.id, location_id: b.location_id || undefined, batch: b.batch_no || b.expiry_date ? { batch_no: b.batch_no || null, expiry_date: b.expiry_date || null } : undefined });
          v.value = round2(qty * uc);
          if (v.value) await accounting.post(c, { date, reference: ref, memo: `Farm ${kind}: ${qty} ${p.uom} ${p.name}`, source_type: 'farm', user_id: req.user.id, lines: [{ code: '1200', debit: v.value }, { code: '5400', credit: v.value }] });
        }
        v.product_id = pid;
      }
      if (kind === 'harvest' && season_id && b.final) await c.query(`UPDATE farm_seasons SET status = 'harvested' WHERE id = ?`, [season_id]);
    }
    if (kind === 'weigh') {
      v.weight = round2(b.weight); if (!(v.weight > 0)) throw bad('Enter the weight in kg');
      if (animal_id) await c.query('UPDATE farm_animals SET weight = ? WHERE id = ?', [v.weight, animal_id]);
    }
    if (kind === 'plant' && season_id) await c.query(`UPDATE farm_seasons SET status = 'growing', planted_on = COALESCE(planted_on, ?) WHERE id = ?`, [date, season_id]);
    if (kind === 'death' && gid && !animal_id) { const n = Math.max(1, Math.round(Number(b.qty) || 1)); v.qty = n; await c.query('UPDATE farm_groups SET head_count = GREATEST(0, COALESCE(head_count, 0) - ?) WHERE id = ?', [n, gid]); }
    return (await c.query('INSERT INTO farm_logs SET ?', [v])).insertId;
  });
  res.json({ id });
}));

/* ---------- what needs doing & the figures ---------- */
r.get('/farm/due', FM, ah(async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 14));
  // the latest treatment of each kind / product per flock or animal, when its next dose is due
  res.json(await db.query(`SELECT l.*, p.name product_name, g.name group_name, a.tag animal_tag, DATEDIFF(l.next_due, CURDATE()) in_days FROM farm_logs l
      LEFT JOIN products p ON p.id = l.product_id LEFT JOIN farm_groups g ON g.id = l.group_id LEFT JOIN farm_animals a ON a.id = l.animal_id
    WHERE l.next_due IS NOT NULL AND l.next_due <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
      AND NOT EXISTS (SELECT 1 FROM farm_logs n WHERE n.id > l.id AND n.kind = l.kind AND n.product_id <=> l.product_id AND n.group_id <=> l.group_id AND n.animal_id <=> l.animal_id)
    ORDER BY l.next_due`, [days]));
}));
r.get('/farm/report', FM, ah(async (req, res) => {
  const to = d10(req.query.to) || today(); const from = d10(req.query.from) || `${to.slice(0, 4)}-01-01`;
  const groups = await db.query(`SELECT g.id, g.name, g.species, g.purpose,
      COALESCE(SUM(CASE WHEN l.kind NOT IN ('production','harvest','sale') THEN l.cost END), 0) costs,
      COALESCE(SUM(CASE WHEN l.kind = 'production' THEN l.value END), 0) produce_value, COALESCE(SUM(CASE WHEN l.kind = 'production' THEN l.produced_qty END), 0) produced,
      COALESCE(SUM(CASE WHEN l.kind = 'sale' THEN l.value END), 0) animal_sales, SUM(l.kind = 'birth') births_logged, COALESCE(SUM(CASE WHEN l.kind = 'birth' THEN l.qty END), 0) born,
      COALESCE(SUM(CASE WHEN l.kind = 'death' THEN COALESCE(l.qty, 1) END), 0) deaths
    FROM farm_groups g LEFT JOIN farm_logs l ON l.group_id = g.id AND l.log_date BETWEEN ? AND ? GROUP BY g.id ORDER BY g.name`, [from, to]);
  groups.forEach(g => { for (const k of ['costs', 'produce_value', 'animal_sales']) g[k] = round2(g[k]); g.produced = Number(g.produced); g.born = Number(g.born); g.deaths = Number(g.deaths || 0); g.result = round2(g.produce_value + g.animal_sales - g.costs); });
  const seasons = await db.query(`SELECT x.id, x.crop, f.name field_name, COALESCE(x.area_ha, f.size_ha) ha, x.status,
      COALESCE(SUM(CASE WHEN l.kind <> 'harvest' THEN l.cost END), 0) costs, COALESCE(SUM(CASE WHEN l.kind = 'harvest' THEN l.produced_qty END), 0) harvested, COALESCE(SUM(CASE WHEN l.kind = 'harvest' THEN l.value END), 0) harvest_value
    FROM farm_seasons x JOIN farm_fields f ON f.id = x.field_id LEFT JOIN farm_logs l ON l.season_id = x.id AND l.log_date BETWEEN ? AND ? GROUP BY x.id ORDER BY x.planted_on DESC`, [from, to]);
  seasons.forEach(x => { x.costs = round2(x.costs); x.harvested = Number(x.harvested); x.harvest_value = round2(x.harvest_value); x.result = round2(x.harvest_value - x.costs); x.cost_per_ha = Number(x.ha) ? round2(x.costs / Number(x.ha)) : null; });
  const herd = await db.query(`SELECT species, SUM(status = 'alive') alive, SUM(status = 'alive' AND sex = 'F') females, SUM(status = 'alive' AND sex = 'M') males,
      SUM(status = 'sold' AND exit_date BETWEEN ? AND ?) sold, SUM(status = 'died' AND exit_date BETWEEN ? AND ?) died, SUM(acquired = 'born' AND birth_date BETWEEN ? AND ?) born
    FROM farm_animals GROUP BY species ORDER BY species`, [from, to, from, to, from, to]);
  res.json({ from, to, groups, seasons, herd: herd.map(h => Object.fromEntries(Object.entries(h).map(([k, v]) => [k, k === 'species' ? v : Number(v || 0)]))) });
}));

module.exports = r;
