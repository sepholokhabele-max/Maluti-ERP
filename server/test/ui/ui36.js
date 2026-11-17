// UI test: My Wallet payments (API v4) – the settings page in demo mode, a till sale paid with My Wallet (QR code,
// the customer approves – simulated), the receipt, a sale paid through the switch from M-Pesa, and a refund back to the wallet.
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b, tk = token) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: 'Bearer ' + tk } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  await api('POST', '/db-config', { host: 'localhost', user: 'erp', password: 'erp123', database: 'maluti_ui' });
  token = (await api('POST', '/setup', { company: { name: 'Lesedi General Dealer', vat_rate: 15, address: 'Main Rd, Mafeteng', phone: '+266 5800 1122' }, admin: { name: 'Admin', username: 'admin', password: 'admin123', pin: '1234' }, demo: true, business_types: ['retail'] })).token;
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/40[0-9]|50[0-9]/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
  p.setDefaultTimeout(20000);
  const shot = (n, o = { fullPage: true }) => p.screenshot({ path: `${SP}/shots/${n}.png`, ...o });
  try {
    await p.goto(B); await p.evaluate(t => { localStorage.setItem('maluti_token', t); localStorage.setItem('maluti_tour_1', '1'); localStorage.setItem('maluti_lang', 'en'); }, token); await p.reload(); await p.waitForSelector('.tiles');
    // settings: switch on in demo mode
    await p.goto(B + '/#/mywallet'); await p.waitForSelector('#save'); await shot('960-mywallet-off');
    await p.selectOption('#en', '1'); await p.selectOption('#mode', 'demo'); await p.click('#save'); await p.waitForSelector('text=On – demo');
    // till
    const retail = (await api('GET', '/pos/terminals')).find(t => t.mode === 'retail');
    await api('POST', '/pos/sessions/open', { terminal_id: retail.id, opening_cash: 300 });
    await p.goto(B + '/#/pos/' + retail.id); await p.waitForSelector('#psearch');
    await p.fill('#psearch', 'Maize'); await p.waitForTimeout(300); await p.click('.prod'); await p.waitForSelector('.cart-line');
    await p.click('#payBtn'); await p.waitForSelector('.methods');
    await p.click('.method:has-text("My Wallet")'); await p.waitForSelector('[data-mw]'); await p.click('[data-mw]');
    await p.waitForSelector('#mwc'); await p.fill('#mwc', '5800 1122'); await shot('961-mywallet-ask'); await p.click('.modal-foot .btn-primary:has-text("Send the request")');
    await p.waitForSelector('#mwCode'); await p.waitForSelector('.modal svg'); await shot('962-mywallet-qr-waiting');
    await p.click('#mwSimOk'); await p.waitForSelector('.badge-paid:has-text("paid")', { timeout: 20000 }); await shot('963-mywallet-paid');
    await p.click('#done'); await p.waitForSelector('#rcpt'); await p.waitForTimeout(500); await shot('964-receipt-mywallet');
    const rc = await p.frameLocator('#rcpt').locator('body').innerText(); if (!/My Wallet/.test(rc) || !/MW [0-9A-Z]{6}/.test(rc)) throw new Error('receipt lacks the My Wallet payment: ' + rc.slice(0, 400));
    await p.click('.modal-foot .btn-primary');
    // another wallet through the switch
    await p.fill('#psearch', 'Maize'); await p.waitForTimeout(300); await p.click('.prod'); await p.waitForSelector('.cart-line');
    await p.click('#payBtn'); await p.waitForSelector('.methods'); await p.click('.method:has-text("Other wallet")'); await p.click('[data-mw]');
    await p.waitForSelector('#mwm'); await p.selectOption('#mwm', '2010001'); await p.fill('#mwc', '57001234'); await p.click('.modal-foot .btn-primary:has-text("Send the request")');
    await p.waitForSelector('text=M-Pesa'); await shot('965-switch-instructions');
    await p.click('#mwSimOk'); await p.waitForSelector('.badge-paid:has-text("paid")', { timeout: 20000 }); await p.click('#done'); await p.waitForSelector('#rcpt'); await p.click('.modal-foot .btn-primary');
    // refund the first sale back to the wallet
    const orders = (await api('GET', '/mywallet/status')).recent.filter(x => x.order_id);
    const first = orders[orders.length - 1];
    const r = await api('POST', `/pos/orders/${first.order_id}/refund`, { method_id: first.method_id });
    if (!r.mywallet || r.mywallet[0].status !== 'DONE') throw new Error('refund did not go back to My Wallet');
    await p.goto(B + '/#/mywallet'); await p.waitForSelector('table'); await shot('966-mywallet-page');
    console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  } catch (x) { await shot('dbg36'); console.log('ERRORS so far:', errors.join('\n')); throw x; }
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
