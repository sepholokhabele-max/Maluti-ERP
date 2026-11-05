// UI test: full Sesotho screens + translations review (runs after ui24-26)
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  token = (await api('POST', '/login', { username: 'admin', password: 'admin123' })).token;
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/40[0-9]|50[0-9]/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
  p.setDefaultTimeout(15000);
  const shot = (n, o = {}) => p.screenshot({ path: `${SP}/shots/${n}.png`, ...o });
  await p.goto(B); await p.evaluate(t => { localStorage.setItem('maluti_token', t); localStorage.setItem('maluti_tour_1', '1'); localStorage.setItem('maluti_lang', 'st'); }, token); await p.reload(); await p.waitForSelector('.tiles');
  await p.waitForTimeout(600); await shot('380-st-home');
  for (const [h, n] of [['#/products', '381-st-products'], ['#/partners?type=customer', '382-st-contacts'], ['#/hrm', '383-st-hr'], ['#/settings', '384-st-settings'], ['#/invoices?kind=customer_invoice', '385-st-invoices']]) {
    await p.goto(B + '/' + h); await p.waitForTimeout(1200); await shot(n);
  }
  const terms = await api('GET', '/pos/terminals');
  const t0 = Date.now(); await p.goto(B + '/#/pos/' + terms[0].id); await p.waitForSelector('#payBtn'); await p.waitForTimeout(800); console.log('pos load ms', Date.now() - t0);
  const payTxt = await p.textContent('#payBtn'); const tools = await p.textContent('.cart-tools'); await shot('386-st-pos');
  if (!/Lefa/.test(payTxt) || !/Bongata/.test(tools)) throw new Error('POS not in Sesotho: ' + payTxt + ' / ' + tools);
  // review screen: correct a word and see it applied
  await p.goto(B + '/#/translations?show=all'); await p.waitForSelector('#tt'); await p.fill('#q', 'Reorder level');
  await p.fill('tr[data-en="Reorder level"] [data-o]', 'Boemo ba ho odara bocha'); await shot('387-translations');
  await p.click('#sv'); await p.waitForSelector('.toast');
  const r = await api('GET', '/i18n/review'); if (r.overrides['Reorder level'] !== 'Boemo ba ho odara bocha') throw new Error('override not saved');
  await p.goto(B + '/#/translations?show=missing'); await p.waitForSelector('#tt'); await shot('388-translations-missing');
  console.log('missing texts recorded', Object.keys(r.missing).length);
  await p.evaluate(() => localStorage.setItem('maluti_lang', 'en'));
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none'); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
