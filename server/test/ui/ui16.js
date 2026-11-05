// UI test: payment reminders (runs after ui15 on the same DB)
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  token = (await api('POST', '/login', { username: 'admin', password: 'admin123' })).token;
  // overdue accounts: the tenant's water charge and a parent's old fees
  const lease0 = (await api('GET', '/leases'))[0]; const learners = await api('GET', '/learners');
  for (const [pid, extra, desc, amt] of [[lease0.tenant_id, { lease_id: lease0.id }, 'Water September', 180], [learners[0].guardian_id, {}, 'Arrears Term 3 2026', 1900]]) {
    const inv = await api('POST', '/invoices', { kind: 'customer_invoice', partner_id: pid, invoice_date: '2026-09-01', due_date: '2026-09-30', lines: [{ description: desc, qty: 1, unit_price: amt, tax_rate: 0 }] });
    await api('POST', `/invoices/${inv.id}/post`);
  }
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/40[0-4]/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
  p.setDefaultTimeout(10000);
  const shot = (n, o = {}) => p.screenshot({ path: `${SP}/shots/${n}.png`, ...o });
  try {
    await p.goto(B); await p.evaluate(t => localStorage.setItem('maluti_token', t), token); await p.reload(); await p.waitForSelector('.tiles');
    await p.goto(B + '/#/reminders?tab=settings'); await p.waitForSelector('#smsc [name=mode]');
    await p.selectOption('#smsc [name=mode]', 'log'); await p.fill('#smsc [name=sender]', 'LESEDI');
    await p.check('#autoc [name=enabled]'); await p.waitForTimeout(600); await shot('220-reminder-settings', { fullPage: true });
    await p.fill('#tn', '5800 0000'); await p.click('#tt'); await p.waitForSelector('text=Test SMS sent');
    await p.goto(B + '/#/reminders'); await p.waitForSelector('#send'); await p.waitForTimeout(300); await shot('221-who-owes', { fullPage: true });
    const boxes = await p.$$('[data-p]');
    if (boxes.length) { await p.check('#all'); await p.click('#send'); await p.waitForSelector('text=sent'); }
    await p.goto(B + '/#/reminders?tab=log'); await p.waitForSelector('.card'); await shot('222-reminder-log');
    const lease = (await api('GET', '/leases'))[0];
    await p.goto(B + '/#/lease/' + lease.id); await p.waitForSelector('#lst');
    if (await p.$('#lrm')) { await p.click('#lrm'); await p.waitForSelector('.modal .msg'); await shot('223-remind-one'); await p.click('.modal-foot .btn-primary'); await p.waitForSelector('text=SMS sent'); }
    console.log('rows to remind:', boxes.length);
  } catch (e) { await shot('dbg16'); throw e; }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none'); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
