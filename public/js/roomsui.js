// Rooms & bookings: front desk, calendar, bookings, guest bill, setup
import { state, GET, POST, PUT, esc, $, $$, toast, err, can, money, qty, modal, confirmBox, formHtml, readForm, tableHtml, badge, page, d, dt, today, plusDays, query, printHtml } from './core.js';

const BS = { reserved: ['reserved', 'draft'], checked_in: ['in house', 'ok'], checked_out: ['checked out', 'paid'], cancelled: ['cancelled', 'closed'], no_show: ['no-show', 'cancelled'] };
const bsBadge = s => badge((BS[s] || [s])[0], (BS[s] || [s, ''])[1]);
const HK = { clean: ['clean', 'ok'], dirty: ['dirty', 'draft'], out_of_order: ['out of order', 'cancelled'] };
const methods = async () => (await GET('/payment-methods')).filter(m => m.active && m.kind !== 'account');

export async function rooms(view) {
  const q = query(); const tab = q.tab || 'desk';
  const tabs = [['desk', 'Front desk'], ['calendar', 'Calendar'], ['bookings', 'Bookings'], ['setup', 'Rooms & rates']];
  view.innerHTML = page('Rooms & bookings', '<button class="btn btn-primary" id="nb">＋ New booking</button>', `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/rooms?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="rb"></div>`);
  $('#nb').onclick = () => bookingDialog({}, id => { location.hash = '#/booking/' + id; });
  const rb = $('#rb');
  if (tab === 'desk') {
    const [st, rs, arr, dep] = await Promise.all([GET('/rooms/stats'), GET('/rooms'), GET('/bookings?view=arrivals'), GET('/bookings?view=departures')]);
    rb.innerHTML = `<div class="cols cols-4" style="margin-bottom:14px"><div class="kpi"><div class="label">In house</div><div class="value">${st.inhouse} / ${st.rooms}</div></div>
      <div class="kpi"><div class="label">Arriving today</div><div class="value">${arr.length}</div></div><div class="kpi"><div class="label">Leaving today</div><div class="value">${dep.length}</div></div>
      <div class="kpi"><div class="label">Occupancy this month</div><div class="value">${st.occupancy}%</div><div class="hint">avg rate ${money(st.adr)} · RevPAR ${money(st.revpar)}</div></div></div>
      <div class="room-board">${rs.map(x => `<div class="room-card ${x.occupied_by ? 'occ' : ''}" data-r="${x.id}"><div class="row"><b style="flex:1">${esc(x.name)}</b>${badge(HK[x.housekeeping][0], HK[x.housekeeping][1])}</div>
        <small class="muted">${esc(x.type_name)}</small><div style="margin-top:6px;min-height:34px">${x.occupied_by ? `<b>${esc(x.guest_name)}</b><br><small>leaves ${esc(d(x.leaves))}</small>` : x.arriving ? '<small>arrival today</small>' : '<small class="muted">free</small>'}</div>
        <div class="row" style="gap:4px;margin-top:6px">${x.housekeeping !== 'clean' ? `<button class="btn btn-sm" data-hk="${x.id}:clean">Clean</button>` : `<button class="btn btn-sm" data-hk="${x.id}:dirty">Dirty</button>`}${x.occupied_by ? `<a class="btn btn-sm btn-primary" href="#/booking/${x.occupied_by}">Bill</a>` : x.arriving ? `<a class="btn btn-sm btn-primary" href="#/booking/${x.arriving}">Arrive</a>` : ''}</div></div>`).join('') || '<div class="muted">Add room types and rooms under "Rooms & rates".</div>'}</div>
      <div class="cols cols-2" style="margin-top:14px"><div class="card"><h3>Arrivals</h3>${tableHtml([{ key: 'guest_name', label: 'Guest' }, { key: 'room_name', label: 'Room' }, { key: 'nights', label: 'Nights', right: 1 }, { key: 'guest_phone', label: 'Phone' }], arr, { rowAttr: b => `data-b="${b.id}"`, empty: 'Nobody arriving.' })}</div>
        <div class="card"><h3>Departures</h3>${tableHtml([{ key: 'guest_name', label: 'Guest' }, { key: 'room_name', label: 'Room' }, { key: 'check_out', label: 'Due out', fmt: d }], dep, { rowAttr: b => `data-b="${b.id}"`, empty: 'Nobody leaving.' })}</div></div>`;
    $$('[data-hk]', rb).forEach(b => b.onclick = async e => { e.stopPropagation(); const [id, s] = b.dataset.hk.split(':'); await PUT(`/rooms/${id}/housekeeping`, { status: s }); rooms(view); });
    $$('[data-b]', rb).forEach(tr => tr.onclick = () => { location.hash = '#/booking/' + tr.dataset.b; });
    $$('.room-card:not(.occ)', rb).forEach(c => c.ondblclick = () => bookingDialog({ room_id: Number(c.dataset.r) }, id => { location.hash = '#/booking/' + id; }));
  }
  if (tab === 'calendar') {
    const from = q.from || today();
    const c = await GET(`/rooms/calendar?from=${from}&days=14`);
    rb.innerHTML = `<div class="card"><div class="row" style="margin-bottom:8px"><button class="btn btn-sm" id="cp">◀</button><input type="date" id="cf" value="${from}" style="max-width:170px"><button class="btn btn-sm" id="cn">▶</button><span class="spacer"></span><small class="muted">Click an empty night to book it</small></div>
      <div class="table-wrap"><table class="grid cal"><thead><tr><th>Room</th>${c.dates.map(x => `<th class="r">${new Date(x + 'T12:00:00').toLocaleDateString([], { weekday: 'short' })}<br>${x.slice(8)}</th>`).join('')}</tr></thead><tbody>
      ${c.rooms.map(r0 => `<tr><td><b>${esc(r0.name)}</b><br><small class="muted">${esc(r0.type_name)}</small></td>${c.dates.map(x => { const b = c.bookings.find(k => k.room_id === r0.id && k.check_in <= x && k.check_out > x);
        return b ? `<td class="cal-b cal-${b.status}" data-b="${b.id}" title="${esc(b.guest_name)} ${esc(b.check_in)} → ${esc(b.check_out)}">${b.check_in === x || x === c.dates[0] ? esc(b.guest_name.split(' ')[0]) : ''}</td>` : `<td class="cal-free" data-room="${r0.id}" data-day="${x}"></td>`; }).join('')}</tr>`).join('')}</tbody></table></div></div>`;
    const go = f => { location.hash = '#/rooms?tab=calendar&from=' + f; };
    $('#cf').onchange = () => go($('#cf').value); $('#cp').onclick = () => go(shift(from, -7)); $('#cn').onclick = () => go(shift(from, 7));
    $$('[data-b]', rb).forEach(td => td.onclick = () => { location.hash = '#/booking/' + td.dataset.b; });
    $$('[data-room]', rb).forEach(td => td.onclick = () => bookingDialog({ room_id: Number(td.dataset.room), check_in: td.dataset.day, check_out: shift(td.dataset.day, 1) }, id => { location.hash = '#/booking/' + id; }));
  }
  if (tab === 'bookings') {
    const v = q.view || 'upcoming';
    const rows = await GET(`/bookings?view=${v}${q.q ? '&q=' + encodeURIComponent(q.q) : ''}`);
    rb.innerHTML = `<div class="row wrap" style="margin-bottom:8px">${[['upcoming', 'Upcoming & in house'], ['inhouse', 'In house'], ['all', 'All']].map(([k, l]) => `<a class="btn btn-sm ${k === v ? 'btn-primary' : ''}" href="#/rooms?tab=bookings&view=${k}">${l}</a>`).join('')}<span class="spacer"></span><input id="bq" placeholder="Guest, phone or number" value="${esc(q.q || '')}" style="max-width:240px"></div>
      <div class="card">${tableHtml([{ key: 'number', label: 'Booking' }, { key: 'guest_name', label: 'Guest' }, { key: 'guest_phone', label: 'Phone' }, { key: 'room_name', label: 'Room' }, { key: 'check_in', label: 'Arrive', fmt: d }, { key: 'check_out', label: 'Leave', fmt: d },
        { key: 'nights', label: 'Nights', right: 1 }, { key: 'rate', label: 'Rate', right: 1, fmt: money }, { key: 'source', label: 'Source' }, { key: 'status', label: 'Status', html: 1, fmt: bsBadge }], rows, { rowAttr: b => `data-b="${b.id}"`, empty: 'No bookings.' })}</div>`;
    $$('[data-b]', rb).forEach(tr => tr.onclick = () => { location.hash = '#/booking/' + tr.dataset.b; });
    let t; $('#bq').oninput = e => { clearTimeout(t); t = setTimeout(() => { location.hash = `#/rooms?tab=bookings&view=all&q=${encodeURIComponent(e.target.value)}`; }, 500); };
  }
  if (tab === 'setup') {
    const [types, rs] = await Promise.all([GET('/room-types?all=1'), GET('/rooms?all=1')]);
    rb.innerHTML = `<div class="cols cols-2" style="align-items:start"><div class="card"><div class="row" style="margin-bottom:8px"><h3 style="flex:1">Room types & rates</h3><button class="btn btn-sm btn-primary" id="nt">＋ Type</button></div>
      ${tableHtml([{ key: 'name', label: 'Type' }, { key: 'rate', label: 'Rate / night incl. VAT', right: 1, fmt: money }, { key: 'capacity', label: 'Sleeps', right: 1 }, { key: 'breakfast', label: 'Breakfast', fmt: v => v ? '✓' : '' }, { key: 'rooms', label: 'Rooms', right: 1 }], types, { rowAttr: t => `data-t="${t.id}"`, empty: 'No room types yet.' })}</div>
      <div class="card"><div class="row" style="margin-bottom:8px"><h3 style="flex:1">Rooms</h3><button class="btn btn-sm btn-primary" id="nr">＋ Room</button></div>
      ${tableHtml([{ key: 'name', label: 'Room' }, { key: 'type_name', label: 'Type' }, { key: 'floor', label: 'Floor / block' }, { key: 'housekeeping', label: 'Status', html: 1, fmt: v => badge(HK[v][0], HK[v][1]) }, { key: 'active', label: 'In use', fmt: v => v ? '✓' : '' }], rs, { rowAttr: x => `data-x="${x.id}"`, empty: 'No rooms yet.' })}</div></div>`;
    const tdlg = t => { const f = [{ key: 'name', label: 'Room type', required: true }, { key: 'rate', label: 'Rate per night incl. VAT (M)', type: 'number', required: true }, { key: 'capacity', label: 'Sleeps', type: 'number' }, { key: 'breakfast', label: 'Breakfast included', type: 'checkbox' }, ...(t ? [{ key: 'active', label: 'In use', type: 'checkbox' }] : [])];
      modal({ title: t ? t.name : 'New room type', body: formHtml(f, t || { capacity: 2 }, { ctx: 'roomtype' }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); if (t) await PUT('/room-types/' + t.id, v); else await POST('/room-types', v); c(); rooms(view); } }] }); };
    const rdlg = x => { const f = [{ key: 'name', label: 'Room', required: true }, { key: 'room_type_id', label: 'Type', type: 'select', numeric: true, options: types.filter(t => t.active).map(t => ({ value: t.id, label: `${t.name} (${money(t.rate)})` })) }, { key: 'floor', label: 'Floor / block' },
      { key: 'housekeeping', label: 'Status', type: 'select', options: Object.entries(HK).map(([value, [label]]) => ({ value, label })) }, { key: 'notes', label: 'Notes', span: 2 }, ...(x ? [{ key: 'active', label: 'In use', type: 'checkbox' }] : [])];
      modal({ title: x ? x.name : 'New room', body: formHtml(f, x || { housekeeping: 'clean' }, { ctx: 'room' }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); if (x) await PUT('/rooms/' + x.id, v); else await POST('/rooms', v); c(); rooms(view); } }] }); };
    $('#nt').onclick = () => tdlg(null); $('#nr').onclick = () => { if (!types.length) return toast('Add a room type first', 'err'); rdlg(null); };
    $$('[data-t]', rb).forEach(tr => tr.onclick = () => tdlg(types.find(t => String(t.id) === tr.dataset.t)));
    $$('[data-x]', rb).forEach(tr => tr.onclick = () => rdlg(rs.find(x => String(x.id) === tr.dataset.x)));
  }
}
const shift = (day, n) => { const x = new Date(day + 'T12:00:00'); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

async function bookingDialog(pre, done) {
  const guests = await GET('/partners?is_customer=1');
  const f = [{ key: 'check_in', label: 'Arrival', type: 'date', required: true }, { key: 'check_out', label: 'Departure', type: 'date', required: true },
    { key: 'room_id', label: 'Room', type: 'select', numeric: true, options: [] }, { key: 'rate', label: 'Rate per night incl. VAT', type: 'number' },
    { key: 'guest_id', label: 'Guest', type: 'select', numeric: true, options: [{ value: '', label: '— new guest (fill in below) —' }, ...guests.map(g => ({ value: g.id, label: `${g.name}${g.phone ? ' · ' + g.phone : ''}` }))] },
    { key: 'guest_name', label: 'New guest: name' }, { key: 'guest_phone', label: 'New guest: phone' }, { key: 'adults', label: 'Adults', type: 'number' }, { key: 'children', label: 'Children', type: 'number' },
    { key: 'source', label: 'Booked by', type: 'select', options: [['phone', 'Phone'], ['walk_in', 'Walk-in'], ['whatsapp', 'WhatsApp'], ['email', 'Email'], ['booking_site', 'Booking website'], ['agent', 'Travel agent'], ['other', 'Other']].map(([value, label]) => ({ value, label })) },
    { key: 'company_id', label: 'Company pays (optional)', type: 'select', numeric: true, options: [{ value: '', label: '— guest pays —' }, ...guests.map(g => ({ value: g.id, label: g.name }))] },
    { key: 'notes', label: 'Notes', span: 2 }, { key: 'check_in_now', label: 'Guest is here – check in now', type: 'checkbox', span: 2 }];
  modal({ title: 'New booking', size: 'lg', body: formHtml(f, { check_in: pre.check_in || today(), check_out: pre.check_out || plusDays(1), adults: 1, children: 0, source: 'phone' }, { ctx: 'booking' }),
    onOpen: async r => {
      const load = async () => {
        const ci = r.querySelector('[name=check_in]').value, co = r.querySelector('[name=check_out]').value, sel = r.querySelector('[name=room_id]');
        if (!ci || !co || co <= ci) { sel.innerHTML = '<option value="">choose dates</option>'; return; }
        const free = await GET(`/rooms/free?check_in=${ci}&check_out=${co}`).catch(() => []);
        sel.innerHTML = free.map(x => `<option value="${x.id}" data-rate="${x.rate}" ${x.id === pre.room_id ? 'selected' : ''}>${esc(x.name)} – ${esc(x.type_name)} (${money(x.rate)})${x.housekeeping === 'dirty' ? ' · dirty' : ''}</option>`).join('') || '<option value="">no room free for these dates</option>';
        const o = sel.selectedOptions[0]; if (o && o.dataset.rate) r.querySelector('[name=rate]').value = o.dataset.rate;
      };
      r.querySelector('[name=check_in]').onchange = load; r.querySelector('[name=check_out]').onchange = load;
      r.querySelector('[name=room_id]').onchange = e => { const o = e.target.selectedOptions[0]; if (o && o.dataset.rate) r.querySelector('[name=rate]').value = o.dataset.rate; };
      r.querySelector('[name=check_in_now]').checked = (pre.check_in || today()) === today() && !!pre.walk_in;
      await load();
    },
    actions: [{ label: 'Cancel' }, { label: 'Book', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); const b = await POST('/bookings', v); c(); toast(`${b.number} booked`); done(b.id); } }] });
}

export async function booking(view, [idq]) {
  const id = (idq || '').split('?')[0];
  const b = await GET('/bookings/' + id);
  const fo = b.folio;
  const acts = [];
  if (b.status === 'reserved') acts.push('<button class="btn btn-ok" id="bi">✓ Check in</button>', '<button class="btn" id="bd">Deposit</button>', '<button class="btn" id="be">Change</button>', '<button class="btn btn-danger" id="bc">Cancel</button>');
  if (b.status === 'checked_in') acts.push('<button class="btn" id="bx">＋ Charge</button>', '<button class="btn" id="bd">Payment</button>', '<button class="btn" id="be">Extend / move</button>', '<button class="btn btn-primary" id="bo">Check out</button>');
  acts.push('<button class="btn" id="bp">🖨 Bill</button>');
  view.innerHTML = page(`${b.number} · ${b.guest_name}`, acts.join(''), `<div class="cols cols-4" style="margin-bottom:14px">
      <div class="kpi"><div class="label">Room</div><div class="value" style="font-size:20px">${esc(b.room_name)}</div><div class="hint">${esc(b.type_name)} · ${b.adults} adult(s)${b.children ? `, ${b.children} child(ren)` : ''}</div></div>
      <div class="kpi"><div class="label">Stay</div><div class="value" style="font-size:18px">${esc(d(b.check_in))} → ${esc(d(b.check_out))}</div><div class="hint">${b.nights} night(s) at ${money(b.rate)}</div></div>
      <div class="kpi"><div class="label">Status</div><div class="value" style="font-size:18px">${bsBadge(b.status)}</div><div class="hint">${esc(b.source.replace('_', ' '))}${b.company_name ? ' · billed to ' + esc(b.company_name) : ''}</div></div>
      <div class="kpi"><div class="label">${b.invoice_id ? 'Still owed' : 'To pay'}</div><div class="value" style="color:${fo.balance > 0 ? 'var(--bad)' : 'var(--ok)'}">${money(b.invoice_id ? (fo.invoice_open ?? 0) : fo.balance)}</div></div></div>
    <div class="card"><h3>Guest bill</h3><table class="grid report-table"><tr><td>Room: ${fo.nights} night(s) × ${money(b.rate)}</td><td class="r">${money(fo.room)}</td></tr>
      ${fo.extras.map(x => `<tr><td>${esc(x.description)} <small class="muted">${esc(d(x.charge_date))}</small></td><td class="r">${money(x.amount)}</td></tr>`).join('')}
      ${b.pos_charges.map(o => `<tr><td>Restaurant / bar ${esc(o.number)} <small class="muted">${esc(dt(o.paid_at))}</small></td><td class="r">${money(o.total)}</td></tr>`).join('')}
      <tr class="tot"><td>Guest account (restaurant/bar less deposits & payments)</td><td class="r">${money(fo.account_balance)}</td></tr>
      <tr class="tot"><td><b>${b.invoice_id ? 'Invoiced – see invoice' : 'Total to pay at check-out'}</b></td><td class="r"><b>${money(b.invoice_id ? (fo.invoice_open ?? 0) : fo.balance)}</b></td></tr></table>
      ${b.invoice_id ? `<a class="btn btn-sm" href="#/invoice/${b.invoice_id}" style="margin-top:8px">Open invoice</a>` : ''}
      ${b.notes ? `<p class="muted">${esc(b.notes)}</p>` : ''}<p class="muted">Phone ${esc(b.guest_phone || '–')} · <a href="#/customer/${b.guest_id}">guest card</a></p></div>`, { back: '#/rooms' });
  const reload = () => booking(view, [id]);
  const ms = await methods();
  const pay = (title, path, amount, extra = {}) => { const f = [{ key: 'amount', label: 'Amount (M)', type: 'number' }, { key: 'method_id', label: 'Paid by', type: 'select', numeric: true, options: ms.map(m => ({ value: m.id, label: m.name })) }, { key: 'reference', label: 'Reference' }];
    modal({ title, body: formHtml(f, { amount }, { ctx: 'bookpay' }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const o = await POST(`/bookings/${b.id}/${path}`, { ...readForm(r, f), ...extra }); c(); if (path === 'checkout') { toast(`Checked out – ${o.number}`); } reload(); } }] }); };
  if ($('#bi')) $('#bi').onclick = async () => { try { await POST(`/bookings/${b.id}/checkin`); toast('Checked in'); reload(); } catch (e) { err(e); } };
  if ($('#bd')) $('#bd').onclick = () => pay(b.status === 'reserved' ? 'Deposit' : 'Payment on account', 'deposit', '');
  if ($('#bx')) $('#bx').onclick = () => { const f = [{ key: 'description', label: 'What (laundry, phone, minibar, extra bed…)', required: true }, { key: 'amount', label: 'Amount incl. VAT (M)', type: 'number', required: true }, { key: 'date', label: 'Date', type: 'date' }];
    modal({ title: 'Charge to the room', body: formHtml(f, { date: today() }, { ctx: 'roomcharge' }), actions: [{ label: 'Cancel' }, { label: 'Add', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/bookings/${b.id}/charges`, readForm(r, f)); c(); reload(); } }] }); };
  if ($('#be')) $('#be').onclick = async () => {
    const rs = await GET('/rooms');
    const f = [{ key: 'check_in', label: 'Arrival', type: 'date' }, { key: 'check_out', label: 'Departure', type: 'date' }, { key: 'room_id', label: 'Room', type: 'select', numeric: true, options: rs.map(x => ({ value: x.id, label: `${x.name} – ${x.type_name}` })) },
      { key: 'rate', label: 'Rate per night', type: 'number' }, { key: 'adults', label: 'Adults', type: 'number' }, { key: 'children', label: 'Children', type: 'number' }, { key: 'notes', label: 'Notes', span: 2 }];
    modal({ title: 'Change booking', body: formHtml(f, { ...b, check_in: d(b.check_in), check_out: d(b.check_out) }, { ctx: 'booking' }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await PUT('/bookings/' + b.id, readForm(r, f)); c(); reload(); } }] });
  };
  if ($('#bc')) $('#bc').onclick = () => modal({ title: 'Cancel booking', body: '<label class="row" style="gap:6px"><input type="checkbox" id="ns"> Guest did not arrive (no-show)</label><input id="cr" placeholder="Reason" style="margin-top:8px">',
    actions: [{ label: 'Back' }, { label: 'Cancel booking', cls: 'btn-danger', onClick: async (c, r) => { await POST(`/bookings/${b.id}/cancel`, { no_show: r.querySelector('#ns').checked, reason: r.querySelector('#cr').value }); c(); reload(); } }] });
  if ($('#bo')) $('#bo').onclick = () => {
    const early = today() < d(b.check_out);
    pay(`Check out ${b.guest_name}${early ? ' (leaving early – charged up to today)' : ''}`, 'checkout', b.company_id ? '' : Math.max(0, fo.balance), { early });
  };
  $('#bp').onclick = () => printHtml(`<div style="font-family:Arial;font-size:13px;max-width:700px;margin:auto"><h2>${esc(state.company.name || '')}</h2><div>${esc(state.company.address || '')} · ${esc(state.company.phone || '')}</div>
    <h1 style="font-size:20px">Guest bill ${esc(b.number)}</h1><p><b>${esc(b.guest_name)}</b> · ${esc(b.room_name)} · ${esc(d(b.check_in))} → ${esc(d(b.check_out))}</p>
    <table border="1" cellpadding="5" style="border-collapse:collapse;width:100%"><tr><td>Room ${fo.nights} night(s) × ${money(b.rate)}</td><td align="right">${money(fo.room)}</td></tr>
    ${fo.extras.map(x => `<tr><td>${esc(x.description)}</td><td align="right">${money(x.amount)}</td></tr>`).join('')}${b.pos_charges.map(o => `<tr><td>Restaurant / bar ${esc(o.number)}</td><td align="right">${money(o.total)}</td></tr>`).join('')}
    <tr><td>Deposits and payments</td><td align="right">${money(Math.min(0, fo.account_balance - b.pos_charges.reduce((t, o) => t + Number(o.total), 0)))}</td></tr></table>
    <p style="text-align:right;font-size:16px">Balance: <b>${money(b.invoice_id ? (fo.invoice_open ?? 0) : fo.balance)}</b></p><p>Thank you for staying with us.</p></div>`);
}
