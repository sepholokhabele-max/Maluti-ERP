// UI test: campaigns, recruitment & appraisals (runs after ui21 on the same DB)
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  token = (await api('POST', '/login', { username: 'admin', password: 'admin123' })).token;
  const biz = await api('GET', '/business'); await api('PUT', '/business', { modules: [...new Set([...biz.modules, 'campaigns', 'recruitment', 'hrm'])] });
  await api('PUT', '/reminders/settings', { sms: { mode: 'log' } });
  for (const [n, ph, tags, bd] of [['Lerato Mohapi', '58330001', 'vip', '1992-11-20'], ['Teboho Khoali', '58330002', 'vip, wholesale', null], ['Nthabiseng Lekhanya', '58330003', 'wholesale', '1988-11-02']])
    await api('POST', '/partners', { name: n, phone: ph, is_customer: 1, tags: tags, birthday: bd });
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/40[0-4]/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
  p.setDefaultTimeout(12000);
  const shot = (n, o = {}) => p.screenshot({ path: `${SP}/shots/${n}.png`, ...o });
  const save = async () => { await p.click('.modal-foot .btn-primary'); await p.waitForSelector('.modal', { state: 'detached' }); };
  try {
    await p.goto(B); await p.evaluate(t => localStorage.setItem('maluti_token', t), token); await p.reload(); await p.waitForSelector('.tiles');
    if (!await p.$('a[href="#/campaigns"]') || !await p.$('a[href="#/recruitment"]')) throw new Error('tiles missing');
    // campaign
    await p.goto(B + '/#/campaigns'); await p.waitForSelector('#nc'); await p.click('#nc'); await p.waitForURL(/#\/campaign\/\d+/); await p.waitForSelector('#cf [name=name]');
    await p.fill('#cf [name=name]', 'November birthday special'); await p.fill('#cf [name=tags]', 'vip'); await p.selectOption('#cf [name=birthday_month]', '11');
    await p.fill('#cf [name=message]', 'Happy birthday month {first_name}! Show this SMS for 15% off at {company} this November.'); await p.dispatchEvent('#cf [name=message]', 'change');
    await p.waitForFunction(() => /1\s+people/.test(document.querySelector('#pv').textContent)); await shot('310-campaign-editor', { fullPage: true });
    await p.click('#snd'); await p.waitForSelector('text=Please confirm'); await p.click('.modal-foot .btn-primary'); await p.waitForSelector('text=Delivered', { timeout: 15000 }).catch(() => {});
    await p.waitForSelector('.badge-paid'); await shot('311-campaign-sent', { fullPage: true });
    await p.goto(B + '/#/campaigns'); await p.waitForSelector('[data-c]'); await shot('312-campaigns');
    // recruitment
    await p.goto(B + '/#/recruitment'); await p.waitForSelector('#nj'); await p.click('#nj'); await p.fill('.modal [name=title]', 'Cashier'); await p.fill('.modal [name=positions]', '1');
    await p.fill('.modal [name=salary_from]', '3500'); await p.fill('.modal [name=salary_to]', '4200'); await p.fill('.modal [name=description]', 'Serve customers at the till, handle cash and M-Pesa, pack shelves.'); await p.fill('.modal [name=requirements]', 'LGCSE with Maths. Till experience an advantage.');
    await save(); await p.waitForURL(/#\/opening\/\d+/); await p.waitForSelector('#np');
    for (const [fn, ln, ph] of [['Rethabile', 'Molapo', '58440001'], ['Mpho', '', '58440002'], ['Lineo', 'Sello', '58440003']]) {
      await p.click('#np'); await p.fill('.modal [name=first_name]', fn); await p.fill('.modal [name=last_name]', ln); await p.fill('.modal [name=phone]', ph); await save(); await p.waitForURL(/#\/applicant\/\d+/); await p.waitForSelector('#nx');
      if (fn === 'Rethabile') { await p.click('#nx'); await p.waitForSelector('text=Screening'); await p.waitForSelector('#nx'); await p.click('#nx'); await p.fill('.modal [name=interview_at]', '2026-11-20T10:00'); await p.fill('.modal [name=interviewer]', 'Store manager'); await save(); await p.waitForSelector('text=SMS sent'); }
      await p.goBack(); await p.waitForSelector('#np');
    }
    await p.waitForTimeout(300); await shot('313-applicant-board', { fullPage: true });
    await p.click('[data-a] >> text=Rethabile'); await p.waitForSelector('#hi'); await shot('314-applicant', { fullPage: true });
    await p.click('#hi'); await p.fill('.modal [name=basic_salary]', '3900'); await save(); await p.waitForSelector('text=Hired');
    await p.goto(B + '/#/recruitment'); await p.waitForSelector('[data-j]'); await shot('315-recruitment');
    // appraisal for the new cashier
    await p.goto(B + '/#/recruitment?tab=appraisals'); await p.waitForSelector('[data-start]'); await p.click('[data-start] >> nth=0'); await p.waitForURL(/#\/appraisal\/\d+/); await p.waitForSelector('[data-s]');
    const rows = await p.$$('[data-s]'); for (let i = 0; i < rows.length; i++) await (await rows[i].$(`input[value="${i === 0 ? 5 : 4}"]`)).check();
    await p.fill('[name=strengths]', 'Always on time, accurate cash-ups.'); await p.fill('[name=goals]', 'Learn stock receiving.'); await p.fill('[name=increase_pct]', '6');
    await p.click('#sv'); await p.waitForSelector('text=Saved'); await shot('316-appraisal', { fullPage: true });
    await p.click('#cl'); await p.waitForSelector('#ap'); await save(); await p.waitForSelector('text=New salary');
    const sum = await api('GET', '/appraisals/summary'); const cps = await api('GET', '/campaigns');
    console.log('campaign', cps[0].name, cps[0].status, cps[0].sent, '| appraisals closed', sum.done, '/', sum.total);
  } catch (e) { await shot('dbg22'); throw e; }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none'); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
