// UI test: tax centre – settings, calendar, VAT return from the books, filed, paid; withholding certificate; income tax instalment (runs after ui24)
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  token = (await api('POST', '/login', { username: 'admin', password: 'admin123' })).token;
  await api('PUT', '/smartel/settings', { enabled: false }).catch(() => {});
  // some sales and a supplier bill this month so the VAT return has figures
  const terms = await api('GET', '/pos/terminals'); const retail = terms.find(t => t.mode === 'retail');
  const cat = await api('GET', '/pos/catalog'); const cash = cat.methods.find(m => m.kind === 'cash');
  const tt = (await api('GET', '/pos/terminals')).find(t => t.id === retail.id);
  const sid = tt.open_session_id || (await api('POST', '/pos/sessions/open', { terminal_id: retail.id, opening_cash: 0 })).id;
  await api('POST', '/pos/checkout', { session_id: sid, lines: [{ product_id: cat.products[0].id, qty: 10 }], payments: [{ method_id: cash.id, amount: 1000 }] });
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/40[0-9]|50[0-9]/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
  p.setDefaultTimeout(15000);
  const shot = (n, o = {}) => p.screenshot({ path: `${SP}/shots/${n}.png`, ...o });
  try {
    await p.goto(B); await p.evaluate(t => localStorage.setItem('maluti_token', t), token); await p.reload(); await p.waitForSelector('.tiles');
    if (!await p.$('a[href="#/tax"]')) throw new Error('tax tile missing');
    await p.goto(B + '/#/tax?tab=settings'); await p.waitForSelector('#sf [name=tin]');
    await p.fill('#sf [name=tin]', 'TIN/2026/0042'); await p.check('#sf [name=vat_registered]'); await shot('350-tax-settings', { fullPage: true }); await p.click('#sv'); await p.waitForSelector('.toast');
    await p.goto(B + '/#/tax'); await p.waitForSelector('[data-prep]'); await shot('351-tax-calendar', { fullPage: true });
    const now = new Date(); const ym = now.toISOString().slice(0, 7);
    await p.click(`[data-prep*='"tax":"vat"'][data-prep*='${ym}-01']`); await p.waitForURL(/#\/taxreturn\/\d+/); await p.waitForSelector('#fl'); await shot('352-vat-return', { fullPage: true });
    await p.click('#fl'); await p.fill('.modal [name=filed_ref]', 'ETAX-55120'); await p.click('.modal-foot .btn-primary'); await p.waitForSelector('#py');
    await p.click('#py'); await p.waitForSelector('.modal [name=method]'); await p.selectOption('.modal [name=method]', 'bank'); await p.fill('.modal [name=reference]', 'EFT-0091'); await shot('353-vat-pay');
    await p.click('.modal-foot .btn-primary'); await p.waitForSelector('.badge-paid'); await shot('354-vat-paid', { fullPage: true });
    // withholding
    await p.goto(B + '/#/tax?tab=wht'); await p.waitForSelector('#wf [name=gross]'); await p.fill('#wf [name=gross]', '3000'); await p.fill('#wf [name=reference]', 'INV-778 painting'); await p.click('#wb'); await p.waitForSelector('[data-cert]'); await shot('355-wht', { fullPage: true });
    // provisional income tax with an estimate
    await p.goto(B + '/#/tax'); await p.waitForSelector('[data-prep]');
    const cit = await p.$(`[data-prep*='"tax":"cit_']`); if (cit) { await cit.click(); await p.waitForURL(/#\/taxreturn\/\d+/); await p.waitForSelector('#inF');
      await p.fill('#inF [name=estimated_income]', '240000'); await p.click('#inB'); await p.waitForFunction(() => /60[ ,]?000/.test(document.body.innerText)); await shot('356-income-tax-instalment', { fullPage: true }); }
    await p.goto(B + '/#/tax?tab=returns'); await p.waitForSelector('[data-r]'); await shot('357-tax-returns');
    await p.evaluate(() => { localStorage.setItem('maluti_lang', 'st'); }); await p.goto(B + '/#/tax'); await p.reload(); await p.waitForSelector('#txb table'); await shot('358-tax-calendar-sesotho');
    await p.evaluate(() => { localStorage.setItem('maluti_lang', 'en'); });
  } catch (e) { await shot('dbg25'); throw e; }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none'); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
