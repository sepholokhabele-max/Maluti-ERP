// UI test: quotations, promotions, bank recon import, expense claims, approvals, attendance
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  await api('POST', '/db-config', { host: 'localhost', user: 'erp', password: 'erp123', database: 'maluti_ui' });
  token = (await api('POST', '/setup', { company: { name: 'Lesedi General Dealer', vat_rate: 15, address: 'Main Rd, Mafeteng', phone: '+266 2270 0000' }, admin: { name: 'Lineo Mokhele', username: 'admin', password: 'admin123', pin: '1234' }, demo: true, business_types: ['retail'] })).token;
  await api('POST', '/users', { name: 'Thabo Cashier', username: 'thabo', password: 'thabo123', pin: '2468', role: 'cashier' });
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !m.text().includes('404') && !m.text().includes('401')) errors.push('CONSOLE ' + m.text()); });
  p.setDefaultTimeout(10000);
  const shot = (n, o = {}) => p.screenshot({ path: `${SP}/shots/${n}.png`, ...o });
  try {
    // attendance from the login screen
    await p.goto(B); await p.waitForSelector('#clockBtn'); await p.click('#clockBtn'); await p.waitForSelector('[data-u]');
    await p.click('.modal [data-u]:has-text("Thabo")'); for (const k of '2468') await p.click(`.modal [data-k="${k}"]`); await p.click('.modal [data-k="✓"]');
    await p.waitForSelector('text=clocked IN'); await shot('120-clock-in');
    await p.evaluate(t => localStorage.setItem('maluti_token', t), token); await p.reload(); await p.waitForSelector('.tiles'); await shot('121-home-tiles');
    // promotions
    await p.goto(B + '/#/promotions'); await p.waitForSelector('#nr'); await p.click('#nr'); await p.waitForSelector('.modal [name=name]');
    await p.fill('.modal [name=name]', 'Bread 3 for 2'); await p.selectOption('.modal [name=kind]', 'multibuy'); await p.fill('.modal [name=min_qty]', '3'); await p.fill('.modal [name=free_qty]', '1');
    await p.selectOption('.modal [name=product_id]', { label: 'White Bread 700g' }); await shot('122-promo-form');
    await p.click('.modal-foot .btn-primary'); await p.waitForSelector('text=Promotion saved'); await p.waitForTimeout(300); await shot('123-promotions');
    // POS shows the promotion
    await p.goto(B + '/#/pos/1'); await p.waitForSelector('#oc'); await p.click('.modal-foot .btn-primary'); await p.waitForSelector('text=Session opened');
    for (let i = 0; i < 3; i++) { await p.click('.prod:has-text("White Bread")'); await p.waitForTimeout(150); }
    await p.waitForSelector('.promo-tag'); await shot('124-pos-promo');
    await p.click('#payBtn'); await p.waitForSelector('.payscreen'); await p.click('#done'); await p.waitForSelector('text=Sale complete'); await p.click('text=Next customer');
    // quotation
    await p.goto(B + '/#/quote/new'); await p.waitForSelector('[data-k="product_id"]');
    await p.selectOption('[data-k="product_id"]', { label: 'Maize Meal 5kg' }); await p.fill('[data-k="qty"]', '20'); await p.press('[data-k="qty"]', 'Tab');
    await p.click('#qAdd'); await p.fill('[data-i="1"][data-k="description"]', 'Delivery to Mohale\'s Hoek'); await p.fill('[data-i="1"][data-k="unit_price"]', '200'); await p.press('[data-i="1"][data-k="unit_price"]', 'Tab');
    await p.fill('[data-i="0"][data-k="discount_pct"]', '5'); await p.press('[data-i="0"][data-k="discount_pct"]', 'Tab');
    await shot('125-quote-new', { fullPage: true });
    await p.click('#qSave'); await p.waitForSelector('#qConfirm'); await shot('126-quote-saved', { fullPage: true });
    await p.click('#qConfirm'); await p.waitForSelector('.modal input'); await p.fill('.modal input', 'REQ-4471'); await p.click('.modal-foot .btn-primary');
    await p.waitForSelector('#qInvoice'); await shot('127-sales-order');
    await p.click('#qInvoice'); await p.waitForSelector('text=Draft invoice created'); await p.waitForTimeout(400); await shot('128-invoice-from-order', { fullPage: true });
    await p.goto(B + '/#/quotes?stage=all'); await p.waitForSelector('[data-href]'); await shot('129-quotes-list');
    // bank recon: paste an M-Pesa CSV
    await p.goto(B + '/#/bank'); await p.waitForSelector('#imp'); await p.click('#imp'); await p.waitForSelector('#st');
    await p.selectOption('.modal [name=account_code]', '1020'); await p.fill('.modal [name=name]', 'M-Pesa merchant – this week');
    const d0 = new Date(); const ds = `${String(d0.getDate()).padStart(2, '0')}/${String(d0.getMonth() + 1).padStart(2, '0')}/${d0.getFullYear()}`;
    await p.fill('#st', `Date,Details,Receipt No,Paid In,Withdrawn\n${ds},Customer payment,QA11,63.00,\n${ds},Transaction charge,QA12,,4.60\n${ds},Agent deposit,QA13,500.00,`);
    await p.waitForTimeout(300); await shot('130-bank-import');
    await p.click('.modal-foot .btn-primary'); await p.waitForSelector('[data-c]'); await shot('131-bank-statement', { fullPage: true });
    await p.click('[data-c]'); await p.waitForSelector('.modal [name=account_code]'); await shot('132-bank-create-entry');
    await p.keyboard.press('Escape');
    // expense claim with a slip photo, as the cashier
    await p.goto(B + '/#/claims'); await p.waitForSelector('#nc'); await p.click('#nc'); await p.waitForSelector('.modal [name=description]');
    await p.fill('.modal [name=description]', 'Taxi to bank with takings'); await p.fill('.modal [name=amount]', '46'); await p.selectOption('.modal [name=account_code]', '6500');
    await p.setInputFiles('#rcpt', `${SP}/shots/120-clock-in.png`); await p.waitForSelector('#rprev[src^="data:"]'); await shot('133-claim-form');
    await p.click('.modal-foot .btn-primary'); await p.waitForSelector('text=Claim submitted');
    // approvals
    await api('PUT', '/approvals/settings', { po_limit: 1000 });
    await p.goto(B + '/#/approvals'); await p.waitForSelector('.kpi'); await shot('134-approvals', { fullPage: true });
    await p.goto(B + '/#/claims?tab=approve'); await p.waitForSelector('[data-c]'); await p.click('[data-c]'); await p.waitForSelector('.modal img'); await shot('135-claim-review');
    await p.click('.modal-foot button:has-text("Approve")'); await p.waitForSelector('text=Approved and booked');
    // attendance report
    const th = (await api('GET', '/users')).find(u => u.username === 'thabo');
    for (const dd of [1, 2, 3, 4, 5]) { const x = new Date(); x.setDate(x.getDate() - dd - 1); const day = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; await api('POST', '/attendance', { user_id: th.id, check_in: day + ' 07:30:00', check_out: day + ' 18:00:00' }); }
    await p.goto(B + '/#/attendance'); await p.waitForSelector('[data-p]'); await shot('136-attendance', { fullPage: true });
    await p.goto(B + '/#/guide'); await p.waitForSelector('.guide-step'); await shot('137-guide-new-steps', { fullPage: true });
  } catch (e) { await shot('dbg10'); throw e; }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none'); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
