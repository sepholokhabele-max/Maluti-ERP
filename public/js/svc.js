import { filesCard } from './core.js';
// Projects (task board, hours, invoicing, profit), timesheets and helpdesk / repair job cards
import { state, GET, POST, PUT, DEL, esc, $, $$, toast, err, can, money, qty, modal, confirmBox, formHtml, readForm, tableHtml, badge, page, d, dt, today, plusDays, query, printHtml } from './core.js';

const COLS = [['todo', 'To do'], ['doing', 'Busy'], ['review', 'To check'], ['done', 'Done']];
const prTag = p => p === 'urgent' ? badge('urgent', 'cancelled') : p === 'high' ? badge('high', 'draft') : '';
const users = async () => (await GET('/users').catch(() => [])).filter(u => u.active);
const userOpts = us => [{ value: '', label: '—' }, ...us.map(u => ({ value: u.id, label: u.name }))];

/* ======================= PROJECTS ======================= */
export async function projects(view) {
  const st = query().status || 'active';
  const rows = await GET('/projects?status=' + st);
  view.innerHTML = page('Projects', `<a class="btn" href="#/timesheets">🕒 Timesheets</a>${can('projects') ? '<button class="btn btn-primary" id="np">＋ New project</button>' : ''}`, `
    <div class="tabs">${[['active', 'Active'], ['on_hold', 'On hold'], ['done', 'Finished'], ['all', 'All']].map(([k, l]) => `<a href="#/projects?status=${k}" class="${k === st ? 'active' : ''}">${l}</a>`).join('')}</div>
    <div class="card">${tableHtml([{ key: 'code', label: 'Code' }, { key: 'name', label: 'Project', html: 1, fmt: (v, r) => `<b>${esc(v)}</b><br><small class="muted">${esc(r.partner_name || 'internal')}</small>` },
      { key: 'billing', label: 'Billing', fmt: (v, r) => v === 'hourly' ? `${money(r.hourly_rate)}/h` : v === 'fixed' ? `fixed ${r.budget_amount ? money(r.budget_amount) : ''}` : 'not billed' },
      { key: 'hours', label: 'Hours', right: 1, html: 1, fmt: (v, r) => `${qty(v)}${r.budget_hours ? ` <small class="muted">/ ${qty(r.budget_hours)}</small>` : ''}${r.budget_hours && v > r.budget_hours ? ' ⚠' : ''}` },
      { key: 'open_tasks', label: 'Open tasks', right: 1, fmt: (v, r) => `${v} / ${r.all_tasks}` }, { key: 'to_invoice_amount', label: 'To invoice', right: 1, fmt: money },
      { key: 'invoiced', label: 'Invoiced', right: 1, fmt: money }, { key: 'profit', label: 'Profit so far', right: 1, html: 1, fmt: v => `<span class="${v < 0 ? 'neg' : ''}">${money(v)}</span>` },
      { key: 'end_date', label: 'Deadline', fmt: d }, { key: 'manager_name', label: 'Manager' }], rows, { rowAttr: r => `data-id="${r.id}"`, empty: 'No projects here.' })}</div>`);
  $$('[data-id]').forEach(tr => tr.onclick = () => { location.hash = '#/project/' + tr.dataset.id; });
  if ($('#np')) $('#np').onclick = () => projectDialog(null, p => { location.hash = '#/project/' + p.id; });
}

async function projectDialog(p, done) {
  const [cust, us] = await Promise.all([GET('/partners?is_customer=1'), users()]);
  const f = [{ key: 'name', label: 'Project name', required: true, span: 2 }, { key: 'code', label: 'Code' },
    { key: 'partner_id', label: 'Customer', type: 'select', numeric: true, options: [{ value: '', label: '— internal —' }, ...cust.map(c => ({ value: c.id, label: c.name }))] },
    { key: 'billing', label: 'How it is billed', type: 'select', options: [{ value: 'hourly', label: 'By the hour' }, { value: 'fixed', label: 'Fixed price (progress invoices)' }, { value: 'none', label: 'Not billed (internal)' }] },
    { key: 'hourly_rate', label: 'Hourly rate excl. VAT (M)', type: 'number' }, { key: 'budget_hours', label: 'Budget hours', type: 'number', nullable: true },
    { key: 'budget_amount', label: 'Contract value / budget (M)', type: 'number', nullable: true }, { key: 'manager_id', label: 'Project manager', type: 'select', numeric: true, options: userOpts(us) },
    { key: 'start_date', label: 'Start', type: 'date' }, { key: 'end_date', label: 'Deadline', type: 'date' },
    ...(p ? [{ key: 'status', label: 'Status', type: 'select', options: [['active', 'Active'], ['on_hold', 'On hold'], ['done', 'Finished'], ['cancelled', 'Cancelled']].map(([value, label]) => ({ value, label })) }] : []),
    { key: 'description', label: 'Scope / notes', type: 'textarea', rows: 3, span: 2 }];
  modal({ title: p ? p.name : 'New project', size: 'lg', body: formHtml(f, p ? { ...p, start_date: d(p.start_date), end_date: d(p.end_date) } : { billing: 'hourly', manager_id: state.user.id, start_date: today() }, { ctx: 'project' }),
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); const out = p ? await PUT('/projects/' + p.id, v) : await POST('/projects', v); c(); toast('Saved'); done(out); } }] });
}

export async function projectForm(view, [idq]) {
  const id = (idq || '').split('?')[0];
  const p = await GET('/projects/' + id);
  const mgr = can('projects') || p.manager_id === state.user.id;
  const acts = ['<button class="btn" id="pLog">🕒 Log hours</button>'];
  if (mgr) acts.push('<button class="btn" id="pTask">＋ Task</button>');
  if (can('projects')) acts.push('<button class="btn" id="pEdit">Edit</button>');
  if (can('invoicing') && p.billing !== 'none' && p.partner_id) acts.push('<button class="btn btn-ok" id="pInv">🧾 Invoice</button>');
  view.innerHTML = page(`${p.code ? p.code + ' · ' : ''}${p.name}`, acts.join(''), `
    <div class="cols cols-4" style="margin-bottom:14px">
      <div class="kpi"><div class="label">Hours</div><div class="value">${qty(p.hours)}</div><div class="hint">${p.budget_hours ? `${p.budget_used_pct}% of ${qty(p.budget_hours)} h budget` : 'no hour budget'}</div>${p.budget_hours ? `<div class="gb-bar" style="margin-top:6px"><span style="width:${Math.min(100, p.budget_used_pct)}%;${p.budget_used_pct > 100 ? 'background:var(--bad)' : ''}"></span></div>` : ''}</div>
      <div class="kpi"><div class="label">To invoice</div><div class="value">${money(p.to_invoice_amount)}</div><div class="hint">${qty(p.to_invoice_hours)} billable h not invoiced</div></div>
      <div class="kpi"><div class="label">Invoiced</div><div class="value">${money(p.invoiced)}</div><div class="hint">${p.billing === 'fixed' && p.budget_amount ? `${Math.round(p.invoiced / p.budget_amount * 100)}% of ${money(p.budget_amount)}` : ''}</div></div>
      <div class="kpi"><div class="label">Profit so far</div><div class="value" style="color:${p.profit < 0 ? 'var(--bad)' : 'var(--ok)'}">${money(p.profit)}</div><div class="hint">staff time ${money(p.labour_cost)} · expenses ${money(p.expenses)}</div></div></div>
    <div class="card"><div class="row" style="margin-bottom:8px"><h3 style="flex:1">Tasks</h3><span class="muted">${esc(p.partner_name || 'internal')}${p.end_date ? ' · deadline ' + esc(d(p.end_date)) : ''}</span></div>
      <div class="kanban">${COLS.map(([k, l]) => `<div class="kb-col" data-col="${k}"><div class="kb-head">${l} <span class="muted">${p.tasks.filter(t => t.status === k).length}</span></div>
        ${p.tasks.filter(t => t.status === k).map(t => `<div class="kb-card" data-t="${t.id}"><b>${esc(t.title)}</b> ${prTag(t.priority)}<small>${esc(t.assigned_name || 'unassigned')}${t.due_date ? ' · ' + esc(d(t.due_date)) : ''}${Number(t.hours) ? ` · ${qty(t.hours)}${t.estimate_hours ? '/' + qty(t.estimate_hours) : ''} h` : ''}</small>
          <div class="kb-move">${COLS.filter(([c]) => c !== k).map(([c, cl]) => `<button class="btn btn-sm" data-mv="${t.id}:${c}">→ ${cl}</button>`).join('')}</div></div>`).join('')}</div>`).join('')}</div></div>
    <div class="cols cols-2" style="margin-top:14px"><div class="card"><h3>Hours by person</h3>${tableHtml([{ key: 'name', label: 'Person' }, { key: 'hours', label: 'Hours', right: 1, fmt: qty }, { key: 'cost', label: 'Cost', right: 1, fmt: money }], p.by_person, { empty: 'No hours logged yet.' })}</div>
      <div class="card"><h3>Invoices</h3>${tableHtml([{ key: 'number', label: 'Invoice', fmt: v => v || 'Draft' }, { key: 'invoice_date', label: 'Date', fmt: d }, { key: 'status', label: 'Status', html: 1, fmt: v => badge(v) }, { key: 'total', label: 'Total', right: 1, fmt: money }], p.invoices, { rowAttr: r => `data-inv="${r.id}"`, empty: 'Not invoiced yet.' })}</div></div>
    ${p.description ? `<div class="card" style="margin-top:14px"><h3>Scope</h3><p style="white-space:pre-wrap">${esc(p.description)}</p></div>` : ''}`, { back: '#/projects' });
  filesCard('project', p.id, 'Drawings, contracts & photos');
  const reload = () => projectForm(view, [id]);
  $$('[data-mv]').forEach(b => b.onclick = async e => { e.stopPropagation(); const [tid, st] = b.dataset.mv.split(':'); try { await PUT('/tasks/' + tid, { status: st }); reload(); } catch (x) { err(x); } });
  $$('[data-t]').forEach(c => c.onclick = () => taskDialog(p, p.tasks.find(t => String(t.id) === c.dataset.t), reload));
  $$('[data-inv]').forEach(tr => tr.onclick = () => { location.hash = '#/invoice/' + tr.dataset.inv; });
  $('#pLog').onclick = () => logDialog({ project_id: p.id }, reload);
  if ($('#pTask')) $('#pTask').onclick = () => taskDialog(p, null, reload);
  if ($('#pEdit')) $('#pEdit').onclick = () => projectDialog(p, reload);
  if ($('#pInv')) $('#pInv').onclick = () => {
    const fixed = p.billing === 'fixed';
    const f = fixed ? [{ key: 'percent', label: '% of the contract value', type: 'number', nullable: true }, { key: 'amount', label: 'or an amount excl. VAT (M)', type: 'number', nullable: true }, { key: 'description', label: 'Line text', span: 2 }]
      : [{ key: 'to', label: 'Invoice hours up to and including', type: 'date' }];
    modal({ title: `Invoice ${p.name}`, body: formHtml(f, fixed ? {} : { to: today() }, { ctx: 'projinv' }) + (fixed ? '' : `<p class="muted">${qty(p.to_invoice_hours)} billable hours (${money(p.to_invoice_amount)} excl. VAT) are not invoiced yet.</p>`),
      actions: [{ label: 'Cancel' }, { label: 'Make draft invoice', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); const out = await POST(`/projects/${p.id}/invoice`, v); c(); toast('Draft invoice made – check and post it'); location.hash = '#/invoice/' + out.invoice_id; } }] });
  };
}

async function taskDialog(p, t, done) {
  const us = await users();
  const mgr = can('projects') || p.manager_id === state.user.id;
  const f = [{ key: 'title', label: 'Task', required: true, span: 2 }, { key: 'assigned_to', label: 'Done by', type: 'select', numeric: true, options: us.length ? userOpts(us) : [{ value: state.user.id, label: state.user.name }] },
    { key: 'status', label: 'Status', type: 'select', options: COLS.map(([value, label]) => ({ value, label })) },
    { key: 'priority', label: 'Priority', type: 'select', options: ['low', 'normal', 'high', 'urgent'].map(v => ({ value: v, label: v })) }, { key: 'due_date', label: 'Due', type: 'date' },
    { key: 'estimate_hours', label: 'Estimated hours', type: 'number', nullable: true }, { key: 'description', label: 'Details', type: 'textarea', rows: 3, span: 2 }];
  const acts = [{ label: 'Close' }];
  if (t) acts.push({ label: '🕒 Log hours', onClick: c => { c(); logDialog({ task_id: t.id, project_id: p.id }, done); } });
  if (mgr || !t) acts.push({ label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); if (t) await PUT('/tasks/' + t.id, v); else await POST('/tasks', { ...v, project_id: p.id }); c(); done(); } });
  modal({ title: t ? t.title : 'New task', size: 'lg', body: formHtml(f, t ? { ...t, due_date: d(t.due_date) } : { status: 'todo', priority: 'normal', assigned_to: state.user.id }, { ctx: 'task' }), actions: acts,
    onOpen: r => { if (!mgr && t) $$('input, select, textarea', r).forEach(i => { if (i.name !== 'status') i.disabled = true; }); } });
}

async function logDialog(preset, done) {
  const projs = await GET('/projects?status=active');
  const tasks = preset.project_id ? await GET('/tasks?project_id=' + preset.project_id).catch(() => []) : [];
  const f = [{ key: 'work_date', label: 'Date', type: 'date', required: true }, { key: 'hours', label: 'Hours', type: 'number', required: true },
    ...(preset.ticket_id ? [] : [{ key: 'project_id', label: 'Project', type: 'select', numeric: true, required: true, options: projs.map(x => ({ value: x.id, label: `${x.code || ''} ${x.name}` })) },
      { key: 'task_id', label: 'Task', type: 'select', numeric: true, options: [{ value: '', label: '—' }, ...tasks.map(t => ({ value: t.id, label: t.title }))] }]),
    { key: 'description', label: 'What was done', span: 2 }, { key: 'billable', label: 'Charge the customer for these hours', type: 'checkbox', default: 1 }];
  modal({ title: 'Log hours', body: formHtml(f, { work_date: today(), billable: 1, ...preset }, { ctx: 'timesheet' }),
    onOpen: r => { const ps = r.querySelector('[name=project_id]'); if (ps) ps.onchange = async () => { const ts = await GET('/tasks?project_id=' + ps.value).catch(() => []); r.querySelector('[name=task_id]').innerHTML = `<option value="">—</option>${ts.map(t => `<option value="${t.id}">${esc(t.title)}</option>`).join('')}`; }; },
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); const body = { ...preset, ...v }; if (!body.task_id) delete body.task_id; await POST('/timesheets', body); c(); toast(`${v.hours} h logged`); done && done(); } }] });
}

/* ======================= TIMESHEETS ======================= */
export async function timesheets(view) {
  const q = query();
  const monday = (() => { const x = new Date(); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; })();
  const from = q.from || monday, to = q.to || today();
  const all = can('projects') && q.who === 'all';
  const [ts, tasks] = await Promise.all([GET(`/timesheets?from=${from}&to=${to}${all ? '' : '&mine=1'}`), GET('/tasks?mine=1&open=1')]);
  view.innerHTML = page('Timesheets', `<button class="btn btn-primary" id="lg">＋ Log hours</button>`, `
    <div class="cols" style="grid-template-columns:2fr 1fr;align-items:start"><div class="card">
      <div class="row wrap" style="margin-bottom:10px"><label>From <input type="date" id="tf" value="${from}"></label><label>To <input type="date" id="tt" value="${to}"></label>
        ${can('projects') ? `<select id="tw"><option value="me">My hours</option><option value="all" ${all ? 'selected' : ''}>Everybody</option></select>` : ''}<button class="btn" id="tgo">Show</button>
        <span class="spacer"></span><b>${qty(ts.total_hours)} h</b><span class="muted">(${qty(ts.billable_hours)} billable)</span></div>
      ${tableHtml([{ key: 'work_date', label: 'Date', fmt: d }, ...(all ? [{ key: 'user_name', label: 'Person' }] : []), { key: 'project_name', label: 'Project / ticket', fmt: (v, r) => v || r.ticket_number || '' },
        { key: 'task_title', label: 'Task' }, { key: 'description', label: 'Work' }, { key: 'hours', label: 'Hours', right: 1, fmt: qty },
        { key: 'billable', label: 'Billable', fmt: v => v ? '✓' : '' }, { key: 'invoice_number', label: 'Invoiced', html: 1, fmt: (v, r) => r.invoice_id ? badge(v || 'draft', 'paid') : '' },
        { key: 'id', label: '', html: 1, fmt: (v, r) => r.invoice_id ? '' : `<button class="icon-btn" data-del="${v}" title="Delete">✕</button>` }], ts.rows, { empty: 'No hours in this period.' })}</div>
      <div class="card"><h3>My open tasks</h3>${tasks.length ? tasks.map(t => `<div class="kb-card" data-t="${t.id}" data-p="${t.project_id}"><b>${esc(t.title)}</b> ${prTag(t.priority)}<small>${esc(t.project_name)}${t.due_date ? ' · due ' + esc(d(t.due_date)) : ''} · ${qty(t.hours)} h</small>
        <div class="row" style="margin-top:6px"><button class="btn btn-sm" data-log="${t.id}">🕒 Log</button>${t.status !== 'doing' ? `<button class="btn btn-sm" data-st="${t.id}:doing">Start</button>` : ''}<button class="btn btn-sm" data-st="${t.id}:${t.status === 'review' ? 'done' : 'review'}">✓ Finished</button></div></div>`).join('') : '<div class="muted">Nothing assigned to you.</div>'}</div></div>`);
  $('#tgo').onclick = () => { location.hash = `#/timesheets?from=${$('#tf').value}&to=${$('#tt').value}${$('#tw') && $('#tw').value === 'all' ? '&who=all' : ''}`; };
  const reload = () => timesheets(view);
  $('#lg').onclick = () => logDialog({}, reload);
  $$('[data-log]').forEach(b => b.onclick = () => { const t = tasks.find(x => String(x.id) === b.dataset.log); logDialog({ task_id: t.id, project_id: t.project_id }, reload); });
  $$('[data-st]').forEach(b => b.onclick = async () => { const [tid, st] = b.dataset.st.split(':'); await PUT('/tasks/' + tid, { status: st }); reload(); });
  $$('[data-del]').forEach(b => b.onclick = async () => { if (await confirmBox('Delete these hours?', { danger: true, okLabel: 'Delete' })) { await DEL('/timesheets/' + b.dataset.del); reload(); } });
}

/* ======================= HELPDESK ======================= */
const TS = { new: ['New', 'draft'], open: ['Open', 'posted'], waiting: ['Waiting for customer', 'partial'], solved: ['Solved', 'paid'], closed: ['Closed', 'closed'] };
const tsBadge = s => badge((TS[s] || [s])[0], (TS[s] || [s, ''])[1]);
const KIND = { question: 'Question', problem: 'Problem', repair: 'Repair / job card', request: 'Request' };

export async function helpdesk(view) {
  const q = query(); const tab = q.tab || 'tickets';
  view.innerHTML = page('Helpdesk & repairs', `<button class="btn btn-primary" id="nt">＋ New ticket</button>`, `<div id="kp"></div>
    <div class="tabs">${[['tickets', 'Tickets'], ...(can('settings') ? [['settings', 'Settings']] : [])].map(([k, l]) => `<a href="#/helpdesk?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="hb"></div>`);
  $('#nt').onclick = () => ticketDialog(null, t => { location.hash = '#/ticket/' + t.id; });
  const hb = $('#hb');
  if (tab === 'settings') {
    const s = await GET('/helpdesk/settings');
    const f = [{ key: 'labour_rate', label: 'Labour rate per hour excl. VAT (M)', type: 'number' }, ...['urgent', 'high', 'normal', 'low'].map(p => ({ key: 'sla_' + p, label: `Respond to ${p} tickets within (hours)`, type: 'number' }))];
    hb.innerHTML = `<div class="card" style="max-width:720px">${formHtml(f, { labour_rate: s.labour_rate, ...Object.fromEntries(Object.entries(s.sla_hours).map(([k, v]) => ['sla_' + k, v])) }, { ctx: 'hdsettings' })}<div class="row"><span class="spacer"></span><button class="btn btn-primary" id="hs">Save</button></div></div>`;
    $('#hs').onclick = async () => { try { const v = readForm(hb, f); await PUT('/helpdesk/settings', { labour_rate: v.labour_rate, sla_hours: { urgent: v.sla_urgent, high: v.sla_high, normal: v.sla_normal, low: v.sla_low } }); toast('Saved'); } catch (e) { err(e); } };
    return;
  }
  GET('/tickets/summary').then(s => { $('#kp').innerHTML = `<div class="cols cols-4" style="margin-bottom:14px">
    <div class="kpi"><div class="label">Open tickets</div><div class="value">${s.open}</div><div class="hint">${s.new} new · ${s.mine} mine</div></div>
    <div class="kpi"><div class="label">Past their deadline</div><div class="value" style="color:${s.overdue ? 'var(--bad)' : 'var(--ok)'}">${s.overdue}</div></div>
    <div class="kpi"><div class="label">Solved (30 days)</div><div class="value">${s.solved_30}</div><div class="hint">${s.avg_solve_hours != null ? `avg ${qty(s.avg_solve_hours)} h to solve` : ''}</div></div>
    <div class="kpi"><div class="label">Answered in time</div><div class="value">${s.sla_met_pct != null ? s.sla_met_pct + '%' : '–'}</div></div></div>`; }).catch(() => {});
  const st = q.status || 'open';
  const rows = await GET(`/tickets?status=${st}${q.mine ? '&mine=1' : ''}${q.q ? '&q=' + encodeURIComponent(q.q) : ''}`);
  hb.innerHTML = `<div class="row wrap" style="margin-bottom:8px">${[['open', 'Open'], ['solved', 'Solved'], ['all', 'All']].map(([k, l]) => `<a class="btn btn-sm ${k === st && !q.mine ? 'btn-primary' : ''}" href="#/helpdesk?status=${k}">${l}</a>`).join('')}
    <a class="btn btn-sm ${q.mine ? 'btn-primary' : ''}" href="#/helpdesk?status=open&mine=1">Mine</a><span class="spacer"></span><input id="hq" placeholder="Search number, customer, phone, serial…" value="${esc(q.q || '')}" style="max-width:300px"></div>
    <div class="card">${tableHtml([{ key: 'number', label: 'Number' }, { key: 'subject', label: 'Subject', html: 1, fmt: (v, r) => `<b>${esc(v)}</b>${r.item ? `<br><small class="muted">${esc(r.item)}${r.serial_no ? ' · S/N ' + esc(r.serial_no) : ''}</small>` : ''}` },
      { key: 'partner_name', label: 'Customer', fmt: (v, r) => v || r.contact_name || r.phone || '' }, { key: 'kind', label: 'Type', fmt: v => KIND[v] || v },
      { key: 'priority', label: 'Priority', html: 1, fmt: v => prTag(v) || '<span class="muted">' + v + '</span>' }, { key: 'status', label: 'Status', html: 1, fmt: tsBadge },
      { key: 'sla_due', label: 'Respond by', html: 1, fmt: (v, r) => !v || ['solved', 'closed'].includes(r.status) ? '' : `<span class="${Number(r.overdue) ? 'neg' : ''}">${esc(dt(v))}${Number(r.overdue) ? ' ⚠' : ''}</span>` },
      { key: 'assigned_name', label: 'Technician' }], rows, { rowAttr: r => `data-id="${r.id}"`, empty: 'No tickets here.' })}</div>`;
  $$('[data-id]', hb).forEach(tr => tr.onclick = () => { location.hash = '#/ticket/' + tr.dataset.id; });
  let tm; $('#hq').oninput = e => { clearTimeout(tm); tm = setTimeout(() => { location.hash = `#/helpdesk?status=all&q=${encodeURIComponent(e.target.value)}`; }, 500); };
}

async function ticketDialog(t, done) {
  const [cust, us, projs] = await Promise.all([GET('/partners?is_customer=1'), users(), can('projects') ? GET('/projects?status=active') : []]);
  const f = [{ key: 'subject', label: 'Subject', required: true, span: 2 }, { key: 'partner_id', label: 'Customer', type: 'select', numeric: true, options: [{ value: '', label: '— not in contacts —' }, ...cust.map(c => ({ value: c.id, label: c.name }))] },
    { key: 'contact_name', label: 'Contact name' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' },
    { key: 'kind', label: 'Type', type: 'select', options: Object.entries(KIND).map(([value, label]) => ({ value, label })) },
    { key: 'channel', label: 'Came in by', type: 'select', options: [['phone', 'Phone'], ['walk_in', 'Walk-in'], ['whatsapp', 'WhatsApp'], ['email', 'Email'], ['other', 'Other']].map(([value, label]) => ({ value, label })) },
    { key: 'priority', label: 'Priority', type: 'select', options: ['low', 'normal', 'high', 'urgent'].map(v => ({ value: v, label: v })) },
    { key: 'assigned_to', label: 'Technician', type: 'select', numeric: true, options: us.length ? userOpts(us) : [{ value: '', label: '—' }, { value: state.user.id, label: state.user.name }] },
    { key: 'item', label: 'Item brought in (repairs)' }, { key: 'serial_no', label: 'Serial / IMEI number' },
    ...(projs.length ? [{ key: 'project_id', label: 'Project / contract', type: 'select', numeric: true, options: [{ value: '', label: '—' }, ...projs.map(p => ({ value: p.id, label: p.name }))] }] : []),
    { key: 'description', label: 'What the customer says', type: 'textarea', rows: 3, span: 2 }];
  modal({ title: t ? t.number : 'New ticket', size: 'lg', body: formHtml(f, t || { kind: 'problem', channel: 'phone', priority: 'normal' }, { ctx: 'ticket' }), actions: [{ label: 'Cancel' },
    { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); const out = t ? await PUT('/tickets/' + t.id, v) : await POST('/tickets', v); c(); toast(t ? 'Saved' : `${out.number} created`); done(out); } }] });
}

export async function ticketForm(view, [idq]) {
  const id = (idq || '').split('?')[0];
  const t = await GET('/tickets/' + id);
  const closed = ['solved', 'closed'].includes(t.status);
  const acts = ['<button class="btn" id="tEdit">Edit</button>', '<button class="btn" id="tTime">🕒 Log time</button>'];
  if (t.kind === 'repair') acts.push('<button class="btn" id="tCard">🖨 Job card</button>');
  if (!t.invoice_id && can('invoicing')) acts.push('<button class="btn btn-ok" id="tInv">🧾 Invoice</button>');
  if (t.invoice_id) acts.push(`<a class="btn" href="#/invoice/${t.invoice_id}">Invoice ${esc(t.invoice_number || 'draft')}</a>`);
  acts.push(closed ? '<button class="btn" id="tReopen">Reopen</button>' : '<button class="btn btn-primary" id="tSolve">✓ Solved</button>');
  const parts = t.parts.map(p => ({ product_id: p.product_id, qty: Number(p.qty), unit_price: Number(p.unit_price) }));
  view.innerHTML = page(`${t.number} · ${t.subject}`, acts.join(''), `
    <div class="cols" style="grid-template-columns:2fr 1fr;align-items:start"><div>
      <div class="card"><div class="row wrap" style="margin-bottom:8px">${tsBadge(t.status)} ${prTag(t.priority)} ${badge(KIND[t.kind], 'posted')}
        ${!closed && t.sla_due ? `<span class="${Number(t.overdue) ? 'neg' : 'muted'}">respond by ${esc(dt(t.sla_due))}${Number(t.overdue) ? ' ⚠ late' : ''}</span>` : ''}</div>
        ${t.description ? `<p style="white-space:pre-wrap;margin-top:0">${esc(t.description)}</p>` : ''}
        <div class="thread">${t.messages.map(m => `<div class="msg ${m.internal ? 'internal' : ''}"><div class="muted" style="font-size:12px">${esc(m.user_name || '')} · ${esc(dt(m.created_at))}${m.internal ? ' · internal note' : ''}</div><div style="white-space:pre-wrap">${esc(m.body)}</div></div>`).join('')}</div>
        <textarea id="mBody" rows="3" placeholder="Reply to the customer, or an internal note…" style="width:100%;margin-top:10px"></textarea>
        <div class="row wrap" style="margin-top:6px"><label class="row" style="gap:6px"><input type="checkbox" id="mInt"> Internal note (customer does not see it)</label>
          ${t.email || t.partner_email ? '<label class="row" style="gap:6px"><input type="checkbox" id="mMail"> Also email it</label>' : ''}<span class="spacer"></span>
          <select id="mSt"><option value="">keep status</option><option value="waiting">→ waiting for customer</option><option value="solved">→ solved</option></select><button class="btn btn-primary" id="mSend">Add</button></div></div>
      ${t.kind === 'repair' || t.parts.length ? `<div class="card" style="margin-top:14px"><h3>Parts used</h3><div id="tp"></div></div>` : ''}
      <div class="card" style="margin-top:14px"><h3>Time <small class="muted" style="font-weight:400">${qty(t.hours)} h</small></h3>${tableHtml([{ key: 'work_date', label: 'Date', fmt: d }, { key: 'user_name', label: 'Who' }, { key: 'description', label: 'Work' }, { key: 'hours', label: 'Hours', right: 1, fmt: qty }, { key: 'billable', label: 'Charge', fmt: v => v ? '✓' : '' }], t.time, { empty: 'No time logged.' })}</div>
    </div>
    <div class="card"><h3>Customer</h3><p style="margin-top:0"><b>${esc(t.partner_name || t.contact_name || '')}</b><br>${esc(t.phone || t.partner_phone || '')}<br>${esc(t.email || t.partner_email || '')}</p>
      ${t.item ? `<h3>Item</h3><p style="margin-top:0">${esc(t.item)}${t.serial_no ? '<br>S/N ' + esc(t.serial_no) : ''}</p>` : ''}
      <p class="muted">Came in by ${esc(String(t.channel).replace('_', '-'))} · ${esc(dt(t.created_at))}<br>Technician: ${esc(t.assigned_name || '–')}${t.project_name ? '<br>Project: ' + esc(t.project_name) : ''}</p></div></div>`, { back: '#/helpdesk' });
  filesCard('ticket', t.id, 'Photos & files');
  const reload = () => ticketForm(view, [id]);
  if ($('#tp')) {
    const prods = (await GET('/products')).filter(p => p.type !== 'service');
    const draw = () => {
      $('#tp').innerHTML = `<table class="grid lines"><thead><tr><th>Part</th><th class="r" style="width:90px">Qty</th><th class="r" style="width:120px">Price incl. VAT</th>${t.invoice_id ? '' : '<th style="width:32px"></th>'}</tr></thead><tbody>
        ${parts.map((p, i) => t.invoice_id ? `<tr><td>${esc((prods.find(x => x.id === p.product_id) || {}).name || '')}</td><td class="r">${qty(p.qty)}</td><td class="r">${money(p.unit_price)}</td></tr>`
          : `<tr><td><select data-i="${i}" data-k="product_id"><option value="">—</option>${prods.map(x => `<option value="${x.id}" ${x.id === p.product_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></td>
          <td><input data-i="${i}" data-k="qty" type="number" step="any" class="r" value="${p.qty}"></td><td><input data-i="${i}" data-k="unit_price" type="number" step="any" class="r" value="${p.unit_price}"></td><td><button class="icon-btn" data-del="${i}">✕</button></td></tr>`).join('')}</tbody></table>
        ${t.invoice_id ? '' : '<div class="row" style="margin-top:8px"><button class="btn btn-sm" id="pAdd">＋ Part</button><span class="spacer"></span><button class="btn btn-sm btn-primary" id="pSave">Save parts</button></div><small class="help-note">Parts leave stock when the job is invoiced. Price 0 = free (warranty).</small>'}`;
      $$('[data-k]', $('#tp')).forEach(inp => inp.oninput = inp.onchange = () => { const p = parts[Number(inp.dataset.i)]; const k = inp.dataset.k; p[k] = k === 'product_id' ? Number(inp.value) || null : Number(inp.value);
        if (k === 'product_id') { const x = prods.find(z => z.id === p.product_id); if (x) p.unit_price = Number(x.price); draw(); } });
      $$('[data-del]', $('#tp')).forEach(b => b.onclick = () => { parts.splice(Number(b.dataset.del), 1); draw(); });
      if ($('#pAdd')) $('#pAdd').onclick = () => { parts.push({ product_id: null, qty: 1, unit_price: 0 }); draw(); };
      if ($('#pSave')) $('#pSave').onclick = async () => { try { await PUT(`/tickets/${t.id}/parts`, { parts: parts.filter(p => p.product_id) }); toast('Parts saved'); reload(); } catch (e) { err(e); } };
    };
    if (!parts.length && !t.invoice_id) parts.push({ product_id: null, qty: 1, unit_price: 0 });
    draw();
  }
  $('#mSend').onclick = async () => {
    try { await POST(`/tickets/${t.id}/messages`, { body: $('#mBody').value, internal: $('#mInt').checked, email: $('#mMail') && $('#mMail').checked && !$('#mInt').checked, status: $('#mSt').value || undefined }); reload(); } catch (e) { err(e); }
  };
  $('#tEdit').onclick = () => ticketDialog(t, reload);
  $('#tTime').onclick = () => logDialog({ ticket_id: t.id }, reload);
  if ($('#tSolve')) $('#tSolve').onclick = async () => { await POST(`/tickets/${t.id}/status`, { status: 'solved' }); toast('Solved'); reload(); };
  if ($('#tReopen')) $('#tReopen').onclick = async () => { await POST(`/tickets/${t.id}/status`, { status: 'open' }); reload(); };
  if ($('#tInv')) $('#tInv').onclick = () => {
    const f = [{ key: 'callout', label: 'Call-out fee excl. VAT (optional)', type: 'number', nullable: true }];
    modal({ title: `Invoice ${t.number}`, body: `<p>The invoice takes the parts above and the ${qty(t.hours)} billable hour(s) logged on this ticket.</p>${formHtml(f, {}, { ctx: 'ticket' })}`,
      actions: [{ label: 'Cancel' }, { label: 'Make draft invoice', cls: 'btn-primary', onClick: async (c, r) => { const out = await POST(`/tickets/${t.id}/invoice`, readForm(r, f)); c(); toast('Draft invoice made – check and post it'); location.hash = '#/invoice/' + out.invoice_id; } }] });
  };
  if ($('#tCard')) $('#tCard').onclick = () => {
    const c = state.company || {};
    printHtml(`<div style="font-family:Arial,sans-serif;font-size:13px;max-width:760px;margin:auto"><h2 style="margin:0">${esc(c.name || '')}</h2><div>${esc(c.address || '')}${c.phone ? ' · ' + esc(c.phone) : ''}</div>
      <h1 style="font-size:20px;margin:16px 0 4px">Job card ${esc(t.number)}</h1><p>Booked in ${esc(dt(t.created_at))}</p>
      <table style="width:100%" cellpadding="4"><tr><td><b>Customer</b><br>${esc(t.partner_name || t.contact_name || '')}<br>${esc(t.phone || t.partner_phone || '')}</td><td><b>Item</b><br>${esc(t.item || '')}<br>S/N ${esc(t.serial_no || '')}</td></tr></table>
      <p><b>Fault reported:</b> ${esc(t.subject)}${t.description ? '<br>' + esc(t.description) : ''}</p>
      <p>Accessories left with the item: ______________________________________</p><p>Condition (scratches, cracks): ______________________________________</p>
      <p style="font-size:11px">Items not collected within 90 days after we notify you may be sold to cover costs. A quote is given before any repair above the call-out fee.</p>
      <table style="width:100%;margin-top:30px"><tr><td>Customer signature: ____________________</td><td>Received by: ____________________</td></tr></table></div>`);
  };
}
