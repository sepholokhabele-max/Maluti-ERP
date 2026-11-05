// UI test: property & rent, school fees, sites & shifts
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  await api('POST', '/db-config', { host: 'localhost', user: 'erp', password: 'erp123', database: 'maluti_ui' });
  token = (await api('POST', '/setup', { company: { name: 'Lesedi Holdings', address: 'Kingsway, Maseru', phone: '+266 2231 0000' }, admin: { name: 'Lineo Mokhele', username: 'admin', password: 'admin123', pin: '1234' }, demo: true, business_types: ['rental', 'education', 'security', 'cleaning'] })).token;
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/40[0-4]/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
  p.setDefaultTimeout(10000);
  const shot = (n, o = {}) => p.screenshot({ path: `${SP}/shots/${n}.png`, ...o });
  const ok = () => p.click('.modal-foot .btn-primary');
  try {
    await p.goto(B); await p.evaluate(t => localStorage.setItem('maluti_token', t), token); await p.reload(); await p.waitForSelector('.tiles'); await shot('200-home-sectors');
    // ---------- property
    await p.goto(B + '/#/property'); await p.waitForSelector('#nb'); await p.click('#nb'); await p.waitForSelector('.modal [name=name]');
    await p.fill('.modal [name=name]', 'Mokhele Flats'); await p.fill('.modal [name=address]', 'Ha Thetsane, Maseru'); await shot('201-building-form'); await ok(); await p.waitForSelector('#bu');
    for (const [n, k, r] of [['Flat 1', 'flat', 3200], ['Flat 2', 'flat', 3200], ['Flat 3', 'flat', 3500], ['Shop 1', 'shop', 6000]]) {
      await p.click('#bu'); await p.waitForSelector('.modal [name=name]'); await p.fill('.modal [name=name]', n); await p.selectOption('.modal [name=kind]', k); await p.fill('.modal [name=market_rent]', String(r)); await ok(); await p.waitForSelector(`td:has-text("${n}")`);
    }
    await shot('202-building');
    await p.click('a:has-text("Let") >> nth=0'); await p.waitForSelector('[name=tenant_name]');
    await p.fill('[name=tenant_name]', 'Palesa Ramoholi'); await p.fill('[name=tenant_phone]', '5900 1234'); await p.fill('[name=escalation_pct]', '8');
    const n0 = new Date(); const st = new Date(n0.getFullYear(), n0.getMonth() - 1, 15); await p.fill('[name=start_date]', `${st.getFullYear()}-${String(st.getMonth() + 1).padStart(2, '0')}-15`);
    await shot('203-lease-new', { fullPage: true }); await p.click('#ls'); await p.waitForSelector('#la'); await p.click('#la'); await p.waitForSelector('#lr');
    await p.click('#ld'); await p.waitForSelector('.modal [name=amount]'); await ok(); await p.waitForSelector('text=Deposit recorded');
    await p.click('#lr'); await p.waitForSelector('.modal [name=amount]'); await p.fill('.modal [name=amount]', '3000'); await ok(); await p.waitForSelector('text=Payment recorded');
    await p.waitForTimeout(400); await shot('204-lease', { fullPage: true });
    await p.goto(B + '/#/property'); await p.waitForSelector('.kpi'); await p.waitForTimeout(300); await shot('205-rent-roll');
    await p.goto(B + '/#/property?tab=arrears'); await p.waitForSelector('.card'); await shot('206-rent-arrears');
    // ---------- school
    await api('PUT', '/school/settings', { sibling_discount_pct: 10, post_invoices: 1 });
    const g2 = await api('POST', '/school/classes', { name: 'Grade 2A', grade: 'Grade 2', sort: 2 }); const g1 = await api('POST', '/school/classes', { name: 'Grade 1A', grade: 'Grade 1', sort: 1, next_class_id: g2.id });
    await p.goto(B + '/#/school?tab=fees'); await p.waitForSelector('#nf');
    for (const [n, g, a, o] of [['Tuition', 'Grade 1', 2500, 0], ['Tuition', 'Grade 2', 2700, 0], ['Lunch', '', 600, 1]]) {
      await p.click('#nf'); await p.waitForSelector('.modal [name=name]'); await p.fill('.modal [name=name]', n); await p.selectOption('.modal [name=grade]', g); await p.fill('.modal [name=amount]', String(a)); if (o) await p.check('.modal [name=optional]');
      await ok(); await p.waitForTimeout(500);
    }
    await shot('207-fees');
    await p.click('#nl'); await p.waitForSelector('.modal [name=first_name]');
    await p.fill('.modal [name=first_name]', 'Neo'); await p.fill('.modal [name=last_name]', 'Ramoholi'); await p.selectOption('.modal [name=class_id]', String(g1.id)); await p.fill('.modal [name=birth_date]', '2019-03-01');
    await p.fill('.modal [name=guardian_name]', 'Mpho Ramoholi'); await p.fill('.modal [name=guardian_phone]', '5800 7777'); await shot('208-learner-form'); await ok(); await p.waitForSelector('#lp');
    const neo = (await api('GET', '/learners'))[0];
    await api('POST', '/learners', { first_name: 'Lineo', last_name: 'Ramoholi', class_id: g2.id, birth_date: '2017-05-01', guardian_id: neo.guardian_id });
    await api('POST', '/learners', { first_name: 'Tumelo', last_name: 'Sello', class_id: g1.id, guardian_name: 'Karabo Sello', guardian_phone: '5800 8888', bursary_pct: 50 });
    await p.check('[data-f]'); await p.click('#sf'); await p.waitForSelector('text=Saved');
    await p.goto(B + '/#/school?tab=billing'); await p.waitForSelector('#pv'); await p.click('#pv'); await p.waitForSelector('#pvr table'); await shot('209-billing-preview', { fullPage: true });
    await p.click('#go'); await ok(); await p.waitForSelector('text=invoices ·');
    await p.goto(B + '/#/learner/' + neo.id); await p.waitForSelector('#lp'); await p.click('#lp'); await p.waitForSelector('.modal [name=amount]'); await p.fill('.modal [name=amount]', '1500'); await ok(); await p.waitForSelector('text=received');
    await p.waitForTimeout(400); await shot('210-learner', { fullPage: true });
    await p.goto(B + '/#/school'); await p.waitForSelector('[data-id]'); await shot('211-learners');
    await p.goto(B + '/#/school?tab=arrears'); await p.waitForSelector('.card'); await shot('212-school-arrears');
    // ---------- sites
    for (const [f, l, j] of [['Thabo', 'Mokoena', 'Guard'], ['Lerato', 'Nthako', 'Guard'], ['Pule', 'Sello', 'Relief guard'], ['Mamello', 'Khoali', 'Cleaner']]) await api('POST', '/hrm/employees', { first_name: f, last_name: l, job_title: j, hire_date: '2026-01-01', basic_salary: 3900, status: 'active' });
    const client = await api('POST', '/partners', { name: 'LNDC', is_customer: 1 });
    await p.goto(B + '/#/sites'); await p.waitForSelector('#ns'); await p.click('#ns'); await p.waitForSelector('.modal [name=name]');
    await p.fill('.modal [name=name]', 'LNDC Kingsway – main gate'); await p.selectOption('.modal [name=partner_id]', String(client.id)); await p.fill('.modal [name=staff_night]', '2');
    await p.selectOption('.modal [name=billing]', 'per_shift'); await p.fill('.modal [name=rate]', '450'); await p.fill('.modal [name=instructions]', 'Search all vehicles leaving. Patrol every 2 hours. Call supervisor on 5800 0000.');
    await shot('213-site-form'); await ok(); await p.waitForSelector('#sr');
    await p.click('#sr'); await p.waitForSelector('[data-emp]'); const ch = await p.$$('[data-emp]'); await ch[0].check(); await ch[1].check(); await shot('214-roster'); await ok(); await p.waitForSelector('text=shifts planned');
    await p.waitForTimeout(400);
    await p.click('[data-in] >> nth=0'); await p.waitForTimeout(500); await p.click('[data-ab] >> nth=0'); await p.waitForSelector('.modal [name=replacement_id]');
    await p.fill('.modal [name=reason]', 'Sick'); await p.selectOption('.modal [name=replacement_id]', { label: 'Pule Sello · Relief guard' }); await p.click('.modal-foot .btn-danger'); await p.waitForTimeout(500);
    await p.click('#so'); await p.waitForSelector('.modal [name=text]'); await p.fill('.modal [name=text]', 'Patrol 20:00 – all doors locked, lights on'); await ok(); await p.waitForTimeout(400);
    await p.click('#si'); await p.waitForSelector('.modal [name=description]'); await p.fill('.modal [name=description]', 'Person climbed the fence near the generator at 02:10 and ran off when challenged.'); await p.fill('.modal [name=action_taken]', 'Supervisor called, area searched, nothing missing.'); await ok(); await p.waitForSelector('text=reported');
    await p.waitForTimeout(400); await shot('215-site', { fullPage: true });
    await p.goto(B + '/#/sites'); await p.waitForSelector('.kpi'); await shot('216-duty-board', { fullPage: true });
    const cl = await api('POST', '/sites', { name: 'Queen II Hospital – wards', partner_id: client.id, kind: 'cleaning', staff_day: 4, checklist: 'Floors mopped\nToilets cleaned\nBins emptied\nWindows wiped' });
    await p.goto(B + '/#/site/' + cl.id); await p.waitForSelector('#sn'); await p.click('#sn'); await p.waitForSelector('[data-ok]'); await p.uncheck('[data-ok="3"]'); await p.fill('[data-nt="3"]', 'Ward 3'); await p.fill('.modal [name=signed_by]', 'Sister Mosala');
    await shot('217-inspection'); await ok(); await p.waitForSelector('text=Inspection score');
    await p.goto(B + '/#/sites?tab=report'); await p.waitForSelector('.card'); await shot('218-site-profit', { fullPage: true });
    await p.goto(B + '/#/guide'); await p.waitForSelector('.guide-step'); await shot('219-guide', { fullPage: true });
  } catch (e) { await shot('dbg15'); throw e; }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none'); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
