// UI test: finance centre (every report tab, a journal through the form, budgets, periods), audit (integrity, exceptions,
// control accounts, Benford, trail, queries, audit pack) and internal audit (dashboard, plan, universe, an engagement with
// its work programme, findings and report), plus the read-only view of an external auditor
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b, tk = token) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: 'Bearer ' + tk } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  await api('POST', '/db-config', { host: 'localhost', user: 'erp', password: 'erp123', database: 'maluti_ui' });
  token = (await api('POST', '/setup', { company: { name: 'Maloti Water Services', vat_rate: 15, entity_type: 'parastatal' }, admin: { name: 'Admin', username: 'admin', password: 'admin123', pin: '1234' }, demo: true, business_types: ['water'] })).token;
  await api('POST', '/users', { name: 'Mme External Auditor', username: 'extaudit', password: 'extaudit1', role: 'auditor', pin: '7788' });
  await api('POST', '/users', { name: 'Ntate Internal Auditor', username: 'iaudit', password: 'iaudit12', role: 'internal_auditor', pin: '7789' });
  const ext = (await api('POST', '/login', { username: 'extaudit', password: 'extaudit1' })).token, ia = (await api('POST', '/login', { username: 'iaudit', password: 'iaudit12' })).token;
  // some books: cost centres, journals, a budget
  const cc1 = (await api('POST', '/finance/cost-centres', { code: 'OPS', name: 'Operations', kind: 'department' })).id;
  await api('POST', '/finance/cost-centres', { code: 'ADM', name: 'Administration', kind: 'department' });
  const y = new Date().toISOString().slice(0, 4);
  for (const [d, a, amt] of [[`${y}-02-10`, '6100', 12000], [`${y}-03-10`, '6300', 4300], [`${y}-04-10`, '6100', 12000]]) {
    const j = (await api('POST', '/finance/journals', { entry_date: d, reference: 'SETUP', memo: 'Rent and utilities', lines: [{ code: a, debit: amt, cost_centre_id: cc1 }, { code: '1050', credit: amt }] })).id;
    await api('POST', `/finance/journals/${j}/submit`);
  }
  const years = (await api('GET', '/finance/years')).years;
  const bud = (await api('POST', '/finance/budgets', { name: 'Operating budget', fin_year_id: years[0].id })).id;
  const accs = (await api('GET', '/finance/accounts')).accounts, A = c => accs.find(a => a.code === c).id;
  await api('PUT', `/finance/budgets/${bud}/lines`, { rows: [{ account_id: A('6100'), amounts: Array(12).fill(12000) }, { account_id: A('6300'), amounts: Array(12).fill(4000) }, { account_id: A('4000'), amounts: Array(12).fill(60000) }] });
  // internal audit engagement with a work programme and a finding
  const eng = (await api('POST', '/ia/engagements', { title: 'Procurement & payables review', plan_year: Number(y), kind: 'assurance', programme: 'procurement', objectives: 'Confirm procurement follows the thresholds and that payments are valid.', scope: 'All awards and supplier payments this year.' }, ia)).id;
  const g = await api('GET', '/ia/engagements/' + eng, null, ia);
  await api('PUT', `/ia/engagements/${eng}/steps/${g.steps[0].id}`, { result: 'exceptions', exceptions: 2, sample_size: 15, notes: 'Two awards above the RFQ limit without a waiver.' }, ia);
  const f = (await api('POST', `/ia/engagements/${eng}/findings`, { title: 'Awards above the RFQ limit without a waiver', rating: 'high', condition_text: 'Two contracts of M 1.2m and M 1.4m were awarded through RFQs.', criteria: 'Procurement policy: above M 1m an open or restricted tender is required, or an approved waiver.', cause: 'The threshold was not checked when the requests were raised.', effect: 'Value for money is not assured and the awards may be challenged.', recommendation: 'Block RFQs above the limit in the system and review both awards.', management_response: 'Agreed. The limit is now enforced in S-ERP.', response_by: 'Head of Procurement', agreed: 1 }, ia)).id;
  await api('POST', `/ia/findings/${f}/actions`, { action_text: 'Review both awards and report to the accounting officer', owner: 'Head of Procurement', due_date: `${Number(y) + 1}-01-31` }, ia);

  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/40[0-9]|50[0-9]/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
  p.setDefaultTimeout(20000);
  const shot = (n, o = {}) => p.screenshot({ path: `${SP}/shots/${n}.png`, ...o });
  const login = async (pg, tk) => { await pg.goto(B); await pg.evaluate(t => { localStorage.setItem('maluti_token', t); localStorage.setItem('maluti_tour_1', '1'); localStorage.setItem('maluti_lang', 'en'); }, tk); await pg.reload(); await pg.waitForSelector('.page, #app .apps, .tiles'); await pg.waitForLoadState('networkidle'); };
  try {
    await login(p, token);
    const tabs = ['overview', 'accounts', 'journals', 'recurring', 'tb', 'gl', 'is', 'bs', 'cf', 'budgets', 'ratios', 'periods', 'cc', 'settings'];
    for (const [i, t] of tabs.entries()) {
      await p.goto(B + `/#/finance?tab=${t}`); await p.waitForSelector('#fb'); await p.waitForLoadState('networkidle'); await p.waitForTimeout(300);
      await shot(`7${String(i).padStart(2, '0')}-finance-${t}`, { fullPage: true });
    }
    // a journal through the form
    await p.goto(B + '/#/finance?tab=journals'); await p.waitForSelector('#nj'); await p.click('#nj'); await p.waitForSelector('#jl select');
    await p.fill('.modal [name=memo]', 'Accrue audit fee for the year'); await p.fill('.modal [name=reference]', 'ACCR-01');
    // the line table redraws after every change, so each field is looked up again
    await p.selectOption('#jl tbody tr:nth-child(1) select[data-k=code]', '6000'); await p.selectOption('#jl tbody tr:nth-child(2) select[data-k=code]', '1050');
    await p.fill('#jl tbody tr:nth-child(1) input[data-k=debit]', '8500'); await p.dispatchEvent('#jl tbody tr:nth-child(1) input[data-k=debit]', 'change');
    await p.fill('#jl tbody tr:nth-child(2) input[data-k=credit]', '8500'); await p.dispatchEvent('#jl tbody tr:nth-child(2) input[data-k=credit]', 'change');
    await p.waitForSelector('text=Balanced'); await shot('720-journal-form');
    await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(800);
    if (!(await api('GET', '/finance/journals')).some(j => j.reference === 'ACCR-01' && j.status === 'posted')) throw new Error('journal from the form not posted');
    // audit
    for (const [i, t] of ['overview', 'exceptions', 'recon', 'benford', 'trail', 'queries', 'pack'].entries()) {
      await p.goto(B + `/#/audit?tab=${t}`); await p.waitForLoadState('networkidle'); await p.waitForTimeout(500);
      await shot(`73${i}-audit-${t}`, { fullPage: true });
    }
    // internal audit
    const q = await b.newPage({ viewport: { width: 1366, height: 860 } }); q.on('pageerror', e => errors.push('IA ' + e.message));
    await login(q, ia);
    for (const [i, t] of ['dashboard', 'plan', 'universe', 'actions'].entries()) { await q.goto(B + `/#/internalaudit?tab=${t}`); await q.waitForLoadState('networkidle'); await q.waitForTimeout(400); await q.screenshot({ path: `${SP}/shots/74${i}-ia-${t}.png`, fullPage: true }); }
    for (const [i, t] of ['programme', 'findings', 'planning', 'report'].entries()) { await q.goto(B + `/#/iaeng/${eng}?tab=${t}`); await q.waitForLoadState('networkidle'); await q.waitForTimeout(400); await q.screenshot({ path: `${SP}/shots/75${i}-ia-eng-${t}.png`, fullPage: true }); }
    // external auditor: read-only books, audit tools
    const e = await b.newPage({ viewport: { width: 1366, height: 860 } }); e.on('pageerror', x => errors.push('EXT ' + x.message));
    await login(e, ext); await e.goto(B + '/#/finance?tab=tb'); await e.waitForSelector('#fb'); await e.waitForLoadState('networkidle');
    if (await e.$('#nj')) throw new Error('auditor can make journals');
    await e.screenshot({ path: `${SP}/shots/760-auditor-readonly.png`, fullPage: true });
    console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  } catch (x) { await shot('dbg32'); console.log('ERRORS so far:', errors.join('\n')); throw x; }
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
