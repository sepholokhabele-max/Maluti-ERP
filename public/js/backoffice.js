import { multiLocation, locationOptions } from './core.js';
import { state, GET, POST, PUT, DEL, esc, $, $$, toast, err, can, money, qty, modal, confirmBox, formHtml, readForm, tableHtml, badge, page, dt, d, today, debounce, query, printHtml } from './core.js';
import { receiptHtml } from './pos.js';

/** Generic list + modal form for simple records */
export function crudSection(container, { endpoint, title, columns, fields, help, defaults = {}, canEdit = true, canDelete = true, transform, newLabel = 'New', listQuery = '' }) {
  const load = async () => {
    const rows = await GET(endpoint + (listQuery ? (endpoint.includes('?') ? '&' : '?') + listQuery : ''));
    container.innerHTML = `<div class="row" style="margin-bottom:10px"><h3 style="flex:1">${esc(title || '')}</h3>${canEdit ? `<button class="btn btn-primary" data-new>＋ ${esc(newLabel)}</button>` : ''}</div>
      ${tableHtml(columns, rows, { rowAttr: r => canEdit ? `data-id="${r.id}"` : '' })}`;
    const edit = row => {
      const f = typeof fields === 'function' ? fields(row) : fields;
      const actions = [{ label: 'Cancel' }];
      if (row && canDelete) actions.push({ label: 'Delete', cls: 'btn-danger', onClick: async c => { if (await confirmBox('Delete this record?', { danger: true, okLabel: 'Delete' })) { await DEL(`${endpoint.split('?')[0]}/${row.id}`); c(); toast('Deleted'); load(); } } });
      actions.push({ label: 'Save', cls: 'btn-primary', onClick: async (c, r) => {
        let data = readForm(r, f); if (transform) data = transform(data, row);
        if (row) await PUT(`${endpoint.split('?')[0]}/${row.id}`, data); else await POST(endpoint.split('?')[0], { ...defaults, ...data });
        c(); toast('Saved'); load();
      } });
      modal({ title: row ? `Edit ${title || ''}` : `${newLabel}`, body: formHtml(f, row || defaults, { ctx: help }), actions, size: 'lg' });
    };
    const nb = container.querySelector('[data-new]'); if (nb) nb.onclick = () => edit(null);
    $$('[data-id]', container).forEach(tr => tr.onclick = () => edit(rows.find(r => String(r.id) === tr.dataset.id)));
  };
  load().catch(err);
  return load;
}

// ---------------------------------------------------------------- dashboard
export async function dashboard(view) {
  const x = await GET('/dashboard');
  const t = x.today.sales;
  const max = Math.max(1, ...x.week.map(w => Number(w.total)));
  view.innerHTML = page('Dashboard', `<a class="btn" href="#/reports">Reports</a><button class="btn btn-primary" id="eod">✉ Email today's EOD report</button>`, `
    <div class="cols cols-4">
      <div class="kpi"><div class="label">Sales today</div><div class="value">${money(t.total)}</div><div class="hint">${t.orders} orders · avg ${money(t.orders ? t.total / t.orders : 0)}</div></div>
      <div class="kpi"><div class="label">Gross profit today</div><div class="value">${money(t.gross_profit)}</div><div class="hint">VAT ${money(t.tax)}</div></div>
      <div class="kpi"><div class="label">Receivables</div><div class="value">${money(x.receivables)}</div><div class="hint">Invoices & account sales owed to us</div></div>
      <div class="kpi"><div class="label">Payables</div><div class="value">${money(x.payables)}</div><div class="hint">Unpaid supplier bills</div></div>
    </div>
    ${(x.recon_pending || (x.crm && (x.crm.overdue || x.crm.today)) || (x.expiry && (x.expiry.expired || x.expiry.expiring))) ? `<div class="alerts">
      ${x.expiry && x.expiry.expired ? `<a class="alert-pill bad" href="#/butchery?tab=batches&status=expired">🥩 ${x.expiry.expired} batch(es) past sell-by date</a>` : ''}
      ${x.expiry && x.expiry.expiring ? `<a class="alert-pill" href="#/butchery?tab=batches&status=expiring">⏳ ${x.expiry.expiring} batch(es) expiring soon</a>` : ''}
      ${x.recon_pending ? `<a class="alert-pill bad" href="#/recon">⚖️ ${x.recon_pending} day(s) not reconciled</a>` : ''}
      ${x.crm && x.crm.overdue ? `<a class="alert-pill bad" href="#/crm?tab=activities">⏰ ${x.crm.overdue} overdue follow-up(s)</a>` : ''}
      ${x.crm && x.crm.today ? `<a class="alert-pill" href="#/crm?tab=activities">📅 ${x.crm.today} follow-up(s) due today</a>` : ''}</div>` : ''}
    <div class="cols cols-2" style="margin-top:14px">
      <div class="card"><h3>Sales — last 14 days</h3><div class="bars">${x.week.map(w => `<div class="b" style="height:${Math.max(2, Number(w.total) / max * 100)}%" title="${w.d}: ${money(w.total)} (${w.orders} orders)"><span>${w.d.slice(5)}</span></div>`).join('') || '<div class="muted">No sales yet</div>'}</div><div style="height:18px"></div></div>
      <div class="card"><h3>Payments today</h3><ul class="list-plain">${x.today.payments.map(p => `<li><span>${esc(p.method)} <span class="muted">(${p.count})</span></span><b>${money(p.amount)}</b></li>`).join('') || '<li class="muted">No payments yet</li>'}</ul>
        <h3 style="margin-top:16px">Open cashier sessions</h3><ul class="list-plain">${x.openSessions.map(s => `<li><span>${esc(s.terminal)} · ${esc(s.user)}</span><span class="muted">since ${dt(s.opened_at)}</span></li>`).join('') || '<li class="muted">None</li>'}</ul></div>
      <div class="card"><h3>Top products today</h3>${tableHtml([{ key: 'name', label: 'Product' }, { key: 'qty', label: 'Qty', right: 1, fmt: qty }, { key: 'total', label: 'Total', right: 1, fmt: money }], x.today.topProducts.slice(0, 8))}</div>
      <div class="card"><h3>Low stock</h3>${tableHtml([{ key: 'name', label: 'Product' }, { key: 'stock_qty', label: 'On hand', right: 1, fmt: qty }, { key: 'reorder_level', label: 'Reorder at', right: 1, fmt: qty }], x.today.lowStock.slice(0, 10), { empty: 'All stock levels OK' })}</div>
    </div>`);
  $('#eod').onclick = async () => { try { const r = await POST('/email/eod', {}); toast('Report sent to ' + r.recipients.join(', ')); } catch (e) { err(e); } };
}

// ---------------------------------------------------------------- products
export async function products(view) {
  const [cats, taxes] = await Promise.all([GET('/categories'), GET('/taxes')]);
  const q = query();
  view.innerHTML = page('Products', `<input id="pq" placeholder="Search name, SKU or barcode" value="${esc(q.q || '')}">
    <select id="pc"><option value="">All categories</option>${cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
    <button class="btn" id="cats">Categories</button><button class="btn" id="imp">Import CSV</button><button class="btn btn-primary" id="np">＋ New product</button>`, '<div id="pl"></div>');
  let bottles = [], species = [];
  const fields = p => [
    { key: 'name', label: 'Name', required: true, span: 2 },
    { key: 'type', label: 'Type', type: 'select', options: [{ value: 'stock', label: 'Stocked item (tracked)' }, { value: 'consumable', label: 'Made to order (meals, cocktails)' }, { value: 'service', label: 'Service' }] },
    { key: 'category_id', label: 'Category', type: 'select', numeric: true, options: [{ value: '', label: '—' }, ...cats.map(c => ({ value: c.id, label: c.name }))] },
    { key: 'price', label: 'Sale price (incl. VAT)', type: 'number', step: '0.01' },
    { key: 'cost', label: p && p.type === 'stock' && Number(p.stock_qty) ? 'Cost (auto, moving average)' : 'Cost price', type: 'number', step: '0.0001' },
    { key: 'tax_id', label: 'Tax', type: 'select', numeric: true, options: taxes.map(t => ({ value: t.id, label: t.name })) },
    { key: 'uom', label: 'Unit', default: 'Unit' },
    { key: 'sku', label: 'SKU / internal code' }, { key: 'barcode', label: 'Barcode' },
    { key: 'reorder_level', label: 'Reorder level', type: 'number' },
    ...(p ? [] : [{ key: 'opening_qty', label: 'Opening stock qty', type: 'number' }]),
    ...(state.butchery && state.butchery.enabled ? [
      { key: 'sold_by_weight', label: 'Sold by weight (till asks for kg / reads the scale)', type: 'checkbox', span: 2 },
      { key: 'plu', label: 'Scale PLU / item code (for scale labels)' }, { key: 'shelf_life_days', label: 'Shelf life (days) – sets sell-by date', type: 'number', nullable: true },
      { key: 'track_batches', label: 'Track batches & expiry dates', type: 'checkbox' },
      { key: 'is_carcass', label: 'Carcass / primal (each one received is traced kg by kg)', type: 'checkbox' },
      { key: 'species', label: 'Animal', type: 'select', options: [{ value: '', label: '— not meat / mixed —' }, ...species.map(x => ({ value: x.key, label: `${x.icon} ${x.name}` }))] }] : []),
    { key: '_bar', type: 'heading', label: 'Bar – spirits & wine', help: 'Fill in for bottles (sold or counted by weight), or for a tot/glass poured from a bottle.' },
    { key: 'bottle_ml', label: 'Bottle size (ml)', type: 'number', nullable: true, placeholder: 'e.g. 750' },
    { key: 'bottle_empty_g', label: 'Empty bottle weight (g, with pourer)', type: 'number', nullable: true },
    { key: 'bottle_full_g', label: 'Full bottle weight (g)', type: 'number', nullable: true, help: 'Optional – sets the liquid density' },
    { key: 'pour_from_id', label: 'This is a measure poured from bottle', type: 'select', numeric: true, options: [{ value: '', label: '— not a measure —' }, ...bottles.filter(b => !p || b.id !== p.id).map(b => ({ value: b.id, label: `${b.name} (${Number(b.bottle_ml)} ml)` }))] },
    { key: 'pour_ml', label: 'Measure size (ml)', type: 'number', nullable: true, placeholder: '25 tot · 50 double · 175 wine glass' },
    { key: 'pos_visible', label: 'Show in POS', type: 'checkbox', default: 1 }, { key: 'active', label: 'Active', type: 'checkbox', default: 1 }
  ];
  const edit = async p => {
    const full = p ? await GET('/products/' + p.id) : null;
    bottles = (await GET('/products')).filter(x => Number(x.bottle_ml) > 0);
    if (state.butchery && state.butchery.enabled && !species.length) species = await GET('/butchery/species').catch(() => []);
    const f = fields(full);
    modal({ title: p ? p.name : 'New product', wide: true, body: formHtml(f, full || { type: 'stock', tax_id: taxes[0] && taxes[0].id, pos_visible: 1, active: 1, uom: 'Unit' }, { ctx: 'product' }) +
      (full && full.moves.length ? `<h4 style="margin:16px 0 8px">Recent stock moves</h4>${tableHtml([{ key: 'created_at', label: 'Date', fmt: dt }, { key: 'move_type', label: 'Type' }, { key: 'reference', label: 'Ref' }, { key: 'qty', label: 'Qty', right: 1, fmt: qty }, { key: 'unit_cost', label: 'Unit cost', right: 1, fmt: money }, { key: 'user_name', label: 'By' }], full.moves.slice(0, 15))}` : ''),
      actions: [{ label: 'Cancel' }, ...(p ? [{ label: 'Archive', cls: 'btn-danger', onClick: async c => { await DEL('/products/' + p.id); c(); load(); } }] : []),
        { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const data = readForm(r, f); if (p) await PUT('/products/' + p.id, data); else await POST('/products', data); c(); toast('Saved'); load(); } }] });
  };
  const load = async () => {
    const rows = await GET(`/products?q=${encodeURIComponent($('#pq').value)}&category_id=${$('#pc').value}`);
    $('#pl').innerHTML = tableHtml([
      { key: 'name', label: 'Name' }, { key: 'sku', label: 'SKU' }, { key: 'barcode', label: 'Barcode' }, { key: 'category_name', label: 'Category' },
      { key: 'type', label: 'Type' }, { key: 'price', label: 'Price', right: 1, fmt: money }, { key: 'cost', label: 'Cost', right: 1, fmt: money },
      { key: 'stock_qty', label: 'On hand', right: 1, html: 1, fmt: (v, r) => r.type !== 'stock' ? '<span class="muted">—</span>' : Number(v) <= Number(r.reorder_level) ? `<b style="color:var(--bad)">${qty(v)}</b>` : qty(v) }
    ], rows, { rowAttr: r => `data-id="${r.id}"` });
    $$('[data-id]', $('#pl')).forEach(tr => tr.onclick = () => edit(rows.find(r => String(r.id) === tr.dataset.id)));
  };
  $('#pq').oninput = debounce(load); $('#pc').onchange = load; $('#np').onclick = () => edit(null);
  $('#cats').onclick = () => {
    modal({ title: 'Categories', wide: true, body: '<div id="cc"></div>', onOpen: r => crudSection(r.querySelector('#cc'), { help: 'category', endpoint: '/categories', title: 'Category', newLabel: 'New category',
      columns: [{ key: 'name', label: 'Name' }, { key: 'station', label: 'Prints to' }, { key: 'color', label: 'Colour', html: 1, fmt: v => `<span style="display:inline-block;width:18px;height:18px;border-radius:4px;background:${esc(v)}"></span>` }],
      fields: [{ key: 'name', label: 'Name', required: true }, { key: 'station', label: 'Kitchen/bar station', type: 'select', options: [{ value: 'none', label: 'None (retail)' }, { value: 'kitchen', label: 'Kitchen' }, { value: 'bar', label: 'Bar' }] },
        { key: 'color', label: 'Colour', type: 'color', default: '#4f46e5' }, { key: 'sort_order', label: 'Sort order', type: 'number' }] }) , onClose: () => products(view) });
  };
  $('#imp').onclick = () => importCsv(cats, taxes, load);
  load();
}

function importCsv(cats, taxes, done) {
  modal({ title: 'Import products from CSV', size: 'lg', body: `<p class="muted">Columns (header row required): <code>name, sku, barcode, category, type, price, cost, qty, reorder_level</code>. Categories are created if missing. Type is stock / consumable / service.</p>
    <input type="file" id="csv" accept=".csv,text/csv"><div id="prev" style="margin-top:10px"></div>`,
    actions: [{ label: 'Cancel' }, { label: 'Import', cls: 'btn-primary', onClick: async (c, r) => {
      const file = r.querySelector('#csv').files[0]; if (!file) throw new Error('Choose a file');
      const rows = parseCsv(await file.text());
      const catMap = new Map(cats.map(x => [x.name.toLowerCase(), x.id]));
      let n = 0;
      for (const row of rows) {
        if (!row.name) continue;
        let cid = null;
        if (row.category) { cid = catMap.get(row.category.toLowerCase()); if (!cid) { const nc = await POST('/categories', { name: row.category }); cid = nc.id; catMap.set(row.category.toLowerCase(), cid); } }
        await POST('/products', { name: row.name, sku: row.sku || null, barcode: row.barcode || null, category_id: cid, type: row.type || 'stock', price: Number(row.price || 0), cost: Number(row.cost || 0), opening_qty: Number(row.qty || 0), reorder_level: Number(row.reorder_level || 0), tax_id: taxes[0] && taxes[0].id });
        n++;
      }
      c(); toast(`Imported ${n} products`); done();
    } }] });
}
function parseCsv(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(Boolean);
  const split = l => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(s => s.trim()); };
  const head = split(lines[0]).map(h => h.toLowerCase());
  return lines.slice(1).map(l => Object.fromEntries(split(l).map((v, i) => [head[i], v])));
}

// ---------------------------------------------------------------- inventory
export async function inventory(view) {
  const q = query(); const tab = q.tab || 'stock';
  const multi = await multiLocation();
  const lopts = multi ? await locationOptions('All locations') : [];
  const loc = multi ? (q.loc || '') : '';
  const lq = loc ? `location_id=${loc}` : '';
  const locSel = multi ? `<select id="invLoc" title="Branch / warehouse">${lopts.map(o => `<option value="${o.value}" ${String(o.value) === String(loc) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>` : '';
  const tl = t => `#/inventory?tab=${t}${loc ? '&loc=' + loc : ''}`;
  view.innerHTML = page('Inventory', `${locSel}${multi ? '<a class="btn" href="#/transfers">🔁 Transfers</a>' : ''}<button class="btn" id="count">Stock count / adjust</button><a class="btn btn-primary" href="#/purchase/new">＋ Purchase order</a>`, `
    <div class="tabs"><a href="${tl('stock')}" class="${tab === 'stock' ? 'active' : ''}">Stock on hand</a><a href="${tl('low')}" class="${tab === 'low' ? 'active' : ''}">Reorder list</a><a href="${tl('moves')}" class="${tab === 'moves' ? 'active' : ''}">Stock moves</a>${multi ? '<a href="#/locations?tab=stock">By location</a>' : ''}</div><div id="ib"></div>`);
  if ($('#invLoc')) $('#invLoc').onchange = () => { location.hash = `#/inventory?tab=${tab}${$('#invLoc').value ? '&loc=' + $('#invLoc').value : ''}`; };
  const ib = $('#ib');
  if (tab === 'moves') {
    const rows = await GET('/inventory/moves?' + lq);
    ib.innerHTML = tableHtml([{ key: 'created_at', label: 'Date', fmt: dt }, { key: 'product', label: 'Product' }, { key: 'move_type', label: 'Type', html: 1, fmt: v => badge(v, 'posted') }, ...(multi ? [{ key: 'location_name', label: 'Location' }] : []), { key: 'reference', label: 'Reference' }, { key: 'qty', label: 'Qty', right: 1, fmt: qty }, { key: 'unit_cost', label: 'Unit cost', right: 1, fmt: money }, { key: 'user_name', label: 'By' }], rows);
  } else {
    const v = await GET('/inventory/valuation?' + lq);
    const rows = tab === 'low' ? v.rows.filter(r => Number(r.stock_qty) <= Number(r.reorder_level)) : v.rows;
    ib.innerHTML = `${tab === 'stock' ? `<div class="kpi" style="max-width:300px;margin-bottom:12px"><div class="label">Inventory value (at cost)</div><div class="value">${money(v.total)}</div></div>` : ''}
      ${tableHtml([{ key: 'name', label: 'Product' }, { key: 'sku', label: 'SKU' }, { key: 'category', label: 'Category' }, { key: 'stock_qty', label: 'On hand', right: 1, fmt: qty }, { key: 'reorder_level', label: 'Reorder at', right: 1, fmt: qty }, { key: 'cost', label: 'Avg cost', right: 1, fmt: money }, { key: 'value', label: 'Value', right: 1, fmt: money }], rows, { empty: 'Nothing to reorder' })}`;
  }
  $('#count').onclick = async () => {
    // with branches, a count is always for one location (the chosen one, else the default)
    const cl = multi ? (loc || (lopts[1] && lopts.find(o => /\(default\)$/.test(o.label)) || lopts[1] || {}).value) : '';
    const v = await GET('/inventory/valuation' + (cl ? `?location_id=${cl}` : ''));
    const clName = multi ? (lopts.find(o => String(o.value) === String(cl)) || {}).label : '';
    modal({ title: 'Stock count' + (clName ? ' – ' + clName : ''), wide: true, body: `<p class="muted">Enter the counted quantity${clName ? ' at <b>' + esc(clName) + '</b> (choose another location at the top of the Inventory page)' : ''}. Only changed rows are adjusted; differences are posted to Inventory Adjustments.</p>
      <input id="cf" placeholder="Filter…" style="margin-bottom:8px"><div class="table-wrap" style="max-height:55vh"><table class="grid lines"><thead><tr><th>Product</th><th class="r">System qty</th><th style="width:140px">Counted</th></tr></thead><tbody>
      ${v.rows.map(r => `<tr data-n="${esc(r.name.toLowerCase())}"><td>${esc(r.name)}</td><td class="r">${qty(r.stock_qty)}</td><td><input type="number" step="any" data-p="${r.id}" data-o="${r.stock_qty}" value="${r.stock_qty}"></td></tr>`).join('')}</tbody></table></div>
      <label class="field" style="margin-top:10px"><span>Reason</span><input id="cr" value="Stock count ${today()}"></label>`,
      onOpen: r => r.querySelector('#cf').oninput = e => $$('[data-n]', r).forEach(tr => tr.style.display = tr.dataset.n.includes(e.target.value.toLowerCase()) ? '' : 'none'),
      actions: [{ label: 'Cancel' }, { label: 'Apply adjustments', cls: 'btn-primary', onClick: async (c, r) => {
        const lines = $$('[data-p]', r).filter(i => Number(i.value) !== Number(i.dataset.o)).map(i => ({ product_id: Number(i.dataset.p), counted_qty: Number(i.value) }));
        if (!lines.length) return toast('No changes', 'info');
        const res = await POST('/inventory/adjust', { lines, reason: r.querySelector('#cr').value, location_id: cl || undefined });
        c(); toast(`${res.changes.length} products adjusted (${money(res.value)})`); inventory(view);
      } }] });
  };
}

// ---------------------------------------------------------------- partners
export async function partners(view) {
  const type = query().type || 'customer';
  view.innerHTML = page('Contacts', '', `<div class="tabs"><a href="#/partners?type=customer" class="${type === 'customer' ? 'active' : ''}">Customers</a><a href="#/partners?type=supplier" class="${type === 'supplier' ? 'active' : ''}">Suppliers</a></div><div id="pb"></div>`);
  const fields = [{ key: 'name', label: 'Name', required: true, span: 2 }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email', type: 'email' },
    { key: 'contact_person', label: 'Contact person' }, { key: 'birthday', label: 'Birthday', type: 'date' }, { key: 'tags', label: 'Tags (comma separated)', span: 2 },
    { key: 'address', label: 'Address', span: 2 }, { key: 'tax_number', label: 'VAT / TIN' }, { key: 'credit_limit', label: 'Credit limit', type: 'number' },
    { key: 'is_customer', label: 'Customer', type: 'checkbox' }, { key: 'is_supplier', label: 'Supplier', type: 'checkbox' }, { key: 'notes', label: 'Notes', type: 'textarea', span: 2 }];
  const pb = $('#pb');
  const load = async () => {
    const rows = await GET(`/partners?${type === 'customer' ? 'is_customer' : 'is_supplier'}=1`);
    pb.innerHTML = `<div class="row" style="margin-bottom:10px"><input id="pq" placeholder="Search…" style="max-width:300px"><span class="spacer"></span>${can('partners') ? `<button class="btn btn-primary" id="np">＋ New ${type}</button>` : ''}</div><div id="pt"></div>`;
    const draw = () => {
      const q = $('#pq').value.toLowerCase();
      const list = rows.filter(r => !q || [r.name, r.phone, r.email].join(' ').toLowerCase().includes(q));
      $('#pt').innerHTML = tableHtml([{ key: 'name', label: 'Name' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'tax_number', label: 'VAT/TIN' }], list, { rowAttr: r => `data-id="${r.id}"` });
      $$('[data-id]', pb).forEach(tr => tr.onclick = () => type === 'customer' && can('crm') ? location.hash = '#/customer/' + tr.dataset.id : open(rows.find(r => String(r.id) === tr.dataset.id)));
    };
    $('#pq').oninput = draw; draw();
    const np = $('#np'); if (np) np.onclick = () => open(null);
  };
  const open = async p => {
    const bal = p ? await GET(`/partners/${p.id}/balance`) : null;
    const actions = [{ label: 'Cancel' }];
    if (p && bal.receivable > 0 && can('invoicing')) actions.push({ label: 'Receive payment', onClick: async c => { c(); receiveAccountPayment(p, bal.receivable, load); } });
    actions.push({ label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const data = readForm(r, fields); if (!data.birthday) data.birthday = null; if (p) await PUT('/partners/' + p.id, data); else await POST('/partners', data); c(); toast('Saved'); load(); } });
    modal({ title: p ? p.name : `New ${type}`, size: 'lg', body: (bal ? `<div class="cols cols-2" style="margin-bottom:14px"><div class="kpi"><div class="label">They owe us</div><div class="value">${money(bal.receivable)}</div></div><div class="kpi"><div class="label">We owe them</div><div class="value">${money(bal.payable)}</div></div></div>` : '') +
      formHtml(fields, p ? { ...p, birthday: d(p.birthday) } : { is_customer: type === 'customer' ? 1 : 0, is_supplier: type === 'supplier' ? 1 : 0 }, { ctx: 'partner' }), actions });
  };
  load();
}

async function receiveAccountPayment(p, due, done) {
  const methods = (await GET('/payment-methods')).filter(m => m.kind !== 'account');
  modal({ title: `Payment from ${p.name}`, size: 'sm', body: formHtml([{ key: 'amount', label: 'Amount', type: 'number', default: due }, { key: 'method_id', label: 'Method', type: 'select', options: methods.map(m => ({ value: m.id, label: m.name })) }, { key: 'reference', label: 'Reference' }]),
    actions: [{ label: 'Cancel' }, { label: 'Record', cls: 'btn-primary', onClick: async (c, r) => {
      const v = readForm(r, [{ key: 'amount', type: 'number' }, { key: 'method_id', type: 'select', numeric: true }, { key: 'reference' }]);
      await POST('/customer-payments', { ...v, partner_id: p.id }); c(); toast('Payment recorded'); done();
    } }] });
}

// ---------------------------------------------------------------- sales & sessions
export async function sales(view) {
  const q = query(); const tab = q.tab || 'orders';
  view.innerHTML = page('Sales & Sessions', '', `<div class="tabs"><a href="#/sales?tab=orders" class="${tab === 'orders' ? 'active' : ''}">POS orders</a><a href="#/sales?tab=sessions" class="${tab === 'sessions' ? 'active' : ''}">Cashier sessions</a></div><div id="sb"></div>`);
  const sb = $('#sb');
  if (tab === 'sessions') {
    const rows = await GET('/pos/sessions');
    sb.innerHTML = tableHtml([{ key: 'id', label: '#' }, { key: 'terminal_name', label: 'Till' }, { key: 'user_name', label: 'Cashier' }, { key: 'status', label: 'Status', html: 1, fmt: v => badge(v) },
      { key: 'opened_at', label: 'Opened', fmt: dt }, { key: 'closed_at', label: 'Closed', fmt: dt }, { key: 'opening_cash', label: 'Float', right: 1, fmt: money },
      { key: 'expected_cash', label: 'Expected', right: 1, fmt: v => v == null ? '' : money(v) }, { key: 'counted_cash', label: 'Counted', right: 1, fmt: v => v == null ? '' : money(v) },
      { key: 'id', label: 'Diff', right: 1, html: 1, fmt: (v, r) => r.counted_cash == null ? '' : `<b style="color:${r.counted_cash - r.expected_cash < 0 ? 'var(--bad)' : 'var(--ok)'}">${money(r.counted_cash - r.expected_cash)}</b>` }], rows);
    return;
  }
  sb.innerHTML = `<div class="row" style="margin-bottom:10px"><input type="date" id="sd" value="${q.date || today()}" style="max-width:180px"><select id="ss" style="max-width:180px"><option value="">All statuses</option>${['open', 'paid', 'refunded', 'voided'].map(s => `<option>${s}</option>`).join('')}</select><input id="sq" placeholder="Order number" style="max-width:220px"></div><div id="st"></div>`;
  const load = async () => {
    const rows = await GET(`/pos/orders?date=${$('#sd').value}&status=${$('#ss').value}&q=${encodeURIComponent($('#sq').value)}&limit=1000`);
    const tot = rows.filter(r => ['paid', 'refunded'].includes(r.status)).reduce((s, r) => s + Number(r.total), 0);
    $('#st').innerHTML = tableHtml([{ key: 'number', label: 'Number', fmt: (v, r) => v || '#' + r.id }, { key: 'created_at', label: 'Time', fmt: dt }, { key: 'mode', label: 'Type' },
      { key: 'table_name', label: 'Table / tab', fmt: (v, r) => v ? 'Table ' + v : r.tab_name || '' }, { key: 'user_name', label: 'Staff' }, { key: 'partner_name', label: 'Customer' },
      { key: 'status', label: 'Status', html: 1, fmt: v => badge(v) }, { key: 'total', label: 'Total', right: 1, fmt: money }], rows, { rowAttr: r => `data-id="${r.id}"` }) +
      `<div class="r" style="margin-top:8px"><b>Total sales: ${money(tot)}</b></div>`;
    $$('[data-id]', $('#st')).forEach(tr => tr.onclick = async () => {
      const o = await GET('/pos/orders/' + tr.dataset.id);
      modal({ title: o.number || 'Order #' + o.id, size: 'lg', body: '<iframe id="rc" style="width:100%;height:460px;border:1px solid var(--line);border-radius:8px"></iframe>',
        onOpen: r => { const f = r.querySelector('#rc'); f.contentDocument.open(); f.contentDocument.write(receiptHtml(o)); f.contentDocument.close(); },
        actions: [{ label: 'Close' }, { label: '🖨 Print', cls: 'btn-primary', onClick: () => printHtml(receiptHtml(o)) }] });
    });
  };
  $('#sd').onchange = load; $('#ss').onchange = load; $('#sq').oninput = debounce(load);
  load();
}

// ---------------------------------------------------------------- VAS transactions
export async function vas(view) {
  const rows = await GET('/vas/transactions');
  const ok = rows.filter(r => r.status === 'success');
  view.innerHTML = page('Value Added Services', `${can('accounting') ? '<button class="btn" id="topup">Record float top-up</button>' : ''}<a class="btn" href="#/settings?tab=plugins">Manage plugins</a><a class="btn btn-primary" href="#/pos">Sell from POS</a>`, `
    <div class="cols cols-3" style="margin-bottom:14px"><div class="kpi"><div class="label">Successful (last 300)</div><div class="value">${ok.length}</div></div>
    <div class="kpi"><div class="label">Value sold</div><div class="value">${money(ok.reduce((s, r) => s + Number(r.amount), 0))}</div></div>
    <div class="kpi"><div class="label">Commission earned</div><div class="value">${money(ok.reduce((s, r) => s + Number(r.commission), 0))}</div></div></div>
    ${tableHtml([{ key: 'created_at', label: 'Time', fmt: dt }, { key: 'plugin_id', label: 'Provider' }, { key: 'service', label: 'Service' }, { key: 'provider', label: 'Network' }, { key: 'recipient', label: 'Recipient' },
      { key: 'amount', label: 'Amount', right: 1, fmt: money }, { key: 'commission', label: 'Comm.', right: 1, fmt: money }, { key: 'status', label: 'Status', html: 1, fmt: v => badge(v) },
      { key: 'token', label: 'Token / ref', fmt: (v, r) => v || r.provider_ref || r.message || '' }, { key: 'user_name', label: 'By' },
      { key: 'id', label: '', html: 1, fmt: (v, r) => r.status === 'pending' ? `<button class="btn btn-sm" data-chk="${v}">Check</button>` : '' }], rows)}`);
  $$('[data-chk]').forEach(b => b.onclick = async e => { e.stopPropagation(); try { const r = await POST(`/vas/transactions/${b.dataset.chk}/check`); toast(`Status: ${r.status} ${r.message || ''}`); vas(view); } catch (er) { err(er); } });
  const tu = $('#topup');
  if (tu) tu.onclick = () => modal({ title: 'VAS float top-up', size: 'sm', body: formHtml([{ key: 'amount', label: 'Amount paid to provider', type: 'number', required: true }, { key: 'from_account', label: 'Paid from', type: 'select', options: [{ value: '1050', label: 'Bank' }, { value: '1000', label: 'Cash' }, { value: '1020', label: 'Mobile money' }] }, { key: 'reference', label: 'Reference' }]),
    actions: [{ label: 'Cancel' }, { label: 'Record', cls: 'btn-primary', onClick: async (c, r) => { await POST('/vas/float-topup', readForm(r, [{ key: 'amount', type: 'number', label: 'Amount', required: true }, { key: 'from_account' }, { key: 'reference' }])); c(); toast('Float top-up recorded'); } }] });
}
