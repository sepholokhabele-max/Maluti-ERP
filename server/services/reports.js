const db = require('../db');
const { round2 } = require('../util');

async function company() {
  return (await db.getSetting('company', {})) || {};
}

/** Collect end-of-day figures for a date range [from, to] (YYYY-MM-DD, inclusive) */
async function salesSummary(from, to) {
  const range = [from + ' 00:00:00', to + ' 23:59:59'];
  const sales = await db.one(
    `SELECT COUNT(*) orders, COALESCE(SUM(total),0) total, COALESCE(SUM(tax_total),0) tax,
            COALESCE(SUM(subtotal),0) net, COALESCE(SUM(discount_total),0) discounts, COALESCE(SUM(cost_total),0) cost
     FROM orders WHERE status IN ('paid','refunded') AND refund_of IS NULL AND paid_at BETWEEN ? AND ?`, range);
  const refunds = await db.one(
    `SELECT COUNT(*) count, COALESCE(SUM(-total),0) total FROM orders
     WHERE refund_of IS NOT NULL AND paid_at BETWEEN ? AND ?`, range);
  const payments = await db.query(
    `SELECT m.name method, m.kind, COUNT(p.id) count, COALESCE(SUM(CASE WHEN p.direction='in' THEN p.amount ELSE -p.amount END),0) amount
     FROM payments p JOIN payment_methods m ON m.id = p.method_id
     WHERE p.status = 'completed' AND p.created_at BETWEEN ? AND ?
     GROUP BY m.id ORDER BY amount DESC`, range);
  const byCategory = await db.query(
    `SELECT COALESCE(c.name,'Uncategorised') category, SUM(l.qty) qty, SUM(l.line_total) total
     FROM order_lines l JOIN orders o ON o.id = l.order_id
     LEFT JOIN products p ON p.id = l.product_id LEFT JOIN categories c ON c.id = p.category_id
     WHERE o.status IN ('paid','refunded') AND o.paid_at BETWEEN ? AND ?
     GROUP BY category ORDER BY total DESC`, range);
  const topProducts = await db.query(
    `SELECT l.name, SUM(l.qty) qty, SUM(l.line_total) total
     FROM order_lines l JOIN orders o ON o.id = l.order_id
     WHERE o.status IN ('paid','refunded') AND o.paid_at BETWEEN ? AND ?
     GROUP BY l.name ORDER BY total DESC LIMIT 15`, range);
  const byUser = await db.query(
    `SELECT COALESCE(u.name,'-') user, COUNT(o.id) orders, SUM(o.total) total
     FROM orders o LEFT JOIN users u ON u.id = o.user_id
     WHERE o.status IN ('paid','refunded') AND o.paid_at BETWEEN ? AND ?
     GROUP BY o.user_id ORDER BY total DESC`, range);
  const byMode = await db.query(
    `SELECT mode, COUNT(*) orders, SUM(total) total FROM orders
     WHERE status IN ('paid','refunded') AND paid_at BETWEEN ? AND ? GROUP BY mode`, range);
  const vas = await db.query(
    `SELECT plugin_id, service, status, COUNT(*) count, SUM(amount) amount, SUM(commission) commission
     FROM vas_transactions WHERE created_at BETWEEN ? AND ? GROUP BY plugin_id, service, status ORDER BY service`, range);
  const sessions = await db.query(
    `SELECT s.id, t.name terminal, u.name user, s.status, s.opened_at, s.closed_at, s.opening_cash, s.expected_cash, s.counted_cash
     FROM pos_sessions s JOIN pos_terminals t ON t.id = s.terminal_id JOIN users u ON u.id = s.user_id
     WHERE (s.opened_at BETWEEN ? AND ?) OR (s.closed_at BETWEEN ? AND ?) OR s.status = 'open'
     ORDER BY s.opened_at`, [...range, ...range]);
  const openOrders = await db.one(`SELECT COUNT(*) count, COALESCE(SUM(total),0) total FROM orders WHERE status = 'open'`);
  const lowStock = await db.query(
    `SELECT name, stock_qty, reorder_level FROM products
     WHERE active = 1 AND type = 'stock' AND stock_qty <= reorder_level ORDER BY stock_qty LIMIT 30`);
  const reconRows = await db.query(
    `SELECT recon_date, status, variance_total FROM sales_recons WHERE recon_date BETWEEN ? AND ?`, [from, to]);
  const waste = await db.query(
    `SELECT COALESCE(m.reason,'Other') reason, COUNT(*) count, ROUND(SUM(-m.qty * m.unit_cost),2) value FROM stock_moves m
     WHERE m.move_type = 'waste' AND m.created_at BETWEEN ? AND ? GROUP BY reason ORDER BY value DESC`, range);
  const voids = await db.one(`SELECT COUNT(*) count, COALESCE(SUM(total),0) total FROM orders WHERE status = 'voided' AND created_at BETWEEN ? AND ?`, range);
  return {
    from, to,
    sales: { ...sales, gross_profit: round2(sales.net - sales.cost) },
    refunds, voids, waste, recon: reconRows, payments, byCategory, topProducts, byUser, byMode, vas, sessions, openOrders, lowStock
  };
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function table(headers, rows) {
  if (!rows.length) return '<p style="color:#64748b;margin:4px 0 16px">No records.</p>';
  return `<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;margin-bottom:18px;font-size:13px">
    <tr>${headers.map(h => `<th align="${h.r ? 'right' : 'left'}" style="background:#f1f5f9;border-bottom:1px solid #cbd5e1">${esc(h.t)}</th>`).join('')}</tr>
    ${rows.map(r => `<tr>${r.map((c, i) => `<td align="${headers[i].r ? 'right' : 'left'}" style="border-bottom:1px solid #e2e8f0">${esc(c)}</td>`).join('')}</tr>`).join('')}
  </table>`;
}

async function eodHtml(date, opts = {}) {
  const c = await company();
  const cur = c.currency_symbol || 'M';
  const m = n => `${cur} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const d = await salesSummary(date, date);
  const h2 = t => `<h3 style="margin:22px 0 8px;color:#0f172a;border-left:4px solid #4f46e5;padding-left:8px">${esc(t)}</h3>`;
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:760px;margin:auto;color:#1e293b">
  ${opts.logo ? `<img src="${opts.logo}" alt="" style="max-height:70px;max-width:220px;margin-bottom:8px">` : ''}
  <h2 style="margin-bottom:0">${esc(c.name || 'Maluti ERP')} — End of Day Report</h2>
  <div style="color:#64748b">${esc(date)} · generated ${esc(new Date().toLocaleString())}</div>
  ${h2('Summary')}
  ${table([{ t: 'Metric' }, { t: 'Value', r: 1 }], [
    ['Orders', d.sales.orders],
    ['Gross sales (incl. VAT)', m(d.sales.total)],
    ['Net sales (excl. VAT)', m(d.sales.net)],
    ['VAT collected', m(d.sales.tax)],
    ['Discounts given', m(d.sales.discounts)],
    ['Cost of sales', m(d.sales.cost)],
    ['Gross profit', m(d.sales.gross_profit)],
    ['Refunds', `${d.refunds.count} / ${m(d.refunds.total)}`],
    ['Voided orders', `${d.voids.count} / ${m(d.voids.total)}`],
    ['Orders still open (tabs/tables)', `${d.openOrders.count} / ${m(d.openOrders.total)}`]
  ])}
  ${h2('Payments by method')}
  ${table([{ t: 'Method' }, { t: 'Count', r: 1 }, { t: 'Amount', r: 1 }], d.payments.map(p => [p.method, p.count, m(p.amount)]))}
  ${h2('Sales by business type')}
  ${table([{ t: 'Mode' }, { t: 'Orders', r: 1 }, { t: 'Total', r: 1 }], d.byMode.map(p => [p.mode, p.orders, m(p.total)]))}
  ${h2('Sales by category')}
  ${table([{ t: 'Category' }, { t: 'Qty', r: 1 }, { t: 'Total', r: 1 }], d.byCategory.map(p => [p.category, Number(p.qty), m(p.total)]))}
  ${h2('Top products')}
  ${table([{ t: 'Product' }, { t: 'Qty', r: 1 }, { t: 'Total', r: 1 }], d.topProducts.map(p => [p.name, Number(p.qty), m(p.total)]))}
  ${h2('Sales by staff')}
  ${table([{ t: 'Staff' }, { t: 'Orders', r: 1 }, { t: 'Total', r: 1 }], d.byUser.map(p => [p.user, p.orders, m(p.total)]))}
  ${h2('Value Added Services (airtime, electricity, ...)')}
  ${table([{ t: 'Plugin' }, { t: 'Service' }, { t: 'Status' }, { t: 'Count', r: 1 }, { t: 'Amount', r: 1 }, { t: 'Commission', r: 1 }],
    d.vas.map(v => [v.plugin_id, v.service, v.status, v.count, m(v.amount), m(v.commission)]))}
  ${h2('Cashier sessions')}
  ${table([{ t: 'Terminal' }, { t: 'User' }, { t: 'Status' }, { t: 'Opening', r: 1 }, { t: 'Expected cash', r: 1 }, { t: 'Counted', r: 1 }, { t: 'Difference', r: 1 }],
    d.sessions.map(s => [s.terminal, s.user, s.status, m(s.opening_cash), s.expected_cash == null ? '-' : m(s.expected_cash),
      s.counted_cash == null ? '-' : m(s.counted_cash), s.counted_cash == null ? '-' : m(s.counted_cash - s.expected_cash)]))}
  ${h2('Sales reconciliation')}
  ${d.recon.length ? table([{ t: 'Date' }, { t: 'Status' }, { t: 'Variance', r: 1 }], d.recon.map(x => [x.recon_date, x.status, m(x.variance_total)]))
    : '<p style="color:#b45309;margin:4px 0 16px">Not reconciled yet — complete it under Sales Recon.</p>'}
  ${d.waste.length ? h2('Waste & shrinkage') + table([{ t: 'Reason' }, { t: 'Entries', r: 1 }, { t: 'Value at cost', r: 1 }], d.waste.map(w => [w.reason, w.count, m(w.value)])) : ''}
  ${h2('Low stock')}
  ${table([{ t: 'Product' }, { t: 'On hand', r: 1 }, { t: 'Reorder at', r: 1 }], d.lowStock.map(p => [p.name, Number(p.stock_qty), Number(p.reorder_level)]))}
  <p style="color:#94a3b8;font-size:12px">Sent automatically by Maluti ERP.</p></div>`;
  return { html, data: d, company: c };
}

function toCsv(d) {
  const rows = [['Section', 'Item', 'Count/Qty', 'Amount']];
  rows.push(['Summary', 'Gross sales', d.sales.orders, d.sales.total]);
  rows.push(['Summary', 'VAT', '', d.sales.tax]);
  rows.push(['Summary', 'Refunds', d.refunds.count, d.refunds.total]);
  d.payments.forEach(p => rows.push(['Payment', p.method, p.count, p.amount]));
  d.byCategory.forEach(p => rows.push(['Category', p.category, p.qty, p.total]));
  d.topProducts.forEach(p => rows.push(['Product', p.name, p.qty, p.total]));
  d.vas.forEach(v => rows.push(['VAS', `${v.service} (${v.status})`, v.count, v.amount]));
  return rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

/** Profit & loss and balance sheet from the journal */
async function accountBalances(from, to) {
  return db.query(
    `SELECT a.code, a.name, a.type,
            COALESCE(SUM(l.debit),0) debit, COALESCE(SUM(l.credit),0) credit
     FROM accounts a
     LEFT JOIN journal_lines l ON l.account_id = a.id
     LEFT JOIN journal_entries e ON e.id = l.entry_id
     WHERE (e.id IS NULL OR (e.entry_date BETWEEN ? AND ?))
     GROUP BY a.id ORDER BY a.code`, [from, to]);
}

async function profitAndLoss(from, to) {
  const rows = (await accountBalances(from, to)).filter(r => r.type === 'income' || r.type === 'expense');
  const income = rows.filter(r => r.type === 'income').map(r => ({ ...r, amount: round2(r.credit - r.debit) }));
  const expense = rows.filter(r => r.type === 'expense').map(r => ({ ...r, amount: round2(r.debit - r.credit) }));
  const ti = round2(income.reduce((s, r) => s + r.amount, 0));
  const te = round2(expense.reduce((s, r) => s + r.amount, 0));
  return { from, to, income, expense, total_income: ti, total_expense: te, net_profit: round2(ti - te) };
}

async function balanceSheet(asOf) {
  const rows = await accountBalances('1900-01-01', asOf);
  const sign = r => (r.type === 'asset' || r.type === 'expense') ? r.debit - r.credit : r.credit - r.debit;
  const pick = t => rows.filter(r => r.type === t).map(r => ({ code: r.code, name: r.name, amount: round2(sign(r)) }));
  const assets = pick('asset'), liabilities = pick('liability'), equity = pick('equity');
  const pl = rows.filter(r => r.type === 'income').reduce((s, r) => s + sign(r), 0) - rows.filter(r => r.type === 'expense').reduce((s, r) => s + sign(r), 0);
  equity.push({ code: '', name: 'Current period earnings', amount: round2(pl) });
  const sum = a => round2(a.reduce((s, r) => s + r.amount, 0));
  return { as_of: asOf, assets, liabilities, equity, total_assets: sum(assets), total_liabilities: sum(liabilities), total_equity: sum(equity) };
}

async function vatReport(from, to) {
  const rows = await accountBalances(from, to);
  const out = rows.find(r => r.code === '2100') || { debit: 0, credit: 0 };
  const inp = rows.find(r => r.code === '1400') || { debit: 0, credit: 0 };
  const output_vat = round2(out.credit - out.debit), input_vat = round2(inp.debit - inp.credit);
  return { from, to, output_vat, input_vat, net_payable: round2(output_vat - input_vat) };
}

module.exports = { salesSummary, eodHtml, toCsv, accountBalances, profitAndLoss, balanceSheet, vatReport };
