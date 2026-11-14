// UI test: organisation & governance (organogram, positions, units, delegation of authority matrix edited in the browser,
// "who approves?", decision rights, approval history), an approval routed by the organogram to a staff supervisor and
// approved from the home-screen tile, "My role", policies (starter set, editor, approval, acknowledgement) and legal
// (employment contract from an employee, contract register, compliance register).
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b, tk = token) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: 'Bearer ' + tk } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  await api('POST', '/db-config', { host: 'localhost', user: 'erp', password: 'erp123', database: 'maluti_ui' });
  token = (await api('POST', '/setup', { company: { name: 'Maloti Water Services', vat_rate: 15, entity_type: 'parastatal', reg_no: 'ACT-2026-07', address: 'Kingsway, Maseru' }, admin: { name: 'Admin', username: 'admin', password: 'admin123', pin: '1234' }, demo: true, business_types: ['water'] })).token;
  const mk = async (name, username, role, pin) => { await api('POST', '/users', { name, username, password: username + 'pw1', role, pin }); return (await api('POST', '/login', { username, password: username + 'pw1' })); };
  const MD = await mk('Mme Palesa Managing', 'md', 'manager', '7001'), FM = await mk('Ntate Finance Head', 'fm', 'accountant', '7002'), TS = await mk('Mme Technical Head', 'ts', 'manager', '7003');
  const SUP = await mk('Ntate Networks Supervisor', 'nsup', 'staff', '7004'), CLK = await mk('Ausi Stores Clerk', 'clerk', 'accountant', '7005');
  await api('POST', '/gov/seed', { kind: 'water' });
  const ps = await api('GET', '/gov/positions'), Pn = t => ps.find(p => p.title === t);
  for (const [t, u] of [['Managing Director', MD], ['Finance Manager', FM], ['Technical Services Manager', TS], ['Networks Supervisor', SUP]]) await api('PUT', '/gov/positions/' + Pn(t).id, { user_id: u.user.id });
  await api('POST', '/gov/positions', { title: 'Stores Clerk', unit_id: Pn('Networks Supervisor').unit_id, reports_to_id: Pn('Networks Supervisor').id, user_id: CLK.user.id });
  const claim = await api('POST', '/expense-claims', { description: 'Fuel for the standby pump', account_code: '6000', amount: 650 }, CLK.token);
  if (!/Networks Supervisor/.test(claim.message || '')) throw new Error('claim not routed: ' + JSON.stringify(claim));
  const emp = await api('POST', '/hrm/employees', { first_name: 'Lineo', last_name: 'Mokhethi', job_title: 'Plumber', basic_salary: 9500, hire_date: '2026-11-02', pay_method: 'bank', id_number: '0412345678' });

  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = []; const watch = (pg, tag) => { pg.on('pageerror', e => errors.push(tag + ' PAGEERR ' + e.message)); pg.on('console', m => { if (m.type() === 'error' && !/40[0-9]|50[0-9]/.test(m.text())) errors.push(tag + ' CONSOLE ' + m.text()); }); };
  watch(p, 'admin'); p.setDefaultTimeout(20000);
  const shot = (pg, n) => pg.screenshot({ path: `${SP}/shots/${n}.png`, fullPage: true });
  const login = async (pg, tk) => { await pg.goto(B); await pg.evaluate(t => { localStorage.setItem('maluti_token', t); localStorage.setItem('maluti_tour_1', '1'); localStorage.setItem('maluti_lang', 'en'); }, tk); await pg.reload(); await pg.waitForSelector('.page, #app .apps, .tiles'); await pg.waitForLoadState('networkidle'); };
  const go = async (pg, h) => { await pg.goto(B + '/' + h); await pg.waitForLoadState('networkidle'); await pg.waitForTimeout(350); };
  try {
    await login(p, token);
    // organogram and the governance tabs
    await go(p, '#/governance?tab=chart'); await p.waitForSelector('.org-box'); await shot(p, '800-org-chart');
    await p.click('.org-box >> text=Networks Supervisor'); await p.waitForSelector('.modal >> text=Escalation path'); await shot(p, '801-position-comms'); await p.click('.modal [data-x]');
    for (const [i, t] of ['positions', 'units', 'doa', 'decisions'].entries()) { await go(p, `#/governance?tab=${t}`); await shot(p, `80${i + 2}-gov-${t}`); }
    // change the supervisor's purchase-order limit in the matrix
    await go(p, '#/governance?tab=doa');
    const cell = await p.$(`td[data-c="${Pn('Networks Supervisor').id}|purchase_order"]`); await cell.click();
    await p.waitForSelector('.modal [name=max_amount]'); await p.fill('.modal [name=max_amount]', '7500'); await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(700);
    if (!(await api('GET', '/gov/grants')).some(g => g.position_id === Pn('Networks Supervisor').id && g.doc_type === 'purchase_order' && Number(g.max_amount) === 7500)) throw new Error('DoA edit not saved');
    await go(p, '#/governance?tab=simulate'); await p.selectOption('[name=doc_type]', 'journal'); await p.fill('[name=amount]', '80000'); await p.selectOption('[name=user_id]', String(CLK.user.id)); await p.click('#run');
    await p.waitForSelector('#out ol li'); await shot(p, '806-gov-simulate');
    // the supervisor (a staff user) sees the claim on the home screen and approves it
    const s = await b.newPage({ viewport: { width: 1366, height: 860 } }); watch(s, 'sup'); s.setDefaultTimeout(20000);
    await login(s, SUP.token); await s.waitForSelector('.tile >> text=Approvals (1)'); await shot(s, '810-sup-home');
    await s.click('.tile >> text=Approvals'); await s.waitForSelector('[data-gok]'); await shot(s, '811-sup-approvals');
    await s.click('[data-gok]'); await s.waitForTimeout(900);
    const cl = (await api('GET', '/expense-claims')).find(x => x.id === claim.id); if (cl.status !== 'approved') throw new Error('claim not approved from the inbox: ' + cl.status);
    await go(s, '#/myrole'); await s.waitForSelector('text=What I may approve'); await shot(s, '812-my-role');
    await go(p, '#/governance?tab=history'); await shot(p, '807-gov-history');
    // policies: starter set, edit, approve by the MD, acknowledgement by staff
    await go(p, '#/policies?tab=templates'); await p.click('#seed'); await p.waitForTimeout(1500); await go(p, '#/policies'); await shot(p, '820-policies');
    const pols = await api('GET', '/policies'), cash = pols.find(x => /Cash Handling/.test(x.title));
    await go(p, '#/policies/' + cash.id); await p.waitForSelector('#pd[contenteditable=true]');
    await p.click('#pd h1'); await p.keyboard.press('End'); await p.keyboard.type(' (Maloti Water)'); await p.click('#sv'); await p.waitForTimeout(600); await shot(p, '821-policy-edit');
    p.once('dialog', dg => dg.accept()); await p.click('#sub'); await p.waitForSelector('.modal >> text=yellow mark'); await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(900);
    const m = await b.newPage({ viewport: { width: 1366, height: 860 } }); watch(m, 'md'); m.setDefaultTimeout(20000);
    await login(m, MD.token); await go(m, '#/approvals'); await m.waitForSelector('text=Policies'); await shot(m, '822-md-approvals');
    await go(m, '#/policies/' + cash.id); await m.click('#ap'); await m.waitForTimeout(900);
    if ((await api('GET', '/policies/' + cash.id)).status !== 'approved') throw new Error('policy not approved');
    await login(s, SUP.token); await s.waitForSelector('.tile >> text=Policies (1 to read)'); await go(s, '#/policies/' + cash.id); await s.click('#ack'); await s.waitForTimeout(600); await shot(s, '823-policy-ack');
    // legal: an employment contract from the employee page, contract register, compliance register
    await go(p, '#/employee/' + emp.id); await p.click('[data-legal]'); await p.waitForSelector('.modal #sid option'); await p.click('.modal-foot .btn-primary');
    await p.waitForURL(/#\/legal\/\d+/); await p.waitForSelector('#ld mark'); await shot(p, '830-legal-employment');
    await go(p, '#/legal?tab=templates'); await shot(p, '831-legal-templates');
    await go(p, '#/legal?tab=compliance'); await p.click('#seed'); await p.waitForTimeout(900); await shot(p, '832-legal-compliance');
    await go(p, '#/legal?tab=contracts'); await shot(p, '833-legal-contracts');
    await go(p, '#/legal'); await shot(p, '834-legal-documents');
    console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  } catch (x) { await shot(p, 'dbg33'); console.log('ERRORS so far:', errors.join('\n')); throw x; }
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
