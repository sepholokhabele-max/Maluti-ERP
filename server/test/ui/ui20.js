// UI test: importing from other systems (runs after ui19 on the same DB)
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069', D = __dirname + '/fixtures/';
let token;
const api = async (m, u, b) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  token = (await api('POST', '/login', { username: 'admin', password: 'admin123' })).token;
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 }, acceptDownloads: true });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/40[0-4]/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
  p.setDefaultTimeout(15000);
  const shot = (n, o = {}) => p.screenshot({ path: `${SP}/shots/${n}.png`, ...o });
  const imp = async (kind, file, shotName) => {
    await p.goto(B + '/#/import'); await p.waitForSelector('[data-tpl]'); await p.goto(B + '/#/import?kind=' + kind); await p.waitForSelector('#ff'); await p.setInputFiles('#ff', D + file); await p.waitForSelector('#go');
    if (shotName) await shot(shotName, { fullPage: true });
    await p.click('#go'); await p.waitForSelector('text=Import finished'); const t = await p.textContent('#res'); return t;
  };
  try {
    await p.goto(B); await p.evaluate(t => localStorage.setItem('maluti_token', t), token); await p.reload(); await p.waitForSelector('.tiles');
    await p.goto(B + '/#/import'); await p.waitForSelector('[data-tpl]'); await shot('290-import-home', { fullPage: true });
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-tpl="products"]')]); console.log('template', dl.suggestedFilename());
    let t = await imp('products', 'stock.xlsx', '291-import-products-check'); console.log('products:', t.replace(/\s+/g, ' ').slice(0, 160));
    await shot('292-import-products-done', { fullPage: true });
    const prods = await api('GET', '/products?q=Milk'); const milk = prods.find(x => x.sku === 'MLK002');
    console.log('milk', milk && milk.price, milk && milk.stock_qty, 'bread', (await api('GET', '/products?q=BRD001'))[0].price);
    t = await imp('products', 'stock.xlsx'); console.log('again:', t.replace(/\s+/g, ' ').slice(0, 120));
    t = await imp('leases', 'tenants.xlsx', '293-import-leases-check'); console.log('leases:', t.replace(/\s+/g, ' ').slice(0, 200));
    t = await imp('customer_balances', 'balances.csv'); console.log('balances:', t.replace(/\s+/g, ' ').slice(0, 200));
    await shot('294-import-balances-done', { fullPage: true });
    if (await p.$('#dl')) { const [d2] = await Promise.all([p.waitForEvent('download'), p.click('#dl')]); console.log('errors file', d2.suggestedFilename()); }
    t = await imp('trial_balance', 'tb.csv'); console.log('tb:', t.replace(/\s+/g, ' ').slice(0, 220));
    await p.evaluate(() => localStorage.setItem('maluti_lang', 'both'));
    t = await imp('patients', 'patients.csv', '295-import-patients-both-languages'); console.log('patients:', t.replace(/\s+/g, ' ').slice(0, 160));
    await p.goto(B + '/#/property'); await p.waitForSelector('[data-imp]'); await shot('296-import-button-on-module');
    await p.evaluate(() => localStorage.setItem('maluti_lang', 'st')); await p.goto(B + '/#/guide'); await p.waitForSelector('.gs-why'); await shot('297-guide-sesotho');
    await p.goto(B + '/#/hire?tab=items'); await p.waitForSelector('#ni'); await p.click('#ni'); await p.waitForSelector('.modal .help-note'); await shot('298-help-notes-sesotho'); await p.keyboard.press('Escape');
    await p.evaluate(() => localStorage.setItem('maluti_lang', 'en'));
    const rr = await api('GET', '/property/rent-roll'); console.log('rent roll units', rr.units, 'let', rr.occupied);
    const leases = await api('GET', '/leases'); console.log('leases', leases.map(l => `${l.number} ${l.status} dep ${l.deposit_held}`).join(' | '));
    const tb = await api('GET', '/reports/tb?from=2000-01-01&to=2999-12-31'); console.log('TB balanced', tb.debit === tb.credit, tb.rows.filter(r => ['1010', '2600', '3000', '2400'].includes(r.code)).map(r => `${r.code} ${r.debit}/${r.credit}`).join(' '));
    const pts = await api('GET', '/patients?q=Limpho'); console.log('patient', pts.map(x => `${x.file_no} ${x.dob} ${x.allergies} ${x.medical_aid} ${x.medical_aid_no}`));
  } catch (e) { await shot('dbg20'); throw e; }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none'); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
