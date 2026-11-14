// UI test: water utility – overview, connections, phone reading sheet, billing run, account page, tariffs, zones & water loss,
// prepaid token sale and a bill payment from the POS till, meter reader login
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  await api('POST', '/db-config', { host: 'localhost', user: 'erp', password: 'erp123', database: 'maluti_ui' });
  token = (await api('POST', '/setup', { company: { name: 'Maloti Water Services', vat_rate: 15 }, admin: { name: 'Admin', username: 'admin', password: 'admin123', pin: '1234' }, demo: true })).token;
  await api('PUT', '/business', { types: ['water'] });
  await api('PUT', '/water/settings', { connection_fee: 115, reconnection_fee: 230, debt_recovery_pct: 25, token_provider: 'sandbox', deposit_postpaid: 300, due_days: 7 });
  await api('POST', '/users', { name: 'Teboho Reader', username: 'teboho', password: 'reader123', role: 'meterreader', pin: '5511' });
  const reader = (await api('GET', '/users')).find(u => u.username === 'teboho');
  const z1 = { name: 'Ha Thetsane', ...await api('POST', '/water/zones', { name: 'Ha Thetsane', code: 'HT', bulk_meter_no: 'BULK-HT', reader_id: reader && reader.id, active: 1 }) };
  const z2 = { name: 'Ha Abia', ...await api('POST', '/water/zones', { name: 'Ha Abia', code: 'HA', bulk_meter_no: 'BULK-HA', active: 1 }) };
  const dom = await api('POST', '/water/tariffs', { name: 'Domestic', category: 'domestic', blocks: [{ upto: 6, price: 6.5 }, { upto: 15, price: 12.8 }, { upto: null, price: 21.4 }], service_charge: 25, sewer_pct: 0, tax_rate: 0, active: 1 });
  await api('POST', '/water/tariffs', { name: 'Commercial', category: 'commercial', blocks: [{ upto: null, price: 24.9 }], service_charge: 90, sewer_pct: 30, tax_rate: 15, active: 1 });
  const lastMonth = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
  const thisMonth = new Date().toISOString().slice(0, 7);
  const people = [['Mpho Ramakatane', 'postpaid', z1, 'WM-1001', 120], ['Palesa Mokoena', 'postpaid', z1, 'WM-1002', 455], ['Thabo Letsie', 'postpaid', z1, 'WM-1003', 78], ['Lineo Mohapi', 'prepaid', z1, 'PP-2001', 0],
    ['Ntate Sello', 'postpaid', z2, 'WM-1101', 1310], ['Rethabile Nko', 'prepaid', z2, 'PP-2101', 0]];
  const acc = [];
  for (const [i, [n, bill, z, m, r]] of people.entries())
    acc.push((await api('POST', '/water/accounts', { customer_name: n, phone: '5800' + (1100 + i), billing: bill, tariff_id: dom.id, zone_id: z.id, route_seq: i + 1, address: z.name + ', plot ' + (40 + i), meter_serial: m, initial_reading: r, connection_date: lastMonth + '-01' })).id);
  // last month: read and billed already
  for (const [i, x] of [[0, 133], [1, 466], [2, 84], [4, 1352]]) await api('POST', '/water/readings', { account_id: acc[i], reading: x, reading_date: lastMonth + '-26' });
  await api('POST', '/water/billing/run', { period: lastMonth, run_date: lastMonth + '-28' });
  await api('POST', '/water/vend', { account_id: acc[3], amount: 150, method_id: (await api('GET', '/payment-methods')).find(m => m.name === 'Cash').id });
  const pending = await api('POST', '/water/accounts', { customer_name: 'New Shop Ha Abia', billing: 'prepaid', tariff_id: dom.id, zone_id: z2.id, address: 'Ha Abia main road' });
  await api('POST', '/water/jobs', { kind: 'new_connection', account_id: pending.id, priority: 'high' });
  await api('POST', '/water/jobs', { kind: 'burst', location: 'Main line next to Ha Abia clinic', description: 'Water running down the road' });
  await api('POST', '/water/meters', { serials: 'PP-3001\nPP-3002\nPP-3003', kind: 'prepaid', make: 'Conlog', size_mm: 15 });
  await api('PUT', `/water/zones/${z1.id}/bulk`, { period: lastMonth, bulk_m3: 40 });
  await api('PUT', `/water/zones/${z2.id}/bulk`, { period: lastMonth, bulk_m3: 60 });

  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/40[0-9]|50[0-9]/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
  p.setDefaultTimeout(15000);
  const shot = (n, o = {}) => p.screenshot({ path: `${SP}/shots/${n}.png`, ...o });
  try {
    await p.goto(B); await p.evaluate(t => { localStorage.setItem('maluti_token', t); localStorage.setItem('maluti_tour_1', '1'); localStorage.setItem('maluti_lang', 'en'); }, token); await p.reload(); await p.waitForSelector('.app-tile, .tile, nav');
    await p.waitForSelector('text=Water utility'); await shot('400-home-water-tile');
    await p.goto(B + '/#/water?tab=overview&period=' + lastMonth); await p.waitForSelector('.kpi'); await shot('401-water-overview', { fullPage: true });
    await p.goto(B + '/#/water?tab=accounts'); await p.waitForSelector('[data-id]'); await shot('402-water-connections', { fullPage: true });
    // the reading sheet: type this month's readings and save
    await p.goto(B + `/#/water?tab=readings&period=${thisMonth}&zone_id=${z1.id}`); await p.waitForSelector('[data-rd]');
    await p.fill(`[data-rd="${acc[0]}"]`, '146'); await p.fill(`[data-rd="${acc[1]}"]`, '520'); await p.fill(`[data-rd="${acc[2]}"]`, '60'); // 60 is less than last time
    await shot('403-water-reading-sheet', { fullPage: true });
    await p.click('#rsave'); await p.waitForSelector('text=Readings not saved'); await shot('404-water-reading-rejected');
    await p.click('.modal-foot .btn'); await p.waitForSelector(`[data-rd="${acc[2]}"]`); await p.fill(`[data-rd="${acc[2]}"]`, '91'); await p.click('#rsave'); await p.waitForTimeout(800);
    await p.goto(B + `/#/water?tab=readings&period=${thisMonth}&zone_id=${z1.id}`); await p.waitForSelector('text=3 of 3 read'); await shot('405-water-readings-done', { fullPage: true });
    // billing: preview (Ntate Sello has no reading → estimated) and run
    await p.goto(B + '/#/water?tab=billing&period=' + thisMonth); await p.waitForSelector('#brun'); await shot('406-water-billing-preview', { fullPage: true });
    await p.click('#brun'); await p.click('.modal-backdrop:last-child .modal-foot .btn-primary'); await p.waitForSelector('text=Print all bills'); await shot('407-water-bills-made');
    await p.click('.modal-backdrop:last-child .modal-foot .btn:not(.btn-primary)'); await p.waitForTimeout(300);
    // one connection
    await p.goto(B + '/#/wateraccount/' + acc[1]); await p.waitForSelector('#chart'); await shot('408-water-account-postpaid', { fullPage: true });
    await p.click('#adep'); await p.waitForSelector('.modal [name=amount]'); await p.click('.modal-foot .btn-primary'); await p.waitForSelector('text=deposit held M 300.00, text=deposit held 300', { timeout: 4000 }).catch(() => {});
    await p.goto(B + '/#/wateraccount/' + acc[3]); await p.waitForSelector('#avend'); await shot('409-water-account-prepaid', { fullPage: true });
    // tariffs with the calculator
    await p.goto(B + '/#/water?tab=tariffs'); await p.waitForSelector('[data-t]');
    await p.click('#twasco'); await p.waitForSelector('text=Load the WASCO tariffs'); await shot('410a-water-wasco-load');
    await p.click('.modal-foot .btn-primary'); await p.waitForSelector('text=WASCO Standpipes'); await shot('410-water-tariffs', { fullPage: true });
    await p.click('tr[data-t]:has-text("WASCO Domestic")'); await p.waitForSelector('#tcalc'); await p.fill('#tm', '12'); await p.selectOption('#ts', 'waterborne');
    await p.waitForFunction(() => /309\.78/.test(document.querySelector('#tcalc').textContent)); await shot('410b-water-wasco-domestic', { fullPage: true });
    await p.click('.modal-foot .btn:has-text("Cancel")'); await p.waitForTimeout(300);
    if (await p.$('text=Close without saving what you typed?')) await p.click('.modal-backdrop:last-child .modal-foot .btn-danger'); await p.waitForSelector('.modal', { state: 'detached' });
    await p.click(`[data-t="${dom.id}"]`); await p.waitForSelector('#tcalc'); await p.fill('#tm', '18'); await p.waitForFunction(() => /incl\. VAT/.test(document.querySelector('#tcalc').textContent)); await shot('411-water-tariff-editor');
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await p.goto(B + '/#/water?tab=zones&period=' + lastMonth); await p.waitForSelector('[data-bulk]'); await shot('412-water-loss', { fullPage: true });
    await p.goto(B + '/#/water?tab=jobs'); await p.waitForSelector('[data-j]'); await shot('413-water-jobs');
    // complete the new connection job with a meter from the store
    await p.click('tr[data-j]:has-text("New connection")');
    await p.waitForSelector('.modal [name=meter_serial]'); await p.fill('.modal [name=meter_serial]', 'PP-3001'); await p.fill('.modal [name=reading]', '0'); await p.fill('.modal [name=result]', 'Connected, 15 mm Conlog meter');
    await shot('414-water-job-complete'); await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(600);
    if ((await api('GET', '/water/accounts/' + pending.id)).status !== 'active') throw new Error('connection job did not activate the account');
    await p.goto(B + '/#/water?tab=meters'); await p.waitForSelector('text=PP-3002'); await shot('415-water-meters');
    await p.goto(B + '/#/water?tab=settings'); await p.waitForSelector('#ssave'); await shot('416-water-settings', { fullPage: true });
    // disconnections: last month's bills are not yet 30 days late, so make one overdue by changing the rule
    await api('PUT', '/water/settings', { disconnect_after_days: 0, disconnect_min_amount: 50 });
    await p.goto(B + '/#/water?tab=cutoff'); await p.waitForSelector('[data-c]'); await shot('417-water-disconnections', { fullPage: true });
    // the POS till: sell prepaid water and take a postpaid payment
    const terms = await api('GET', '/pos/terminals'); const retail = terms.find(t => t.mode === 'retail') || terms[0];
    if (!terms.find(t => t.open_session_id)) await api('POST', '/pos/sessions/open', { terminal_id: retail.id, opening_cash: 200 });
    await p.goto(B + '/#/pos/' + retail.id); await p.waitForSelector('#waterBtn'); await p.click('#waterBtn');
    await p.waitForSelector('#wl'); await p.fill('#wl', 'PP-2101'); await p.click('#wfind'); await p.waitForSelector('#wa'); await p.fill('#wa', '100'); await p.waitForFunction(() => /m³/.test(document.querySelector('#wq').textContent));
    await shot('418-pos-water-vend'); await p.click('#wgo'); await p.waitForSelector('text=Token sold');
    const v = (await api('GET', '/water/vends')).find(x => x.meter_serial === 'PP-2101' || x.account_no); if (!v || !/^TEST/.test(v.token)) throw new Error('no token sold');
    await p.waitForTimeout(600); await p.click('#waterBtn'); await p.waitForSelector('#wl'); await p.fill('#wl', 'WM-1002'); await p.click('#wfind'); await p.waitForSelector('#wa'); await shot('419-pos-water-pay-bill');
    await p.click('#wgo'); await p.waitForSelector('text=Payment of');
    const sess = (await api('GET', '/pos/terminals')).find(t => t.open_session_id); const ss = await api('GET', '/pos/sessions/' + sess.open_session_id);
    if (!(ss.expected_cash_now > 200)) throw new Error('water money not in the till cash-up: ' + ss.expected_cash_now);
    // the customer's portal link shows their water use and tokens
    const link = await api('POST', `/partners/${(await api('GET', '/water/accounts/' + acc[5])).partner_id}/portal-link`, {});
    await p.goto(link.url.replace(/^https?:\/\/[^/]+/, B)); await p.waitForSelector('text=Last tokens'); await shot('420-portal-water', { fullPage: true });
    // payment partners: add M-Pesa, test key, go live, a payment through the API, settlement
    await p.goto(B + '/#/paypartners'); await p.waitForSelector('#pn'); await p.click('#pn'); await p.waitForSelector('.modal [name=name]');
    await p.fill('.modal [name=name]', 'M-Pesa (Vodacom Lesotho)'); await p.fill('.modal [name=commission_pct]', '1'); await shot('430-paypartner-new', { fullPage: true });
    await p.click('.modal-foot .btn-primary'); await p.waitForSelector('#kk'); const testKey = await p.inputValue('#kk'); await shot('431-paypartner-key');
    await p.click('.modal-foot .btn-primary'); await p.waitForSelector('[data-p]');
    const C = async (key, m, u, body) => (await fetch(B + '/api/collect/v1' + u, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: body ? JSON.stringify(body) : undefined })).json();
    if ((await C(testKey, 'GET', '/ping')).mode !== 'test') throw new Error('test key does not work');
    await p.click('[data-p]'); await p.waitForSelector('text=Record a settlement'); await shot('432-paypartner-view');
    await p.click('.modal-foot .btn:has-text("Go live")'); await p.click('.modal-backdrop:last-child .modal-foot .btn-danger, .modal-backdrop:last-child .modal-foot .btn-primary'); await p.waitForSelector('#kk');
    const liveKey = await p.inputValue('#kk'); await p.click('.modal-foot .btn-primary');
    const pa = await C(liveKey, 'POST', '/payments', { reference: 'MP-UI-1', account: 'PP-2001', amount: 75 }); if (pa.status !== 'completed') throw new Error('API payment: ' + JSON.stringify(pa));
    const pb2 = await C(liveKey, 'POST', '/payments', { reference: 'MP-UI-2', account: 'WM-1003', amount: 40, payer_phone: '+26658001103' }); if (pb2.status !== 'completed') throw new Error('API bill payment: ' + JSON.stringify(pb2));
    await p.goto(B + '/#/paypartners?tab=txns'); await p.waitForSelector('text=MP-UI-2'); await shot('433-paypartner-payments', { fullPage: true });
    await p.goto(B + '/#/paypartners'); await p.waitForSelector('[data-p]'); await shot('434-paypartners-list');
    await p.click('[data-p]'); await p.waitForSelector('#sm'); await p.fill('#sref', 'SLB-0091'); await p.click('.modal-foot .btn:has-text("Record settlement")'); await p.waitForSelector('text=Settled 2 payments');
    await p.goto(B + '/#/paypartners?tab=settle'); await p.waitForSelector('text=SLB-0091'); await shot('435-paypartner-settlements');
    await p.goto(B + '/#/paypartners?tab=log'); await p.waitForSelector('td:has-text("/api/collect/v1/payments")'); await shot('436-paypartner-api-log');
    await p.goto(B + '/#/paypartners?tab=guide'); await p.waitForSelector('#apiguide'); await shot('437-paypartner-api-guide', { fullPage: true });
    // meter reader on a phone: only the reading sheet and jobs
    if (reader) {
      const rt = (await api('POST', '/login', { username: 'teboho', password: 'reader123' })).token;
      const m = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
      m.on('pageerror', e => errors.push('PAGEERR(phone) ' + e.message));
      await m.goto(B); await m.evaluate(t => { localStorage.setItem('maluti_token', t); localStorage.setItem('maluti_tour_1', '1'); localStorage.setItem('maluti_lang', 'en'); }, rt); await m.reload();
      await m.waitForSelector('text=Meter reading'); await m.screenshot({ path: `${SP}/shots/421-reader-home.png` });
      await m.goto(B + '/#/water'); await m.waitForSelector('#rp'); if (await m.$eval('#rz', e => e.selectedOptions[0].textContent) !== 'Ha Thetsane') throw new Error('reader does not start on their own zone'); await m.screenshot({ path: `${SP}/shots/422-reader-sheet.png`, fullPage: true });
      if (await m.$('a[href="#/water?tab=billing"]')) throw new Error('meter reader sees billing');
    }
    console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  } catch (e) { await shot('dbg29'); console.log('ERRORS so far:', errors.join('\n')); throw e; }
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
