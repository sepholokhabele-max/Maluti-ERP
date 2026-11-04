// Receive money from a customer and spread it over their oldest unpaid invoices (rent, school fees, contracts).
const accounting = require('./accounting');
const { round2, bad } = require('../util');

/**
 * opts: { partner_id, amount, method_id | debit_code, where: extra SQL on invoices (e.g. 'i.lease_id = ?'), args, user, date, reference, memo }
 * - method_id: money received in cash / bank / mobile money (a payments row is written for each invoice paid)
 * - debit_code: an internal source instead, e.g. '2400' when a tenant's deposit is used to clear rent
 * Anything left over stays on the customer's account as a credit (prepayment).
 */
async function allocate(c, o) {
  const amount = round2(o.amount);
  if (!(amount > 0)) throw bad('Enter the amount received');
  let m = null;
  if (o.method_id) {
    m = await c.one('SELECT * FROM payment_methods WHERE id = ?', [o.method_id]);
    if (!m || m.kind === 'account') throw bad('Choose cash, card, mobile money or bank');
    if (m.requires_reference && !o.reference) throw bad(`${m.name} needs a reference (e.g. the M-Pesa or bank transaction number)`);
  } else if (!o.debit_code) throw bad('Choose how the money was received');
  const open = await c.query(`SELECT i.* FROM invoices i WHERE i.kind = 'customer_invoice' AND i.partner_id = ? AND i.status IN ('posted','partial') ${o.where ? 'AND ' + o.where : ''}
    ORDER BY COALESCE(i.due_date, i.invoice_date), i.id FOR UPDATE`, [o.partner_id, ...(o.args || [])]);
  let left = amount; const paid = [];
  for (const i of open) {
    if (left <= 0.004) break;
    const due = round2(Number(i.total) - Number(i.amount_paid));
    if (due <= 0) continue;
    const take = round2(Math.min(due, left));
    const total = round2(Number(i.amount_paid) + take);
    await c.query('UPDATE invoices SET amount_paid = ?, status = ? WHERE id = ?', [total, total >= Number(i.total) - 0.004 ? 'paid' : 'partial', i.id]);
    if (m) await c.query(`INSERT INTO payments (direction, invoice_id, partner_id, method_id, amount, reference, user_id, created_at) VALUES ('in', ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()))`,
      [i.id, o.partner_id, m.id, take, o.reference || null, o.user.id, o.date ? o.date + ' 12:00:00' : null]);
    paid.push({ invoice_id: i.id, number: i.number, amount: take });
    left = round2(left - take);
  }
  if (left > 0.004 && m) await c.query(`INSERT INTO payments (direction, partner_id, method_id, amount, reference, user_id, created_at) VALUES ('in', ?, ?, ?, ?, ?, COALESCE(?, NOW()))`,
    [o.partner_id, m.id, left, o.reference || null, o.user.id, o.date ? o.date + ' 12:00:00' : null]);
  await accounting.post(c, { date: o.date || null, reference: o.reference || (paid[0] && paid[0].number) || 'RECEIPT', memo: o.memo || 'Payment received', source_type: o.source_type || 'receipt', source_id: o.source_id || null, user_id: o.user.id,
    lines: [{ code: m ? m.account_code : o.debit_code, debit: amount, partner_id: ['2400', '2420'].includes(o.debit_code) ? o.partner_id : null }, { code: '1100', credit: amount, partner_id: o.partner_id }] });
  return { amount, paid, credit_left: left };
}

/** what a customer owes on invoices matching `where` (all their invoices when omitted), oldest first, with ageing */
async function balance(db, partnerId, where, args = []) {
  const rows = await db.query(`SELECT i.id, i.number, i.invoice_date, i.due_date, i.total, i.amount_paid, i.status, i.notes, DATEDIFF(CURDATE(), COALESCE(i.due_date, i.invoice_date)) days
    FROM invoices i WHERE i.kind = 'customer_invoice' AND i.partner_id = ? AND i.status IN ('posted','partial') ${where ? 'AND ' + where : ''} ORDER BY COALESCE(i.due_date, i.invoice_date), i.id`, [partnerId, ...args]);
  const age = { current: 0, d30: 0, d60: 0, d90: 0 };
  let due = 0;
  for (const r of rows) {
    const o = round2(Number(r.total) - Number(r.amount_paid)); r.open = o; due += o;
    if (r.days <= 0) age.current += o; else if (r.days <= 30) age.d30 += o; else if (r.days <= 60) age.d60 += o; else age.d90 += o;
  }
  Object.keys(age).forEach(k => { age[k] = round2(age[k]); });
  return { due: round2(due), age, invoices: rows };
}

module.exports = { allocate, balance };
