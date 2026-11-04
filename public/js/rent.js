// Property & rent: rent roll, buildings & units, leases, deposits, receipts, arrears and landlord payouts
import { remindOne } from './remindui.js';
import { state, GET, POST, PUT, esc, $, $$, toast, err, can, money, qty, modal, confirmBox, formHtml, readForm, tableHtml, badge, page, d, today, plusDays, query, filesCard, printHtml } from './core.js';

const KINDS = [['flat', 'Flat'], ['house', 'House'], ['room', 'Room'], ['shop', 'Shop'], ['office', 'Office'], ['warehouse', 'Warehouse'], ['site', 'Stand / site'], ['other', 'Other']];
const LS = { draft: ['draft', 'draft'], active: ['let', 'ok'], notice: ['on notice', 'partial'], ended: ['ended', 'closed'], vacant: ['vacant', 'cancelled'] };
const lsBadge = s => badge((LS[s] || [s])[0], (LS[s] || [s, ''])[1]);
const methods = async () => (await GET('/payment-methods')).filter(m => m.active && m.kind !== 'account');
const mOpts = ms => ms.map(m => ({ value: m.id, label: m.name }));

export async function property(view) {
  const tab = query().tab || 'roll';
  const tabs = [['roll', 'Rent roll'], ['buildings', 'Buildings'], ['leases', 'Leases'], ['arrears', 'Arrears'], ['landlords', 'Landlord payouts']];
  view.innerHTML = page('Property & rent', `<button class="btn" id="nb">＋ Building</button><a class="btn btn-primary" href="#/lease/new">＋ New lease</a>`,
    `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/property?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="pb"></div>`);
  $('#nb').onclick = () => buildingDialog(null, id => { location.hash = '#/building/' + id; });
  const pb = $('#pb');
  if (tab === 'roll') {
    const r = await GET('/property/rent-roll');
    pb.innerHTML = `<div class="cols cols-4" style="margin-bottom:14px"><div class="kpi"><div class="label">Units let</div><div class="value">${r.occupied} / ${r.units}</div><div class="hint">${r.units ? Math.round(r.occupied / r.units * 100) : 0}% occupied · ${r.vacant} vacant</div></div>
      <div class="kpi"><div class="label">Rent per month</div><div class="value">${money(r.monthly_rent)}</div></div>
      <div class="kpi"><div class="label">Arrears</div><div class="value" style="color:${r.arrears > 0 ? 'var(--bad)' : 'var(--ok)'}">${money(r.arrears)}</div></div>
      <div class="kpi"><div class="label">Leases ending in 90 days</div><div class="value">${r.expiring}</div></div></div>
      <div class="card">${tableHtml([{ key: 'property_name', label: 'Building' }, { key: 'name', label: 'Unit' }, { key: 'kind', label: 'Type', fmt: v => (KINDS.find(k => k[0] === v) || [v, v])[1] },
        { key: 'state', label: 'Status', html: 1, fmt: lsBadge }, { key: 'tenant_name', label: 'Tenant' }, { key: 'tenant_phone', label: 'Phone' },
        { key: 'rent', label: 'Rent', right: 1, fmt: (v, u) => v ? money(Number(v) * (1 + Number(u.tax_rate) / 100)) : u.market_rent ? `<span class="muted">${money(u.market_rent)}</span>` : '', html: 1 },
        { key: 'deposit_held', label: 'Deposit held', right: 1, fmt: v => v ? money(v) : '' }, { key: 'arrears', label: 'Arrears', right: 1, html: 1, fmt: v => v > 0 ? `<b class="neg">${money(v)}</b>` : '' },
        { key: 'lease_end', label: 'Lease ends', fmt: d }], r.rows, { rowAttr: u => u.lease_id ? `data-l="${u.lease_id}"` : `data-u="${u.id}" data-p="${u.property_id}"`, empty: 'No units yet. Add a building, then its flats, rooms or shops.' })}</div>`;
    $$('[data-l]', pb).forEach(tr => tr.onclick = () => { location.hash = '#/lease/' + tr.dataset.l; });
    $$('[data-u]', pb).forEach(tr => tr.onclick = () => { location.hash = `#/lease/new?unit_id=${tr.dataset.u}`; });
  }
  if (tab === 'buildings') {
    const rows = await GET('/properties');
    pb.innerHTML = `<div class="card">${tableHtml([{ key: 'name', label: 'Building' }, { key: 'address', label: 'Address' }, { key: 'owner_name', label: 'Landlord', fmt: (v, p) => v ? `${v} (${Number(p.commission_pct)}%)` : 'own' },
      { key: 'units', label: 'Units', right: 1 }, { key: 'occupancy', label: 'Occupied', right: 1, fmt: v => v == null ? '' : v + '%' }, { key: 'monthly_rent', label: 'Rent / month', right: 1, fmt: money },
      { key: 'arrears', label: 'Arrears', right: 1, fmt: money }], rows, { rowAttr: p => `data-id="${p.id}"`, empty: 'No buildings yet.' })}</div>`;
    $$('[data-id]', pb).forEach(tr => tr.onclick = () => { location.hash = '#/building/' + tr.dataset.id; });
  }
  if (tab === 'leases') {
    const st = query().status || 'current';
    const rows = await GET('/leases?status=' + st);
    pb.innerHTML = `<div class="row" style="margin-bottom:8px">${[['current', 'Current'], ['ended', 'Ended'], ['all', 'All']].map(([k, l]) => `<a class="btn btn-sm ${k === st ? 'btn-primary' : ''}" href="#/property?tab=leases&status=${k}">${l}</a>`).join('')}</div>
      <div class="card">${tableHtml([{ key: 'number', label: 'Lease' }, { key: 'property_name', label: 'Building' }, { key: 'unit_name', label: 'Unit' }, { key: 'tenant_name', label: 'Tenant' },
        { key: 'rent', label: 'Rent', right: 1, fmt: (v, l) => money(Number(v) * (1 + Number(l.tax_rate) / 100)) }, { key: 'start_date', label: 'From', fmt: d }, { key: 'end_date', label: 'To', fmt: d },
        { key: 'next_rent_date', label: 'Next rent', fmt: (v, l) => l.status === 'ended' ? '' : d(v) }, { key: 'arrears', label: 'Arrears', right: 1, html: 1, fmt: v => v > 0 ? `<b class="neg">${money(v)}</b>` : '' },
        { key: 'status', label: 'Status', html: 1, fmt: lsBadge }], rows, { rowAttr: l => `data-id="${l.id}"`, empty: 'No leases.' })}</div>`;
    $$('[data-id]', pb).forEach(tr => tr.onclick = () => { location.hash = '#/lease/' + tr.dataset.id; });
  }
  if (tab === 'arrears') {
    const rows = await GET('/property/arrears');
    pb.innerHTML = `<div class="card">${tableHtml([{ key: 'name', label: 'Tenant' }, { key: 'phone', label: 'Phone' }, { key: 'units', label: 'Unit' },
      { key: 'current', label: 'Not yet due', right: 1, fmt: money }, { key: 'd30', label: '1–30 days', right: 1, fmt: money }, { key: 'd60', label: '31–60 days', right: 1, fmt: money },
      { key: 'd90', label: '60+ days', right: 1, html: 1, fmt: v => v > 0 ? `<b class="neg">${money(v)}</b>` : money(0) }, { key: 'due', label: 'Total owed', right: 1, html: 1, fmt: v => `<b>${money(v)}</b>` }], rows,
      { rowAttr: x => `data-t="${x.tenant_id}"`, empty: 'Nobody owes rent. 🎉' })}</div>`;
    $$('[data-t]', pb).forEach(tr => tr.onclick = () => { location.hash = '#/customer/' + tr.dataset.t; });
  }
  if (tab === 'landlords') {
    const props = (await GET('/properties')).filter(p => p.owner_id);
    if (!props.length) { pb.innerHTML = '<div class="card"><div class="empty">No buildings belong to landlords. When you collect rent for an owner, choose them on the building with your commission %.</div></div>'; return; }
    const to = query().to || today(), from = query().from || to.slice(0, 8) + '01', pid = Number(query().property_id) || props[0].id;
    const st = await GET(`/property/owner-statement?property_id=${pid}&from=${from}&to=${to}`);
    pb.innerHTML = `<div class="card"><div class="row wrap" style="margin-bottom:10px"><select id="op">${props.map(p => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)} – ${esc(p.owner_name)}</option>`).join('')}</select>
      <label>From <input type="date" id="of" value="${from}"></label><label>To <input type="date" id="ot" value="${to}"></label><button class="btn" id="og">Show</button><span class="spacer"></span>
      <button class="btn" id="opr">🖨 Statement</button>${can('accounting') && !st.already_paid && st.collected > 0 ? `<button class="btn btn-ok" id="opay">Pay landlord ${money(st.net)}</button>` : st.already_paid ? badge('paid out', 'paid') : ''}</div>
      <div class="cols cols-3" style="margin-bottom:12px"><div class="kpi"><div class="label">Rent collected</div><div class="value">${money(st.collected)}</div></div><div class="kpi"><div class="label">Your commission (${Number(st.property.commission_pct)}%)</div><div class="value">${money(st.commission)}</div></div>
      <div class="kpi"><div class="label">Due to landlord</div><div class="value">${money(st.net)}</div></div></div>
      ${tableHtml([{ key: 'created_at', label: 'Paid on', fmt: d }, { key: 'tenant', label: 'Tenant' }, { key: 'unit', label: 'Unit' }, { key: 'number', label: 'Invoice' }, { key: 'amount', label: 'Paid', right: 1, fmt: money }, { key: 'collected', label: 'Rent part', right: 1, fmt: money }], st.rows, { empty: 'No rent received in this period.' })}</div>`;
    const go = () => { location.hash = `#/property?tab=landlords&property_id=${$('#op').value}&from=${$('#of').value}&to=${$('#ot').value}`; };
    $('#og').onclick = go; $('#op').onchange = go;
    $('#opr').onclick = () => printHtml(`<div style="font-family:Arial;font-size:13px;max-width:760px;margin:auto"><h2>${esc(state.company.name || '')}</h2><h1 style="font-size:20px">Landlord statement – ${esc(st.property.name)}</h1>
      <p>${esc(st.property.owner_name)} · ${esc(from)} to ${esc(to)}</p><table border="1" cellpadding="5" style="border-collapse:collapse;width:100%"><tr><th align="left">Date</th><th align="left">Tenant</th><th align="left">Unit</th><th align="right">Rent received</th></tr>
      ${st.rows.map(x => `<tr><td>${esc(d(x.created_at))}</td><td>${esc(x.tenant)}</td><td>${esc(x.unit)}</td><td align="right">${money(x.collected)}</td></tr>`).join('')}</table>
      <p style="text-align:right">Collected: <b>${money(st.collected)}</b><br>Less commission ${Number(st.property.commission_pct)}%: ${money(st.commission)}<br>Paid to you: <b>${money(st.net)}</b></p></div>`);
    if ($('#opay')) $('#opay').onclick = async () => {
      const ms = await methods(); const f = [{ key: 'method_id', label: 'Paid from', type: 'select', numeric: true, options: mOpts(ms) }];
      modal({ title: `Pay ${st.property.owner_name}`, body: `<p>${money(st.collected)} collected − ${money(st.commission)} commission = <b>${money(st.net)}</b></p>${formHtml(f, {})}`, actions: [{ label: 'Cancel' },
        { label: 'Book payout', cls: 'btn-primary', onClick: async (c, r) => { await POST('/property/payout', { property_id: pid, from, to, ...readForm(r, f) }); c(); toast('Payout booked'); go(); } }] });
    };
  }
}

async function buildingDialog(p, done) {
  const owners = await GET('/partners?is_supplier=1');
  const f = [{ key: 'name', label: 'Building name', required: true }, { key: 'address', label: 'Address' },
    { key: 'owner_id', label: 'Landlord (if you collect rent for someone else)', type: 'select', numeric: true, options: [{ value: '', label: '— our own building —' }, ...owners.map(o => ({ value: o.id, label: o.name }))] },
    { key: 'commission_pct', label: 'Your commission %', type: 'number' }, { key: 'notes', label: 'Notes', span: 2 }];
  modal({ title: p ? p.name : 'New building', size: 'lg', body: formHtml(f, p || {}, { ctx: 'building' }), actions: [{ label: 'Cancel' },
    { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); const o = p ? await PUT('/properties/' + p.id, v) : await POST('/properties', v); c(); toast('Saved'); done(o.id); } }] });
}
function unitDialog(propertyId, u, done) {
  const f = [{ key: 'name', label: 'Unit', required: true }, { key: 'kind', label: 'Type', type: 'select', options: KINDS.map(([value, label]) => ({ value, label })) },
    { key: 'bedrooms', label: 'Bedrooms', type: 'number', nullable: true }, { key: 'size_m2', label: 'Size (m²)', type: 'number', nullable: true },
    { key: 'market_rent', label: 'Asking rent (M)', type: 'number', nullable: true }, { key: 'meter_no', label: 'Electricity / water meter number' }, { key: 'notes', label: 'Notes', span: 2 },
    ...(u ? [{ key: 'active', label: 'In use', type: 'checkbox' }] : [])];
  modal({ title: u ? u.name : 'New unit', size: 'lg', body: formHtml(f, u || { kind: 'flat' }, { ctx: 'unit' }), actions: [{ label: 'Cancel' },
    { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); if (u) await PUT('/units/' + u.id, v); else await POST('/units', { ...v, property_id: propertyId }); c(); done(); } }] });
}

export async function building(view, [idq]) {
  const id = (idq || '').split('?')[0];
  const p = await GET('/properties/' + id);
  view.innerHTML = page(p.name, `<button class="btn" id="be">Edit</button><button class="btn btn-primary" id="bu">＋ Unit</button>`, `
    <div class="card"><p class="muted" style="margin-top:0">${esc(p.address || '')}${p.owner_name ? ` · landlord <b>${esc(p.owner_name)}</b>, commission ${Number(p.commission_pct)}%` : ' · own building'}</p>
    ${tableHtml([{ key: 'name', label: 'Unit' }, { key: 'kind', label: 'Type', fmt: v => (KINDS.find(k => k[0] === v) || [v, v])[1] }, { key: 'bedrooms', label: 'Beds', right: 1 },
      { key: 'lease_status', label: 'Status', html: 1, fmt: v => lsBadge(v || 'vacant') }, { key: 'tenant_name', label: 'Tenant' }, { key: 'rent', label: 'Rent', right: 1, fmt: (v, u) => v ? money(Number(v) * (1 + Number(u.tax_rate) / 100)) : '' },
      { key: 'arrears', label: 'Arrears', right: 1, html: 1, fmt: v => v > 0 ? `<b class="neg">${money(v)}</b>` : '' }, { key: 'meter_no', label: 'Meter' },
      { key: 'id', label: '', html: 1, fmt: (v, u) => `<button class="btn btn-sm" data-eu="${v}">Edit</button>${u.lease_id ? '' : ` <a class="btn btn-sm btn-primary" href="#/lease/new?unit_id=${v}">Let</a>`}` }], p.units,
      { rowAttr: u => u.lease_id ? `data-l="${u.lease_id}"` : '', empty: 'No units yet – add each flat, room or shop.' })}</div>
    ${p.payouts.length ? `<div class="card" style="margin-top:14px"><h3>Payouts to the landlord</h3>${tableHtml([{ key: 'period_from', label: 'From', fmt: d }, { key: 'period_to', label: 'To', fmt: d }, { key: 'collected', label: 'Collected', right: 1, fmt: money }, { key: 'commission', label: 'Commission', right: 1, fmt: money }, { key: 'paid', label: 'Paid', right: 1, fmt: money }], p.payouts)}</div>` : ''}`, { back: '#/property?tab=buildings' });
  filesCard('property', p.id, 'Title deeds, plans & photos');
  const reload = () => building(view, [id]);
  $('#be').onclick = () => buildingDialog(p, reload);
  $('#bu').onclick = () => unitDialog(p.id, null, reload);
  $$('[data-eu]').forEach(b => b.onclick = e => { e.stopPropagation(); unitDialog(p.id, p.units.find(u => String(u.id) === b.dataset.eu), reload); });
  $$('[data-l]').forEach(tr => tr.onclick = () => { location.hash = '#/lease/' + tr.dataset.l; });
}

export async function leaseForm(view, [idq]) {
  const id = (idq || '').split('?')[0];
  const isNew = id === 'new';
  if (isNew) {
    const [rows, tenants] = await Promise.all([GET('/property/rent-roll'), GET('/partners?is_customer=1')]);
    const free = rows.rows.filter(u => !u.lease_id);
    const pre = Number(query().unit_id) || (free[0] || {}).id;
    const u0 = free.find(u => u.id === pre) || {};
    const f = [{ key: 'unit_id', label: 'Unit', type: 'select', numeric: true, required: true, options: free.map(u => ({ value: u.id, label: `${u.property_name} – ${u.name}` })) },
      { key: 'tenant_id', label: 'Tenant', type: 'select', numeric: true, options: [{ value: '', label: '— new tenant (fill in below) —' }, ...tenants.map(t => ({ value: t.id, label: t.name }))] },
      { key: 'tenant_name', label: 'New tenant: name' }, { key: 'tenant_phone', label: 'New tenant: phone' },
      { key: 'start_date', label: 'Lease starts', type: 'date', required: true }, { key: 'end_date', label: 'Lease ends (blank = month to month)', type: 'date' },
      { key: 'rent', label: 'Monthly rent excl. VAT (M)', type: 'number', required: true }, { key: 'tax_rate', label: 'VAT % (0 for homes, 15 for shops/offices if registered)', type: 'number' },
      { key: 'due_day', label: 'Rent due on day of the month', type: 'number' }, { key: 'deposit', label: 'Deposit agreed (M)', type: 'number' },
      { key: 'escalation_pct', label: 'Yearly increase %', type: 'number' }, { key: 'notes', label: 'Notes', span: 2 }];
    view.innerHTML = page('New lease', '<button class="btn btn-primary" id="ls">Save lease</button>', `<div class="card">${free.length ? formHtml(f, { unit_id: pre, start_date: today(), rent: u0.market_rent || '', tax_rate: ['shop', 'office', 'warehouse'].includes(u0.kind) ? 15 : 0, due_day: 1, deposit: u0.market_rent || '', escalation_pct: 0 }, { ctx: 'lease' }) : '<div class="empty">All units are let. Add a unit to a building first.</div>'}</div>`, { back: '#/property?tab=leases' });
    if (!free.length) return;
    $('#ls').onclick = async () => {
      try {
        const v = readForm(view, f);
        if (!v.tenant_id) { if (!v.tenant_name) throw new Error('Choose the tenant or type the new tenant\'s name'); v.tenant_id = (await POST('/partners', { name: v.tenant_name, phone: v.tenant_phone || null, is_customer: 1, tags: 'tenant' })).id; }
        const l = await POST('/leases', v); toast(`${l.number} saved – check it and Activate`); location.hash = '#/lease/' + l.id;
      } catch (e) { err(e); }
    };
    return;
  }
  const l = await GET('/leases/' + id);
  const acts = [];
  if (l.status === 'draft') acts.push('<button class="btn btn-ok" id="la">▶ Activate</button>');
  if (['active', 'notice'].includes(l.status)) acts.push('<button class="btn btn-primary" id="lr">💵 Rent received</button>', '<button class="btn" id="lc">＋ Charge</button>');
  acts.push('<button class="btn" id="ld">Deposit…</button>', '<button class="btn" id="lst">🖨 Statement</button>');
  if (l.balance.due > 0 && can('reminders')) acts.push('<button class="btn" id="lrm">📱 Remind</button>');
  if (l.status !== 'ended') acts.push('<button class="btn" id="le">Edit</button>');
  if (l.status === 'active') acts.push('<button class="btn" id="ln">Notice</button>');
  if (l.status !== 'ended') acts.push('<button class="btn btn-danger" id="lend">End lease</button>');
  const b = l.balance;
  view.innerHTML = page(`${l.number} · ${l.property_name} ${l.unit_name}`, acts.join(''), `
    <div class="cols cols-4" style="margin-bottom:14px">
      <div class="kpi"><div class="label">Tenant</div><div class="value" style="font-size:18px">${esc(l.tenant_name)}</div><div class="hint">${esc(l.tenant_phone || '')}</div></div>
      <div class="kpi"><div class="label">Rent</div><div class="value">${money(Number(l.rent) * (1 + Number(l.tax_rate) / 100))}</div><div class="hint">due day ${l.due_day}${Number(l.escalation_pct) ? ` · +${Number(l.escalation_pct)}% on ${esc(d(l.next_escalation))}` : ''}</div></div>
      <div class="kpi"><div class="label">Owes</div><div class="value" style="color:${b.due > 0 ? 'var(--bad)' : 'var(--ok)'}">${money(b.due)}</div><div class="hint">${b.age.d90 > 0 ? `${money(b.age.d90)} over 60 days` : b.age.d30 + b.age.d60 > 0 ? `${money(b.age.d30 + b.age.d60)} overdue` : 'up to date'}</div></div>
      <div class="kpi"><div class="label">Deposit held</div><div class="value">${money(l.deposit_held)}</div><div class="hint">agreed ${money(l.deposit)}</div></div></div>
    <div class="card"><div class="row wrap" style="margin-bottom:8px">${lsBadge(l.status)}<span class="muted">${esc(d(l.start_date))} → ${l.end_date ? esc(d(l.end_date)) : 'month to month'}${l.status !== 'ended' && l.next_rent_date ? ` · next rent invoice ${esc(d(l.next_rent_date))}` : ''}</span></div>
      ${l.notes ? `<p>${esc(l.notes)}</p>` : ''}
      <h3>Invoices</h3>${tableHtml([{ key: 'invoice_date', label: 'Date', fmt: d }, { key: 'number', label: 'Invoice' }, { key: 'notes', label: 'For' }, { key: 'total', label: 'Amount', right: 1, fmt: money },
        { key: 'amount_paid', label: 'Paid', right: 1, fmt: money }, { key: 'status', label: 'Status', html: 1, fmt: v => badge(v) }], l.invoices, { rowAttr: i => `data-inv="${i.id}"`, empty: l.status === 'draft' ? 'Activate the lease to start invoicing rent.' : 'None yet.' })}
      ${l.deposits.length ? `<h3 style="margin-top:14px">Deposit</h3>${tableHtml([{ key: 'entry_date', label: 'Date', fmt: d }, { key: 'memo', label: 'What' }, { key: 'amount', label: 'Held +/−', right: 1, fmt: money }], l.deposits)}` : ''}</div>`, { back: '#/property?tab=leases' });
  filesCard('lease', l.id, 'Signed lease, ID copy & inspection photos');
  $$('[data-inv]').forEach(tr => tr.onclick = () => { location.hash = '#/invoice/' + tr.dataset.inv; });
  const reload = () => leaseForm(view, [id]);
  const ms = await methods();
  const payDialog = (title, path, extra = [], vals = {}, msg = 'Saved') => {
    const f = [...extra, { key: 'method_id', label: 'Received by', type: 'select', numeric: true, options: mOpts(ms) }, { key: 'reference', label: 'Reference (M-Pesa / bank no.)' }, { key: 'date', label: 'Date', type: 'date' }];
    modal({ title, body: formHtml(f, { date: today(), ...vals }, { ctx: 'leasepay' }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/leases/${l.id}/${path}`, readForm(r, f)); c(); toast(msg); reload(); } }] });
  };
  if ($('#la')) $('#la').onclick = async () => { try { const o = await POST(`/leases/${l.id}/activate`, {}); toast(`Lease active${o.prorata ? ` – first part-month ${money(o.prorata)}` : ''}; rent is invoiced on day ${l.due_day} every month`); reload(); } catch (e) { err(e); } };
  if ($('#lr')) $('#lr').onclick = () => payDialog('Rent received', 'receive', [{ key: 'amount', label: 'Amount (M)', type: 'number', required: true }], { amount: b.due || '' }, 'Payment recorded against the oldest rent');
  if ($('#lc')) $('#lc').onclick = () => {
    const f = [{ key: 'description', label: 'What for (water, electricity, late fee, damage…)', required: true, span: 2 }, { key: 'amount', label: 'Amount excl. VAT (M)', type: 'number', required: true }, { key: 'tax_rate', label: 'VAT %', type: 'number' },
      ...(l.owner_id ? [{ key: 'pass_to_owner', label: 'Pass this money on to the landlord', type: 'checkbox' }] : [])];
    modal({ title: 'Charge the tenant', body: formHtml(f, { tax_rate: 0 }, { ctx: 'leasecharge' }), actions: [{ label: 'Cancel' }, { label: 'Make invoice', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/leases/${l.id}/charge`, readForm(r, f)); c(); toast('Invoice made'); reload(); } }] });
  };
  $('#ld').onclick = () => {
    if (!Number(l.deposit_held) || l.status === 'draft' || l.status === 'active') return payDialog('Deposit received', 'deposit', [{ key: 'amount', label: 'Amount (M)', type: 'number', required: true }], { amount: Math.max(0, Number(l.deposit) - Number(l.deposit_held)) || '' }, 'Deposit recorded as held for the tenant');
    const f = [{ key: 'to_arrears', label: `Use for unpaid rent (owes ${money(b.due)})`, type: 'number' }, { key: 'deductions', label: 'Deduct for damage / cleaning', type: 'number' }, { key: 'reason', label: 'What the deductions are for' },
      { key: 'refund', label: 'Pay back to tenant', type: 'number' }, { key: 'method_id', label: 'Refund paid by', type: 'select', numeric: true, options: mOpts(ms) }];
    const toArr = Math.min(Number(l.deposit_held), b.due);
    modal({ title: `Settle deposit (${money(l.deposit_held)} held)`, size: 'lg', body: formHtml(f, { to_arrears: toArr, deductions: 0, refund: round(Number(l.deposit_held) - toArr) }, { ctx: 'deposit' }), actions: [{ label: 'Cancel' },
      { label: 'Deposit received (more)', onClick: c => { c(); payDialog('Deposit received', 'deposit', [{ key: 'amount', label: 'Amount (M)', type: 'number', required: true }], {}, 'Deposit recorded'); } },
      { label: 'Settle', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/leases/${l.id}/deposit-return`, readForm(r, f)); c(); toast('Deposit settled'); reload(); } }] });
  };
  if ($('#le')) $('#le').onclick = () => {
    const f = [{ key: 'rent', label: 'Monthly rent excl. VAT', type: 'number' }, { key: 'escalation_pct', label: 'Yearly increase %', type: 'number' }, { key: 'next_escalation', label: 'Next increase on', type: 'date' },
      { key: 'end_date', label: 'Lease ends', type: 'date' }, { key: 'notes', label: 'Notes', span: 2 }];
    modal({ title: 'Change lease', body: formHtml(f, { ...l, next_escalation: d(l.next_escalation), end_date: d(l.end_date) }, { ctx: 'lease' }), actions: [{ label: 'Cancel' },
      { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await PUT('/leases/' + l.id, readForm(r, f)); c(); toast('Saved – the next rent invoice uses the new amount'); reload(); } }] });
  };
  if ($('#ln')) $('#ln').onclick = () => { const f = [{ key: 'end_date', label: 'Last day of the lease', type: 'date', required: true }]; modal({ title: 'Notice to vacate', body: formHtml(f, { end_date: plusDays(30) }, { ctx: 'lease' }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/leases/${l.id}/notice`, readForm(r, f)); c(); reload(); } }] }); };
  if ($('#lend')) $('#lend').onclick = async () => { if (await confirmBox('End this lease now? Rent stops being invoiced and the unit becomes vacant. Settle the deposit afterwards.', { danger: true, okLabel: 'End lease' })) { await POST(`/leases/${l.id}/end`, {}); reload(); } };
  if ($('#lrm')) $('#lrm').onclick = () => remindOne(l.tenant_id, 'rent', l.tenant_phone);
  $('#lst').onclick = () => printHtml(`<div style="font-family:Arial;font-size:13px;max-width:760px;margin:auto"><h2>${esc(state.company.name || '')}</h2><div>${esc(state.company.address || '')} · ${esc(state.company.phone || '')}</div>
    <h1 style="font-size:20px">Tenant statement</h1><p><b>${esc(l.tenant_name)}</b> · ${esc(l.property_name)} ${esc(l.unit_name)} · ${esc(today())}</p>
    <table border="1" cellpadding="5" style="border-collapse:collapse;width:100%"><tr><th align="left">Date</th><th align="left">Invoice</th><th align="right">Amount</th><th align="right">Paid</th><th align="right">Owing</th></tr>
    ${b.invoices.map(i => `<tr><td>${esc(d(i.invoice_date))}</td><td>${esc(i.number || '')} ${esc(i.notes || '')}</td><td align="right">${money(i.total)}</td><td align="right">${money(i.amount_paid)}</td><td align="right">${money(i.open)}</td></tr>`).join('')}</table>
    <p style="text-align:right;font-size:16px">Amount due: <b>${money(b.due)}</b></p><p>Deposit held: ${money(l.deposit_held)}</p></div>`);
}
const round = n => Math.round(Number(n) * 100) / 100;
