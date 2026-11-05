// UI test: starter templates, live weight & dressing %, report by animal. Runs after ui7/ui8 on the same DB.
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  token = (await api('POST', '/login', { username: 'admin', password: 'admin123' })).token;
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('CONSOLE ' + m.text()); });
  p.setDefaultTimeout(10000);
  const shot = (n, o = {}) => p.screenshot({ path: `${SP}/shots/${n}.png`, ...o });
  try {
    await p.goto(B); await p.evaluate(t => localStorage.setItem('maluti_token', t), token); await p.reload(); await p.waitForSelector('.tiles');
    // starter templates
    await p.goto(B + '/#/butchery?tab=templates'); await p.waitForSelector('#stt'); await p.click('#stt'); await p.waitForSelector('[data-sp="pork"]');
    for (const k of ['pork', 'lamb', 'goat', 'chicken']) await p.check(`[data-sp="${k}"]`);
    await shot('104-starter-templates'); await p.click('.modal-foot .btn-primary'); await p.waitForSelector('text=Now set the selling prices');
    await p.waitForTimeout(400); await shot('105-templates-after', { fullPage: true });
    const ps = await api('GET', '/products'); const P = n => ps.find(x => x.name === n);
    for (const [n, pr] of [['Pork leg / gammon', 95], ['Pork loin chops', 130], ['Pork belly', 115], ['Pork shoulder', 85], ['Pork spare ribs', 120], ['Pork trotters & hocks', 35], ['Pork mince', 80], ['Pork bones', 20]])
      await api('PUT', `/products/${P(n).id}`, { price: pr });
    // receive pigs with live weights via UI
    const supp = (await api('GET', '/partners?is_supplier=1'))[0];
    const po = await api('POST', '/purchases', { supplier_id: supp.id, lines: [{ product_id: P('Pork carcass').id, qty: 154.6, unit_cost: 45, tax_rate: 0 }] });
    await api('POST', `/purchases/${po.id}/confirm`);
    await p.goto(B + '/#/purchase/' + po.id); await p.waitForSelector('#receive'); await p.click('#receive'); await p.waitForSelector('[data-pt]'); await p.waitForTimeout(400);
    await p.fill('[data-pt$=":0"]', 'PIG-0101'); await p.fill('[data-pq$=":0"]', '78.2'); await p.fill('[data-pl$=":0"]', '104');
    await p.click('[data-padd]'); await p.fill('[data-pt$=":1"]', 'PIG-0102'); await p.fill('[data-pq$=":1"]', '76.4'); await p.fill('[data-pl$=":1"]', '101.5');
    await shot('106-receive-pigs-live-weight'); await p.click('.modal-foot .btn-ok'); await p.waitForSelector('text=Stock received');
    // cut a pig with the starter template
    await p.goto(B + '/#/butchery'); await p.waitForSelector('#nb'); await p.click('#nb'); await p.waitForSelector('#btp');
    await p.selectOption('#btp', { label: 'Pork carcass – starter' }); await p.waitForSelector('#bsb');
    await p.fill('#bq', '78.2'); await p.press('#bq', 'Tab'); await p.waitForSelector('[data-la="8"]');
    for (const [i, v] of [[0, 14.3], [1, 11.1], [2, 9.6], [3, 12.4], [4, 4.0], [5, 3.8], [6, 6.5], [7, 4.9], [8, 7.6]]) await p.fill(`[data-la="${i}"]`, String(v));
    await p.click('.modal-foot .btn-primary'); await p.waitForSelector('.modal h3:has-text("BRK/")'); await p.waitForTimeout(300); await shot('107-pig-breakdown');
    // sell some pork
    const term = (await api('GET', '/pos/terminals')).find(t => t.mode === 'retail');
    const sess = term.open_session_id ? { id: term.open_session_id } : await api('POST', '/pos/sessions/open', { terminal_id: term.id, opening_cash: 0 });
    await api('POST', '/pos/checkout', { session_id: sess.id, lines: [{ product_id: P('Pork loin chops').id, qty: 2.4 }, { product_id: P('Pork belly').id, qty: 1.8 }], payments: [{ method_id: 1, amount: 600 }] });
    // carcass register filtered to pork, then ledger
    await p.goto(B + '/#/butchery?tab=carcasses&status=all&species=pork'); await p.waitForSelector('[data-c]'); await shot('108-carcasses-pork');
    await p.click('[data-c]:has-text("PIG-0101")'); await p.waitForSelector('.trace-tree'); await p.waitForTimeout(300); await shot('109-pig-ledger');
    // report by animal
    await p.goto(B + '/#/butchery?tab=animals&from=2026-01-01'); await p.waitForSelector('#af'); await p.waitForTimeout(300); await shot('110-by-animal', { fullPage: true });
    // product form with animal field
    await p.goto(B + '/#/products'); await p.waitForSelector('[data-id]'); await p.click('[data-id]:has-text("Lamb leg")'); await p.waitForSelector('.modal [name=species]');
    const v = await p.inputValue('.modal [name=species]'); if (v !== 'lamb') throw new Error('species field ' + v);
    await shot('111-product-animal');
  } catch (e) { await shot('dbg9'); throw e; }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none'); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
