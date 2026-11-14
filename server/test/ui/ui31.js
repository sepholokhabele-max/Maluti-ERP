// UI test: asset register (add, depreciation, move, count with scan, roll-forward, labels) and fleet management (setup, service,
// due list, a staff member asks for a vehicle, approval and logbook, fine, cost per km), kind of organisation in Settings
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b, tk = token) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: 'Bearer ' + tk } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  await api('POST', '/db-config', { host: 'localhost', user: 'erp', password: 'erp123', database: 'maluti_ui' });
  token = (await api('POST', '/setup', { company: { name: 'Maloti Water Services', vat_rate: 15, entity_type: 'parastatal', reg_no: 'Act 12 of 2010' }, admin: { name: 'Admin', username: 'admin', password: 'admin123', pin: '1234' }, demo: true, business_types: ['water'] })).token;
  const biz = await api('GET', '/business'); if (!['assets', 'procurement', 'fleet'].every(m => biz.modules.includes(m))) throw new Error('parastatal did not get the public-sector modules: ' + biz.modules);
  if ((await api('GET', '/tax/settings')).settings.entity !== 'company') throw new Error('tax entity not set');
  const cash = (await api('GET', '/payment-methods')).find(m => m.name === 'Cash').id;
  const cats = await api('GET', '/assets/categories'), C = n => cats.find(k => k.name.startsWith(n)).id;
  await api('POST', '/assets', { name: 'Toyota Hilux 2.4 GD – B 100 WTR', category_id: C('Motor'), cost: 420000, in_service_date: '2024-07-01', source: 'opening', opening_accum_dep: 113400, depreciated_upto: '2025-12', location: 'Head office', custodian: 'Transport officer' });
  await api('POST', '/assets', { name: 'Ha Thetsane reservoir 500 m³', category_id: C('Network'), cost: 2400000, in_service_date: '2018-01-01', source: 'opening', opening_accum_dep: 480000, depreciated_upto: '2025-12', location: 'Ha Thetsane' });
  for (const [n, c] of [['HP ProBook – finance', 15800], ['HP ProBook – billing', 15800], ['Office desk & chair set', 6400]]) await api('POST', '/assets', { name: n, category_id: C(n.startsWith('HP') ? 'Computer' : 'Furniture'), cost: c, in_service_date: '2026-02-01', source: 'paid', method_id: cash, location: 'Head office', custodian: 'Finance' });
  await api('POST', '/users', { name: 'Thato Engineer', username: 'thato', password: 'thato1234', role: 'staff', pin: '5566' });
  const staff = (await api('POST', '/login', { username: 'thato', password: 'thato1234' })).token;

  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/40[0-9]|50[0-9]/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
  p.setDefaultTimeout(15000);
  const shot = (n, o = {}) => p.screenshot({ path: `${SP}/shots/${n}.png`, ...o });
  const login = async (pg, tk) => { await pg.goto(B); await pg.evaluate(t => { localStorage.setItem('maluti_token', t); localStorage.setItem('maluti_tour_1', '1'); localStorage.setItem('maluti_lang', 'en'); }, tk); await pg.reload(); await pg.waitForSelector('.page, #app .apps, .tiles'); await pg.waitForLoadState('networkidle'); };
  try {
    await login(p, token);
    await p.goto(B + '/#/assets'); await p.waitForSelector('text=Depreciation is behind'); await shot('600-assets-overview', { fullPage: true });
    // add an asset through the form
    await p.click('#an'); await p.waitForSelector('.modal [name=name]');
    await p.fill('.modal [name=name]', 'Grundfos borehole pump SP 17'); await p.selectOption('.modal [name=category_id]', String(C('Plant'))); await p.fill('.modal [name=serial_no]', 'GF-SP17-0091');
    await p.fill('.modal [name=location]', 'Borehole 3, Ha Abia'); await p.fill('.modal [name=custodian]', 'Pump operator'); await p.fill('.modal [name=cost]', '86500'); await p.fill('.modal [name=vat_amount]', '12975');
    await p.fill('.modal [name=in_service_date]', '2026-03-01'); await p.fill('.modal [name=warranty_until]', '2027-01-10');
    await shot('601-asset-new', { fullPage: true }); await p.click('.modal-foot .btn-primary'); await p.waitForSelector('#xt');
    const aid = Number(p.url().split('/').pop());
    // depreciation run
    await p.goto(B + '/#/assets?tab=depreciation'); await p.waitForSelector('#dr'); await p.click('#dr'); await p.waitForSelector('text=depreciation on'); await shot('602-depreciation');
    await p.goto(B + '/#/asset/' + aid); await p.waitForSelector('text=Book value'); await shot('603-asset-detail', { fullPage: true });
    await p.click('#xt'); await p.waitForSelector('.modal [name=location]'); await p.fill('.modal [name=location]', 'Workshop'); await p.fill('.modal [name=note]', 'Taken out for repair'); await p.click('.modal-foot .btn-primary'); await p.waitForSelector('text=Taken out for repair');
    await p.goto(B + '/#/assets?tab=register'); await p.waitForSelector('[data-a]'); await shot('604-asset-register', { fullPage: true });
    // asset count with a scan
    await p.goto(B + '/#/assets?tab=counts'); await p.click('#cn'); await p.click('.modal-foot .btn-primary'); await p.waitForSelector('#ks');
    const list = await api('GET', '/assets'); await p.fill('#ks', list[0].asset_no); await p.press('#ks', 'Enter'); await p.waitForSelector('text=found');
    await p.click(`[data-miss="${list[1].id}"]`); await p.waitForSelector('text=missing'); await shot('605-asset-count', { fullPage: true });
    await p.goto(B + '/#/assets?tab=movement'); await p.waitForSelector('text=Property, plant and equipment'); await shot('606-asset-rollforward', { fullPage: true });
    await p.goto(B + '/#/assets?tab=categories'); await p.waitForSelector('[data-k]'); await shot('607-asset-categories');
    // fleet
    const vh = (await api('POST', '/vehicles', { reg_no: 'B 100 WTR', kind: 'bakkie', make: 'Toyota', model: 'Hilux', year: 2024, odometer: 61200, seats: 5, licence_expiry: '2026-11-30' })).id;
    await api('PUT', `/assets/${list.find(a => a.name.startsWith('Toyota')).id}`, { vehicle_id: vh });
    await p.goto(B + '/#/vehicle/' + vh); await p.waitForSelector('#vset'); await p.click('#vset'); await p.waitForSelector('.modal [name=service_interval_km]');
    await p.fill('.modal [name=service_interval_km]', '10000'); await p.fill('.modal [name=service_interval_months]', '12'); await p.fill('.modal [name=last_service_km]', '51500'); await p.fill('.modal [name=last_service_date]', '2026-01-20');
    await p.fill('.modal [name=expected_km_per_litre]', '11'); await p.check('.modal [name=pool]'); await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(500);
    await p.goto(B + '/#/fleet?tab=due'); await p.waitForSelector('text=Service'); await shot('608-fleet-due', { fullPage: true });
    await p.goto(B + `/#/vehicle/${vh}?tab=service`); await p.waitForSelector('#vs'); await p.click('#vs'); await p.waitForSelector('.modal [name=cost]');
    await p.fill('.modal [name=odometer]', '61400'); await p.fill('.modal [name=workshop]', 'Maseru Toyota'); await p.fill('.modal [name=description]', '60 000 km service, brake pads'); await p.fill('.modal [name=cost]', '4850');
    await p.click('.modal-foot .btn-primary'); await p.waitForSelector('text=Maseru Toyota'); await shot('609-vehicle-servicing', { fullPage: true });
    // a staff member asks for the vehicle
    const s = await b.newPage({ viewport: { width: 1280, height: 860 } }); s.on('pageerror', e => errors.push('STAFF ' + e.message));
    await login(s, staff); await s.waitForSelector('text=Ask for a vehicle'); await s.click('text=Ask for a vehicle'); await s.waitForSelector('#rqn'); await s.click('#rqn');
    const dt = h => { const x = new Date(Date.now() + h * 3600e3); return new Date(x - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
    await s.fill('.modal [name=purpose]', 'Inspect the Ha Abia borehole pump'); await s.fill('.modal [name=destination]', 'Ha Abia'); await s.fill('.modal [name=depart_at]', dt(20)); await s.fill('.modal [name=return_at]', dt(24)); await s.fill('.modal [name=passengers]', '2');
    await s.screenshot({ path: `${SP}/shots/610-ask-for-vehicle.png` }); await s.click('.modal-foot .btn-primary'); await s.waitForSelector('[data-q]'); await s.screenshot({ path: `${SP}/shots/611-my-requests.png` });
    await p.goto(B + '/#/fleet?tab=requests'); await p.waitForSelector('[data-q]'); await p.click('[data-q]'); await p.waitForSelector('#dv'); await shot('612-approve-request');
    await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(500);
    const rq = (await api('GET', '/fleet/requests'))[0];
    await api('POST', `/vehicles/${vh}/fuel`, { litres: 45, amount: 900, odometer: 61400, method_id: cash });
    await api('POST', `/fleet/requests/${rq.id}/out`, { odo_out: 61400 }); await api('POST', `/fleet/requests/${rq.id}/in`, { odo_in: 61486 });
    await api('POST', `/vehicles/${vh}/fuel`, { litres: 12, amount: 240, odometer: 61486, method_id: cash });
    await p.goto(B + `/#/vehicle/${vh}?tab=incidents`); await p.waitForSelector('#vi'); await p.click('#vi'); await p.waitForSelector('.modal [name=description]');
    await p.fill('.modal [name=description]', 'Parking on a yellow line, Kingsway'); await p.fill('.modal [name=amount]', '300'); await p.selectOption('.modal [name=method_id]', String(cash)); await p.click('.modal-foot .btn-primary'); await p.waitForSelector('text=Traffic fine');
    await shot('613-vehicle-incidents');
    await p.goto(B + '/#/fleet?tab=costs'); await p.waitForSelector('text=Cost per km'); await shot('614-fleet-cost-per-km', { fullPage: true });
    await p.goto(B + `/#/vehicle/${vh}?tab=bookings`); await p.waitForSelector('text=Inspect the Ha Abia'); await shot('615-vehicle-bookings');
    // settings: kind of organisation
    await p.goto(B + '/#/settings?tab=company'); await p.waitForSelector('[name=entity_type]'); if (await p.inputValue('[name=entity_type]') !== 'parastatal') throw new Error('entity not shown in settings');
    await shot('616-settings-entity', { fullPage: true });
    console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  } catch (e) { await shot('dbg31'); console.log('ERRORS so far:', errors.join('\n')); throw e; }
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
