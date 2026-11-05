// UI test: farm (runs after ui20 on the same DB)
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  token = (await api('POST', '/login', { username: 'admin', password: 'admin123' })).token;
  const biz = await api('GET', '/business'); await api('PUT', '/business', { modules: [...new Set([...biz.modules, 'farm'])] });
  const vat = (await api('GET', '/taxes'))[0].id;
  for (const [name, uom, cost, q, price] of [['Layer mash 50kg', 'Bag', 400, 20, 0], ['Newcastle vaccine', 'Dose', 120, 10, 0], ['Eggs tray 30', 'Tray', 45, 0, 75], ['Maize 50kg bag', 'Bag', 150, 0, 260], ['Wool kg', 'kg', 60, 0, 0]])
    await api('POST', '/products', { name, type: 'stock', uom, cost, price, tax_id: vat, opening_qty: q });
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/40[0-4]/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
  p.setDefaultTimeout(12000);
  const shot = (n, o = {}) => p.screenshot({ path: `${SP}/shots/${n}.png`, ...o });
  const save = async () => { await p.click('.modal-foot .btn-primary'); await p.waitForSelector('.modal', { state: 'detached' }); };
  try {
    await p.goto(B); await p.evaluate(t => localStorage.setItem('maluti_token', t), token); await p.reload(); await p.waitForSelector('.tiles');
    if (!await p.$('a[href="#/farm"]')) throw new Error('farm tile missing');
    await p.goto(B + '/#/farm?tab=groups'); await p.waitForSelector('#ng'); await p.click('#ng');
    await p.fill('.modal [name=name]', 'Layers house 1'); await p.selectOption('.modal [name=kind]', 'poultry'); await p.selectOption('.modal [name=species]', 'chicken'); await p.fill('.modal [name=purpose]', 'eggs');
    await p.fill('.modal [name=head_count]', '500'); await p.selectOption('.modal [name=produce_id]', { label: 'Eggs tray 30 (Tray)' }); await shot('300-farm-new-flock'); await save(); await p.waitForURL(/#\/farmgroup\/\d+/);
    await p.click('#gr'); await p.waitForSelector('.modal [name=produced_qty]'); await p.fill('.modal [name=produced_qty]', '14'); await shot('301-record-eggs'); await save();
    await p.click('#gr'); await p.waitForSelector('.modal [name=kind]'); await p.selectOption('.modal [name=kind]', 'feed'); await p.selectOption('.modal [name=product_id]', { index: 1 });
    const opts = await p.$$eval('.modal [name=product_id] option', os => os.map(o => o.textContent)); await p.selectOption('.modal [name=product_id]', { label: opts.find(o => o.startsWith('Layer mash')) }); await p.fill('.modal [name=qty]', '2'); await save();
    await p.click('#gr'); await p.selectOption('.modal [name=kind]', 'vaccinate'); await p.selectOption('.modal [name=product_id]', { label: opts.find(o => o.startsWith('Newcastle')) }); await p.fill('.modal [name=qty]', '1');
    const nd = await p.evaluate(() => { const x = new Date(); x.setDate(x.getDate() + 12); return x.toISOString().slice(0, 10); }); await p.fill('.modal [name=next_due]', nd); await save();
    await p.waitForTimeout(400); await shot('302-flock-page', { fullPage: true });
    // import the sheep register
    await p.goto(B + '/#/import?kind=farm_animals'); await p.waitForSelector('#ff'); await p.setInputFiles('#ff', __dirname + '/fixtures/animals.csv'); await p.waitForSelector('#go'); await p.click('#go'); await p.waitForSelector('text=Import finished');
    console.log('import:', (await p.textContent('#res')).replace(/\s+/g, ' ').slice(0, 90));
    await p.goto(B + '/#/farm?tab=animals'); await p.waitForSelector('[data-a]'); await shot('303-animals');
    await p.click('[data-a] >> text=M-100'); await p.waitForURL(/#\/animal\/\d+/); await p.waitForSelector('#ab'); await p.click('#ab'); await p.fill('[data-y="0"] [data-f=tag]', 'M-103'); await p.selectOption('[data-y="0"] [data-f=sex]', 'F'); await save();
    await p.waitForSelector('text=M-103'); await shot('304-ewe-with-lambs', { fullPage: true });
    await p.goto(B + '/#/farm?tab=crops'); await p.waitForSelector('#nf'); await p.click('#nf'); await p.fill('.modal [name=name]', 'Lower field'); await p.fill('.modal [name=size_ha]', '2'); await save();
    await p.waitForSelector('[data-f]'); await p.click('#ns'); await p.fill('.modal [name=crop]', 'Maize'); await p.fill('.modal [name=variety]', 'PAN 6479'); await p.selectOption('.modal [name=produce_id]', { label: 'Maize 50kg bag (Bag)' }); await save(); await p.waitForURL(/#\/season\/\d+/);
    await p.click('#sr'); await p.selectOption('.modal [name=kind]', 'labour'); await p.fill('.modal [name=cost]', '600'); await p.fill('.modal [name=note]', 'Tractor ploughing'); await save();
    await p.click('#sr'); await p.selectOption('.modal [name=kind]', 'harvest'); await p.fill('.modal [name=produced_qty]', '38'); await p.check('.modal [name=final]'); await save(); await p.waitForTimeout(300); await shot('305-maize-season', { fullPage: true });
    await p.goto(B + '/#/farm'); await p.waitForSelector('[data-redo]'); await shot('306-farm-diary', { fullPage: true });
    await p.goto(B + '/#/farm?tab=report'); await p.waitForSelector('#rg'); await shot('307-farm-results', { fullPage: true });
    await p.evaluate(() => localStorage.setItem('maluti_lang', 'st')); await p.goto(B + '/#/farm'); await p.waitForSelector('#rec'); await p.click('#rec'); await p.waitForSelector('.modal .help-note'); await shot('308-farm-record-sesotho'); await p.keyboard.press('Escape');
    await p.evaluate(() => localStorage.setItem('maluti_lang', 'en'));
    const rep = await api('GET', '/farm/report'); console.log('groups', rep.groups.map(g => `${g.name}: costs ${g.costs}, produced ${g.produced}`).join(' | '), 'seasons', rep.seasons.map(s => `${s.crop} ${s.harvested} bags, ${s.cost_per_ha}/ha`).join(' '));
  } catch (e) { await shot('dbg21'); throw e; }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none'); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
