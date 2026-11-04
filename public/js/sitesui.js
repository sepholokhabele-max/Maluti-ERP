// Sites, guards & cleaners: sites, duty board, rosters, occurrence book, incidents, inspections, consumables, billing, site profit
import { state, GET, POST, PUT, esc, $, $$, toast, err, can, money, qty, modal, confirmBox, formHtml, readForm, tableHtml, badge, page, d, dt, today, plusDays, query, filesCard, printHtml } from './core.js';

const SS = { planned: ['planned', 'draft'], on_duty: ['on duty', 'ok'], done: ['done', 'paid'], absent: ['ABSENT', 'cancelled'], cancelled: ['cancelled', 'closed'] };
const ssBadge = (s, late) => late ? badge('late – not checked in', 'cancelled') : badge((SS[s] || [s])[0], (SS[s] || [s, ''])[1]);
const INC = [['theft', 'Theft'], ['break_in', 'Break-in'], ['trespass', 'Trespass'], ['fire', 'Fire'], ['injury', 'Injury'], ['damage', 'Damage'], ['alarm', 'Alarm'], ['complaint', 'Client complaint'], ['other', 'Other']];
const tm = s => String(s || '').slice(11, 16);
const employees = async () => (await GET('/sites/staff').catch(() => [])).map(e => ({ value: e.id, label: `${e.first_name} ${e.last_name}${e.job_title ? ' · ' + e.job_title : ''}` }));

export async function sites(view) {
  const q = query(); const tab = q.tab || 'board';
  const tabs = [['board', 'Duty board'], ['sites', 'Sites'], ['incidents', 'Incidents'], ['report', 'Hours & profit']];
  view.innerHTML = page('Sites & shifts', `<button class="btn btn-primary" id="ns">＋ New site</button>`, `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/sites?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="sb"></div>`);
  $('#ns').onclick = () => siteDialog(null, id => { location.hash = '#/site/' + id; });
  const sb = $('#sb');
  if (tab === 'board') {
    const day = q.day || today();
    const rows = await GET(`/shifts?from=${day}&to=${day}`);
    const late = rows.filter(x => x.late).length, absent = rows.filter(x => x.status === 'absent').length, on = rows.filter(x => x.status === 'on_duty').length;
    sb.innerHTML = `<div class="cols cols-4" style="margin-bottom:14px"><div class="kpi"><div class="label">On duty now</div><div class="value" style="color:var(--ok)">${on}</div></div>
      <div class="kpi"><div class="label">Late (not checked in)</div><div class="value" style="color:${late ? 'var(--bad)' : 'var(--ok)'}">${late}</div></div>
      <div class="kpi"><div class="label">Absent</div><div class="value" style="color:${absent ? 'var(--warn)' : 'var(--ok)'}">${absent}</div></div><div class="kpi"><div class="label">Shifts ${day === today() ? 'today' : esc(day)}</div><div class="value">${rows.length}</div></div></div>
      <div class="card"><div class="row" style="margin-bottom:8px"><label>Day <input type="date" id="dd" value="${day}"></label><span class="spacer"></span><button class="btn btn-sm" id="rf">↻ Refresh</button></div>
      ${tableHtml([{ key: 'site_name', label: 'Site' }, { key: 'employee_name', label: 'Staff' }, { key: 'role', label: 'Post' }, { key: 'start_at', label: 'Shift', fmt: (v, x) => `${tm(v)}–${tm(x.end_at)}` },
        { key: 'status', label: 'Status', html: 1, fmt: (v, x) => ssBadge(v, x.late) }, { key: 'check_in_at', label: 'In', fmt: tm }, { key: 'check_out_at', label: 'Out', fmt: tm }, { key: 'employee_phone', label: 'Phone' },
        { key: 'id', label: '', html: 1, fmt: (v, x) => shiftButtons(x) }], rows, { empty: 'No shifts planned for this day. Open a site and use Roster.' })}</div>`;
    $('#dd').onchange = () => { location.hash = '#/sites?tab=board&day=' + $('#dd').value; };
    $('#rf').onclick = () => sites(view);
    wireShiftButtons(sb, rows, () => sites(view));
  }
  if (tab === 'sites') {
    const rows = await GET('/sites');
    sb.innerHTML = `<div class="card">${tableHtml([{ key: 'name', label: 'Site' }, { key: 'client_name', label: 'Client' }, { key: 'kind', label: 'Service' },
      { key: 'on_duty', label: 'On duty now', right: 1, html: 1, fmt: (v, s) => `${v}${s.should_be_on > v ? ` <span class="neg">/ ${s.should_be_on}</span>` : ''}${s.late ? ' ⚠' : ''}` },
      { key: 'staff_day', label: 'Needed day / night', fmt: (v, s) => `${v} / ${s.staff_night}` }, { key: 'billing', label: 'Billing', fmt: (v, s) => v === 'contract' ? 'contract' : `${money(s.rate)} ${v === 'per_shift' ? 'per shift' : 'per hour'}` },
      { key: 'open_incidents', label: 'Open incidents', right: 1 }, { key: 'last_score', label: 'Last inspection', right: 1, fmt: v => v == null ? '' : Number(v) + '%' }], rows,
      { rowAttr: s => `data-id="${s.id}"`, empty: 'No sites yet.' })}</div>`;
    $$('[data-id]', sb).forEach(tr => tr.onclick = () => { location.hash = '#/site/' + tr.dataset.id; });
  }
  if (tab === 'incidents') {
    const rows = await GET('/incidents?status=' + (q.status || 'all'));
    sb.innerHTML = `<div class="card">${tableHtml([{ key: 'number', label: 'Number' }, { key: 'occurred_at', label: 'When', fmt: dt }, { key: 'site_name', label: 'Site' }, { key: 'kind', label: 'Type', fmt: v => (INC.find(k => k[0] === v) || [v, v])[1] },
      { key: 'severity', label: 'Severity', html: 1, fmt: v => v === 'high' ? badge('high', 'cancelled') : v }, { key: 'description', label: 'What happened', fmt: v => String(v).slice(0, 80) },
      { key: 'police_case', label: 'Police case' }, { key: 'status', label: 'Status', html: 1, fmt: v => v === 'open' ? badge('open', 'draft') : badge('closed', 'closed') }], rows,
      { rowAttr: i => `data-s="${i.site_id}"`, empty: 'No incidents reported.' })}</div>`;
    $$('[data-s]', sb).forEach(tr => tr.onclick = () => { location.hash = '#/site/' + tr.dataset.s; });
  }
  if (tab === 'report') {
    const to = q.to || today(), from = q.from || to.slice(0, 8) + '01';
    const r = await GET(`/sites/report?from=${from}&to=${to}`);
    sb.innerHTML = `<div class="row wrap" style="margin-bottom:8px"><label>From <input type="date" id="rf" value="${from}"></label><label>To <input type="date" id="rt" value="${to}"></label><button class="btn" id="rg">Show</button></div>
      <div class="card"><h3>Profit per site</h3>${tableHtml([{ key: 'name', label: 'Site' }, { key: 'shifts', label: 'Shifts', right: 1 }, { key: 'hours', label: 'Hours', right: 1, fmt: qty }, { key: 'absent', label: 'Absences', right: 1 },
        { key: 'income', label: 'Invoiced (excl. VAT)', right: 1, fmt: money }, { key: 'labour', label: 'Staff cost', right: 1, fmt: money }, { key: 'consumables', label: 'Consumables', right: 1, fmt: money },
        { key: 'profit', label: 'Profit', right: 1, html: 1, fmt: v => `<b class="${v < 0 ? 'neg' : ''}">${money(v)}</b>` }], r.sites, { empty: 'No shifts in this period.' })}
        <small class="help-note">Staff cost = hours worked × each employee's basic salary per hour (HR). Income = invoices for the site or its contract.</small></div>
      <div class="card" style="margin-top:14px"><h3>Hours per person</h3>${tableHtml([{ key: 'name', label: 'Staff' }, { key: 'shifts', label: 'Shifts', right: 1 }, { key: 'hours', label: 'Hours', right: 1, fmt: qty }, { key: 'absent', label: 'Absent', right: 1, html: 1, fmt: v => v ? `<b class="neg">${v}</b>` : '' }, { key: 'sites', label: 'Sites' }], r.people)}</div>`;
    $('#rg').onclick = () => { location.hash = `#/sites?tab=report&from=${$('#rf').value}&to=${$('#rt').value}`; };
  }
}

function shiftButtons(x) {
  if (x.status === 'planned') return `<button class="btn btn-sm btn-ok" data-in="${x.id}">On duty</button> <button class="btn btn-sm" data-ab="${x.id}">Absent</button>`;
  if (x.status === 'on_duty') return `<button class="btn btn-sm" data-out="${x.id}">Off duty</button> <button class="btn btn-sm" data-ab="${x.id}">Absent</button>`;
  return '';
}
function wireShiftButtons(root, rows, reload) {
  $$('[data-in]', root).forEach(b => b.onclick = async e => { e.stopPropagation(); try { await POST(`/shifts/${b.dataset.in}/checkin`, {}); reload(); } catch (x) { err(x); } });
  $$('[data-out]', root).forEach(b => b.onclick = async e => { e.stopPropagation(); try { await POST(`/shifts/${b.dataset.out}/checkout`, {}); reload(); } catch (x) { err(x); } });
  $$('[data-ab]', root).forEach(b => b.onclick = async e => {
    e.stopPropagation();
    const x = rows.find(s => String(s.id) === b.dataset.ab);
    const emps = (await employees()).filter(o => o.value !== x.employee_id);
    const f = [{ key: 'reason', label: 'Reason (sick, no-show, leave…)' }, { key: 'replacement_id', label: 'Relief sent', type: 'select', numeric: true, options: [{ value: '', label: '— no relief —' }, ...emps] }];
    modal({ title: `${x.employee_name} absent at ${x.site_name}`, body: formHtml(f, {}, { ctx: 'absent' }), actions: [{ label: 'Cancel' },
      { label: 'Save', cls: 'btn-danger', onClick: async (c, r) => { await POST(`/shifts/${x.id}/absent`, readForm(r, f)); c(); reload(); } }] });
  });
}

async function siteDialog(s, done) {
  const [clients, contracts] = await Promise.all([GET('/partners?is_customer=1'), GET('/contracts?status=current').then(r => r.rows).catch(() => [])]);
  const f = [{ key: 'name', label: 'Site name', required: true, span: 2 }, { key: 'partner_id', label: 'Client', type: 'select', numeric: true, required: true, options: clients.map(c => ({ value: c.id, label: c.name })) },
    { key: 'kind', label: 'Service', type: 'select', options: [{ value: 'security', label: 'Security' }, { value: 'cleaning', label: 'Cleaning' }, { value: 'both', label: 'Security and cleaning' }] },
    { key: 'address', label: 'Address / directions', span: 2 }, { key: 'contact_name', label: 'Site contact' }, { key: 'contact_phone', label: 'Contact phone' },
    { key: 'staff_day', label: 'Staff needed by day', type: 'number' }, { key: 'staff_night', label: 'Staff needed at night', type: 'number' },
    { key: 'billing', label: 'Billed', type: 'select', options: [{ value: 'contract', label: 'Monthly contract (Contracts)' }, { value: 'per_shift', label: 'Per shift worked' }, { value: 'per_hour', label: 'Per hour worked' }] },
    { key: 'rate', label: 'Rate per shift / hour excl. VAT (M)', type: 'number' },
    ...(contracts.length ? [{ key: 'contract_id', label: 'Contract', type: 'select', numeric: true, options: [{ value: '', label: '—' }, ...contracts.map(k => ({ value: k.id, label: `${k.number} ${k.name}` }))] }] : []),
    { key: 'instructions', label: 'Post orders / instructions', type: 'textarea', rows: 3, span: 2 }, { key: 'checklist', label: 'Checklist for inspections (one item per line)', type: 'textarea', rows: 4, span: 2 },
    ...(s ? [{ key: 'active', label: 'Active', type: 'checkbox' }] : [])];
  modal({ title: s ? s.name : 'New site', size: 'lg', body: formHtml(f, s || { kind: 'security', billing: 'contract', staff_day: 1, staff_night: 1 }, { ctx: 'site' }), actions: [{ label: 'Cancel' },
    { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); const o = s ? await PUT('/sites/' + s.id, v) : await POST('/sites', v); c(); toast('Saved'); done(o.id); } }] });
}

export async function siteForm(view, [idq]) {
  const id = (idq || '').split('?')[0];
  const s = await GET('/sites/' + id);
  const acts = ['<button class="btn btn-primary" id="sr">📅 Roster</button>', '<button class="btn" id="so">✎ Occurrence book</button>', '<button class="btn" id="si">⚠ Incident</button>'];
  if (s.checklist_items.length) acts.push('<button class="btn" id="sn">✓ Inspection</button>');
  acts.push('<button class="btn" id="sc">Issue supplies</button>');
  if (s.billing !== 'contract' && can('invoicing')) acts.push('<button class="btn btn-ok" id="sv">🧾 Invoice shifts</button>');
  acts.push('<button class="btn" id="se">Edit</button>');
  view.innerHTML = page(`${s.name}`, acts.join(''), `
    <div class="card"><p class="muted" style="margin-top:0">${esc(s.client_name)} · ${esc(s.kind)}${s.address ? ' · ' + esc(s.address) : ''}${s.contact_name ? ` · contact ${esc(s.contact_name)} ${esc(s.contact_phone || '')}` : ''} · needs ${s.staff_day} by day, ${s.staff_night} at night
      · ${s.billing === 'contract' ? (s.contract_number ? `billed by contract <a href="#/contract/${s.contract_id}">${esc(s.contract_number)}</a>` : 'billed by contract (none linked)') : `${money(s.rate)} ${s.billing === 'per_shift' ? 'per shift' : 'per hour'}`}</p>
      ${s.instructions ? `<div class="help-note" style="display:block;white-space:pre-wrap"><b>Post orders:</b> ${esc(s.instructions)}</div>` : ''}
      <h3 style="margin-top:12px">Shifts (last 2 days and next 7)</h3>${tableHtml([{ key: 'start_at', label: 'Day', fmt: v => d(v) }, { key: 'start_at', label: 'Shift', fmt: (v, x) => `${tm(v)}–${tm(x.end_at)}` }, { key: 'employee_name', label: 'Staff' }, { key: 'role', label: 'Post' },
        { key: 'status', label: 'Status', html: 1, fmt: (v, x) => ssBadge(v) + (x.replaced_by_name ? ` <small class="muted">relief: ${esc(x.replaced_by_name)}</small>` : '') }, { key: 'check_in_at', label: 'In', fmt: tm }, { key: 'check_out_at', label: 'Out', fmt: tm },
        { key: 'id', label: '', html: 1, fmt: (v, x) => shiftButtons(x) }], s.shifts, { empty: 'No shifts planned. Use Roster.' })}</div>
    <div class="cols cols-2" style="margin-top:14px"><div class="card"><h3>Occurrence book</h3><div class="thread">${s.log.map(g => `<div class="msg ${g.kind === 'note' && /INCIDENT|absent/i.test(g.text) ? 'internal' : ''}"><div class="muted" style="font-size:12px">${esc(dt(g.at))} · ${esc(g.kind.replace('_', ' '))}${g.employee_name ? ' · ' + esc(g.employee_name) : ''}</div>${esc(g.text)}</div>`).join('') || '<div class="muted">No entries yet.</div>'}</div></div>
      <div><div class="card"><h3>Incidents</h3>${tableHtml([{ key: 'number', label: 'No.' }, { key: 'occurred_at', label: 'When', fmt: dt }, { key: 'kind', label: 'Type', fmt: v => (INC.find(k => k[0] === v) || [v, v])[1] }, { key: 'status', label: 'Status' }], s.incidents, { rowAttr: i => `data-inc="${i.id}"`, empty: 'None.' })}</div>
        <div class="card" style="margin-top:14px"><h3>Inspections</h3>${tableHtml([{ key: 'at', label: 'When', fmt: dt }, { key: 'score', label: 'Score', right: 1, fmt: v => Number(v) + '%' }, { key: 'signed_by', label: 'Signed by client' }, { key: 'user_name', label: 'Inspector' }], s.inspections, { empty: s.checklist_items.length ? 'None yet.' : 'Add a checklist to the site to do inspections.' })}</div>
        <div class="card" style="margin-top:14px"><h3>Supplies issued</h3>${tableHtml([{ key: 'created_at', label: 'Date', fmt: d }, { key: 'name', label: 'Item' }, { key: 'qty', label: 'Qty', right: 1, fmt: qty }, { key: 'cost', label: 'Cost', right: 1, fmt: money }], s.consumables, { empty: 'None.' })}</div></div></div>`, { back: '#/sites?tab=sites' });
  filesCard('site', s.id, 'Site plans, client contract & photos');
  const reload = () => siteForm(view, [id]);
  wireShiftButtons(view, s.shifts, reload);
  $('#se').onclick = () => siteDialog(s, reload);
  $('#sr').onclick = async () => {
    const emps = await employees();
    const f = [{ key: 'from', label: 'First day', type: 'date' }, { key: 'to', label: 'Last day', type: 'date' }, { key: 'start_time', label: 'Starts', type: 'time' }, { key: 'end_time', label: 'Ends (earlier = next morning)', type: 'time' },
      { key: 'role', label: 'Post', type: 'select', options: [['guard', 'Guard'], ['supervisor', 'Supervisor'], ['cleaner', 'Cleaner'], ['driver', 'Driver'], ['other', 'Other']].map(([value, label]) => ({ value, label })) }];
    modal({ title: `Roster – ${s.name}`, size: 'lg', body: `${formHtml(f, { from: today(), to: plusDays(6), start_time: s.kind === 'cleaning' ? '07:00' : '18:00', end_time: s.kind === 'cleaning' ? '16:00' : '06:00', role: s.kind === 'cleaning' ? 'cleaner' : 'guard' }, { ctx: 'roster' })}
      <h4 style="margin:10px 0 4px">Days</h4><div class="row wrap">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((n, i) => `<label class="row" style="gap:4px"><input type="checkbox" data-day="${i + 1}" checked> ${n}</label>`).join('')}</div>
      <h4 style="margin:10px 0 4px">Staff</h4><div class="mod-grid">${emps.map(e => `<label class="mod"><input type="checkbox" data-emp="${e.value}"><span><b>${esc(e.label)}</b></span></label>`).join('') || '<div class="muted">Add guards and cleaners as employees under HR first.</div>'}</div>`,
      actions: [{ label: 'Cancel' }, { label: 'Make shifts', cls: 'btn-primary', onClick: async (c, r) => {
        const v = readForm(r, f);
        const o = await POST(`/sites/${s.id}/roster`, { ...v, days: $$('[data-day]', r).filter(x => x.checked).map(x => Number(x.dataset.day)), employee_ids: $$('[data-emp]', r).filter(x => x.checked).map(x => Number(x.dataset.emp)) });
        c(); toast(`${o.created} shifts planned${o.skipped.length ? ` · ${o.skipped.length} skipped (already working elsewhere)` : ''}`, o.skipped.length ? 'err' : 'ok', 7000); reload();
      } }] });
  };
  $('#so').onclick = async () => {
    const f = [{ key: 'kind', label: 'Entry', type: 'select', options: [['patrol', 'Patrol'], ['visitor', 'Visitor / vehicle'], ['handover', 'Shift handover'], ['note', 'Note']].map(([value, label]) => ({ value, label })) },
      { key: 'employee_id', label: 'By', type: 'select', numeric: true, options: [{ value: '', label: '—' }, ...await employees()] }, { key: 'text', label: 'What was seen / done', type: 'textarea', rows: 3, span: 2, required: true }];
    modal({ title: 'Occurrence book entry', body: formHtml(f, { kind: 'patrol' }, { ctx: 'oblog' }), actions: [{ label: 'Cancel' }, { label: 'Add', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/sites/${s.id}/log`, readForm(r, f)); c(); reload(); } }] });
  };
  const incDialog = async i => {
    const f = [{ key: 'occurred_at', label: 'When', type: 'datetime-local' }, { key: 'kind', label: 'Type', type: 'select', options: INC.map(([value, label]) => ({ value, label })) },
      { key: 'severity', label: 'Severity', type: 'select', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']].map(([value, label]) => ({ value, label })) },
      { key: 'employee_id', label: 'Reported by', type: 'select', numeric: true, options: [{ value: '', label: '—' }, ...await employees()] },
      { key: 'description', label: 'What happened', type: 'textarea', rows: 4, span: 2, required: true }, { key: 'action_taken', label: 'Action taken', type: 'textarea', rows: 2, span: 2 },
      { key: 'police_case', label: 'Police case (CR) number' }, { key: 'client_informed', label: 'Client informed', type: 'checkbox' }, ...(i ? [{ key: 'status', label: 'Status', type: 'select', options: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }] }] : [])];
    const now = new Date(); const local = `${today()}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    modal({ title: i ? i.number : 'Incident report', size: 'lg', body: formHtml(f, i ? { ...i, occurred_at: String(i.occurred_at).replace(' ', 'T').slice(0, 16) } : { occurred_at: local, kind: 'trespass', severity: 'medium' }, { ctx: 'incident' }),
      actions: [{ label: 'Cancel' }, ...(i ? [{ label: '🖨 Print', onClick: () => printHtml(incidentHtml(s, i)) }] : []), { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); if (i) await PUT('/incidents/' + i.id, v); else { const o = await POST(`/sites/${s.id}/incidents`, v); toast(`${o.number} reported`); } c(); reload(); } }] });
  };
  $('#si').onclick = () => incDialog(null);
  $$('[data-inc]').forEach(tr => tr.onclick = () => incDialog(s.incidents.find(i => String(i.id) === tr.dataset.inc)));
  if ($('#sn')) $('#sn').onclick = () => {
    modal({ title: `Inspection – ${s.name}`, size: 'lg', body: `<table class="grid lines"><thead><tr><th>Item</th><th style="width:60px">OK</th><th>Note</th></tr></thead><tbody>${s.checklist_items.map((it, i) => `<tr><td>${esc(it)}</td><td><input type="checkbox" data-ok="${i}" checked></td><td><input data-nt="${i}"></td></tr>`).join('')}</tbody></table>
      ${formHtml([{ key: 'signed_by', label: 'Client representative (signed off)' }, { key: 'notes', label: 'Notes' }], {}, { ctx: 'inspection' })}`,
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => {
        const o = await POST(`/sites/${s.id}/inspections`, { items: s.checklist_items.map((it, i) => ({ item: it, ok: r.querySelector(`[data-ok="${i}"]`).checked, note: r.querySelector(`[data-nt="${i}"]`).value })), ...readForm(r, [{ key: 'signed_by' }, { key: 'notes' }]) });
        c(); toast(`Inspection score ${o.score}%`); reload();
      } }] });
  };
  $('#sc').onclick = async () => {
    const prods = (await GET('/products')).filter(p => p.type === 'stock');
    const lines = [{ product_id: null, qty: 1 }];
    const html = () => lines.map((l, i) => `<tr><td><select data-p="${i}"><option value="">—</option>${prods.map(p => `<option value="${p.id}" ${p.id === l.product_id ? 'selected' : ''}>${esc(p.name)} (${qty(p.stock_qty)} in stock)</option>`).join('')}</select></td><td style="width:100px"><input type="number" step="any" class="r" data-q="${i}" value="${l.qty}"></td></tr>`).join('');
    modal({ title: `Supplies to ${s.name}`, body: `<table class="grid lines"><tbody id="il">${html()}</tbody></table><button class="btn btn-sm" id="ia" style="margin-top:6px">＋ Item</button><small class="help-note">Taken out of stock and booked as consumables used on sites – shows in this site's profit.</small>`,
      onOpen: r => { const bind = () => { $$('[data-p]', r).forEach(x => x.onchange = () => { lines[Number(x.dataset.p)].product_id = Number(x.value) || null; }); $$('[data-q]', r).forEach(x => x.oninput = () => { lines[Number(x.dataset.q)].qty = Number(x.value); }); };
        bind(); r.querySelector('#ia').onclick = () => { lines.push({ product_id: null, qty: 1 }); r.querySelector('#il').innerHTML = html(); bind(); }; },
      actions: [{ label: 'Cancel' }, { label: 'Issue', cls: 'btn-primary', onClick: async c => { const o = await POST(`/sites/${s.id}/issue`, { lines: lines.filter(l => l.product_id) }); c(); toast(`Issued – cost ${money(o.value)}`); reload(); } }] });
  };
  if ($('#sv')) $('#sv').onclick = () => {
    const f = [{ key: 'from', label: 'From', type: 'date' }, { key: 'to', label: 'To', type: 'date' }];
    modal({ title: `Invoice shifts – ${s.name}`, body: formHtml(f, { from: today().slice(0, 8) + '01', to: today() }, { ctx: 'siteinv' }) + '<small class="help-note">All finished shifts in the period that are not invoiced yet.</small>', actions: [{ label: 'Cancel' },
      { label: 'Make invoice', cls: 'btn-primary', onClick: async (c, r) => { const o = await POST(`/sites/${s.id}/invoice`, readForm(r, f)); c(); toast(`Invoice for ${o.shifts} shift(s)`); location.hash = '#/invoice/' + o.invoice_id; } }] });
  };
}

function incidentHtml(s, i) {
  return `<div style="font-family:Arial;font-size:13px;max-width:760px;margin:auto"><h2>${esc(state.company.name || '')}</h2><h1 style="font-size:20px">Incident report ${esc(i.number)}</h1>
    <p><b>Site:</b> ${esc(s.name)} (${esc(s.client_name)})<br><b>When:</b> ${esc(dt(i.occurred_at))}<br><b>Type:</b> ${esc((INC.find(k => k[0] === i.kind) || [i.kind, i.kind])[1])} · <b>Severity:</b> ${esc(i.severity)}
    ${i.employee_name ? `<br><b>Reported by:</b> ${esc(i.employee_name)}` : ''}${i.police_case ? `<br><b>Police case:</b> ${esc(i.police_case)}` : ''}</p>
    <h3>What happened</h3><p style="white-space:pre-wrap">${esc(i.description)}</p>${i.action_taken ? `<h3>Action taken</h3><p style="white-space:pre-wrap">${esc(i.action_taken)}</p>` : ''}
    <table style="width:100%;margin-top:40px"><tr><td>Supervisor: ____________________</td><td>Client: ____________________</td></tr></table></div>`;
}
