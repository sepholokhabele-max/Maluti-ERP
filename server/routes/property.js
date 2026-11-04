// Property & rent: buildings, units, tenants and leases (rent invoiced monthly through a contract), deposits,
// utility recharges, receipts against arrears, rent roll, escalations and – for rent collectors – landlord statements and payouts.
const express = require('express');
const db = require('../db');
const stock = require('../services/stock');
const accounting = require('../services/accounting');
const receipts = require('../services/receipts');
const { requirePerm } = require('../auth');
const { ah, bad, notFound, round2, pad, today } = require('../util');

const r = express.Router();
const P = requirePerm('property');
const KINDS = ['flat', 'house', 'room', 'shop', 'office', 'warehouse', 'site', 'other'];
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const methodAccount = async (c, id) => {
  const m = await c.one('SELECT * FROM payment_methods WHERE id = ?', [id]);
  if (!m || m.kind === 'account') throw bad('Choose cash, card, mobile money or bank');
  return m;
};

/* ======================= BUILDINGS & UNITS ======================= */
const UNIT_SQL = `SELECT u.*, p.name property_name, l.id lease_id, l.number lease_number, l.status lease_status, l.rent, l.tax_rate, l.end_date lease_end, l.deposit_held, t.id tenant_id, t.name tenant_name, t.phone tenant_phone,
    (SELECT COALESCE(SUM(i.total - i.amount_paid),0) FROM invoices i WHERE i.lease_id = l.id AND i.status IN ('posted','partial')) arrears
  FROM units u JOIN properties p ON p.id = u.property_id
  LEFT JOIN leases l ON l.id = (SELECT x.id FROM leases x WHERE x.unit_id = u.id AND x.status IN ('active','notice') ORDER BY x.id DESC LIMIT 1)
  LEFT JOIN partners t ON t.id = l.tenant_id`;

r.get('/properties', P, ah(async (req, res) => {
  const rows = await db.query(`SELECT p.*, o.name owner_name,
      (SELECT COUNT(*) FROM units u WHERE u.property_id = p.id AND u.active = 1) units,
      (SELECT COUNT(*) FROM units u JOIN leases l ON l.unit_id = u.id AND l.status IN ('active','notice') WHERE u.property_id = p.id AND u.active = 1) occupied,
      (SELECT COALESCE(SUM(l.rent * (1 + l.tax_rate / 100)),0) FROM units u JOIN leases l ON l.unit_id = u.id AND l.status IN ('active','notice') WHERE u.property_id = p.id) monthly_rent,
      (SELECT COALESCE(SUM(i.total - i.amount_paid),0) FROM invoices i JOIN leases l ON l.id = i.lease_id JOIN units u ON u.id = l.unit_id WHERE u.property_id = p.id AND i.status IN ('posted','partial')) arrears
    FROM properties p LEFT JOIN partners o ON o.id = p.owner_id ${req.query.all ? '' : 'WHERE p.active = 1'} ORDER BY p.name`);
  rows.forEach(p => { p.monthly_rent = round2(p.monthly_rent); p.arrears = round2(p.arrears); p.occupancy = p.units ? Math.round(p.occupied / p.units * 100) : null; });
  res.json(rows);
}));
r.get('/properties/:id(\\d+)', P, ah(async (req, res) => {
  const p = await db.one('SELECT p.*, o.name owner_name FROM properties p LEFT JOIN partners o ON o.id = p.owner_id WHERE p.id = ?', [req.params.id]);
  if (!p) throw notFound();
  p.units = await db.query(`${UNIT_SQL} WHERE u.property_id = ? AND u.active = 1 ORDER BY u.name`, [p.id]);
  p.units.forEach(u => { u.arrears = round2(u.arrears); });
  p.payouts = await db.query('SELECT * FROM owner_payouts WHERE property_id = ? ORDER BY period_to DESC', [p.id]);
  res.json(p);
}));
function cleanProperty(b) {
  const v = { name: String(b.name || '').trim().slice(0, 120) };
  if (!v.name) throw bad('Name the building, e.g. "Mokhele Flats, Ha Thetsane"');
  v.address = b.address ? String(b.address).slice(0, 255) : null;
  v.owner_id = Number(b.owner_id) || null;
  v.commission_pct = Math.max(0, Math.min(100, Number(b.commission_pct) || 0));
  if (v.owner_id && !v.commission_pct) throw bad('Enter your management commission % for this landlord');
  v.notes = b.notes ? String(b.notes).slice(0, 255) : null;
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  return v;
}
r.post('/properties', P, ah(async (req, res) => { const ins = await db.query('INSERT INTO properties SET ?', [cleanProperty(req.body)]); res.json({ id: ins.insertId }); }));
r.put('/properties/:id(\\d+)', P, ah(async (req, res) => {
  const p = await db.one('SELECT * FROM properties WHERE id = ?', [req.params.id]);
  if (!p) throw notFound();
  await db.query('UPDATE properties SET ? WHERE id = ?', [cleanProperty({ ...p, ...req.body }), p.id]); res.json({ id: p.id });
}));
function cleanUnit(b) {
  const v = { name: String(b.name || '').trim().slice(0, 60) };
  if (!v.name) throw bad('Name the unit, e.g. "Flat 3" or "Shop 4"');
  v.kind = KINDS.includes(b.kind) ? b.kind : 'flat';
  for (const k of ['bedrooms']) v[k] = Number(b[k]) > 0 ? Math.round(Number(b[k])) : null;
  for (const k of ['size_m2', 'market_rent']) v[k] = Number(b[k]) > 0 ? round2(b[k]) : null;
  v.meter_no = b.meter_no ? String(b.meter_no).slice(0, 60) : null; v.notes = b.notes ? String(b.notes).slice(0, 255) : null;
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  return v;
}
r.post('/units', P, ah(async (req, res) => {
  const p = await db.one('SELECT id FROM properties WHERE id = ?', [req.body.property_id]);
  if (!p) throw bad('Choose the building');
  const ins = await db.query('INSERT INTO units SET ?', [{ ...cleanUnit(req.body), property_id: p.id }]); res.json({ id: ins.insertId });
}));
r.put('/units/:id(\\d+)', P, ah(async (req, res) => {
  const u = await db.one('SELECT * FROM units WHERE id = ?', [req.params.id]);
  if (!u) throw notFound();
  const v = cleanUnit({ ...u, ...req.body });
  if (v.active === 0 && await db.one(`SELECT id FROM leases WHERE unit_id = ? AND status IN ('active','notice')`, [u.id])) throw bad('This unit has a running lease – end it first');
  await db.query('UPDATE units SET ? WHERE id = ?', [v, u.id]); res.json({ id: u.id });
}));

/* ======================= LEASES ======================= */
const LEASE_SQL = `SELECT l.*, u.name unit_name, u.kind unit_kind, p.id property_id, p.name property_name, p.owner_id, p.commission_pct, t.name tenant_name, t.phone tenant_phone, t.email tenant_email,
    k.next_date next_rent_date, k.status contract_status,
    (SELECT COALESCE(SUM(i.total - i.amount_paid),0) FROM invoices i WHERE i.lease_id = l.id AND i.status IN ('posted','partial')) arrears
  FROM leases l JOIN units u ON u.id = l.unit_id JOIN properties p ON p.id = u.property_id JOIN partners t ON t.id = l.tenant_id LEFT JOIN contracts k ON k.id = l.contract_id`;
r.get('/leases', P, ah(async (req, res) => {
  const st = req.query.status || 'current';
  const cond = st === 'current' ? `l.status IN ('draft','active','notice')` : st === 'all' ? '1=1' : 'l.status = ?';
  const rows = await db.query(`${LEASE_SQL} WHERE ${cond} ${req.query.tenant_id ? 'AND l.tenant_id = ' + Number(req.query.tenant_id) : ''} ORDER BY p.name, u.name`, ['current', 'all'].includes(st) ? [] : [st]);
  rows.forEach(l => { l.arrears = round2(l.arrears); });
  res.json(rows);
}));
async function getLease(id) {
  const l = await db.one(`${LEASE_SQL} WHERE l.id = ?`, [id]);
  if (!l) throw notFound('Lease');
  l.arrears = round2(l.arrears);
  l.balance = await receipts.balance(db, l.tenant_id, 'i.lease_id = ?', [l.id]);
  l.invoices = await db.query('SELECT id, number, status, invoice_date, due_date, total, amount_paid, notes FROM invoices WHERE lease_id = ? ORDER BY invoice_date DESC, id DESC LIMIT 60', [l.id]);
  l.deposits = await db.query(`SELECT e.entry_date, e.memo, SUM(CASE WHEN a.code = '2400' THEN jl.credit - jl.debit ELSE 0 END) amount FROM journal_entries e JOIN journal_lines jl ON jl.entry_id = e.id JOIN accounts a ON a.id = jl.account_id
    WHERE e.source_type IN ('lease_deposit','lease_deposit_return') AND e.source_id = ? GROUP BY e.id ORDER BY e.id`, [l.id]);
  return l;
}
r.get('/leases/:id(\\d+)', P, ah(async (req, res) => res.json(await getLease(req.params.id))));
async function cleanLease(c, b) {
  const u = await c.one('SELECT u.*, p.owner_id FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = ? AND u.active = 1', [b.unit_id]);
  if (!u) throw bad('Choose the unit');
  const t = await c.one('SELECT id FROM partners WHERE id = ?', [b.tenant_id]);
  if (!t) throw bad('Choose the tenant (add them under Contacts first, or use "New tenant")');
  const start = String(b.start_date || today()).slice(0, 10), end = b.end_date ? String(b.end_date).slice(0, 10) : null;
  if (end && end <= start) throw bad('The lease must end after it starts');
  const rent = round2(b.rent);
  if (!(rent > 0)) throw bad('Enter the monthly rent');
  const due = Math.max(1, Math.min(28, Math.round(Number(b.due_day) || 1)));
  const esc = Math.max(0, Math.min(50, Number(b.escalation_pct) || 0));
  return { unit_id: u.id, tenant_id: t.id, start_date: start, end_date: end, rent, tax_rate: Math.max(0, Number(b.tax_rate) || 0), due_day: due,
    deposit: round2(Math.max(0, Number(b.deposit) || 0)), escalation_pct: esc, next_escalation: esc ? (b.next_escalation || stock.addDays(start, 365)) : null, notes: b.notes ? String(b.notes).slice(0, 255) : null };
}
r.post('/leases', P, ah(async (req, res) => {
  const id = await db.tx(async c => {
    const v = await cleanLease(c, req.body);
    const ins = await c.query('INSERT INTO leases SET ?', [v]);
    await c.query('UPDATE leases SET number = ? WHERE id = ?', [`LSE/${new Date().getFullYear()}/${pad(ins.insertId, 5)}`, ins.insertId]);
    return ins.insertId;
  });
  res.json(await getLease(id));
}));
r.put('/leases/:id(\\d+)', P, ah(async (req, res) => {
  await db.tx(async c => {
    const l = await c.one('SELECT * FROM leases WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!l) throw notFound();
    if (l.status === 'ended') throw bad('This lease has ended');
    if (l.status === 'draft') { await c.query('UPDATE leases SET ? WHERE id = ?', [await cleanLease(c, { ...l, ...req.body }), l.id]); return; }
    // running lease: rent, escalation, notes and end date can change; the monthly invoice follows
    const rent = req.body.rent !== undefined ? round2(req.body.rent) : Number(l.rent);
    if (!(rent > 0)) throw bad('Enter the monthly rent');
    const esc = req.body.escalation_pct !== undefined ? Math.max(0, Number(req.body.escalation_pct) || 0) : Number(l.escalation_pct);
    await c.query('UPDATE leases SET rent = ?, escalation_pct = ?, next_escalation = ?, notes = ?, end_date = ? WHERE id = ?',
      [rent, esc, req.body.next_escalation || l.next_escalation, req.body.notes !== undefined ? req.body.notes : l.notes, req.body.end_date !== undefined ? (req.body.end_date || null) : l.end_date, l.id]);
    await c.query('UPDATE contract_lines SET unit_price = ? WHERE contract_id = ? ORDER BY id LIMIT 1', [rent, l.contract_id]);
    if (req.body.end_date !== undefined) await c.query('UPDATE contracts SET end_date = ? WHERE id = ?', [req.body.end_date || null, l.contract_id]);
  });
  res.json(await getLease(req.params.id));
}));

/**
 * Activate: rent is invoiced every month on the due day through a contract (posted at once so arrears show).
 * A lease that starts between due days gets a pro-rata invoice for the first part-month.
 */
r.post('/leases/:id(\\d+)/activate', P, ah(async (req, res) => {
  const biz = require('./business');
  const out = await db.tx(async c => {
    const l = await c.one('SELECT l.*, u.name unit_name, p.name property_name, p.owner_id FROM leases l JOIN units u ON u.id = l.unit_id JOIN properties p ON p.id = u.property_id WHERE l.id = ? FOR UPDATE', [req.params.id]);
    if (!l) throw notFound();
    if (l.status !== 'draft') throw bad('This lease is already running');
    const clash = await c.one(`SELECT number FROM leases WHERE unit_id = ? AND id <> ? AND status IN ('active','notice')`, [l.unit_id, l.id]);
    if (clash) throw bad(`${l.unit_name} is still let on lease ${clash.number}. End that lease first.`);
    const acc = l.owner_id ? '2410' : '4600';
    const start = String(l.start_date).slice(0, 10);
    const [y, m, d] = start.split('-').map(Number);
    let first = start, prorata = null;
    // a lease taken over from another system: rent was billed there – the first invoice here is on bill_from
    const billFrom = req.body.bill_from ? String(req.body.bill_from).slice(0, 10) : null;
    if (billFrom) first = billFrom;
    else if (d !== l.due_day) {
      const nextDue = d < l.due_day ? new Date(y, m - 1, l.due_day) : new Date(y, m, l.due_day);
      first = ymd(nextDue);
      const days = Math.round((nextDue - new Date(y, m - 1, d)) / 86400000);
      const monthDays = new Date(nextDue.getFullYear(), nextDue.getMonth(), 0).getDate();
      prorata = round2(Number(l.rent) * days / monthDays);
      if (prorata > 0) {
        const inv = await biz.createInvoice(c, req.user, { kind: 'customer_invoice', partner_id: l.tenant_id, invoice_date: start, due_date: start, notes: `${l.number} ${l.property_name} ${l.unit_name} – rent ${start} to ${stock.addDays(first, -1)}`,
          lines: biz.calcLines([{ description: `Rent ${l.unit_name}, ${l.property_name} – ${days} days (${start} to ${stock.addDays(first, -1)})`, qty: 1, unit_price: prorata, tax_rate: Number(l.tax_rate), account_code: acc }], 'unit_price') });
        await c.query('UPDATE invoices SET lease_id = ? WHERE id = ?', [l.id, inv]);
        await biz.postInvoice(c, inv, req.user);
      }
    }
    const k = await c.query(`INSERT INTO contracts (partner_id, name, status, period, every, start_date, next_date, end_date, auto_post, due_days, notes, user_id) VALUES (?, ?, 'active', 'monthly', 1, ?, ?, ?, 1, ?, ?, ?)`,
      [l.tenant_id, `Rent ${l.unit_name} – ${l.property_name}`.slice(0, 160), first, first, l.end_date, Math.max(0, Number(req.body.grace_days ?? 7)), `Lease ${l.number}`, req.user.id]);
    await c.query('UPDATE contracts SET number = ? WHERE id = ?', [`CON/${new Date().getFullYear()}/${pad(k.insertId, 5)}`, k.insertId]);
    await c.query('INSERT INTO contract_lines (contract_id, description, qty, unit_price, tax_rate, account_code) VALUES (?, ?, 1, ?, ?, ?)',
      [k.insertId, `Rent ${l.unit_name}, ${l.property_name}`.slice(0, 200), l.rent, l.tax_rate, acc]);
    await c.query(`UPDATE leases SET status = 'active', contract_id = ? WHERE id = ?`, [k.insertId, l.id]);
    const held = round2(Math.max(0, Number(req.body.opening_deposit) || 0));
    if (held) {
      // deposit already held when the lease is taken over: it is the tenant's money, brought in against opening balances
      await accounting.post(c, { date: start > today() ? today() : null, reference: l.number, memo: `Deposit held (opening) ${l.number}`, source_type: 'lease_deposit', source_id: l.id, user_id: req.user.id,
        lines: [{ code: '3000', debit: held }, { code: '2400', credit: held, partner_id: l.tenant_id }] });
      await c.query('UPDATE leases SET deposit_held = deposit_held + ? WHERE id = ?', [held, l.id]);
    }
    return { prorata, first_rent_date: first };
  });
  await require('./growth').runDue(req.user, (await db.one('SELECT contract_id FROM leases WHERE id = ?', [req.params.id])).contract_id);
  res.json({ ...out, lease: await getLease(req.params.id) });
}));
r.post('/leases/:id(\\d+)/notice', P, ah(async (req, res) => {
  const l = await db.one('SELECT * FROM leases WHERE id = ?', [req.params.id]);
  if (!l) throw notFound();
  if (l.status !== 'active') throw bad('Only a running lease can be given notice');
  const end = String(req.body.end_date || '').slice(0, 10);
  if (!end || end < today()) throw bad('Enter the last day of the lease');
  await db.query(`UPDATE leases SET status = 'notice', notice_date = CURDATE(), end_date = ? WHERE id = ?`, [end, l.id]);
  await db.query('UPDATE contracts SET end_date = ? WHERE id = ?', [end, l.contract_id]);
  res.json(await getLease(l.id));
}));
r.post('/leases/:id(\\d+)/end', P, ah(async (req, res) => {
  const l = await db.one('SELECT * FROM leases WHERE id = ?', [req.params.id]);
  if (!l) throw notFound();
  if (!['active', 'notice', 'draft'].includes(l.status)) throw bad('Already ended');
  await db.query(`UPDATE leases SET status = 'ended', ended_at = ?, end_date = COALESCE(end_date, ?) WHERE id = ?`, [req.body.date || today(), req.body.date || today(), l.id]);
  if (l.contract_id) await db.query(`UPDATE contracts SET status = 'ended' WHERE id = ?`, [l.contract_id]);
  res.json(await getLease(l.id));
}));
// deposit received: Dr cash/bank, Cr 2400 Tenant deposits held (it is the tenant's money, not income)
r.post('/leases/:id(\\d+)/deposit', P, ah(async (req, res) => {
  await db.tx(async c => {
    const l = await c.one('SELECT * FROM leases WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!l) throw notFound();
    const amt = round2(req.body.amount);
    if (!(amt > 0)) throw bad('Enter the deposit received');
    const m = await methodAccount(c, req.body.method_id);
    if (m.requires_reference && !req.body.reference) throw bad(`${m.name} needs a reference`);
    await accounting.post(c, { date: req.body.date || null, reference: req.body.reference || l.number, memo: `Deposit received ${l.number}`, source_type: 'lease_deposit', source_id: l.id, user_id: req.user.id,
      lines: [{ code: m.account_code, debit: amt }, { code: '2400', credit: amt, partner_id: l.tenant_id }] });
    await c.query('UPDATE leases SET deposit_held = deposit_held + ? WHERE id = ?', [amt, l.id]);
  });
  res.json(await getLease(req.params.id));
}));
// deposit at the end: part clears unpaid rent, part covers damage (income), the rest is paid back
r.post('/leases/:id(\\d+)/deposit-return', P, ah(async (req, res) => {
  const out = await db.tx(async c => {
    const l = await c.one('SELECT * FROM leases WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!l) throw notFound();
    const held = round2(l.deposit_held);
    const arrears = round2(Math.max(0, Number(req.body.to_arrears) || 0)), damage = round2(Math.max(0, Number(req.body.deductions) || 0)), refund = round2(Math.max(0, Number(req.body.refund) || 0));
    if (arrears + damage + refund > held + 0.004) throw bad(`Only ${held} is held as deposit`);
    if (!(arrears + damage + refund > 0)) throw bad('Enter what happens to the deposit');
    if (damage && !String(req.body.reason || '').trim()) throw bad('Say what the deductions are for (damage, cleaning, keys…)');
    let applied = null;
    if (arrears) applied = await receipts.allocate(c, { partner_id: l.tenant_id, amount: arrears, debit_code: '2400', where: 'i.lease_id = ?', args: [l.id], user: req.user, reference: l.number, memo: `Deposit used for rent ${l.number}`, source_type: 'lease_deposit_return', source_id: l.id });
    const lines = [];
    if (damage) lines.push({ code: '2400', debit: damage, partner_id: l.tenant_id }, { code: '4200', credit: damage, description: String(req.body.reason).slice(0, 200) });
    if (refund) { const m = await methodAccount(c, req.body.method_id); lines.push({ code: '2400', debit: refund, partner_id: l.tenant_id }, { code: m.account_code, credit: refund, description: 'Deposit refunded' }); }
    if (lines.length) await accounting.post(c, { reference: l.number, memo: `Deposit settled ${l.number}`, source_type: 'lease_deposit_return', source_id: l.id, user_id: req.user.id, lines });
    await c.query('UPDATE leases SET deposit_held = deposit_held - ? WHERE id = ?', [round2(arrears + damage + refund), l.id]);
    return { applied, deductions: damage, refund };
  });
  res.json({ ...out, lease: await getLease(req.params.id) });
}));
// once-off charge to the tenant: water, electricity, damage, late fee…
r.post('/leases/:id(\\d+)/charge', P, ah(async (req, res) => {
  const biz = require('./business');
  const id = await db.tx(async c => {
    const l = await c.one('SELECT l.*, u.name unit_name, p.owner_id FROM leases l JOIN units u ON u.id = l.unit_id JOIN properties p ON p.id = u.property_id WHERE l.id = ?', [req.params.id]);
    if (!l) throw notFound();
    const desc = String(req.body.description || '').trim(), amt = round2(req.body.amount);
    if (!desc || !(amt > 0)) throw bad('Enter what is charged and the amount');
    const inv = await biz.createInvoice(c, req.user, { kind: 'customer_invoice', partner_id: l.tenant_id, due_date: stock.addDays(today(), 7), notes: `${l.number} ${l.unit_name}`,
      lines: biz.calcLines([{ description: `${desc} – ${l.unit_name}`.slice(0, 200), qty: 1, unit_price: amt, tax_rate: Number(req.body.tax_rate ?? 0), account_code: req.body.pass_to_owner && l.owner_id ? '2410' : '4200' }], 'unit_price') });
    await c.query('UPDATE invoices SET lease_id = ? WHERE id = ?', [l.id, inv]);
    await biz.postInvoice(c, inv, req.user);
    return inv;
  });
  res.json({ invoice_id: id, lease: await getLease(req.params.id) });
}));
// tenant pays: money goes to the oldest unpaid rent first
r.post('/leases/:id(\\d+)/receive', P, ah(async (req, res) => {
  const l = await db.one('SELECT * FROM leases WHERE id = ?', [req.params.id]);
  if (!l) throw notFound();
  const out = await db.tx(c => receipts.allocate(c, { partner_id: l.tenant_id, amount: req.body.amount, method_id: req.body.method_id, reference: req.body.reference, date: req.body.date,
    where: 'i.lease_id = ?', args: [l.id], user: req.user, memo: `Rent received ${l.number}` }));
  res.json({ ...out, lease: await getLease(l.id) });
}));

/** yearly increases on the anniversary: new rent = rent × (1 + %), the monthly invoice follows */
async function escalate() {
  const due = await db.query(`SELECT * FROM leases WHERE status IN ('active','notice') AND escalation_pct > 0 AND next_escalation IS NOT NULL AND next_escalation <= CURDATE()`);
  const done = [];
  for (const l of due) {
    const rent = round2(Number(l.rent) * (1 + Number(l.escalation_pct) / 100));
    await db.query('UPDATE leases SET rent = ?, next_escalation = DATE_ADD(next_escalation, INTERVAL 1 YEAR) WHERE id = ?', [rent, l.id]);
    if (l.contract_id) await db.query('UPDATE contract_lines SET unit_price = ? WHERE contract_id = ? ORDER BY id LIMIT 1', [rent, l.contract_id]);
    done.push({ lease: l.number, from: Number(l.rent), to: rent });
  }
  return done;
}
r.post('/leases/escalate', P, ah(async (req, res) => res.json({ escalated: await escalate() })));

/* ======================= REPORTS ======================= */
r.get('/property/rent-roll', P, ah(async (req, res) => {
  const rows = await db.query(`${UNIT_SQL} WHERE u.active = 1 AND p.active = 1 ${req.query.property_id ? 'AND p.id = ' + Number(req.query.property_id) : ''} ORDER BY p.name, u.name`);
  rows.forEach(u => { u.arrears = round2(u.arrears); u.state = !u.lease_id ? 'vacant' : u.lease_status; });
  const let_ = rows.filter(u => u.lease_id);
  res.json({ rows, units: rows.length, occupied: let_.length, vacant: rows.length - let_.length,
    monthly_rent: round2(let_.reduce((t, u) => t + Number(u.rent) * (1 + Number(u.tax_rate) / 100), 0)), arrears: round2(rows.reduce((t, u) => t + u.arrears, 0)),
    expiring: let_.filter(u => u.lease_end && String(u.lease_end).slice(0, 10) <= stock.addDays(today(), 90)).length });
}));
r.get('/property/arrears', P, ah(async (req, res) => {
  const tenants = await db.query(`SELECT DISTINCT l.tenant_id, t.name, t.phone FROM leases l JOIN partners t ON t.id = l.tenant_id
    JOIN invoices i ON i.lease_id = l.id AND i.status IN ('posted','partial')`);
  const out = [];
  for (const t of tenants) {
    const b = await receipts.balance(db, t.tenant_id, 'i.lease_id IS NOT NULL');
    if (b.due > 0.004) {
      const units = await db.query(`SELECT u.name, p.name property FROM leases l JOIN units u ON u.id = l.unit_id JOIN properties p ON p.id = u.property_id WHERE l.tenant_id = ? AND l.status IN ('active','notice','ended') ORDER BY l.id DESC LIMIT 3`, [t.tenant_id]);
      out.push({ tenant_id: t.tenant_id, name: t.name, phone: t.phone, units: units.map(u => `${u.name} ${u.property}`).join(', '), due: b.due, ...b.age });
    }
  }
  out.sort((a, b) => b.due - a.due);
  res.json(out);
}));
/** landlord statement: rent collected for a managed building, commission, and what is owed to the owner */
async function ownerStatement(propertyId, from, to) {
  const p = await db.one('SELECT p.*, o.name owner_name FROM properties p LEFT JOIN partners o ON o.id = p.owner_id WHERE p.id = ?', [propertyId]);
  if (!p) throw notFound();
  if (!p.owner_id) throw bad('This building is your own – there is no landlord to pay');
  const rows = await db.query(`SELECT pm.created_at, pm.amount, i.number, i.subtotal, i.total, t.name tenant, u.name unit,
      (SELECT COALESCE(SUM(x.net_amount),0) FROM invoice_lines x WHERE x.invoice_id = i.id AND x.account_code = '2410') owner_part
    FROM payments pm JOIN invoices i ON i.id = pm.invoice_id JOIN leases l ON l.id = i.lease_id JOIN units u ON u.id = l.unit_id JOIN partners t ON t.id = l.tenant_id
    WHERE u.property_id = ? AND pm.direction = 'in' AND pm.status = 'completed' AND DATE(pm.created_at) BETWEEN ? AND ? ORDER BY pm.created_at`, [p.id, from, to]);
  rows.forEach(x => { x.collected = round2(Number(x.amount) * Number(x.owner_part) / Number(x.total || 1)); });
  const collected = round2(rows.reduce((t, x) => t + x.collected, 0));
  const commission = round2(collected * Number(p.commission_pct) / 100);
  const paid = await db.one('SELECT COALESCE(SUM(collected),0) c FROM owner_payouts WHERE property_id = ? AND period_from <= ? AND period_to >= ?', [p.id, to, from]);
  return { property: p, from, to, rows, collected, commission, net: round2(collected - commission), already_paid: round2(paid.c) > 0 };
}
r.get('/property/owner-statement', P, ah(async (req, res) => {
  const to = req.query.to || today(); const from = req.query.from || `${to.slice(0, 8)}01`;
  res.json(await ownerStatement(req.query.property_id, from, to));
}));
r.post('/property/payout', requirePerm('accounting'), ah(async (req, res) => {
  const st = await ownerStatement(req.body.property_id, req.body.from, req.body.to);
  if (st.already_paid) throw bad('This period (or part of it) was already paid out to the landlord');
  if (!(st.collected > 0)) throw bad('Nothing was collected in this period');
  await db.tx(async c => {
    const m = await methodAccount(c, req.body.method_id);
    await accounting.post(c, { reference: `PAYOUT ${st.property.name}`.slice(0, 60), memo: `Landlord payout ${st.property.name} ${st.from} – ${st.to}`, source_type: 'owner_payout', user_id: req.user.id,
      lines: [{ code: '2410', debit: st.collected, partner_id: st.property.owner_id }, { code: '4500', credit: st.commission }, { code: m.account_code, credit: st.net }] });
    await c.query('INSERT INTO owner_payouts (property_id, period_from, period_to, collected, commission, paid, method_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [st.property.id, st.from, st.to, st.collected, st.commission, st.net, m.id, req.user.id]);
  });
  res.json(st);
}));

module.exports = { router: r, escalate };
