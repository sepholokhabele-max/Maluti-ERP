// Asset register: overview, register, depreciation, physical counts, roll-forward report, categories; one asset; one count.
import { state, GET, POST, PUT, esc, $, $$, toast, err, money, qty, modal, confirmBox, formHtml, readForm, tableHtml, badge, page, d, dt, today, query, filesCard, printHtml } from './core.js';

const COND = { new: ['new', 'ok'], good: ['good', 'ok'], fair: ['fair', 'draft'], poor: ['poor', 'partial'], broken: ['broken', 'cancelled'] };
const cBadge = c => badge((COND[c] || [c])[0], (COND[c] || [c, ''])[1]);
const ST = { active: ['in use', 'ok'], disposed: ['disposed', 'closed'], written_off: ['written off', 'cancelled'] };
const METHOD = { straight_line: 'Straight line', reducing_balance: 'Reducing balance', none: 'Not depreciated (e.g. land)' };
const lastMonth = () => { const x = new Date(); x.setDate(1); x.setMonth(x.getMonth() - 1); return x.toISOString().slice(0, 7); };
const methods = async () => (await GET('/payment-methods')).filter(m => m.active && m.kind !== 'account');

export async function assets(view) {
  const tab = query().tab || 'overview';
  const tabs = [['overview', 'Overview'], ['register', 'Register'], ['depreciation', 'Depreciation'], ['counts', 'Asset counts'], ['movement', 'Roll-forward (AFS)'], ['categories', 'Categories']];
  view.innerHTML = page('Asset register', '<button class="btn btn-primary" id="an">＋ Asset</button>', `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/assets?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="ab"></div>`);
  $('#an').onclick = () => assetDialog(null, id => { location.hash = '#/asset/' + id; });
  const T = { overview, register, depreciation, counts, movement, categories };
  await (T[tab] || overview)($('#ab'), () => assets(view));
}
async function overview(ab) {
  const s = await GET('/assets/summary');
  const behind = s.depreciated_to && s.depreciated_to < s.due_period;
  ab.innerHTML = `<div class="cols cols-4" style="margin-bottom:12px"><div class="kpi"><div class="label">Assets in use</div><div class="value">${s.assets}</div><div class="hint">${s.not_verified} not counted in the last 12 months</div></div>
      <div class="kpi"><div class="label">Cost</div><div class="value">${money(s.cost)}</div></div><div class="kpi"><div class="label">Depreciation to date</div><div class="value">${money(s.accum_dep)}</div></div>
      <div class="kpi"><div class="label">Book value</div><div class="value">${money(s.nbv)}</div><div class="hint">${s.depreciated_to ? `depreciated to ${esc(s.depreciated_to)}` : 'no depreciation run yet'}</div></div></div>
    ${behind || (!s.depreciated_to && s.assets) ? `<div class="card" style="border-left:4px solid var(--bad)"><b>Depreciation is behind.</b> Run it up to ${esc(s.due_period)} so the books show the right values. <a href="#/assets?tab=depreciation">Run depreciation →</a></div>` : ''}
    <div class="cols cols-2"><div class="card"><h3>By category</h3>${tableHtml([{ key: 'category', label: 'Category' }, { key: 'n', label: 'Assets', right: 1 }, { key: 'cost', label: 'Cost', right: 1, fmt: money }, { key: 'nbv', label: 'Book value', right: 1, fmt: money }], s.by_category, { empty: 'No assets yet.' })}</div>
      <div class="card"><h3>By location</h3>${tableHtml([{ key: 'location', label: 'Location' }, { key: 'n', label: 'Assets', right: 1 }, { key: 'nbv', label: 'Book value', right: 1, fmt: money }], s.by_location, { empty: 'No assets yet.' })}</div></div>
    <div class="card"><h3>Warranties and insurance ending in the next 60 days</h3>${tableHtml([{ key: 'asset_no', label: 'Asset' }, { key: 'name', label: '' }, { key: 'warranty_until', label: 'Warranty', fmt: d }, { key: 'insurance_expiry', label: 'Insurance', fmt: d }], s.expiring, { rowAttr: a => `data-a="${a.id}"`, empty: 'Nothing ending soon.' })}</div>`;
  $$('[data-a]', ab).forEach(tr => tr.onclick = () => { location.hash = '#/asset/' + tr.dataset.a; });
}
async function register(ab) {
  const q = query();
  const [rows, cats, locs] = await Promise.all([GET(`/assets?q=${encodeURIComponent(q.q || '')}${q.category_id ? '&category_id=' + q.category_id : ''}${q.location ? '&location=' + encodeURIComponent(q.location) : ''}${q.status ? '&status=' + q.status : ''}`), GET('/assets/categories'), GET('/assets/locations')]);
  const tot = k => rows.reduce((s, a) => s + Number(a[k]), 0);
  ab.innerHTML = `<div class="row wrap" style="margin-bottom:10px"><input id="aq" placeholder="Number, name, serial, barcode or person" value="${esc(q.q || '')}" style="min-width:240px">
      <select id="ac"><option value="">All categories</option>${cats.map(k => `<option value="${k.id}" ${String(k.id) === q.category_id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select>
      <select id="al"><option value="">All locations</option>${locs.map(l => `<option ${l === q.location ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <select id="as"><option value="">In use</option><option value="disposed" ${q.status === 'disposed' ? 'selected' : ''}>Disposed</option><option value="written_off" ${q.status === 'written_off' ? 'selected' : ''}>Written off</option></select><button class="btn" id="ag">Show</button>
      <span class="spacer"></span><button class="btn" id="alb">🏷 Print labels</button></div>
    <div class="card">${tableHtml([{ key: 'id', label: '', html: 1, fmt: v => `<input type="checkbox" data-pick="${v}" onclick="event.stopPropagation()">` }, { key: 'asset_no', label: 'Number' }, { key: 'name', label: 'Asset' }, { key: 'category', label: 'Category' },
      { key: 'serial_no', label: 'Serial' }, { key: 'location', label: 'Location' }, { key: 'custodian', label: 'Looked after by' }, { key: 'in_service_date', label: 'In use from', fmt: d },
      { key: 'cost', label: 'Cost', right: 1, fmt: money }, { key: 'accum_dep', label: 'Depreciation', right: 1, fmt: money }, { key: 'nbv', label: 'Book value', right: 1, fmt: money }, { key: 'condition_now', label: 'Condition', html: 1, fmt: cBadge }],
      [...rows, ...(rows.length > 1 ? [{ asset_no: '', name: `<b>${rows.length} assets</b>`, cost: tot('cost'), accum_dep: tot('accum_dep'), nbv: tot('nbv') }] : [])], { rowAttr: a => a.id ? `data-a="${a.id}"` : '', empty: 'No assets here.' })}</div>`;
  $('#ag').onclick = () => { location.hash = `#/assets?tab=register&q=${encodeURIComponent($('#aq').value)}&category_id=${$('#ac').value}&location=${encodeURIComponent($('#al').value)}&status=${$('#as').value}`; };
  $$('[data-a]', ab).forEach(tr => tr.onclick = () => { location.hash = '#/asset/' + tr.dataset.a; });
  $('#alb').onclick = async () => {
    let ids = $$('[data-pick]', ab).filter(i => i.checked).map(i => i.dataset.pick); if (!ids.length) ids = rows.map(a => a.id);
    if (!ids.length) return toast('No assets', 'err');
    const labels = await GET('/assets/labels?ids=' + ids.join(','));
    printHtml(`<div style="font-family:Arial;display:flex;flex-wrap:wrap;gap:6mm">${labels.map(l => `<div style="width:62mm;border:1px solid #999;border-radius:2mm;padding:2mm;display:flex;gap:2mm;align-items:center;page-break-inside:avoid"><div style="width:20mm;height:20mm">${l.qr_svg}</div>
      <div style="font-size:9pt"><b>${esc(l.asset_no)}</b><br>${esc(l.name)}<br><small>${esc(l.serial_no || '')}</small><br><small>Property of ${esc(l.company)}</small></div></div>`).join('')}</div>`);
  };
}
async function depreciation(ab, reload) {
  const runs = await GET('/assets/depreciation/runs');
  ab.innerHTML = `<div class="card"><h3>Run depreciation</h3><p class="muted">Works out the depreciation of every asset in use for each month up to the month you choose (missed months are caught up) and posts it to the books: Dr Depreciation, Cr Accumulated depreciation. Run it once a month after month-end.</p>
      <div class="row"><label>Up to <input type="month" id="dm" value="${lastMonth()}"></label><button class="btn btn-primary" id="dr">Run depreciation</button></div></div>
    <div class="card"><h3>Runs</h3>${tableHtml([{ key: 'created_at', label: 'When', fmt: dt }, { key: 'upto_period', label: 'Up to' }, { key: 'assets', label: 'Assets', right: 1 }, { key: 'total', label: 'Depreciation', right: 1, fmt: money }, { key: 'user_name', label: 'By' }], runs, { empty: 'No depreciation run yet.' })}</div>`;
  $('#dr').onclick = async () => { try { const x = await POST('/assets/depreciation', { upto: $('#dm').value }); toast(x.total ? `${money(x.total)} depreciation on ${x.assets} assets` : 'Already up to date'); reload(); } catch (e) { err(e); } };
}
async function counts(ab, reload) {
  const [rows, locs] = await Promise.all([GET('/assets/counts'), GET('/assets/locations')]);
  ab.innerHTML = `<div class="card"><div class="row"><p class="muted" style="flex:1">An asset count checks that every asset is where the register says, and in what condition. Walk around, scan each QR label (or type the number), then close the count to see what is missing.</p><button class="btn btn-primary" id="cn">＋ New count</button></div>
    ${tableHtml([{ key: 'created_at', label: 'Started', fmt: dt }, { key: 'name', label: 'Count' }, { key: 'location', label: 'Location', fmt: v => v || 'everywhere' }, { key: 'seen', label: 'Found', right: 1 }, { key: 'status', label: 'Status' }, { key: 'user_name', label: 'By' }], rows, { rowAttr: c => `data-c="${c.id}"`, empty: 'No counts yet.' })}</div>`;
  $('#cn').onclick = () => { const f = [{ key: 'name', label: 'Name', placeholder: `Asset count ${today()}` }, { key: 'location', label: 'Only this location', type: 'select', options: [{ value: '', label: 'Everywhere' }, ...locs.map(l => ({ value: l, label: l }))] }];
    modal({ title: 'New asset count', body: formHtml(f, {}), actions: [{ label: 'Cancel' }, { label: 'Start', cls: 'btn-primary', onClick: async (c, r) => { const x = await POST('/assets/counts', readForm(r, f)); c(); location.hash = '#/assetcount/' + x.id; } }] }); };
  $$('[data-c]', ab).forEach(tr => tr.onclick = () => { location.hash = '#/assetcount/' + tr.dataset.c; });
}
async function movement(ab) {
  const q = query(), from = q.from || today().slice(0, 4) + '-01-01', to = q.to || today();
  const x = await GET(`/assets/movement?from=${from}&to=${to}`);
  const cols = [{ key: 'category', label: 'Category' }, { key: 'cost_open', label: 'Cost at start', right: 1, fmt: money }, { key: 'additions', label: 'Additions', right: 1, fmt: money }, { key: 'disposals_cost', label: 'Disposals', right: 1, fmt: v => v ? `(${money(v)})` : money(0) },
    { key: 'cost_close', label: 'Cost at end', right: 1, fmt: money }, { key: 'dep_open', label: 'Depr. at start', right: 1, fmt: money }, { key: 'dep_charge', label: 'Charge', right: 1, fmt: money }, { key: 'dep_disposals', label: 'On disposals', right: 1, fmt: v => v ? `(${money(v)})` : money(0) },
    { key: 'dep_close', label: 'Depr. at end', right: 1, fmt: money }, { key: 'nbv_close', label: 'Book value at end', right: 1, html: 1, fmt: v => `<b>${money(v)}</b>` }];
  ab.innerHTML = `<div class="card"><div class="row" style="margin-bottom:8px"><label>From <input type="date" id="mf" value="${from}"></label><label>To <input type="date" id="mt" value="${to}"></label><button class="btn" id="mg">Show</button><span class="spacer"></span><button class="btn" id="mp">🖨 Print</button></div>
    <div id="mvt"><h3>Property, plant and equipment ${esc(x.from)} to ${esc(x.to)}</h3>${tableHtml(cols, [...x.rows, x.total], { empty: 'No assets.' })}</div>
    <p class="muted">The note for the annual financial statements (IAS 16 / IFRS for SMEs section 17). Run depreciation up to the end date first.</p></div>`;
  $('#mg').onclick = () => { location.hash = `#/assets?tab=movement&from=${$('#mf').value}&to=${$('#mt').value}`; };
  $('#mp').onclick = () => printHtml(`<div style="font-family:Arial;font-size:11px"><h2>${esc(state.company.name || '')}</h2>${$('#mvt').innerHTML}</div>`);
}
async function categories(ab, reload) {
  const rows = await GET('/assets/categories');
  ab.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="spacer"></span><button class="btn btn-primary" id="kn">＋ Category</button></div>
    <div class="card">${tableHtml([{ key: 'name', label: 'Category' }, { key: 'method', label: 'Method', fmt: v => METHOD[v] }, { key: 'life_months', label: 'Life', right: 1, fmt: (v, k) => k.method === 'straight_line' ? `${v} months (${Math.round(v / 12 * 10) / 10} years)` : k.method === 'reducing_balance' ? `${k.rate_pct}% a year` : '' },
      { key: 'residual_pct', label: 'Residual', right: 1, fmt: v => Number(v) ? v + '%' : '' }, { key: 'asset_code', label: 'Accounts', fmt: (v, k) => `${v} / ${k.accum_code} / ${k.expense_code}` }, { key: 'assets', label: 'Assets', right: 1 }], rows, { rowAttr: k => `data-k="${k.id}"` })}
    <p class="muted">Lives are your accounting policy (book depreciation). Wear-and-tear allowances for income tax are worked out separately by RSL rules.</p></div>`;
  const dlg = k => {
    const f = [{ key: 'name', label: 'Name', required: true }, { key: 'method', label: 'Method', type: 'select', options: Object.entries(METHOD).map(([value, label]) => ({ value, label })) },
      { key: 'life_months', label: 'Useful life (months) – straight line', type: 'number' }, { key: 'rate_pct', label: 'Yearly rate % – reducing balance', type: 'number' }, { key: 'residual_pct', label: 'Residual value, % of cost', type: 'number' },
      { key: 'asset_code', label: 'Asset (cost) account' }, { key: 'accum_code', label: 'Accumulated depreciation account' }, { key: 'expense_code', label: 'Depreciation expense account' }, { key: 'active', label: 'In use', type: 'checkbox' }];
    modal({ title: k ? k.name : 'New category', body: formHtml(f, k || { method: 'straight_line', life_months: 60, expense_code: '6950', asset_code: '1630', accum_code: '1635', active: 1 }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); if (k) await PUT('/assets/categories/' + k.id, v); else await POST('/assets/categories', v); c(); reload(); } }] });
  };
  $('#kn').onclick = () => dlg(null);
  $$('[data-k]', ab).forEach(tr => tr.onclick = () => dlg(rows.find(k => k.id === Number(tr.dataset.k))));
}

/* ---------------- add / edit ---------------- */
async function assetDialog(a, done) {
  const [cats, ms, sups, vs, locs] = await Promise.all([GET('/assets/categories'), methods(), GET('/partners?is_supplier=1').catch(() => []), GET('/vehicles').catch(() => []), GET('/assets/locations')]);
  const f = [{ key: 'name', label: 'Asset', required: true, span: 2 }, ...(a ? [] : [{ key: 'category_id', label: 'Category', type: 'select', options: cats.filter(k => k.active).map(k => ({ value: k.id, label: k.name })) }]),
    { key: 'serial_no', label: 'Serial number' }, { key: 'make_model', label: 'Make & model' }, { key: 'barcode', label: 'Existing barcode / tag (optional)' },
    ...(a ? [] : [{ key: 'location', label: `Location${locs.length ? ' (e.g. ' + locs.slice(0, 2).join(', ') + ')' : ''}` }, { key: 'custodian', label: 'Looked after by' }]), { key: 'department', label: 'Department' },
    ...(a ? [] : [{ type: 'heading', label: 'Cost and how it was acquired' }, { key: 'source', label: 'Acquired', type: 'select', options: [{ value: 'paid', label: 'Bought – paid now' }, { value: 'supplier', label: 'Bought on the supplier\'s account' },
        { value: 'bill', label: 'Already on a supplier bill (to the asset account)' }, { value: 'opening', label: 'Owned before S-ERP (opening balance)' }, { value: 'donated', label: 'Donated / grant' }] },
      { key: 'cost', label: 'Cost excl. VAT', type: 'number', required: true }, { key: 'vat_amount', label: 'VAT claimed back', type: 'number' },
      { key: 'method_id', label: 'Paid with', type: 'select', options: ms.map(m => ({ value: m.id, label: m.name })) }, { key: 'supplier_id', label: 'Supplier', type: 'select', options: [{ value: '', label: '–' }, ...sups.map(s => ({ value: s.id, label: s.name }))] },
      { key: 'invoice_ref', label: 'Invoice / reference' }, { key: 'funding', label: 'Funded by (own funds, donor, grant…)' }, { key: 'purchase_date', label: 'Bought on', type: 'date' }, { key: 'in_service_date', label: 'Put into use on', type: 'date' },
      { key: 'opening_accum_dep', label: 'Opening balance only: depreciation to date', type: 'number' }, { key: 'depreciated_upto', label: '… up to month (YYYY-MM)' }]),
    { type: 'heading', label: 'Depreciation (empty = the category\'s)' }, { key: 'method', label: 'Method', type: 'select', options: [{ value: '', label: '– as the category –' }, ...Object.entries(METHOD).map(([value, label]) => ({ value, label }))] },
    { key: 'life_months', label: 'Useful life (months)', type: 'number', nullable: true }, { key: 'rate_pct', label: 'Rate % a year', type: 'number', nullable: true }, { key: 'residual_value', label: 'Residual value', type: 'number', nullable: true },
    { type: 'heading', label: 'Cover' }, { key: 'warranty_until', label: 'Warranty until', type: 'date' }, { key: 'insurer', label: 'Insurer' }, { key: 'insured_value', label: 'Insured for', type: 'number', nullable: true }, { key: 'insurance_expiry', label: 'Insurance expires', type: 'date' },
    { key: 'vehicle_id', label: 'This is the vehicle', type: 'select', options: [{ value: '', label: '–' }, ...vs.map(v => ({ value: v.id, label: v.reg_no }))] }, { key: 'condition_now', label: 'Condition', type: 'select', options: Object.keys(COND).map(c => ({ value: c, label: c })) }, { key: 'notes', label: 'Notes', span: 2 }];
  modal({ title: a ? `Edit ${a.asset_no}` : 'New asset', size: 'lg', body: formHtml(f, a || { source: 'paid', in_service_date: today(), purchase_date: today(), condition_now: 'new', method: '' }, { ctx: 'asset' }),
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => {
      const v = readForm(r, f); for (const k of ['method', 'life_months', 'rate_pct', 'residual_value']) if (v[k] === '' || v[k] === null) delete v[k];
      const x = a ? await PUT('/assets/' + a.id, v) : await POST('/assets', v); toast('Saved'); c(); done && done(x.id);
    } }] });
}

/* ---------------- one asset ---------------- */
export async function asset(view, [idq]) {
  const id = Number(String(idq || '').split('?')[0]);
  const a = await GET('/assets/' + id), reload = () => asset(view, [String(id)]);
  const life = a.method === 'straight_line' ? `${a.life_months} months` : a.method === 'reducing_balance' ? `${a.rate_pct}% a year` : 'not depreciated';
  view.innerHTML = page(`🏷 ${a.asset_no} – ${a.name}`, `<a class="btn" href="#/assets?tab=register">← Register</a>${a.status === 'active' ? '<button class="btn" id="xt">Move / hand over</button><button class="btn" id="xe">Edit</button><button class="btn btn-danger" id="xd">Dispose / write off</button>' : ''}<button class="btn" id="xl">🏷 Label</button>`,
    `<div class="cols cols-4" style="margin-bottom:12px"><div class="kpi"><div class="label">Status</div><div class="value">${badge(ST[a.status][0], ST[a.status][1])} ${cBadge(a.condition_now)}</div><div class="hint">${esc(a.category)}${a.reg_no ? ` · vehicle <a href="#/vehicle/${a.vehicle_id}">${esc(a.reg_no)}</a>` : ''}</div></div>
      <div class="kpi"><div class="label">Cost</div><div class="value">${money(a.cost)}</div><div class="hint">in use from ${d(a.in_service_date)}${a.funding ? ' · ' + esc(a.funding) : ''}</div></div>
      <div class="kpi"><div class="label">Book value</div><div class="value">${money(a.nbv)}</div><div class="hint">depreciation ${money(a.accum_dep)}${a.last_dep_period ? ' to ' + esc(a.last_dep_period) : ''} · ${esc(life)}${a.status === 'active' && a.monthly ? ` · ${money(a.monthly)}/month` : ''}</div></div>
      <div class="kpi"><div class="label">Where</div><div class="value" style="font-size:17px">${esc(a.location || '—')}</div><div class="hint">looked after by ${esc(a.custodian || '—')}${a.last_verified ? ` · counted ${d(a.last_verified)}` : ' · never counted'}</div></div></div>
    ${a.status !== 'active' ? `<div class="card"><b>${ST[a.status][0]} on ${d(a.disposal_date)}</b> – ${esc(a.disposal_note || '')}. Proceeds ${money(a.disposal_proceeds)}, ${Number(a.disposal_gain) >= 0 ? 'gain' : 'loss'} ${money(Math.abs(a.disposal_gain))}.</div>` : ''}
    <div class="cols cols-2"><div class="card"><h3>Details</h3><p>Serial ${esc(a.serial_no || '—')} · ${esc(a.make_model || '')}${a.barcode ? ' · tag ' + esc(a.barcode) : ''}<br>Supplier ${esc(a.supplier_name || '—')} ${a.invoice_ref ? '· ' + esc(a.invoice_ref) : ''} · bought ${d(a.purchase_date) || '—'}<br>
      Warranty ${d(a.warranty_until) || '—'} · insured ${a.insured_value ? money(a.insured_value) : '—'} ${a.insurer ? 'with ' + esc(a.insurer) : ''} ${a.insurance_expiry ? 'to ' + d(a.insurance_expiry) : ''}<br>${esc(a.notes || '')}</p></div>
      <div class="card"><h3>Movements</h3>${tableHtml([{ key: 'move_date', label: 'Date', fmt: d }, { key: 'kind', label: 'What' }, { key: 'to_location', label: 'To', fmt: (v, m) => [v, m.to_custodian].filter(Boolean).join(' · ') }, { key: 'note', label: 'Note' }, { key: 'user_name', label: 'By' }], a.moves)}</div></div>
    <div class="card"><h3>Depreciation</h3>${tableHtml([{ key: 'period', label: 'Month' }, { key: 'amount', label: 'Charge', right: 1, fmt: money }, { key: 'accum_after', label: 'Total to date', right: 1, fmt: money }, { key: 'accum_after', label: 'Book value', right: 1, fmt: v => money(Number(a.cost) - Number(v)) }], a.depreciation, { empty: 'Not depreciated yet.' })}</div>`);
  filesCard('asset', a.id, 'Invoice, photos, warranty & insurance documents');
  const on = (k, fn) => { const b = document.getElementById(k); if (b) b.onclick = async () => { try { await fn(); } catch (e) { err(e); } }; };
  on('xe', () => assetDialog(a, reload));
  on('xl', async () => { const [l] = await GET('/assets/labels?ids=' + a.id); printHtml(`<div style="font-family:Arial;width:62mm;border:1px solid #999;padding:2mm;display:flex;gap:2mm;align-items:center"><div style="width:20mm;height:20mm">${l.qr_svg}</div><div style="font-size:9pt"><b>${esc(l.asset_no)}</b><br>${esc(l.name)}<br><small>Property of ${esc(l.company)}</small></div></div>`); });
  on('xt', async () => {
    const f = [{ key: 'location', label: 'New location' }, { key: 'custodian', label: 'Handed over to' }, { key: 'department', label: 'Department' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'note', label: 'Note', span: 2 }];
    modal({ title: 'Move / hand over', body: formHtml(f, { location: a.location, custodian: a.custodian, department: a.department, date: today() }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/assets/${a.id}/transfer`, readForm(r, f)); c(); reload(); } }] });
  });
  on('xd', async () => {
    const ms = await methods();
    const f = [{ key: 'kind', label: 'What happened', type: 'select', options: [{ value: 'disposed', label: 'Sold / traded in / scrapped' }, { value: 'written_off', label: 'Written off (lost, stolen, destroyed)' }] }, { key: 'date', label: 'Date', type: 'date' },
      { key: 'proceeds', label: 'Money received', type: 'number' }, { key: 'method_id', label: 'Into', type: 'select', options: ms.map(m => ({ value: m.id, label: m.name })) }, { key: 'note', label: 'Who bought it / what happened', span: 2, required: true }];
    modal({ title: `Dispose of ${a.asset_no}`, body: `<p>Book value now ${money(a.nbv)} (depreciation is brought up to the month before). The difference with the money received is booked as a gain or loss.</p>${formHtml(f, { kind: 'disposed', date: today() })}`,
      actions: [{ label: 'Cancel' }, { label: 'Dispose', cls: 'btn-danger', onClick: async (c, r) => { const x = await POST(`/assets/${a.id}/dispose`, readForm(r, f)); toast(x.pending ? x.message : `${x.gain >= 0 ? 'Gain' : 'Loss'} ${money(Math.abs(x.gain))}`, 'ok', x.pending ? 6000 : 3200); c(); reload(); } }] });
  });
}

/* ---------------- one count ---------------- */
export async function assetCount(view, [idq]) {
  const id = Number(String(idq || '').split('?')[0]);
  const k = await GET('/assets/counts/' + id), reload = () => assetCount(view, [String(id)]);
  const open = k.status === 'open';
  view.innerHTML = page(`Asset count – ${k.name}`, `<a class="btn" href="#/assets?tab=counts">← Counts</a>${open ? '<button class="btn btn-primary" id="kc">Close count</button>' : ''}<button class="btn" id="kp">🖨 Report</button>`,
    `<div class="cols cols-3" style="margin-bottom:12px"><div class="kpi"><div class="label">Found</div><div class="value" style="color:var(--ok)">${k.seen}</div></div><div class="kpi"><div class="label">Missing</div><div class="value" style="color:var(--bad)">${k.missing}</div></div><div class="kpi"><div class="label">Not checked yet</div><div class="value">${k.unchecked}</div></div></div>
    ${open ? `<div class="card"><div class="row"><input id="ks" placeholder="Scan the QR label or type the asset number" style="flex:1;font-size:18px" autofocus><select id="kcond"><option value="">condition…</option>${Object.keys(COND).map(c => `<option>${c}</option>`).join('')}</select><button class="btn btn-primary" id="kf">Found</button></div><div id="km" class="muted" style="margin-top:6px"></div></div>` : ''}
    <div class="card" id="krep">${tableHtml([{ key: 'asset_no', label: 'Number' }, { key: 'name', label: 'Asset' }, { key: 'location', label: 'Register says' }, { key: 'custodian', label: 'Looked after by' },
      { key: 'found', label: 'Result', html: 1, fmt: (v, a) => v === 1 ? `${badge('found', 'ok')} ${a.seen_condition ? cBadge(a.seen_condition) : ''}` : v === 0 ? badge('missing', 'cancelled') : '<span class="muted">not checked</span>' },
      { key: 'id', label: '', html: 1, fmt: (v, a) => open && a.found !== 0 ? `<button class="btn btn-sm" data-miss="${v}">Missing</button>` : '' }], k.assets, { empty: 'No assets in use.' })}</div>`);
  const scan = async () => { const code = $('#ks').value.trim(); if (!code) return; try { await POST(`/assets/counts/${id}/scan`, { code, condition_now: $('#kcond').value }); toast(`${code} found`); reload(); } catch (e) { $('#km').textContent = e.message; } };
  if ($('#kf')) { $('#kf').onclick = scan; $('#ks').onkeydown = e => { if (e.key === 'Enter') scan(); }; }
  $$('[data-miss]').forEach(b => b.onclick = async () => { await POST(`/assets/counts/${id}/scan`, { asset_id: Number(b.dataset.miss), found: false }); reload(); });
  if ($('#kc')) $('#kc').onclick = async () => { if (!(await confirmBox(`Close the count? ${k.unchecked} assets were not checked.`))) return; const x = await POST(`/assets/counts/${id}/close`); toast(`${x.verified} verified, ${x.missing} missing`); reload(); };
  $('#kp').onclick = () => printHtml(`<div style="font-family:Arial;font-size:11px"><h2>${esc(state.company.name || '')} – ${esc(k.name)}</h2><p>Found ${k.seen} · missing ${k.missing} · not checked ${k.unchecked}</p>${$('#krep').innerHTML.replace(/<button[\s\S]*?<\/button>/g, '')}</div>`);
}
