// UI test: carcass receive by tag, production run, carcass trace, bar bottles/count/pour check. Runs after ui7 on the same DB.
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  token = (await api('POST', '/login', { username: 'admin', password: 'admin123' })).token;
  const ps = await api('GET', '/products');
  const P = n => ps.find(p => p.name === n);
  const carcass = P('Beef side (carcass)'), mince = P('Beef mince');
  await api('PUT', `/products/${carcass.id}`, { is_carcass: 1 });
  const vat = (await api('GET', '/taxes'))[0].id;
  const mk = (name, extra) => api('POST', '/products', { name, type: 'stock', uom: 'kg', price: 0, tax_id: vat, pos_visible: 0, ...extra });
  const fat = await mk('Pork back fat', { cost: 40, opening_qty: 10 });
  const spice = await mk('Boerewors spice', { cost: 90, opening_qty: 3 });
  const casing = await mk('Hog casings', { cost: 120, opening_qty: 2 });
  const wors = await mk('Boerewors', { price: 110, sold_by_weight: 1, plu: '1010', track_batches: 1, shelf_life_days: 4, pos_visible: 1 });
  await api('POST', '/butchery/recipes', { name: 'Traditional boerewors', output_product_id: wors.id, output_qty: 10, lines: [
    { product_id: mince.id, kind: 'meat', qty: 7 }, { product_id: fat.id, kind: 'fat', qty: 1.5 }, { name: 'Water', kind: 'water', qty: 1.1 }, { product_id: spice.id, kind: 'spice', qty: 0.25 }, { product_id: casing.id, kind: 'casing', qty: 0.15 }] });
  const supp = (await api('GET', '/partners?is_supplier=1'))[0];
  const po = await api('POST', '/purchases', { supplier_id: supp.id, lines: [{ product_id: carcass.id, qty: 120.5, unit_cost: 68, tax_rate: 0 }] });
  await api('POST', `/purchases/${po.id}/confirm`);
  const gin = await api('POST', '/products', { name: "Gordon's Gin 750ml", type: 'stock', uom: 'Bottle', price: 280, cost: 150, tax_id: vat, bottle_ml: 750, bottle_empty_g: 500, bottle_full_g: 1205, opening_qty: 6, pos_visible: 0 });
  const wine = await api('POST', '/products', { name: 'House red 750ml', type: 'stock', uom: 'Bottle', price: 180, cost: 75, tax_id: vat, bottle_ml: 750, bottle_empty_g: 480, opening_qty: 4, pos_visible: 0 });
  await api('POST', '/products', { name: 'House red glass (175ml)', type: 'consumable', uom: 'Glass', price: 55, tax_id: vat, pour_from_id: wine.id, pour_ml: 175 });

  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('CONSOLE ' + m.text()); });
  p.setDefaultTimeout(10000);
  const shot = (n, o = {}) => p.screenshot({ path: `${SP}/shots/${n}.png`, ...o });
  try {
    await p.goto(B); await p.evaluate(t => localStorage.setItem('maluti_token', t), token); await p.reload(); await p.waitForSelector('.tiles');
    // receive two carcasses, each with its tag and weight
    await p.goto(B + '/#/purchase/' + po.id); await p.waitForSelector('#receive'); await p.click('#receive'); await p.waitForSelector('[data-pt]'); await p.waitForTimeout(400);
    await p.fill('[data-pt$=":0"]', 'TAG-0412'); await p.fill('[data-pq$=":0"]', '62.4');
    await p.click('[data-padd]'); await p.fill('[data-pt$=":1"]', 'TAG-0413'); await p.fill('[data-pq$=":1"]', '58.1');
    await shot('92-receive-carcasses'); await p.click('.modal-foot .btn-ok'); await p.waitForSelector('text=Stock received');
    const tags = (await api('GET', `/butchery/batches?product_id=${carcass.id}`)).map(x => x.batch_no);
    if (!tags.includes('TAG-0412') || !tags.includes('TAG-0413')) throw new Error('tags not received: ' + tags);
    // production run
    await p.goto(B + '/#/butchery?tab=production'); await p.waitForSelector('#npr'); await shot('93-production-tab');
    await p.click('#npr'); await p.waitForSelector('[data-na="4"]');
    await p.fill('#prt', '13'); await p.press('#prt', 'Tab'); await p.waitForTimeout(300);
    for (const [i, v] of [[0, 9.2], [1, 1.9], [2, 1.4], [3, 0.33], [4, 0.2]]) await p.fill(`[data-na="${i}"]`, String(v));
    await p.fill('#pou', '12.75'); await p.fill('#prn', 'Made by Palesa'); await shot('94-production-form');
    await p.click('.modal-foot .btn-primary'); await p.waitForSelector('.modal h3:has-text("PRD/")'); await p.waitForTimeout(300); await shot('95-production-result');
    await p.click('.modal-foot button:has-text("Where did it go")'); await p.waitForSelector('.trace-tree'); await shot('96-sausage-trace');
    // sell some boerewors so the carcass shows sales through the sausage
    const sess = (await api('GET', '/pos/sessions?status=open').catch(() => [])); void sess;
    // carcass trace
    await p.goto(B + '/#/butchery?tab=carcasses&status=all'); await p.waitForSelector('[data-c]'); await shot('97-carcass-register');
    await p.click('[data-c]:has-text("LAC-24117")'); await p.waitForSelector('.trace-tree'); await p.waitForTimeout(300); await shot('98-carcass-ledger', { fullPage: true });
    await p.keyboard.press('Escape');
    // bar: measure product via the product form
    await p.goto(B + '/#/products'); await p.waitForSelector('#np'); await p.click('#np'); await p.waitForSelector('.modal [name=pour_from_id]');
    await p.fill('.modal [name=name]', "Gordon's tot (25ml)"); await p.selectOption('.modal [name=type]', 'consumable'); await p.fill('.modal [name=price]', '23');
    await p.selectOption('.modal [name=pour_from_id]', { label: "Gordon's Gin 750ml (750 ml)" }); await p.fill('.modal [name=pour_ml]', '25');
    await shot('99-measure-product'); await p.click('.modal-foot .btn-primary'); await p.waitForSelector('text=Saved');
    const tot = (await api('GET', '/products')).find(x => x.name === "Gordon's tot (25ml)");
    if (Number(tot.pour_from_id) !== gin.id || Number(tot.pour_ml) !== 25) throw new Error('measure not saved');
    await p.goto(B + '/#/bar'); await p.waitForSelector('.bottle-gauge'); await shot('100-bar-bottles', { fullPage: true });
    // count
    await p.goto(B + '/#/bar?tab=count'); await p.waitForSelector('#nbc'); await p.click('#nbc'); await p.waitForSelector(`[data-full="${gin.id}"]`);
    await p.fill(`[data-full="${gin.id}"]`, '5'); await p.fill(`[data-w="${gin.id}:0"]`, '1000');
    await p.fill(`[data-full="${wine.id}"]`, '3'); await p.fill(`[data-w="${wine.id}:0"]`, '900');
    await p.waitForTimeout(200); await shot('101-bar-count');
    await p.click('.modal-foot button:has-text("Post count")'); await p.waitForSelector('button:text-is("Post")'); await p.click('button:text-is("Post")'); await p.waitForSelector('text=Count posted');
    await p.waitForTimeout(400); await shot('102-bar-count-list');
    const g = (await api('GET', '/products')).find(x => x.id === gin.id);
    if (Math.abs(Number(g.stock_qty) - 5.7092) > 0.0001) throw new Error('gin stock after count ' + g.stock_qty);
    // pour check
    await p.goto(B + '/#/bar?tab=pour'); await p.waitForSelector('#pw1');
    await p.fill('#pw1', '1000'); await p.fill('#pw2', '965'); await p.fill('#ow', '850'); await p.waitForTimeout(200); await shot('103-pour-check');
  } catch (e) { await shot('dbg8'); throw e; }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none'); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
