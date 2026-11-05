// UI test: equipment & party hire (runs after ui17 on the same DB)
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  token = (await api('POST', '/login', { username: 'admin', password: 'admin123' })).token;
  const biz = await api('GET', '/business');
  await api('PUT', '/business', { modules: [...new Set([...biz.modules, 'hire'])] });
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/40[0-4]/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
  p.setDefaultTimeout(10000);
  const shot = (n, o = {}) => p.screenshot({ path: `${SP}/shots/${n}.png`, ...o });
  const save = async () => { await p.click('.modal-foot .btn-primary'); await p.waitForSelector('.modal', { state: 'detached' }); };
  try {
    await p.goto(B); await p.evaluate(t => localStorage.setItem('maluti_token', t), token); await p.reload(); await p.waitForSelector('.tiles');
    if (!await p.$('a[href="#/hire"]')) throw new Error('hire tile missing');
    await p.goto(B + '/#/hire?tab=items'); await p.waitForSelector('#ni');
    for (const [n, cat, q, day, wk, dep, rc] of [['Stretch tent 10 x 15 m', 'Tents', 2, 1800, 7000, 2000, 30000], ['Plastic chair white', 'Chairs', 200, 8, '', 2, 220], ['Round table 1.8 m', 'Tables', 25, 60, '', 20, 1500], ['Concrete mixer 350 l', 'Plant', 3, 350, 1500, 1000, 18000]]) {
      await p.click('#ni'); await p.fill('.modal [name=name]', n); await p.fill('.modal [name=category]', cat); await p.fill('.modal [name=qty_owned]', String(q)); await p.fill('.modal [name=rate_day]', String(day));
      if (wk) await p.fill('.modal [name=rate_week]', String(wk)); await p.fill('.modal [name=deposit]', String(dep)); await p.fill('.modal [name=replacement_cost]', String(rc));
      if (cat === 'Plant') { await p.check('.modal [name=track_maintenance]'); await shot('250-hire-item'); }
      await save(); await p.waitForSelector(`text=${n}`);
    }
    await p.click('#ht'); await p.waitForSelector('#tt'); await save();
    await shot('251-hire-items');
    // new hire: wedding with a tent, chairs and tables
    await p.goto(B + '/#/hire'); await p.waitForSelector('#nh'); await p.click('#nh'); await p.waitForSelector('#hl select');
    await p.fill('.modal [name=customer_name]', 'Mme Palesa Mokoena'); await p.fill('.modal [name=customer_phone]', '58112233');
    const end = await p.evaluate(() => { const x = new Date(); x.setDate(x.getDate() + 2); return x.toISOString().slice(0, 10); });
    await p.fill('.modal [name=end_date]', end); await p.dispatchEvent('.modal [name=end_date]', 'change'); await p.waitForTimeout(400);
    await p.fill('.modal [name=delivery_address]', 'Ha Abia, Maseru'); await p.fill('.modal [name=delivery_fee]', '400');
    const pick = async (i, label, q) => { await p.selectOption(`#hl select[data-i="${i}"]`, { label }); await p.waitForTimeout(150); await p.fill(`#hl input[data-k=qty][data-i="${i}"]`, String(q)); await p.dispatchEvent(`#hl input[data-k=qty][data-i="${i}"]`, 'change'); await p.waitForTimeout(150); };
    await pick(0, 'Stretch tent 10 x 15 m', 1); await p.click('#hadd'); await pick(1, 'Plastic chair white', 150); await p.click('#hadd'); await pick(2, 'Round table 1.8 m', 15);
    await shot('252-new-hire'); await save(); await p.waitForURL(/#\/hireorder\/\d+/); await p.waitForSelector('#ho');
    await p.click('#ho'); await p.waitForSelector('.modal [name=deposit]'); await shot('253-hand-over'); await save(); await p.waitForSelector('#hr');
    await shot('254-hire-out', { fullPage: true });
    await p.click('#hp'); await p.waitForTimeout(500);
    // back: 145 chairs (3 broken), 5 lost, tables all back
    await p.click('#hr'); await p.waitForSelector('[data-l]');
    const rows = await p.$$('[data-l]');
    for (const tr of rows) { const name = await tr.$eval('td', td => td.textContent);
      if (name.startsWith('Plastic')) { await (await tr.$('[data-f=qty]')).fill('145'); await (await tr.$('[data-f=damaged]')).fill('3'); await (await tr.$('[data-f=lost]')).fill('5'); await (await tr.$('[data-f=note]')).fill('3 cracked'); } }
    await shot('255-items-back'); await save(); await p.waitForSelector('#hs');
    await shot('256-to-settle', { fullPage: true });
    await p.click('#hs'); await p.waitForSelector('.modal [name=amount]'); await save(); await p.waitForSelector('text=settled');
    await shot('257-settled');
    await p.goto(B + '/#/hire?tab=available'); await p.waitForSelector('#ag'); await shot('258-what-is-free');
    await p.goto(B + '/#/hire?tab=report'); await p.waitForSelector('#rg'); await shot('259-hire-report');
    await p.goto(B + '/#/hire?tab=items'); await p.waitForSelector('[data-fix]'); await p.click('[data-fix]'); await save();
    await p.goto(B + '/#/hire?view=all'); await p.waitForSelector('[data-o]'); await shot('260-hires');
    const o = (await api('GET', '/hire/orders?view=all'))[0]; const inv = await api('GET', '/invoices/' + o.invoice_id);
    console.log('hire', o.number, o.status, 'invoice', inv.total, inv.status);
  } catch (e) { await shot('dbg18'); throw e; }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none'); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
