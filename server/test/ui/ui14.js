// UI test: pipeline, contracts, attachments, Excel export
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  await api('POST', '/db-config', { host: 'localhost', user: 'erp', password: 'erp123', database: 'maluti_ui' });
  token = (await api('POST', '/setup', { company: { name: 'Lesedi Services', address: 'Kingsway, Maseru', phone: '+266 2231 0000' }, admin: { name: 'Lineo Mokhele', username: 'admin', password: 'admin123', pin: '1234' }, demo: true, business_types: ['services', 'education'] })).token;
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1366, height: 860 }, acceptDownloads: true }); const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/40[0-4]/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
  p.setDefaultTimeout(10000);
  const shot = (n, o = {}) => p.screenshot({ path: `${SP}/shots/${n}.png`, ...o });
  const ok = () => p.click('.modal-foot .btn-primary');
  try {
    await p.goto(B); await p.evaluate(t => localStorage.setItem('maluti_token', t), token); await p.reload(); await p.waitForSelector('.tiles'); await shot('190-home-services');
    // leads
    const mkLead = async (title, company, value, src) => { await p.click('#nl'); await p.waitForSelector('.modal [name=title]'); await p.fill('.modal [name=title]', title); await p.fill('.modal [name=company]', company); await p.fill('.modal [name=expected_value]', String(value)); await p.selectOption('.modal [name=source]', src); await ok(); await p.waitForSelector('#lAct'); };
    await p.goto(B + '/#/pipeline'); await p.waitForSelector('#nl');
    await p.click('#nl'); await p.waitForSelector('.modal [name=title]'); await p.fill('.modal [name=title]', 'Uniforms for 120 learners'); await p.fill('.modal [name=company]', 'Ha Abia High School');
    await p.fill('.modal [name=contact_name]', 'Mrs Lerato Ntsane'); await p.fill('.modal [name=phone]', '+266 2231 9999'); await p.fill('.modal [name=expected_value]', '48000'); await p.selectOption('.modal [name=source]', 'referral'); await p.selectOption('.modal [name=priority]', '3');
    await shot('191-lead-form'); await ok(); await p.waitForSelector('#lAct');
    await p.click('#lAct'); await p.waitForSelector('.modal [name=subject]'); await p.fill('.modal [name=subject]', 'Call about sizes and colours'); await ok(); await p.waitForTimeout(400);
    await shot('192-lead', { fullPage: true });
    for (const [t, c, v, s] of [['Office cleaning – 3 floors', 'LNDC', 90000, 'tender'], ['Security for wedding venue', 'Thaba Bosiu Venue', 12000, 'facebook'], ['IT support contract', 'Ha Abia clinic', 36000, 'phone']]) { await p.goto(B + '/#/pipeline'); await p.waitForSelector('#nl'); await mkLead(t, c, v, s); }
    const leads = await api('GET', '/leads'); const stages = await api('GET', '/crm/stages');
    await api('PUT', `/leads/${leads.find(l => l.title.startsWith('Office')).id}`, { stage_id: stages[3].id });
    await api('PUT', `/leads/${leads.find(l => l.title.startsWith('IT')).id}`, { stage_id: stages[1].id });
    await p.goto(B + '/#/pipeline'); await p.waitForSelector('.kb-card'); await shot('193-pipeline', { fullPage: true });
    // quotation from the uniforms lead → confirm → won
    await p.click('.kb-card:has-text("Uniforms")'); await p.waitForSelector('#lQuote'); await p.click('#lQuote'); await p.waitForSelector('[data-k="description"]');
    await p.fill('[data-i="0"][data-k="description"]', 'School uniform set (shirt, trousers/skirt, jersey)').catch(async () => { await p.click('#qAdd'); await p.fill('[data-i="0"][data-k="description"]', 'School uniform set'); });
    await p.fill('[data-i="0"][data-k="qty"]', '120'); await p.fill('[data-i="0"][data-k="unit_price"]', '350'); await p.press('[data-i="0"][data-k="unit_price"]', 'Tab');
    await p.click('#qSave'); await p.waitForSelector('#qConfirm'); await p.click('#qConfirm'); await p.waitForSelector('.modal input'); await ok(); await p.waitForSelector('#qInvoice');
    await p.goto(B + '/#/pipeline?status=won'); await p.waitForSelector('[data-l]'); await shot('194-pipeline-won');
    // contract
    const n0 = new Date(); const first = new Date(n0.getFullYear(), n0.getMonth() - 1, 1); const ymd = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    await p.goto(B + '/#/contract/new'); await p.waitForSelector('#ch [name=name]');
    await p.fill('#ch [name=name]', 'IT support – Ha Abia clinic'); await p.fill('#ch [name=start_date]', ymd(first)); await p.fill('#ch [name=due_days]', '10');
    await p.fill('[data-i="0"][data-k="description"]', 'Monthly IT support (8 hours)'); await p.fill('[data-i="0"][data-k="unit_price"]', '3000'); await p.press('[data-i="0"][data-k="unit_price"]', 'Tab');
    await shot('195-contract-new', { fullPage: true });
    await p.click('#cSave'); await p.waitForSelector('#cAct'); await p.click('#cAct'); await p.waitForSelector('#cNow'); await p.click('#cNow'); await p.waitForSelector('text=invoice(s) made'); await p.waitForTimeout(400);
    await shot('196-contract-active', { fullPage: true });
    await p.goto(B + '/#/contracts'); await p.waitForSelector('[data-id]'); await shot('197-contracts');
    // attachments on an invoice
    const ct = (await api('GET', '/contracts')).rows[0]; const cv = await api('GET', '/contracts/' + ct.id);
    await p.goto(B + '/#/invoice/' + cv.invoices[0].id); await p.waitForSelector('[data-att]', { state: 'attached' });
    await p.setInputFiles('[data-att]', `${__dirname}/fixtures/sample-logo.png`); await p.waitForSelector('.att'); await shot('198-invoice-files', { fullPage: true });
    // Excel export
    await p.goto(B + '/#/products'); await p.waitForSelector('[data-xlsx]');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-xlsx]')]);
    await dl.saveAs(`${SP}/products.xlsx`); console.log('download', dl.suggestedFilename());
    await p.goto(B + '/#/reports?tab=pl&from=2000-01-01&to=2999-12-31'); await p.waitForSelector('[data-xlsx]');
    const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('[data-xlsx]')]); await dl2.saveAs(`${SP}/pl.xlsx`);
    await shot('199-excel-button');
  } catch (e) { await shot('dbg14'); throw e; }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none'); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
