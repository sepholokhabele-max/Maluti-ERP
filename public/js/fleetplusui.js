// Fleet management screens added to Fleet & trips: due list, pool-vehicle requests, drivers, fines & accidents,
// cost per km; and on a vehicle: servicing (schedule + records), incidents and bookings. Anyone can ask for a vehicle.
import { state, GET, POST, PUT, esc, $, $$, toast, err, can, money, qty, modal, confirmBox, formHtml, readForm, tableHtml, badge, page, d, dt, today, query } from './core.js';

const RQ = { requested: ['waiting', 'draft'], approved: ['approved', 'posted'], rejected: ['rejected', 'cancelled'], out: ['out', 'partial'], returned: ['returned', 'ok'], cancelled: ['cancelled', 'closed'] };
const rqBadge = s => badge((RQ[s] || [s])[0], (RQ[s] || [s, ''])[1]);
const SK = { service: 'Service', repair: 'Repair', tyres: 'Tyres', battery: 'Battery', inspection: 'Inspection', accident_repair: 'Accident repair', other: 'Other' };
const IK = { fine: 'Traffic fine', accident: 'Accident', theft: 'Theft', damage: 'Damage', breakdown: 'Breakdown' };
const methods = async () => (await GET('/payment-methods')).filter(m => m.active && m.kind !== 'account');
const local = v => v ? new Date(String(v).replace(' ', 'T') + 'Z').toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';

/* ============================== fleet page tabs ============================== */
async function due(fb) {
  const x = await GET('/fleet/due');
  fb.innerHTML = `<div class="cols cols-3" style="margin-bottom:12px"><div class="kpi"><div class="label">Needs attention</div><div class="value">${x.items.length}</div><div class="hint">${x.items.filter(i => i.overdue).length} overdue</div></div>
      <div class="kpi"><div class="label">Vehicle requests waiting</div><div class="value"><a href="#/fleet?tab=requests">${x.pending_requests}</a></div></div><div class="kpi"><div class="label">Insurance claims open</div><div class="value"><a href="#/fleet?tab=incidents">${x.open_claims}</a></div></div></div>
    <div class="card">${tableHtml([{ key: 'reg_no', label: 'Vehicle / driver', fmt: (v, i) => v || i.driver }, { key: 'what', label: 'What' }, { key: 'when', label: 'When' }, { key: 'overdue', label: '', html: 1, fmt: v => v ? badge('overdue', 'cancelled') : badge('due soon', 'draft') }], x.items, { rowAttr: i => i.vehicle_id ? `data-v="${i.vehicle_id}"` : '', empty: 'Nothing due – services, papers and licences are all in date. ✅' })}</div>`;
  $$('[data-v]', fb).forEach(tr => tr.onclick = () => { location.hash = `#/vehicle/${tr.dataset.v}?tab=service`; });
}
async function requests(fb) {
  const st = query().status || 'open', rows = await GET('/fleet/requests?status=' + (st === 'all' ? '' : st));
  fb.innerHTML = `<div class="row wrap" style="margin-bottom:10px">${[['open', 'Open'], ['requested', 'Waiting'], ['returned', 'Returned'], ['all', 'All']].map(([k, l]) => `<a class="btn btn-sm ${k === st ? 'btn-primary' : ''}" href="#/fleet?tab=requests&status=${k}">${l}</a>`).join('')}<span class="spacer"></span><button class="btn btn-primary" id="rqn">＋ Ask for a vehicle</button></div>
    <div class="card">${reqTable(rows)}</div>`;
  $('#rqn').onclick = () => requestDialog(() => requests(fb));
  wireReq(fb, rows, () => requests(fb));
}
const reqTable = rows => tableHtml([{ key: 'number', label: 'Request' }, { key: 'requester', label: 'Who' }, { key: 'purpose', label: 'Purpose', fmt: (v, q) => `${v}${q.destination ? ' – ' + q.destination : ''}` },
  { key: 'depart_at', label: 'From', fmt: local }, { key: 'return_at', label: 'Back', fmt: local }, { key: 'passengers', label: 'People', right: 1 }, { key: 'reg_no', label: 'Vehicle' }, { key: 'driver_name', label: 'Driver' },
  { key: 'km', label: 'km', right: 1, fmt: v => v == null ? '' : qty(v) }, { key: 'status', label: 'Status', html: 1, fmt: rqBadge }], rows, { rowAttr: q => `data-q="${q.id}"`, empty: 'No vehicle requests.' });
function wireReq(root, rows, reload) {
  $$('[data-q]', root).forEach(tr => tr.onclick = async () => {
    const q = rows.find(x => x.id === Number(tr.dataset.q)); const fleet = can('fleet');
    const acts = [{ label: 'Close' }];
    if (['requested', 'approved'].includes(q.status) && (q.user_id === state.user.id || fleet)) acts.push({ label: 'Cancel request', cls: 'btn-danger', onClick: async c => { await POST(`/fleet/requests/${q.id}/cancel`); c(); reload(); } });
    let body = `<p><b>${esc(q.purpose)}</b>${q.destination ? ' – ' + esc(q.destination) : ''}<br>${local(q.depart_at)} → ${local(q.return_at)} · ${q.passengers} people · asked by ${esc(q.requester)}</p>${q.decision_note ? `<p>Note: ${esc(q.decision_note)}</p>` : ''}`;
    if (fleet && q.status === 'requested') {
      const [vs, staff] = await Promise.all([GET(`/fleet/available?from=${encodeURIComponent(new Date(String(q.depart_at).replace(' ', 'T') + 'Z').toISOString())}&to=${encodeURIComponent(new Date(String(q.return_at).replace(' ', 'T') + 'Z').toISOString())}`), GET('/fleet/staff')]);
      body += `<div class="form-grid"><label class="field"><span>Vehicle (free at that time)</span><select id="dv">${vs.map(v => `<option value="${v.id}">${esc(v.reg_no)} ${esc([v.make, v.model].filter(Boolean).join(' '))}${v.seats ? ` · ${v.seats} seats` : ''}${v.pool ? ' · pool' : ''}</option>`).join('')}</select></label>
        <label class="field"><span>Driver</span><select id="dd"><option value="">– the requester drives –</option>${staff.map(e => `<option value="${e.id}">${esc(e.first_name)} ${esc(e.last_name || '')}</option>`).join('')}</select></label>
        <label class="field" style="grid-column:1/-1"><span>Note</span><input id="dn"></label></div>${vs.length ? '' : '<p class="help-note">No vehicle is free at that time.</p>'}`;
      acts.push({ label: 'Reject', onClick: async (c, r) => { await POST(`/fleet/requests/${q.id}/decide`, { approve: false, note: r.querySelector('#dn').value }); c(); reload(); } });
      acts.push({ label: 'Approve', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/fleet/requests/${q.id}/decide`, { approve: true, vehicle_id: Number(r.querySelector('#dv').value), driver_id: r.querySelector('#dd').value, note: r.querySelector('#dn').value }); toast('Approved'); c(); reload(); } });
    }
    if (fleet && q.status === 'approved') { body += `<label class="field"><span>Odometer going out</span><input type="number" id="oo"></label>`; acts.push({ label: 'Hand over keys', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/fleet/requests/${q.id}/out`, { odo_out: r.querySelector('#oo').value || undefined }); c(); reload(); } }); }
    if (fleet && q.status === 'out') { body += `<p>Out at ${q.odo_out} km.</p><label class="field"><span>Odometer on return</span><input type="number" id="oi"></label>`; acts.push({ label: 'Vehicle returned', cls: 'btn-primary', onClick: async (c, r) => { const x = await POST(`/fleet/requests/${q.id}/in`, { odo_in: r.querySelector('#oi').value }); toast(`${x.km} km`); c(); reload(); } }); }
    modal({ title: q.number, size: 'lg', body, actions: acts });
  });
}
export function requestDialog(done) {
  const f = [{ key: 'purpose', label: 'What is the vehicle needed for?', required: true, span: 2 }, { key: 'destination', label: 'Where to' }, { key: 'department', label: 'Department' },
    { key: 'depart_at', label: 'Leaving', type: 'datetime-local', required: true }, { key: 'return_at', label: 'Back', type: 'datetime-local', required: true }, { key: 'passengers', label: 'People travelling', type: 'number' }];
  modal({ title: 'Ask for a vehicle', body: formHtml(f, { passengers: 1 }), actions: [{ label: 'Cancel' }, { label: 'Send request', cls: 'btn-primary', onClick: async (c, r) => {
    const v = readForm(r, f); v.depart_at = v.depart_at ? new Date(v.depart_at).toISOString() : ''; v.return_at = v.return_at ? new Date(v.return_at).toISOString() : '';
    const x = await POST('/fleet/requests', v); toast(`Request ${x.number} sent to the fleet office`); c(); done && done();
  } }] });
}
async function drivers(fb) {
  const [rows, staff] = await Promise.all([GET('/fleet/drivers'), GET('/fleet/staff')]);
  const exp = v => v ? (v < today() ? `<b class="neg">expired ${d(v)}</b>` : d(v)) : '<span class="muted">–</span>';
  fb.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="spacer"></span><button class="btn btn-primary" id="dn">＋ Driver details</button></div>
    <div class="card">${tableHtml([{ key: 'first_name', label: 'Driver', fmt: (v, x) => `${v} ${x.last_name || ''}` }, { key: 'phone', label: 'Phone' }, { key: 'licence_no', label: 'Licence no.' }, { key: 'licence_codes', label: 'Codes' },
      { key: 'licence_expiry', label: 'Licence expires', html: 1, fmt: exp }, { key: 'prdp_expiry', label: 'PrDP expires', html: 1, fmt: exp }, { key: 'vehicles', label: 'Vehicles' }, { key: 'incidents', label: 'Incidents', right: 1 }], rows, { rowAttr: x => `data-e="${x.employee_id}"`, empty: 'No drivers yet – staff come from HR.' })}</div>`;
  const dlg = x => {
    const f = [...(x ? [] : [{ key: 'employee_id', label: 'Staff member', type: 'select', options: staff.map(e => ({ value: e.id, label: `${e.first_name} ${e.last_name || ''}` })) }]),
      { key: 'licence_no', label: 'Licence number' }, { key: 'licence_codes', label: 'Codes (e.g. B, C1, EC)' }, { key: 'licence_expiry', label: 'Licence expires', type: 'date' }, { key: 'prdp_expiry', label: 'Professional driving permit expires', type: 'date' }, { key: 'notes', label: 'Notes', span: 2 }];
    modal({ title: x ? `${x.first_name} ${x.last_name || ''}` : 'Driver details', body: formHtml(f, x || {}), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); await PUT(`/fleet/drivers/${x ? x.employee_id : v.employee_id}`, v); c(); drivers(fb); } }] });
  };
  $('#dn').onclick = () => dlg(null);
  $$('[data-e]', fb).forEach(tr => tr.onclick = () => dlg(rows.find(x => x.employee_id === Number(tr.dataset.e))));
}
async function incidents(fb) {
  const rows = await GET('/fleet/incidents');
  fb.innerHTML = `<div class="card">${incTable(rows, true)}</div>`;
  wireInc(fb, rows, () => incidents(fb));
}
const incTable = (rows, withVehicle) => tableHtml([{ key: 'incident_date', label: 'Date', fmt: d }, ...(withVehicle ? [{ key: 'reg_no', label: 'Vehicle' }] : []), { key: 'kind', label: 'What', fmt: v => IK[v] || v }, { key: 'description', label: 'Details' },
  { key: 'driver_name', label: 'Driver' }, { key: 'amount', label: 'Cost', right: 1, fmt: money }, { key: 'recover_from_driver', label: '', fmt: v => v ? 'recover from driver' : '' },
  { key: 'claim_status', label: 'Insurance', html: 1, fmt: (v, i) => v === 'none' ? '' : `${badge(v, v === 'paid' ? 'ok' : v === 'rejected' ? 'cancelled' : 'draft')} ${esc(i.claim_no || '')}${i.claim_amount ? ' ' + money(i.claim_amount) : ''}` },
  { key: 'status', label: '', html: 1, fmt: v => v === 'open' ? badge('open', 'partial') : '' }], rows, { rowAttr: i => `data-i="${i.id}"`, empty: 'No fines or accidents recorded.' });
function wireInc(root, rows, reload) {
  $$('[data-i]', root).forEach(tr => tr.onclick = async () => {
    const i = rows.find(x => x.id === Number(tr.dataset.i)), ms = await methods();
    const f = [{ key: 'claim_no', label: 'Insurance claim number' }, { key: 'claim_status', label: 'Claim', type: 'select', options: ['none', 'lodged', 'paid', 'rejected'].map(v => ({ value: v, label: v })) },
      { key: 'claim_amount', label: 'Amount the insurer paid', type: 'number' }, { key: 'method_id', label: 'Paid into', type: 'select', options: ms.map(m => ({ value: m.id, label: m.name })) }, { key: 'status', label: 'Status', type: 'select', options: [{ value: 'open', label: 'open' }, { value: 'closed', label: 'closed' }] }];
    modal({ title: `${IK[i.kind]} – ${i.reg_no || ''}`, body: `<p>${esc(i.description)}</p>${formHtml(f, i)}`, actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await PUT('/fleet/incidents/' + i.id, readForm(r, f)); c(); reload(); } }] });
  });
}
async function costs(fb) {
  const q = query(), to = q.to || today(), from = q.from || to.slice(0, 4) + '-01-01';
  const x = await GET(`/fleet/costs?from=${from}&to=${to}`);
  fb.innerHTML = `<div class="card"><div class="row" style="margin-bottom:8px"><label>From <input type="date" id="cf" value="${from}"></label><label>To <input type="date" id="ct" value="${to}"></label><button class="btn" id="cg">Show</button></div>
    ${tableHtml([{ key: 'reg_no', label: 'Vehicle' }, { key: 'km', label: 'km', right: 1, fmt: qty }, { key: 'km_per_litre', label: 'km / litre', right: 1, html: 1, fmt: (v, r) => v == null ? '' : `${r.fuel_flag ? '<b class="neg" title="Below 80% of the expected – check for leaks, theft or driving habits">⚠ ' : ''}${v}${r.expected_km_per_litre ? ` <small class="muted">(expect ${r.expected_km_per_litre})</small>` : ''}${r.fuel_flag ? '</b>' : ''}` },
      { key: 'fuel', label: 'Fuel', right: 1, fmt: money }, { key: 'servicing', label: 'Servicing & repairs', right: 1, fmt: money }, { key: 'fines', label: 'Fines', right: 1, fmt: money }, { key: 'damage', label: 'Accidents & damage', right: 1, fmt: money },
      { key: 'depreciation', label: 'Depreciation', right: 1, fmt: money }, { key: 'total', label: 'Total cost', right: 1, fmt: money }, { key: 'per_km', label: 'Cost per km', right: 1, html: 1, fmt: v => v == null ? '' : `<b>${money(v)}</b>` }], x.rows, { rowAttr: r => `data-v="${r.vehicle_id}"`, empty: 'No vehicles.' })}
    <p class="muted">km from trips, vehicle requests and odometer readings. Depreciation comes from the asset register when the vehicle is linked to its asset.</p></div>`;
  $('#cg').onclick = () => { location.hash = `#/fleet?tab=costs&from=${$('#cf').value}&to=${$('#ct').value}`; };
  $$('[data-v]', fb).forEach(tr => tr.onclick = () => { location.hash = '#/vehicle/' + tr.dataset.v; });
}
export const TABS = { due, requests, drivers, incidents, costs };
export const TAB_LABELS = [['due', 'Due & alerts'], ['requests', 'Vehicle requests'], ['drivers', 'Drivers'], ['incidents', 'Fines & accidents'], ['costs', 'Cost per km']];

/* ============================== on a vehicle ============================== */
export const VTAB_LABELS = [['service', 'Servicing'], ['incidents', 'Fines & accidents'], ['bookings', 'Bookings']];
export async function vehicleTab(tab, vb, v, reload) {
  const m = await GET(`/vehicles/${v.id}/more`);
  if (tab === 'service') {
    const s = m.schedule;
    vb.innerHTML = `<div class="row wrap" style="margin-bottom:10px"><div>${s.next_km !== null || s.next_date ? `Next service: ${[s.next_km !== null ? `<b>${qty(s.next_km)} km</b> (${qty(s.km_left)} km to go)` : '', s.next_date ? `by <b>${d(s.next_date)}</b>` : ''].filter(Boolean).join(' or ')} ${s.overdue ? badge('overdue', 'cancelled') : s.due ? badge('due soon', 'draft') : badge('ok', 'ok')}` : '<span class="muted">No service schedule – set it with ⚙ Setup.</span>'}</div>
      <span class="spacer"></span>${m.asset ? `<span class="muted">Asset <a href="#/asset/${m.asset.id}">${esc(m.asset.asset_no)}</a> · book value ${money(m.asset.nbv)}</span>` : ''}</div>
      ${tableHtml([{ key: 'service_date', label: 'Date', fmt: d }, { key: 'kind', label: 'What', fmt: k => SK[k] || k }, { key: 'description', label: 'Details' }, { key: 'odometer', label: 'km', right: 1, fmt: o => o == null ? '' : qty(o) },
        { key: 'workshop', label: 'Workshop', fmt: (w, x) => w || x.supplier_name || '' }, { key: 'cost', label: 'Cost', right: 1, fmt: money }], m.services, { empty: 'No services recorded.' })}`;
  }
  if (tab === 'incidents') { vb.innerHTML = incTable(m.incidents.map(i => ({ ...i, reg_no: v.reg_no })), false); wireInc(vb, m.incidents.map(i => ({ ...i, reg_no: v.reg_no })), reload); }
  if (tab === 'bookings') { vb.innerHTML = reqTable(m.requests); wireReq(vb, m.requests, reload); }
  return m;
}
export async function vehicleButtons(v, reload) {
  const [staff, ms, sups] = await Promise.all([GET('/fleet/staff'), methods(), GET('/partners?is_supplier=1').catch(() => [])]);
  const pay = [{ key: 'pay', label: 'Paid', type: 'select', options: [{ value: 'method', label: 'Paid now' }, { value: 'supplier', label: 'On the workshop\'s account (bill comes later)' }, { value: 'bill', label: 'Already on a supplier bill' }] },
    { key: 'method_id', label: 'Paid with', type: 'select', options: ms.map(m => ({ value: m.id, label: m.name })) }, { key: 'supplier_id', label: 'Workshop (supplier)', type: 'select', options: [{ value: '', label: '–' }, ...sups.map(s => ({ value: s.id, label: s.name }))] }];
  const payOf = x => ({ method_id: x.pay === 'method' ? x.method_id : null, supplier_id: x.pay === 'supplier' ? x.supplier_id : null, on_bill: x.pay === 'bill' });
  const on = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
  on('vs', () => {
    const f = [{ key: 'kind', label: 'What', type: 'select', options: Object.entries(SK).map(([value, label]) => ({ value, label })) }, { key: 'date', label: 'Date', type: 'date' }, { key: 'odometer', label: 'Odometer km', type: 'number' },
      { key: 'workshop', label: 'Workshop' }, { key: 'description', label: 'Work done / parts', span: 2 }, { key: 'cost', label: 'Cost', type: 'number' }, ...pay];
    modal({ title: `Service / repair – ${v.reg_no}`, body: formHtml(f, { kind: 'service', date: today(), odometer: v.odometer, pay: 'method' }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const x = readForm(r, f); await POST(`/vehicles/${v.id}/services`, { ...x, ...payOf(x) }); toast('Saved'); c(); reload(); } }] });
  });
  on('vi', () => {
    const f = [{ key: 'kind', label: 'What happened', type: 'select', options: Object.entries(IK).map(([value, label]) => ({ value, label })) }, { key: 'date', label: 'Date', type: 'date' },
      { key: 'driver_id', label: 'Driver', type: 'select', options: [{ value: '', label: '–' }, ...staff.map(e => ({ value: e.id, label: `${e.first_name} ${e.last_name || ''}` }))] }, { key: 'place', label: 'Where' },
      { key: 'description', label: 'Details', span: 2, required: true }, { key: 'reference', label: 'Ticket / police case number' }, { key: 'amount', label: 'Fine / cost', type: 'number' },
      { key: 'method_id', label: 'Paid now with (empty = not paid yet)', type: 'select', options: [{ value: '', label: '–' }, ...ms.map(m => ({ value: m.id, label: m.name }))] },
      { key: 'recover_from_driver', label: 'Recover from the driver', type: 'checkbox' }, { key: 'claim_no', label: 'Insurance claim number' }, { key: 'off_road', label: 'Vehicle is off the road', type: 'checkbox' }];
    modal({ title: `Fine / accident – ${v.reg_no}`, size: 'lg', body: formHtml(f, { kind: 'fine', date: today(), driver_id: v.driver_id }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/vehicles/${v.id}/incidents`, readForm(r, f)); c(); reload(); } }] });
  });
  on('vset', async () => {
    const m = await GET(`/vehicles/${v.id}/more`);
    const f = [{ type: 'heading', label: 'Service schedule' }, { key: 'service_interval_km', label: 'Service every … km', type: 'number', nullable: true }, { key: 'service_interval_months', label: '… or every … months', type: 'number', nullable: true },
      { key: 'last_service_km', label: 'Last service at km', type: 'number', nullable: true }, { key: 'last_service_date', label: 'Last service date', type: 'date' },
      { type: 'heading', label: 'Other' }, { key: 'expected_km_per_litre', label: 'Expected km per litre (fuel alerts)', type: 'number', nullable: true }, { key: 'vin', label: 'VIN / chassis number' }, { key: 'fuel_card', label: 'Fuel card number' },
      { key: 'department', label: 'Department' }, { key: 'pool', label: 'Pool vehicle (staff can book it)', type: 'checkbox' }];
    modal({ title: `Setup – ${v.reg_no}`, body: formHtml(f, m.setup), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await PUT(`/vehicles/${v.id}/setup`, readForm(r, f)); c(); reload(); } }] });
  });
}

/* ============================== for every staff member ============================== */
export async function myVehicleRequests(view) {
  const rows = await GET('/fleet/requests');
  view.innerHTML = page('Vehicle requests', '<button class="btn btn-primary" id="rqn">＋ Ask for a vehicle</button>', `<div class="card">${reqTable(rows)}</div>`);
  $('#rqn').onclick = () => requestDialog(() => myVehicleRequests(view));
  wireReq(view, rows, () => myVehicleRequests(view));
}
