// UI test: business types & modules, branches, transfers, stock by location, branch profit
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  await api('POST', '/db-config', { host: 'localhost', user: 'erp', password: 'erp123', database: 'maluti_ui' });
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !m.text().includes('404') && !m.text().includes('401')) errors.push('CONSOLE ' + m.text()); });
  p.setDefaultTimeout(10000);
  const shot = (n, o = {}) => p.screenshot({ path: `${SP}/shots/${n}.png`, ...o });
  try {
    await p.goto(B); await p.waitForSelector('.wz'); await shot('140-setup-welcome', { fullPage: true });
    if ((await (await fetch(B + '/api/business-types')).json()).length !== 16) throw new Error('expected 16 business types');
    token = (await api('POST', '/setup', { company: { name: 'Lesedi Wholesalers', address: 'Industrial Area, Maseru', phone: '+266 2231 0000' }, admin: { name: 'Lineo Mokhele', username: 'admin', password: 'admin123', pin: '1234' }, demo: true, business_types: ['wholesale'] })).token;
    await p.evaluate(t => localStorage.setItem('maluti_token', t), token); await p.goto(B + '/#/'); await p.reload(); await p.waitForSelector('.tiles'); await shot('141-home-wholesale');
    const tiles = await p.$$eval('.tile span', s => s.map(x => x.textContent));
    if (tiles.includes('Butchery') || tiles.includes('Bar stock') || !tiles.includes('Branches & warehouses')) throw new Error('tiles not filtered: ' + tiles.join(', '));
    await p.goto(B + '/#/settings?tab=business'); await p.waitForSelector('.mod-grid'); await shot('142-business-modules', { fullPage: true });
    await p.click('.biz-type:has-text("Lodge")'); await p.waitForSelector('.mod.on:has-text("Tables & kitchen")'); await p.click('#bsave'); await p.waitForSelector('text=Saved');
    // locations
    await p.goto(B + '/#/locations'); await p.waitForSelector('#nl'); await p.click('#nl'); await p.waitForSelector('.modal [name=name]');
    await p.fill('.modal [name=name]', 'Teyateyaneng branch'); await p.fill('.modal [name=code]', 'TY'); await p.selectOption('.modal [name=kind]', 'branch'); await p.fill('.modal [name=address]', 'Main North 1 Rd, TY'); await shot('143-location-form');
    await p.click('.modal-foot .btn-primary'); await p.waitForSelector('text=Teyateyaneng branch');
    await api('POST', '/locations', { name: 'Maseru warehouse', code: 'WH', kind: 'warehouse', sellable: 0 });
    await p.goto(B + '/#/locations?tab=list&r=1'); await p.waitForSelector('text=Maseru warehouse'); await shot('144-locations');
    // transfer from main to TY
    await p.goto(B + '/#/transfer/new'); await p.waitForSelector('[data-k="product_id"]');
    const locs = await api('GET', '/locations'); const TY = locs.find(l => l.code === 'TY');
    await p.selectOption('#th [name=to_location_id]', String(TY.id));
    await p.selectOption('[data-i="0"][data-k="product_id"]', { label: 'Maize Meal 5kg' }); await p.fill('[data-i="0"][data-k="qty"]', '10');
    await p.click('#tAdd'); await p.selectOption('[data-i="1"][data-k="product_id"]', { label: 'Coca-Cola 330ml' }); await p.fill('[data-i="1"][data-k="qty"]', '24');
    await p.fill('#th [name=notes]', 'Driver Teboho, Quantum A 4471'); await shot('145-transfer-new', { fullPage: true });
    await p.click('#tSend'); await p.click('.modal-foot .btn-primary'); await p.waitForSelector('#tRecv'); await shot('146-transfer-sent', { fullPage: true });
    await p.fill('[data-i="1"][data-k="qty_received"]', '22'); await p.click('#tRecv'); await p.click('.modal-foot .btn-danger'); await p.waitForSelector('text=shortage');
    await p.waitForTimeout(300); await shot('147-transfer-received', { fullPage: true });
    await p.goto(B + '/#/transfers?status=all'); await p.waitForSelector('[data-id]'); await shot('148-transfers');
    // till at TY sells
    const till = await api('POST', '/terminals', { name: 'TY counter', mode: 'retail', location_id: TY.id });
    const s = await api('POST', '/pos/sessions/open', { terminal_id: till.id, opening_cash: 0 });
    const pm = (await api('GET', '/payment-methods')).find(m => m.kind === 'cash'); const prods = await api('GET', '/products');
    await api('POST', '/pos/checkout', { session_id: s.id, lines: [{ product_id: prods.find(x => x.name === 'Maize Meal 5kg').id, qty: 4 }], payments: [{ method_id: pm.id, amount: 1000 }] });
    await p.goto(B + '/#/locations?tab=stock'); await p.waitForSelector('#st table'); await shot('149-stock-by-location', { fullPage: true });
    await p.click(`[data-lv="${TY.id}"]`); await p.waitForSelector('.modal [data-k=min_qty]'); await p.fill('.modal tr:has-text("Maize Meal 5kg") [data-k=min_qty]', '10'); await p.click('.modal-foot .btn-primary'); await p.waitForSelector('text=Levels saved');
    await p.check('#slow'); await p.waitForTimeout(500); await shot('150-stock-low-branch');
    await p.goto(B + '/#/locations?tab=profit'); await p.waitForSelector('text=Net profit'); await shot('151-branch-profit');
    await p.goto(B + `/#/inventory?tab=stock&loc=${TY.id}`); await p.waitForSelector('#invLoc'); await shot('152-inventory-branch');
    await p.click('#count'); await p.waitForSelector('.modal [data-p]'); await shot('153-count-branch');
    await p.keyboard.press('Escape');
    await p.goto(B + '/#/purchase/new'); await p.waitForSelector('#hdr [name=location_id]'); await shot('154-po-branch');
    await p.goto(B + '/#/settings?tab=terminals'); await p.waitForSelector('text=TY counter'); await shot('155-tills-branch');
    await p.goto(B + '/#/guide'); await p.waitForSelector('.guide-step'); await shot('156-guide-wholesale', { fullPage: true });
    await p.goto(B + `/#/reports?tab=pl&from=2000-01-01&to=2999-12-31&location_id=${TY.id}`); await p.waitForSelector('#plLoc'); await shot('157-pl-branch');
  } catch (e) { await shot('dbg11'); throw e; }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none'); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
