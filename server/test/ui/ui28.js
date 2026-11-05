// UI test: foolproofing – required fields highlighted, unsaved-changes guard, friendly offline message
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
(async () => {
  const token = (await (await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) })).json()).token;
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message));
  p.setDefaultTimeout(12000);
  await p.goto(B); await p.evaluate(t => { localStorage.setItem('maluti_token', t); localStorage.setItem('maluti_tour_1', '1'); localStorage.setItem('maluti_lang', 'en'); }, token); await p.reload(); await p.waitForSelector('.tiles');
  await p.goto(B + '/#/partners?type=customer'); await p.waitForSelector('#np'); await p.click('#np'); await p.waitForSelector('.modal [name=name]');
  await p.click('.modal-foot .btn-primary'); await p.waitForSelector('.modal [name=name].invalid'); await p.waitForSelector('.toast:has-text("Fill in")');
  await p.screenshot({ path: SP + '/shots/390-required-highlight.png' });
  await p.fill('.modal [name=name]', 'Half typed'); await p.keyboard.press('Escape');
  await p.waitForSelector('text=Close without saving what you typed?'); await p.screenshot({ path: SP + '/shots/391-unsaved-guard.png' });
  await p.click('.modal-backdrop:last-child .modal-foot .btn:not(.btn-primary):not(.btn-danger)'); // keep editing
  if (!(await p.$('.modal [name=name]'))) throw new Error('dialog closed although the user chose to keep it');
  await p.keyboard.press('Escape'); await p.waitForSelector('text=Close without saving what you typed?'); await p.click('.modal-backdrop:last-child .modal-foot .btn-danger, .modal-backdrop:last-child .modal-foot .btn-primary');
  await p.waitForSelector('.modal', { state: 'detached' });
  // offline: the server cannot be reached
  await p.route('**/api/products*', r => r.abort('internetdisconnected'));
  await p.goto(B + '/#/products'); await p.waitForSelector('text=Cannot reach S-ERP'); await p.screenshot({ path: SP + '/shots/392-offline-message.png' });
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none'); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
