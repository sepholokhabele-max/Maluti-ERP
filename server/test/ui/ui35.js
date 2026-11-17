// UI test: Lekuka e-invoicing (RSL) – the explanation for a business that is not registered, registering in demo mode
// (check taxpayer, register), a sale reported with its QR code on the till receipt, documents, fiscal days, options and
// taxes, closing the fiscal day; and the A4 invoice with the Lekuka block.
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b, tk = token) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: 'Bearer ' + tk } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  await api('POST', '/db-config', { host: 'localhost', user: 'erp', password: 'erp123', database: 'maluti_ui' });
  token = (await api('POST', '/setup', { company: { name: 'Lesedi General Dealer', vat_rate: 15, tax_number: '100345678', address: 'Main Rd, Mafeteng', phone: '+266 5800 1122' }, admin: { name: 'Admin', username: 'admin', password: 'admin123', pin: '1234' }, demo: true, business_types: ['retail'], mywallet: { agent_no: 'AG104455', password: 'MyWallet#55' } })).token;
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/40[0-9]|50[0-9]/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
  p.setDefaultTimeout(20000);
  const shot = (n, o = { fullPage: true }) => p.screenshot({ path: `${SP}/shots/${n}.png`, ...o });
  const go = async h => { await p.goto(B + '/' + h); await p.waitForLoadState('networkidle'); await p.waitForTimeout(300); };
  try {
    await p.goto(B); await p.evaluate(t => { localStorage.setItem('maluti_token', t); localStorage.setItem('maluti_tour_1', '1'); localStorage.setItem('maluti_lang', 'en'); }, token); await p.reload(); await p.waitForSelector('.tiles');
    await go('#/lekuka'); await p.waitForSelector('text=Report your sales to RSL'); await shot('950-lekuka-intro');
    await go('#/lekuka?tab=register'); await p.selectOption('[name=mode]', 'demo'); await p.fill('[name=device_id]', '321'); await p.fill('[name=activation_key]', 'AbCd1234');
    await p.click('#chk'); await p.waitForSelector('text=Is this your business?'); await shot('951-lekuka-check');
    await p.click('#reg'); await p.waitForURL(/tab=overview/); await p.waitForSelector('text=Taxpayer (from RSL)'); await p.waitForLoadState('networkidle');
    // a sale at the till
    const cat = await api('GET', '/pos/catalog'); const term = (await api('GET', '/pos/terminals')).find(t => t.mode === 'retail');
    const sess = await api('POST', '/pos/sessions/open', { terminal_id: term.id, opening_cash: 100 });
    const pr = cat.products.filter(x => Number(x.price) > 0).slice(0, 2); const cash = cat.methods.find(m => m.kind === 'cash');
    const sale = await api('POST', '/pos/checkout', { session_id: sess.id, lines: pr.map(x => ({ product_id: x.id, qty: 1 })), payments: [{ method_id: cash.id, amount: 1000 }] });
    if (!sale.fiscal || !sale.fiscal.verification_code) throw new Error('no fiscal data on the sale');
    await api('POST', '/lekuka/send');
    await go('#/lekuka'); await shot('952-lekuka-overview');
    // the receipt as printed
    const html = await p.evaluate(async id => { const pos = await import('/js/pos.js'); const core = await import('/js/core.js'); const o = await core.GET('/pos/orders/' + id); return pos.receiptHtml(o); }, sale.order_id);
    const rp = await b.newPage({ viewport: { width: 420, height: 900 } }); await rp.setContent(html); await rp.waitForTimeout(200); await rp.screenshot({ path: `${SP}/shots/953-receipt-lekuka.png`, fullPage: true });
    if (!/Verification code/.test(html) || !html.includes(sale.fiscal.verification_code)) throw new Error('receipt lacks the Lekuka block');
    await go('#/lekuka?tab=documents&all=1'); await p.waitForSelector('table'); await shot('954-lekuka-documents');
    await go('#/lekuka?tab=options'); await shot('955-lekuka-options');
    await go('#/lekuka'); p.once('dialog', d => d.accept()); await p.click('#cls'); await p.waitForSelector('.modal-foot .btn-primary'); await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(1200);
    await go('#/lekuka?tab=days'); await shot('956-lekuka-days');
    if ((await api('GET', '/lekuka/days'))[0].status !== 'closed') throw new Error('fiscal day not closed');
    // an A4 invoice to a business customer
    const cust = await api('POST', '/partners', { name: 'Maseru Hardware (Pty) Ltd', is_customer: 1, tax_number: '200123456' });
    const inv = await api('POST', '/invoices', { kind: 'customer_invoice', partner_id: cust.id, lines: [{ description: 'Shelving units', qty: 2, unit_price: 500, tax_rate: 15 }] });
    await api('POST', `/invoices/${inv.id}/post`);
    await go('#/invoice/' + inv.id); await p.waitForSelector('#print');
    await p.click('#print'); await p.waitForSelector('iframe', { state: 'attached' }); await p.waitForTimeout(400);
    const ih = await p.evaluate(() => { const f = document.querySelector('iframe'); return f ? f.contentDocument.documentElement.outerHTML : null; });
    if (!ih) throw new Error('no printed invoice');
    { const ip = await b.newPage({ viewport: { width: 900, height: 1100 } }); await ip.setContent(ih); await ip.waitForTimeout(200); await ip.screenshot({ path: `${SP}/shots/957-invoice-lekuka.png`, fullPage: true }); if (!/RSL Lekuka e-invoice/.test(ih)) throw new Error('invoice lacks the Lekuka block'); }
    console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  } catch (x) { await shot('dbg35'); console.log('ERRORS so far:', errors.join('\n')); throw x; }
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
