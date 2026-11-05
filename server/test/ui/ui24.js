// UI test: Smartel connection – settings, till agent services (deposit, OTP withdrawal), MyWallet tender by QR, receipt with net cash, recall block, admin tabs
const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  await api('POST', '/db-config', { host: 'localhost', user: 'erp', password: 'erp123', database: 'maluti_ui' });
  token = (await api('POST', '/setup', { company: { name: 'Lesedi General Dealer', vat_rate: 15 }, admin: { name: 'Admin', username: 'admin', password: 'admin123', pin: '1234' }, demo: true })).token;
  const mock = await require(require('path').join(__dirname, '../../../server/test/mock-smartel.js')).start(8791);
  const TID = '7f3c2a10-0000-4000-8000-00000000b001'; mock.state.terminals.add(TID); mock.state.otp = '48213';
  const terms = await api('GET', '/pos/terminals'); const retail = terms.find(t => t.mode === 'retail');
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/40[0-9]|50[0-9]/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
  p.setDefaultTimeout(15000);
  const shot = (n, o = {}) => p.screenshot({ path: `${SP}/shots/${n}.png`, ...o });
  try {
    await p.goto(B); await p.evaluate(t => localStorage.setItem('maluti_token', t), token); await p.reload(); await p.waitForSelector('.tiles');
    await p.goto(B + '/#/smartel'); await p.waitForSelector('#cf [name=pos_api_url]');
    await p.fill('#cf [name=pos_api_url]', mock.url); await p.fill('#cf [name=syncd_url]', mock.url); await p.selectOption('#cf [name=auth]', 'gateway');
    await p.fill('#cf [name=merchant_id]', 'M-LESEDI'); await p.fill('#cf [name=gps_lat]', '-29.82'); await p.fill('#cf [name=gps_lng]', '27.24');
    await p.check('#cf [name=enabled]'); await p.click('#sv'); await p.waitForSelector('#pushB');
    await shot('330-smartel-connection', { fullPage: true });
    await p.goto(B + '/#/smartel?tab=tills'); await p.waitForSelector(`[data-ed="${retail.id}"]`); await p.click(`[data-ed="${retail.id}"]`);
    await p.fill('.modal [name=terminal_uuid]', TID); await shot('331-smartel-till-setup'); await p.click('.modal-foot .btn-primary'); await p.waitForSelector('.modal', { state: 'detached' });
    await p.goto(B + '/#/smartel?tab=conn'); await p.waitForSelector('#ts'); await p.click('#ts'); await p.waitForFunction(() => /register version/.test(document.querySelector('#tsOut').textContent)); await shot('332-smartel-test');
    // till
    await api('POST', '/pos/sessions/open', { terminal_id: retail.id, opening_cash: 300 });
    await p.goto(B + '/#/pos/' + retail.id); await p.waitForSelector('#agentBtn');
    await p.click('#agentBtn'); await p.waitForSelector('[data-op="dep"]'); await p.click('[data-op="dep"]');
    await p.fill('#agForm [name=cell]', '5812 3456'); await p.fill('#agForm [name=amount]', '250'); await shot('333-agent-deposit-form');
    await p.click('#agGo'); await p.waitForSelector('[data-cf]'); await shot('334-agent-deposit-checked');
    await p.click('[data-cf]'); await p.waitForSelector('#agLines .badge-paid'); 
    await p.click('[data-op="wd"]'); await p.fill('#agForm [name=cell]', '62123456'); await p.fill('#agForm [name=amount]', '100'); await p.click('#agGo'); await p.waitForSelector('[data-otp]');
    await p.fill('[data-otp]', '11111'); await p.click('[data-cf]'); await p.waitForSelector('.toast'); await p.waitForTimeout(400);
    await p.fill('[data-otp]', '48213'); await shot('335-agent-withdrawal-otp'); await p.click('[data-cf]'); await p.waitForFunction(() => document.querySelectorAll('#agLines .badge-paid').length === 2);
    await shot('336-agent-two-services');
    await p.click('[data-close], .modal .modal-x, .modal-foot .btn').catch(() => {}); 
    if (await p.$('.modal')) await p.keyboard.press('Escape'); await p.waitForSelector('.modal', { state: 'detached' }).catch(() => {});
    await p.waitForSelector('#svcBox'); 
    await p.fill('#psearch', 'Maize'); await p.waitForTimeout(300); await p.click('.prod'); await p.waitForSelector('.cart-line');
    await shot('337-cart-with-services');
    // MyWallet payment for the goods
    await p.click('#payBtn'); await p.waitForSelector('.methods');
    await p.click('.method:has-text("MyWallet")'); await p.waitForSelector('[data-ask]'); await p.click('[data-ask]');
    await p.waitForSelector('#qrBox svg'); await shot('338-mywallet-qr');
    await p.waitForSelector('.badge-paid:has-text("approved")', { timeout: 20000 }); await shot('339-mywallet-approved');
    await p.click('#done'); await p.waitForSelector('#rcpt'); await p.waitForTimeout(500); await shot('340-receipt-services-netcash');
    const rc = await p.frameLocator('#rcpt').locator('body').innerText(); if (!/NET CASH/.test(rc) || !/PAYMENT SERVICES/.test(rc)) throw new Error('receipt lacks services: ' + rc.slice(0, 300));
    await p.click('.modal-foot .btn-primary');
    // recall arrives → bread blocked at the till
    mock.addChange('recall', { entityId: 'R-9', payload: { recallId: 'R-9', gtin: '06001234000051', reason: 'Mould found in batch' } });
    await api('POST', '/smartel/pull', {}); await api('POST', '/smartel/push', {});
    await p.reload(); await p.waitForSelector('#psearch'); await p.fill('#psearch', '6001234000051'); await p.keyboard.press('Enter'); await p.waitForSelector('.toast:has-text("Recalled")'); await shot('341-recall-blocked');
    // admin tabs
    for (const [t, n] of [['sync', '342-smartel-receipts'], ['products', '343-smartel-products'], ['agency', '344-smartel-agency'], ['thoki', '345-smartel-thoki'], ['bulk', '346-smartel-bulk']]) {
      await p.goto(B + '/#/smartel?tab=' + t); await p.waitForSelector('#smb > *'); await p.waitForTimeout(300); await shot(n, { fullPage: true });
    }
    await p.goto(B + '/#/smartel?tab=sync'); await p.waitForSelector('[data-env]'); await p.click('[data-env]'); await p.waitForSelector('.modal pre'); await shot('347-smartel-envelope');
    const st = await api('GET', '/smartel/status'); console.log('accepted', mock.state.envelopes.length, 'clearing', st.balances.agency_clearing, 'digital', st.balances.digital_due);
    if (mock.state.envelopes.filter(e => e.type === 'sale').length < 1 || mock.state.rejected.length) throw new Error('envelopes ' + JSON.stringify(mock.state.rejected.map(r => r.code)));
  } catch (e) { await shot('dbg24'); throw e; }
  finally { await mock.close(); }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none'); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
