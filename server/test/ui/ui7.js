const { chromium } = require('playwright');
const SP = process.argv[2], B = 'http://localhost:8069';
let token;
const api = async (m, u, b) => { const r = await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(u + ' ' + JSON.stringify(j)); return j; };
(async () => {
  const bc = await import(require('path').join(__dirname, '../../../public/js/barcode.js'));
  await api('POST', '/db-config', { host: 'localhost', user: 'erp', password: 'erp123', database: 'maluti_ui' });
  token = (await api('POST', '/setup', { company: { name: 'Ha Thetsane Butchery', vat_rate: 15, address: 'Main North 1, Maseru' }, admin: { name: 'Lineo Mokhele', username: 'admin', password: 'admin123' }, demo: false })).token;
  await api('PUT', '/butchery/settings', { enabled: true });
  const vat = (await api('GET', '/taxes'))[0].id;
  const cat = await api('POST', '/categories', { name: 'Beef', color: '#b91c1c' });
  const mk = (name, price, extra = {}) => api('POST', '/products', { name, type: 'stock', uom: 'kg', price, cost: 0, tax_id: vat, category_id: cat.id, sold_by_weight: 1, track_batches: 1, shelf_life_days: 5, ...extra });
  const carcass = await mk('Beef side (carcass)', 0, { sold_by_weight: 0, pos_visible: 0, shelf_life_days: 10, cost: 68 });
  const rump = await mk('Rump steak', 160, { plu: '1001' }); const mince = await mk('Beef mince', 95, { plu: '1002' });
  const stew = await mk('Stewing beef', 85, { plu: '1003' }); const brisket = await mk('Brisket', 110, { plu: '1005' }); const bones = await mk('Soup bones', 15, { plu: '1004', shelf_life_days: 3 });
  await api('POST', '/partners', { name: 'Lesotho Abattoir Co.', is_supplier: 1, is_customer: 0 });
  const supp = (await api('GET', '/partners?is_supplier=1'))[0];
  const po = await api('POST', '/purchases', { supplier_id: supp.id, lines: [{ product_id: carcass.id, qty: 120, unit_cost: 68, tax_rate: 0 }] });
  await api('POST', `/purchases/${po.id}/confirm`);
  await api('POST', '/butchery/templates', { name: 'Beef side – standard', source_product_id: carcass.id, lines: [
    { product_id: rump.id, yield_pct: 10 }, { product_id: brisket.id, yield_pct: 8 }, { product_id: mince.id, yield_pct: 32 }, { product_id: stew.id, yield_pct: 22 }, { product_id: bones.id, yield_pct: 14 }, { name: 'Fat & trim', yield_pct: 12, is_waste: 1 }] });

  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = []; p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('CONSOLE ' + m.text()); });
  p.setDefaultTimeout(10000);
  const shot = (n, o = {}) => p.screenshot({ path: `${SP}/shots/${n}.png`, ...o });
  try {
  await p.goto(B); await p.evaluate(t => localStorage.setItem('maluti_token', t), token); await p.reload(); await p.waitForSelector('.tiles');
  // receive PO with batch number
  await p.goto(B + '/#/purchase/' + po.id); await p.waitForSelector('#receive'); await p.click('#receive'); await p.waitForSelector('[data-bn]');
  await p.fill('[data-bn]', 'LAC-24117'); await shot('80-receive-batch'); await p.click('.modal-foot .btn-ok'); await p.waitForSelector('text=Stock received');
  // breakdown via UI
  await p.goto(B + '/#/butchery'); await p.waitForSelector('#nb'); await p.click('#nb'); await p.waitForSelector('#bq');
  await p.fill('#bq', '120'); await p.press('#bq', 'Tab'); await p.waitForSelector('[data-la="5"]');
  for (const [i, v] of [[0, 11.8], [1, 9.1], [2, 39.5], [3, 25.2], [4, 17.6], [5, 14.1]]) await p.fill(`[data-la="${i}"]`, String(v));
  await p.fill('#bnt', 'Side 1 – butcher Thabo'); await shot('81-breakdown-form');
  await p.click('.modal-foot .btn-primary'); await p.waitForSelector('.modal h3:has-text("BRK/")'); await p.waitForTimeout(400); await shot('82-breakdown-result');
  await p.click('.modal [data-x]'); await p.waitForTimeout(300); await shot('83-breakdown-list');
  // POS weighing
  await p.goto(B + '/#/pos/1'); await p.waitForSelector('#oc'); await p.click('.modal-foot .btn-primary'); await p.waitForSelector('#prods .prod');
  await p.click('.prod:has-text("Rump steak")'); await p.waitForSelector('.weigh-display');
  for (const k of '1.235') await p.click(`[data-wk="${k}"]`);
  await shot('84-weigh-dialog'); await p.click('.modal-foot .btn-primary');
  const code = bc.buildScaleBarcode('21', '1002', 71.25, { barcode_item_digits: 5, barcode_value_digits: 5, barcode_value_type: 'price' });
  await p.fill('#psearch', code); await p.press('#psearch', 'Enter'); await p.waitForTimeout(300);
  await shot('85-pos-weighed-cart');
  await p.click('#payBtn'); await p.waitForSelector('.payscreen'); await p.click('#done'); await p.waitForSelector('text=Sale complete'); await p.click('text=Next customer');
  // waste via UI
  await p.goto(B + '/#/butchery?tab=waste'); await p.waitForSelector('#ww'); await p.click('#ww'); await p.waitForSelector('[data-k="product_id"]');
  await p.selectOption('[data-k="product_id"]', { index: 3 }); await p.fill('[data-k="qty"]', '1.4'); await p.selectOption('[data-k="reason"]', 'Spoilage'); await p.fill('[data-k="note"]', 'Display fridge 2 warm overnight');
  await p.click('.modal-foot .btn-danger'); await p.waitForTimeout(800); await shot('86-waste', { fullPage: true });
  // batches: make bones expire tomorrow
  const bb = (await api('GET', `/butchery/batches?product_id=${bones.id}`))[0];
  await api('PUT', `/butchery/batches/${bb.id}`, { expiry_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10) });
  await p.goto(B + '/#/butchery?tab=batches'); await p.waitForSelector('[data-b]'); await shot('87-batches');
  await p.goto(B + '/#/dashboard'); await p.waitForSelector('.alerts'); await shot('88-dashboard-expiry');
  // labels
  await p.goto(B + '/#/butchery?tab=labels'); await p.waitForSelector('#lw'); await p.selectOption('#lp', { index: 3 }); await p.waitForTimeout(400);
  await p.fill('#lw', '0.875'); await p.waitForTimeout(200); await shot('89-label');
  await p.goto(B + '/#/butchery?tab=settings'); await p.waitForSelector('#bts'); await shot('90-butchery-settings', { fullPage: true });
  await p.goto(B + '/#/products'); await p.waitForSelector('[data-id]'); await p.click('[data-id]:has-text("Rump steak")'); await p.waitForSelector('.modal [name=plu]'); await shot('91-product-form');
  } catch (e) { await shot('dbg7'); throw e; }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none'); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
