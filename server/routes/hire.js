// Equipment & party hire: hire items (tents, chairs, scaffolding, mixers, generators…) with day / week / month rates,
// hire orders that reserve stock for dates (no over-booking), hand-over with a deposit, part returns with damage and
// losses, the bill worked out on the cheapest rate for the days actually out, deposit set off against the bill.
const express = require('express');
const db = require('../db');
const stock = require('../services/stock');
const accounting = require('../services/accounting');
const receipts = require('../services/receipts');
const { requirePerm } = require('../auth');
const { ah, bad, notFound, round2, pad, today } = require('../util');

const r = express.Router();
const H = requirePerm('hire');
const days = (a, b) => Math.round((new Date(String(b).slice(0, 10) + 'T12:00:00') - new Date(String(a).slice(0, 10) + 'T12:00:00')) / 86400000);
const vatRate = async () => Number(((await db.getSetting('company', {})) || {}).default_vat ?? 15);
const methodOf = async (c, id) => { const m = await c.one('SELECT * FROM payment_methods WHERE id = ?', [id]); if (!m || m.kind === 'account') throw bad('Choose cash, card, mobile money or bank'); return m; };
const d10 = x => x ? String(x).slice(0, 10) : null;
const num = x => x === undefined || x === null || x === '' ? null : round2(x);

/** cheapest price for one unit hired for n days, using the day, week (7 days) and month (30 days) rates – all incl. VAT */
function unitPrice(n, l) {
  const day = Number(l.rate_day) || 0, week = Number(l.rate_week) || 0, month = Number(l.rate_month) || 0;
  const byDay = x => x * day;
  const byWeek = x => week ? Math.min(byDay(x), Math.floor(x / 7) * week + Math.min(byDay(x % 7), week)) : byDay(x);
  const byMonth = x => month ? Math.min(byWeek(x), Math.floor(x / 30) * month + Math.min(byWeek(x % 30), month)) : byWeek(x);
  return round2(byMonth(Math.max(1, n)));
}

/* ---------- hire items ---------- */
async function booked(from, to, excludeOrder, c = db) {
  // quantity of each item promised or out over any part of the period (an overdue hire still holds its items)
  const rows = await c.query(`SELECT l.item_id, SUM(l.qty - l.qty_back) q FROM hire_lines l JOIN hire_orders o ON o.id = l.order_id
    WHERE o.status IN ('reserved','out') AND o.start_date <= ? AND (CASE WHEN o.status = 'out' THEN GREATEST(o.end_date, CURDATE()) ELSE o.end_date END) >= ? AND o.id <> ?
    GROUP BY l.item_id`, [to, from, excludeOrder || 0]);
  return Object.fromEntries(rows.map(x => [x.item_id, Number(x.q)]));
}
r.get('/hire/items', H, ah(async (req, res) => {
  const items = await db.query(`SELECT h.*, (SELECT COALESCE(SUM(l.qty - l.qty_back), 0) FROM hire_lines l JOIN hire_orders o ON o.id = l.order_id WHERE l.item_id = h.id AND o.status = 'out') qty_out
    FROM hire_items h ${req.query.all ? '' : 'WHERE h.active = 1'} ORDER BY h.category, h.name`);
  items.forEach(i => { i.qty_out = Number(i.qty_out); i.qty_in = round2(Number(i.qty_owned) - Number(i.qty_out_of_service) - i.qty_out); });
  res.json(items);
}));
function cleanItem(b) {
  const v = { name: String(b.name || '').trim().slice(0, 120) };
  if (!v.name) throw bad('Name the item, e.g. "Tent 10 × 20 m", "Plastic chair", "Concrete mixer"');
  v.code = b.code ? String(b.code).slice(0, 40) : null; v.category = b.category ? String(b.category).slice(0, 60) : null;
  v.qty_owned = round2(b.qty_owned === undefined || b.qty_owned === '' ? 1 : b.qty_owned); if (v.qty_owned < 0) throw bad('Quantity owned cannot be negative');
  v.rate_day = round2(b.rate_day); if (!(v.rate_day > 0)) throw bad('Enter the price per day (incl. VAT)');
  v.rate_week = Number(b.rate_week) > 0 ? round2(b.rate_week) : null; v.rate_month = Number(b.rate_month) > 0 ? round2(b.rate_month) : null;
  v.deposit = round2(Math.max(0, Number(b.deposit) || 0)); v.replacement_cost = round2(Math.max(0, Number(b.replacement_cost) || 0));
  if (b.qty_out_of_service !== undefined) v.qty_out_of_service = round2(Math.max(0, Number(b.qty_out_of_service) || 0));
  v.notes = b.notes ? String(b.notes).slice(0, 255) : null; if (b.active !== undefined) v.active = b.active ? 1 : 0;
  return v;
}
r.post('/hire/items', H, ah(async (req, res) => {
  const v = cleanItem(req.body);
  const id = await db.tx(async c => {
    // a machine (mixer, generator, compactor) can also be serviced through Maintenance
    if (req.body.track_maintenance) v.equipment_id = (await c.query(`INSERT INTO equipment (name, code, category, interval_days) VALUES (?, ?, 'Hire', ?)`, [v.name, v.code, Number(req.body.service_days) || null])).insertId;
    return (await c.query('INSERT INTO hire_items SET ?', [v])).insertId;
  });
  res.json({ id });
}));
r.put('/hire/items/:id(\\d+)', H, ah(async (req, res) => {
  const x = await db.one('SELECT * FROM hire_items WHERE id = ?', [req.params.id]);
  if (!x) throw notFound();
  const v = cleanItem({ ...x, ...req.body });
  await db.query('UPDATE hire_items SET ? WHERE id = ?', [v, x.id]);
  res.json({ id: x.id });
}));
r.get('/hire/available', H, ah(async (req, res) => {
  const from = d10(req.query.from) || today(), to = d10(req.query.to) || from;
  const b = await booked(from, to, Number(req.query.exclude) || 0);
  const items = await db.query('SELECT * FROM hire_items WHERE active = 1 ORDER BY category, name');
  res.json(items.map(i => ({ ...i, booked: b[i.id] || 0, free: round2(Number(i.qty_owned) - Number(i.qty_out_of_service) - (b[i.id] || 0)) })));
}));

/* ---------- hire orders ---------- */
const OSQL = `SELECT o.*, p.name customer, p.phone customer_phone, i.number invoice_number,
    (SELECT COALESCE(SUM(l.qty - l.qty_back), 0) FROM hire_lines l WHERE l.order_id = o.id) qty_out,
    (SELECT GROUP_CONCAT(CONCAT(CAST(l.qty AS DECIMAL(12,0)), ' × ', h.name) SEPARATOR ', ') FROM hire_lines l JOIN hire_items h ON h.id = l.item_id WHERE l.order_id = o.id) items
  FROM hire_orders o JOIN partners p ON p.id = o.partner_id LEFT JOIN invoices i ON i.id = o.invoice_id`;
r.get('/hire/orders', H, ah(async (req, res) => {
  const v = req.query.view || 'open'; const cond = [], args = [];
  if (v === 'open') cond.push(`o.status IN ('reserved','out','returned')`);
  else if (v === 'late') cond.push(`o.status = 'out' AND o.end_date < CURDATE()`);
  else if (v !== 'all') { cond.push('o.status = ?'); args.push(v); }
  if (req.query.partner_id) { cond.push('o.partner_id = ?'); args.push(req.query.partner_id); }
  if (req.query.q) { cond.push('(p.name LIKE ? OR p.phone LIKE ? OR o.number LIKE ?)'); args.push(...Array(3).fill(`%${req.query.q}%`)); }
  const rows = await db.query(`${OSQL} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY FIELD(o.status, 'out', 'returned', 'reserved', 'settled', 'cancelled'), o.end_date, o.id DESC LIMIT 1000`, args);
  rows.forEach(o => { o.late = o.status === 'out' && d10(o.end_date) < today(); o.days_late = o.late ? days(o.end_date, today()) : 0; });
  res.json(rows);
}));
async function getOrder(id, c = db) {
  const o = await c.one(`${OSQL} WHERE o.id = ?`, [id]);
  if (!o) throw notFound();
  o.lines = await c.query(`SELECT l.*, h.name, h.code, h.replacement_cost, h.deposit item_deposit FROM hire_lines l JOIN hire_items h ON h.id = l.item_id WHERE l.order_id = ? ORDER BY l.id`, [o.id]);
  o.returns = await c.query(`SELECT x.*, h.name FROM hire_returns x JOIN hire_lines l ON l.id = x.line_id JOIN hire_items h ON h.id = l.item_id WHERE x.order_id = ? ORDER BY x.id`, [o.id]);
  o.late = o.status === 'out' && d10(o.end_date) < today();
  // the bill so far: what came back is charged for its days; what is still out is charged up to today (or the end date if later)
  const upTo = d10(o.end_date) > today() ? d10(o.end_date) : today();
  const nOut = Math.max(1, days(o.start_date, upTo));
  let hire = 0, damage = 0;
  for (const x of o.returns) { hire += Number(x.hire_charge); damage += Number(x.damage_charge); }
  const still = o.lines.map(l => ({ line_id: l.id, name: l.name, qty: round2(Number(l.qty) - Number(l.qty_back)), days: nOut, charge: round2((Number(l.qty) - Number(l.qty_back)) * unitPrice(nOut, l)) })).filter(x => x.qty > 0);
  if (['reserved', 'out', 'returned'].includes(o.status)) {
    const est = still.reduce((t, x) => t + x.charge, 0);
    const total = round2(hire + damage + est + Number(o.delivery_fee));
    o.bill = { returned_hire: round2(hire), damage: round2(damage), still_out: still, still_out_charge: round2(est), delivery_fee: Number(o.delivery_fee), total, deposit: Number(o.deposit_held), to_pay: round2(total - Number(o.deposit_held)) };
  }
  return o;
}
r.get('/hire/orders/:id(\\d+)', H, ah(async (req, res) => res.json(await getOrder(req.params.id))));

async function checkFree(c, lines, from, to, exclude) {
  const b = await booked(from, to, exclude, c);
  const need = {};
  for (const l of lines) need[l.item_id] = (need[l.item_id] || 0) + Number(l.qty);
  for (const [id, q] of Object.entries(need)) {
    const it = await c.one('SELECT * FROM hire_items WHERE id = ?', [id]);
    if (!it || !it.active) throw bad('Unknown or inactive hire item');
    const free = round2(Number(it.qty_owned) - Number(it.qty_out_of_service) - (b[id] || 0));
    if (q > free + 0.0001) throw bad(`Only ${Math.max(0, free)} × ${it.name} free from ${from} to ${to}`);
  }
}
async function cleanLines(c, lines) {
  const out = [];
  for (const l of lines || []) {
    const it = await c.one('SELECT * FROM hire_items WHERE id = ?', [Number(l.item_id)]);
    if (!it) continue;
    const q = round2(l.qty); if (!(q > 0)) continue;
    out.push({ item_id: it.id, qty: q, rate_day: num(l.rate_day) ?? Number(it.rate_day), rate_week: l.rate_week !== undefined ? num(l.rate_week) : it.rate_week, rate_month: l.rate_month !== undefined ? num(l.rate_month) : it.rate_month, deposit: Number(it.deposit) * q });
  }
  if (!out.length) throw bad('Add at least one item and quantity');
  return out;
}
function cleanDates(b) {
  const s = d10(b.start_date) || today(), e = d10(b.end_date);
  if (!e) throw bad('Enter the date the items come back');
  if (e < s) throw bad('The return date is before the start date');
  return [s, e];
}
r.post('/hire/orders', H, ah(async (req, res) => {
  const b = req.body;
  const id = await db.tx(async c => {
    let pid = Number(b.partner_id) || null;
    if (!pid) {
      const name = String(b.customer_name || '').trim(); if (!name) throw bad('Choose the customer or type the new customer\'s name');
      pid = (await c.query(`INSERT INTO partners (name, phone, is_customer, tags) VALUES (?, ?, 1, 'hire')`, [name.slice(0, 160), b.customer_phone || null])).insertId;
    }
    const [s, e] = cleanDates(b);
    const lines = await cleanLines(c, b.lines);
    await checkFree(c, lines, s, e, 0);
    const dep = b.deposit_required !== undefined && b.deposit_required !== '' && b.deposit_required !== null ? round2(b.deposit_required) : round2(lines.reduce((t, l) => t + l.deposit, 0));
    const ins = await c.query('INSERT INTO hire_orders SET ?', [{ partner_id: pid, start_date: s, end_date: e, delivery_address: b.delivery_address ? String(b.delivery_address).slice(0, 255) : null, delivery_fee: round2(Math.max(0, Number(b.delivery_fee) || 0)),
      deposit_required: dep, id_number: b.id_number ? String(b.id_number).slice(0, 40) : null, notes: b.notes ? String(b.notes).slice(0, 255) : null, user_id: req.user.id }]);
    await c.query('UPDATE hire_orders SET number = ? WHERE id = ?', [`HIRE/${new Date().getFullYear()}/${pad(ins.insertId, 5)}`, ins.insertId]);
    for (const l of lines) await c.query('INSERT INTO hire_lines (order_id, item_id, qty, rate_day, rate_week, rate_month) VALUES (?, ?, ?, ?, ?, ?)', [ins.insertId, l.item_id, l.qty, l.rate_day, l.rate_week, l.rate_month]);
    return ins.insertId;
  });
  res.json(await getOrder(id));
}));
r.put('/hire/orders/:id(\\d+)', H, ah(async (req, res) => {
  const b = req.body;
  await db.tx(async c => {
    const o = await c.one('SELECT * FROM hire_orders WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!o) throw notFound();
    if (!['reserved', 'out'].includes(o.status)) throw bad('This hire is closed');
    const sets = {};
    for (const [k, n] of [['delivery_address', 255], ['notes', 255], ['id_number', 40]]) if (b[k] !== undefined) sets[k] = b[k] ? String(b[k]).slice(0, n) : null;
    if (b.delivery_fee !== undefined) sets.delivery_fee = round2(Math.max(0, Number(b.delivery_fee) || 0));
    if (b.deposit_required !== undefined && b.deposit_required !== '') sets.deposit_required = round2(b.deposit_required);
    if (o.status === 'reserved') {
      const [s, e] = cleanDates({ start_date: b.start_date || o.start_date, end_date: b.end_date || o.end_date });
      sets.start_date = s; sets.end_date = e;
      if (b.lines) {
        const lines = await cleanLines(c, b.lines);
        await checkFree(c, lines, s, e, o.id);
        await c.query('DELETE FROM hire_lines WHERE order_id = ?', [o.id]);
        for (const l of lines) await c.query('INSERT INTO hire_lines (order_id, item_id, qty, rate_day, rate_week, rate_month) VALUES (?, ?, ?, ?, ?, ?)', [o.id, l.item_id, l.qty, l.rate_day, l.rate_week, l.rate_month]);
      } else await checkFree(c, await c.query('SELECT item_id, qty FROM hire_lines WHERE order_id = ?', [o.id]), s, e, o.id);
    } else if (b.end_date) {
      // extending a hire that is out: the items must still be free for the extra days
      const e = d10(b.end_date); if (e < d10(o.start_date)) throw bad('The return date is before the start date');
      if (e > d10(o.end_date)) await checkFree(c, await c.query('SELECT item_id, qty - qty_back qty FROM hire_lines WHERE order_id = ? AND qty > qty_back', [o.id]), stock.addDays(d10(o.end_date), 1), e, o.id);
      sets.end_date = e;
    }
    if (Object.keys(sets).length) await c.query('UPDATE hire_orders SET ? WHERE id = ?', [sets, o.id]);
  });
  res.json(await getOrder(req.params.id));
}));
async function takeDeposit(c, o, b, user) {
  const amt = round2(b.deposit);
  if (!(amt > 0)) return 0;
  const m = await methodOf(c, b.method_id);
  if (m.requires_reference && !b.reference) throw bad(`${m.name} needs a reference`);
  await c.query(`INSERT INTO payments (direction, partner_id, method_id, amount, reference, user_id) VALUES ('in', ?, ?, ?, ?, ?)`, [o.partner_id, m.id, amt, b.reference || o.number, user.id]);
  await accounting.post(c, { reference: o.number, memo: `Hire deposit ${o.number}`, source_type: 'hire_deposit', source_id: o.id, user_id: user.id,
    lines: [{ code: m.account_code, debit: amt }, { code: '2420', credit: amt, partner_id: o.partner_id }] });
  await c.query('UPDATE hire_orders SET deposit_held = deposit_held + ? WHERE id = ?', [amt, o.id]);
  return amt;
}
// hand-over: the customer collects (or it is delivered); the deposit is taken and kept apart until the items are back
r.post('/hire/orders/:id(\\d+)/handover', H, ah(async (req, res) => {
  await db.tx(async c => {
    const o = await c.one('SELECT * FROM hire_orders WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!o) throw notFound();
    if (o.status !== 'reserved') throw bad('Only a reserved hire can be handed over');
    const start = d10(req.body.date) || today();
    if (start > d10(o.end_date)) throw bad('This hire was meant to be back already – change the return date first');
    await checkFree(c, await c.query('SELECT item_id, qty FROM hire_lines WHERE order_id = ?', [o.id]), start, d10(o.end_date), o.id);
    await takeDeposit(c, o, req.body, req.user);
    const held = Number((await c.one('SELECT deposit_held FROM hire_orders WHERE id = ?', [o.id])).deposit_held);
    if (held + 0.004 < Number(o.deposit_required) && !req.body.no_deposit_ok) throw bad(`A deposit of M ${Number(o.deposit_required).toFixed(2)} is required (M ${held.toFixed(2)} taken)`);
    await c.query(`UPDATE hire_orders SET status = 'out', start_date = ?, handed_over_at = NOW() WHERE id = ?`, [start, o.id]);
  });
  res.json(await getOrder(req.params.id));
}));
r.post('/hire/orders/:id(\\d+)/deposit', H, ah(async (req, res) => {
  await db.tx(async c => {
    const o = await c.one('SELECT * FROM hire_orders WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!o) throw notFound();
    if (!['reserved', 'out'].includes(o.status)) throw bad('This hire is closed');
    if (!(await takeDeposit(c, o, { ...req.body, deposit: req.body.amount }, req.user))) throw bad('Enter the amount received');
  });
  res.json(await getOrder(req.params.id));
}));
/**
 * Items come back (all or some). Each line: qty back in good order or damaged, damaged (of those), lost.
 * Hire is charged for the days they were out; lost items are charged their replacement cost unless another charge is given.
 */
r.post('/hire/orders/:id(\\d+)/return', H, ah(async (req, res) => {
  await db.tx(async c => {
    const o = await c.one('SELECT * FROM hire_orders WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!o) throw notFound();
    if (o.status !== 'out') throw bad('Only a hire that is out can be returned');
    const date = d10(req.body.date) || today();
    if (date < d10(o.start_date)) throw bad('The return date is before the hire started');
    const n = Math.max(1, days(o.start_date, date));
    let any = false;
    for (const x of req.body.lines || []) {
      const l = await c.one('SELECT l.*, h.replacement_cost, h.name FROM hire_lines l JOIN hire_items h ON h.id = l.item_id WHERE l.id = ? AND l.order_id = ? FOR UPDATE', [Number(x.line_id), o.id]);
      if (!l) continue;
      const q = round2(Math.max(0, Number(x.qty) || 0)), lost = round2(Math.max(0, Number(x.lost) || 0)), dmg = round2(Math.max(0, Number(x.damaged) || 0));
      if (!q && !lost) continue;
      if (dmg > q) throw bad(`${l.name}: more damaged than came back`);
      const open = round2(Number(l.qty) - Number(l.qty_back));
      if (q + lost > open + 0.0001) throw bad(`${l.name}: only ${open} still out`);
      const hireCharge = round2((q + lost) * unitPrice(n, l));
      const dc = x.damage_charge !== undefined && x.damage_charge !== '' && x.damage_charge !== null ? round2(x.damage_charge) : round2(lost * Number(l.replacement_cost));
      await c.query('INSERT INTO hire_returns (order_id, line_id, return_date, qty, damaged, lost, days, hire_charge, damage_charge, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [o.id, l.id, date, q, dmg, lost, n, hireCharge, dc, x.note ? String(x.note).slice(0, 160) : null, req.user.id]);
      await c.query('UPDATE hire_lines SET qty_back = qty_back + ? WHERE id = ?', [q + lost, l.id]);
      // damaged items wait for repair; lost ones are no longer owned
      if (dmg || lost) await c.query('UPDATE hire_items SET qty_out_of_service = qty_out_of_service + ?, qty_owned = GREATEST(0, qty_owned - ?) WHERE id = ?', [dmg, lost, l.item_id]);
      any = true;
    }
    if (!any) throw bad('Enter how many came back');
    const left = Number((await c.one('SELECT COALESCE(SUM(qty - qty_back), 0) q FROM hire_lines WHERE order_id = ?', [o.id])).q);
    if (left <= 0.0001) await c.query(`UPDATE hire_orders SET status = 'returned', returned_at = ? WHERE id = ?`, [date, o.id]);
  });
  res.json(await getOrder(req.params.id));
}));
// damaged items repaired – back in the hire pool
r.post('/hire/items/:id(\\d+)/repaired', H, ah(async (req, res) => {
  const q = round2(req.body.qty); if (!(q > 0)) throw bad('Enter how many are fixed');
  await db.query('UPDATE hire_items SET qty_out_of_service = GREATEST(0, qty_out_of_service - ?) WHERE id = ?', [q, req.params.id]);
  res.json({ ok: true });
}));
/**
 * Settle: invoice the hire (days out, damage, losses, delivery), set the deposit off against it, take the rest or
 * refund what is left of the deposit (or keep it on the customer's account).
 */
r.post('/hire/orders/:id(\\d+)/settle', requirePerm('hire'), ah(async (req, res) => {
  const biz = require('./business');
  const b = req.body;
  const out = await db.tx(async c => {
    const o = await c.one('SELECT * FROM hire_orders WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!o) throw notFound();
    if (o.status !== 'returned') throw bad('Everything must be back (or booked as lost) before the hire is settled');
    const vat = await vatRate(); const ex = x => Math.round(Number(x) / (1 + vat / 100) * 10000) / 10000;
    const lines = [];
    for (const x of await c.query('SELECT x.*, h.name FROM hire_returns x JOIN hire_lines l ON l.id = x.line_id JOIN hire_items h ON h.id = l.item_id WHERE x.order_id = ? ORDER BY x.id', [o.id])) {
      const units = round2(Number(x.qty) + Number(x.lost));
      if (Number(x.hire_charge) > 0) lines.push({ description: `${x.name} – ${x.days} day${x.days > 1 ? 's' : ''} (${d10(o.start_date)} to ${d10(x.return_date)})`.slice(0, 200), qty: units, unit_price: ex(Number(x.hire_charge) / units), gross_total: Number(x.hire_charge), tax_rate: vat, account_code: '4880' });
      if (Number(x.damage_charge) > 0) lines.push({ description: `${x.name} – ${Number(x.lost) ? `${Number(x.lost)} lost` : ''}${Number(x.lost) && Number(x.damaged) ? ', ' : ''}${Number(x.damaged) ? `${Number(x.damaged)} damaged` : ''}${x.note ? ': ' + x.note : ''}`.slice(0, 200), qty: 1, unit_price: ex(x.damage_charge), gross_total: Number(x.damage_charge), tax_rate: vat, account_code: '4880' });
    }
    if (Number(o.delivery_fee) > 0) lines.push({ description: 'Delivery and collection', qty: 1, unit_price: ex(o.delivery_fee), gross_total: Number(o.delivery_fee), tax_rate: vat, account_code: '4880' });
    let inv = null, number = null, applied = 0;
    if (lines.length) {
      inv = await biz.createInvoice(c, req.user, { kind: 'customer_invoice', partner_id: o.partner_id, invoice_date: today(), due_date: d10(b.due_date) || today(), notes: `${o.number}${o.delivery_address ? ' · ' + o.delivery_address : ''}`, lines: biz.calcLines(lines, 'unit_price') });
      await c.query('UPDATE invoices SET hire_order_id = ? WHERE id = ?', [o.id, inv]);
      number = (await biz.postInvoice(c, inv, req.user)).number;
      const total = Number((await c.one('SELECT total FROM invoices WHERE id = ?', [inv])).total);
      applied = round2(Math.min(total, Number(o.deposit_held)));
      if (applied > 0) await receipts.allocate(c, { partner_id: o.partner_id, amount: applied, debit_code: '2420', where: 'i.id = ?', args: [inv], user: req.user, reference: o.number, memo: `Deposit set off ${o.number}`, source_type: 'hire_deposit', source_id: o.id });
    }
    const rest = round2(Number(o.deposit_held) - applied);
    let refunded = 0;
    if (rest > 0.004) {
      if (b.keep_credit) await accounting.post(c, { reference: o.number, memo: `Deposit left on account ${o.number}`, source_type: 'hire_deposit', source_id: o.id, user_id: req.user.id,
        lines: [{ code: '2420', debit: rest, partner_id: o.partner_id }, { code: '1100', credit: rest, partner_id: o.partner_id }] });
      else {
        if (!b.refund_method_id) throw bad(`M ${rest.toFixed(2)} of the deposit is left – choose how it is refunded, or keep it on the customer's account`);
        const m = await methodOf(c, b.refund_method_id);
        await c.query(`INSERT INTO payments (direction, partner_id, method_id, amount, reference, user_id) VALUES ('out', ?, ?, ?, ?, ?)`, [o.partner_id, m.id, rest, `Deposit refund ${o.number}`, req.user.id]);
        await accounting.post(c, { reference: o.number, memo: `Deposit refund ${o.number}`, source_type: 'hire_deposit', source_id: o.id, user_id: req.user.id,
          lines: [{ code: '2420', debit: rest, partner_id: o.partner_id }, { code: m.account_code, credit: rest }] });
        refunded = rest;
      }
    }
    let payment = null;
    if (Number(b.amount) > 0) payment = await receipts.allocate(c, { partner_id: o.partner_id, amount: b.amount, method_id: b.method_id, reference: b.reference, user: req.user, memo: `Hire ${o.number}`, where: inv ? 'i.id = ?' : undefined, args: inv ? [inv] : undefined });
    await c.query(`UPDATE hire_orders SET status = 'settled', invoice_id = ?, deposit_held = 0 WHERE id = ?`, [inv, o.id]);
    return { invoice_id: inv, number, deposit_applied: applied, refunded, payment };
  });
  res.json({ ...out, order: await getOrder(req.params.id) });
}));
r.post('/hire/orders/:id(\\d+)/cancel', H, ah(async (req, res) => {
  await db.tx(async c => {
    const o = await c.one('SELECT * FROM hire_orders WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!o) throw notFound();
    if (o.status !== 'reserved') throw bad('Only a reservation can be cancelled – items that are out must be returned');
    const held = Number(o.deposit_held);
    if (held > 0.004) {
      // a cancellation fee may be kept from the deposit
      const fee = round2(Math.min(held, Math.max(0, Number(req.body.fee) || 0))), back = round2(held - fee);
      const lines = [{ code: '2420', debit: held, partner_id: o.partner_id }];
      if (fee) lines.push({ code: '4880', credit: fee, description: 'Cancellation fee' });
      if (back) { const m = await methodOf(c, req.body.refund_method_id); lines.push({ code: m.account_code, credit: back });
        await c.query(`INSERT INTO payments (direction, partner_id, method_id, amount, reference, user_id) VALUES ('out', ?, ?, ?, ?, ?)`, [o.partner_id, m.id, back, `Deposit refund ${o.number}`, req.user.id]); }
      await accounting.post(c, { reference: o.number, memo: `Hire cancelled ${o.number}`, source_type: 'hire_deposit', source_id: o.id, user_id: req.user.id, lines });
    }
    await c.query(`UPDATE hire_orders SET status = 'cancelled', deposit_held = 0, notes = CONCAT(COALESCE(notes, ''), ?) WHERE id = ?`, [req.body.reason ? ` · ${String(req.body.reason).slice(0, 100)}` : '', o.id]);
  });
  res.json(await getOrder(req.params.id));
}));

/* ---------- figures & settings ---------- */
r.get('/hire/stats', H, ah(async (req, res) => {
  const t = today();
  const s = await db.one(`SELECT SUM(status = 'out') out_now, SUM(status = 'out' AND end_date < ?) late, SUM(status = 'out' AND end_date = ?) due_today, SUM(status = 'reserved' AND start_date <= ?) to_hand_over,
    SUM(status = 'returned') to_settle, COALESCE(SUM(CASE WHEN status IN ('reserved','out') THEN deposit_held END), 0) deposits FROM hire_orders`, [t, t, t]);
  res.json(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Number(v || 0)])));
}));
r.get('/hire/report', H, ah(async (req, res) => {
  const to = d10(req.query.to) || today(); const from = d10(req.query.from) || `${to.slice(0, 8)}01`;
  const period = days(from, to) + 1;
  const items = await db.query('SELECT * FROM hire_items WHERE active = 1 ORDER BY category, name');
  const ls = await db.query(`SELECT l.item_id, l.qty, l.qty_back, o.start_date, o.status, o.end_date, (SELECT MAX(x.return_date) FROM hire_returns x WHERE x.line_id = l.id) last_back
    FROM hire_lines l JOIN hire_orders o ON o.id = l.order_id WHERE o.status IN ('out','returned','settled') AND o.start_date <= ?`, [to]);
  const inc = await db.query(`SELECT l.item_id, SUM(x.hire_charge) hire, SUM(x.damage_charge) dmg FROM hire_returns x JOIN hire_lines l ON l.id = x.line_id WHERE x.return_date BETWEEN ? AND ? GROUP BY l.item_id`, [from, to]);
  const rows = items.map(i => {
    let unitDays = 0;
    for (const l of ls.filter(x => x.item_id === i.id)) {
      const end = l.status === 'out' ? today() : d10(l.last_back) || d10(l.end_date);
      const s = d10(l.start_date) > from ? d10(l.start_date) : from, e = end < to ? end : to;
      const n = days(s, e); if (n > 0) unitDays += n * Number(l.qty);
    }
    const x = inc.find(y => y.item_id === i.id) || {};
    const cap = (Number(i.qty_owned) || 0) * period;
    return { item_id: i.id, name: i.name, category: i.category, qty_owned: Number(i.qty_owned), unit_days: round2(unitDays), utilisation: cap ? Math.round(unitDays / cap * 1000) / 10 : 0,
      hire_income: round2(x.hire || 0), damage_income: round2(x.dmg || 0), per_unit: Number(i.qty_owned) ? round2((Number(x.hire || 0)) / Number(i.qty_owned)) : 0 };
  });
  res.json({ from, to, rows });
}));
const DEFAULT_TERMS = 'Items remain the property of the company. The hirer is responsible for loss of or damage to items while on hire and pays the replacement cost of lost items. Hire is charged until the items are back. The deposit is refunded after the items are checked.';
r.get('/hire/settings', H, ah(async (req, res) => res.json({ terms: DEFAULT_TERMS, ...((await db.getSetting('hire', {})) || {}) })));
r.put('/hire/settings', requirePerm('settings'), ah(async (req, res) => {
  await db.setSetting('hire', { terms: String(req.body.terms || '').trim().slice(0, 2000) || DEFAULT_TERMS });
  res.json({ ok: true });
}));

module.exports = r;
module.exports.unitPrice = unitPrice;
