// UI test: customer portal on a phone (pay with MyWallet through the Smartel mock), link dialog, portal settings; phone till layout (runs after ui24/25)
const { chromium, devices } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  token = (await api('POST', '/login', { username: 'admin', password: 'admin123' })).token;
  const mock = await require(require('path').join(__dirname, '../../../server/test/mock-smartel.js')).start(8792);
  const TID = '7f3c2a10-0000-4000-8000-00000000e001'; mock.state.terminals.add(TID); mock.state.terminals.add('7f3c2a10-0000-4000-8000-00000000b001');
  const terms = await api('GET', '/pos/terminals'); const retail = terms.find(t => t.mode === 'retail');
  await api('PUT', '/smartel/settings', { enabled: true, pos_api_url: mock.url, syncd_url: mock.url, auth: 'gateway', npr: 'off' });
  await api('PUT', `/smartel/terminals/${retail.id}`, { terminal_uuid: TID }).catch(async () => {});
  const cust = await api('POST', '/partners', { name: 'Palesa Mokhothu', phone: '58441122', is_customer: 1 });
  const inv = await api('POST', '/invoices', { kind: 'customer_invoice', partner_id: cust.id, lines: [{ description: 'School uniforms – 3 sets', qty: 3, unit_price: 350, tax_rate: 15 }] });
  await api('POST', `/invoices/${inv.id}/post`, {});
  const b = await chromium.launch();
  const errors = [];
  try {
    // staff: settings + link
    const p = await b.newPage({ viewport: { width: 1366, height: 860 } }); p.on('pageerror', e => errors.push('PAGEERR ' + e.message));
    await p.goto(B); await p.evaluate(t => localStorage.setItem('maluti_token', t), token); await p.reload(); await p.waitForSelector('.tiles');
    await p.goto(B + '/#/settings?tab=portal'); await p.waitForSelector('#pf [name=terminal_id]'); await p.selectOption('#pf [name=terminal_id]', String(retail.id)); await p.click('#ps'); await p.waitForSelector('.toast');
    await p.screenshot({ path: SP + '/shots/370-portal-settings.png' });
    await p.goto(B + '/#/customer/' + cust.id); await p.waitForSelector('#portalB'); await p.click('#portalB'); await p.waitForSelector('#pl'); await p.waitForTimeout(300);
    await p.screenshot({ path: SP + '/shots/371-portal-link.png' });
    const url = await p.inputValue('#pl'); const path = url.slice(url.indexOf('/p/'));
    // customer on a phone
    const m = await (await b.newContext({ ...devices['Pixel 7'] })).newPage(); m.on('pageerror', e => errors.push('PAGEERR ' + e.message));
    await m.goto(B + path); await m.waitForSelector('[data-pay="mywallet"]'); await m.screenshot({ path: SP + '/shots/372-portal-phone.png', fullPage: true });
    await m.fill('#amt', '500'); await m.click('[data-pay="mywallet"]'); await m.waitForSelector('#ovb svg'); await m.screenshot({ path: SP + '/shots/373-portal-qr.png' });
    await m.waitForSelector('#ovb .ok', { timeout: 20000 }); await m.screenshot({ path: SP + '/shots/374-portal-paid.png' });
    const bal = await api('GET', `/partners/${cust.id}/balance`); console.log('balance after', bal.receivable);
    if (Math.abs(bal.receivable - (1207.5 - 500)) > 0.01) throw new Error('balance ' + bal.receivable);
    await m.goto(B + path + '?lang=st'); await m.waitForSelector('.big'); await m.screenshot({ path: SP + '/shots/375-portal-sesotho.png', fullPage: true });
    // phone till layout
    const t = await (await b.newContext({ ...devices['Pixel 7'] })).newPage(); t.on('pageerror', e => errors.push('PAGEERR ' + e.message));
    await t.goto(B); await t.evaluate(tk => { localStorage.setItem('maluti_token', tk); localStorage.setItem('maluti_tour_1', '1'); }, token); await t.goto(B + '/#/pos/' + retail.id); await t.reload(); await t.waitForTimeout(2500); await t.screenshot({ path: SP + '/shots/dbg26.png' }); await t.waitForSelector('.prod');
    await t.click('.prod'); await t.waitForSelector('.cart-line'); await t.screenshot({ path: SP + '/shots/376-phone-till.png' });
    if (await t.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('phone till scrolls sideways');
  } finally { await api('PUT', '/smartel/settings', { enabled: false }).catch(() => {}); await mock.close(); }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none'); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
