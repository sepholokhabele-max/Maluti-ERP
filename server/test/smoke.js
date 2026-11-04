// End-to-end API smoke test. Needs a MySQL/MariaDB server.
// DB_HOST=localhost DB_USER=erp DB_PASSWORD=erp123 node server/test/smoke.js
const path = require('path');
const assert = require('assert');
const { start } = require('../app');

const DB = { host: process.env.DB_HOST || 'localhost', port: 3306, user: process.env.DB_USER || 'erp', password: process.env.DB_PASSWORD || 'erp123', database: process.env.DB_NAME || 'maluti_smoke' };
let base, token;

async function api(method, url, body, expectFail) {
  const r = await fetch(base + '/api' + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (expectFail) { assert(!r.ok, `${method} ${url} should fail`); return data; }
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${JSON.stringify(data)}`);
  return data;
}
const ok = (m) => console.log('  ✓', m);

(async () => {
  // fresh DB
  const mysql = require('mysql2/promise');
  const c = await mysql.createConnection({ host: DB.host, user: DB.user, password: DB.password });
  await c.query(`DROP DATABASE IF EXISTS \`${DB.database}\``); await c.end();

  // fake SMTP server to capture EOD email
  let mails = [];
  let smtpPort = null;
  try {
    const { SMTPServer } = require(process.env.SMTP_SERVER_MODULE || 'smtp-server');
    const smtp = new SMTPServer({ authOptional: true, disabledCommands: ['STARTTLS'], onData(stream, s, cb) { let d = ''; stream.on('data', x => d += x); stream.on('end', () => { mails.push(d); cb(); }); } });
    await new Promise(r => smtp.listen(0, '127.0.0.1', r)); smtpPort = smtp.server.address().port;
  } catch (e) { console.log('  (smtp-server not installed, skipping email delivery test)'); }

  const cfg = {};
  const store = { load: () => cfg, save: x => Object.assign(cfg, x) };
  const srv = await start({ port: 0, host: '127.0.0.1', configStore: store, pluginDirs: [path.join(__dirname, '..', '..', 'plugins')] });
  base = `http://127.0.0.1:${srv.port}`;

  let st = await api('GET', '/status'); assert.strictEqual(st.connected, false); ok('status before config');
  await api('POST', '/db-config', DB); ok('db configured + migrated');
  const s = await api('POST', '/setup', { company: { name: 'Smoke Café & Store', vat_rate: 15 }, admin: { name: 'Admin', username: 'admin', password: 'admin123', pin: '1234' }, demo: true });
  token = s.token; ok('setup + demo data, logged in as ' + s.user.role);

  const cat = await api('GET', '/pos/catalog');
  assert(cat.products.length >= 10); ok(`catalog: ${cat.products.length} products, ${cat.methods.length} payment methods`);
  const P = n => cat.products.find(p => p.name.startsWith(n));
  const M = k => cat.methods.find(m => m.name === k);
  const terms = await api('GET', '/pos/terminals');
  const retail = terms.find(t => t.mode === 'retail'), rest = terms.find(t => t.mode === 'restaurant'), bar = terms.find(t => t.mode === 'bar');

  const sess = await api('POST', '/pos/sessions/open', { terminal_id: retail.id, opening_cash: 500 }); ok('retail session opened');
  // retail checkout, pay 200 cash for 2 bread + 1 maize (36+75=111) -> change 89
  const co = await api('POST', '/pos/checkout', { session_id: sess.id, lines: [{ product_id: P('White Bread').id, qty: 2 }, { product_id: P('Maize Meal').id, qty: 1 }], payments: [{ method_id: M('Cash').id, amount: 200 }] });
  assert.strictEqual(co.order.total, 111); assert.strictEqual(co.change, 89); ok(`retail sale ${co.number} total 111, change 89`);
  // card overpay rejected
  await api('POST', '/pos/checkout', { session_id: sess.id, lines: [{ product_id: P('White Bread').id, qty: 1 }], payments: [{ method_id: M('Card').id, amount: 50 }] }, true); ok('card overpayment rejected');
  // mobile money requires reference
  await api('POST', '/pos/checkout', { session_id: sess.id, lines: [{ product_id: P('White Bread').id, qty: 1 }], payments: [{ method_id: M('M-Pesa').id, amount: 18 }] }, true); ok('M-Pesa without reference rejected');
  const mm = await api('POST', '/pos/checkout', { session_id: sess.id, lines: [{ product_id: P('Full Cream').id, qty: 3 }], payments: [{ method_id: M('M-Pesa').id, amount: 63, reference: 'QK7H2X9', phone: '58001234' }] });
  ok('M-Pesa sale ' + mm.number);

  // restaurant
  const rs = await api('POST', '/pos/sessions/open', { terminal_id: rest.id, opening_cash: 0 });
  const floors = await api('GET', '/pos/floors');
  const table = floors[0].tables[0];
  const ord = await api('POST', '/pos/orders', { session_id: rs.id, table_id: table.id, guests: 2, lines: [{ product_id: P('Beef Burger').id, qty: 2 }, { product_id: P('Coca-Cola').id, qty: 2, note: 'no ice' }], send_to_kitchen: true });
  assert.strictEqual(ord.total, 220); ok('table order created & sent: 220');
  let kds = await api('GET', '/pos/kitchen?station=kitchen'); assert(kds.some(t => t.order_id === ord.id)); ok('kitchen display shows ticket');
  const bardisp = await api('GET', '/pos/kitchen?station=bar'); assert(bardisp.some(t => t.order_id === ord.id)); ok('bar display shows drinks');
  await api('POST', `/pos/kitchen/orders/${ord.id}`, { status: 'ready', station: 'kitchen' }); ok('kitchen marked ready');
  await api('POST', '/pos/orders', { session_id: rs.id, table_id: table.id, lines: [] }, true); ok('double-booking a table rejected');
  // add a line
  const upd = await api('PUT', `/pos/orders/${ord.id}`, { lines: [...ord.lines.map(l => ({ id: l.id, product_id: l.product_id, qty: l.qty, note: l.note })), { product_id: P('Papa').id, qty: 1 }] });
  assert.strictEqual(upd.total, 265); ok('item added to table: 265');
  const paid = await api('POST', `/pos/orders/${ord.id}/pay`, { payments: [{ method_id: M('Card').id, amount: 165 }, { method_id: M('Cash').id, amount: 100 }] });
  ok('table paid split card+cash ' + paid.number);

  // bar tab
  const bs = await api('POST', '/pos/sessions/open', { terminal_id: bar.id, opening_cash: 200 });
  const tab = await api('POST', '/pos/orders', { session_id: bs.id, tab_name: 'Lerato', lines: [{ product_id: P('Maluti Lager').id, qty: 4 }] });
  const tabs = await api('GET', '/pos/orders?status=open&tabs=1'); assert(tabs.some(t => t.id === tab.id)); ok('bar tab opened (4 beers = ' + tab.total + ')');
  await api('POST', `/pos/orders/${tab.id}/pay`, { payments: [{ method_id: M('EcoCash').id, amount: 88, reference: 'EC123' }] }); ok('bar tab paid with EcoCash');

  // charge to account
  const cust = (await api('GET', '/partners?q=Thabo'))[0];
  await api('POST', '/pos/checkout', { session_id: sess.id, partner_id: cust.id, lines: [{ product_id: P('Dishwashing').id, qty: 2 }], payments: [{ method_id: M('Customer Account').id, amount: 70 }] });
  let bal = await api('GET', `/partners/${cust.id}/balance`); assert.strictEqual(bal.receivable, 70); ok('charged to customer account, AR 70');
  await api('POST', '/customer-payments', { partner_id: cust.id, method_id: M('Cash').id, amount: 70 });
  bal = await api('GET', `/partners/${cust.id}/balance`); assert.strictEqual(bal.receivable, 0); ok('customer settled account');

  // refund 1 bread
  const full = await api('GET', `/pos/orders/${co.order_id}`);
  const breadLine = full.lines.find(l => l.name.startsWith('White Bread'));
  const rf = await api('POST', `/pos/orders/${co.order_id}/refund`, { lines: [{ line_id: breadLine.id, qty: 1 }], method_id: M('Cash').id });
  assert.strictEqual(rf.amount, 18); ok('refund 1 bread: 18');
  await api('POST', `/pos/orders/${co.order_id}/refund`, { lines: [{ line_id: breadLine.id, qty: 2 }], method_id: M('Cash').id }, true); ok('over-refund rejected');

  // VAS
  await api('PUT', '/vas/plugins/vas-sandbox', { enabled: true, values: { commission_pct: 5, latency_ms: 50 } });
  const cat2 = await api('GET', '/pos/catalog'); assert(cat2.vas.length === 1 && cat2.vas[0].services.length === 3); ok('VAS sandbox enabled, services listed');
  const lk = await api('POST', '/vas/lookup', { plugin_id: 'vas-sandbox', service: 'electricity', recipient: '04040404040' }); assert(lk.ok); ok('meter lookup: ' + lk.name);
  const elec = await api('POST', '/vas/purchase', { plugin_id: 'vas-sandbox', service: 'electricity', provider: 'LEC', recipient: '04040404040', amount: 100, session_id: sess.id, payments: [{ method_id: M('Cash').id, amount: 100 }] });
  assert(elec.token); ok('electricity sold, token ' + elec.token);
  const air = await api('POST', '/vas/purchase', { plugin_id: 'vas-sandbox', service: 'airtime', provider: 'VCL', recipient: '58001234', amount: 20, session_id: sess.id, payments: [{ method_id: M('Cash').id, amount: 50 }] });
  ok('airtime sold ' + air.number);
  await api('POST', '/vas/purchase', { plugin_id: 'vas-sandbox', service: 'airtime', provider: 'VCL', recipient: '58000000', amount: 20, session_id: sess.id, payments: [{ method_id: M('Cash').id, amount: 20 }] }, true); ok('declined VAS returns error, no sale');

  // mobile money push plugin
  await api('PUT', '/vas/plugins/momo-sandbox', { enabled: true, values: { approve_after_ms: 10 } });
  const pr = await api('POST', '/vas/payments/request', { method_id: M('M-Pesa').id, phone: '58001234', amount: 10 }, true); // method has no plugin yet
  await api('PUT', `/payment-methods/${M('M-Pesa').id}`, { plugin_id: 'momo-sandbox' });
  const push = await api('POST', '/vas/payments/request', { method_id: M('M-Pesa').id, phone: '58001234', amount: 10 }); assert.strictEqual(push.status, 'pending');
  await new Promise(r => setTimeout(r, 30));
  const pst = await api('POST', '/vas/payments/status', { method_id: M('M-Pesa').id, provider_ref: push.provider_ref }); assert.strictEqual(pst.status, 'success'); ok('mobile money push approved');

  // purchasing
  const supp = (await api('GET', '/partners?is_supplier=1'))[0];
  const beforeQty = (await api('GET', `/products/${P('Coca-Cola').id}`)).stock_qty;
  const po = await api('POST', '/purchases', { supplier_id: supp.id, lines: [{ product_id: P('Coca-Cola').id, qty: 24, unit_cost: 7.5, tax_rate: 15 }, { description: 'Delivery fee', qty: 1, unit_cost: 50, tax_rate: 15 }] });
  await api('POST', `/purchases/${po.id}/confirm`);
  await api('POST', `/purchases/${po.id}/receive`, {});
  const afterQty = (await api('GET', `/products/${P('Coca-Cola').id}`)).stock_qty;
  assert.strictEqual(afterQty - beforeQty, 24); ok('PO received, stock +24');
  const bill = await api('POST', `/purchases/${po.id}/bill`);
  await api('POST', `/invoices/${bill.id}/post`);
  const bd = await api('GET', `/invoices/${bill.id}`); assert.strictEqual(bd.total, round(24 * 7.5 * 1.15 + 57.5)); ok('bill posted ' + bd.number + ' total ' + bd.total);
  await api('POST', `/invoices/${bill.id}/payments`, { method_id: M('Card').id, amount: bd.total }); ok('bill paid');

  // customer invoice
  const inv = await api('POST', '/invoices', { kind: 'customer_invoice', partner_id: cust.id, lines: [{ product_id: P('Maize Meal').id, qty: 10, unit_price: 65, tax_rate: 15 }] });
  await api('POST', `/invoices/${inv.id}/post`);
  await api('POST', `/invoices/${inv.id}/payments`, { method_id: M('Cash').id, amount: 300 });
  const id2 = await api('GET', `/invoices/${inv.id}`); assert.strictEqual(id2.status, 'partial'); ok('customer invoice ' + id2.number + ' partially paid');
  const aged = await api('GET', '/reports/aged'); assert(aged.length); ok('aged receivables');

  await api('POST', '/expenses', { amount: 115, tax_rate: 15, account_code: '6300', method_id: M('Cash').id, description: 'Electricity bill' }); ok('expense recorded');
  await api('POST', '/inventory/adjust', { lines: [{ product_id: P('Savanna').id, counted_qty: 45 }], reason: 'Count' }); ok('stock adjusted');

  // accounting integrity
  const tb = await api('GET', '/reports/tb?from=2000-01-01&to=2999-12-31');
  assert.strictEqual(tb.debit, tb.credit); ok(`trial balance balanced: ${tb.debit}`);
  const bs2 = await api('GET', '/reports/bs');
  assert(Math.abs(bs2.total_assets - bs2.total_liabilities - bs2.total_equity) < 0.01); ok(`balance sheet balances: assets ${bs2.total_assets}`);
  const pl = await api('GET', '/reports/pl'); ok(`P&L today: income ${pl.total_income}, expense ${pl.total_expense}, profit ${pl.net_profit}`);
  const vat = await api('GET', '/reports/vat'); ok(`VAT: output ${vat.output_vat}, input ${vat.input_vat}, net ${vat.net_payable}`);

  // close session
  const summ = await api('GET', `/pos/sessions/${sess.id}`);
  const closed = await api('POST', `/pos/sessions/${sess.id}/close`, { counted_cash: summ.expected_cash_now - 5 });
  assert.strictEqual(closed.difference, -5); ok(`session closed, expected ${summ.expected_cash_now}, short 5`);
  const tb2 = await api('GET', '/reports/tb?from=2000-01-01&to=2999-12-31'); assert.strictEqual(tb2.debit, tb2.credit); ok('still balanced after cash short');

  const dash = await api('GET', '/dashboard'); ok(`dashboard: today ${dash.today.sales.total} over ${dash.today.sales.orders} orders`);
  const html = await api('GET', '/reports/eod'); assert(html.includes('End of Day')); ok('EOD html report generated');

  if (smtpPort) {
    await api('PUT', '/settings/email', { smtp_host: '127.0.0.1', smtp_port: smtpPort, smtp_secure: false, from_address: 'erp@test.local', recipients: 'owner@test.local, manager@test.local', eod_enabled: true, eod_time: '21:00' });
    const sent = await api('POST', '/email/eod', {});
    assert.strictEqual(sent.recipients.length, 2);
    await new Promise(r => setTimeout(r, 200));
    assert(mails.length && mails[0].includes('End of Day')); ok('EOD email delivered to ' + sent.recipients.join(', '));
  }

  // ================= SALES RECONCILIATION =================
  const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  // a second M-Pesa sale re-using a reference → should be flagged as duplicate
  await api('POST', '/pos/checkout', { session_id: bs.id, lines: [{ product_id: P('Still Water').id, qty: 1 }], payments: [{ method_id: M('M-Pesa').id, amount: 12, reference: 'QK7H2X9' }] });
  let rc = await api('GET', `/recon/${todayStr}`);
  assert.strictEqual(rc.status, 'not_started');
  const L = n => rc.lines.find(l => l.name === n);
  assert.strictEqual(L('Cash').already_posted, -5); assert.strictEqual(L('Cash').suggested_actual, round(L('Cash').expected - 5));
  assert(!rc.lines.some(l => l.kind === 'account')); assert(rc.account_charges.amount > 0);
  ok(`recon computed: cash expected ${L('Cash').expected} (session short -5 already posted), card ${L('Card').expected}, M-Pesa ${L('M-Pesa').expected}`);
  const tx = await api('GET', `/recon/${todayStr}/transactions?method_id=${M('M-Pesa').id}`);
  assert(tx.filter(t => t.reference === 'QK7H2X9').every(t => t.duplicate_count === 2)); ok('duplicate mobile-money reference flagged');
  const inputs = rc.lines.map(l => ({ method_id: l.method_id, actual: l.name === 'Card' ? round(l.expected - 10) : l.name === 'Cash' ? l.suggested_actual : l.expected, note: l.name === 'Card' ? 'bank charges' : '' }));
  rc = await api('PUT', `/recon/${todayStr}`, { lines: inputs, notes: 'Checked statements' });
  assert.strictEqual(rc.status, 'draft'); ok('recon saved as draft, variance ' + rc.variance_total);
  await api('POST', '/users', { name: 'Ann Accountant', username: 'ann', password: 'ann12345', role: 'accountant' });
  const adminTok = token;
  token = (await api('POST', '/login', { username: 'ann', password: 'ann12345' })).token;
  rc = await api('POST', `/recon/${todayStr}/submit`, { lines: inputs });
  assert.strictEqual(rc.status, 'submitted'); ok('accountant submitted recon');
  await api('POST', `/recon/${todayStr}/approve`, {}, true); ok('preparer cannot approve own recon');
  await api('PUT', `/recon/${todayStr}`, { lines: inputs }, true); ok('submitted recon is locked');
  token = adminTok;
  rc = await api('POST', `/recon/${todayStr}/approve`, { notes: 'OK' });
  assert.strictEqual(rc.status, 'approved'); assert(rc.recon.adjust_entry_id);
  const je = await api('GET', `/journal/${rc.recon.adjust_entry_id}`);
  const short = je.lines.find(l => l.code === '6900'); assert.strictEqual(short.debit, 10);
  assert(!je.lines.some(l => l.code === '1000')); ok('approved: card short 10 posted to 6900, cash not double-posted');
  let tb3 = await api('GET', '/reports/tb?from=2000-01-01&to=2999-12-31'); assert.strictEqual(tb3.debit, tb3.credit); ok('trial balance balanced after recon');
  const rlist = await api('GET', '/recon?days=7'); assert(rlist.find(r => r.date === todayStr && r.status === 'approved')); ok('recon list shows approved day');
  rc = await api('POST', `/recon/${todayStr}/reopen`); assert.strictEqual(rc.status, 'draft');
  tb3 = await api('GET', '/reports/tb?from=2000-01-01&to=2999-12-31'); assert.strictEqual(tb3.debit, tb3.credit);
  const acc6900 = (await api('GET', '/accounts')).find(a => a.code === '6900'); assert.strictEqual(acc6900.balance, 5); ok('reopen reversed the adjustment (6900 back to session short of 5)');
  rc = await api('POST', `/recon/${todayStr}/submit`, { lines: inputs }); rc = await api('POST', `/recon/${todayStr}/approve`, {}); ok('re-approved');

  // ================= CRM =================
  const bday = new Date(Date.now() + 3 * 86400000); const bdStr = `1990-${String(bday.getMonth() + 1).padStart(2, "0")}-${String(bday.getDate()).padStart(2, "0")}`;
  await api('PUT', `/partners/${cust.id}`, { tags: 'vip, regular', birthday: bdStr, contact_person: 'Thabo' });
  const clist = await api('GET', '/crm/customers?sort=spent');
  assert.strictEqual(clist[0].id, cust.id); ok(`CRM customers sorted by spend: top ${clist[0].name} ${clist[0].total_spent}`);
  assert((await api('GET', '/crm/customers?tag=vip')).length === 1); ok('tag filter');
  const c360 = await api('GET', `/crm/customers/${cust.id}`);
  assert.strictEqual(c360.monthly.length, 12); assert(c360.favourites.some(f => f.name.startsWith('Dishwashing')));
  assert(c360.stats.total_spent > 700 && c360.stats.balance > 0); ok(`customer 360: spent ${c360.stats.total_spent}, balance ${c360.stats.balance}, ${c360.favourites.length} favourites`);
  const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 16);
  const task = await api('POST', '/crm/activities', { partner_id: cust.id, type: 'call', subject: 'Follow up on overdue invoice', due_at: yest });
  await api('POST', '/crm/activities', { partner_id: cust.id, type: 'note', subject: 'Prefers EcoCash' });
  let sum = await api('GET', '/crm/summary');
  assert.strictEqual(sum.overdue, 1); assert(sum.birthdays.some(b => b.id === cust.id)); ok('overdue follow-up and upcoming birthday detected');
  assert.strictEqual((await api('GET', '/dashboard')).crm.overdue, 1);
  await api('PUT', `/crm/activities/${task.id}`, { done: true });
  sum = await api('GET', '/crm/summary'); assert.strictEqual(sum.overdue, 0); ok('activity completed');
  if (smtpPort) {
    const before = mails.length;
    await api('POST', `/crm/customers/${cust.id}/email`, { subject: 'Your statement', body: 'Hi Thabo, please find...' });
    await new Promise(r => setTimeout(r, 200)); assert(mails.length === before + 1);
    assert((await api('GET', `/crm/customers/${cust.id}`)).activities.some(a => a.type === 'email')); ok('email sent to customer & logged');
  }

  // ================= COMPANY LOGO =================
  const png = 'data:image/png;base64,' + require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'build', 'icon.png')).toString('base64');
  await api('PUT', '/settings-logo', { data_url: 'data:image/svg+xml;base64,PHN2Zz4=' }, true); ok('non PNG/JPEG logo rejected');
  await api('PUT', '/settings-logo', { data_url: 'data:image/png;base64,' + Buffer.from('not an image').toString('base64') }, true); ok('fake PNG rejected');
  const up = await api('PUT', '/settings-logo', { data_url: png }); assert(up.version);
  const comp = await api('GET', '/company'); assert.strictEqual(comp.logo_version, up.version);
  const lr = await fetch(base + '/api/company/logo'); assert.strictEqual(lr.headers.get('content-type'), 'image/png'); assert((await lr.arrayBuffer()).byteLength > 1000);
  assert((await api('GET', '/pos/catalog')).company.logo_version === up.version); ok('logo uploaded, served publicly and announced to tills');
  if (smtpPort) {
    const before = mails.length; await api('POST', '/email/eod', {}); await new Promise(r => setTimeout(r, 200));
    assert(mails[before].includes('cid:company-logo') && mails[before].includes('Content-ID: <company-logo>')); ok('EOD email carries the logo inline');
  }

  // ================= HR & PAYROLL (Lesotho PAYE) =================
  {
  const calc = async (t, period = '2026-11') => (await api('GET', `/hrm/paye-calc?taxable=${t}&period=${period}`)).paye;
  assert.strictEqual(await calc(5100), 0); assert.strictEqual(await calc(6480), 276); assert.strictEqual(await calc(10000), 1332);
  ok('PAYE matches RSL 2026/27 guide examples (5,100→0, 6,480→276, 10,000→1,332)');
  assert.strictEqual(await calc(10000, '2026-03'), round(6170 * 0.2 + 3830 * 0.3 - 970)); ok('2025/26 table used for March 2026');
  const depts = await api('GET', '/hrm/departments'); assert(depts.length >= 5);
  const e1 = await api('POST', '/hrm/employees', { first_name: 'Palesa', last_name: 'Mokoena', department_id: depts[0].id, job_title: 'Cashier', basic_salary: 8000, hire_date: '2025-01-10', pay_method: 'bank', id_number: '0123456789', tin: 'TIN-1' });
  const e2 = await api('POST', '/hrm/employees', { first_name: 'Teboho', last_name: 'Ralebitso', job_title: 'Chef', basic_salary: 12000, hire_date: '2026-11-16', pay_method: 'mobile_money', mobile_money_number: '58001111' });
  const e3 = await api('POST', '/hrm/employees', { first_name: 'Lineo', last_name: 'Sello', job_title: 'Waiter', basic_salary: 4500, hire_date: '2024-05-01', pay_method: 'cash', paye_applies: 1 });
  await api('POST', `/hrm/employees/${e1.id}/pay-items`, { kind: 'earning', name: 'Transport allowance', amount: 500, taxable: 1 });
  await api('POST', `/hrm/employees/${e1.id}/pay-items`, { kind: 'deduction', name: 'Pension fund', amount: 400, pre_tax: 1 });
  await api('POST', `/hrm/employees/${e1.id}/pay-items`, { kind: 'deduction', name: 'Staff loan', amount: 300, pre_tax: 0 });
  const emp1 = await api('GET', `/hrm/employees/${e1.id}`); assert.strictEqual(emp1.pay_preview.taxable, 8100);
  ok(`employees created; Palesa preview gross ${emp1.pay_preview.gross}, PAYE ${emp1.pay_preview.paye}, net ${emp1.pay_preview.net}`);
  const lt = await api('GET', '/hrm/leave-types');
  const lv = await api('POST', '/hrm/leave', { employee_id: e1.id, leave_type_id: lt[0].id, start_date: '2026-11-02', end_date: '2026-11-06' });
  assert.strictEqual(lv.days, 5);
  await api('POST', '/hrm/leave', { employee_id: e1.id, leave_type_id: lt[0].id, start_date: '2026-11-04', end_date: '2026-11-05' }, true); ok('overlapping leave rejected');
  await api('POST', `/hrm/leave/${lv.id}/approve`, {});
  const lbal = (await api("GET", `/hrm/employees/${e1.id}`)).leave_balances.find(b => b.id === lt[0].id); assert.strictEqual(Number(lbal.balance), 7); ok('leave approved, balance 12 → 7 days');
  const run = await api('POST', '/hrm/payroll', { period: '2026-11', pay_date: '2026-11-28' });
  await api('POST', `/hrm/payroll/${run.id}/adjustments`, { employee_id: e3.id, kind: 'earning', name: 'Overtime', amount: 600, taxable: 1 });
  let pr = await api('GET', `/hrm/payroll/${run.id}`);
  const S = n => pr.payslips.find(p => p.name.startsWith(n));
  // Palesa: gross 8500, taxable 8500-400 = 8100 → 6480*.2 + 1620*.3 - 1020 = 762
  assert.strictEqual(S('Palesa').gross, 8500); assert.strictEqual(S('Palesa').taxable_income, 8100); assert.strictEqual(S('Palesa').paye, 762); assert.strictEqual(S('Palesa').net, 8500 - 762 - 700);
  // Teboho joined 16 Nov: 15/30 of 12000 = 6000 → 1200-1020 = 180
  assert.strictEqual(S('Teboho').gross, 6000); assert.strictEqual(S('Teboho').paye, 180);
  // Lineo 4500 + 600 overtime = 5100 → 0
  assert.strictEqual(S('Lineo').paye, 0);
  ok(`payroll ${pr.period}: ${pr.employees} payslips, gross ${pr.gross_total}, PAYE ${pr.paye_total}, net ${pr.net_total} (pro-rata joiner, pension pre-tax, overtime)`);
  await api('PUT', `/hrm/payroll/${run.id}`, { paye_enabled: false }); pr = await api('GET', `/hrm/payroll/${run.id}`);
  assert.strictEqual(pr.paye_total, 0); ok('PAYE switched off for the run → no PAYE');
  await api('PUT', `/hrm/payroll/${run.id}`, { paye_enabled: true }); pr = await api('GET', `/hrm/payroll/${run.id}`); assert.strictEqual(pr.paye_total, 942);
  await api('POST', `/hrm/payroll/${run.id}/approve`);
  await api('POST', `/hrm/payroll/${run.id}/adjustments`, { employee_id: e3.id, kind: 'earning', name: 'x', amount: 1 }, true); ok('approved run is locked');
  await api('POST', `/hrm/payroll/${run.id}/pay`, {});
  let acc = await api('GET', '/accounts'); const A = c => acc.find(a => a.code === c).balance;
  assert.strictEqual(A('2200'), 942); assert.strictEqual(A('2300'), 0); assert.strictEqual(A('2210'), 700);
  ok('payroll posted: PAYE payable 942, deductions payable 700, net salaries cleared');
  const rep = await api('GET', '/hrm/paye-report?period=2026-11'); assert.strictEqual(rep.totals.paye, 942); assert.strictEqual(rep.due_date, '2026-12-15'); ok('PAYE return report, due 15 Dec');
  await api('POST', '/hrm/paye-remit', { period: '2026-11', amount: 942 }); acc = await api('GET', '/accounts'); assert.strictEqual(A('2200'), 0); ok('PAYE remitted to RSL');
  const tbh = await api('GET', '/reports/tb?from=2000-01-01&to=2999-12-31'); assert.strictEqual(tbh.debit, tbh.credit); ok('books balance after payroll');
  await api('PUT', '/hrm/settings', { enabled: false });
  await api('GET', '/hrm/employees', null, true); assert.strictEqual((await api('GET', '/hrm/status')).enabled, false); ok('HR module switched off → HR screens blocked');
  await api('PUT', '/hrm/settings', { enabled: true, paye_enabled: false });
  const run2 = await api('POST', '/hrm/payroll', { period: '2026-12' }); assert.strictEqual((await api('GET', `/hrm/payroll/${run2.id}`)).paye_total, 0); ok('company-wide PAYE off → new runs without PAYE');
  await api('PUT', '/hrm/settings', { paye_enabled: true });

  }
  // ================= RECEIPT QR / WALLETS / PAY-BY-QR =================
  {
    const so = await api('POST', '/pos/sessions/open', { terminal_id: retail.id, opening_cash: 0 });
    const sale = await api('POST', '/pos/checkout', { session_id: so.id, partner_id: cust.id, lines: [{ product_id: P('White Bread').id, qty: 2 }], payments: [{ method_id: M('Cash').id, amount: 50 }] });
    assert(sale.order.receipt_url && /\/r\/[A-Za-z0-9_-]{24}$/.test(sale.order.receipt_url) && sale.order.receipt_qr_svg.startsWith('<svg')); ok('paid receipt carries a QR to ' + sale.order.receipt_url.replace(/[^/]+$/, '…'));
    const tokenPath = new URL(sale.order.receipt_url).pathname;
    let page = await (await fetch(base + tokenPath)).text(); assert(page.includes(sale.number) && page.includes('White Bread')); ok('public digital receipt page opens without login');
    assert.strictEqual((await fetch(base + '/r/AAAAAAAAAAAAAAAAAAAAAAAA')).status, 404); ok('unknown receipt token → 404');
    const { generateKeyPairSync, createVerify } = require('crypto');
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    await api('PUT', '/vas/plugins/google-wallet', { enabled: true, values: { issuer_id: '3388000000012345678', service_account_email: 'wallet@shop.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) } });
    await api('PUT', '/vas/plugins/samsung-wallet', { enabled: true, values: { card_id: 'card123', certificate_id: 'AB12' } });
    page = await (await fetch(base + tokenPath)).text();
    const gl = page.match(/https:\/\/pay\.google\.com\/gp\/v\/save\/([\w-]+\.[\w-]+\.[\w-]+)/); assert(gl);
    const [h, pl, sg] = gl[1].split('.'); assert(createVerify('RSA-SHA256').update(`${h}.${pl}`).verify(publicKey, Buffer.from(sg, 'base64url')));
    const claims = JSON.parse(Buffer.from(pl, 'base64url')); assert.strictEqual(claims.typ, 'savetowallet'); assert.strictEqual(claims.payload.genericObjects[0].barcode.value, sale.order.receipt_url);
    ok('Google Wallet button: valid RS256 save-to-wallet JWT with receipt QR');
    assert(page.includes('https://a.swallet.link/atw/v3/AB12/card123#Clip?pdata=')); ok('Samsung Wallet button link built from Partner Portal IDs');
    await api('PUT', `/payment-methods/${M('M-Pesa').id}`, { qr_payload: 'MPESA|TILL=123456|AMT={amount}|REF={reference}', qr_label: 'Scan to pay with M-Pesa – till 123456' });
    const tabo = await api('POST', '/pos/orders', { session_id: so.id, tab_name: 'QR test', lines: [{ product_id: P('Coca-Cola').id, qty: 2 }] });
    const bill = await api('GET', `/pos/orders/${tabo.id}/bill`);
    assert(bill.qrs.length === 1 && bill.qrs[0].payload === `MPESA|TILL=123456|AMT=30.00|REF=BILL${tabo.id}`); ok('bill shows M-Pesa pay-by-QR with amount & reference');
    const inv2 = await api('POST', '/invoices', { kind: 'customer_invoice', partner_id: cust.id, lines: [{ description: 'Catering', qty: 1, unit_price: 100, tax_rate: 15 }] });
    await api('POST', `/invoices/${inv2.id}/post`); const iq = await api('GET', `/invoices/${inv2.id}/pay-qr`);
    assert(iq[0].payload.includes('AMT=115.00')); ok('invoice pay-by-QR for amount due');
    await api('PUT', '/settings-qr', { receipt_qr: false }); const s2 = await api('POST', '/pos/checkout', { session_id: so.id, lines: [{ product_id: P('White Bread').id, qty: 1 }], payments: [{ method_id: M('Cash').id, amount: 18 }] });
    assert(!s2.order.receipt_qr_svg); await api('PUT', '/settings-qr', { receipt_qr: true }); ok('receipt QR can be switched off');
    await api('PUT', '/settings-qr', { base_url: 'https://receipts.example.co.ls/' }); const s3 = await api('GET', `/pos/orders/${sale.order_id}`);
    assert(s3.receipt_url.startsWith('https://receipts.example.co.ls/r/')); await api('PUT', '/settings-qr', { base_url: '' }); ok('public receipt address configurable');
    await api('POST', `/pos/orders/${tabo.id}/void`, { reason: 'test' });
  }

  // ================= BUTCHERY =================
  {
    await api('GET', '/butchery/templates', null, true); ok('butchery endpoints blocked while mode is off');
    await api('PUT', '/butchery/settings', { enabled: true, barcode_value_type: 'price' });
    const cats = await api('GET', '/categories');
    const mk = (name, price, cost, extra = {}) => api('POST', '/products', { name, type: 'stock', uom: 'kg', price, cost, tax_id: cats.length && undefined, sold_by_weight: 1, track_batches: 1, shelf_life_days: 5, ...extra });
    const taxes = await api('GET', '/taxes');
    const vat = taxes[0].id;
    const carcass = await mk('Beef carcass (side)', 0, 70, { tax_id: vat, sold_by_weight: 0, pos_visible: 0, shelf_life_days: 10, is_carcass: 1 });
    const rump = await mk('Rump steak', 160, 0, { tax_id: vat, plu: '1001' });
    const mince = await mk('Beef mince', 95, 0, { tax_id: vat, plu: '1002' });
    const stew = await mk('Stewing beef', 85, 0, { tax_id: vat, plu: '1003' });
    const bones = await mk('Soup bones', 15, 0, { tax_id: vat, plu: '1004', shelf_life_days: 3 });
    const supp = (await api('GET', '/partners?is_supplier=1'))[0];
    const po2 = await api('POST', '/purchases', { supplier_id: supp.id, lines: [{ product_id: carcass.id, qty: 100, unit_cost: 70, tax_rate: 0 }] });
    await api('POST', `/purchases/${po2.id}/confirm`);
    const pod = await api('GET', `/purchases/${po2.id}`);
    await api('POST', `/purchases/${po2.id}/receive`, { lines: [{ line_id: pod.lines[0].id, qty: 100, batch_no: 'ABT-2211', expiry_date: '2026-11-20' }] });
    let bs = await api('GET', `/butchery/batches?product_id=${carcass.id}`); assert(bs.length === 1 && bs[0].batch_no === 'ABT-2211' && Number(bs[0].qty_remaining) === 100); ok('carcass received into batch ABT-2211 (100 kg)');
    const tpl = await api('POST', '/butchery/templates', { name: 'Beef side – standard', source_product_id: carcass.id, lines: [
      { product_id: rump.id, yield_pct: 15 }, { product_id: mince.id, yield_pct: 30 }, { product_id: stew.id, yield_pct: 25 }, { product_id: bones.id, yield_pct: 15 }, { name: 'Fat & trim', yield_pct: 15, is_waste: 1 }] });
    await api('POST', '/butchery/templates', { name: 'bad', source_product_id: carcass.id, lines: [{ product_id: rump.id, yield_pct: 80 }, { product_id: mince.id, yield_pct: 30 }] }, true); ok('cutting template saved; >100% yield rejected');
    await api('POST', '/butchery/breakdowns', { source_product_id: carcass.id, source_qty: 150, lines: [{ product_id: rump.id, actual_qty: 10 }] }, true); ok('cannot cut more than is in stock');
    const brk = await api('POST', '/butchery/breakdowns', { template_id: tpl.id, source_product_id: carcass.id, source_qty: 100, source_batch_id: bs[0].id, lines: [
      { product_id: rump.id, expected_qty: 15, actual_qty: 14.5 }, { product_id: mince.id, expected_qty: 30, actual_qty: 31 }, { product_id: stew.id, expected_qty: 25, actual_qty: 24 },
      { product_id: bones.id, expected_qty: 15, actual_qty: 16 }, { name: 'Fat & trim', is_waste: 1, expected_qty: 15, actual_qty: 13 }] });
    const bd = await api('GET', `/butchery/breakdowns/${brk.id}`);
    assert.strictEqual(bd.source_cost_total, 7000); assert.strictEqual(Number(bd.waste_qty), 14.5);
    const costSum = bd.lines.reduce((s2, l) => s2 + Number(l.cost_total), 0); assert(Math.abs(costSum - 7000) < 0.01);
    const rl = bd.lines.find(l => l.product_id === rump.id), bl = bd.lines.find(l => l.product_id === bones.id);
    assert(Number(rl.unit_cost) > Number(bl.unit_cost) * 5); ok(`breakdown ${bd.number}: yield ${bd.output_qty_total} kg / 100 kg, cost 7000 split by sale value (rump ${round(rl.unit_cost)}/kg vs bones ${round(bl.unit_cost)}/kg)`);
    assert.strictEqual(Number((await api('GET', `/products/${carcass.id}`)).stock_qty), 0); assert.strictEqual(Number((await api('GET', `/products/${mince.id}`)).stock_qty), 31);
    bs = await api('GET', `/butchery/batches?product_id=${rump.id}`); assert(bs.length === 1 && bs[0].expiry_date); ok('cuts in stock with their own batches & sell-by dates');
    // till: price-embedded label (rump 1.235 kg = 197.60) and a weighed sale
    const so = await api('POST', '/pos/sessions/open', { terminal_id: retail.id, opening_cash: 0 });
    const s1 = await api('POST', '/pos/checkout', { session_id: so.id, lines: [{ product_id: rump.id, qty: 1.235, label_total: 197.60 }, { product_id: mince.id, qty: 0.75 }], payments: [{ method_id: M('Cash').id, amount: 300 }] });
    assert.strictEqual(s1.order.total, round(197.60 + 71.25)); ok(`weighed sale: 1.235 kg rump (label M197.60) + 0.75 kg mince = ${s1.order.total}`);
    await api('POST', '/pos/checkout', { session_id: so.id, lines: [{ product_id: rump.id, qty: 1.235, label_total: 250 }], payments: [{ method_id: M('Cash').id, amount: 250 }] }, true); ok('tampered label price rejected');
    bs = await api('GET', `/butchery/batches?product_id=${rump.id}`); assert.strictEqual(Number(bs[0].qty_remaining), 13.265); ok('sale consumed the rump batch (FEFO)');
    // waste
    const w = await api('POST', '/butchery/waste', { lines: [{ product_id: mince.id, qty: 2, reason: 'Spoilage', note: 'fridge 3 warm' }, { product_id: stew.id, qty: 0.5, reason: 'Trimming' }] });
    assert(w.value > 0);
    const wr = await api('GET', '/butchery/waste-report');
    assert(wr.by_reason.find(x => x.reason === 'Spoilage').qty === 2 && wr.breakdown_loss_kg === 14.5); ok(`waste written off (M ${w.value}), report by reason; carcass loss 14.5 kg`);
    let acc5 = (await api('GET', '/accounts')).find(a => a.code === '5150'); assert.strictEqual(acc5.balance, w.value);
    // expiry
    const mb = (await api('GET', `/butchery/batches?product_id=${bones.id}`))[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await api('PUT', `/butchery/batches/${mb.id}`, { expiry_date: tomorrow });
    const exp = await api('GET', '/butchery/batches?status=expiring'); assert(exp.some(b => b.id === mb.id));
    assert((await api('GET', '/dashboard')).expiry.expiring >= 1); ok('batch expiring tomorrow flagged on dashboard');
    await api('POST', `/butchery/batches/${mb.id}/write-off`, { reason: 'Expired' });
    assert.strictEqual(Number((await api('GET', `/butchery/batches/${mb.id}`)).qty_remaining), 0); ok('expired batch written off');
    const trace = await api('GET', `/butchery/batches/${(await api('GET', `/butchery/batches?status=all&product_id=${rump.id}`))[0].id}`); assert(trace.moves.length >= 2); ok('batch trace shows breakdown in and sale out');
    // ---- carcass traceability + production (boerewors) ----
    const abt = (await api('GET', `/butchery/batches?status=all&product_id=${carcass.id}`))[0];
    const fat = await mk('Pork back fat', 0, 40, { tax_id: vat, sold_by_weight: 0, track_batches: 0, pos_visible: 0, opening_qty: 5 });
    const casing = await mk('Sausage casings (hog)', 0, 120, { tax_id: vat, sold_by_weight: 0, track_batches: 0, pos_visible: 0, opening_qty: 2 });
    const spice = await mk('Boerewors spice', 0, 90, { tax_id: vat, sold_by_weight: 0, track_batches: 0, pos_visible: 0, opening_qty: 3 });
    const wors = await mk('Boerewors', 110, 0, { tax_id: vat, plu: '1010', shelf_life_days: 4 });
    const rec = await api('POST', '/butchery/recipes', { name: 'Traditional boerewors', output_product_id: wors.id, output_qty: 10, lines: [
      { product_id: mince.id, kind: 'meat', qty: 7 }, { product_id: fat.id, kind: 'fat', qty: 1.5 }, { name: 'Water', kind: 'water', qty: 1.1 }, { product_id: spice.id, kind: 'spice', qty: 0.3 }, { product_id: casing.id, kind: 'casing', qty: 0.2 }] });
    assert((await api('GET', '/butchery/recipes')).find(r => r.id === rec.id).lines.length === 5); ok('sausage recipe saved: meat, fat, water, spice, casings');
    await api('POST', '/butchery/production', { recipe_id: rec.id, output_product_id: wors.id, output_qty: 13, lines: [{ product_id: mince.id, kind: 'meat', actual_qty: 500 }] }, true); ok('production blocked when an ingredient is short');
    const run = await api('POST', '/butchery/production', { recipe_id: rec.id, output_product_id: wors.id, output_qty: 13.8, run_date: '2026-11-01', lines: [
      { product_id: mince.id, kind: 'meat', planned_qty: 9.8, actual_qty: 10 }, { product_id: fat.id, kind: 'fat', planned_qty: 2.1, actual_qty: 2 }, { name: 'Water', kind: 'water', planned_qty: 1.5, actual_qty: 1.5 },
      { product_id: spice.id, kind: 'spice', planned_qty: 0.42, actual_qty: 0.4 }, { product_id: casing.id, kind: 'casing', planned_qty: 0.28, actual_qty: 0.3 }] });
    const rd = await api('GET', `/butchery/production/${run.id}`);
    const minceCost = rd.lines.find(l => l.product_id === mince.id).cost_total;
    assert.strictEqual(rd.meat_pct, 72.5); assert.strictEqual(Number(rd.cost_total), round(minceCost + 80 + 36 + 36));
    assert.strictEqual(Number((await api('GET', `/products/${wors.id}`)).stock_qty), 13.8);
    ok(`production ${rd.number}: 14.2 kg in → 13.8 kg boerewors, meat content ${rd.meat_pct}%, cost ${rd.cost_total} (${round(rd.cost_total / 13.8)}/kg)`);
    const wb = (await api('GET', `/butchery/batches?product_id=${wors.id}`))[0];
    const org = await api('GET', `/butchery/batches/${wb.id}/origins`);
    const fromCarcass = org.find(o => o.batch_id === abt.id);
    assert(fromCarcass && fromCarcass.depth === 2 && Math.abs(fromCarcass.kg_per_unit - 10 / 13.8) < 0.0001); ok(`boerewors batch traced back to carcass ${abt.batch_no} (${round(fromCarcass.kg_per_unit * 1000)} g of carcass per kg)`);
    await api('POST', '/pos/checkout', { session_id: so.id, lines: [{ product_id: wors.id, qty: 1.38 }], payments: [{ method_id: M('Cash').id, amount: 200 }] });
    const L = await api('GET', `/butchery/trace/${abt.id}`);
    // sold: 1.235 rump + 0.75 mince + 1.38 × 10/13.8 = 1 kg of carcass in the boerewors
    assert(Math.abs(L.totals.sold - 2.985) < 0.002, 'sold ' + L.totals.sold);
    assert(Math.abs(L.totals.loss - 14.5) < 0.002, 'loss ' + L.totals.loss);
    assert(Math.abs(L.totals.waste - 18.5) < 0.002, 'waste ' + L.totals.waste);
    assert(Math.abs(L.unaccounted) < 0.01, 'unaccounted ' + L.unaccounted);
    const minceNode = L.tree.children.find(n => n.product === 'Beef mince');
    assert(minceNode.children[0].product === 'Boerewors' && minceNode.processes.some(p => p.via === 'production'));
    ok(`carcass ${abt.batch_no}: 100 kg = sold ${L.totals.sold} + waste ${L.totals.waste} + bone/fat loss ${L.totals.loss} + in stock ${L.totals.in_stock} (unaccounted ${L.unaccounted} kg)`);
    // carcasses received one by one, each weighed with its own tag
    const po3 = await api('POST', '/purchases', { supplier_id: supp.id, lines: [{ product_id: carcass.id, qty: 120.5, unit_cost: 70, tax_rate: 0 }] });
    await api('POST', `/purchases/${po3.id}/confirm`);
    const p3 = await api('GET', `/purchases/${po3.id}`);
    await api('POST', `/purchases/${po3.id}/receive`, { lines: [{ line_id: p3.lines[0].id, qty: 120.5, pieces: [{ qty: 62.4, batch_no: 'TAG-1' }, { qty: 50 }] }] }, true);
    await api('POST', `/purchases/${po3.id}/receive`, { lines: [{ line_id: p3.lines[0].id, qty: 120.5, pieces: [{ qty: 62.4, batch_no: 'TAG-1' }, { qty: 58.1, batch_no: 'TAG-2' }] }] });
    const tags = (await api('GET', `/butchery/batches?product_id=${carcass.id}`)).map(b => b.batch_no + ':' + Number(b.qty_in)).sort();
    assert.deepStrictEqual(tags, ['TAG-1:62.4', 'TAG-2:58.1']); ok('two carcasses received individually as TAG-1 (62.4 kg) and TAG-2 (58.1 kg); wrong total rejected');
    const cl = await api('GET', '/butchery/carcasses?status=all');
    assert(cl.some(c => c.batch_no === 'ABT-2211') && cl.some(c => c.batch_no === 'TAG-2')); ok('carcass register lists every carcass with % accounted');
    // ---- other animals: starter templates, live weight & dressing %, report by animal ----
    const st0 = await api('GET', '/butchery/starters'); assert.strictEqual(st0.length, 6);
    const inst = await api('POST', '/butchery/starters', { species: ['pork', 'lamb'] });
    assert(inst[0].products_created === 9 && inst[1].products_created === 10);
    assert.strictEqual((await api('POST', '/butchery/starters', { species: ['pork'] }))[0].products_created, 0);
    const porkTpl = (await api('GET', '/butchery/templates')).find(t => t.name === 'Pork carcass – starter');
    assert(porkTpl && porkTpl.lines.length === 9); ok('starter templates for pork & lamb: carcass, cuts (with PLUs) and yields created once');
    const allP = await api('GET', '/products'); const PP = n => allP.find(x => x.name === n);
    const porkC = PP('Pork carcass'); assert(porkC.is_carcass && porkC.species === 'pork' && PP('Pork belly').plu === '2103');
    await api('PUT', `/products/${PP('Pork belly').id}`, { price: 120 }); await api('PUT', `/products/${PP('Pork loin chops').id}`, { price: 140 });
    const po4 = await api('POST', '/purchases', { supplier_id: supp.id, lines: [{ product_id: porkC.id, qty: 156, unit_cost: 45, tax_rate: 0 }] });
    await api('POST', `/purchases/${po4.id}/confirm`);
    const p4 = await api('GET', `/purchases/${po4.id}`);
    await api('POST', `/purchases/${po4.id}/receive`, { lines: [{ line_id: p4.lines[0].id, qty: 156, pieces: [{ qty: 78, batch_no: 'PIG-01', live_weight: 70 }, { qty: 78, batch_no: 'PIG-02' }] }] }, true);
    await api('POST', `/purchases/${po4.id}/receive`, { lines: [{ line_id: p4.lines[0].id, qty: 156, pieces: [{ qty: 78, batch_no: 'PIG-01', live_weight: 104 }, { qty: 78, batch_no: 'PIG-02', live_weight: 100 }] }] });
    const pigs = await api('GET', '/butchery/carcasses?status=all&species=pork');
    assert(pigs.length === 2 && pigs.every(x => x.species === 'pork') && pigs.find(x => x.batch_no === 'PIG-01').dressing_pct === 75);
    ok('pigs received with live weights: PIG-01 78 kg from 104 kg live = 75% dressing; live < carcass rejected');
    const pig1 = pigs.find(x => x.batch_no === 'PIG-01');
    const pbk = await api('POST', '/butchery/breakdowns', { template_id: porkTpl.id, source_product_id: porkC.id, source_qty: 78, source_batch_id: pig1.id,
      lines: porkTpl.lines.map(l => ({ product_id: l.product_id, name: l.name, is_waste: l.is_waste, expected_qty: 78 * l.yield_pct / 100, actual_qty: Math.round(78 * l.yield_pct / 100 * 1000) / 1000 })) });
    await api('POST', '/pos/checkout', { session_id: so.id, lines: [{ product_id: PP('Pork belly').id, qty: 2 }], payments: [{ method_id: M('Cash').id, amount: 240 }] });
    const sr = await api('GET', '/butchery/species-report?from=2000-01-01&to=2999-12-31');
    const pr = sr.rows.find(x => x.species === 'pork');
    assert(pr.carcasses === 2 && pr.dressing_pct === 76.5 && pr.yield_pct === 84 && pr.sold_kg === 2 && pr.sales_net > 200 && pr.gross_margin > 0, JSON.stringify(pr));
    // most pork cuts have no price yet → cost shared by weight: 78 kg × 45 / 65.52 kg of cuts = 53.57/kg
    assert(pbk.cost_split === 'weight' && pbk.warning.includes('Pork leg / gammon') && Math.abs(pr.cogs - 107.14) < 0.02, pbk.warning + ' ' + pr.cogs);
    ok('cuts without a price share the carcass cost by weight (with a warning)');
    ok(`report by animal – pork: 2 carcasses, dressing ${pr.dressing_pct}%, cutting yield ${pr.yield_pct}%, sold ${pr.sold_kg} kg (margin ${pr.gross_margin})`);
    // ---- bar: tots poured from bottles, bottle count by weight ----
    const gin = await api('POST', '/products', { name: 'Gin 750ml', type: 'stock', uom: 'Bottle', price: 280, cost: 150, tax_id: vat, bottle_ml: 750, bottle_empty_g: 500, bottle_full_g: 1205, opening_qty: 6 });
    const tot = await api('POST', '/products', { name: 'Gin tot (25ml)', type: 'consumable', uom: 'Tot', price: 23, tax_id: vat, pour_from_id: gin.id, pour_ml: 25 });
    const bsess = await api('POST', '/pos/sessions/open', { terminal_id: bar.id, opening_cash: 0 }).catch(() => so);
    const ts = await api('POST', '/pos/checkout', { session_id: bsess.id, lines: [{ product_id: tot.id, qty: 4 }], payments: [{ method_id: M('Cash').id, amount: 92 }] });
    assert.strictEqual(Number((await api('GET', `/products/${gin.id}`)).stock_qty), 5.8667); assert.strictEqual(Number(ts.order.cost_total), 20);
    ok('4 gin tots (25 ml) took 100 ml (0.1333 bottle) off the gin stock, cost M20');
    const bt = (await api('GET', '/bar/bottles')).find(b => b.id === gin.id);
    assert(bt.density === 0.94 && bt.measures[0].per_bottle === 30 && bt.measures[0].gp_pct > 70); ok(`bottle setup: density ${bt.density} g/ml, 30 tots per bottle, tot GP ${bt.measures[0].gp_pct}%`);
    assert.strictEqual((await api('POST', '/bar/ml-from-weight', { product_id: gin.id, grams: 1000 })).ml, 531.9); ok('open bottle weighing 1000 g holds 531.9 ml');
    const bc = await api('POST', '/bar/counts', { count_date: '2026-11-01', lines: [{ product_id: gin.id, full_bottles: 5, open_weights: [1000] }] });
    let bcd = await api('GET', `/bar/counts/${bc.id}`);
    assert.strictEqual(Number(bcd.lines[0].counted_qty), 5.7092); assert.strictEqual(Number(bcd.lines[0].variance_ml), -118.1);
    const bpost = await api('POST', `/bar/counts/${bc.id}/post`);
    assert.strictEqual(Number((await api('GET', `/products/${gin.id}`)).stock_qty), 5.7092); assert(bpost.loss > 23 && bpost.loss < 24);
    await api('POST', `/bar/counts/${bc.id}/post`, null, true);
    ok(`bar count by weight: 5 full + 531.9 ml open = 5.7092 bottles, 118.1 ml short (M ${bpost.loss}) posted to wastage`);
    const rf = await api('POST', `/pos/orders/${ts.order_id}/refund`, { lines: [{ line_id: ts.order.lines[0].id, qty: 1 }], method_id: M('Cash').id, session_id: bsess.id });
    assert(rf); assert.strictEqual(Number((await api('GET', `/products/${gin.id}`)).stock_qty), 5.7425); ok('refunded tot returned 25 ml to the bottle stock');
    const tbb = await api('GET', '/reports/tb?from=2000-01-01&to=2999-12-31'); assert.strictEqual(tbb.debit, tbb.credit); ok('books balance after butchery operations');
    await api('PUT', '/butchery/settings', { barcode_item_digits: 6 }, true); ok('invalid barcode layout rejected');
  }

  // permissions
  await api('POST', '/users', { name: 'Cashier Kat', username: 'kat', password: 'kat12345', pin: '4321', role: 'cashier' });
  {
    // ---- pricing rules & promotions ----
    const coke = P('Coca-Cola'), bread = P('White Bread');
    const r1 = await api('POST', '/price-rules', { name: 'Cold drinks 10% off', kind: 'percent', value: 10, applies_to: 'category', category_id: coke.category_id });
    await api('POST', '/price-rules', { name: 'Bread 3 for 2', kind: 'multibuy', applies_to: 'product', product_id: bread.id, min_qty: 3, free_qty: 1 });
    await api('POST', '/price-rules', { name: 'bad', kind: 'multibuy', applies_to: 'product', product_id: bread.id, min_qty: 2, free_qty: 2 }, true);
    await api('POST', '/partners', { name: 'Spar Wholesale Client', is_customer: 1, tags: 'vip, wholesale' });
    const ws = (await api('GET', '/partners?q=Spar Wholesale'))[0];
    await api('POST', '/price-rules', { name: 'Wholesale bread', kind: 'fixed_price', value: 15, applies_to: 'product', product_id: bread.id, customer_scope: 'tag', partner_tag: 'wholesale', on_invoice: 1 });
    const hh = new Date(); const t0 = `${String(hh.getHours()).padStart(2, '0')}:00`, t1 = `${String((hh.getHours() + 1) % 24).padStart(2, '0')}:00`;
    await api('POST', '/price-rules', { name: 'Happy hour', kind: 'amount_off', value: 2, applies_to: 'category', category_id: coke.category_id, time_from: t0, time_to: t1 });
    let pc = await api('GET', `/price-check?product_id=${coke.id}&qty=1`); assert(pc.rule && pc.rule.name === 'Happy hour' && pc.discount_pct > 10, JSON.stringify(pc));
    pc = await api('GET', `/price-check?product_id=${bread.id}&qty=3`); assert.strictEqual(pc.rule.name, 'Bread 3 for 2');
    pc = await api('GET', `/price-check?product_id=${bread.id}&qty=1&partner_id=${ws.id}`); assert.strictEqual(pc.unit_after, 15);
    ok('price rules: category %, multi-buy, wholesale customer price, happy hour – best one wins');
    const ps = await api('POST', '/pos/sessions/open', { terminal_id: retail.id, opening_cash: 0 }).catch(() => sess);
    const sale = await api('POST', '/pos/checkout', { session_id: ps.id || sess.id, lines: [{ product_id: bread.id, qty: 3 }], payments: [{ method_id: M('Cash').id, amount: 100 }] });
    assert.strictEqual(sale.order.total, round(bread.price * 2)); assert(sale.order.lines[0].rule_id); ok(`POS applies "3 for 2" automatically: 3 bread = ${sale.order.total}`);
    const ws2 = await api('POST', '/pos/checkout', { session_id: ps.id || sess.id, partner_id: ws.id, lines: [{ product_id: bread.id, qty: 2 }], payments: [{ method_id: M('Cash').id, amount: 30 }] });
    assert.strictEqual(ws2.order.total, 30); ok('wholesale customer pays 15 a loaf at the till');
    await api('PUT', `/price-rules/${r1.id}`, { ...r1, active: 0 });

    // ---- quotation → sales order → invoice ----
    const q = await api('POST', '/sales', { partner_id: ws.id, valid_until: '2099-12-31', lines: [{ product_id: P('Maize Meal').id, description: 'Maize meal 5kg', qty: 10, unit_price: 65.22, discount_pct: 5, tax_rate: 15 }, { description: 'Delivery to Mafeteng', qty: 1, unit_price: 150, tax_rate: 15 }] });
    assert(q.quote_number.startsWith('Q/') && q.status === 'quote' && q.lines.length === 2);
    assert.strictEqual(Number(q.total), round(round(10 * 65.22 * 0.95 * 1.15) + 172.5)); ok(`quotation ${q.quote_number}: total ${q.total} incl. 5% discount and VAT`);
    await api('POST', `/sales/${q.id}/invoice`, {}, true);
    const so = await api('POST', `/sales/${q.id}/confirm`, { customer_ref: 'PO-7781' }); assert(so.number.startsWith('SO/') && so.status === 'confirmed');
    const stockBefore = Number((await api('GET', `/products/${P('Maize Meal').id}`)).stock_qty);
    const iv = await api('POST', `/sales/${q.id}/invoice`, {});
    const inv = await api('GET', `/invoices/${iv.invoice_id}`); assert.strictEqual(Number(inv.total), Number(q.total));
    await api('POST', `/invoices/${iv.invoice_id}/post`);
    assert.strictEqual(Number((await api('GET', `/products/${P('Maize Meal').id}`)).stock_qty), stockBefore - 10);
    assert.strictEqual((await api('GET', `/sales/${q.id}`)).status, 'invoiced');
    ok(`quotation accepted → ${so.number} → invoice ${inv.total}; stock left on posting`);
    const q2 = await api('POST', '/sales', { partner_id: ws.id, valid_until: '2020-01-01', lines: [{ description: 'Catering', qty: 1, unit_price: 1000, tax_rate: 15 }] });
    assert((await api('GET', `/sales/${q2.id}`)).expired); await api('POST', `/sales/${q2.id}/decline`);
    const sm = await api('GET', '/sales/summary'); assert(Number(sm.lost_90) >= 1); ok('expired quotation flagged, declined, summary counts it');

    // ---- bank / M-Pesa statement reconciliation ----
    const stmt = await api('POST', '/bank-statements', { account_code: '1020', name: 'M-Pesa statement', closing_balance: 0, lines: [
      { date: todayStr, description: 'Payment received QK7H2X9 58001234', reference: 'QK7H2X9', amount: 63 },
      { date: todayStr, description: 'Transaction charge', amount: -4.6 },
      { date: todayStr, description: 'Deposit from Spar Wholesale', reference: 'X1', amount: 250 }] });
    assert.strictEqual(stmt.matched, 1); assert(stmt.lines.find(l => l.amount == 63).journal_line_id);
    const charge = stmt.lines.find(l => Number(l.amount) === -4.6), dep = stmt.lines.find(l => Number(l.amount) === 250);
    await api('POST', `/bank-statements/${stmt.id}/done`, {}, true);
    await api('POST', `/bank-statements/${stmt.id}/lines/${charge.id}/create`, { account_code: '6400', description: 'M-Pesa charges' });
    await api('POST', `/bank-statements/${stmt.id}/lines/${dep.id}/create`, { account_code: '1100' }, true);
    let st2 = await api('POST', `/bank-statements/${stmt.id}/lines/${dep.id}/create`, { account_code: '1100', partner_id: ws.id });
    assert.strictEqual(st2.matched, 3); st2 = await api('POST', `/bank-statements/${stmt.id}/done`); assert.strictEqual(st2.status, 'done');
    ok('M-Pesa statement: sale auto-matched by reference, charges & customer deposit booked from the statement, reconciliation closed');

    // ---- approvals: purchase limit ----
    await api('PUT', '/approvals/settings', { po_limit: 1000 });
    await api('POST', '/users', { name: 'Accountant Nthabi', username: 'nthabi', password: 'nthabi123', role: 'accountant' });
    const adminTok = token;
    token = (await api('POST', '/login', { username: 'nthabi', password: 'nthabi123' })).token;
    const supp = (await api('GET', '/partners?is_supplier=1'))[0];
    const big = await api('POST', '/purchases', { supplier_id: supp.id, lines: [{ product_id: P('Maize Meal').id, qty: 30, unit_cost: 58, tax_rate: 15 }] });
    const cf = await api('POST', `/purchases/${big.id}/confirm`); assert.strictEqual(cf.status, 'to_approve');
    await api('POST', `/purchases/${big.id}/receive`, {}, true);
    // ---- expense claim by the accountant ----
    const claim = await api('POST', '/expense-claims', { description: 'Taxi to Maseru bank', account_code: '6500', amount: 46, paid_by: 'own', receipt: 'data:image/png;base64,iVBORw0KGgo=' });
    await api('POST', `/expense-claims/${claim.id}/approve`, {}, true);
    token = adminTok;
    const ap = await api('GET', '/approvals'); assert(ap.purchase_orders.some(p => p.id === big.id) && ap.expense_claims.some(c => c.id === claim.id));
    await api('POST', `/purchases/${big.id}/approve`); assert.strictEqual((await api('GET', `/purchases/${big.id}`)).status, 'confirmed');
    ok('purchase over the M1,000 limit waits for a manager, then approved');
    await api('POST', `/expense-claims/${claim.id}/approve`);
    let acc = await api('GET', '/accounts'); assert.strictEqual(acc.find(a => a.code === '2250').balance, 46);
    const rb = await api('POST', `/expense-claims/${claim.id}/reimburse`, { method_id: M('Cash').id }); assert.strictEqual(rb.status, 'reimbursed');
    acc = await api('GET', '/accounts'); assert.strictEqual(acc.find(a => a.code === '2250').balance, 0); assert.strictEqual(acc.find(a => a.code === '6500').balance, 46);
    const c2 = await api('POST', '/expense-claims', { description: 'Printer paper', account_code: '6000', amount: 115, tax_rate: 15, paid_by: 'company', company_method_id: M('Cash').id });
    assert.strictEqual((await api('POST', `/expense-claims/${c2.id}/approve`)).status, 'reimbursed');
    ok('expense claims: submitted with receipt, approved by someone else, reimbursed in cash; company-paid claim books straight to cash');

    // ---- attendance ----
    await api('POST', '/users', { name: 'Clock Tester', username: 'clock', password: 'clock123', pin: '2468', role: 'cashier' });
    const ct = (await api('GET', '/pin-users')).find(u => u.name === 'Clock Tester');
    await api('POST', '/attendance/clock', { user_id: ct.id, pin: '0000' }, true);
    const cin = await api('POST', '/attendance/clock', { user_id: ct.id, pin: '2468' }); assert.strictEqual(cin.status, 'in');
    assert((await api('GET', '/attendance/now')).some(a => a.user_id === ct.id));
    const cout = await api('POST', '/attendance/clock', { user_id: ct.id, pin: '2468' }); assert.strictEqual(cout.status, 'out');
    await api('POST', '/attendance', { user_id: ct.id, check_in: '2026-10-05 07:00:00', check_out: '2026-10-05 19:00:00' });
    for (const d of ['06', '07', '08', '09']) await api('POST', '/attendance', { user_id: ct.id, check_in: `2026-10-${d} 08:00:00`, check_out: `2026-10-${d} 17:30:00` });
    const ar = await api('GET', `/attendance?from=2026-10-05&to=2026-10-11&user_id=${ct.id}`);
    const pr = ar.people[0]; assert.strictEqual(pr.hours, 50); assert.strictEqual(pr.overtime_hours, 5);
    ok(`attendance: PIN clock in/out; week of 50 h → ${pr.overtime_hours} h overtime (above 45 h / 9 h a day)`);
    const tb3 = await api('GET', '/reports/tb?from=2000-01-01&to=2999-12-31'); assert.strictEqual(tb3.debit, tb3.credit); ok('books balance after sales, bank recon, claims');
  }
  {
    // ---- store setup guide ----
    let g = await api('GET', '/setup-guide');
    assert(g.steps.length > 10 && g.steps.every(s => s.why && s.how && s.link)); 
    g = await api('PUT', '/setup-guide', { types: ['butchery', 'bar'] });
    assert(g.steps.some(s => s.key === 'firstcut') && g.steps.some(s => s.key === 'measures') && g.steps.some(s => s.key === 'floors')); // ticking types never switches modules off
    assert(g.steps.find(s => s.key === 'butchery_on').done && g.steps.find(s => s.key === 'firstcut').done && g.steps.find(s => s.key === 'company').done !== undefined);
    const before = g.done;
    g = await api('PUT', '/setup-guide', { mark: 'printer' }); assert(g.steps.find(s => s.key === 'printer').done && g.done === before + 1);
    g = await api('PUT', '/setup-guide', { unmark: 'printer' }); assert(!g.steps.find(s => s.key === 'printer').done);
    ok(`setup guide: ${g.total} required steps for butchery + bar, ${g.done} already done from the data; manual steps can be ticked`);
  }
  {
    // ---- business types & modules, branches, transfers, branch profit ----
    let biz = await api('GET', '/business');
    // the setup-guide step above chose butchery + bar, which switched on their modules
    assert(biz.configured && biz.modules.includes('pos') && biz.modules.includes('butchery') && biz.modules.includes('bar') && biz.modules.includes('restaurant') && biz.modules.includes('locations') && biz.all_types.length === 13 && biz.all_modules.some(m => m.coming));
    const sumCheck = async () => { const st = await api('GET', '/locations/stock'); for (const r of st.rows) { const s = Object.values(r.at).reduce((a, x) => a + x.qty, 0); assert(Math.abs(s - r.stock_qty) < 0.001, `${r.name}: locations ${s} vs total ${r.stock_qty}`); } return st; };
    await sumCheck();
    let locs = await api('GET', '/locations'); const MAIN = locs.find(l => l.is_default); const TRANSIT = locs.find(l => l.kind === 'transit');
    assert(MAIN && TRANSIT);
    const TY = await api('POST', '/locations', { name: 'Teyateyaneng branch', code: 'TY', kind: 'branch', phone: '5800 0000' });
    const WH = await api('POST', '/locations', { name: 'Maseru warehouse', kind: 'warehouse' });
    await api('POST', '/locations', { name: 'Again', code: 'TY' }, true);
    assert.strictEqual(WH.code, 'MASERUWA');
    const mm = await api('POST', '/products', { name: 'Maize meal 10kg', type: 'stock', price: 120, cost: 80, tax_id: 1, opening_qty: 50 });
    const qty = async (pid, lid) => { const st = await api('GET', '/locations/stock?q=' + encodeURIComponent((await api('GET', `/products/${pid}`)).name)); return st.rows.find(r => r.id === pid).at[lid].qty; };
    assert.strictEqual(await qty(mm.id, MAIN.id), 50);
    // transfer main → TY: 20 bags, 2 go missing on the way
    let tr = await api('POST', '/transfers', { from_location_id: MAIN.id, to_location_id: TY.id, lines: [{ product_id: mm.id, qty: 20 }], notes: 'Weekly stock' });
    assert.strictEqual(tr.status, 'draft'); assert.strictEqual(Number(tr.lines[0].available), 50);
    await api('POST', '/transfers', { from_location_id: MAIN.id, to_location_id: MAIN.id, lines: [{ product_id: mm.id, qty: 1 }] }, true);
    await api('POST', `/transfers/${tr.id}/receive`, {}, true);
    const sent = await api('POST', `/transfers/${tr.id}/send`, {}); assert(/^TR\/\d{4}\/\d{5}$/.test(sent.number));
    assert.strictEqual(await qty(mm.id, MAIN.id), 30); assert.strictEqual(await qty(mm.id, TRANSIT.id), 20);
    assert.strictEqual(Number((await api('GET', `/products/${mm.id}`)).stock_qty), 50); assert.strictEqual(Number((await api('GET', `/products/${mm.id}`)).cost), 80);
    await api('PUT', `/transfers/${tr.id}`, { from_location_id: MAIN.id, to_location_id: TY.id, lines: [{ product_id: mm.id, qty: 1 }] }, true);
    await api('POST', `/transfers/${tr.id}/receive`, { lines: [{ line_id: tr.lines[0].id, qty_received: 21 }] }, true);
    const rcv = await api('POST', `/transfers/${tr.id}/receive`, { lines: [{ line_id: tr.lines[0].id, qty_received: 18 }] });
    assert.strictEqual(rcv.short_value, 160); assert.strictEqual(rcv.transfer.status, 'received');
    assert.strictEqual(await qty(mm.id, TY.id), 18); assert.strictEqual(await qty(mm.id, TRANSIT.id), 0);
    assert.strictEqual(Number((await api('GET', `/products/${mm.id}`)).stock_qty), 48);
    ok('transfer main → branch via "In transit": 20 sent, 18 received, 2 short written off (M 160), total and average cost kept');
    // too much, and cancelling a sent transfer brings the stock back
    const big = await api('POST', '/transfers', { from_location_id: MAIN.id, to_location_id: WH.id, lines: [{ product_id: mm.id, qty: 100 }] });
    await api('POST', `/transfers/${big.id}/send`, {}, true);
    const back = await api('POST', '/transfers', { from_location_id: MAIN.id, to_location_id: WH.id, lines: [{ product_id: mm.id, qty: 5 }], send: true });
    assert.strictEqual(back.status, 'sent'); assert.strictEqual(await qty(mm.id, MAIN.id), 25);
    await api('POST', `/transfers/${back.id}/cancel`); assert.strictEqual(await qty(mm.id, MAIN.id), 30); assert.strictEqual(await qty(mm.id, TRANSIT.id), 0);
    await api('POST', `/transfers/${tr.id}/cancel`, {}, true);
    ok('sending more than the branch has is refused; cancelling a sent transfer returns the goods');
    // batches keep their number and expiry when they move
    const pills = await api('POST', '/products', { name: 'Paracetamol 500mg x20', type: 'stock', price: 25, cost: 10, tax_id: 1, track_batches: 1, opening_qty: 10 });
    let bt = await api('GET', `/locations/batches?product_id=${pills.id}`); assert.strictEqual(bt.length, 1);
    await api('POST', '/transfers', { from_location_id: MAIN.id, to_location_id: TY.id, lines: [{ product_id: pills.id, qty: 4 }], send: true }).then(t => api('POST', `/transfers/${t.id}/receive`, {}));
    bt = await api('GET', `/locations/batches?product_id=${pills.id}`);
    const btTy = bt.find(b => b.location_id === TY.id), btMain = bt.find(b => b.location_id === MAIN.id);
    assert(btTy && btMain && btTy.batch_no === btMain.batch_no && Number(btTy.qty_remaining) === 4 && Number(btMain.qty_remaining) === 6);
    ok('batch-tracked stock moves with its batch number: 6 at main, 4 at the branch');
    // a till at the branch sells from the branch and its profit shows per branch
    const tyTill = await api('POST', '/terminals', { name: 'TY counter', mode: 'retail', location_id: TY.id });
    const tySess = await api('POST', '/pos/sessions/open', { terminal_id: tyTill.id, opening_cash: 0 });
    await api('POST', '/pos/checkout', { session_id: tySess.id, lines: [{ product_id: mm.id, qty: 3 }], payments: [{ method_id: M('Cash').id, amount: 360 }] });
    assert.strictEqual(await qty(mm.id, TY.id), 15); assert.strictEqual(await qty(mm.id, MAIN.id), 30);
    const br = await api('GET', '/reports/branches?from=2000-01-01&to=2999-12-31');
    const brTy = br.rows.find(x => x.location_id === TY.id);
    assert.strictEqual(brTy.income, round(360 / 1.15)); assert.strictEqual(brTy.cogs, 240 + 160);
    const plTy = await api('GET', `/reports/pl?from=2000-01-01&to=2999-12-31&location_id=${TY.id}`); assert.strictEqual(plTy.total_income, brTy.income);
    ok(`branch till sells from branch stock; branch profit: income ${brTy.income}, cost of sales ${brTy.cogs}`);
    // stock count at one branch only
    const adj = await api('POST', '/inventory/adjust', { location_id: TY.id, reason: 'TY count', lines: [{ product_id: mm.id, counted_qty: 14 }] });
    assert.strictEqual(adj.changes[0].from, 15); assert.strictEqual(await qty(mm.id, TY.id), 14); assert.strictEqual(await qty(mm.id, MAIN.id), 30);
    const val = await api('GET', `/inventory/valuation?location_id=${TY.id}`); assert.strictEqual(Number(val.rows.find(r => r.id === mm.id).stock_qty), 14);
    await api('PUT', `/locations/${TY.id}/levels`, { lines: [{ product_id: mm.id, min_qty: 20, bin: 'A1' }] });
    const low = await api('GET', '/locations/stock?low=1'); assert(low.rows.some(r => r.id === mm.id && r.low.includes(TY.id)));
    await api('DELETE', `/locations/${TY.id}`, null, true); await api('DELETE', `/locations/${MAIN.id}`, null, true);
    await sumCheck();
    ok('stock count per branch, minimum levels per branch, branches with stock cannot be closed; branch totals add up to company stock');
    const tbl = await api('GET', '/reports/tb?from=2000-01-01&to=2999-12-31'); assert.strictEqual(tbl.debit, tbl.credit); ok('books balance after transfers');
    // choose business types → modules and guide follow
    const allMods = biz.modules.slice();
    biz = await api('PUT', '/business', { types: ['wholesale'] });
    assert(biz.configured && biz.modules.includes('locations') && biz.modules.includes('sales') && biz.modules.includes('butchery'));
    let gg = await api('GET', '/setup-guide');
    assert(gg.types.includes('wholesale') && gg.steps.some(s => s.key === 'branches' && s.done) && gg.steps.some(s => s.key === 'pricegroups'));
    biz = await api('PUT', '/business', { modules: biz.modules.filter(m => m !== 'butchery') });
    assert.strictEqual((await api('GET', '/butchery/status')).enabled, false);
    gg = await api('GET', '/setup-guide'); assert(!gg.steps.some(s => s.key === 'firstcut'));
    biz = await api('PUT', '/business', { types: ['services'] }); assert(biz.modules.includes('projects') && biz.modules.includes('locations'));
    gg = await api('GET', '/setup-guide'); assert(gg.steps.some(s => s.key === 'services') && gg.steps.some(s => s.key === 'firstinvoice') && !gg.steps.some(s => s.key === 'pricegroups'));
    biz = await api('PUT', '/business', { types: ['butchery', 'bar'], modules: allMods }); assert.strictEqual((await api('GET', '/butchery/status')).enabled, true);
    ok('business types switch modules on (wholesale → branches, quotes; services → projects) and the setup guide follows');
  }
  {
    // ---- manufacturing: BOM costing, work order, rejects, shortages → PO ----
    const mk = (name, extra) => api('POST', '/products', { name, type: 'stock', tax_id: 1, pos_visible: 0, ...extra });
    const flour = await mk('Bread flour 1kg', { uom: 'kg', cost: 12, opening_qty: 30 }), yeast = await mk('Dry yeast', { uom: 'kg', cost: 100, opening_qty: 1 });
    const loaf = await mk('Brown loaf (own bake)', { price: 15, cost: 0, pos_visible: 1 });
    await api('POST', '/mrp/boms', { product_id: loaf.id, output_qty: 50, lines: [{ product_id: loaf.id, qty: 1 }] }, true);
    const bom = await api('POST', '/mrp/boms', { product_id: loaf.id, name: 'Brown loaf – 50 per mix', output_qty: 50, labour_cost: 100, overhead_cost: 50, shelf_life_days: 4,
      lines: [{ product_id: flour.id, qty: 25 }, { product_id: yeast.id, qty: 0.5, scrap_pct: 2 }] });
    assert.strictEqual(bom.cost.unit, 10.02); assert.strictEqual(bom.cost.material, 351);
    let wo = await api('POST', '/mrp/work-orders', { bom_id: bom.id, qty: 100 });
    assert(/^WO\/\d{4}\/\d{5}$/.test(wo.number)); assert.strictEqual(Number(wo.lines.find(l => l.product_id === flour.id).qty_planned), 50);
    assert.strictEqual(Number(wo.lines.find(l => l.product_id === yeast.id).qty_planned), 1.02); assert.strictEqual(Number(wo.labour_cost), 200);
    assert(wo.short.some(x => x.product_id === flour.id && x.missing === 20));
    const sh = await api('GET', '/mrp/shortages'); assert(sh.find(x => x.product_id === flour.id).missing === 20);
    const supp = (await api('GET', '/partners?is_supplier=1'))[0];
    const spo = await api('POST', '/mrp/shortages/purchase', { supplier_id: supp.id }); assert.strictEqual(spo.lines, 2);
    assert.strictEqual((await api('GET', '/mrp/shortages')).length, 0); // now on order
    await api('POST', `/purchases/${spo.id}/cancel`);
    await api('POST', `/mrp/work-orders/${wo.id}/finish`, { qty_produced: 100 }, true); // not enough flour
    await api('POST', '/inventory/adjust', { reason: 'Flour delivery counted', lines: [{ product_id: flour.id, counted_qty: 60 }, { product_id: yeast.id, counted_qty: 2 }] });
    wo = await api('POST', `/mrp/work-orders/${wo.id}/start`); assert.strictEqual(wo.status, 'in_progress');
    await api('POST', `/mrp/work-orders/${wo.id}/finish`, { qty_produced: 95, qc_status: 'failed' }, true);
    const fin = await api('POST', `/mrp/work-orders/${wo.id}/finish`, { qty_produced: 95, qty_rejected: 5, batch_no: 'BR-001', qc_status: 'passed', qc_notes: 'Crust colour OK',
      lines: [{ line_id: wo.lines.find(l => l.product_id === flour.id).id, qty_used: 49 }] });
    assert.strictEqual(fin.material, 690); assert.strictEqual(fin.total, 990); assert.strictEqual(fin.unit_cost, 9.9); assert.strictEqual(fin.reject_value, 49.5);
    const lp = await api('GET', `/products/${loaf.id}`); assert.strictEqual(Number(lp.stock_qty), 95); assert.strictEqual(Number(lp.cost), 9.9);
    assert.strictEqual(Number((await api('GET', `/products/${flour.id}`)).stock_qty), 11);
    assert.strictEqual(fin.work_order.batch_no, 'BR-001'); assert.strictEqual(fin.work_order.status, 'done');
    await api('POST', `/mrp/work-orders/${wo.id}/finish`, {}, true);
    const acc = await api('GET', '/accounts'); const A = c => (acc.find(a => a.code === c) || {}).balance;
    assert.strictEqual(A('5210'), -300); assert.strictEqual(A('5220'), 49.5);
    const sm = await api('GET', '/mrp/summary'); assert.strictEqual(sm.reject_rate, 5);
    const tbm = await api('GET', '/reports/tb?from=2000-01-01&to=2999-12-31'); assert.strictEqual(tbm.debit, tbm.credit);
    ok('manufacturing: BOM cost M 10.02/loaf; work order of 100 → 95 good + 5 rejects at M 9.90, labour & overhead absorbed, shortages → purchase order, books balance');
  }
  {
    // ---- machines & maintenance, RFQs, make-to-order ----
    const td = new Date(); const ymd = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    const belt = await api('POST', '/products', { name: 'V-belt A42', type: 'stock', cost: 80, price: 0, tax_id: 1, pos_visible: 0, opening_qty: 5 });
    const mixer = await api('POST', '/equipment', { name: 'Spiral dough mixer', code: 'MIX-1', category: 'Bakery', interval_days: 90, serial_no: 'SM-2231' });
    assert(mixer.next_service);
    const mr = await api('POST', '/maintenance', { equipment_id: mixer.id, title: 'Belt slipping, mixer stops', machine_down: 1, priority: 'urgent' });
    assert(/^MR\/\d{4}\/\d{5}$/.test(mr.number));
    assert.strictEqual((await api('GET', '/equipment')).find(e => e.id === mixer.id).status, 'down');
    const bomL = (await api('GET', '/mrp/boms'))[0];
    const wo2 = await api('POST', '/mrp/work-orders', { bom_id: bomL.id, qty: 10, equipment_id: mixer.id });
    await api('POST', `/mrp/work-orders/${wo2.id}/start`, {}, true);
    await api('POST', `/maintenance/${mr.id}/start`);
    const mdone = await api('POST', `/maintenance/${mr.id}/done`, { parts: [{ product_id: belt.id, qty: 2 }], labour_cost: 150, resolution: 'Replaced both belts', downtime_hours: 3 });
    assert.strictEqual(Number(mdone.parts_cost), 160); assert.strictEqual(mdone.status, 'done');
    const mx = (await api('GET', '/equipment')).find(e => e.id === mixer.id);
    assert.strictEqual(mx.status, 'working'); assert.strictEqual(String(mx.last_service).slice(0, 10), ymd(td)); assert.strictEqual(Number(mx.cost_12m), 310);
    assert.strictEqual(Number((await api('GET', `/products/${belt.id}`)).stock_qty), 3);
    await api('POST', `/mrp/work-orders/${wo2.id}/start`); await api('POST', `/mrp/work-orders/${wo2.id}/cancel`);
    await api('PUT', `/equipment/${mixer.id}`, { next_service: ymd(td) });
    assert.strictEqual((await api('POST', '/maintenance/schedule', { days: 7 })).created.length, 1);
    assert.strictEqual((await api('POST', '/maintenance/schedule', { days: 7 })).created.length, 0);
    ok('maintenance: breakdown stops the machine (work orders blocked), repair books 2 belts (M 160) to repairs, service due → scheduled job once');
    // RFQ to two suppliers, best price per line → one purchase order per supplier
    const sA = await api('POST', '/partners', { name: 'Lesotho Flour Mills', is_supplier: 1, is_customer: 0 }), sB = await api('POST', '/partners', { name: 'Bakers Supply SA', is_supplier: 1, is_customer: 0 });
    const prods = await api('GET', '/products'); const PP = n => prods.find(p => p.name === n);
    let rq = await api('POST', '/rfqs', { supplier_ids: [sA.id, sB.id], deadline: ymd(td), lines: [{ product_id: PP('Bread flour 1kg').id, qty: 100 }, { product_id: PP('Dry yeast').id, qty: 2 }] });
    assert(/^RFQ\//.test(rq.number) && rq.suppliers.length === 2);
    rq = (await api('POST', `/rfqs/${rq.id}/send`, {})).rfq; assert.strictEqual(rq.status, 'sent');
    const [lF, lY] = rq.lines;
    await api('POST', `/rfqs/${rq.id}/quotes`, { partner_id: sA.id, prices: [{ line_id: lF.id, unit_cost: 11 }, { line_id: lY.id, unit_cost: 95 }] });
    rq = await api('POST', `/rfqs/${rq.id}/quotes`, { partner_id: sB.id, lead_days: 3, prices: [{ line_id: lF.id, unit_cost: 12 }, { line_id: lY.id, unit_cost: 90 }] });
    assert.strictEqual(rq.lines[0].best_partner_id, sA.id); assert.strictEqual(rq.lines[1].best_partner_id, sB.id);
    const aw = await api('POST', `/rfqs/${rq.id}/award`, {});
    assert.strictEqual(aw.purchase_orders.length, 2); assert.strictEqual(aw.rfq.status, 'closed');
    const poA = await api('GET', `/purchases/${aw.purchase_orders.find(p => p.supplier === 'Lesotho Flour Mills').id}`);
    assert.strictEqual(Number(poA.subtotal), 1100);
    await api('POST', `/rfqs/${rq.id}/award`, {}, true);
    ok('RFQ to 2 suppliers: flour from Lesotho Flour Mills @ 11, yeast from Bakers Supply @ 90 → 2 draft purchase orders');
    // make to order
    const cust = (await api('GET', '/partners?is_customer=1'))[0];
    const so = await api('POST', '/sales', { partner_id: cust.id, lines: [{ product_id: PP('Brown loaf (own bake)').id, qty: 30, unit_price: 13, tax_rate: 15 }] });
    await api('POST', `/sales/${so.id}/manufacture`, {}, true); // not confirmed yet
    await api('POST', `/sales/${so.id}/confirm`, {});
    assert.strictEqual((await api('POST', `/sales/${so.id}/manufacture`, {})).work_orders.length, 0); // 95 loaves in stock already
    const mto = await api('POST', `/sales/${so.id}/manufacture`, { all: true });
    assert.strictEqual(mto.work_orders.length, 1); assert.strictEqual(mto.work_orders[0].qty, 30);
    assert.strictEqual((await api('POST', `/sales/${so.id}/manufacture`, { all: true })).work_orders.length, 0);
    assert.strictEqual((await api('GET', `/sales/${so.id}/work-orders`))[0].status, 'confirmed');
    ok('make to order: confirmed sales order → work order for 30 loaves (only once)');
  }
  {
    // ---- projects, timesheets, helpdesk ----
    const cust = (await api('GET', '/partners?is_customer=1'))[0];
    const me = await api('GET', '/me');
    const pj = await api('POST', '/projects', { name: 'Office network – Ha Abia clinic', partner_id: cust.id, billing: 'hourly', hourly_rate: 450, budget_hours: 10 });
    assert(/^PRJ-/.test(pj.code));
    await api('POST', '/projects', { name: 'No customer', billing: 'hourly' }, true);
    const tk = await api('POST', '/tasks', { project_id: pj.id, title: 'Run cables to 6 offices', assigned_to: me.id, estimate_hours: 6 });
    await api('PUT', `/tasks/${tk.id}`, { status: 'doing' });
    const d0 = new Date(); const day = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}`;
    await api('POST', '/timesheets', { task_id: tk.id, hours: 3, description: 'Cabling' });
    await api('POST', '/timesheets', { project_id: pj.id, hours: 2, description: 'Router set-up' });
    await api('POST', '/timesheets', { project_id: pj.id, hours: 1, billable: 0, description: 'Travel' });
    await api('POST', '/timesheets', { project_id: pj.id, hours: 19 }, true); // > 24 h that day
    await api('POST', '/timesheets', { project_id: pj.id, hours: 1, work_date: '2999-01-01' }, true);
    let pv = await api('GET', `/projects/${pj.id}`);
    assert.strictEqual(pv.hours, 6); assert.strictEqual(pv.to_invoice_hours, 5); assert.strictEqual(pv.budget_used_pct, 60);
    const pinv = await api('POST', `/projects/${pj.id}/invoice`, {});
    const inv = await api('GET', `/invoices/${pinv.invoice_id}`); assert.strictEqual(Number(inv.subtotal), 2250);
    await api('POST', `/projects/${pj.id}/invoice`, {}, true);
    const tsl = await api('GET', `/timesheets?from=${day}&to=${day}&project_id=${pj.id}`);
    await api('DELETE', `/timesheets/${tsl.rows.find(x => x.invoice_id).id}`, null, true);
    await api('POST', `/invoices/${pinv.invoice_id}/post`);
    pv = await api('GET', `/projects/${pj.id}`); assert.strictEqual(pv.invoiced, 2250);
    const fx = await api('POST', '/projects', { name: 'Clinic extension (fixed price)', partner_id: cust.id, billing: 'fixed', budget_amount: 10000 });
    const finv = await api('POST', `/projects/${fx.id}/invoice`, { percent: 30 });
    assert.strictEqual(Number((await api('GET', `/invoices/${finv.invoice_id}`)).subtotal), 3000);
    ok('projects: 5 billable h × M 450 invoiced (non-billable and future hours handled), fixed price invoiced 30% = M 3 000');
    // helpdesk / repair job card
    await api('PUT', '/helpdesk/settings', { labour_rate: 300, sla_hours: { urgent: 2, high: 8, normal: 24, low: 72 } });
    const port = await api('POST', '/products', { name: 'Laptop charging port', type: 'stock', cost: 100, price: 230, tax_id: 1, opening_qty: 3 });
    let t = await api('POST', '/tickets', { contact_name: 'Palesa Mohapi', phone: '+266 5888 1111', subject: 'Laptop does not charge', kind: 'repair', channel: 'walk_in', item: 'HP 250 G8 laptop', serial_no: '5CD1234XYZ', priority: 'high' });
    assert(/^TCK\//.test(t.number) && t.sla_due && t.status === 'new');
    await api('POST', '/tickets', { subject: 'x' }, true);
    t = await api('POST', `/tickets/${t.id}/messages`, { body: 'Booked in. We will call you when it is ready.' });
    assert(t.first_response_at && t.status === 'open');
    t = await api('POST', `/tickets/${t.id}/messages`, { body: 'Port is loose, replace', internal: 1 }); assert.strictEqual(t.messages.length, 2);
    await api('PUT', `/tickets/${t.id}/parts`, { parts: [{ product_id: port.id, qty: 1 }] });
    await api('POST', '/timesheets', { ticket_id: t.id, hours: 1.5, description: 'Replace charging port' });
    const tinv = await api('POST', `/tickets/${t.id}/invoice`, {});
    const ti = await api('GET', `/invoices/${tinv.invoice_id}`);
    assert.strictEqual(Number(ti.subtotal), 650); assert.strictEqual(Number(ti.total), 747.5);
    await api('POST', `/invoices/${tinv.invoice_id}/post`);
    assert.strictEqual(Number((await api('GET', `/products/${port.id}`)).stock_qty), 2);
    await api('POST', `/tickets/${t.id}/invoice`, {}, true);
    t = await api('POST', `/tickets/${t.id}/status`, { status: 'solved' }); assert(t.solved_at);
    const hs = await api('GET', '/tickets/summary'); assert(hs.solved_30 >= 1);
    const tbs = await api('GET', '/reports/tb?from=2000-01-01&to=2999-12-31'); assert.strictEqual(tbs.debit, tbs.credit);
    ok('helpdesk: walk-in repair ticket with deadline, reply + internal note, part + 1.5 h labour → invoice M 650 + VAT, part leaves stock, books balance');
  }
  const adminToken = token;
  const pin = await api('GET', '/pin-users'); const kat = pin.find(u => u.name === 'Cashier Kat');
  token = (await api('POST', '/pin-login', { user_id: kat.id, pin: '4321' })).token; ok('cashier PIN login');
  await api('GET', '/reports/pl', null, true); ok('cashier blocked from reports');
  await api('GET', '/crm/customers', null, true); await api('GET', '/recon', null, true); ok('cashier blocked from CRM & recon');
  await api('PUT', '/settings-logo', { data_url: png }, true); ok('cashier cannot change logo');
  await api('GET', '/hrm/employees', null, true); ok('cashier blocked from HR');
  await api('POST', '/pos/checkout', { session_id: sess.id, lines: [{ product_id: P('White Bread').id, qty: 1, discount_pct: 50 }], payments: [] }, true); ok('cashier cannot discount');
  { const tt = (await api('GET', '/pos/terminals')).find(t => t.id === retail.id); const sid = tt.open_session_id || (await api('POST', '/pos/sessions/open', { terminal_id: retail.id, opening_cash: 0 })).id;
    const cs = await api('POST', '/pos/checkout', { session_id: sid, lines: [{ product_id: P('White Bread').id, qty: 3 }], payments: [{ method_id: M('Cash').id, amount: 100 }] }); assert(cs.order.lines[0].rule_id); ok('cashier gets promotions automatically without discount rights'); }
  { const cl = await api('POST', '/expense-claims', { description: 'Airtime for shop phone', account_code: '6700', amount: 20 }); await api('POST', `/expense-claims/${cl.id}/approve`, {}, true); assert((await api('GET', '/expense-claims')).every(c => c.user_name === 'Cashier Kat')); ok('cashier can submit claims, sees only their own, cannot approve'); }
  { const me = await api('POST', '/attendance/me'); assert(['in', 'out'].includes(me.status)); await api('GET', '/attendance', null, true); ok('cashier clocks in from the till, cannot see the attendance report'); }
  await api('GET', '/setup-guide', null, true); ok('cashier cannot open the setup guide');
  { const b = await api('GET', '/business'); assert(b.modules.length); await api('PUT', '/business', { types: ['retail'] }, true); await api('POST', '/transfers', {}, true); ok('cashier sees enabled modules but cannot change them or move stock'); }
  { await api('GET', '/rfqs', null, true); await api('POST', '/equipment', { name: 'x' }, true); assert.strictEqual((await api('GET', '/projects')).length, 0);
    const eq = (await api('GET', '/equipment'))[0]; const rp = await api('POST', '/maintenance', { equipment_id: eq.id, title: 'Strange noise' }); assert(rp.number);
    await api('POST', `/maintenance/${rp.id}/done`, {}, true); assert((await api('GET', '/tickets')).length >= 0);
    ok('cashier can report a breakdown and use the helpdesk, but not manage machines, RFQs or projects'); }
  token = adminToken;

  console.log('\nALL SMOKE TESTS PASSED');
  process.exit(0);
})().catch(e => { console.error('\nFAILED:', e); process.exit(1); });

function round(n) { return Math.round(n * 100) / 100; }
