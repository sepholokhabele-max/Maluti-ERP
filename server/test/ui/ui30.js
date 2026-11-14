// UI test: e-procurement – new procurement, approval, publishing to suppliers, the supplier's bid page, bid opening by the committee,
// conflict-of-interest declaration, scoring, evaluation with preference points, award, contract, scorecards, registers, public notice
const { chromium } = require('playwright');
const mysql = require('mysql2/promise');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b, tk = token) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: 'Bearer ' + tk } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  await api('POST', '/db-config', { host: 'localhost', user: 'erp', password: 'erp123', database: 'maluti_ui' });
  token = (await api('POST', '/setup', { company: { name: 'Maloti Water Services', vat_rate: 15 }, admin: { name: 'Lerato Procurement', username: 'admin', password: 'admin123', pin: '1234' }, demo: true })).token;
  await api('PUT', '/business', { types: ['water'] });
  const user = async (name, username, role) => { await api('POST', '/users', { name, username, password: username + '1234', role, pin: String(2000 + Math.floor(Math.random() * 7000)) }); return { id: (await api('GET', '/users')).find(u => u.username === username).id, token: (await api('POST', '/login', { username, password: username + '1234' })).token }; };
  const AP = await user('Ntate Accounting Officer', 'approver', 'manager'), E1 = await user('Mme Chair Mokete', 'chair', 'staff'), E2 = await user('Ntate Member Sello', 'member', 'staff');
  const S = async (name, pr) => (await api('POST', '/procurement/suppliers', { name, email: name.replace(/\W/g, '').toLowerCase() + '@example.ls', status: 'approved', tax_clearance_expiry: '2027-06-30', ...pr })).id;
  const S1 = await S('Basali Plumbing (Pty) Ltd', { citizen_pct: 100, women_pct: 100, size: 'small', district: 'Maseru', categories: 'plumbing, pipes' });
  const S2 = await S('Big Pipes SA', { citizen_pct: 0, size: 'large', country: 'South Africa', district: 'Outside Lesotho', categories: 'pipes' });
  const S3 = await S('Bacha Youth Works', { citizen_pct: 70, youth_pct: 70, size: 'medium', district: 'Leribe', categories: 'civil works' });
  await S('Banned Traders', { status: 'debarred', debar_reason: 'Fraudulent tax clearance 2025' });
  await S('Expiring Docs Co', { citizen_pct: 100, tax_clearance_expiry: '2026-11-20' });

  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/40[0-9]|50[0-9]/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
  p.setDefaultTimeout(15000);
  const shot = (n, o = {}) => p.screenshot({ path: `${SP}/shots/${n}.png`, ...o });
  const login = async (pg, tk) => { await pg.goto(B); await pg.evaluate(t => { localStorage.setItem('maluti_token', t); localStorage.setItem('maluti_tour_1', '1'); localStorage.setItem('maluti_lang', 'en'); }, tk); await pg.reload(); await pg.waitForSelector('nav, .app-tile, .tile'); };
  try {
    await login(p, token);
    await p.goto(B + '/#/procurement?tab=suppliers'); await p.waitForSelector('[data-s]'); await shot('500-proc-suppliers', { fullPage: true });
    // a new restricted tender through the form
    await p.click('#nt'); await p.waitForSelector('.modal [name=title]');
    await p.selectOption('.modal [name=method]', 'restricted'); await p.selectOption('.modal [name=category]', 'works');
    await p.fill('.modal [name=title]', 'Pipe replacement – Ha Thetsane zone'); await p.fill('.modal [name=description]', 'Supply and install 1 km of 50 mm HDPE pipe with fittings; reinstate road crossings.');
    await p.fill('.modal [name=department]', 'Operations'); await p.fill('.modal [name=budget_code]', '5500');
    const close = new Date(Date.now() + 26 * 3600e3); const loc = new Date(close - close.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
    await p.fill('.modal [name=closing_at]', loc);
    await p.click('[data-pre="70,20,10"]'); await p.fill('.modal [name=min_tech_pct]', '50');
    await p.fill('[data-ln] [data-k=description]', 'HDPE pipe 50 mm, 100 m roll'); await p.fill('[data-ln] [data-k=qty]', '10'); await p.fill('[data-ln] [data-k=uom]', 'roll'); await p.fill('[data-ln] [data-k=est_unit]', '2400');
    await p.click('#al'); await p.fill('[data-ln]:nth-child(2) [data-k=description]', 'Installation and road reinstatement'); await p.fill('[data-ln]:nth-child(2) [data-k=est_unit]', '18000');
    await p.click('#ac'); await p.fill('[data-cr]:nth-child(3) [data-k=name]', 'Relevant experience (similar projects)'); await p.fill('[data-cr]:nth-child(3) [data-k=max_points]', '60');
    await p.click('#ac'); await p.fill('[data-cr]:nth-child(4) [data-k=name]', 'Method statement and programme'); await p.fill('[data-cr]:nth-child(4) [data-k=max_points]', '40');
    await p.click('#am'); await p.selectOption('[data-cm]:nth-child(1) [data-k=user_id]', String(E1.id)); await p.click('#am'); await p.selectOption('[data-cm]:nth-child(2) [data-k=user_id]', String(E2.id));
    await shot('501-proc-new-form', { fullPage: true });
    await p.click('.modal-foot .btn-primary'); await p.waitForSelector('#xs');
    const T = Number(p.url().split('/').pop());
    await shot('502-proc-draft', { fullPage: true });
    await p.click('#xs'); await p.waitForSelector('text=waiting for approval');
    await api('POST', `/tenders/${T}/approve`, { note: 'Budget confirmed' }, AP.token);
    await p.reload(); await p.waitForSelector('#xp'); await p.click('#xp'); await p.waitForSelector('[data-sp]');
    for (const id of [S1, S2, S3]) await p.check(`[data-sp="${id}"]`);
    await shot('503-proc-invite'); await p.click('.modal-foot .btn-primary'); await p.waitForSelector('text=Private bid links'); await shot('504-proc-links');
    const links = await api('GET', `/tenders/${T}/links`), L = pid => links.find(x => x.partner_id === pid).url.replace(/^https?:\/\/[^/]+/, B);
    // the supplier's bid page
    const s1 = await b.newPage({ viewport: { width: 1100, height: 900 } }); s1.on('pageerror', e => errors.push('PORTAL ' + e.message));
    await s1.goto(L(S1)); await s1.waitForSelector('#sb');
    const inputs = await s1.$$('[data-l]'); await inputs[0].fill('2300'); await inputs[1].fill('17500'); await s1.fill('#dd', '30'); await s1.check('#dc');
    await s1.screenshot({ path: `${SP}/shots/505-supplier-bid-page.png`, fullPage: true });
    await s1.click('#sb'); await s1.waitForSelector('text=Bid received'); await s1.waitForTimeout(1500); await s1.screenshot({ path: `${SP}/shots/506-supplier-bid-sealed.png`, fullPage: true });
    await s1.fill('#qq', 'May we use PE100 pipe instead of PE80?'); await s1.click('#qb'); await s1.waitForSelector('text=Sent');
    const tl = (await api('GET', '/tenders/' + T)).lines;
    const bid = (pid, a, c) => fetch(L(pid) + '/bid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: [{ line_id: tl[0].id, unit_price: a }, { line_id: tl[1].id, unit_price: c }], vat_rate: 15, delivery_days: 21, declaration: true }) });
    await bid(S2, 1900, 15000); await bid(S3, 2150, 16500);
    await p.reload(); await p.waitForSelector('text=3 sealed bids'); await shot('507-proc-sealed', { fullPage: true });
    // closing time passes
    const cn = await mysql.createConnection({ host: 'localhost', user: 'erp', password: 'erp123', database: 'maluti_ui' });
    await cn.query('UPDATE tenders SET closing_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE) WHERE id = ?', [T]);
    // the chair opens the bids, declares, scores
    const c = await b.newPage({ viewport: { width: 1366, height: 860 } }); c.on('pageerror', e => errors.push('CHAIR ' + e.message));
    await login(c, E1.token); await c.waitForSelector('text=My tender evaluations'); await c.screenshot({ path: `${SP}/shots/508-chair-home.png` });
    await c.goto(B + '/#/tender/' + T); await c.waitForSelector('#xo'); await c.click('#xo'); await c.check(`[data-pm="${E2.id}"]`); await c.click('.modal-foot .btn-primary');
    await c.waitForSelector('#xc'); await c.screenshot({ path: `${SP}/shots/509-bids-opened.png`, fullPage: true });
    await c.click('#xc'); await c.waitForSelector('.modal [name=conflict]'); await c.click('.modal-foot .btn-primary'); await c.waitForSelector('[data-score]');
    const ids = (await api('GET', '/tenders/' + T, null, E1.token)).bids;
    const tech = { [S1]: [1, 55, 35], [S2]: [1, 30, 20], [S3]: [1, 45, 30] };
    for (const x of ids) {
      await c.click(`[data-score="${x.id}"]`); await c.waitForSelector('[data-sc]');
      const sel = await c.$$('[data-sc]'); const [m, e, s] = tech[x.partner_id];
      for (const el of sel) { const tag = await el.evaluate(n => n.tagName); if (tag === 'SELECT') await el.selectOption(String(m)); }
      const nums = (await Promise.all(sel.map(async el => ((await el.evaluate(n => n.tagName)) === 'INPUT' ? el : null)))).filter(Boolean);
      await nums[0].fill(String(e)); await nums[1].fill(String(s));
      if (x.partner_id === S1) await c.screenshot({ path: `${SP}/shots/510-score-dialog.png` });
      await c.click('.modal-foot .btn-primary'); await c.waitForSelector('.modal', { state: 'detached' }); await c.waitForSelector('[data-score]');
    }
    await c.click('#xv'); await c.waitForSelector('#xm'); await c.screenshot({ path: `${SP}/shots/511-evaluated.png`, fullPage: true });
    const ev = await api('GET', '/tenders/' + T, null, E1.token); const top = ev.bids.find(x => x.rank_no === 1);
    if (top.partner_id !== S1) throw new Error('expected the women-owned citizen bidder to rank first, got ' + top.name);
    await c.click('#xm'); await c.waitForSelector('.modal [name=bid_id]'); await c.click('.modal-foot .btn-primary'); await c.waitForSelector('text=award recommended');
    // the accounting officer approves the award
    const a = await b.newPage({ viewport: { width: 1366, height: 860 } }); a.on('pageerror', e => errors.push('APPROVER ' + e.message));
    await login(a, AP.token); await a.goto(B + '/#/tender/' + T); await a.waitForSelector('#xx'); await a.click('#xx'); await a.click('.modal-backdrop:last-child .modal-foot .btn-primary'); await a.waitForSelector('text=Awarded to');
    await a.screenshot({ path: `${SP}/shots/512-awarded.png`, fullPage: true });
    await s1.reload(); await s1.waitForSelector('text=Congratulations'); await s1.screenshot({ path: `${SP}/shots/513-supplier-result.png`, fullPage: true });
    await cn.query('UPDATE tenders SET standstill_until = DATE_SUB(CURDATE(), INTERVAL 1 DAY) WHERE id = ?', [T]); await cn.end();
    await p.reload(); await p.waitForSelector('#xk'); await p.click('#xk'); await p.click('.modal-foot .btn-primary'); await p.waitForSelector('text=contract issued');
    await shot('514-contract', { fullPage: true });
    // a waiver
    const W = (await api('POST', '/tenders', { title: 'Grundfos pump impeller kits', method: 'waiver', category: 'goods', waiver_reason: 'proprietary', waiver_supplier_id: S2,
      waiver_justification: 'Only the manufacturer\'s agent supplies original kits; non-original parts void the pump warranty.', lines: [{ description: 'Impeller kit', qty: 2, est_unit: 4000 }] })).id;
    await api('POST', `/tenders/${W}/submit`); await api('POST', `/tenders/${W}/approve`, {}, AP.token);
    await p.goto(B + '/#/tender/' + W); await p.waitForSelector('#xq'); await shot('515-waiver', { fullPage: true });
    await p.goto(B + '/#/procurement?tab=waivers'); await p.waitForSelector('[data-t]'); await shot('516-waiver-register');
    await p.goto(B + '/#/procurement?tab=compliance'); await p.waitForSelector('text=Expiring Docs Co'); await shot('517-compliance');
    await p.goto(B + '/#/procurement?tab=overview'); await p.waitForSelector('text=Nationality scorecard'); await shot('518-scorecards', { fullPage: true });
    await p.goto(B + '/#/procurement?tab=settings'); await p.waitForSelector('#psave'); await shot('519-proc-settings', { fullPage: true });
    // an open tender on the public page
    const O = (await api('POST', '/tenders', { title: 'Security services for treatment works 2027', method: 'open', category: 'services', closing_at: new Date(Date.now() + 7 * 864e5).toISOString(),
      lines: [{ description: 'Guarding services – 12 months', qty: 12, uom: 'month', est_unit: 30000 }], committee: [{ user_id: E1.id, role: 'chair' }, { user_id: E2.id, role: 'member' }] })).id;
    await api('POST', `/tenders/${O}/submit`); await api('POST', `/tenders/${O}/approve`, {}, AP.token); const op = await api('POST', `/tenders/${O}/publish`, {});
    await p.goto(B + '/tenders'); await p.waitForSelector('text=Security services'); await shot('520-public-tenders');
    await p.goto(B + '/tenders/' + op.slug); await p.waitForSelector('#rb'); await p.fill('#n', 'Mahlaku Security'); await p.fill('#e', 'bids@mahlaku.ls'); await p.fill('#cz', '100'); await p.fill('#wm', '60');
    await p.click('#rb'); await p.waitForSelector('text=Open my bid page'); await shot('521-public-register', { fullPage: true });
    await p.goto(B + '/#/procurement?tab=cases'); await p.waitForSelector('[data-t]'); await shot('522-proc-cases');
    console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  } catch (e) { await shot('dbg30'); console.log('ERRORS so far:', errors.join('\n')); throw e; }
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
