// Machines & maintenance, and requests for quotation (RFQ) to several suppliers
import { state, GET, POST, PUT, esc, $, $$, toast, err, can, money, qty, modal, confirmBox, formHtml, readForm, tableHtml, badge, page, d, dt, today, plusDays, query, printHtml, hasMod, locationOptions } from './core.js';

const MS = { new: ['New', 'draft'], in_progress: ['Being fixed', 'partial'], done: ['Done', 'paid'], cancelled: ['Cancelled', 'cancelled'] };
const msBadge = s => badge((MS[s] || [s])[0], (MS[s] || [s, ''])[1]);
const prBadge = p => p === 'urgent' ? badge('urgent', 'cancelled') : p === 'high' ? badge('high', 'draft') : p === 'low' ? '<span class="muted">low</span>' : '';

/* ======================= MAINTENANCE ======================= */
export async function maintenance(view) {
  const tab = query().tab || 'requests';
  const mgr = can('maintenance');
  const tabs = [['requests', mgr ? 'Requests' : 'My reports'], ...(mgr ? [['machines', 'Machines']] : [])];
  view.innerHTML = page('Maintenance', `${mgr ? '<button class="btn" id="plan">📅 Plan due services</button><button class="btn" id="nm">＋ New machine</button>' : ''}<button class="btn btn-primary" id="rep">⚠ Report a problem</button>`,
    `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/maintenance?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="mb"></div>`);
  const mb = $('#mb');
  $('#rep').onclick = () => reportDialog(null, () => maintenance(view));
  if ($('#nm')) $('#nm').onclick = () => machineDialog(null, () => { location.hash = '#/maintenance?tab=machines&r=' + Date.now(); });
  if ($('#plan')) $('#plan').onclick = async () => { try { const r = await POST('/maintenance/schedule', { days: 7 }); toast(r.created.length ? `${r.created.length} service job(s) planned: ${r.created.map(x => x.equipment).join(', ')}` : 'No services due in the next 7 days'); maintenance(view); } catch (e) { err(e); } };
  if (tab === 'requests') {
    const st = query().status || 'open';
    const rows = await GET('/maintenance?status=' + st);
    mb.innerHTML = `<div class="row" style="margin-bottom:8px">${[['open', 'Open'], ['done', 'Done'], ['all', 'All']].map(([k, l]) => `<a class="btn btn-sm ${k === st ? 'btn-primary' : ''}" href="#/maintenance?tab=requests&status=${k}">${l}</a>`).join('')}</div>
      <div class="card">${tableHtml([{ key: 'number', label: 'Number' }, { key: 'equipment_name', label: 'Machine' }, { key: 'title', label: 'Problem / job', html: 1, fmt: (v, r) => `${esc(v)} ${r.machine_down ? badge('machine down', 'cancelled') : ''} ${r.kind === 'preventive' ? badge('service', 'posted') : ''}` },
        { key: 'priority', label: 'Priority', html: 1, fmt: prBadge }, { key: 'status', label: 'Status', html: 1, fmt: msBadge }, { key: 'assigned_name', label: 'Technician' },
        { key: 'scheduled_date', label: 'Planned', fmt: d }, { key: 'created_at', label: 'Reported', fmt: (v, r) => `${dt(v)} · ${r.reported_by_name || ''}` }], rows,
        { rowAttr: r => `data-id="${r.id}"`, empty: 'No maintenance requests here.' })}</div>`;
    $$('[data-id]', mb).forEach(tr => tr.onclick = () => { location.hash = '#/mr/' + tr.dataset.id; });
  }
  if (tab === 'machines') {
    const rows = await GET('/equipment');
    mb.innerHTML = `<div class="card">${tableHtml([{ key: 'name', label: 'Machine', html: 1, fmt: (v, r) => `<b>${esc(v)}</b>${r.code ? ` <small class="muted">${esc(r.code)}</small>` : ''}` },
      { key: 'status', label: 'Status', html: 1, fmt: v => v === 'down' ? badge('down', 'cancelled') : v === 'retired' ? badge('retired', 'closed') : badge('working', 'ok') },
      { key: 'location_name', label: 'Where' }, { key: 'next_service', label: 'Next service', html: 1, fmt: (v, r) => v ? `<span class="${r.overdue ? 'neg' : ''}">${esc(d(v))}${r.overdue ? ' ⚠' : r.service_due ? ' (soon)' : ''}</span>` : '<span class="muted">–</span>' },
      { key: 'open_requests', label: 'Open jobs', right: 1 }, { key: 'downtime_12m', label: 'Downtime 12 m (h)', right: 1, fmt: qty }, { key: 'cost_12m', label: 'Repair cost 12 m', right: 1, fmt: money }], rows,
      { rowAttr: r => `data-id="${r.id}"`, empty: 'No machines yet. Add ovens, mixers, generators, vehicles…' })}
      <p class="muted" style="margin-top:10px">Repair cost = spare parts + labour + outside repairers recorded on finished jobs.</p></div>`;
    $$('[data-id]', mb).forEach(tr => tr.onclick = () => machineDialog(rows.find(x => String(x.id) === tr.dataset.id), () => maintenance(view)));
  }
}

async function machineDialog(e, done) {
  const [lo, sup] = await Promise.all([hasMod('locations') ? locationOptions('—') : null, GET('/partners?is_supplier=1')]);
  const f = [{ key: 'name', label: 'Machine name', required: true }, { key: 'code', label: 'Asset number / code' }, { key: 'category', label: 'Type' }, { key: 'serial_no', label: 'Serial number' },
    ...(lo ? [{ key: 'location_id', label: 'Where it stands', type: 'select', numeric: true, options: lo }] : []),
    { key: 'supplier_id', label: 'Supplier / service agent', type: 'select', numeric: true, options: [{ value: '', label: '—' }, ...sup.map(s => ({ value: s.id, label: s.name }))] },
    { key: 'purchase_date', label: 'Bought on', type: 'date' }, { key: 'cost', label: 'Cost (M)', type: 'number', nullable: true }, { key: 'warranty_until', label: 'Warranty until', type: 'date' },
    { key: 'interval_days', label: 'Service every (days)', type: 'number', nullable: true }, { key: 'last_service', label: 'Last serviced', type: 'date' }, { key: 'next_service', label: 'Next service due', type: 'date' },
    ...(e ? [{ key: 'status', label: 'Status', type: 'select', options: [{ value: 'working', label: 'Working' }, { value: 'down', label: 'Broken down' }, { value: 'retired', label: 'Retired / sold' }] }] : []),
    { key: 'notes', label: 'Notes', span: 2 }];
  const vals = e ? { ...e, purchase_date: d(e.purchase_date), warranty_until: d(e.warranty_until), last_service: d(e.last_service), next_service: d(e.next_service) } : {};
  modal({ title: e ? e.name : 'New machine', size: 'lg', body: formHtml(f, vals, { ctx: 'equipment' }) + (e ? `<div class="row" style="margin-top:8px"><a class="btn btn-sm" href="#/maintenance?tab=requests&status=all" id="hist">History</a></div>` : ''),
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); if (e) await PUT('/equipment/' + e.id, v); else await POST('/equipment', v); c(); toast('Saved'); done(); } }] });
}

async function reportDialog(preset, done) {
  const [eq, users] = await Promise.all([GET('/equipment'), can('maintenance') ? GET('/users').catch(() => []) : []]);
  if (!eq.length) return toast('No machines registered yet' + (can('maintenance') ? ' – add one first' : ''), 'err');
  const f = [{ key: 'equipment_id', label: 'Machine', type: 'select', numeric: true, required: true, options: eq.map(e => ({ value: e.id, label: e.name + (e.code ? ` (${e.code})` : '') })) },
    { key: 'priority', label: 'How urgent', type: 'select', options: [['normal', 'Normal'], ['high', 'High'], ['urgent', 'Urgent – production stopped'], ['low', 'Low']].map(([value, label]) => ({ value, label })) },
    { key: 'title', label: 'What is wrong (short)', required: true, span: 2 }, { key: 'description', label: 'Details', type: 'textarea', rows: 3, span: 2 },
    { key: 'machine_down', label: 'The machine cannot be used', type: 'checkbox', span: 2 },
    ...(can('maintenance') ? [{ key: 'kind', label: 'Type of job', type: 'select', options: [{ value: 'corrective', label: 'Repair' }, { value: 'preventive', label: 'Planned service' }] },
      { key: 'assigned_to', label: 'Technician', type: 'select', numeric: true, options: [{ value: '', label: '—' }, ...users.filter(u => u.active).map(u => ({ value: u.id, label: u.name }))] },
      { key: 'scheduled_date', label: 'Planned date', type: 'date' }] : [])];
  modal({ title: 'Report a problem', size: 'lg', body: formHtml(f, { priority: 'normal', ...(preset || {}) }, { ctx: 'mreq' }), actions: [{ label: 'Cancel' },
    { label: 'Report', cls: 'btn-primary', onClick: async (c, r) => { const m = await POST('/maintenance', readForm(r, f)); c(); toast(`${m.number} reported`); done(m); } }] });
}

export async function mrForm(view, [idq]) {
  const id = (idq || '').split('?')[0];
  const m = await GET('/maintenance/' + id);
  const mgr = can('maintenance'); const open = ['new', 'in_progress'].includes(m.status);
  const acts = [];
  if (mgr && m.status === 'new') acts.push('<button class="btn btn-primary" id="mStart">▶ Start work</button>');
  if (mgr && open) acts.push('<button class="btn btn-ok" id="mDone">✓ Done</button>', '<button class="btn" id="mEdit">Edit</button>', '<button class="btn btn-danger" id="mCancel">Cancel</button>');
  view.innerHTML = page(`${m.number} · ${m.equipment_name}`, acts.join(''), `<div class="card">
    <div class="row wrap" style="margin-bottom:10px">${msBadge(m.status)} ${prBadge(m.priority)} ${m.machine_down ? badge('machine down', 'cancelled') : ''} ${m.kind === 'preventive' ? badge('planned service', 'posted') : ''}
      <span class="muted">Reported ${esc(dt(m.created_at))} by ${esc(m.reported_by_name || '')}${m.assigned_name ? ' · technician ' + esc(m.assigned_name) : ''}${m.location_name ? ' · ' + esc(m.location_name) : ''}</span></div>
    <h3>${esc(m.title)}</h3>${m.description ? `<p style="white-space:pre-wrap">${esc(m.description)}</p>` : ''}
    ${m.status === 'done' ? `<div class="cols cols-4" style="margin-top:12px">
      <div class="kpi"><div class="label">Spare parts</div><div class="value">${money(m.parts_cost)}</div></div><div class="kpi"><div class="label">Labour</div><div class="value">${money(m.labour_cost)}</div></div>
      <div class="kpi"><div class="label">Outside repairer</div><div class="value">${money(m.external_cost)}</div></div><div class="kpi"><div class="label">Downtime</div><div class="value">${m.downtime_hours == null ? '–' : qty(m.downtime_hours) + ' h'}</div></div></div>
      ${m.resolution ? `<p><b>What was done:</b> ${esc(m.resolution)}</p>` : ''}
      ${m.parts.length ? tableHtml([{ key: 'product_name', label: 'Part' }, { key: 'qty', label: 'Qty', right: 1, fmt: qty }, { key: 'unit_cost', label: 'Cost', right: 1, fmt: money }], m.parts) : ''}` : ''}</div>`, { back: '#/maintenance' });
  const act = async (p, msg) => { try { await POST(`/maintenance/${m.id}/${p}`); toast(msg); mrForm(view, [id]); } catch (e) { err(e); } };
  if ($('#mStart')) $('#mStart').onclick = () => act('start', 'Started');
  if ($('#mCancel')) $('#mCancel').onclick = async () => { if (await confirmBox('Cancel this request?', { danger: true, okLabel: 'Cancel request' })) act('cancel', 'Cancelled'); };
  if ($('#mEdit')) $('#mEdit').onclick = async () => {
    const users = await GET('/users').catch(() => []);
    const f = [{ key: 'title', label: 'What is wrong', required: true, span: 2 }, { key: 'description', label: 'Details', type: 'textarea', rows: 3, span: 2 },
      { key: 'priority', label: 'Priority', type: 'select', options: ['low', 'normal', 'high', 'urgent'].map(v => ({ value: v, label: v })) },
      { key: 'assigned_to', label: 'Technician', type: 'select', numeric: true, options: [{ value: '', label: '—' }, ...users.filter(u => u.active).map(u => ({ value: u.id, label: u.name }))] },
      { key: 'scheduled_date', label: 'Planned date', type: 'date' }, { key: 'machine_down', label: 'Machine cannot be used', type: 'checkbox' }];
    modal({ title: m.number, size: 'lg', body: formHtml(f, { ...m, scheduled_date: d(m.scheduled_date) }, { ctx: 'mreq' }), actions: [{ label: 'Cancel' },
      { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await PUT('/maintenance/' + m.id, readForm(r, f)); c(); mrForm(view, [id]); } }] });
  };
  if ($('#mDone')) $('#mDone').onclick = async () => {
    const prods = (await GET('/products')).filter(p => p.type !== 'service');
    const parts = [{ product_id: null, qty: 1 }];
    const f = [{ key: 'resolution', label: 'What was done', span: 2, required: true }, { key: 'labour_cost', label: 'Labour (M)', type: 'number' }, { key: 'external_cost', label: 'Outside repairer (M)', type: 'number' },
      { key: 'downtime_hours', label: 'Hours the machine was stopped', type: 'number', nullable: true }];
    const partsHtml = () => parts.map((p, i) => `<tr><td><select data-pi="${i}"><option value="">— no part —</option>${prods.map(x => `<option value="${x.id}" ${x.id === p.product_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></td>
      <td style="width:110px"><input type="number" step="any" class="r" data-pq="${i}" value="${p.qty}"></td></tr>`).join('');
    modal({ title: `Finish ${m.number}`, size: 'lg', body: `${formHtml(f, { downtime_hours: '' }, { ctx: 'mreq' })}<h4 style="margin:12px 0 6px">Spare parts used (taken from stock)</h4>
      <table class="grid lines"><tbody id="pp">${partsHtml()}</tbody></table><button class="btn btn-sm" id="pAdd" style="margin-top:6px">＋ Part</button>
      <small class="help-note">Parts are booked to Repairs &amp; maintenance. Labour and outside repairers are recorded for the machine's cost history – wages and the repairer's bill are booked through payroll and supplier bills.</small>`,
      onOpen: r => {
        const bind = () => { $$('[data-pi]', r).forEach(s => s.onchange = () => { parts[Number(s.dataset.pi)].product_id = Number(s.value) || null; }); $$('[data-pq]', r).forEach(s => s.oninput = () => { parts[Number(s.dataset.pq)].qty = Number(s.value); }); };
        bind(); r.querySelector('#pAdd').onclick = () => { parts.push({ product_id: null, qty: 1 }); r.querySelector('#pp').innerHTML = partsHtml(); bind(); };
      },
      actions: [{ label: 'Cancel' }, { label: 'Finish job', cls: 'btn-ok', onClick: async (c, r) => {
        const v = readForm(r, f); await POST(`/maintenance/${m.id}/done`, { ...v, downtime_hours: v.downtime_hours ?? '', parts: parts.filter(p => p.product_id) }); c(); toast('Job finished – machine back in service'); mrForm(view, [id]);
      } }] });
  };
}

/* ======================= REQUESTS FOR QUOTATION ======================= */
const RS = { draft: ['Draft', 'draft'], sent: ['Waiting for prices', 'partial'], closed: ['Ordered', 'paid'], cancelled: ['Cancelled', 'cancelled'] };
const rsBadge = s => badge((RS[s] || [s])[0], (RS[s] || [s, ''])[1]);

export async function rfqs(view) {
  const rows = await GET('/rfqs');
  view.innerHTML = page('Requests for quotation', '<a class="btn" href="#/purchases">Purchase orders</a><a class="btn btn-primary" href="#/rfq/new">＋ New request</a>', `<div class="card">
    ${tableHtml([{ key: 'number', label: 'Number' }, { key: 'created_at', label: 'Date', fmt: d }, { key: 'deadline', label: 'Reply by', fmt: d }, { key: 'line_count', label: 'Items', right: 1 },
      { key: 'supplier_count', label: 'Suppliers', right: 1 }, { key: 'replies', label: 'Replies', right: 1 }, { key: 'status', label: 'Status', html: 1, fmt: rsBadge }, { key: 'user_name', label: 'By' }], rows,
      { rowAttr: r => `data-id="${r.id}"`, empty: 'No requests yet. Ask two or three suppliers for prices on the same items and order from the cheapest.' })}</div>`);
  $$('[data-id]').forEach(tr => tr.onclick = () => { location.hash = '#/rfq/' + tr.dataset.id; });
}

export async function rfqForm(view, [idq]) {
  const id = (idq || '').split('?')[0];
  const isNew = id === 'new';
  const [sups, prods] = await Promise.all([GET('/partners?is_supplier=1'), GET('/products')]);
  let q = isNew ? { status: 'draft', deadline: plusDays(5), lines: [], suppliers: [] } : await GET('/rfqs/' + id);
  if (isNew) { try { const pre = JSON.parse(sessionStorage.getItem('rfq_prefill') || 'null'); if (pre) { q.lines = pre; sessionStorage.removeItem('rfq_prefill'); } } catch (_) {} }
  const edit = q.status === 'draft' && can('purchasing');
  const lines = q.lines.map(l => ({ product_id: l.product_id, description: l.description, qty: Number(l.qty) }));
  if (!lines.length) lines.push({ product_id: null, description: '', qty: 1 });
  const chosen = new Set(q.suppliers.map(s => s.partner_id));
  const acts = [];
  if (!isNew) acts.push('<button class="btn" id="qPrint">🖨 Print request</button>');
  if (edit) acts.push('<button class="btn" id="qSave">Save draft</button>');
  if (['draft', 'sent'].includes(q.status) && can('purchasing') && !isNew) acts.push('<button class="btn btn-primary" id="qSend">✉ Send to suppliers</button>');
  if (q.status === 'sent' && q.suppliers.some(s => s.status === 'replied')) acts.push('<button class="btn btn-ok" id="qAward">✓ Order from best prices</button>');
  if (!isNew && ['draft', 'sent'].includes(q.status)) acts.push('<button class="btn btn-danger" id="qCancel">Cancel</button>');
  const f = [{ key: 'deadline', label: 'Suppliers must reply by', type: 'date' }, { key: 'notes', label: 'Note to suppliers (delivery address, terms…)' }];
  view.innerHTML = page(isNew ? 'New request for quotation' : q.number, acts.join(''), `
    <div class="card"><div class="row" style="margin-bottom:10px">${isNew ? '' : rsBadge(q.status)}</div><div id="qh">${formHtml(f, { ...q, deadline: d(q.deadline) }, { ctx: 'rfq' })}</div>
      ${edit ? `<h3 style="margin:16px 0 8px">Items</h3><div id="ql"></div><h3 style="margin:16px 0 8px">Suppliers to ask</h3>
        <div class="mod-grid">${sups.map(s => `<label class="mod ${chosen.has(s.id) ? 'on' : ''}"><input type="checkbox" data-s="${s.id}" ${chosen.has(s.id) ? 'checked' : ''}><span><b>${esc(s.name)}</b><small>${esc(s.email || 'no email – print or phone')}</small></span></label>`).join('') || '<div class="muted">Add suppliers under Contacts first.</div>'}</div>
        <small class="help-note">Tick two or more suppliers so you can compare. Suppliers with an email address get the request by email when you click Send.</small>` : ''}
    </div>${isNew || edit ? '' : '<div class="card" style="margin-top:14px"><h3>Prices received</h3><div id="cmp"></div></div>'}`, { back: '#/rfqs' });
  if (edit) {
    const draw = () => {
      $('#ql').innerHTML = `<table class="grid lines"><thead><tr><th style="width:40%">Product</th><th>Description</th><th class="r" style="width:110px">Qty</th><th style="width:32px"></th></tr></thead><tbody>
        ${lines.map((l, i) => `<tr><td><select data-i="${i}" data-k="product_id"><option value="">— free text —</option>${prods.map(p => `<option value="${p.id}" ${p.id === Number(l.product_id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></td>
          <td><input data-i="${i}" data-k="description" value="${esc(l.description || '')}"></td><td><input data-i="${i}" data-k="qty" type="number" step="any" class="r" value="${l.qty}"></td><td><button class="icon-btn" data-del="${i}">✕</button></td></tr>`).join('')}
        </tbody></table><button class="btn btn-sm" id="qAdd" style="margin-top:8px">＋ Add item</button>`;
      $$('[data-k]', $('#ql')).forEach(inp => inp.oninput = inp.onchange = () => { const l = lines[Number(inp.dataset.i)]; const k = inp.dataset.k; l[k] = k === 'qty' ? Number(inp.value) : k === 'product_id' ? Number(inp.value) || null : inp.value; if (k === 'product_id') { const p = prods.find(x => x.id === l.product_id); if (p) l.description = p.name; draw(); } });
      $$('[data-del]', $('#ql')).forEach(b => b.onclick = () => { lines.splice(Number(b.dataset.del), 1); draw(); });
      $('#qAdd').onclick = () => { lines.push({ product_id: null, description: '', qty: 1 }); draw(); };
    };
    draw();
    $$('[data-s]').forEach(c => c.onchange = () => { if (c.checked) chosen.add(Number(c.dataset.s)); else chosen.delete(Number(c.dataset.s)); c.closest('.mod').classList.toggle('on', c.checked); });
  } else if (!isNew) drawCompare(q, view, id);
  const body = () => ({ ...readForm($('#qh'), f), lines: lines.filter(l => l.product_id || l.description), supplier_ids: [...chosen] });
  const save = async () => isNew ? (await POST('/rfqs', body())).id : (edit ? (await PUT('/rfqs/' + q.id, body())).id : q.id);
  if ($('#qSave')) $('#qSave').onclick = async () => { try { const nid = await save(); toast('Saved'); if (isNew) location.hash = '#/rfq/' + nid; else rfqForm(view, [id]); } catch (e) { err(e); } };
  if ($('#qSend')) $('#qSend').onclick = async () => {
    try {
      const nid = await save(); const full = await GET('/rfqs/' + nid);
      const withMail = full.suppliers.filter(s => s.email).length;
      const r = await POST(`/rfqs/${nid}/send`, { email: withMail > 0, html: rfqHtml(full, '{supplier}'), subject: `Request for quotation ${full.number} – ${state.company.name || ''}` });
      toast(`${r.emailed.length ? 'Emailed: ' + r.emailed.join(', ') : 'Marked as sent'}${!r.smtp ? ' · email is not set up (Settings → Email) – print the request or phone the suppliers' : r.no_email.length ? ` · print or phone: ${r.no_email.join(', ')}` : ''}${r.failed.length ? ' · failed: ' + r.failed.join('; ') : ''}`, r.failed.length ? 'err' : 'ok', 8000);
      rfqForm(view, [String(nid)]);
    } catch (e) { err(e); }
  };
  if ($('#qPrint')) $('#qPrint').onclick = () => printHtml(rfqHtml(q, ''));
  if ($('#qCancel')) $('#qCancel').onclick = async () => { if (await confirmBox('Cancel this request?', { danger: true, okLabel: 'Cancel request' })) { await POST(`/rfqs/${q.id}/cancel`); rfqForm(view, [id]); } };
}

function drawCompare(q, view, id) {
  const el = $('#cmp');
  const open = q.status === 'sent' || q.status === 'draft';
  const priceOf = (lid, pid) => { const x = q.quotes.find(z => z.line_id === lid && z.partner_id === pid); return x ? Number(x.unit_cost) : null; };
  el.innerHTML = `<div class="table-wrap"><table class="grid"><thead><tr><th>Item</th><th class="r">Qty</th>${q.suppliers.map(s => `<th class="r">${esc(s.name)}<br><small class="muted" style="font-weight:400">${s.status === 'replied' ? (s.lead_days != null ? `${s.lead_days} days` : 'replied') : s.status === 'declined' ? 'declined' : 'waiting'}</small></th>`).join('')}</tr></thead><tbody>
    ${q.lines.map(l => `<tr><td>${esc(l.description)}${l.last_cost ? ` <small class="muted">last paid ${money(l.last_cost)}</small>` : ''}</td><td class="r">${qty(l.qty)} ${esc(l.uom || '')}</td>
      ${q.suppliers.map(s => { const p = priceOf(l.id, s.partner_id); const best = l.best_partner_id === s.partner_id; const aw = l.awarded_partner_id === s.partner_id;
        return `<td class="r" style="${best ? 'background:var(--ok-soft)' : ''}">${p == null ? '<span class="muted">–</span>' : `${money(p)}<br><small class="muted">${money(p * l.qty)}</small>`}${aw ? ' ✓' : ''}</td>`; }).join('')}</tr>`).join('')}
    </tbody><tfoot><tr><td colspan="2" class="r"><b>Total for quoted items</b></td>${q.suppliers.map(s => `<td class="r"><b>${s.quoted_lines ? money(s.total) : ''}</b>${s.po_number ? `<br><a href="#/purchase/${s.po_id}">${esc(s.po_number)}</a>` : ''}</td>`).join('')}</tr>
    ${open ? `<tr><td colspan="2"></td>${q.suppliers.map(s => `<td class="r"><button class="btn btn-sm" data-enter="${s.partner_id}">${s.status === 'invited' ? 'Enter prices' : 'Change'}</button></td>`).join('')}</tr>` : ''}</tfoot></table></div>
    <small class="help-note">Green = cheapest for that item. "Order from best prices" makes one draft purchase order per supplier with the items they are cheapest for (delivery date from their lead time).</small>`;
  $$('[data-enter]', el).forEach(b => b.onclick = () => {
    const s = q.suppliers.find(x => String(x.partner_id) === b.dataset.enter);
    modal({ title: `Prices from ${s.name}`, size: 'lg', body: `<table class="grid lines"><thead><tr><th>Item</th><th class="r">Qty</th><th class="r" style="width:140px">Unit price excl. VAT</th></tr></thead><tbody>
      ${q.lines.map(l => `<tr><td>${esc(l.description)}</td><td class="r">${qty(l.qty)}</td><td><input type="number" step="any" class="r" data-l="${l.id}" value="${priceOf(l.id, s.partner_id) ?? ''}" placeholder="not quoted"></td></tr>`).join('')}</tbody></table>
      ${formHtml([{ key: 'lead_days', label: 'Delivery time (days)', type: 'number', nullable: true }, { key: 'notes', label: 'Their conditions / validity' }], { lead_days: s.lead_days ?? '', notes: s.notes || '' }, { ctx: 'rfq' })}`,
      actions: [{ label: 'Cancel' }, { label: 'Supplier declined', cls: 'btn-danger', onClick: async c => { await POST(`/rfqs/${q.id}/quotes`, { partner_id: s.partner_id, declined: 1 }); c(); rfqForm(view, [id]); } },
        { label: 'Save prices', cls: 'btn-primary', onClick: async (c, r) => {
          const v = readForm(r, [{ key: 'lead_days', type: 'number', nullable: true }, { key: 'notes' }]);
          await POST(`/rfqs/${q.id}/quotes`, { partner_id: s.partner_id, ...v, prices: $$('[data-l]', r).map(i => ({ line_id: Number(i.dataset.l), unit_cost: i.value })) }); c(); toast('Prices saved'); rfqForm(view, [id]);
        } }] });
  });
  const aw = $('#qAward');
  if (aw) aw.onclick = async () => {
    const plan = q.lines.filter(l => l.best_partner_id).map(l => `${l.description} → ${(q.suppliers.find(s => s.partner_id === l.best_partner_id) || {}).name}`);
    if (!(await confirmBox(`Make draft purchase orders?\n\n${plan.join('\n')}`, { okLabel: 'Make orders' }))) return;
    try { const r = await POST(`/rfqs/${q.id}/award`, {}); toast(`${r.purchase_orders.length} purchase order(s): ${r.purchase_orders.map(p => `${p.number} ${p.supplier}`).join(', ')}`, 'ok', 8000); rfqForm(view, [id]); } catch (e) { err(e); }
  };
}

function rfqHtml(q, supplier) {
  const c = state.company || {};
  return `<div style="font-family:Arial,sans-serif;font-size:13px;max-width:760px;margin:auto"><h2 style="margin:0">${esc(c.name || '')}</h2><div>${esc(c.address || '')}${c.phone ? ' · ' + esc(c.phone) : ''}${c.email ? ' · ' + esc(c.email) : ''}</div>
    <h1 style="font-size:20px;margin:18px 0 4px">Request for quotation ${esc(q.number || '')}</h1>
    <p>${supplier ? `Dear ${esc(supplier)},<br><br>` : ''}Please quote your best price excluding VAT and your delivery time for the items below${q.deadline ? ` by <b>${esc(d(q.deadline))}</b>` : ''}.</p>
    <table style="width:100%;border-collapse:collapse" border="1" cellpadding="6"><thead><tr><th align="left">Item</th><th align="right">Quantity</th><th align="right">Unit price</th></tr></thead><tbody>
    ${q.lines.map(l => `<tr><td>${esc(l.description)}</td><td align="right">${qty(l.qty)} ${esc(l.uom || '')}</td><td></td></tr>`).join('')}</tbody></table>
    ${q.notes ? `<p>${esc(q.notes)}</p>` : ''}<p>Thank you.<br>${esc(c.name || '')}</p></div>`;
}
