// UI test: patients & dispensing (runs after ui18 on the same DB)
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  token = (await api('POST', '/login', { username: 'admin', password: 'admin123' })).token;
  const biz = await api('GET', '/business');
  await api('PUT', '/business', { modules: [...new Set([...biz.modules, 'patients'])] });
  const vat = (await api('GET', '/taxes'))[0].id;
  const amox = await api('POST', '/products', { name: 'Amoxicillin 500mg caps', type: 'stock', uom: 'Cap', price: 3, cost: 1, tax_id: vat, track_batches: 1 });
  const para = await api('POST', '/products', { name: 'Paracetamol 500mg tabs', type: 'stock', uom: 'Tab', price: 1, cost: 0.3, tax_id: vat, track_batches: 1 });
  await api('POST', '/products', { name: 'Consultation – GP', type: 'service', price: 350, tax_id: vat });
  const supp = (await api('GET', '/partners?is_supplier=1'))[0];
  const po = await api('POST', '/purchases', { supplier_id: supp.id, lines: [{ product_id: amox.id, qty: 100, unit_cost: 1, tax_rate: 0 }, { product_id: para.id, qty: 200, unit_cost: 0.3, tax_rate: 0 }] });
  await api('POST', `/purchases/${po.id}/confirm`); const pol = (await api('GET', `/purchases/${po.id}`)).lines;
  await api('POST', `/purchases/${po.id}/receive`, { lines: [{ line_id: pol[0].id, qty: 100, batch_no: 'AMX-27', expiry_date: '2027-12-31' }, { line_id: pol[1].id, qty: 200, batch_no: 'PCM-28', expiry_date: '2028-06-30' }] });
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/40[0-4]/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
  p.setDefaultTimeout(10000);
  const shot = (n, o = {}) => { console.log('shot', n); return p.screenshot({ path: `${SP}/shots/${n}.png`, ...o }); };
  const save = async () => { await p.click('.modal-foot .btn-primary'); await p.waitForSelector('.modal', { state: 'detached' }); };
  try {
    await p.goto(B); await p.evaluate(t => localStorage.setItem('maluti_token', t), token); await p.reload(); await p.waitForSelector('.tiles');
    if (!await p.$('a[href="#/clinic"]')) throw new Error('clinic tile missing');
    await p.goto(B + '/#/clinic?tab=claims'); await p.waitForSelector('#aa'); await p.click('#aa'); await p.fill('.modal [name=name]', 'LNIG Medical Aid'); await save();
    await p.goto(B + '/#/clinic?tab=settings'); await p.waitForSelector('#ss'); await p.fill('[name=practice_no]', 'MP 0421'); await p.fill('[name=practitioner_title]', 'Medical Practitioner'); await p.click('#ss'); await p.waitForSelector('text=Saved');
    // arrival of a new patient
    await p.goto(B + '/#/clinic'); await p.waitForSelector('#na'); await p.click('#na'); await p.fill('#fs', 'Thabo Mokoena'); await p.waitForSelector('[name=pick][value=new]');
    await p.waitForTimeout(300);
    await p.fill('#newp [name=dob]', '1990-05-14'); await p.selectOption('#newp [name=sex]', 'M'); await p.fill('#newp [name=phone]', '58123456'); await p.fill('#newp [name=allergies]', 'Penicillin');
    await p.selectOption('#newp [name=medical_aid_id]', { label: 'LNIG Medical Aid' }); await p.fill('#newp [name=medical_aid_no]', 'LN-55123');
    await p.fill('.modal [name=reason]', 'Sore throat and fever for 3 days'); await p.fill('.modal [name=temp]', '38.4'); await p.fill('.modal [name=bp_sys]', '128'); await p.fill('.modal [name=bp_dia]', '84'); await p.fill('.modal [name=pulse]', '98'); await p.fill('.modal [name=weight]', '72'); await p.fill('.modal [name=height]', '175');
    await shot('270-patient-arrives'); await save(); await p.waitForSelector('[data-v]');
    // a second, returning-style arrival for pharmacy only
    await p.click('#na'); await p.fill('#fs', 'Lineo Ramone'); await p.waitForSelector('[name=pick][value=new]'); await p.waitForTimeout(300); await p.selectOption('.modal [name=kind]', 'pharmacy'); await save();
    await p.waitForTimeout(300); await shot('271-queue');
    await p.click('[data-v] >> nth=0'); await p.waitForURL(/#\/visit\/\d+/); await p.waitForSelector('#vs'); await p.click('#vs'); await p.waitForSelector('#vd');
    await p.fill('#nf [name=history]', 'Sore throat, painful swallowing, fever 3 days. No cough.'); await p.fill('#nf [name=exam]', 'Enlarged red tonsils with exudate, tender neck nodes.');
    await p.fill('#nf [name=diagnosis]', 'Acute tonsillitis'); await p.fill('#nf [name=icd10]', 'J03.9'); await p.fill('#nf [name=plan]', 'Analgesia, warm salt gargles, fluids. Return if not better in 3 days.'); await p.fill('#nf [name=sick_note_days]', '2');
    await p.click('#sn'); await p.waitForSelector('text=Notes saved');
    await p.click('#as'); await p.selectOption('.modal [name=product_id]', { label: 'Consultation – GP – M 350.00' }); await save();
    // amoxicillin: allergy warning, then give paracetamol instead
    await p.click('#am'); await p.selectOption('.modal [name=product_id]', { index: 1 }); await p.fill('.modal [name=qty]', '15'); await p.fill('.modal [name=dosage]', '1 capsule 3 times a day');
    const opts = await p.$$eval('.modal [name=product_id] option', os => os.map(o => o.textContent));
    await p.selectOption('.modal [name=product_id]', { label: opts.find(o => o.startsWith('Amoxicillin')) });
    await p.click('.modal-foot .btn-primary'); await p.waitForSelector('text=I have checked'); await shot('272-allergy-warning');
    await p.click('.modal-backdrop:last-child .modal-foot button:has-text("Cancel")'); await p.waitForTimeout(200);
    await p.click('.modal-backdrop:last-child .modal-foot button:has-text("Cancel")'); await p.waitForSelector('.modal', { state: 'detached' });
    await p.click('#am'); await p.selectOption('.modal [name=product_id]', { label: opts.find(o => o.startsWith('Paracetamol')) }); await p.fill('.modal [name=qty]', '20');
    await p.fill('.modal [name=dosage]', '2 tablets 3 times a day after meals'); await p.fill('.modal [name=duration]', '3 days'); await shot('273-prescribe'); await save();
    await p.waitForSelector('text=Paracetamol'); await shot('274-consultation', { fullPage: true });
    await p.click('#vd'); await p.waitForSelector('#vb');
    await p.click('#vb'); await p.waitForSelector('.modal [name=copay]'); await p.fill('.modal [name=copay]', '100'); await p.dispatchEvent('.modal [name=copay]', 'input'); await shot('275-bill'); await save();
    await p.waitForSelector('text=Billed'); await p.waitForSelector('#pl'); await shot('276-billed', { fullPage: true });
    await p.click('#pl'); await p.waitForTimeout(300); await p.click('#ps'); await p.waitForTimeout(300); await p.click('#pr'); await p.waitForTimeout(300);
    await p.goto(B + '/#/clinic?tab=claims'); await p.waitForSelector('[data-i]'); await shot('277-claims');
    await p.goto(B + '/#/clinic?tab=report'); await p.waitForSelector('#rg'); await shot('278-clinic-report', { fullPage: true });
    await p.goto(B + '/#/clinic?tab=patients'); await p.waitForSelector('[data-p]'); await p.click('[data-p] >> text=Thabo'); await p.waitForURL(/#\/patient\/\d+/); await p.waitForSelector('#pv'); await shot('279-patient-file', { fullPage: true });
    const claims = await api('GET', '/clinic/claims');
    console.log('claims', claims.map(c => `${c.medical_aid} ${c.open}`).join(', '), 'para stock', (await api('GET', '/products/' + para.id)).stock_qty);
  } catch (e) { await shot('dbg19'); throw e; }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none'); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
