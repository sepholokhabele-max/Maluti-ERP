// UI test: rooms & bookings, fleet & trips (runs after ui16 on the same DB)
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  token = (await api('POST', '/login', { username: 'admin', password: 'admin123' })).token;
  const biz = await api('GET', '/business');
  await api('PUT', '/business', { modules: [...new Set([...biz.modules, 'rooms', 'fleet', 'maintenance'])] });
  const emps = await api('GET', '/fleet/staff');
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/40[0-4]/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
  p.setDefaultTimeout(10000);
  const shot = (n, o = {}) => p.screenshot({ path: `${SP}/shots/${n}.png`, ...o });
  const save = async () => { await p.click('.modal-foot .btn-primary'); await p.waitForSelector('.modal', { state: 'detached' }); };
  try {
    await p.goto(B); await p.evaluate(t => localStorage.setItem('maluti_token', t), token); await p.reload(); await p.waitForSelector('.tiles');
    if (!await p.$('a[href="#/rooms"]') || !await p.$('a[href="#/fleet"]')) throw new Error('tiles missing');
    // ---- rooms setup
    await p.goto(B + '/#/rooms?tab=setup'); await p.waitForSelector('#nt');
    for (const [n, rate] of [['Standard double', 850], ['Family room', 1300]]) { await p.click('#nt'); await p.fill('.modal [name=name]', n); await p.fill('.modal [name=rate]', String(rate)); await save(); await p.waitForSelector(`text=${n}`); }
    for (const n of ['1', '2', '3', '4']) { await p.click('#nr'); await p.fill('.modal [name=name]', n); if (n === '4') await p.selectOption('.modal [name=room_type_id]', { index: 1 }); await save(); }
    await p.waitForTimeout(300); await shot('230-rooms-setup');
    // walk-in booking from the desk
    await p.goto(B + '/#/rooms'); await p.waitForSelector('#nb'); await p.click('#nb'); await p.waitForSelector('.modal [name=room_id] option[data-rate]', { state: 'attached' });
    await p.fill('.modal [name=guest_name]', 'Lineo Mohapi'); await p.fill('.modal [name=guest_phone]', '58123456');
    const co = await p.evaluate(() => { const x = new Date(); x.setDate(x.getDate() + 2); return x.toISOString().slice(0, 10); });
    await p.fill('.modal [name=check_out]', co); await p.dispatchEvent('.modal [name=check_out]', 'change'); await p.waitForTimeout(400);
    await p.check('.modal [name=check_in_now]'); await shot('231-new-booking');
    await save(); await p.waitForURL(/#\/booking\/\d+/); await p.waitForSelector('#bx');
    await p.click('#bx'); await p.fill('.modal [name=description]', 'Laundry'); await p.fill('.modal [name=amount]', '120'); await save(); await p.waitForSelector('text=Laundry');
    await p.click('#bd'); await p.fill('.modal [name=amount]', '500'); await save(); await p.waitForTimeout(400);
    await shot('232-guest-bill', { fullPage: true });
    const toPay = await p.textContent('.kpi:nth-child(4) .value');
    // a future booking for the calendar
    await p.goto(B + '/#/rooms'); await p.waitForSelector('.room-card'); await shot('233-front-desk', { fullPage: true });
    await p.goto(B + '/#/rooms?tab=calendar'); await p.waitForSelector('table.cal'); await p.click('table.cal td.cal-free >> nth=20'); await p.waitForSelector('.modal [name=guest_name]');
    await p.fill('.modal [name=guest_name]', 'Mpho Letsie'); await save(); await p.waitForURL(/#\/booking\/\d+/);
    await p.goto(B + '/#/rooms?tab=calendar'); await p.waitForSelector('table.cal td.cal-b'); await shot('234-calendar');
    // check out the first guest (leaving early)
    const bk = (await api('GET', '/bookings?view=inhouse'))[0];
    await p.goto(B + '/#/booking/' + bk.id); await p.waitForSelector('#bo'); await p.click('#bo'); await save(); await p.waitForSelector('.badge-paid'); await shot('235-checked-out');
    const done = await api('GET', '/bookings/' + bk.id);
    console.log('booking to pay', toPay, '→ status', done.status, 'open', done.folio.invoice_open);
    // ---- fleet
    await p.goto(B + '/#/fleet'); await p.waitForSelector('#nv'); await p.click('#nv');
    await p.fill('.modal [name=reg_no]', 'a 123 bcd'); await p.selectOption('.modal [name=kind]', 'truck'); await p.fill('.modal [name=make]', 'Isuzu'); await p.fill('.modal [name=model]', 'FTR 850');
    await p.fill('.modal [name=odometer]', '120000'); await p.fill('.modal [name=licence_expiry]', '2026-11-20'); if (emps.length) await p.selectOption('.modal [name=driver_id]', String(emps[0].id));
    await shot('240-new-vehicle'); await save(); await p.waitForURL(/#\/vehicle\/\d+/); await p.waitForSelector('#vf');
    await p.click('#vf'); await p.fill('.modal [name=litres]', '200'); await p.fill('.modal [name=amount]', '4300'); await p.fill('.modal [name=odometer]', '120050'); await save(); await p.waitForTimeout(300);
    await p.click('#vt'); await p.fill('.modal [name=from_place]', 'Maseru'); await p.fill('.modal [name=to_place]', 'Johannesburg');
    await p.selectOption('.modal [name=partner_id]', { index: 1 }); await p.selectOption('.modal [name=charge_by]', 'km'); await p.fill('.modal [name=rate]', '18'); await save();
    await p.goto(B + '/#/fleet?tab=trips'); await p.waitForSelector('[data-t]'); await p.waitForTimeout(500); await p.click('[data-t]:has(.badge:text-matches("planned", "i"))'); await p.click('.modal-foot .btn-primary:has-text("Leaving now")'); await p.waitForSelector('.modal-backdrop', { state: 'detached' }).catch(() => {}); await p.waitForFunction(() => /on the road/i.test([...document.querySelectorAll('.badge')].map(b => b.textContent).join(' ')), null, { timeout: 20000 });
    await p.waitForSelector('.modal', { state: 'detached' }); await p.waitForTimeout(500);
    await p.click('[data-t]'); await p.fill('.modal #odo', '120650'); await p.fill('.modal #tc', '350'); await shot('241-trip-return'); await p.click('.modal-foot .btn-primary'); await p.waitForSelector('text=Trip done');
    await p.goto(B + '/#/fleet?tab=trips&status=uninvoiced'); await p.waitForSelector('[data-pick]'); await p.check('[data-pick]'); await shot('242-trips-to-invoice'); await p.click('#ti'); await p.waitForURL(/#\/invoice\/\d+/);
    await p.goto(B + '/#/fleet'); await p.waitForSelector('[data-v]'); await shot('243-fleet', { fullPage: true });
    await p.goto(B + '/#/fleet?tab=report'); await p.waitForSelector('#rg'); await shot('244-fleet-report');
    const v = (await api('GET', '/vehicles'))[0];
    await p.goto(B + '/#/vehicle/' + v.id); await p.waitForSelector('#vk'); await p.click('#vk'); await p.fill('.modal [name=amount]', '950'); await save(); await p.waitForURL(/tab=takings/); await p.waitForSelector('text=950');
    await p.click('#vr'); await p.fill('.modal [name=title]', 'Brake pads'); await save(); await p.waitForURL(/#\/mr\/\d+/);
    await p.goto(B + '/#/vehicle/' + v.id); await p.waitForSelector('#vf'); await shot('245-vehicle', { fullPage: true });
    const rep = await api('GET', '/fleet/report');
    console.log('fleet report', JSON.stringify(rep.rows[0]));
  } catch (e) { await shot('dbg17'); throw e; }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none'); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
