// Branches / warehouses / vans, stock per location, transfers, branch profit, and the Business & modules settings tab
import { state, GET, POST, PUT, DEL, esc, $, $$, toast, err, can, money, qty, modal, confirmBox, formHtml, readForm, tableHtml, badge, page, d, dt, today, query, printHtml, getLocations } from './core.js';

const KINDS = [['shop', 'Shop'], ['branch', 'Branch'], ['warehouse', 'Warehouse / store room'], ['van', 'Van / vehicle'], ['farm', 'Farm store'], ['site', 'Site']];
const kindLabel = k => (KINDS.find(x => x[0] === k) || [k, k === 'transit' ? 'In transit' : k])[1];
const TR_STATUS = { draft: ['Draft', 'draft'], sent: ['On the way', 'partial'], received: ['Received', 'paid'], cancelled: ['Cancelled', 'cancelled'] };
const trBadge = s => badge((TR_STATUS[s] || [s])[0], (TR_STATUS[s] || [s, ''])[1]);

// ---------------------------------------------------------------- locations page
export async function locations(view) {
  const tab = query().tab || 'list';
  const tabs = [['list', 'Locations'], ['stock', 'Stock by location'], ['profit', 'Profit by branch']];
  view.innerHTML = page('Branches & warehouses', `<a class="btn" href="#/transfers">🔁 Transfers</a>${can('settings') ? '<button class="btn btn-primary" id="nl">＋ New location</button>' : ''}`,
    `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/locations?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="lb"></div>`);
  const lb = $('#lb');
  if ($('#nl')) $('#nl').onclick = () => editLocation(null, () => locations(view));
  if (tab === 'list') {
    state.locations = null;
    const rows = await GET('/locations?all=1');
    lb.innerHTML = `<div class="card">${tableHtml([
      { key: 'name', label: 'Name', html: 1, fmt: (v, r) => `<b>${esc(v)}</b>${r.is_default ? ' ' + badge('default', 'ok') : ''}${r.active ? '' : ' ' + badge('closed', 'closed')}` },
      { key: 'code', label: 'Code', fmt: v => v }, { key: 'kind', label: 'Type', fmt: kindLabel },
      { key: 'items', label: 'Products in stock', right: 1 }, { key: 'value', label: 'Stock value (cost)', right: 1, fmt: money },
      { key: 'tills', label: 'Tills', right: 1 }, { key: 'phone', label: 'Phone' }], rows, { rowAttr: r => `data-id="${r.id}"`, empty: 'No locations yet.' })}
      <p class="muted" style="margin-top:10px">Every product's stock is kept per location. Sales on a till take stock from the till's branch; purchases arrive at the branch on the order.
      <b>In transit</b> holds goods that were sent but not yet received. Click a location to change it.</p></div>`;
    $$('[data-id]', lb).forEach(tr => tr.onclick = () => { const l = rows.find(x => String(x.id) === tr.dataset.id); if (l.kind !== 'transit' && can('settings')) editLocation(l, () => locations(view)); });
  }
  if (tab === 'stock') return stockTab(lb);
  if (tab === 'profit') return profitTab(lb);
}

function editLocation(l, done) {
  const f = [{ key: 'name', label: 'Name', required: true }, { key: 'code', label: 'Code' },
    { key: 'kind', label: 'Type', type: 'select', options: KINDS.map(([v, label]) => ({ value: v, label })) }, { key: 'phone', label: 'Phone' },
    { key: 'address', label: 'Address', span: 2 }, { key: 'sellable', label: 'Sells to customers', type: 'checkbox', default: 1 },
    { key: 'is_default', label: 'Default location', type: 'checkbox' }, ...(l ? [{ key: 'active', label: 'Active', type: 'checkbox' }] : [])];
  modal({ title: l ? l.name : 'New location', size: 'lg', body: formHtml(f, l || { kind: 'branch', sellable: 1 }, { ctx: 'location' }), actions: [{ label: 'Cancel' },
    { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); if (l) await PUT('/locations/' + l.id, v); else await POST('/locations', v); state.locations = null; c(); toast('Saved'); done(); } }] });
}

async function stockTab(lb) {
  const q = query();
  const draw = async () => {
    const qs = new URLSearchParams(); const s = $('#sq') ? $('#sq').value : (q.q || ''); if (s) qs.set('q', s); if ($('#slow') && $('#slow').checked) qs.set('low', 1);
    const data = await GET('/locations/stock?' + qs);
    const locs = data.locations.filter(l => l.kind !== 'transit' || data.rows.some(r => Math.abs(r.at[l.id].qty) > 0.0001));
    $('#st').innerHTML = `<div class="table-wrap"><table class="grid"><thead><tr><th>Product</th><th>Unit</th>${locs.map(l => `<th class="r">${esc(l.name)}${l.kind === 'transit' ? '' : `<br>${can('inventory') ? `<a href="#" data-lv="${l.id}" class="muted" style="font-weight:400;font-size:11px">min levels</a>` : ''}`}</th>`).join('')}<th class="r">Total</th><th class="r">Value</th></tr></thead><tbody>
      ${data.rows.map(r => `<tr><td>${esc(r.name)}${r.sku ? ` <small class="muted">${esc(r.sku)}</small>` : ''}</td><td>${esc(r.uom || '')}</td>
        ${locs.map(l => { const a = r.at[l.id]; const low = r.low.includes(l.id); return `<td class="r ${low ? 'neg' : ''}" title="${a.min_qty != null ? 'Minimum ' + a.min_qty : ''}${a.bin ? ' · bin ' + esc(a.bin) : ''}">${a.qty ? qty(a.qty) : '<span class="muted">–</span>'}${low ? ' ⚠' : ''}</td>`; }).join('')}
        <td class="r"><b>${qty(r.stock_qty)}</b></td><td class="r">${money(r.stock_qty * Number(r.cost))}</td></tr>`).join('') || `<tr><td colspan="${locs.length + 4}" class="muted">No stocked products${$('#slow') && $('#slow').checked ? ' below their minimum' : ''}.</td></tr>`}
      </tbody></table></div>`;
    $$('[data-lv]', lb).forEach(a => a.onclick = e => { e.preventDefault(); levels(data.locations.find(l => String(l.id) === a.dataset.lv), data.rows, draw); });
  };
  lb.innerHTML = `<div class="card"><div class="row wrap" style="margin-bottom:10px"><input id="sq" placeholder="Search product, SKU or barcode" style="max-width:320px" value="${esc(q.q || '')}">
    <label class="row" style="gap:6px"><input type="checkbox" id="slow"> Only below minimum</label><span class="spacer"></span>
    ${can('inventory') ? '<a class="btn" href="#/transfer/new">＋ Transfer stock</a> <a class="btn" href="#/inventory">Stock count…</a>' : ''}</div><div id="st"><div class="muted">Loading…</div></div></div>`;
  let t; $('#sq').oninput = () => { clearTimeout(t); t = setTimeout(draw, 300); };
  $('#slow').onchange = draw;
  await draw();
}

function levels(loc, rows, done) {
  modal({ title: `Minimum levels – ${loc.name}`, size: 'lg', body: `<p class="muted">${esc('When stock here drops below the minimum it is shown as low (⚠). Leave blank for no minimum.')}</p>
    <div class="table-wrap" style="max-height:55vh"><table class="grid"><thead><tr><th>Product</th><th class="r">In stock</th><th class="r" style="width:110px">Minimum</th><th style="width:110px">Shelf / bin</th></tr></thead><tbody>
    ${rows.map(r => `<tr data-p="${r.id}"><td>${esc(r.name)}</td><td class="r">${qty(r.at[loc.id].qty)}</td><td><input type="number" step="any" class="r" data-k="min_qty" value="${r.at[loc.id].min_qty ?? ''}"></td><td><input data-k="bin" value="${esc(r.at[loc.id].bin || '')}"></td></tr>`).join('')}
    </tbody></table></div><small class="help-note">${esc('Minimum: re-order level for this branch. Shelf / bin: where it is kept here, printed on transfer notes.')}</small>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => {
      const lines = $$('[data-p]', r).map(tr => ({ product_id: Number(tr.dataset.p), min_qty: tr.querySelector('[data-k=min_qty]').value, bin: tr.querySelector('[data-k=bin]').value }));
      await PUT(`/locations/${loc.id}/levels`, { lines }); c(); toast('Levels saved'); done();
    } }] });
}

async function profitTab(lb) {
  const q = query();
  const to = q.to || today(), from = q.from || to.slice(0, 8) + '01';
  const r = await GET(`/reports/branches?from=${from}&to=${to}`);
  lb.innerHTML = `<div class="card"><div class="row wrap" style="margin-bottom:10px"><label>From <input type="date" id="pf" value="${from}"></label><label>To <input type="date" id="pt" value="${to}"></label><button class="btn" id="pgo">Show</button></div>
    ${tableHtml([{ key: 'name', label: 'Branch' }, { key: 'income', label: 'Sales (excl. VAT)', right: 1, fmt: money }, { key: 'cogs', label: 'Cost of sales & losses', right: 1, fmt: money },
      { key: 'gross', label: 'Gross profit', right: 1, fmt: money }, { key: 'expenses', label: 'Expenses', right: 1, fmt: money },
      { key: 'profit', label: 'Net profit', right: 1, html: 1, fmt: v => `<b class="${v < 0 ? 'neg' : ''}">${money(v)}</b>` },
      { key: 'location_id', label: '', html: 1, fmt: v => v ? `<a href="#/reports?tab=pl&location_id=${v}&from=${from}&to=${to}">P&amp;L</a>` : '' }],
      [...r.rows, { name: 'Total', ...r.total, location_id: null }])}
    <p class="muted" style="margin-top:10px">Sales, cost of sales and stock losses are booked to the branch of the till, invoice, purchase or transfer. Salaries, rent and other costs entered without a branch show under "Not linked to a branch".</p></div>`;
  $('#pgo').onclick = () => { location.hash = `#/locations?tab=profit&from=${$('#pf').value}&to=${$('#pt').value}`; };
}

// ---------------------------------------------------------------- transfers
export async function transfers(view) {
  const status = query().status || 'open';
  const rows = await GET('/transfers?status=' + (status === 'open' ? 'all' : status));
  const list = status === 'open' ? rows.filter(r => ['draft', 'sent'].includes(r.status)) : rows;
  const tabs = [['open', 'Open'], ['draft', 'Drafts'], ['sent', 'On the way'], ['received', 'Received'], ['all', 'All']];
  view.innerHTML = page('Stock transfers', `<a class="btn" href="#/locations?tab=stock">Stock by location</a>${can('inventory') ? '<a class="btn btn-primary" href="#/transfer/new">＋ New transfer</a>' : ''}`,
    `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/transfers?status=${k}" class="${k === status ? 'active' : ''}">${l}</a>`).join('')}</div>
    <div class="card">${tableHtml([{ key: 'number', label: 'Number', fmt: (v, r) => v || `Draft #${r.id}` }, { key: 'created_at', label: 'Date', fmt: d },
      { key: 'from_name', label: 'From' }, { key: 'to_name', label: 'To' }, { key: 'line_count', label: 'Lines', right: 1 }, { key: 'value', label: 'Value (cost)', right: 1, fmt: money },
      { key: 'status', label: 'Status', html: 1, fmt: trBadge }, { key: 'user_name', label: 'By' }, { key: 'received_by_name', label: 'Received by' }], list,
      { rowAttr: r => `data-id="${r.id}"`, empty: 'No transfers here. Use “New transfer” to move stock between branches, warehouses and vans.' })}</div>`);
  $$('[data-id]').forEach(tr => tr.onclick = () => { location.hash = '#/transfer/' + tr.dataset.id; });
}

export async function transferForm(view, [idq]) {
  const id = (idq || '').split('?')[0];
  const isNew = id === 'new';
  const [locs, products] = await Promise.all([getLocations(), GET('/products').then(ps => ps.filter(p => p.type === 'stock'))]);
  const real = locs.filter(l => l.kind !== 'transit' && l.active);
  if (real.length < 2) {
    view.innerHTML = page('New transfer', '', `<div class="card"><div class="empty">You need at least two locations to transfer stock.<br><br>${can('settings') ? '<a class="btn btn-primary" href="#/locations">Add a branch or warehouse</a>' : 'Ask an admin to add a branch or warehouse.'}</div></div>`);
    return;
  }
  const def = real.find(l => l.is_default) || real[0];
  const t = isNew ? { from_location_id: (state.user.location_id && real.some(l => l.id === state.user.location_id)) ? state.user.location_id : def.id, to_location_id: (real.find(l => l.id !== def.id) || {}).id, status: 'draft', lines: [] }
    : await GET('/transfers/' + id);
  const editable = t.status === 'draft' && can('inventory');
  const receiving = t.status === 'sent' && can('inventory');
  const lines = (t.lines || []).map(l => ({ ...l, qty: Number(l.qty), qty_received: l.qty_received != null ? Number(l.qty_received) : Number(l.qty) }));
  const pmap = new Map(products.map(p => [p.id, p]));
  let avail = new Map(lines.map(l => [l.product_id, Number(l.available)]));
  const acts = [];
  if (!isNew) acts.push('<button class="btn" id="tPrint">🖨 Transfer note</button>');
  if (editable) acts.push('<button class="btn" id="tSave">Save draft</button>', '<button class="btn btn-primary" id="tSend">🚚 Send</button>');
  if (receiving) acts.push('<button class="btn btn-ok" id="tRecv">✓ Receive</button>');
  if (!isNew && ['draft', 'sent'].includes(t.status) && can('inventory')) acts.push('<button class="btn btn-danger" id="tCancel">Cancel</button>');
  const f = [{ key: 'from_location_id', label: 'From', type: 'select', numeric: true, required: true, options: real.map(l => ({ value: l.id, label: l.name })) },
    { key: 'to_location_id', label: 'To', type: 'select', numeric: true, required: true, options: real.map(l => ({ value: l.id, label: l.name })) },
    { key: 'notes', label: 'Notes (driver, vehicle, reason)', span: 2 }];
  view.innerHTML = page(isNew ? 'New transfer' : (t.number || `Draft transfer #${t.id}`), acts.join(''), `
    <div class="card"><div class="row" style="margin-bottom:10px">${isNew ? '' : trBadge(t.status)}
      <span class="muted">${t.sent_at ? 'Sent ' + esc(dt(t.sent_at)) : ''}${t.received_at ? ' · received ' + esc(dt(t.received_at)) + (t.received_by_name ? ' by ' + esc(t.received_by_name) : '') : ''}</span></div>
      <div id="th">${formHtml(f, t, { ctx: 'transfer' })}</div>
      ${editable ? `<label class="row" style="gap:6px;margin-top:6px"><input type="checkbox" id="tNeg"> Allow negative stock at the source</label><small class="help-note">${esc('Send even if the system thinks there is not enough stock at the source. The source goes negative until it is corrected.')}</small>` : ''}
      ${receiving ? `<div class="help-note" style="display:block;margin-top:10px">Count what arrived and change “Received” where it differs. Anything missing is written off as a transfer shortage.</div>` : ''}
      <h3 style="margin:16px 0 8px">Products</h3><div id="tl"></div></div>`);
  if (!editable) $$('#th input, #th select').forEach(i => i.disabled = true);
  const loadAvail = async () => {
    const from = Number($('#th [name=from_location_id]').value);
    const st = await GET('/locations/stock');
    avail = new Map(st.rows.map(r => [r.id, r.at[from] ? r.at[from].qty : 0]));
  };
  const draw = () => {
    $('#tl').innerHTML = `<div class="table-wrap"><table class="grid lines"><thead><tr><th style="width:40%">Product</th><th class="r">At source</th><th class="r" style="width:110px">Qty sent</th>${t.status === 'draft' ? '' : '<th class="r" style="width:110px">Received</th>'}<th class="r">Value (cost)</th>${editable ? '<th style="width:32px"></th>' : ''}</tr></thead><tbody>
      ${lines.map((l, i) => { const p = pmap.get(Number(l.product_id)) || {}; const a = avail.get(Number(l.product_id)); const short = a != null && a < l.qty && t.status === 'draft';
        return `<tr data-row="${i}"><td>${editable ? `<select data-i="${i}" data-k="product_id"><option value="">— choose —</option>${products.map(x => `<option value="${x.id}" ${x.id === Number(l.product_id) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : esc(l.product_name || p.name || '')}</td>
          <td class="r ${short ? 'neg' : ''}">${t.status === 'draft' && a != null ? qty(a) + ' ' + esc(p.uom || '') : ''}</td>
          <td class="r">${editable ? `<input data-i="${i}" data-k="qty" type="number" step="any" class="r" value="${l.qty || ''}">` : qty(l.qty)}</td>
          ${t.status === 'draft' ? '' : `<td class="r">${receiving ? `<input data-i="${i}" data-k="qty_received" type="number" step="any" min="0" class="r" value="${l.qty_received}">` : `${qty(l.qty_received)}${Number(l.qty_received) < Number(l.qty) ? ' <span class="neg">(short ' + qty(l.qty - l.qty_received) + ')</span>' : ''}`}</td>`}
          <td class="r">${money(Number(l.qty || 0) * Number(l.unit_cost ?? p.cost ?? 0))}</td>${editable ? `<td><button class="icon-btn" data-del="${i}">✕</button></td>` : ''}</tr>`; }).join('')}
      </tbody></table></div>${editable ? '<button class="btn btn-sm" id="tAdd" style="margin-top:8px">＋ Add product</button>' : ''}`;
    $$('[data-k]', $('#tl')).forEach(inp => inp.onchange = inp.oninput = () => {
      const l = lines[Number(inp.dataset.i)]; const k = inp.dataset.k;
      l[k] = k === 'product_id' ? Number(inp.value) || null : Number(inp.value);
      if (k === 'product_id' && inp.type !== 'number') draw();
    });
    $$('[data-del]', $('#tl')).forEach(b => b.onclick = () => { lines.splice(Number(b.dataset.del), 1); draw(); });
    if ($('#tAdd')) $('#tAdd').onclick = () => { lines.push({ product_id: null, qty: 1 }); draw(); const sel = $$('#tl select'); if (sel.length) sel[sel.length - 1].focus(); };
  };
  if (editable) { await loadAvail(); $('#th [name=from_location_id]').onchange = async () => { await loadAvail(); draw(); }; if (!lines.length) lines.push({ product_id: null, qty: 1 }); }
  draw();
  const body = () => ({ ...readForm($('#th'), f), lines: lines.filter(l => l.product_id).map(l => ({ product_id: l.product_id, qty: l.qty })) });
  const save = async () => isNew ? (await POST('/transfers', body())).id : (await PUT('/transfers/' + t.id, body())).id;
  if ($('#tSave')) $('#tSave').onclick = async () => { try { const nid = await save(); toast('Draft saved'); if (isNew) location.hash = '#/transfer/' + nid; else transferForm(view, [String(nid)]); } catch (e) { err(e); } };
  if ($('#tSend')) $('#tSend').onclick = async () => {
    try {
      const b = body(); if (!b.lines.length) throw new Error('Add at least one product');
      const from = real.find(l => l.id === b.from_location_id), to = real.find(l => l.id === b.to_location_id);
      if (!(await confirmBox(`Send ${b.lines.length} product line(s) from ${from.name} to ${to.name}? The stock leaves ${from.name} now and arrives when ${to.name} receives it.`, { okLabel: 'Send' }))) return;
      const nid = await save();
      const r = await POST(`/transfers/${nid}/send`, { allow_negative: $('#tNeg') && $('#tNeg').checked });
      toast(`${r.number} sent – on the way to ${to.name}`); if (isNew) location.hash = '#/transfer/' + nid; else transferForm(view, [String(nid)]);
    } catch (e) { err(e); }
  };
  if ($('#tRecv')) $('#tRecv').onclick = async () => {
    try {
      const short = lines.filter(l => l.qty_received < l.qty);
      if (short.length && !(await confirmBox(`${short.length} product(s) arrived short. The missing stock will be written off as a transfer shortage. Continue?`, { okLabel: 'Receive', danger: true }))) return;
      const r = await POST(`/transfers/${t.id}/receive`, { lines: lines.map(l => ({ line_id: l.id, qty_received: l.qty_received })) });
      toast(r.short_value ? `Received – shortage of ${money(r.short_value)} written off` : 'Received in full'); transferForm(view, [String(t.id)]);
    } catch (e) { err(e); }
  };
  if ($('#tCancel')) $('#tCancel').onclick = async () => {
    if (!(await confirmBox(t.status === 'sent' ? 'Cancel this transfer? The goods go back into stock at the sending location.' : 'Cancel this draft transfer?', { danger: true, okLabel: 'Cancel transfer' }))) return;
    try { await POST(`/transfers/${t.id}/cancel`); toast('Transfer cancelled'); transferForm(view, [String(t.id)]); } catch (e) { err(e); }
  };
  if ($('#tPrint')) $('#tPrint').onclick = () => printHtml(transferNoteHtml(t, locs));
}

function transferNoteHtml(t, locs) {
  const c = state.company || {};
  const L = id => locs.find(l => l.id === id) || {};
  const from = L(t.from_location_id), to = L(t.to_location_id);
  return `<div style="font-family:Arial,sans-serif;font-size:12px;max-width:760px;margin:auto">
    <h2 style="margin:0">${esc(c.name || '')}</h2><div>${esc(c.address || '')}${c.phone ? ' · ' + esc(c.phone) : ''}</div>
    <h1 style="font-size:20px;margin:16px 0 4px">Stock transfer ${esc(t.number || 'DRAFT')}</h1><div>${esc(d(t.sent_at || t.created_at))}</div>
    <table style="width:100%;margin:12px 0;border-collapse:collapse"><tr><td style="vertical-align:top;width:50%"><b>From</b><br>${esc(from.name || t.from_name || '')}<br>${esc(from.address || '')}<br>${esc(from.phone || '')}</td>
      <td style="vertical-align:top"><b>To</b><br>${esc(to.name || t.to_name || '')}<br>${esc(to.address || '')}<br>${esc(to.phone || '')}</td></tr></table>
    ${t.notes ? `<p>${esc(t.notes)}</p>` : ''}
    <table style="width:100%;border-collapse:collapse" border="1" cellpadding="5"><thead><tr><th align="left">Product</th><th align="left">SKU</th><th align="right">Qty sent</th><th align="right">Qty received</th></tr></thead><tbody>
    ${(t.lines || []).map(l => `<tr><td>${esc(l.product_name)}</td><td>${esc(l.sku || '')}</td><td align="right">${qty(l.qty)} ${esc(l.uom || '')}</td><td align="right">${l.qty_received != null ? qty(l.qty_received) : ''}</td></tr>`).join('')}</tbody></table>
    <table style="width:100%;margin-top:40px"><tr><td>Sent by: ______________________</td><td>Driver: ______________________</td><td>Received by: ______________________</td></tr></table></div>`;
}

// ---------------------------------------------------------------- Settings → Business & modules
export async function businessTab(sb) {
  const b = await GET('/business');
  let types = new Set(b.types), mods = new Set(b.modules);
  const groups = [...new Set(b.all_modules.map(m => m.group))];
  const draw = () => {
    sb.innerHTML = `<div class="card"><h3>What kind of business is this?</h3>
      <p class="muted" style="margin-top:0">Tick every kind you run – for example a lodge with a bar and a restaurant. Ticking a type switches on the modules it normally needs; you can fine-tune them below.</p>
      <div class="biz-types">${b.all_types.map(t => `<label class="biz-type ${types.has(t.key) ? 'on' : ''}"><input type="checkbox" data-type="${t.key}" ${types.has(t.key) ? 'checked' : ''}>
        <span class="bt-ico">${t.icon}</span><span><b>${esc(t.name)}</b><small>${esc(t.desc)}</small></span></label>`).join('')}</div></div>
      <div class="card" style="margin-top:14px"><h3>Modules</h3>
      <p class="muted" style="margin-top:0">Switched-off modules disappear from the home screen and menus (nothing is deleted – switch them on again any time). Products, contacts, invoicing, accounting and reports are always on.</p>
      ${groups.map(g => `<h4 style="margin:14px 0 6px">${esc(g)}</h4><div class="mod-grid">${b.all_modules.filter(m => m.group === g).map(m => `
        <label class="mod ${m.coming ? 'coming' : ''} ${mods.has(m.key) && !m.coming ? 'on' : ''}"><input type="checkbox" data-mod="${m.key}" ${mods.has(m.key) && !m.coming ? 'checked' : ''} ${m.coming ? 'disabled' : ''}>
          <span class="bt-ico">${m.icon}</span><span><b>${esc(m.name)}</b>${m.coming ? ' ' + badge('coming soon', 'draft') : ''}<small>${esc(m.desc)}</small></span></label>`).join('')}</div>`).join('')}
      <div class="row" style="margin-top:14px"><span class="spacer"></span><button class="btn btn-primary" id="bsave">Save</button></div></div>`;
    $$('[data-type]', sb).forEach(i => i.onchange = () => {
      if (i.checked) { types.add(i.dataset.type); const T = b.all_types.find(x => x.key === i.dataset.type); T.modules.forEach(m => mods.add(m)); }
      else types.delete(i.dataset.type);
      draw();
    });
    $$('[data-mod]', sb).forEach(i => i.onchange = () => { if (i.checked) mods.add(i.dataset.mod); else mods.delete(i.dataset.mod); i.closest('.mod').classList.toggle('on', i.checked); });
    $('#bsave').onclick = async () => {
      try {
        if (!types.size) throw new Error('Tick at least one kind of business');
        const r = await PUT('/business', { types: [...types], modules: [...mods] });
        state.biz = r; toast('Saved – the home screen and setup guide now follow your choice');
        location.hash = '#/settings?tab=business&t=' + Date.now();
      } catch (e) { err(e); }
    };
  };
  draw();
}
