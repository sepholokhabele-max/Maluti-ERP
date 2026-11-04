// Rooms & bookings for lodges, guest houses and hotels: room types and rates, rooms with housekeeping status,
// availability calendar, bookings (no double-booking), deposits, check-in, extra charges, check-out with the guest bill
// (room nights + extras + anything put on the guest's account at the restaurant / bar), occupancy figures.
const express = require('express');
const db = require('../db');
const stock = require('../services/stock');
const accounting = require('../services/accounting');
const receipts = require('../services/receipts');
const { requirePerm } = require('../auth');
const { ah, bad, notFound, round2, pad, today } = require('../util');

const r = express.Router();
const R = requirePerm('rooms');
const nights = (a, b) => Math.round((new Date(String(b).slice(0, 10) + 'T12:00:00') - new Date(String(a).slice(0, 10) + 'T12:00:00')) / 86400000);
const vatRate = async () => Number(((await db.getSetting('company', {})) || {}).default_vat ?? 15);
const methodOf = async (c, id) => { const m = await c.one('SELECT * FROM payment_methods WHERE id = ?', [id]); if (!m || m.kind === 'account') throw bad('Choose cash, card, mobile money or bank'); return m; };

/* ---------- room types & rooms ---------- */
r.get('/room-types', R, ah(async (req, res) => res.json(await db.query(`SELECT t.*, (SELECT COUNT(*) FROM rooms x WHERE x.room_type_id = t.id AND x.active = 1) rooms FROM room_types t ${req.query.all ? '' : 'WHERE t.active = 1'} ORDER BY t.rate`))));
function cleanType(b) {
  const v = { name: String(b.name || '').trim().slice(0, 80) };
  if (!v.name) throw bad('Name the room type, e.g. "Double", "Twin", "Family", "Executive"');
  v.rate = round2(b.rate); if (!(v.rate > 0)) throw bad('Enter the rate per night (incl. VAT)');
  v.capacity = Math.max(1, Math.round(Number(b.capacity) || 2)); v.breakfast = b.breakfast ? 1 : 0;
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  return v;
}
r.post('/room-types', R, ah(async (req, res) => res.json({ id: (await db.query('INSERT INTO room_types SET ?', [cleanType(req.body)])).insertId })));
r.put('/room-types/:id(\\d+)', R, ah(async (req, res) => { const t = await db.one('SELECT * FROM room_types WHERE id = ?', [req.params.id]); if (!t) throw notFound(); await db.query('UPDATE room_types SET ? WHERE id = ?', [cleanType({ ...t, ...req.body }), t.id]); res.json({ id: t.id }); }));
r.get('/rooms', R, ah(async (req, res) => {
  const rows = await db.query(`SELECT x.*, t.name type_name, t.rate, t.capacity,
      (SELECT b.id FROM bookings b WHERE b.room_id = x.id AND b.status = 'checked_in' LIMIT 1) occupied_by,
      (SELECT g.name FROM bookings b JOIN partners g ON g.id = b.guest_id WHERE b.room_id = x.id AND b.status = 'checked_in' LIMIT 1) guest_name,
      (SELECT b.check_out FROM bookings b WHERE b.room_id = x.id AND b.status = 'checked_in' LIMIT 1) leaves,
      (SELECT b.id FROM bookings b WHERE b.room_id = x.id AND b.status = 'reserved' AND b.check_in = CURDATE() LIMIT 1) arriving
    FROM rooms x JOIN room_types t ON t.id = x.room_type_id ${req.query.all ? '' : 'WHERE x.active = 1'} ORDER BY x.name`);
  res.json(rows);
}));
function cleanRoom(b) {
  const v = { name: String(b.name || '').trim().slice(0, 40) };
  if (!v.name) throw bad('Name or number the room, e.g. "Room 5"');
  v.room_type_id = Number(b.room_type_id) || null; if (!v.room_type_id) throw bad('Choose the room type');
  v.floor = b.floor ? String(b.floor).slice(0, 20) : null; v.notes = b.notes ? String(b.notes).slice(0, 255) : null;
  if (b.housekeeping && ['clean', 'dirty', 'out_of_order'].includes(b.housekeeping)) v.housekeeping = b.housekeeping;
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  return v;
}
r.post('/rooms', R, ah(async (req, res) => res.json({ id: (await db.query('INSERT INTO rooms SET ?', [cleanRoom(req.body)])).insertId })));
r.put('/rooms/:id(\\d+)', R, ah(async (req, res) => { const x = await db.one('SELECT * FROM rooms WHERE id = ?', [req.params.id]); if (!x) throw notFound(); await db.query('UPDATE rooms SET ? WHERE id = ?', [cleanRoom({ ...x, ...req.body }), x.id]); res.json({ id: x.id }); }));
r.put('/rooms/:id(\\d+)/housekeeping', R, ah(async (req, res) => {
  if (!['clean', 'dirty', 'out_of_order'].includes(req.body.status)) throw bad('Unknown status');
  await db.query('UPDATE rooms SET housekeeping = ? WHERE id = ?', [req.body.status, req.params.id]); res.json({ ok: true });
}));

/* ---------- availability ---------- */
r.get('/rooms/calendar', R, ah(async (req, res) => {
  const from = req.query.from || today(); const days = Math.max(1, Math.min(31, Number(req.query.days) || 14)); const to = stock.addDays(from, days);
  const rooms = await db.query('SELECT x.id, x.name, x.housekeeping, t.name type_name FROM rooms x JOIN room_types t ON t.id = x.room_type_id WHERE x.active = 1 ORDER BY x.name');
  const bk = await db.query(`SELECT b.id, b.number, b.room_id, b.check_in, b.check_out, b.status, g.name guest_name FROM bookings b JOIN partners g ON g.id = b.guest_id
    WHERE b.status IN ('reserved','checked_in','checked_out') AND b.check_in < ? AND b.check_out > ?`, [to, from]);
  bk.forEach(b => { b.check_in = String(b.check_in).slice(0, 10); b.check_out = String(b.check_out).slice(0, 10); });
  res.json({ from, days, dates: Array.from({ length: days }, (_, i) => stock.addDays(from, i)), rooms, bookings: bk });
}));
async function free(c, roomId, ci, co, exceptId) {
  const clash = await c.one(`SELECT b.number, g.name FROM bookings b JOIN partners g ON g.id = b.guest_id WHERE b.room_id = ? AND b.status IN ('reserved','checked_in') AND b.check_in < ? AND b.check_out > ? AND b.id <> ? LIMIT 1`, [roomId, co, ci, exceptId || 0]);
  if (clash) throw bad(`The room is already booked then (${clash.number}, ${clash.name})`);
}
r.get('/rooms/free', R, ah(async (req, res) => {
  const ci = req.query.check_in, co = req.query.check_out;
  if (!ci || !co || co <= ci) throw bad('Choose arrival and departure dates');
  res.json(await db.query(`SELECT x.id, x.name, x.housekeeping, t.id room_type_id, t.name type_name, t.rate, t.capacity FROM rooms x JOIN room_types t ON t.id = x.room_type_id WHERE x.active = 1 AND x.housekeeping <> 'out_of_order'
    AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.room_id = x.id AND b.status IN ('reserved','checked_in') AND b.check_in < ? AND b.check_out > ?) ORDER BY t.rate, x.name`, [co, ci]));
}));

/* ---------- bookings ---------- */
const BK_SQL = `SELECT b.*, x.name room_name, t.name type_name, g.name guest_name, g.phone guest_phone, g.email guest_email, co.name company_name, DATEDIFF(b.check_out, b.check_in) nights
  FROM bookings b JOIN rooms x ON x.id = b.room_id JOIN room_types t ON t.id = x.room_type_id JOIN partners g ON g.id = b.guest_id LEFT JOIN partners co ON co.id = b.company_id`;
r.get('/bookings', R, ah(async (req, res) => {
  const v = req.query.view || 'upcoming'; const cond = [], args = [];
  if (v === 'upcoming') cond.push(`b.status IN ('reserved','checked_in')`);
  else if (v === 'arrivals') { cond.push(`b.status = 'reserved' AND b.check_in <= ?`); args.push(req.query.date || today()); }
  else if (v === 'departures') { cond.push(`b.status = 'checked_in' AND b.check_out <= ?`); args.push(req.query.date || today()); }
  else if (v === 'inhouse') cond.push(`b.status = 'checked_in'`);
  if (req.query.q) { cond.push('(g.name LIKE ? OR g.phone LIKE ? OR b.number LIKE ?)'); args.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
  res.json(await db.query(`${BK_SQL} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY b.check_in, x.name LIMIT 1000`, args));
}));
/** guest bill: room nights so far (or for the whole stay at check-out), extras, account charges from the bar/restaurant, payments */
async function folio(b) {
  const vat = await vatRate();
  const extras = await db.query('SELECT * FROM booking_charges WHERE booking_id = ? ORDER BY charge_date, id', [b.id]);
  const n = Math.max(1, Number(b.nights));
  const room = round2(n * Number(b.rate));
  const ledger = await db.one(`SELECT COALESCE(SUM(l.debit - l.credit), 0) bal FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '1100' AND l.partner_id = ?`, [b.guest_id]);
  const invOpen = b.invoice_id ? await db.one('SELECT total - amount_paid o FROM invoices WHERE id = ?', [b.invoice_id]) : null;
  const extrasTotal = round2(extras.reduce((t, x) => t + Number(x.amount), 0));
  // what the guest owes in total = invoice not yet made (room + extras) + everything on their account (bar/restaurant charges, minus deposits)
  const balance = round2((b.invoice_id ? 0 : room + extrasTotal) + Number(ledger.bal));
  return { vat, nights: n, room, extras, extras_total: extrasTotal, account_balance: round2(ledger.bal), invoice_open: invOpen ? round2(invOpen.o) : null, balance };
}
async function getBooking(id) {
  const b = await db.one(`${BK_SQL} WHERE b.id = ?`, [id]);
  if (!b) throw notFound('Booking');
  b.folio = await folio(b);
  b.pos_charges = await db.query(`SELECT o.number, o.paid_at, o.total FROM orders o JOIN payments p ON p.order_id = o.id JOIN payment_methods m ON m.id = p.method_id
    WHERE o.partner_id = ? AND m.kind = 'account' AND o.paid_at >= ? ORDER BY o.paid_at`, [b.guest_id, String(b.check_in).slice(0, 10)]).catch(() => []);
  return b;
}
r.get('/bookings/:id(\\d+)', R, ah(async (req, res) => res.json(await getBooking(req.params.id))));
async function cleanBooking(c, b, id) {
  const ci = String(b.check_in || '').slice(0, 10), co = String(b.check_out || '').slice(0, 10);
  if (!ci || !co || co <= ci) throw bad('Departure must be after arrival');
  const room = await c.one('SELECT x.*, t.rate, t.capacity FROM rooms x JOIN room_types t ON t.id = x.room_type_id WHERE x.id = ? AND x.active = 1', [b.room_id]);
  if (!room) throw bad('Choose the room');
  if (room.housekeeping === 'out_of_order') throw bad(`${room.name} is out of order`);
  await free(c, room.id, ci, co, id);
  let gid = Number(b.guest_id) || null;
  if (!gid) {
    const name = String(b.guest_name || '').trim();
    if (!name) throw bad('Enter the guest\'s name and phone number');
    gid = (await c.query('INSERT INTO partners (name, phone, email, is_customer, tags) VALUES (?, ?, ?, 1, ?)', [name, b.guest_phone || null, b.guest_email || null, 'guest'])).insertId;
  }
  const adults = Math.max(1, Math.round(Number(b.adults) || 1)), children = Math.max(0, Math.round(Number(b.children) || 0));
  if (adults + children > room.capacity + 1) throw bad(`${room.name} sleeps ${room.capacity}`);
  return { room_id: room.id, guest_id: gid, check_in: ci, check_out: co, adults, children, rate: b.rate !== undefined && b.rate !== '' ? round2(b.rate) : Number(room.rate),
    source: ['walk_in', 'phone', 'email', 'whatsapp', 'booking_site', 'agent', 'other'].includes(b.source) ? b.source : 'phone', company_id: Number(b.company_id) || null, notes: b.notes ? String(b.notes).slice(0, 255) : null };
}
r.post('/bookings', R, ah(async (req, res) => {
  const id = await db.tx(async c => {
    const v = await cleanBooking(c, req.body);
    const ins = await c.query('INSERT INTO bookings SET ?', [{ ...v, user_id: req.user.id }]);
    await c.query('UPDATE bookings SET number = ? WHERE id = ?', [`BK/${new Date().getFullYear()}/${pad(ins.insertId, 5)}`, ins.insertId]);
    return ins.insertId;
  });
  if (req.body.check_in_now) await checkIn(id);
  res.json(await getBooking(id));
}));
r.put('/bookings/:id(\\d+)', R, ah(async (req, res) => {
  await db.tx(async c => {
    const b = await c.one('SELECT * FROM bookings WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!b) throw notFound();
    if (!['reserved', 'checked_in'].includes(b.status)) throw bad('This booking is closed');
    const v = await cleanBooking(c, { ...b, check_in: String(b.check_in).slice(0, 10), check_out: String(b.check_out).slice(0, 10), ...req.body, guest_id: b.guest_id }, b.id);
    if (b.status === 'checked_in' && v.room_id !== b.room_id) await c.query(`UPDATE rooms SET housekeeping = 'dirty' WHERE id = ?`, [b.room_id]); // room move
    await c.query('UPDATE bookings SET ? WHERE id = ?', [v, b.id]);
  });
  res.json(await getBooking(req.params.id));
}));
async function checkIn(id) {
  await db.tx(async c => {
    const b = await c.one('SELECT b.*, x.housekeeping, x.name room_name FROM bookings b JOIN rooms x ON x.id = b.room_id WHERE b.id = ? FOR UPDATE', [id]);
    if (!b) throw notFound();
    if (b.status !== 'reserved') throw bad('Only a reservation can be checked in');
    if (String(b.check_in).slice(0, 10) > today()) throw bad('The guest is only due on ' + String(b.check_in).slice(0, 10) + ' – change the arrival date first');
    if (b.housekeeping === 'out_of_order') throw bad(`${b.room_name} is out of order`);
    await c.query(`UPDATE bookings SET status = 'checked_in', checked_in_at = NOW(), check_in = LEAST(check_in, CURDATE()) WHERE id = ?`, [b.id]);
  });
}
r.post('/bookings/:id(\\d+)/checkin', R, ah(async (req, res) => { await checkIn(req.params.id); res.json(await getBooking(req.params.id)); }));
// deposit / advance payment: sits on the guest's account until the bill is made
r.post('/bookings/:id(\\d+)/deposit', R, ah(async (req, res) => {
  await db.tx(async c => {
    const b = await c.one('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
    if (!b) throw notFound();
    const amt = round2(req.body.amount); if (!(amt > 0)) throw bad('Enter the amount received');
    const m = await methodOf(c, req.body.method_id);
    if (m.requires_reference && !req.body.reference) throw bad(`${m.name} needs a reference`);
    await c.query(`INSERT INTO payments (direction, partner_id, method_id, amount, reference, user_id) VALUES ('in', ?, ?, ?, ?, ?)`, [b.guest_id, m.id, amt, req.body.reference || b.number, req.user.id]);
    await accounting.post(c, { reference: b.number, memo: `Deposit ${b.number}`, source_type: 'booking_deposit', source_id: b.id, user_id: req.user.id,
      lines: [{ code: m.account_code, debit: amt }, { code: '1100', credit: amt, partner_id: b.guest_id }] });
  });
  res.json(await getBooking(req.params.id));
}));
r.post('/bookings/:id(\\d+)/charges', R, ah(async (req, res) => {
  const b = await db.one('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
  if (!b) throw notFound();
  if (b.status !== 'checked_in') throw bad('Charges can only be added while the guest is in the house');
  const desc = String(req.body.description || '').trim(), amt = round2(req.body.amount);
  if (!desc || !amt) throw bad('Enter what is charged and the amount (incl. VAT)');
  await db.query('INSERT INTO booking_charges (booking_id, charge_date, description, amount, user_id) VALUES (?, ?, ?, ?, ?)', [b.id, req.body.date || today(), desc.slice(0, 160), amt, req.user.id]);
  res.json(await getBooking(b.id));
}));
/**
 * Check-out: the bill (room nights + extras) is invoiced and posted; a payment settles the invoice and everything else on
 * the guest's account (restaurant/bar charges); the room becomes dirty for housekeeping.
 */
r.post('/bookings/:id(\\d+)/checkout', R, ah(async (req, res) => {
  const biz = require('./business');
  const out = await db.tx(async c => {
    const b = await c.one('SELECT b.*, x.name room_name FROM bookings b JOIN rooms x ON x.id = b.room_id WHERE b.id = ? FOR UPDATE', [req.params.id]);
    if (!b) throw notFound();
    if (b.status !== 'checked_in') throw bad('Only a guest in the house can check out');
    const ci = String(b.check_in).slice(0, 10);
    let co = String(b.check_out).slice(0, 10);
    if (req.body.early && today() < co) co = today() > ci ? today() : stock.addDays(ci, 1);
    const n = Math.max(1, nights(ci, co));
    const vat = await vatRate();
    const lines = [{ description: `${b.room_name} – ${n} night${n > 1 ? 's' : ''} (${ci} to ${co})`, qty: n, unit_price: round2(Number(b.rate) / (1 + vat / 100) * 10000) / 10000, gross_total: round2(n * Number(b.rate)), tax_rate: vat, account_code: '4850' }];
    for (const x of await c.query('SELECT * FROM booking_charges WHERE booking_id = ?', [b.id]))
      lines.push({ description: `${x.description} (${String(x.charge_date).slice(0, 10)})`, qty: 1, unit_price: Math.round(Number(x.amount) / (1 + vat / 100) * 10000) / 10000, gross_total: Number(x.amount), tax_rate: vat, account_code: '4850' });
    // deposit / advance already on the guest's account (credit balance), before this bill
    const credit = -Number((await c.one(`SELECT COALESCE(SUM(l.debit - l.credit), 0) bal FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '1100' AND l.partner_id = ?`, [b.guest_id])).bal);
    const inv = await biz.createInvoice(c, req.user, { kind: 'customer_invoice', partner_id: b.company_id || b.guest_id, invoice_date: today(), due_date: today(), notes: `${b.number} ${b.room_name}`, lines: biz.calcLines(lines, 'unit_price') });
    await c.query('UPDATE invoices SET booking_id = ? WHERE id = ?', [b.id, inv]);
    const posted = await biz.postInvoice(c, inv, req.user);
    // the credit is already in the books (Cr 1100) – just mark the bill as (part) paid by it
    if (!b.company_id && credit > 0.004) {
      const i = await c.one('SELECT total FROM invoices WHERE id = ?', [inv]);
      const paid = round2(Math.min(Number(i.total), credit));
      await c.query('UPDATE invoices SET amount_paid = ?, status = ? WHERE id = ?', [paid, paid >= Number(i.total) - 0.004 ? 'paid' : 'partial', inv]);
    }
    let payment = null;
    if (Number(req.body.amount) > 0) payment = await receipts.allocate(c, { partner_id: b.company_id || b.guest_id, amount: req.body.amount, method_id: req.body.method_id, reference: req.body.reference, user: req.user, memo: `Check-out ${b.number}` });
    await c.query(`UPDATE bookings SET status = 'checked_out', checked_out_at = NOW(), check_out = ?, invoice_id = ? WHERE id = ?`, [co, inv, b.id]);
    await c.query(`UPDATE rooms SET housekeeping = 'dirty' WHERE id = ?`, [b.room_id]);
    return { invoice_id: inv, number: posted.number, payment };
  });
  res.json({ ...out, booking: await getBooking(req.params.id) });
}));
r.post('/bookings/:id(\\d+)/cancel', R, ah(async (req, res) => {
  const b = await db.one('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
  if (!b) throw notFound();
  if (b.status !== 'reserved') throw bad('Only a reservation can be cancelled');
  await db.query('UPDATE bookings SET status = ?, notes = CONCAT(COALESCE(notes, ""), ?) WHERE id = ?', [req.body.no_show ? 'no_show' : 'cancelled', req.body.reason ? ` · ${String(req.body.reason).slice(0, 100)}` : '', b.id]);
  res.json(await getBooking(b.id));
}));

/* ---------- figures ---------- */
r.get('/rooms/stats', R, ah(async (req, res) => {
  const to = req.query.to || today(); const from = req.query.from || `${to.slice(0, 8)}01`;
  const roomsN = Number((await db.one('SELECT COUNT(*) n FROM rooms WHERE active = 1')).n);
  const days = nights(from, to) + 1;
  const bk = await db.query(`SELECT check_in, check_out, rate FROM bookings WHERE status IN ('checked_in','checked_out') AND check_in <= ? AND check_out > ?`, [to, from]);
  let sold = 0, revenue = 0;
  for (const b of bk) {
    const s = String(b.check_in).slice(0, 10) > from ? String(b.check_in).slice(0, 10) : from;
    const e = String(b.check_out).slice(0, 10) < stock.addDays(to, 1) ? String(b.check_out).slice(0, 10) : stock.addDays(to, 1);
    const n = Math.max(0, nights(s, e)); sold += n; revenue += n * Number(b.rate);
  }
  const avail = roomsN * days;
  const t = today();
  const counts = await db.one(`SELECT SUM(status = 'reserved' AND check_in = ?) arrivals, SUM(status = 'checked_in' AND check_out = ?) departures, SUM(status = 'checked_in') inhouse FROM bookings`, [t, t]);
  res.json({ from, to, rooms: roomsN, room_nights_sold: sold, occupancy: avail ? Math.round(sold / avail * 1000) / 10 : 0, adr: sold ? round2(revenue / sold) : 0, revpar: avail ? round2(revenue / avail) : 0, revenue: round2(revenue),
    arrivals: Number(counts.arrivals || 0), departures: Number(counts.departures || 0), inhouse: Number(counts.inhouse || 0) });
}));

module.exports = r;
