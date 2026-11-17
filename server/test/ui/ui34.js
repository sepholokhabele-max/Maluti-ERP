// UI test: Settings → Access & security (the two ways to run S-ERP, working from anywhere, checklist, rules, sessions),
// signing in from outside the office (no PIN screen, two-step set-up with a QR code, then the code), and My account.
const { chromium } = require('playwright');
const { totp } = require('../../services/security');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b, tk = token) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: 'Bearer ' + tk } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  await api('POST', '/db-config', { host: 'localhost', user: 'erp', password: 'erp123', database: 'maluti_ui' });
  token = (await api('POST', '/setup', { company: { name: 'Maloti Water Services', vat_rate: 15, entity_type: 'parastatal' }, admin: { name: 'Admin', username: 'admin', password: 'admin123', pin: '1234' }, demo: true, business_types: ['water'] })).token;
  await api('POST', '/users', { name: 'Mme Finance Manager', username: 'finmgr', password: 'finance123', role: 'manager', pin: '5511' });
  await api('PUT', '/security', { public_url: 'https://erp.malotiwater.co.ls' });

  const b = await chromium.launch();
  const errors = []; const watch = (pg, tag) => { pg.on('pageerror', e => errors.push(tag + ' PAGEERR ' + e.message)); pg.on('console', m => { if (m.type() === 'error' && !/40[0-9]|50[0-9]/.test(m.text())) errors.push(tag + ' CONSOLE ' + m.text()); }); };
  const p = await b.newPage({ viewport: { width: 1366, height: 860 } }); watch(p, 'admin'); p.setDefaultTimeout(20000);
  const shot = (pg, n) => pg.screenshot({ path: `${SP}/shots/${n}.png`, fullPage: true });
  try {
    await p.goto(B); await p.evaluate(t => { localStorage.setItem('maluti_token', t); localStorage.setItem('maluti_tour_1', '1'); localStorage.setItem('maluti_lang', 'en'); }, token); await p.reload(); await p.waitForSelector('.tiles');
    await p.goto(B + '/#/settings?tab=access'); await p.waitForSelector('#rules [name=twofa_for]'); await p.waitForLoadState('networkidle'); await shot(p, '900-access-security');
    await p.selectOption('#rules [name=remote_idle_minutes]', { index: 0 }).catch(() => {});
    await p.fill('#rules [name=remote_idle_minutes]', '45'); await p.click('#sv'); await p.waitForTimeout(700);
    if ((await api('GET', '/security')).settings.remote_idle_minutes !== 45) throw new Error('rules not saved');
    // a manager working from home: the request arrives through the secure tunnel / proxy with their own address
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, extraHTTPHeaders: { 'X-Forwarded-For': '102.68.12.40' } });
    const r = await ctx.newPage(); watch(r, 'remote'); r.setDefaultTimeout(20000);
    await r.goto(B); await r.evaluate(() => { localStorage.setItem('maluti_tour_1', '1'); localStorage.setItem('maluti_lang', 'en'); }); await r.reload();
    await r.waitForSelector('#lf'); if (await r.$('.pin-users')) throw new Error('PIN screen shown outside the office'); await shot(r, '901-remote-signin');
    await r.fill('#lf [name=username]', 'finmgr'); await r.fill('#lf [name=password]', 'finance123'); await r.click('#lf button');
    await r.waitForSelector('#cf .qr-box svg'); await shot(r, '902-remote-2fa-setup');
    const secret = (await r.textContent('#cf code')).trim();
    await r.fill('#code', totp(secret)); await r.click('#cf button'); await r.waitForSelector('.tiles');
    await r.goto(B + '/#/account'); await r.waitForSelector('text=Where I am signed in'); await r.waitForLoadState('networkidle'); await shot(r, '903-my-account');
    // signing in again from outside asks for the code
    await r.click('#logout').catch(() => {}); await r.waitForSelector('#lf');
    await r.fill('#lf [name=username]', 'finmgr'); await r.fill('#lf [name=password]', 'finance123'); await r.click('#lf button');
    await r.waitForSelector('#cf #code'); await shot(r, '904-remote-code');
    await r.fill('#code', totp(secret, Date.now() + 30000)); await r.click('#cf button'); await r.waitForSelector('.tiles');
    await p.goto(B + '/#/settings?tab=access'); await p.waitForSelector('#sess table'); await p.waitForLoadState('networkidle'); await shot(p, '905-access-sessions');
    const ss = await api('GET', '/security/sessions'); if (!ss.some(x => x.username === 'finmgr' && x.remote && x.method === '2fa')) throw new Error('remote session not listed');
    console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  } catch (x) { await shot(p, 'dbg34'); console.log('ERRORS so far:', errors.join('\n')); throw x; }
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
