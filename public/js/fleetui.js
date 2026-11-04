// Fleet & trips: vehicles with document expiry, fuel, trips charged per trip / km / ton / seat / day, taxi & bus takings, profit per vehicle
import { reportDialog } from './ops.js';
import { state, GET, POST, PUT, esc, $, $$, toast, err, can, money, qty, modal, formHtml, readForm, tableHtml, badge, page, d, today, query } from './core.js';

const VS = { available: ['available', 'ok'], on_trip: ['on a trip', 'draft'], in_repair: ['in repair', 'cancelled'], sold: ['sold', 'closed'] };
const vsBadge = s => badge((VS[s] || [s])[0], (VS[s] || [s, ''])[1]);
const TS = { planned: ['planned', 'draft'], on_trip: ['on the road', 'partial'], done: ['done', 'ok'], cancelled: ['cancelled', 'cancelled'] };
const tsBadge = s => badge((TS[s] || [s])[0], (TS[s] || [s, ''])[1]);
const KINDS = [['car', 'Car'], ['bakkie', 'Bakkie'], ['truck', 'Truck'], ['bus', 'Bus'], ['taxi', 'Taxi (Quantum)'], ['motorbike', 'Motorbike'], ['trailer', 'Trailer'], ['other', 'Other']];
const CHARGE = [['trip', 'per trip'], ['km', 'per km'], ['ton', 'per ton'], ['seat', 'per seat / passenger'], ['day', 'per day']];
const methods = async () => (await GET('/payment-methods')).filter(m => m.active && m.kind !== 'account');
const staffOpts = s => [{ value: '', label: '— none —' }, ...s.map(e => ({ value: e.id, label: `${e.first_name} ${e.last_name || ''}`.trim() }))];
const docWarn = v => (v.expiring || []).map(x => badge(`${x.doc} ${x.expired ? 'expired' : 'due'} ${x.date}`, x.expired ? 'cancelled' : 'draft')).join(' ');

export async function fleet(view) {
  const q = query(); const tab = q.tab || 'vehicles';
  const tabs = [['vehicles', 'Vehicles'], ['trips', 'Trips'], ['report', 'Cost & income per vehicle']];
  view.innerHTML = page('Fleet & trips', `<button class="btn" id="nv">＋ Vehicle</button><button class="btn btn-primary" id="nt">＋ Trip</button>`,
    `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/fleet?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="fb"></div>`);
  $('#nv').onclick = () => vehicleDialog(null, id => { location.hash = '#/vehicle/' + id; });
  $('#nt').onclick = () => tripDialog({}, () => { location.hash = '#/fleet?tab=trips&_=' + Date.now(); });
  const fb = $('#fb');
  if (tab === 'vehicles') {
    const vs = await GET('/vehicles');
    const warn = vs.filter(v => v.expiring.length);
    fb.innerHTML = `${warn.length ? `<div class="card" style="border-left:4px solid var(--bad);margin-bottom:12px"><b>Papers to renew</b><div style="margin-top:6px">${warn.map(v => `<div><a href="#/vehicle/${v.id}">${esc(v.reg_no)}</a> ${docWarn(v)}</div>`).join('')}</div></div>` : ''}
      <div class="card">${tableHtml([{ key: 'reg_no', label: 'Registration' }, { key: 'name', label: 'Name', fmt: (x, v) => x || [v.make, v.model].filter(Boolean).join(' ') }, { key: 'kind', label: 'Type', fmt: k => (KINDS.find(x => x[0] === k) || [k, k])[1] },
        { key: 'driver_name', label: 'Driver' }, { key: 'odometer', label: 'Odometer km', right: 1, fmt: qty }, { key: 'status', label: 'Status', html: 1, fmt: vsBadge },
        { key: 'open_repairs', label: 'Repairs', right: 1, fmt: n => n ? `${n} open` : '' }, { key: 'expiring', label: 'Papers', html: 1, fmt: (x, v) => docWarn(v) || '✓' }], vs, { rowAttr: v => `data-v="${v.id}"`, empty: 'No vehicles yet – click "＋ Vehicle".' })}</div>`;
    $$('[data-v]', fb).forEach(tr => tr.onclick = () => { location.hash = '#/vehicle/' + tr.dataset.v; });
  }
  if (tab === 'trips') {
    const st = q.status || 'open';
    const rows = await GET('/trips?status=' + st);
    fb.innerHTML = `<div class="row wrap" style="margin-bottom:8px">${[['open', 'Planned & on the road'], ['uninvoiced', 'Done – not invoiced'], ['done', 'Done'], ['all', 'All']].map(([k, l]) => `<a class="btn btn-sm ${k === st ? 'btn-primary' : ''}" href="#/fleet?tab=trips&status=${k}">${l}</a>`).join('')}
      <span class="spacer"></span>${st === 'uninvoiced' && can('invoicing') ? '<button class="btn btn-primary" id="ti">Invoice ticked trips</button>' : ''}</div>
      <div class="card">${tableHtml([...(st === 'uninvoiced' ? [{ key: 'id', label: '', html: 1, fmt: id => `<input type="checkbox" data-pick="${id}">` }] : []),
        { key: 'number', label: 'Trip' }, { key: 'trip_date', label: 'Date', fmt: d }, { key: 'reg_no', label: 'Vehicle' }, { key: 'driver_name', label: 'Driver' }, { key: 'customer', label: 'Customer' },
        { key: 'from_place', label: 'Route', fmt: (x, t) => `${x || ''} → ${t.to_place || ''}` }, { key: 'km', label: 'km', right: 1, fmt: k => k == null ? '' : qty(k) },
        { key: 'amount', label: 'Charge', right: 1, fmt: money }, { key: 'status', label: 'Status', html: 1, fmt: (s, t) => tsBadge(s) + (t.invoice_number ? ` <small class="muted">${esc(t.invoice_number)}</small>` : '') }],
        rows, { rowAttr: t => `data-t="${t.id}"`, empty: 'No trips here.' })}</div>`;
    $$('[data-pick]', fb).forEach(c => c.onclick = e => e.stopPropagation());
    $$('[data-t]', fb).forEach(tr => tr.onclick = () => tripActions(rows.find(t => String(t.id) === tr.dataset.t), () => fleet(view)));
    if ($('#ti')) $('#ti').onclick = async () => {
      const ids = $$('[data-pick]:checked', fb).map(c => Number(c.dataset.pick));
      if (!ids.length) return toast('Tick the trips to invoice', 'err');
      try { const o = await POST('/trips/invoice', { trip_ids: ids }); toast('Invoice made'); location.hash = '#/invoice/' + o.invoice_id; } catch (e) { err(e); }
    };
  }
  if (tab === 'report') {
    const to = q.to || today(), from = q.from || `${to.slice(0, 8)}01`;
    const rep = await GET(`/fleet/report?from=${from}&to=${to}`);
    const tot = k => rep.rows.reduce((t, x) => t + Number(x[k] || 0), 0);
    fb.innerHTML = `<div class="card"><div class="row" style="margin-bottom:8px"><label>From <input type="date" id="rf" value="${from}"></label><label>To <input type="date" id="rt" value="${to}"></label><button class="btn btn-sm" id="rg">Show</button></div>
      ${tableHtml([{ key: 'reg_no', label: 'Vehicle' }, { key: 'trips', label: 'Trips', right: 1 }, { key: 'km', label: 'km', right: 1, fmt: qty }, { key: 'litres', label: 'Litres', right: 1, fmt: qty }, { key: 'km_per_litre', label: 'km / l', right: 1, fmt: v => v ?? '' },
        { key: 'fuel', label: 'Fuel', right: 1, fmt: money }, { key: 'trip_costs', label: 'Tolls & trip costs', right: 1, fmt: money }, { key: 'repairs', label: 'Repairs', right: 1, fmt: money },
        { key: 'income', label: 'Income', right: 1, fmt: money }, { key: 'profit', label: 'Profit', right: 1, html: 1, fmt: v => `<b style="color:${v < 0 ? 'var(--bad)' : 'var(--ok)'}">${money(v)}</b>` }, { key: 'per_km', label: 'Cost / km', right: 1, fmt: v => v == null ? '' : money(v) }],
        [...rep.rows, ...(rep.rows.length > 1 ? [{ reg_no: 'Total', trips: tot('trips'), km: tot('km'), litres: tot('litres'), fuel: tot('fuel'), trip_costs: tot('trip_costs'), repairs: tot('repairs'), income: tot('income'), profit: tot('profit') }] : [])],
        { rowAttr: x => x.vehicle_id ? `data-v="${x.vehicle_id}"` : '', empty: 'No vehicles yet.' })}
      <p class="muted" style="margin-top:8px">Income = trips charged plus takings handed in. Costs = fuel, trip costs (tolls, border fees, driver allowances) and finished repairs from Maintenance.</p></div>`;
    $('#rg').onclick = () => { location.hash = `#/fleet?tab=report&from=${$('#rf').value}&to=${$('#rt').value}`; };
    $$('[data-v]', fb).forEach(tr => tr.onclick = () => { location.hash = '#/vehicle/' + tr.dataset.v; });
  }
}

async function vehicleDialog(v, done) {
  const staff = await GET('/fleet/staff');
  const f = [{ key: 'reg_no', label: 'Registration number', required: true }, { key: 'name', label: 'Nickname (optional)' }, { key: 'kind', label: 'Type', type: 'select', options: KINDS.map(([value, label]) => ({ value, label })) },
    { key: 'make', label: 'Make' }, { key: 'model', label: 'Model' }, { key: 'year', label: 'Year', type: 'number' }, { key: 'fuel', label: 'Fuel', type: 'select', options: [['diesel', 'Diesel'], ['petrol', 'Petrol'], ['other', 'Other']].map(([value, label]) => ({ value, label })) },
    { key: 'seats', label: 'Seats (buses, taxis)', type: 'number' }, { key: 'capacity_tons', label: 'Load in tons (trucks)', type: 'number' }, { key: 'odometer', label: 'Odometer now (km)', type: 'number' },
    { key: 'driver_id', label: 'Usual driver', type: 'select', numeric: true, options: staffOpts(staff) },
    { key: 'licence_expiry', label: 'Licence disc expires', type: 'date' }, { key: 'insurance_expiry', label: 'Insurance expires', type: 'date' }, { key: 'fitness_expiry', label: 'Certificate of fitness expires', type: 'date' }, { key: 'permit_expiry', label: 'Operating permit expires', type: 'date' },
    ...(v ? [{ key: 'status', label: 'Status', type: 'select', options: Object.entries(VS).map(([value, [label]]) => ({ value, label })) }, { key: 'active', label: 'In use', type: 'checkbox' }] : [{ key: 'service_days', label: 'Service every … days', type: 'number' }]),
    { key: 'notes', label: 'Notes', span: 2 }];
  const vals = v ? { ...v, licence_expiry: d(v.licence_expiry), insurance_expiry: d(v.insurance_expiry), fitness_expiry: d(v.fitness_expiry), permit_expiry: d(v.permit_expiry) } : { kind: 'bakkie', fuel: 'diesel', odometer: 0 };
  modal({ title: v ? v.reg_no : 'New vehicle', size: 'lg', body: formHtml(f, vals, { ctx: 'vehicle' }),
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const x = readForm(r, f); const o = v ? await PUT('/vehicles/' + v.id, x) : await POST('/vehicles', x); c(); toast('Saved'); done(o.id); } }] });
}

async function tripDialog(t, done) {
  const [vs, staff, custs] = await Promise.all([GET('/vehicles'), GET('/fleet/staff'), GET('/partners?is_customer=1')]);
  if (!vs.length) return toast('Add a vehicle first', 'err');
  const f = [{ key: 'vehicle_id', label: 'Vehicle', type: 'select', numeric: true, required: true, options: vs.map(v => ({ value: v.id, label: `${v.reg_no}${v.name ? ' – ' + v.name : ''}` })) },
    { key: 'driver_id', label: 'Driver (blank = usual driver)', type: 'select', numeric: true, options: staffOpts(staff) },
    { key: 'trip_date', label: 'Date', type: 'date', required: true }, { key: 'return_date', label: 'Back on', type: 'date' },
    { key: 'from_place', label: 'From' }, { key: 'to_place', label: 'To' },
    { key: 'partner_id', label: 'Customer (blank = own use, not invoiced)', type: 'select', numeric: true, options: [{ value: '', label: '— none —' }, ...custs.map(p => ({ value: p.id, label: p.name }))] },
    { key: 'load_desc', label: 'Load / passengers' }, { key: 'charge_by', label: 'Charge', type: 'select', options: CHARGE.map(([value, label]) => ({ value, label })) },
    { key: 'qty', label: 'Quantity (km are filled in on return)', type: 'number' }, { key: 'rate', label: 'Rate per unit excl. VAT (M)', type: 'number' }, { key: 'costs', label: 'Tolls, border & allowances (M)', type: 'number' }, { key: 'notes', label: 'Notes', span: 2 }];
  modal({ title: t.id ? t.number : 'New trip', size: 'lg', body: formHtml(f, t.id ? { ...t, trip_date: d(t.trip_date), return_date: d(t.return_date) } : { trip_date: today(), charge_by: 'trip', qty: 1, ...t }, { ctx: 'trip' }),
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const x = readForm(r, f); const o = t.id ? await PUT('/trips/' + t.id, x) : await POST('/trips', x); c(); toast(`${o.number} saved`); done(o); } }] });
}

function tripActions(t, reload) {
  const acts = [{ label: 'Close' }];
  if (!t.invoice_id && t.status !== 'cancelled') acts.push({ label: 'Edit', onClick: c => { c(); tripDialog(t, reload); } });
  if (['planned', 'on_trip'].includes(t.status)) acts.push({ label: 'Cancel trip', cls: 'btn-danger', onClick: async c => { await POST(`/trips/${t.id}/cancel`); c(); reload(); } });
  if (t.status === 'planned') acts.push({ label: 'Leaving now', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/trips/${t.id}/depart`, { odometer: r.querySelector('#odo').value }); c(); toast('On the road'); reload(); } });
  if (t.status === 'on_trip') acts.push({ label: 'Back – finish trip', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/trips/${t.id}/arrive`, { odometer: r.querySelector('#odo').value, costs: r.querySelector('#tc').value, return_date: r.querySelector('#rd').value }); c(); toast('Trip done'); reload(); } });
  const odoField = t.status === 'planned' ? `<label>Odometer when leaving (km)<input id="odo" type="number" placeholder="blank = last reading"></label>`
    : t.status === 'on_trip' ? `<div class="form-grid"><label>Odometer on return (km)<input id="odo" type="number" min="${t.odo_out || 0}"></label><label>Back on<input id="rd" type="date" value="${today()}"></label><label>Tolls, border & allowances (M)<input id="tc" type="number" value="${t.costs || 0}"></label></div>
      <div class="help-note">Left at ${qty(t.odo_out)} km. ${t.charge_by === 'km' ? 'The km driven become the charge quantity.' : ''}</div>` : '';
  modal({ title: `${t.number} · ${t.reg_no}`, body: `<p>${esc(d(t.trip_date))} · ${esc(t.from_place || '')} → ${esc(t.to_place || '')}<br>${esc(t.customer || 'own use')} · ${esc(t.driver_name || 'no driver')}</p>
    <p>${(CHARGE.find(x => x[0] === t.charge_by) || [])[1] || ''}: ${qty(t.qty)} × ${money(t.rate)} = <b>${money(t.amount)}</b> ${tsBadge(t.status)}</p>${t.km != null ? `<p>${qty(t.km)} km driven</p>` : ''}${odoField}`, actions: acts });
}

export async function vehicle(view, [idq]) {
  const id = (idq || '').split('?')[0];
  const v = await GET('/vehicles/' + id);
  const tab = query().tab || 'fuel';
  const tabs = [['fuel', 'Fuel'], ['trips', 'Trips'], ['takings', 'Takings'], ['repairs', 'Repairs']];
  view.innerHTML = page(`${v.reg_no}${v.name ? ' · ' + v.name : ''}`, `<button class="btn" id="vf">⛽ Fuel</button><button class="btn" id="vk">💵 Takings</button><button class="btn" id="vt">＋ Trip</button>${v.equipment_id ? '<button class="btn" id="vr">🔧 Repair</button>' : ''}<button class="btn" id="ve">Edit</button>`,
    `<div class="cols cols-4" style="margin-bottom:14px"><div class="kpi"><div class="label">Status</div><div class="value" style="font-size:18px">${vsBadge(v.status)}</div><div class="hint">${esc([v.make, v.model, v.year].filter(Boolean).join(' '))}</div></div>
      <div class="kpi"><div class="label">Odometer</div><div class="value">${qty(v.odometer)} km</div></div><div class="kpi"><div class="label">Driver</div><div class="value" style="font-size:18px">${esc(v.driver_name || '–')}</div></div>
      <div class="kpi"><div class="label">Papers</div><div class="hint">${[['licence_expiry', 'Licence'], ['insurance_expiry', 'Insurance'], ['fitness_expiry', 'Fitness'], ['permit_expiry', 'Permit']].map(([k, l]) => v[k] ? `${l}: <b style="color:${d(v[k]) < today() ? 'var(--bad)' : 'inherit'}">${esc(d(v[k]))}</b>` : '').filter(Boolean).join('<br>') || 'no dates entered'}</div></div></div>
    <div class="tabs">${tabs.map(([k, l]) => `<a href="#/vehicle/${v.id}?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div class="card" id="vb"></div>`, { back: '#/fleet' });
  const vb = $('#vb'); const reload = () => vehicle(view, [id]);
  if (tab === 'fuel') vb.innerHTML = tableHtml([{ key: 'fill_date', label: 'Date', fmt: d }, { key: 'litres', label: 'Litres', right: 1, fmt: qty }, { key: 'amount', label: 'Amount', right: 1, fmt: money }, { key: 'amount', label: 'Per litre', right: 1, fmt: (a, f) => money(a / f.litres) },
    { key: 'odometer', label: 'Odometer', right: 1, fmt: o => o == null ? '' : qty(o) }, { key: 'full_tank', label: 'Full', fmt: x => x ? '✓' : '' }, { key: 'station', label: 'Station' }, { key: 'driver_name', label: 'Driver' }], v.fuel_logs, { empty: 'No fuel recorded yet.' });
  if (tab === 'trips') {
    vb.innerHTML = tableHtml([{ key: 'number', label: 'Trip' }, { key: 'trip_date', label: 'Date', fmt: d }, { key: 'customer', label: 'Customer' }, { key: 'from_place', label: 'Route', fmt: (x, t) => `${x || ''} → ${t.to_place || ''}` },
      { key: 'qty', label: 'Qty', right: 1, fmt: qty }, { key: 'rate', label: 'Rate', right: 1, fmt: money }, { key: 'status', label: 'Status', html: 1, fmt: tsBadge }], v.trips, { rowAttr: t => `data-t="${t.id}"`, empty: 'No trips yet.' });
    $$('[data-t]', vb).forEach(tr => tr.onclick = async () => { const all = await GET(`/trips?status=all&vehicle_id=${v.id}`); tripActions(all.find(t => String(t.id) === tr.dataset.t), reload); });
  }
  if (tab === 'takings') vb.innerHTML = tableHtml([{ key: 'take_date', label: 'Date', fmt: d }, { key: 'driver_name', label: 'Driver' }, { key: 'trips', label: 'Loads / trips', right: 1 }, { key: 'amount', label: 'Handed in', right: 1, fmt: money }, { key: 'notes', label: 'Notes' }], v.takings, { empty: 'No takings recorded – used for taxis and buses that bring cash in daily.' });
  if (tab === 'repairs') vb.innerHTML = tableHtml([{ key: 'number', label: 'Job' }, { key: 'title', label: 'What' }, { key: 'status', label: 'Status' }, { key: 'created_at', label: 'Opened', fmt: d }, { key: 'cost', label: 'Cost', right: 1, fmt: money }], v.repairs, { rowAttr: m => `data-m="${m.id}"`, empty: 'No repairs – services and breakdowns are logged in Maintenance.' });
  $$('[data-m]', vb).forEach(tr => tr.onclick = () => { location.hash = '#/mr/' + tr.dataset.m; });
  const [staff, ms] = await Promise.all([GET('/fleet/staff'), methods()]);
  $('#ve').onclick = () => vehicleDialog(v, reload);
  if ($('#vr')) $('#vr').onclick = () => reportDialog({ equipment_id: v.equipment_id, machine_down: 1 }, m => { location.hash = '#/mr/' + m.id; });
  $('#vt').onclick = () => tripDialog({ vehicle_id: v.id }, () => { location.hash = `#/vehicle/${v.id}?tab=trips`; reload(); });
  $('#vf').onclick = async () => {
    const sup = await GET('/partners?is_supplier=1').catch(() => []);
    const f = [{ key: 'date', label: 'Date', type: 'date' }, { key: 'litres', label: 'Litres', type: 'number', required: true }, { key: 'amount', label: 'Amount paid (M)', type: 'number', required: true },
      { key: 'odometer', label: `Odometer (last ${v.odometer} km)`, type: 'number' }, { key: 'full_tank', label: 'Filled to full (needed for km per litre)', type: 'checkbox' }, { key: 'station', label: 'Filling station' },
      { key: 'driver_id', label: 'Driver', type: 'select', numeric: true, options: staffOpts(staff) }, { key: 'method_id', label: 'Paid by', type: 'select', numeric: true, options: ms.map(m => ({ value: m.id, label: m.name })) },
      { key: 'supplier_id', label: 'Or on the station\'s account', type: 'select', numeric: true, options: [{ value: '', label: '— paid now —' }, ...sup.map(p => ({ value: p.id, label: p.name }))] }];
    modal({ title: `Fuel – ${v.reg_no}`, body: formHtml(f, { date: today(), full_tank: true, driver_id: v.driver_id }, { ctx: 'fuel' }),
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const o = await POST(`/vehicles/${v.id}/fuel`, readForm(r, f)); c(); toast(o.km_per_litre ? `Saved – ${o.km_per_litre} km per litre since last full tank` : 'Saved'); reload(); } }] });
  };
  $('#vk').onclick = () => {
    const f = [{ key: 'date', label: 'Date', type: 'date' }, { key: 'driver_id', label: 'Driver', type: 'select', numeric: true, options: staffOpts(staff) }, { key: 'amount', label: 'Amount handed in (M)', type: 'number', required: true },
      { key: 'method_id', label: 'Received as', type: 'select', numeric: true, options: ms.map(m => ({ value: m.id, label: m.name })) }, { key: 'trips', label: 'Number of loads / trips', type: 'number' }, { key: 'odometer', label: 'Odometer (km)', type: 'number' }, { key: 'notes', label: 'Notes', span: 2 }];
    modal({ title: `Takings – ${v.reg_no}`, body: formHtml(f, { date: today(), driver_id: v.driver_id }, { ctx: 'takings' }),
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/vehicles/${v.id}/takings`, readForm(r, f)); c(); toast('Takings saved'); location.hash = `#/vehicle/${v.id}?tab=takings`; } }] });
  };
}
