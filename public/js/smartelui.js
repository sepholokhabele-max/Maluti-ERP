// Smartel POS backend: connection & tills, sync (sealed receipts out, recalls / catalogue / prices / Thoki in), product register,
// agency cash & settlement, bulk wages – plus the till's "Agent services" panel and card / MyWallet / Switch payment requests.
// S-ERP never talks to MyWallet directly: everything goes through the Smartel pos-api / syncd adapters.
import { state, GET, POST, PUT, esc, $, $$, toast, err, modal, formHtml, readForm, tableHtml, badge, page, dt, query, money, can, confirmBox, printHtml } from './core.js';
import { L, lang } from './i18n.js';

const TABS = [['conn', 'Connection', 'Kopano'], ['tills', 'Tills', 'Li-till'], ['sync', 'Receipts sent', 'Lirisiti tse rometsoeng'], ['products', 'Products & recalls', 'Lihlahisoa le ho khutlisa'],
  ['agency', 'Agency cash & settlement', 'Chelete ea agency'], ['thoki', 'Thoki credit', 'Mokitlane oa Thoki'], ['bulk', 'Wages by MyWallet', 'Meputso ka MyWallet']];
const ST = { pending: 'draft', held: 'partial', applied: 'paid', duplicate: 'paid', rejected: 'cancelled' };
const opBadge = s => badge(s, { completed: 'paid', failed: 'cancelled', escalated: 'overdue', unknown: 'partial', unknown_start: 'partial', submitted: 'partial', checked: 'posted', otp_wait: 'posted', draft: 'draft' }[s] || '');
const opName = o => lang() === 'st' ? (o.name_st || o.name || o.op) : (o.name || o.op);

export async function smartelPage(view) {
  const tab = query().tab || 'conn';
  const s = await GET('/smartel/status');
  const on = s.settings.enabled;
  view.innerHTML = page(L('Smartel connection', 'Kopano ea Smartel'), on ? `<button class="btn" id="pushB">⬆ ${L('Send receipts now', 'Romela hona joale')}</button><button class="btn" id="pullB">⬇ ${L('Get updates now', 'Fumana tse ncha')}</button>` : '',
    `<div class="card ${on ? (s.link.ok === false ? 'act-bad' : 'act-ok') : 'act-trial'}" style="margin-bottom:12px">${on
      ? (s.link.ok === false ? `<b>⚠ ${L('Offline', 'Ha e kopane')}</b> – ${esc(s.link.error || '')}. ${L('The till sells goods for cash only until the link is back; receipts wait and go out oldest first.', 'Till e rekisa thepa ka chelete feela ho fihlela kopano e khutla.')}`
        : `<b>✓ ${L('Connected to the Smartel POS backend', 'E kopane le Smartel')}</b>${s.link.at ? ` · ${L('last answer', 'karabo ea ho qetela')} ${esc(dt(s.link.at))}` : ''}`)
      : `<b>${L('Not connected', 'Ha e so kopane')}</b> – ${L('Fill in the addresses and certificates from your Smartel welcome letter, then switch the connection on.', 'Kenya liaterese le litifikeiti tse tsoang lengolong la Smartel, ebe u bulela kopano.')}`}
      <br><small class="muted">${L('S-ERP never talks to MyWallet directly. Payment services, card / MyWallet / Switch payments, the product register and receipts all go through the Smartel POS backend.', 'S-ERP ha e bue le MyWallet ka kotloloho; tsohle li feta ho Smartel.')}</small></div>
    <div class="tabs">${TABS.map(([k, en, st]) => `<a href="#/smartel?tab=${k}" class="${tab === k ? 'active' : ''}">${L(en, st)}</a>`).join('')}</div><div id="smb"></div>`);
  if ($('#pushB')) $('#pushB').onclick = async () => { try { const r = await POST('/smartel/push'); toast(`${r.applied} ${L('accepted', 'li amohetsoe')}${r.held ? `, ${r.held} ${L('waiting', 'li emetse')}` : ''}${r.rejected ? `, ${r.rejected} ${L('refused', 'li hanoe')}` : ''}${r.errors.length ? ' – ' + r.errors[0] : ''}`, r.rejected || r.errors.length ? 'err' : 'ok', 6000); smartelPage(view); } catch (e) { err(e); } };
  if ($('#pullB')) $('#pullB').onclick = async () => { try { const r = await POST('/smartel/pull'); toast(Object.entries(r).map(([k, v]) => `${k}: ${typeof v === 'object' ? (v.gtins ?? '') : v}`).join(' · '), 'ok', 7000); smartelPage(view); } catch (e) { err(e); } };
  const b = $('#smb');
  const tabs = { conn: connTab, tills: tillsTab, sync: syncTab, products: productsTab, agency: agencyTab, thoki: thokiTab, bulk: bulkTab };
  await (tabs[tab] || connTab)(b, s, () => smartelPage(view));
}

async function connTab(b, s, reload) {
  const f = [
    { key: 'enabled', label: L('Connection switched on', 'Kopano e butsoe'), type: 'checkbox' },
    { key: 'pos_api_url', label: L('pos-api address', 'Aterese ea pos-api'), placeholder: 'https://pos-api.smartel.co.ls', span: 2 },
    { key: 'syncd_url', label: L('syncd address', 'Aterese ea syncd'), placeholder: 'https://sync.smartel.co.ls', span: 2 },
    { key: 'auth', label: L('How the tills sign in', 'Kamoo li-till li kenang'), type: 'select', options: [{ value: 'mtls', label: L('Till certificates (normal)', 'Litifikeiti tsa till (tloaelo)') }, { value: 'gateway', label: L('Trusted shop gateway / test backend', 'Gateway e tšeptjoang / teko') }] },
    { key: 'merchant_id', label: L('Smartel merchant ID', 'ID ea mohoebi ea Smartel') },
    { key: 'ca_pem', label: L('Smartel CA certificate (PEM)', 'Setifikeiti sa CA sa Smartel'), type: 'textarea', rows: 3, span: 2 },
    { key: 'portal_auth', label: L('Owner portal sign-in (bulk wages)', 'Ho kena portal (meputso)'), type: 'select', options: [{ value: 'gateway', label: L('Through the shop gateway', 'Ka gateway') }, { value: 'bearer', label: L('Portal token', 'Token ea portal') }] },
    { key: 'portal_sub', label: L('Owner portal user', 'Mosebelisi oa portal') },
    { key: 'portal_token', label: L('Owner portal token', 'Token ea portal'), type: 'password' },
    { key: 'npr', label: L('Products not in the National Product Register', 'Lihlahisoa tse sieo ho NPR'), type: 'select', options: [{ value: 'block', label: L('Refuse at the till (required)', 'Hana ho till') }, { value: 'warn', label: L('Warn only (while setting up)', 'Lemosa feela') }, { value: 'off', label: L('Do not check', 'Se hlahlobe') }] },
    { key: 'accept_prices', label: L('Take price changes from Smartel', 'Amohela litheko tse ncha tsa Smartel'), type: 'checkbox' },
    { key: 'create_products', label: L('Add new catalogue products automatically', 'Kenya lihlahisoa tse ncha ka bo eona'), type: 'checkbox' },
    { key: 'gps_lat', label: L('Shop location – latitude', 'Sebaka – latitude'), type: 'number', nullable: true },
    { key: 'gps_lng', label: L('Shop location – longitude', 'Sebaka – longitude'), type: 'number', nullable: true },
    { key: 'grn_terminal_id', label: L('Till that sends deliveries (GRN)', 'Till e romelang thepa e amoheloang'), type: 'select', numeric: true, options: [{ value: '', label: L('— first linked till —', '— till ea pele —') }, ...s.terminals.filter(t => t.terminal_uuid).map(t => ({ value: t.pos_terminal_id, label: t.name }))] },
    { key: 'timeout_s', label: L('Wait for an answer (seconds)', 'Emela karabo (metsotsoana)'), type: 'number' }
  ];
  b.innerHTML = `<div class="card"><div id="cf">${formHtml(f, s.settings, { ctx: 'smartel' })}</div>
    <div class="row" style="gap:8px;margin-top:10px"><button class="btn btn-primary" id="sv">${L('Save', 'Boloka')}</button><button class="btn" id="ts">🔌 ${L('Test the connection', 'Leka kopano')}</button></div><div id="tsOut" style="margin-top:8px"></div></div>`;
  $('#sv').onclick = async () => { try { await PUT('/smartel/settings', readForm($('#cf'), f)); toast(L('Saved', 'E bolokiloe')); reload(); } catch (e) { err(e); } };
  $('#ts').onclick = async () => { const o = $('#tsOut'); o.textContent = '…'; try { const r = await POST('/smartel/test');
    o.innerHTML = [['pos_api', 'pos-api'], ['syncd', 'syncd'], ['till', L('Till sign-in', 'Ho kena ha till')]].map(([k, n]) => `<div>${r[k].ok ? '✅' : '❌'} <b>${n}</b> ${r[k].ok ? (r[k].register_version !== undefined ? `– ${L('register version', 'mofuta oa register')} ${r[k].register_version}` : '') : esc(r[k].error)}</div>`).join(''); } catch (e) { o.textContent = e.message; } };
}

async function tillsTab(b, s, reload) {
  b.innerHTML = `<div class="card"><p class="muted" style="margin-top:0">${L('Each till gets its own Smartel terminal ID and certificate (from the Smartel welcome letter). Every receipt the till makes is sealed and linked to the one before it.', 'Till ka ’ngoe e na le ID le setifikeiti sa eona sa Smartel.')}</p>
    ${tableHtml([{ key: 'name', label: L('Till', 'Till') }, { key: 'terminal_uuid', label: L('Smartel terminal ID', 'ID ea Smartel'), fmt: v => v || '—' },
      { key: 'has_cert', label: L('Certificate', 'Setifikeiti'), fmt: v => Number(v) ? '✅' : '—' }, { key: 'device_seq', label: L('Receipts sealed', 'Lirisiti'), right: 1, fmt: v => v || 0 },
      { key: 'queued', label: L('Waiting to send', 'Li emetse'), right: 1 }, { key: 'rejected', label: L('Refused', 'Li hanoe'), right: 1, fmt: v => Number(v) ? `<b style="color:var(--bad)">${v}</b>` : 0, html: 1 },
      { key: 'last_push_at', label: L('Last sent', 'Ho qetela'), fmt: dt },
      { key: 'quarantined', label: L('State', 'Boemo'), html: 1, fmt: (v, t) => !t.terminal_uuid ? badge(L('not linked', 'ha e hokahane'), 'draft') : Number(v) ? `${badge(L('held', 'e tšoeroe'), 'overdue')} <small>${esc(t.quarantine_reason || '')}</small>` : badge(L('ok', 'ho lokile'), 'paid') },
      { key: 'pos_terminal_id', label: '', html: 1, fmt: (v, t) => `<button class="btn btn-sm" data-ed="${v}">${L('Set up', 'Lokisa')}</button>${Number(t.quarantined) ? ` <button class="btn btn-sm" data-rel="${v}">${L('Release', 'Lokolla')}</button>` : ''}${t.terminal_uuid ? ` <button class="btn btn-sm" data-vf="${v}">${L('Check chain', 'Hlahloba')}</button>` : ''}` }],
      s.terminals)}</div>`;
  $$('[data-ed]', b).forEach(x => x.onclick = () => {
    const t = s.terminals.find(y => String(y.pos_terminal_id) === x.dataset.ed);
    const f = [{ key: 'terminal_uuid', label: L('Smartel terminal ID', 'ID ea Smartel'), span: 2 }, { key: 'cert_pem', label: L('Till certificate (PEM)', 'Setifikeiti sa till'), type: 'textarea', rows: 4, span: 2 }, { key: 'key_pem', label: L('Till private key (PEM)', 'Senotlolo sa till'), type: 'textarea', rows: 4, span: 2 }];
    modal({ title: `${L('Link', 'Hokela')} ${t.name}`, size: 'lg', body: formHtml(f, { terminal_uuid: t.terminal_uuid || '', cert_pem: Number(t.has_cert) ? '********' : '', key_pem: Number(t.has_cert) ? '********' : '' }, { ctx: 'smartel_till' }),
      actions: [{ label: L('Cancel', 'Hlakola') }, { label: L('Save', 'Boloka'), cls: 'btn-primary', onClick: async (cl, r) => { await PUT(`/smartel/terminals/${t.pos_terminal_id}`, readForm(r, f)); cl(); toast(L('Saved', 'E bolokiloe')); reload(); } }] });
  });
  $$('[data-rel]', b).forEach(x => x.onclick = async () => { if (!await confirmBox(L('Only release the till after Smartel support has checked and fixed its receipt chain. Release now?', 'Lokolla feela ha Smartel e lokisitse. Lokolla?'))) return; await POST(`/smartel/terminals/${x.dataset.rel}/release`); reload(); });
  $$('[data-vf]', b).forEach(x => x.onclick = async () => { const r = await GET('/smartel/verify/' + x.dataset.vf); toast(r.ok ? `✓ ${r.envelopes} ${L('receipts, chain unbroken', 'lirisiti, ketane e phethehile')}` : `✕ ${L('Chain problem at', 'Bothata ho')} #${r.at}: ${r.error}`, r.ok ? 'ok' : 'err', 7000); });
}

async function syncTab(b, s) {
  const st = query().status || '';
  const rows = await GET('/smartel/outbox' + (st ? '?status=' + st : ''));
  b.innerHTML = `<div class="card"><div class="row wrap" style="gap:6px;margin-bottom:8px">${[['', L('All', 'Tsohle')], ['pending', L('Waiting', 'Li emetse')], ['held', L('Held', 'Li tšoeroe')], ['rejected', L('Refused', 'Li hanoe')], ['applied', L('Accepted', 'Li amohetsoe')]].map(([k, l]) => `<a class="btn btn-sm ${st === k ? 'btn-primary' : ''}" href="#/smartel?tab=sync&status=${k}">${l}</a>`).join('')}</div>
    ${tableHtml([{ key: 'device_seq', label: '#', right: 1 }, { key: 'terminal_name', label: L('Till', 'Till') }, { key: 'type', label: L('What', 'Eng') }, { key: 'source_type', label: L('From', 'Ho tsoa') },
      { key: 'created_at', label: L('Sealed', 'E tiisitsoe'), fmt: dt }, { key: 'status', label: L('Status', 'Boemo'), html: 1, fmt: v => badge(v, ST[v]) }, { key: 'code', label: L('Why', 'Hobaneng'), fmt: (v, r) => [v, r.reason].filter(Boolean).join(': ') },
      { key: 'hash', label: 'Hash', fmt: v => String(v).slice(0, 12) + '…' }], rows, { rowAttr: r => `data-env="${r.id}" style="cursor:pointer"`, empty: L('Nothing sent yet.', 'Ha ho letho le rometsoeng.') })}
    <small class="help-note">${L('Every sale, services-only customer, delivery (GRN), recall acknowledgement, scan flag and heartbeat is sealed with a hash of the one before it. If the internet is down they wait here and go out oldest first. "Refused" means Smartel did not accept the content – the reason is shown; the chain itself stays intact.', 'Thekiso e ’ngoe le e ’ngoe e tiisoa ka hash.')}</small></div>
    <div class="card" style="margin-top:12px"><h3>${L('Updates from Smartel', 'Tse ncha ho tsoa Smartel')}</h3>${tableHtml([{ key: 'scope', label: L('Kind', 'Mofuta') }, { key: 'seq', label: L('Up to', 'Ho fihla'), right: 1 }, { key: 'pulled_at', label: L('Last fetched', 'Ho qetela'), fmt: dt }, { key: 'last_error', label: L('Problem', 'Bothata') }], s.cursors, { empty: L('Not fetched yet.', 'Ha e so fumanoe.') })}</div>`;
  $$('[data-env]', b).forEach(tr => tr.onclick = async () => { const e = await GET('/smartel/outbox/' + tr.dataset.env);
    modal({ title: `${e.type} #${e.device_seq}`, size: 'lg', body: `<p>${e.check ? '✅ ' + L('Hash matches the content', 'Hash e lumellana') : '❌ ' + L('Hash does NOT match the content', 'Hash ha e lumellane')}</p><p class="mono" style="font-size:11px;word-break:break-all">prev ${esc(e.prev_hash)}<br>hash ${esc(e.hash)}</p><pre style="max-height:360px;overflow:auto;font-size:11px">${esc(JSON.stringify(e.body, null, 2))}</pre>` }); });
}

async function productsTab(b, s, reload) {
  const [rows, recalls] = await Promise.all([GET('/smartel/products'), GET('/smartel/recalls')]);
  const reg = s.register || {};
  b.innerHTML = `<div class="cols cols-2" style="align-items:start"><div class="card"><h3>${L('Recalls', 'Ho khutlisa')}</h3>
    ${tableHtml([{ key: 'gtin', label: 'GTIN' }, { key: 'lot', label: L('Lot', 'Lot'), fmt: v => v || L('all lots', 'tsohle') }, { key: 'products', label: L('Your product', 'Sehlahisoa sa hau') }, { key: 'reason', label: L('Reason', 'Lebaka') },
      { key: 'received_at', label: L('Received', 'E amohetsoe'), fmt: dt }, { key: 'closed_at', label: L('State', 'Boemo'), html: 1, fmt: v => v ? badge(L('closed', 'e koetsoe'), 'paid') : badge(L('do not sell', 'se rekise'), 'overdue') }], recalls, { empty: L('No recalls.', 'Ha ho letho le khutlisoang.') })}
    <small class="help-note">${L('A recalled product or lot is blocked at every till within one update. Take the stock off the shelf; Smartel is told how many units you blocked.', 'Sehlahisoa se khutlisoang se thibeloa li-till tsohle.')}</small></div>
    <div class="card"><h3>${L('National Product Register', 'Register ea Naha ea Lihlahisoa')}</h3><p>${reg.version ? `${L('Version', 'Mofuta')} <b>${reg.version}</b> · ${reg.gtins} ${L('barcodes', 'li-barcode')} · ${esc(dt(reg.loaded_at))}` : L('Not loaded yet.', 'Ha e so kenngoe.')}</p>
    <button class="btn" id="regB">⬇ ${L('Load the register now', 'Kenya register hona joale')}</button><p class="muted">${s.unlinked_products} ${L('stock products are not linked to the Smartel catalogue yet. They still sell; Smartel links them when its catalogue lists the same barcode.', 'lihlahisoa ha li so hokahanngoe.')}</p></div></div>
    <div class="card" style="margin-top:12px">${tableHtml([{ key: 'name', label: L('Product', 'Sehlahisoa') }, { key: 'barcode', label: 'Barcode', fmt: (v, p) => v ? `${esc(v)}${p.gtin_ok ? '' : ' ⚠'}` : '—', html: 1 }, { key: 'gtin', label: 'GTIN-14' },
      { key: 'smartel_product_id', label: L('Smartel product', 'Sehlahisoa sa Smartel'), fmt: v => v || '—' }, { key: 'stock_qty', label: L('Stock', 'Setoko'), right: 1 },
      { key: 'blocked', label: L('Till', 'Till'), html: 1, fmt: v => v ? `${badge(v.warn_only ? L('warning', 'temoso') : L('blocked', 'e thibetsoe'), v.warn_only ? 'partial' : 'overdue')} <small>${esc(v.reason)}</small>` : '✓' },
      { key: 'id', label: '', html: 1, fmt: v => can('catalog') ? `<button class="btn btn-sm" data-lk="${v}">${L('Link', 'Hokela')}</button>` : '' }], rows)}
      <small class="help-note">${L('⚠ = the barcode has a wrong check digit (scan it again or fix it). Products without a GS1 barcode get a shop-only number starting 02.', '⚠ = barcode e fosahetse.')}</small></div>`;
  $('#regB').onclick = async () => { try { const r = await POST('/smartel/register'); toast(`${r.gtins} ${L('barcodes', 'li-barcode')}, ${r.recalls} ${L('recalls', 'tse khutlisoang')}`); reload(); } catch (e) { err(e); } };
  $$('[data-lk]', b).forEach(x => x.onclick = async () => { const p = rows.find(y => String(y.id) === x.dataset.lk);
    const v = prompt(L('Smartel product ID for', 'ID ea Smartel bakeng sa') + ' ' + p.name, p.smartel_product_id || ''); if (v === null) return; await PUT('/smartel/products/' + p.id, { smartel_product_id: v }); reload(); });
}

async function agencyTab(b, s, reload) {
  const ops = await GET('/smartel/ops');
  const t = s.today || {};
  b.innerHTML = `<div class="tiles" style="grid-template-columns:repeat(auto-fill,minmax(190px,1fr));margin-bottom:12px">
      ${[[L('Cash in for services today', 'Chelete e kenang kajeno'), money(t.cash_in)], [L('Cash paid out today', 'Chelete e ntšitsoeng kajeno'), money(t.cash_out)], [L('Commission today', 'Khomishene kajeno'), money(t.commission)],
        [L('Agency cash to settle (2450)', 'Chelete ea agency (2450)'), money(s.balances.agency_clearing)], [L('Card / MyWallet / Switch due (1150)', 'Chelete ea dijithale (1150)'), money(s.balances.digital_due)], [L('Commission due (1160)', 'Khomishene e lefshoang (1160)'), money(s.balances.commission_due)]]
      .map(([k, v]) => `<div class="card"><small class="muted">${k}</small><div style="font-size:20px;font-weight:700">${v}</div></div>`).join('')}</div>
    ${s.open_ops.length ? `<div class="card act-bad" style="margin-bottom:12px"><b>${L('Services waiting for MyWallet', 'Litšebeletso tse emetseng MyWallet')}</b> – ${L('never do these again; the system keeps checking and hands them to Smartel operations after 10 minutes.', 'se li etse hape.')}
      ${tableHtml([{ key: 'created_at', label: L('When', 'Neng'), fmt: dt }, { key: 'op', label: L('Service', 'Tšebeletso'), fmt: (v, o) => opName(o) }, { key: 'amount', label: 'M', right: 1, fmt: v => money(v) }, { key: 'state', label: L('State', 'Boemo'), html: 1, fmt: opBadge }], s.open_ops)}</div>` : ''}
    <div class="cols cols-2" style="align-items:start"><div class="card"><h3>${L('Payment services', 'Litšebeletso')}</h3>
      ${tableHtml([{ key: 'created_at', label: L('When', 'Neng'), fmt: dt }, { key: 'terminal_name', label: L('Till', 'Till') }, { key: 'op', label: L('Service', 'Tšebeletso'), fmt: (v, o) => (s.ops.find(x => x.code === v) || {}).name || v },
        { key: 'amount', label: 'M', right: 1, fmt: v => money(v) }, { key: 'cash', label: L('Cash', 'Chelete'), right: 1, fmt: v => money(v) }, { key: 'commission', label: L('Comm.', 'Khom.'), right: 1, fmt: v => v == null ? '' : money(v) },
        { key: 'mw_ref', label: 'MyWallet ref' }, { key: 'state', label: L('State', 'Boemo'), html: 1, fmt: opBadge }, { key: 'user_name', label: L('Cashier', 'Mohlophisi') }], ops, { empty: L('No services yet.', 'Ha ho litšebeletso.') })}</div>
    <div class="card"><h3>${L('Record a settlement with MyWallet', 'Ngola tefo le MyWallet')}</h3><div id="stf"></div><button class="btn btn-primary" id="stB" style="margin-top:8px">${L('Record', 'Ngola')}</button></div></div>`;
  const f = [{ key: 'kind', label: L('What happened', 'Ho etsahetse eng'), type: 'select', options: [{ value: 'digital', label: L('MyWallet paid out my card / MyWallet / Switch takings', 'MyWallet e lefile chelete ea dijithale') }, { value: 'commission', label: L('MyWallet paid my agency commission', 'MyWallet e lefile khomishene') }, { value: 'agency_out', label: L('I moved agency cash to my MyWallet float', 'Ke isitse chelete ho float') }, { value: 'agency_in', label: L('MyWallet paid back float for cash-outs', 'MyWallet e khutlisitse float') }], span: 2 },
    { key: 'amount', label: L('Amount (M)', 'Chelete (M)'), type: 'number', required: true }, { key: 'account', label: L('Into / from account', 'Akhaonto'), type: 'select', options: [{ value: '1170', label: L('MyWallet business wallet (1170)', 'Wallet ea khoebo (1170)') }, { value: '1050', label: L('Bank (1050)', 'Banka (1050)') }, { value: '1000', label: L('Cash (1000)', 'Chelete (1000)') }] },
    { key: 'reference', label: L('Reference', 'Referense') }, { key: 'date', label: L('Date', 'Letsatsi'), type: 'date' }];
  $('#stf').innerHTML = formHtml(f, {}, { ctx: 'smartel_settle' });
  $('#stB').onclick = async () => { try { await POST('/smartel/settle', readForm($('#stf'), f)); toast(L('Recorded', 'E ngotsoe')); reload(); } catch (e) { err(e); } };
}

async function thokiTab(b) {
  const rows = await GET('/smartel/credit');
  const c = rows[0];
  b.innerHTML = `<div class="card">${c ? `<div class="tiles" style="grid-template-columns:repeat(auto-fill,minmax(190px,1fr))">
      ${[[L('Float line today', 'Float kajeno'), money(c.float_limit)], [L('Stock advance available', 'Kalimo ea setoko'), money(c.stock_advance)], [L('Arrears', 'Melato'), money(c.arrears)], [L('Risk', 'Kotsi'), c.pd_bp == null ? '—' : (c.pd_bp / 100).toFixed(1) + '%']]
      .map(([k, v]) => `<div class="card"><small class="muted">${k}</small><div style="font-size:20px;font-weight:700">${v}</div></div>`).join('')}</div>
      <p class="muted">${L('As of', 'Ho tloha')} ${esc(c.as_of)}${c.ref ? ` · Moralla ref ${esc(c.ref)}` : ''}</p>` : `<p>${L('No Thoki decision received yet. Thoki only sees your figures if you gave consent at Smartel.', 'Ha ho qeto ea Thoki.')}</p>`}
    <small class="help-note">${L('Thoki (Moralla) sets a daily float line from your trading. Each day\'s float draw is swept back at day end from float and commission; a shortfall becomes arrears. Stock advances are paid straight to the supplier (Buy \'n Save) for specific order lines, never in cash.', 'Thoki e beha float letsatsi le leng le le leng.')}</small>
    ${rows.length > 1 ? tableHtml([{ key: 'as_of', label: L('Day', 'Letsatsi') }, { key: 'float_limit', label: L('Float line', 'Float'), right: 1, fmt: v => money(v) }, { key: 'stock_advance', label: L('Stock advance', 'Kalimo'), right: 1, fmt: v => money(v) }, { key: 'arrears', label: L('Arrears', 'Melato'), right: 1, fmt: v => money(v) }], rows) : ''}</div>`;
}

async function bulkTab(b, s, reload) {
  if (!can('payroll')) { b.innerHTML = `<div class="card">${L('Only payroll staff can pay wages.', 'Ke basebetsi ba payroll feela.')}</div>`; return; }
  const [rows, runs] = await Promise.all([GET('/smartel/bulk'), GET('/hrm/payroll').catch(() => [])]);
  const appr = runs.filter(r => r.status === 'approved');
  b.innerHTML = `<div class="card"><div class="row wrap" style="gap:8px;margin-bottom:10px">${appr.length ? `<select id="runSel">${appr.map(r => `<option value="${r.id}">${esc(r.period)} – ${money(r.net_total)}</option>`).join('')}</select><button class="btn btn-primary" id="mk">＋ ${L('Make a wage batch from this payroll', 'Etsa batch ea meputso')}</button>` : `<span class="muted">${L('Approve a payroll run first (HR → Payroll). Employees paid by "Mobile money" with a Lesotho phone number are included.', 'Amohela payroll pele.')}</span>`}</div>
    ${tableHtml([{ key: 'title', label: L('Batch', 'Batch') }, { key: 'total', label: 'M', right: 1, fmt: v => money(v) }, { key: 'lines_n', label: L('People', 'Batho'), right: 1 }, { key: 'paid_n', label: L('Paid', 'Ba lefiloe'), right: 1 }, { key: 'failed_n', label: L('Failed', 'Ho hlolehile'), right: 1 },
      { key: 'state', label: L('State', 'Boemo'), html: 1, fmt: v => badge(v, { done: 'paid', sending: 'partial', created: 'posted', draft: 'draft', cancelled: 'cancelled' }[v]) }, { key: 'created_at', label: L('Made', 'E entsoe'), fmt: dt }], rows, { rowAttr: r => `data-bk="${r.id}" style="cursor:pointer"`, empty: L('No wage batches yet.', 'Ha ho li-batch.') })}
    <small class="help-note">${L('MyWallet checks that your business wallet covers the whole batch (with fees) before anyone is paid. Each person paid is booked straight away; a failed line is never taken from your wallet and stays for "Mark paid" in payroll.', 'MyWallet e hlahloba hore wallet e lekane pele.')}</small></div>`;
  if ($('#mk')) $('#mk').onclick = async () => { try { const r = await POST(`/smartel/bulk/from-payroll/${$('#runSel').value}`); if (r.skipped && r.skipped.length) toast(L('Left out: ', 'Ba sieo: ') + r.skipped.join('; '), 'err', 9000); bulkDialog(r.id, reload); } catch (e) { err(e); } };
  $$('[data-bk]', b).forEach(tr => tr.onclick = () => bulkDialog(Number(tr.dataset.bk), reload));
}
async function bulkDialog(id, reload) {
  const bk = await GET('/smartel/bulk/' + id);
  const sendable = ['draft', 'created'].includes(bk.state);
  modal({ title: bk.title, size: 'lg', body: `${tableHtml([{ key: 'name', label: L('Name', 'Lebitso') }, { key: 'msisdn', label: L('Phone', 'Mohala') }, { key: 'provider', label: L('Wallet', 'Wallet') }, { key: 'amount', label: 'M', right: 1, fmt: v => money(v) },
    { key: 'state', label: L('State', 'Boemo'), html: 1, fmt: v => badge(v, { paid: 'paid', failed: 'cancelled', ready: 'draft', sending: 'partial' }[v]) }, { key: 'mw_ref', label: 'Ref' }, { key: 'failure', label: L('Why not', 'Hobaneng') }], bk.lines)}<p><b>${L('Total', 'Kakaretso')} ${money(bk.total)}</b></p>`,
    actions: [{ label: L('Close', 'Koala') }, ...(bk.state === 'sending' ? [{ label: L('Check results', 'Hlahloba'), onClick: async cl => { await POST(`/smartel/bulk/${id}/refresh`); cl(); bulkDialog(id, reload); } }] : []),
      ...(sendable ? [{ label: L('Cancel batch', 'Hlakola'), onClick: async cl => { await POST(`/smartel/bulk/${id}/cancel`); cl(); reload(); } },
        { label: `💸 ${L('Pay', 'Lefa')} ${money(bk.total)}`, cls: 'btn-primary', onClick: async cl => { if (!await confirmBox(L(`Pay ${bk.lines.length} people ${money(bk.total)} from the business wallet now?`, `Lefa batho ba ${bk.lines.length} hona joale?`), { okLabel: L('Pay', 'Lefa') })) return; await POST(`/smartel/bulk/${id}/send`); cl(); toast(L('Sent to MyWallet', 'E rometsoe')); reload(); bulkDialog(id, reload); } }] : [])] });
}

// ============================================================== the till
const FIELD_LABEL = { cell: ['Customer phone', 'Mohala oa moreki'], amount: ['Amount (M)', 'Chelete (M)'], reference: ['Reference (optional)', 'Referense'], account: ['Agent / till account', 'Akhaonto'],
  cell_sender: ['Sender phone', 'Mohala oa ea romelang'], cell_recipient: ['Receiver phone', 'Mohala oa ea amohelang'], tomember: ['Other network', 'Netweke e ngoe'], voucher: ['Voucher number', 'Nomoro ea voucher'],
  network: ['Network', 'Netweke'], meter: ['Meter number', 'Nomoro ea metara'], biller: ['Pay to', 'Lefa ho'], bouquet: ['Package (DStv)', 'Sephutheloana'] };

/** the "Agent services" panel: check → (OTP / PIN) → confirm; unknown lines are only ever checked, never sent again */
export function agentDialog(S, onChange) {
  const sm = S.catalog.smartel;
  if (!sm || !sm.enabled) return toast(L('Payment services need the Smartel connection (Settings → Smartel connection)', 'Litšebeletso li hloka Smartel'), 'err');
  if (!sm.till_linked) return toast(L('This till is not linked to Smartel yet', 'Till ena ha e so hokahanngoe le Smartel'), 'err');
  if (!S.session) return toast(L('Open a cashier session first', 'Bula session pele'), 'err');
  let cur = sm.ops[0].code;
  const close = modal({ title: `💸 ${L('Agent services', 'Litšebeletso tsa agent')}`, size: 'lg', body: `<div class="wz-choices" id="agOps" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">${sm.ops.map(o => `<button class="wz-choice" data-op="${o.code}"><b>${esc(opName(o))}</b><small>${o.cash > 0 ? L('cash in', 'chelete e kena') : L('cash out', 'chelete e tsoa')}</small></button>`).join('')}</div>
      <div id="agForm" style="margin-top:12px"></div><div id="agLines" style="margin-top:12px"></div>`,
    onOpen: r => {
      const drawForm = () => {
        const o = sm.ops.find(x => x.code === cur);
        $$('[data-op]', r).forEach(b => b.classList.toggle('on', b.dataset.op === cur));
        const f = o.fields.map(k => k === 'biller' ? { key: k, label: L(...FIELD_LABEL[k]), type: 'select', options: sm.billers.map(([value, label]) => ({ value, label })) }
          : k === 'network' ? { key: k, label: L(...FIELD_LABEL[k]), type: 'select', options: [['vcl', 'Vodacom'], ['econet', 'Econet']].map(([value, label]) => ({ value, label })) }
            : k === 'tomember' ? { key: k, label: L(...FIELD_LABEL[k]), type: 'select', options: [['mpesa', 'M-Pesa'], ['ecocash', 'EcoCash'], ['khetsi', 'Khetsi'], ['cpay', 'CPay']].map(([value, label]) => ({ value, label })) }
              : { key: k, label: L(...(FIELD_LABEL[k] || [k, k])), type: k === 'amount' ? 'number' : 'text', required: o.need.includes(k) || k === 'amount' });
        r.querySelector('#agForm').innerHTML = `<div class="card">${formHtml(f, {}, { ctx: 'agent' })}<button class="btn btn-primary" id="agGo" style="margin-top:8px">${L('Check with MyWallet', 'Hlahloba le MyWallet')} ▶</button>
          ${o.otp ? `<small class="help-note">${L('The customer gets a 5-digit PIN by SMS. They read it to you; you type it in the next step. Never write it down.', 'Moreki o fumana PIN ka SMS.')}</small>` : ''}</div>`;
        r.querySelector('#agGo').onclick = async () => {
          const btn = r.querySelector('#agGo'); btn.disabled = true;
          try { const v = readForm(r.querySelector('#agForm'), f); const res = await POST('/smartel/ops', { pos_session_id: S.session.id, session_uuid: S.smartel && S.smartel.session_uuid, op: cur, fields: v });
            S.smartel = { session_uuid: res.session_uuid, view: res.session }; onChange(); drawLines(); }
          catch (e) { err(e); } finally { btn.disabled = false; }
        };
      };
      const drawLines = () => {
        const v = S.smartel && S.smartel.view;
        const el = r.querySelector('#agLines');
        if (!v || !v.ops.length) { el.innerHTML = ''; return; }
        el.innerHTML = `<h3 style="margin:0 0 6px">${L('This customer', 'Moreki enoa')}</h3>${v.ops.map(o => `<div class="card" style="margin-bottom:6px"><div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
          <b style="flex:1">${o.line_no}. ${esc(opName(o))} – ${money(o.amount)}</b>${opBadge(o.state)}</div>
          <div class="muted">${[o.counterparty, o.account_masked, o.fee != null ? L('MyWallet fee', 'Tefo ea MyWallet') + ' ' + money(o.fee) : '', o.mw_ref ? 'Ref ' + o.mw_ref : ''].filter(Boolean).map(esc).join(' · ')}</div>
          ${o.result && o.state !== 'completed' ? `<div style="color:${o.state === 'failed' ? 'var(--bad)' : 'inherit'}">${esc(o.result)}</div>` : ''}
          ${o.state === 'completed' && o.result && o.result !== 'ok' ? `<div class="token-box" style="font-size:16px">${esc(o.result)}</div>` : ''}
          <div class="row" style="gap:6px;margin-top:6px">
            ${o.state === 'otp_wait' ? `<input data-otp="${o.id}" inputmode="numeric" maxlength="8" placeholder="${L('PIN from the customer’s SMS', 'PIN ea SMS')}" autocomplete="off" style="max-width:220px"><button class="btn btn-ok" data-cf="${o.id}">✓ ${L('Confirm', 'Netefatsa')}</button>` : ''}
            ${o.state === 'checked' ? `${o.needs_pin ? `<input data-pin="${o.id}" type="password" inputmode="numeric" placeholder="PIN" style="max-width:140px">` : ''}<button class="btn btn-ok" data-cf="${o.id}">✓ ${L('Confirm and do it', 'Netefatsa')} ${money(o.amount)}</button>` : ''}
            ${o.waiting ? `<button class="btn" data-rf="${o.id}">🔄 ${L('Check again', 'Hlahloba hape')}</button><small class="muted">${L('Do NOT do this service again. MyWallet is being asked what happened.', 'SE etse tšebeletso ena hape.')}</small>` : ''}
            ${['checked', 'otp_wait', 'draft'].includes(o.state) ? `<button class="btn" data-cx="${o.id}">✕ ${L('Drop', 'Tlosa')}</button>` : ''}
            ${o.state === 'escalated' ? `<small>${L('Handed to Smartel operations. Give the customer the reference and do not repeat it.', 'E fetiselitsoe ho Smartel.')}</small>` : ''}</div></div>`).join('')}
          <div class="row" style="margin-top:6px"><b>${L('Net cash for services', 'Chelete ea litšebeletso')}: ${money(v.services_cash)}</b><span class="spacer"></span>${S.order.lines.length ? `<button class="btn btn-primary" data-close="1">${L('Back to the sale', 'Khutlela thekisong')}</button>` : `<button class="btn btn-primary" id="agFin" ${v.blocked ? 'disabled' : ''}>🧾 ${L('Finish customer & print', 'Qetela moreki')}</button>`}</div>`;
        const act = async (fn) => { try { const res = await fn(); S.smartel.view = res.session; onChange(); drawLines(); if (res.op && res.op.state === 'failed') toast(res.op.result || L('MyWallet refused', 'MyWallet e hanne'), 'err', 6000); } catch (e) { err(e); drawLines(); } };
        $$('[data-cf]', el).forEach(b => b.onclick = () => { b.disabled = true; const id = b.dataset.cf; const otpEl = el.querySelector(`[data-otp="${id}"]`); const pinEl = el.querySelector(`[data-pin="${id}"]`);
          act(() => POST(`/smartel/ops/${id}/confirm`, { otp: otpEl ? otpEl.value : undefined, pin: pinEl ? pinEl.value : undefined })); if (otpEl) otpEl.value = ''; });
        $$('[data-rf]', el).forEach(b => b.onclick = () => act(() => POST(`/smartel/ops/${b.dataset.rf}/refresh`)));
        $$('[data-cx]', el).forEach(b => b.onclick = () => act(() => POST(`/smartel/ops/${b.dataset.cx}/cancel`)));
        const cb = el.querySelector('[data-close]'); if (cb) cb.onclick = () => close();
        const fin = el.querySelector('#agFin'); if (fin) fin.onclick = async () => { try { const res = await POST(`/smartel/sessions/${S.smartel.session_uuid}/finish`); close(); servicesReceipt(res); S.smartel = null; onChange(); } catch (e) { err(e); } };
        // keep asking about lines MyWallet has not answered yet
        if (v.ops.some(o => o.waiting) && !r._poll) r._poll = setTimeout(async () => { r._poll = null; if (!r.isConnected) return; try { const res = await GET(`/smartel/sessions/${S.smartel.session_uuid}`); S.smartel.view = res; onChange(); drawLines(); } catch (_) { /* try again */ } }, 5000);
      };
      $$('[data-op]', r).forEach(b => b.onclick = () => { cur = b.dataset.op; drawForm(); });
      drawForm(); drawLines();
    } });
}

function servicesReceipt(res) {
  const c = state.company || {};
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:'Courier New',monospace;font-size:12px;width:72mm;margin:0 auto}.c{text-align:center}.r{text-align:right}table{width:100%}hr{border:0;border-top:1px dashed #000}</style></head><body>
    <div class="c"><b>${esc(c.name || '')}</b><br>${esc(c.address || '')}</div><hr>${esc(res.receipt_no || '')}<br>${new Date().toLocaleString()}<br>${L('PAYMENT SERVICES – not a tax invoice', 'LITŠEBELETSO – hase invoice ea lekhetho')}<hr>
    <table>${(res.ops || []).map(o => `<tr><td>${esc(o.name || o.op)}<br><small>${esc(o.account_masked || '')} Ref ${esc(o.mw_ref || '')}</small>${o.result && o.result !== 'ok' ? `<br><b>${esc(o.result)}</b>` : ''}</td><td class="r">${money(o.amount)}</td></tr>`).join('')}</table><hr>
    <table><tr><td><b>${L('Net cash', 'Chelete')}</b></td><td class="r"><b>${money(res.net_cash)}</b></td></tr></table><hr><div class="c">MyWallet · Smartel</div></body></html>`;
  modal({ title: L('Customer finished', 'Moreki o qetile'), body: `<iframe id="sr" style="width:100%;height:360px;border:1px solid var(--line);background:#fff"></iframe>`, onOpen: r => { const f = r.querySelector('#sr'); f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close(); },
    actions: [{ label: '🖨 ' + L('Print', 'Hatisa'), onClick: () => printHtml(html) }, { label: L('Next customer ▶', 'Moreki o latelang ▶'), cls: 'btn-primary' }] });
}

/** card / MyWallet / Switch: ask pos-api for a payment request, show the QR / link, wait until the customer approved it */
export async function requestPayment(S, p, btn, redraw) {
  btn.disabled = true; btn.textContent = L('Asking…', 'E ea botsa…');
  try {
    const res = await POST('/smartel/intents', { pos_session_id: S.session.id, session_uuid: S.smartel && S.smartel.session_uuid, method_id: p.method_id, amount: p.amount });
    S.smartel = { ...(S.smartel || {}), session_uuid: res.session_uuid };
    let it = res.intent;
    let stop = false;
    const close = modal({ title: `${esc(p.m.name)} – ${money(p.amount)}`, body: `<div class="c" style="text-align:center"><div id="qrBox" style="width:220px;margin:0 auto">${it.qr_svg || ''}</div>${it.url ? `<p><a href="${esc(it.url)}" target="_blank" rel="noopener">${L('Open the card payment page', 'Bula leqephe la karete')}</a></p>` : ''}
      <p id="qrSt" class="muted">${L('Ask the customer to scan and approve on their phone…', 'Kopa moreki ho scan le ho amohela fonong…')}</p><small class="help-note">${L('The till never sees a card number or PIN. Wait until it says approved.', 'Till ha e bone nomoro ea karete kapa PIN.')}</small></div>`,
      onClose: () => { stop = true; }, actions: [{ label: L('Cancel', 'Hlakola') }] });
    for (let i = 0; i < 120 && !stop; i++) {
      await new Promise(r => setTimeout(r, 2500));
      if (stop) break;
      it = await GET('/smartel/intents/' + it.id).catch(() => it);
      const st = document.getElementById('qrSt'); if (st) st.textContent = it.state;
      if (it.paid) { p.intent_id = it.id; p.reference = it.mw_ref || it.intent_id; p.approved = true; toast(L('Customer approved the payment', 'Moreki o amohetse tefo')); close(); redraw(); return; }
      if (it.final) throw new Error(`${L('Payment', 'Tefo')} ${it.state.toLowerCase()}`);
    }
    if (!p.approved) throw new Error(L('Not approved – you can try again or take cash', 'Ha ea amoheloa – leka hape kapa nka chelete'));
  } catch (e) { err(e); }
  finally { btn.disabled = false; btn.textContent = `📲 ${L('Ask customer to pay', 'Kopa moreki ho lefa')}`; }
}

export const isSmartelMethod = m => String((m && m.plugin_id) || '').startsWith('smartel:');
export function servicesHtml(o) {
  if (!o.services || !o.services.length) return '';
  return `<hr><div><b>${L('PAYMENT SERVICES', 'LITŠEBELETSO')}</b> (${L('no VAT', 'ha ho VAT')})</div><table>${o.services.map(s => `<tr><td>${esc(s.name || s.op)}<br><small>${esc(s.account_masked || '')} Ref ${esc(s.mw_ref || '')}</small>${s.result && s.result !== 'ok' ? `<br><b>${esc(s.result)}</b>` : ''}</td><td class="r">${money(s.cash)}</td></tr>`).join('')}</table>
    <table><tr class="b"><td>${L('NET CASH', 'CHELETE KAOFELA')}</td><td class="r">${money(o.net_cash)}</td></tr></table>`;
}
