// UI test: manufacturing (runs after ui11 on the same DB)
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  token = (await api('POST', '/login', { username: 'admin', password: 'admin123' })).token;
  const biz = await api('GET', '/business'); await api('PUT', '/business', { types: [...biz.types, 'manufacturing'] });
  const mk = (name, extra) => api('POST', '/products', { name, type: 'stock', tax_id: 1, ...extra });
  await mk('Cement 50kg', { uom: 'bag', cost: 115, opening_qty: 40, pos_visible: 0 }); await mk('River sand', { uom: 'tonne', cost: 350, opening_qty: 3, pos_visible: 0 });
  await mk('Maxi brick', { uom: 'brick', price: 4.5, cost: 0 });
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !m.text().includes('404') && !m.text().includes('401')) errors.push('CONSOLE ' + m.text()); });
  p.setDefaultTimeout(10000);
  const shot = (n, o = {}) => p.screenshot({ path: `${SP}/shots/${n}.png`, ...o });
  try {
    await p.goto(B); await p.evaluate(t => localStorage.setItem('maluti_token', t), token); await p.reload(); await p.waitForSelector('.tiles');
    await p.goto(B + '/#/bom/new'); await p.waitForSelector('#bh [name=product_id]');
    await p.selectOption('#bh [name=product_id]', { label: 'Maxi brick' }); await p.fill('#bh [name=name]', 'Maxi brick – 1 000 per day'); await p.fill('#bh [name=output_qty]', '1000');
    await p.fill('#bh [name=labour_cost]', '600'); await p.fill('#bh [name=overhead_cost]', '150');
    await p.selectOption('[data-i="0"][data-k="product_id"]', { label: 'Cement 50kg' }); await p.fill('[data-i="0"][data-k="qty"]', '10'); await p.fill('[data-i="0"][data-k="scrap_pct"]', '2');
    await p.click('#bAdd'); await p.selectOption('[data-i="1"][data-k="product_id"]', { label: 'River sand' }); await p.fill('[data-i="1"][data-k="qty"]', '1.5');
    await p.waitForTimeout(200); await shot('160-bom-form', { fullPage: true });
    await p.click('#bSave'); await p.waitForSelector('#bWo'); await p.click('#bWo'); await p.waitForSelector('.modal [name=qty]'); await p.fill('.modal [name=qty]', '3000'); await shot('161-wo-new');
    await p.click('.modal-foot .btn-primary'); await p.waitForSelector('#wStart'); await shot('162-wo-draft-short', { fullPage: true });
    await p.goto(B + '/#/mrp?tab=short'); await p.waitForSelector('#mkpo'); await shot('163-materials-to-buy');
    await p.goto(B + '/#/mrp'); await p.waitForSelector('[data-id]'); await p.click('[data-id]'); await p.waitForSelector('#wStart'); await p.click('#wStart'); await p.waitForSelector('#wFinish');
    // make only what the materials allow: 2 000 bricks
    await p.click('#wFinish'); await p.waitForSelector('.modal [name=qty_produced]'); await p.fill('.modal [name=qty_produced]', '1950'); await p.fill('.modal [name=qty_rejected]', '50');
    const inputs = await p.$$('.modal [data-l]'); await inputs[0].fill('20.4'); await inputs[1].fill('3'); await p.fill('.modal [name=qc_notes]', 'Crush test 7 MPa OK');
    await p.fill('.modal [name=labour_cost]', '1200'); await p.fill('.modal [name=overhead_cost]', '300'); await shot('164-wo-finish');
    await p.click('.modal-foot .btn-ok'); await p.waitForSelector('text=per unit'); await p.waitForTimeout(300); await shot('165-wo-done', { fullPage: true });
    await p.goto(B + '/#/mrp?tab=orders&status=all'); await p.waitForSelector('[data-id]'); await shot('166-mrp-list');
    await p.goto(B + '/#/mrp?tab=boms'); await p.waitForSelector('[data-id]'); await shot('167-boms');
    await p.goto(B + '/#/'); await p.waitForSelector('.tiles'); await shot('168-home-with-mfg');
  } catch (e) { await shot('dbg12'); throw e; }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none'); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
