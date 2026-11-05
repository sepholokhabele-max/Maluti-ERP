// UI test: maintenance, RFQ, make-to-order, projects, timesheets, helpdesk
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  await api('POST', '/db-config', { host: 'localhost', user: 'erp', password: 'erp123', database: 'maluti_ui' });
  token = (await api('POST', '/setup', { company: { name: 'Lesedi Bakery & Tech', address: 'Kingsway, Maseru', phone: '+266 2231 0000' }, admin: { name: 'Lineo Mokhele', username: 'admin', password: 'admin123', pin: '1234' }, demo: true, business_types: ['manufacturing', 'services'] })).token;
  await api('POST', '/users', { name: 'Teboho Tech', username: 'teboho', password: 'tech1234', pin: '5566', role: 'technician' });
  const mk = (name, extra) => api('POST', '/products', { name, type: 'stock', tax_id: 1, ...extra });
  const flour = await mk('Bread flour 25kg', { uom: 'bag', cost: 290, opening_qty: 2, pos_visible: 0 }); await mk('V-belt A42', { cost: 80, opening_qty: 5, pos_visible: 0 });
  const loaf = await mk('Brown loaf', { price: 15, cost: 0 }); await mk('Laptop charging port', { cost: 100, price: 230, opening_qty: 3 });
  await api('POST', '/mrp/boms', { product_id: loaf.id, name: '50 per mix', output_qty: 50, labour_cost: 100, lines: [{ product_id: flour.id, qty: 0.5 }] });
  await api('POST', '/partners', { name: 'Lesotho Flour Mills', is_supplier: 1, is_customer: 0, email: 'sales@lfm.co.ls' }); await api('POST', '/partners', { name: 'Bakers Supply SA', is_supplier: 1, is_customer: 0 });
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !m.text().includes('404') && !m.text().includes('401') && !m.text().includes('400')) errors.push('CONSOLE ' + m.text()); });
  p.on('dialog', d => d.accept());
  p.setDefaultTimeout(10000);
  const shot = (n, o = {}) => p.screenshot({ path: `${SP}/shots/${n}.png`, ...o });
  const ok = () => p.click('.modal-foot .btn-primary, .modal-foot .btn-ok');
  try {
    await p.goto(B); await p.evaluate(t => localStorage.setItem('maluti_token', t), token); await p.reload(); await p.waitForSelector('.tiles'); await shot('170-home-mfg-services');
    // machines & maintenance
    await p.goto(B + '/#/maintenance?tab=machines'); await p.waitForSelector('#nm'); await p.click('#nm'); await p.waitForSelector('.modal [name=name]');
    await p.fill('.modal [name=name]', 'Spiral dough mixer'); await p.fill('.modal [name=code]', 'MIX-1'); await p.fill('.modal [name=serial_no]', 'SM-2231'); await p.fill('.modal [name=interval_days]', '90');
    await shot('171-machine-form'); await ok(); await p.waitForSelector('text=Spiral dough mixer');
    await p.click('#rep'); await p.waitForSelector('.modal [name=title]'); await p.selectOption('.modal [name=priority]', 'urgent'); await p.fill('.modal [name=title]', 'Belt slipping, mixer stops'); await p.check('.modal [name=machine_down]');
    await shot('172-report-problem'); await ok(); await p.waitForSelector('text=reported');
    await p.goto(B + '/#/maintenance'); await p.waitForSelector('[data-id]'); await shot('173-maintenance-list'); await p.click('[data-id]'); await p.waitForSelector('#mStart'); await p.click('#mStart'); await p.waitForSelector('#mDone');
    await p.click('#mDone'); await p.waitForSelector('.modal [name=resolution]'); await p.fill('.modal [name=resolution]', 'Replaced V-belt'); await p.fill('.modal [name=labour_cost]', '150');
    await p.selectOption('.modal [data-pi="0"]', { label: 'V-belt A42' }); await p.fill('.modal [data-pq="0"]', '1'); await shot('174-maintenance-finish');
    await p.click('.modal-foot .btn-ok'); await p.waitForSelector('text=back in service'); await p.waitForTimeout(300); await shot('175-maintenance-done');
    // RFQ
    await p.goto(B + '/#/rfq/new'); await p.waitForSelector('[data-k=product_id]');
    await p.selectOption('[data-i="0"][data-k="product_id"]', { label: 'Bread flour 25kg' }); await p.fill('[data-i="0"][data-k="qty"]', '40');
    await p.click('#qAdd'); await p.fill('[data-i="1"][data-k="description"]', 'Dry yeast 500 g'); await p.fill('[data-i="1"][data-k="qty"]', '20');
    for (const n of ['Lesotho Flour Mills', 'Bakers Supply SA']) await p.click(`.mod:has-text("${n}")`);
    await shot('176-rfq-new', { fullPage: true }); await p.click('#qSave'); await p.waitForSelector('#qSend');
    await p.click('#qSend'); await p.waitForSelector('[data-enter]');
    const ents = await p.$$('[data-enter]'); await ents[0].click(); await p.waitForSelector('.modal [data-l]'); let ins = await p.$$('.modal [data-l]'); await ins[0].fill('285'); await ins[1].fill('48'); await p.fill('.modal [name=lead_days]', '2'); await p.click('.modal-foot .btn-primary'); await p.waitForSelector('text=Prices saved');
    await p.waitForTimeout(400); const ents2 = await p.$$('[data-enter]'); await ents2[1].click(); await p.waitForSelector('.modal [data-l]'); ins = await p.$$('.modal [data-l]'); await ins[0].fill('279'); await ins[1].fill('52'); await p.click('.modal-foot .btn-primary'); await p.waitForSelector('#qAward');
    await p.waitForTimeout(300); await shot('177-rfq-compare', { fullPage: true });
    await p.click('#qAward'); await p.click('.modal-foot .btn-primary'); await p.waitForSelector('text=purchase order(s)'); await p.waitForTimeout(300); await shot('178-rfq-ordered', { fullPage: true });
    // make to order
    const cust = (await api('GET', '/partners?is_customer=1'))[0];
    const so = await api('POST', '/sales', { partner_id: cust.id, delivery_date: '2026-11-10', lines: [{ product_id: loaf.id, qty: 200, unit_price: 12, tax_rate: 15 }] }); await api('POST', `/sales/${so.id}/confirm`, {});
    await p.goto(B + '/#/quote/' + so.id); await p.waitForSelector('#qMake'); await p.click('#qMake'); await p.waitForSelector('#mAll'); await shot('179-make-to-order'); await ok(); await p.waitForSelector('text=work order(s)');
    // projects
    await p.goto(B + '/#/projects'); await p.waitForSelector('#np'); await p.click('#np'); await p.waitForSelector('.modal [name=name]');
    await p.fill('.modal [name=name]', 'Office network – Ha Abia clinic'); await p.selectOption('.modal [name=partner_id]', String(cust.id)); await p.fill('.modal [name=hourly_rate]', '450'); await p.fill('.modal [name=budget_hours]', '20');
    await shot('180-project-form'); await ok(); await p.waitForSelector('#pTask');
    for (const [t, st] of [['Site survey', 'done'], ['Run cables to 6 offices', 'doing'], ['Install router & Wi-Fi', 'todo'], ['Hand-over & training', 'todo']]) {
      await p.click('#pTask'); await p.waitForSelector('.modal [name=title]'); await p.fill('.modal [name=title]', t); await p.selectOption('.modal [name=status]', st); await ok(); await p.waitForSelector(`.kb-card:has-text("${t}")`);
    }
    await p.click('#pLog'); await p.waitForSelector('.modal [name=hours]'); await p.fill('.modal [name=hours]', '3'); await p.fill('.modal [name=description]', 'Cabling block A'); await ok(); await p.waitForSelector('text=3 h logged');
    await p.waitForTimeout(400); await shot('181-project-board', { fullPage: true });
    await p.click('#pInv'); await p.waitForSelector('.modal [name=to]'); await ok(); await p.waitForSelector('text=Draft invoice made'); await p.waitForTimeout(400); await shot('182-project-invoice', { fullPage: true });
    await p.goto(B + '/#/timesheets'); await p.waitForSelector('#lg'); await shot('183-timesheets');
    // helpdesk
    await p.goto(B + '/#/helpdesk'); await p.waitForSelector('#nt'); await p.click('#nt'); await p.waitForSelector('.modal [name=subject]');
    await p.fill('.modal [name=subject]', 'Laptop does not charge'); await p.fill('.modal [name=contact_name]', 'Palesa Mohapi'); await p.fill('.modal [name=phone]', '+266 5888 1111');
    await p.selectOption('.modal [name=kind]', 'repair'); await p.selectOption('.modal [name=channel]', 'walk_in'); await p.selectOption('.modal [name=priority]', 'high');
    await p.fill('.modal [name=item]', 'HP 250 G8 laptop'); await p.fill('.modal [name=serial_no]', '5CD1234XYZ'); await shot('184-ticket-new'); await ok(); await p.waitForSelector('#mSend');
    await p.fill('#mBody', 'Booked in. We will WhatsApp you when it is ready.'); await p.click('#mSend'); await p.waitForTimeout(500);
    await p.fill('#mBody', 'Charging port loose – replace'); await p.check('#mInt'); await p.click('#mSend'); await p.waitForTimeout(500);
    await p.selectOption('[data-i="0"][data-k="product_id"]', { label: 'Laptop charging port' }); await p.click('#pSave'); await p.waitForSelector('text=Parts saved');
    await p.click('#tTime'); await p.waitForSelector('.modal [name=hours]'); await p.fill('.modal [name=hours]', '1.5'); await p.fill('.modal [name=description]', 'Replace port'); await ok(); await p.waitForSelector('text=1.5 h logged');
    await p.waitForTimeout(400); await shot('185-ticket', { fullPage: true });
    await p.click('#tInv'); await p.waitForSelector('.modal [name=callout]'); await ok(); await p.waitForSelector('text=Draft invoice made'); await p.waitForTimeout(400); await shot('186-ticket-invoice', { fullPage: true });
    await p.goto(B + '/#/helpdesk'); await p.waitForSelector('[data-id]'); await p.waitForTimeout(300); await shot('187-helpdesk');
    await p.goto(B + '/#/guide'); await p.waitForSelector('.guide-step'); await shot('188-guide', { fullPage: true });
    // technician view
    const tt = (await api('POST', '/login', { username: 'teboho', password: 'tech1234' })).token;
    await p.evaluate(t => localStorage.setItem('maluti_token', t), tt); await p.goto(B + '/#/'); await p.reload(); await p.waitForSelector('.tiles'); await shot('189-technician-home');
  } catch (e) { await shot('dbg13'); throw e; }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none'); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
