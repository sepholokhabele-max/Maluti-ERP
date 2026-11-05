// UI test: first-run wizard end to end (fresh, database already chosen), then activation & KYC page and tour
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
const api = async (m, u, b) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  await api('POST', '/db-config', { host: 'localhost', user: 'erp', password: 'erp123', database: 'maluti_ui' });
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/40[0-4]/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
  p.setDefaultTimeout(15000);
  const shot = (n, o = {}) => p.screenshot({ path: `${SP}/shots/${n}.png`, ...o });
  try {
    await p.goto(B); await p.waitForSelector('[data-lang]'); await shot('320-wizard-welcome');
    await p.click('[data-lang="both"]'); await p.waitForTimeout(200); await p.click('#nx');
    await p.waitForSelector('#nm'); await p.click('#nx'); await p.waitForSelector('#wzErr:not(:empty)'); await shot('321-wizard-missing-name');
    await p.fill('#nm', 'Lesedi General Dealer'); await p.fill('#ph', '58'); await p.click('#nx'); await p.waitForFunction(() => /8/.test(document.querySelector('#wzErr').textContent));
    await p.fill('#ph', '+266 5800 1122'); await p.fill('#ad', 'Main Rd, Mafeteng'); await p.click('[data-vat="no"]'); await p.waitForTimeout(150); await shot('322-wizard-business', { fullPage: true });
    await p.click('#nx'); await p.waitForSelector('[data-t]'); await p.click('[data-t="restaurant"]'); await p.waitForTimeout(150); await shot('323-wizard-types', { fullPage: true });
    await p.click('#nx'); await p.waitForSelector('#on'); await p.fill('#on', 'Lineo Mokhele'); await p.fill('#p1', 'abc'); await p.click('#nx'); await p.waitForFunction(() => /6/.test(document.querySelector('#wzErr').textContent));
    await p.fill('#p1', 'Lesedi2026!'); await p.fill('#p2', 'Lesedi2026?'); await p.click('#nx'); await p.waitForFunction(() => /same|tšoane/.test(document.querySelector('#wzErr').textContent)); await shot('324-wizard-login-mismatch');
    await p.fill('#p2', 'Lesedi2026!'); await p.click('#nx'); await p.waitForSelector('[data-k]');
    await p.click('[data-k="merchant"]'); await p.waitForSelector('#mn'); await p.fill('#mn', 'MW-104455'); await shot('325-wizard-kyc-merchant');
    await p.click('#nx'); await p.waitForSelector('#mk'); await shot('326-wizard-review', { fullPage: true });
    await p.reload(); await p.waitForSelector('#nm, #on, #mk'); // a reload never loses the answers (but asks for the password again)
    if (await p.$('#on')) { await p.fill('#p1', 'Lesedi2026!'); await p.fill('#p2', 'Lesedi2026!'); await p.click('#nx'); await p.waitForSelector('[data-k]'); await p.click('#nx'); }
    await p.waitForSelector('#mk'); await p.click('#mk'); await p.waitForSelector('[data-go="#/guide"]'); await shot('327-wizard-done');
    await p.click('[data-go="#/"]'); await p.waitForSelector('.tour-tip'); await shot('328-tour');
    while (await p.$('.tour [data-n]')) { await p.click('.tour [data-n]'); await p.waitForTimeout(120); }
    await p.goto(B + '/#/activation'); await p.waitForSelector('#iid'); await shot('329-activation', { fullPage: true });
    console.log('activation banner', !!(await p.$('.act-banner')));
  } catch (e) { await shot('dbg23'); throw e; }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none'); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
