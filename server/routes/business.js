// Purchasing, invoicing (customer invoices & supplier bills) and accounting
const express = require('express');
const db = require('../db');
const stock = require('../services/stock');
const accounting = require('../services/accounting');
const reports = require('../services/reports');
const { requirePerm } = require('../auth');
const { ah, bad, notFound, round2, lineAmounts, pad, today } = require('../util');

const r = express.Router();

function calcLines(lines, priceKey) {
  return (lines || []).filter(l => Number(l.qty)).map(l => {
    const a = lineAmounts({ qty: l.qty, unit_price: l[priceKey], tax_rate: l.tax_rate || 0, price_includes_tax: 0 });
    return { ...l, net_amount: a.net, tax_amount: a.tax, line_total: a.total };
  });
}
const sumLines = ls => ({
  subtotal: round2(ls.reduce((s, l) => s + l.net_amount, 0)),
  tax_total: round2(ls.reduce((s, l) => s + l.tax_amount, 0)),
  total: round2(ls.reduce((s, l) => s + l.line_total, 0))
});

/* ======================= PURCHASING ======================= */
r.get('/purchases', requirePerm('purchasing'), ah(async (req, res) => {
  res.json(await db.query(`SELECT po.*, p.name supplier_name FROM purchase_orders po JOIN partners p ON p.id = po.supplier_id ORDER BY po.id DESC LIMIT 500`));
}));
r.get('/purchases/:id', requirePerm('purchasing'), ah(async (req, res) => {
  const po = await db.one(`SELECT po.*, p.name supplier_name, p.email supplier_email, p.phone supplier_phone, p.address supplier_address
    FROM purchase_orders po JOIN partners p ON p.id = po.supplier_id WHERE po.id = ?`, [req.params.id]);
  if (!po) throw notFound('Purchase order');
  po.lines = await db.query(`SELECT l.*, pr.type product_type, pr.uom, pr.track_batches, pr.shelf_life_days, pr.is_carcass, pr.species FROM purchase_lines l LEFT JOIN products pr ON pr.id = l.product_id WHERE po_id = ?`, [po.id]);
  po.bills = await db.query(`SELECT id, number, status, total FROM invoices WHERE po_id = ?`, [po.id]);
  res.json(po);
}));
async function savePoLines(c, poId, lines) {
  await c.query('DELETE FROM purchase_lines WHERE po_id = ?', [poId]);
  const ls = calcLines(lines, 'unit_cost');
  for (const l of ls) {
    let desc = l.description;
    if (!desc && l.product_id) desc = (await c.one('SELECT name FROM products WHERE id = ?', [l.product_id]) || {}).name;
    await c.query(`INSERT INTO purchase_lines (po_id, product_id, description, qty, unit_cost, tax_rate, net_amount, tax_amount, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [poId, l.product_id || null, desc || 'Item', l.qty, l.unit_cost, l.tax_rate || 0, l.net_amount, l.tax_amount, l.line_total]);
  }
  const t = sumLines(ls);
  await c.query('UPDATE purchase_orders SET subtotal = ?, tax_total = ?, total = ? WHERE id = ?', [t.subtotal, t.tax_total, t.total, poId]);
}
r.post('/purchases', requirePerm('purchasing'), ah(async (req, res) => {
  const b = req.body;
  if (!b.supplier_id) throw bad('Select a supplier');
  const id = await db.tx(async c => {
    const ins = await c.query(`INSERT INTO purchase_orders (supplier_id, order_date, expected_date, notes, user_id) VALUES (?, ?, ?, ?, ?)`,
      [b.supplier_id, b.order_date || today(), b.expected_date || null, b.notes || null, req.user.id]);
    await c.query('UPDATE purchase_orders SET number = ? WHERE id = ?', [`PO/${new Date().getFullYear()}/${pad(ins.insertId, 5)}`, ins.insertId]);
    await savePoLines(c, ins.insertId, b.lines);
    return ins.insertId;
  });
  res.json({ id });
}));
r.put('/purchases/:id', requirePerm('purchasing'), ah(async (req, res) => {
  const b = req.body;
  await db.tx(async c => {
    const po = await c.one('SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!po) throw notFound();
    if (po.status !== 'draft') throw bad('Only draft purchase orders can be edited');
    await c.query('UPDATE purchase_orders SET supplier_id = ?, order_date = ?, expected_date = ?, notes = ? WHERE id = ?',
      [b.supplier_id || po.supplier_id, b.order_date || po.order_date, b.expected_date || null, b.notes || null, po.id]);
    await savePoLines(c, po.id, b.lines);
  });
  res.json({ id: Number(req.params.id) });
}));
r.post('/purchases/:id/confirm', requirePerm('purchasing'), ah(async (req, res) => {
  const x = await db.query(`UPDATE purchase_orders SET status = 'confirmed' WHERE id = ? AND status = 'draft'`, [req.params.id]);
  if (!x.affectedRows) throw bad('Only draft orders can be confirmed');
  res.json({ ok: true });
}));
r.post('/purchases/:id/cancel', requirePerm('purchasing'), ah(async (req, res) => {
  const x = await db.query(`UPDATE purchase_orders SET status = 'cancelled' WHERE id = ? AND status IN ('draft','confirmed')`, [req.params.id]);
  if (!x.affectedRows) throw bad('Received orders cannot be cancelled');
  res.json({ ok: true });
}));
// Receive goods: stock in, Dr Inventory / Cr GRNI
r.post('/purchases/:id/receive', requirePerm('purchasing'), ah(async (req, res) => {
  const out = await db.tx(async c => {
    const po = await c.one('SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!po) throw notFound();
    if (!['confirmed', 'partial'].includes(po.status)) throw bad('Confirm the order before receiving');
    const lines = await c.query('SELECT l.*, p.type FROM purchase_lines l LEFT JOIN products p ON p.id = l.product_id WHERE po_id = ?', [po.id]);
    const reqLines = req.body.lines || lines.map(l => ({ line_id: l.id, qty: Number(l.qty) - Number(l.qty_received) }));
    const req_ = new Map(reqLines.map(l => [Number(l.line_id), Number(l.qty)]));
    const batchInfo = new Map(reqLines.map(l => [Number(l.line_id), l]));
    let value = 0;
    for (const l of lines) {
      const q = req_.get(l.id) || 0;
      if (q < 0 || !isFinite(q)) throw bad(`Quantity to receive for ${l.description} must be 0 or more`);
      if (q === 0) continue;
      if (q > Number(l.qty) - Number(l.qty_received) + 1e-9) throw bad(`Receiving more than ordered for ${l.description}`);
      await c.query('UPDATE purchase_lines SET qty_received = qty_received + ? WHERE id = ?', [q, l.id]);
      if (l.product_id && l.type === 'stock') {
        const bi = batchInfo.get(l.id) || {};
        // carcasses can be received one by one: each weighed piece becomes its own batch (tag) for traceability
        const pieces = Array.isArray(bi.pieces) ? bi.pieces.map(x => ({ ...x, qty: Math.round(Number(x.qty) * 1000) / 1000 })).filter(x => x.qty > 0) : [];
        if (pieces.length) {
          const sum = Math.round(pieces.reduce((s, x) => s + x.qty, 0) * 1000) / 1000;
          if (Math.abs(sum - q) > 0.0015) throw bad(`The individual weights for ${l.description} add up to ${sum}, not ${q}`);
        }
        for (const pc of pieces.length ? pieces : [{ qty: q, batch_no: bi.batch_no, live_weight: bi.live_weight }]) {
          const lw = Number(pc.live_weight) > 0 ? Math.round(Number(pc.live_weight) * 1000) / 1000 : null;
          if (lw && lw < pc.qty) throw bad(`Live weight (${lw} kg) cannot be less than the carcass weight (${pc.qty} kg)${pc.batch_no ? ' for ' + pc.batch_no : ''}`);
          await stock.move(c, { product_id: l.product_id, qty: pc.qty, unit_cost: Number(l.unit_cost), move_type: 'purchase', reference: po.number, user_id: req.user.id,
            batch: { batch_no: pc.batch_no || null, expiry_date: bi.expiry_date || null, supplier_id: po.supplier_id, source: 'purchase', live_weight: lw } });
        }
        value += q * Number(l.unit_cost);
      }
    }
    value = round2(value);
    if (![...req_.values()].some(q => q > 0)) throw bad('Enter a quantity to receive');
    await accounting.post(c, { reference: po.number, memo: `Goods received ${po.number}`, source_type: 'po_receipt', source_id: po.id, user_id: req.user.id,
      lines: [{ code: '1200', debit: value }, { code: '2050', credit: value, partner_id: po.supplier_id }] });
    const rem = await c.one('SELECT SUM(qty - qty_received) r FROM purchase_lines WHERE po_id = ?', [po.id]);
    const status = Number(rem.r) > 1e-9 ? 'partial' : 'received';
    await c.query('UPDATE purchase_orders SET status = ? WHERE id = ?', [status, po.id]);
    return { status, value };
  });
  res.json(out);
}));
// Create supplier bill from PO
r.post('/purchases/:id/bill', requirePerm('purchasing'), ah(async (req, res) => {
  const id = await db.tx(async c => {
    const po = await c.one('SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!po) throw notFound();
    if (po.billed) throw bad('This order already has a bill');
    if (!['partial', 'received', 'confirmed'].includes(po.status)) throw bad('Confirm or receive the order first');
    const lines = await c.query('SELECT l.*, p.type FROM purchase_lines l LEFT JOIN products p ON p.id = l.product_id WHERE po_id = ?', [po.id]);
    const ls = calcLines(lines.map(l => ({ product_id: l.product_id, description: l.description,
      qty: l.product_id && l.type === 'stock' ? l.qty_received : l.qty, unit_price: l.unit_cost, tax_rate: l.tax_rate,
      account_code: l.product_id && l.type === 'stock' ? '2050' : '6000' })), 'unit_price');
    const inv = await createInvoice(c, req.user, { kind: 'supplier_bill', partner_id: po.supplier_id, po_id: po.id, lines: ls, notes: `From ${po.number}` });
    await c.query('UPDATE purchase_orders SET billed = 1 WHERE id = ?', [po.id]);
    return inv;
  });
  res.json({ id });
}));

/* ======================= INVOICES & BILLS ======================= */
async function createInvoice(c, user, b) {
  if (!b.partner_id) throw bad('Select a partner');
  const ins = await c.query(`INSERT INTO invoices (kind, partner_id, invoice_date, due_date, po_id, order_id, notes, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.kind, b.partner_id, b.invoice_date || today(), b.due_date || null, b.po_id || null, b.order_id || null, b.notes || null, user.id]);
  await saveInvoiceLines(c, ins.insertId, b.lines);
  return ins.insertId;
}
async function saveInvoiceLines(c, id, lines) {
  await c.query('DELETE FROM invoice_lines WHERE invoice_id = ?', [id]);
  const ls = calcLines(lines, 'unit_price');
  for (const l of ls) {
    let desc = l.description;
    if (!desc && l.product_id) desc = (await c.one('SELECT name FROM products WHERE id = ?', [l.product_id]) || {}).name;
    await c.query(`INSERT INTO invoice_lines (invoice_id, product_id, description, account_code, qty, unit_price, tax_rate, net_amount, tax_amount, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, l.product_id || null, desc || 'Item', l.account_code || null, l.qty, l.unit_price, l.tax_rate || 0, l.net_amount, l.tax_amount, l.line_total]);
  }
  const t = sumLines(ls);
  await c.query('UPDATE invoices SET subtotal = ?, tax_total = ?, total = ? WHERE id = ?', [t.subtotal, t.tax_total, t.total, id]);
}

r.get('/invoices', requirePerm('invoicing'), ah(async (req, res) => {
  const cond = [], args = [];
  if (req.query.kind) { cond.push('i.kind = ?'); args.push(req.query.kind); }
  if (req.query.status) { cond.push('i.status = ?'); args.push(req.query.status); }
  if (req.query.partner_id) { cond.push('i.partner_id = ?'); args.push(req.query.partner_id); }
  res.json(await db.query(`SELECT i.*, p.name partner_name, DATEDIFF(CURDATE(), COALESCE(i.due_date, i.invoice_date)) days_overdue
    FROM invoices i JOIN partners p ON p.id = i.partner_id ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY i.id DESC LIMIT 1000`, args));
}));
r.get('/invoices/:id', requirePerm('invoicing'), ah(async (req, res) => {
  const i = await db.one(`SELECT i.*, p.name partner_name, p.address partner_address, p.email partner_email, p.phone partner_phone, p.tax_number partner_tax
    FROM invoices i JOIN partners p ON p.id = i.partner_id WHERE i.id = ?`, [req.params.id]);
  if (!i) throw notFound('Invoice');
  i.lines = await db.query('SELECT * FROM invoice_lines WHERE invoice_id = ?', [i.id]);
  i.payments = await db.query(`SELECT p.*, m.name method_name FROM payments p JOIN payment_methods m ON m.id = p.method_id WHERE invoice_id = ? ORDER BY p.id`, [i.id]);
  res.json(i);
}));
r.get('/invoices/:id/pay-qr', requirePerm('invoicing'), ah(async (req, res) => {
  const i = await db.one('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
  if (!i) throw notFound('Invoice');
  const due = round2(i.total - i.amount_paid);
  if (i.kind !== 'customer_invoice' || !['posted', 'partial'].includes(i.status) || due <= 0) return res.json([]);
  res.json(await require('../services/qr').payQrs({ amount: due, reference: i.number }));
}));
r.post('/invoices', requirePerm('invoicing'), ah(async (req, res) => {
  if (!['customer_invoice', 'supplier_bill'].includes(req.body.kind)) throw bad('Invalid kind');
  const id = await db.tx(c => createInvoice(c, req.user, req.body));
  res.json({ id });
}));
r.put('/invoices/:id', requirePerm('invoicing'), ah(async (req, res) => {
  await db.tx(async c => {
    const i = await c.one('SELECT * FROM invoices WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!i) throw notFound();
    if (i.status !== 'draft') throw bad('Only drafts can be edited');
    await c.query('UPDATE invoices SET partner_id = ?, invoice_date = ?, due_date = ?, notes = ? WHERE id = ?',
      [req.body.partner_id || i.partner_id, req.body.invoice_date || i.invoice_date, req.body.due_date || null, req.body.notes || null, i.id]);
    await saveInvoiceLines(c, i.id, req.body.lines);
  });
  res.json({ id: Number(req.params.id) });
}));
r.post('/invoices/:id/post', requirePerm('invoicing'), ah(async (req, res) => {
  const out = await db.tx(async c => {
    const i = await c.one('SELECT * FROM invoices WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!i) throw notFound();
    if (i.status !== 'draft') throw bad('Already posted');
    if (!(Number(i.total) > 0)) throw bad('Invoice total must be greater than zero');
    const lines = await c.query('SELECT l.*, p.type FROM invoice_lines l LEFT JOIN products p ON p.id = l.product_id WHERE invoice_id = ?', [i.id]);
    const yr = new Date(i.invoice_date).getFullYear() || new Date().getFullYear();
    const number = i.kind === 'customer_invoice' ? `INV/${yr}/${pad(i.id, 5)}` : `BILL/${yr}/${pad(i.id, 5)}`;
    const jl = [];
    if (i.kind === 'customer_invoice') {
      jl.push({ code: '1100', debit: i.total, partner_id: i.partner_id });
      let cogs = 0;
      for (const l of lines) {
        jl.push({ code: l.account_code || '4000', credit: l.net_amount, description: l.description });
        if (l.product_id && l.type === 'stock') {
          const cost = await stock.move(c, { product_id: l.product_id, qty: -Number(l.qty), move_type: 'invoice', reference: number, user_id: req.user.id });
          cogs += Number(l.qty) * cost;
        }
      }
      jl.push({ code: '2100', credit: i.tax_total });
      cogs = round2(cogs);
      if (cogs) { jl.push({ code: '5000', debit: cogs }); jl.push({ code: '1200', credit: cogs }); }
    } else {
      for (const l of lines) {
        let code = l.account_code || '6000';
        if (!i.po_id && l.product_id && l.type === 'stock') {
          // direct bill for stock without a PO: receive the stock now
          await stock.move(c, { product_id: l.product_id, qty: Number(l.qty), unit_cost: Number(l.unit_price), move_type: 'purchase', reference: number, user_id: req.user.id });
          code = '1200';
        }
        jl.push({ code, debit: l.net_amount, description: l.description, partner_id: code === '2050' ? i.partner_id : null });
      }
      jl.push({ code: '1400', debit: i.tax_total });
      jl.push({ code: '2000', credit: i.total, partner_id: i.partner_id });
    }
    await accounting.post(c, { date: i.invoice_date, reference: number, memo: `${i.kind === 'customer_invoice' ? 'Invoice' : 'Bill'} ${number}`,
      source_type: 'invoice', source_id: i.id, user_id: req.user.id, lines: jl });
    await c.query(`UPDATE invoices SET status = 'posted', number = ? WHERE id = ?`, [number, i.id]);
    return { number };
  });
  res.json(out);
}));
r.post('/invoices/:id/cancel', requirePerm('invoicing'), ah(async (req, res) => {
  await db.tx(async c => {
    const i = await c.one('SELECT * FROM invoices WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!i) throw notFound();
    if (Number(i.amount_paid) > 0) throw bad('Invoice has payments; it cannot be cancelled');
    if (i.status === 'posted') {
      await accounting.reverseSource(c, 'invoice', i.id, { reference: `CANCEL ${i.number}`, user_id: req.user.id });
      const lines = await c.query('SELECT l.*, p.type FROM invoice_lines l LEFT JOIN products p ON p.id = l.product_id WHERE invoice_id = ?', [i.id]);
      for (const l of lines) if (l.product_id && l.type === 'stock') {
        if (i.kind === 'customer_invoice') await stock.move(c, { product_id: l.product_id, qty: Number(l.qty), move_type: 'refund', reference: `CANCEL ${i.number}`, user_id: req.user.id });
        else if (!i.po_id) await stock.move(c, { product_id: l.product_id, qty: -Number(l.qty), move_type: 'adjustment', reference: `CANCEL ${i.number}`, user_id: req.user.id });
      }
    }
    if (i.po_id) await c.query('UPDATE purchase_orders SET billed = 0 WHERE id = ?', [i.po_id]);
    await c.query(`UPDATE invoices SET status = 'cancelled' WHERE id = ?`, [i.id]);
  });
  res.json({ ok: true });
}));
r.post('/invoices/:id/payments', requirePerm('invoicing'), ah(async (req, res) => {
  const out = await db.tx(async c => {
    const i = await c.one('SELECT * FROM invoices WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!i) throw notFound();
    if (!['posted', 'partial'].includes(i.status)) throw bad('Post the invoice first');
    const amount = round2(req.body.amount);
    const due = round2(i.total - i.amount_paid);
    if (!(amount > 0) || amount > due + 0.001) throw bad(`Amount must be between 0 and ${due}`);
    const m = await c.one('SELECT * FROM payment_methods WHERE id = ?', [req.body.method_id]);
    if (!m || m.kind === 'account') throw bad('Choose cash, card, mobile money or bank');
    if (m.requires_reference && !req.body.reference) throw bad(`${m.name} needs a reference`);
    const cust = i.kind === 'customer_invoice';
    await c.query(`INSERT INTO payments (direction, invoice_id, partner_id, method_id, amount, reference, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()))`,
      [cust ? 'in' : 'out', i.id, i.partner_id, m.id, amount, req.body.reference || null, req.user.id, req.body.date ? req.body.date + ' 12:00:00' : null]);
    await accounting.post(c, { date: req.body.date || null, reference: i.number, memo: `Payment ${i.number}`, source_type: 'invoice_payment', source_id: i.id, user_id: req.user.id,
      lines: cust ? [{ code: m.account_code, debit: amount }, { code: '1100', credit: amount, partner_id: i.partner_id }]
        : [{ code: '2000', debit: amount, partner_id: i.partner_id }, { code: m.account_code, credit: amount }] });
    const paid = round2(Number(i.amount_paid) + amount);
    const status = paid >= Number(i.total) - 0.001 ? 'paid' : 'partial';
    await c.query('UPDATE invoices SET amount_paid = ?, status = ? WHERE id = ?', [paid, status, i.id]);
    return { status, amount_paid: paid };
  });
  res.json(out);
}));

/* ======================= ACCOUNTING ======================= */
r.get('/accounts', requirePerm('accounting'), ah(async (req, res) => {
  res.json(await db.query(`SELECT a.*, COALESCE(SUM(l.debit),0) debit, COALESCE(SUM(l.credit),0) credit,
    CASE WHEN a.type IN ('asset','expense') THEN COALESCE(SUM(l.debit - l.credit),0) ELSE COALESCE(SUM(l.credit - l.debit),0) END balance
    FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id GROUP BY a.id ORDER BY a.code`));
}));
r.post('/accounts', requirePerm('accounting'), ah(async (req, res) => {
  const { code, name, type } = req.body;
  if (!code || !name || !type) throw bad('Code, name and type are required');
  await db.query('INSERT INTO accounts (code, name, type) VALUES (?, ?, ?)', [code, name, type]);
  res.json({ ok: true });
}));
r.get('/journal', requirePerm('accounting'), ah(async (req, res) => {
  const from = req.query.from || '1900-01-01', to = req.query.to || '2999-12-31';
  const entries = await db.query(`SELECT e.*, u.name user_name, (SELECT SUM(debit) FROM journal_lines WHERE entry_id = e.id) amount
    FROM journal_entries e LEFT JOIN users u ON u.id = e.user_id WHERE e.entry_date BETWEEN ? AND ? ORDER BY e.id DESC LIMIT 1000`, [from, to]);
  res.json(entries);
}));
r.get('/journal/:id', requirePerm('accounting'), ah(async (req, res) => {
  const e = await db.one('SELECT * FROM journal_entries WHERE id = ?', [req.params.id]);
  if (!e) throw notFound();
  e.lines = await db.query(`SELECT l.*, a.code, a.name account_name, p.name partner_name FROM journal_lines l JOIN accounts a ON a.id = l.account_id
    LEFT JOIN partners p ON p.id = l.partner_id WHERE entry_id = ?`, [e.id]);
  res.json(e);
}));
r.post('/journal', requirePerm('accounting'), ah(async (req, res) => {
  const id = await db.tx(c => accounting.post(c, { date: req.body.date, reference: req.body.reference || 'MANUAL', memo: req.body.memo,
    source_type: 'manual', user_id: req.user.id, lines: req.body.lines || [] }));
  res.json({ id });
}));
// Quick expense: Dr expense (+ VAT input), Cr cash/bank/momo
r.post('/expenses', requirePerm('accounting'), ah(async (req, res) => {
  const b = req.body;
  const m = await db.one('SELECT * FROM payment_methods WHERE id = ?', [b.method_id]);
  if (!m || m.kind === 'account') throw bad('Choose how the expense was paid');
  const a = lineAmounts({ qty: 1, unit_price: b.amount, tax_rate: b.tax_rate || 0, price_includes_tax: 1 });
  const id = await db.tx(async c => {
    const jid = await accounting.post(c, { date: b.date, reference: b.reference || 'EXPENSE', memo: b.description || 'Expense', source_type: 'expense', user_id: req.user.id,
      lines: [{ code: b.account_code || '6000', debit: a.net, partner_id: b.partner_id }, { code: '1400', debit: a.tax }, { code: m.account_code, credit: a.total }] });
    await c.query(`INSERT INTO payments (direction, partner_id, method_id, amount, reference, user_id) VALUES ('out', ?, ?, ?, ?, ?)`,
      [b.partner_id || null, m.id, a.total, b.description || 'Expense', req.user.id]);
    return jid;
  });
  res.json({ id });
}));
// Customer pays down their account balance (from POS "charge to account" sales)
r.post('/customer-payments', requirePerm('invoicing'), ah(async (req, res) => {
  const b = req.body; const amount = round2(b.amount);
  const m = await db.one('SELECT * FROM payment_methods WHERE id = ?', [b.method_id]);
  if (!m || m.kind === 'account' || !(amount > 0) || !b.partner_id) throw bad('Customer, amount and method required');
  await db.tx(async c => {
    await c.query(`INSERT INTO payments (direction, partner_id, method_id, amount, reference, user_id) VALUES ('in', ?, ?, ?, ?, ?)`,
      [b.partner_id, m.id, amount, b.reference || 'Account payment', req.user.id]);
    await accounting.post(c, { reference: b.reference || 'ACC-PAY', memo: 'Customer account payment', source_type: 'account_payment', user_id: req.user.id,
      lines: [{ code: m.account_code, debit: amount }, { code: '1100', credit: amount, partner_id: b.partner_id }] });
  });
  res.json({ ok: true });
}));

/* ======================= REPORTS ======================= */
const range = q => ({ from: q.from || today(), to: q.to || q.from || today() });
r.get('/reports/sales', requirePerm('reports'), ah(async (req, res) => { const { from, to } = range(req.query); res.json(await reports.salesSummary(from, to)); }));
r.get('/reports/pl', requirePerm('reports'), ah(async (req, res) => { const { from, to } = range(req.query); res.json(await reports.profitAndLoss(from, to)); }));
r.get('/reports/bs', requirePerm('reports'), ah(async (req, res) => res.json(await reports.balanceSheet(req.query.to || today()))));
r.get('/reports/vat', requirePerm('reports'), ah(async (req, res) => { const { from, to } = range(req.query); res.json(await reports.vatReport(from, to)); }));
r.get('/reports/tb', requirePerm('reports'), ah(async (req, res) => {
  const { from, to } = range(req.query);
  const rows = (await reports.accountBalances(from, to)).filter(x => Number(x.debit) || Number(x.credit));
  res.json({ rows, debit: round2(rows.reduce((s, x) => s + Number(x.debit), 0)), credit: round2(rows.reduce((s, x) => s + Number(x.credit), 0)) });
}));
r.get('/reports/eod', requirePerm('reports'), ah(async (req, res) => {
  const lg = await require('../services/logo').get();
  const { html } = await reports.eodHtml(req.query.date || today(), { logo: lg ? lg.data_url : null });
  res.type('html').send(html);
}));
r.get('/reports/aged', requirePerm('reports'), ah(async (req, res) => {
  const kind = req.query.kind === 'supplier_bill' ? 'supplier_bill' : 'customer_invoice';
  res.json(await db.query(`SELECT p.id, p.name,
     SUM(CASE WHEN DATEDIFF(CURDATE(), COALESCE(i.due_date,i.invoice_date)) <= 0 THEN i.total - i.amount_paid ELSE 0 END) current_due,
     SUM(CASE WHEN DATEDIFF(CURDATE(), COALESCE(i.due_date,i.invoice_date)) BETWEEN 1 AND 30 THEN i.total - i.amount_paid ELSE 0 END) d30,
     SUM(CASE WHEN DATEDIFF(CURDATE(), COALESCE(i.due_date,i.invoice_date)) BETWEEN 31 AND 60 THEN i.total - i.amount_paid ELSE 0 END) d60,
     SUM(CASE WHEN DATEDIFF(CURDATE(), COALESCE(i.due_date,i.invoice_date)) > 60 THEN i.total - i.amount_paid ELSE 0 END) d90,
     SUM(i.total - i.amount_paid) total
     FROM invoices i JOIN partners p ON p.id = i.partner_id WHERE i.kind = ? AND i.status IN ('posted','partial') GROUP BY p.id ORDER BY total DESC`, [kind]));
}));

r.get('/dashboard', requirePerm('dashboard'), ah(async (req, res) => {
  const t = today();
  const s = await reports.salesSummary(t, t);
  const week = await db.query(`SELECT DATE(paid_at) d, SUM(total) total, COUNT(*) orders FROM orders
    WHERE status IN ('paid','refunded') AND paid_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY) GROUP BY DATE(paid_at) ORDER BY d`);
  const ar = await db.one(`SELECT COALESCE(SUM(l.debit - l.credit),0) v FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '1100'`);
  const ap = await db.one(`SELECT COALESCE(SUM(total-amount_paid),0) v FROM invoices WHERE kind='supplier_bill' AND status IN ('posted','partial')`);
  const openSessions = await db.query(`SELECT s.id, t.name terminal, u.name user, s.opened_at FROM pos_sessions s JOIN pos_terminals t ON t.id=s.terminal_id JOIN users u ON u.id=s.user_id WHERE s.status='open'`);
  const { can } = require('../auth');
  const recon = can(req.user, 'recon') ? await require('../services/recon').pendingCount(30) : null;
  const crm = can(req.user, 'crm') ? await db.one(
    `SELECT COALESCE(SUM(due_at < NOW()),0) overdue, COALESCE(SUM(DATE(due_at) = CURDATE()),0) today FROM crm_activities WHERE done = 0 AND assigned_to = ?`, [req.user.id]) : null;
  const expiry = await require('../services/butchery').expiryCounts();
  res.json({ today: s, week, receivables: ar.v, payables: ap.v, openSessions, recon_pending: recon, expiry,
    crm: crm ? { overdue: Number(crm.overdue), today: Number(crm.today) } : null });
}));

module.exports = r;
