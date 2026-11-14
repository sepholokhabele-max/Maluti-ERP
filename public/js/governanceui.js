// Organisation: the organogram (chart, units, positions, acting appointments), the delegation of authority matrix that
// decides who approves what in every module, a "who would approve this?" simulator, decision rights (RACI), communication
// lines, the approval history; and "My role" for every employee.
import { state, GET, POST, PUT, esc, $, $$, toast, err, can, money, modal, confirmBox, formHtml, readForm, tableHtml, badge, page, d, dt, query } from './core.js';
import { inboxHtml, wireInbox, trail } from './govapprove.js';
import { exportButtons, wireExport } from './reportexport.js';

const STYLE = { formal: 'Formal – in writing, through the line', consultative: 'Consultative – ask before deciding', collaborative: 'Collaborative – decide together', directive: 'Directive – clear instructions, quick decisions' };
const KIND = { board: 'Board', executive: 'Executive', division: 'Division', department: 'Department', section: 'Section', unit: 'Unit', committee: 'Committee' };
const lim = (v, unit) => v === null || v === undefined ? 'No limit' : unit === 'days' ? `${Number(v)} days` : money(v);
let META = null;
const meta = async () => META || (META = await GET('/gov/meta'));

export async function governance(view) {
  const tab = query().tab || 'chart', edit = can('governance');
  const tabs = [['chart', 'Organogram'], ['positions', 'Positions'], ['units', 'Units & communication'], ['doa', 'Delegation of authority'], ['simulate', 'Who approves?'], ['decisions', 'Decision rights'], ['inbox', 'My approvals'], ...(can('governance') || can('audit') ? [['history', 'Approval history']] : [])];
  view.innerHTML = page('Organisation & governance', edit ? '<button class="btn" id="gpos">＋ Position</button> <button class="btn" id="gunit">＋ Unit</button>' : '',
    `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/governance?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="gb"></div>`);
  const reload = () => governance(view);
  if ($('#gpos')) $('#gpos').onclick = () => positionDialog(null, reload);
  if ($('#gunit')) $('#gunit').onclick = () => unitDialog(null, reload);
  const T = { chart, positions, units, doa, simulate, decisions, inbox, history };
  await (T[tab] || chart)($('#gb'), reload);
}

/* ---------------- organogram ---------------- */
async function chart(gb, reload) {
  const c = await GET('/gov/chart');
  if (!c.positions) {
    gb.innerHTML = `<div class="card" style="max-width:720px"><h3>Set up your organogram</h3><p>The organogram is the backbone of approvals: once positions and their authority are set, every module asks it who must approve a purchase order, expense claim, journal, leave, payroll, budget, procurement, asset write-off, policy or contract.</p>
      ${can('governance') ? `<p><button class="btn btn-primary" id="s1">Start from a standard structure</button> <button class="btn" id="s2">Start from a water-utility structure</button></p><p class="muted">Board, executive, finance, operations, HR, customer services and internal audit, with a typical delegation of authority. Change everything to match your board-approved structure.</p>` : '<p class="muted">Ask a manager to set it up.</p>'}</div>`;
    const seed = kind => async () => { try { await POST('/gov/seed', { kind }); toast('Structure created – now put people in the positions'); location.hash = '#/governance?tab=positions'; } catch (e) { err(e); } };
    if ($('#s1')) { $('#s1').onclick = seed('standard'); $('#s2').onclick = seed('water'); }
    return;
  }
  const node = p => `<li><div class="org-box ${p.vacant && !p.acting ? 'org-vacant' : ''}" data-p="${p.id}"><b>${esc(p.title)}</b><span>${p.holder_name ? esc(p.holder_name) : p.acting ? '' : '<i>vacant</i>'}${p.acting ? `<br><small>acting: ${esc(p.acting_name || '')}</small>` : ''}</span><small class="muted">${esc(p.unit_name || '')}</small></div>
    ${p.children.length ? `<ul>${p.children.map(node).join('')}</ul>` : ''}</li>`;
  gb.innerHTML = `<div class="row no-print" style="margin-bottom:10px"><span class="muted">${c.positions} positions · ${c.vacant} vacant · ${c.units} units. Click a position for its reporting lines, authority and how to communicate.</span><span class="spacer"></span>${exportButtons('xp')}</div>
    <div class="card org-wrap" id="rep"><div class="org"><ul>${c.tree.map(node).join('')}</ul></div></div>`;
  wireExport('xp', '#rep', 'Organogram');
  $$('[data-p]', gb).forEach(b => b.onclick = () => commsDialog(Number(b.dataset.p), reload));
}
async function commsDialog(id, reload) {
  const c = await GET('/gov/comms/' + id);
  const S = x => x ? `${esc(x.title)}${x.holder ? ` <span class="muted">(${esc(x.holder)})</span>` : ' <i class="muted">vacant</i>'}` : '–';
  modal({ title: c.position.title, wide: true, body: `<div class="cols cols-2"><div>
      <p><b>Reports to:</b> ${S(c.reports_to)}</p><p><b>Direct reports:</b> ${c.direct_reports.map(S).join(', ') || '–'}</p><p><b>Peers:</b> ${c.peers.map(S).join(', ') || '–'}</p>
      <p><b>Escalation path:</b> ${c.escalation.map(S).join(' → ') || 'top of the organisation'}</p></div>
      <div><p><b>Communication style:</b> ${esc(STYLE[c.style] || c.style)}</p>${c.unit ? `<p><b>Unit:</b> ${esc(c.unit.name)}<br><b>Channels:</b> ${esc(c.unit.channels || '–')}<br><b>Meetings:</b> ${esc(c.unit.meetings || '–')}<br><b>Escalate unanswered requests after:</b> ${c.unit.escalation_days} day(s)</p>` : ''}</div></div>
    <h4>Authority</h4>${tableHtml([{ key: 'name', label: 'Document' }, { key: 'kind', label: 'Role', fmt: v => v === 'concur' ? 'Must agree' : 'Approves' }, { key: 'max_amount', label: 'Limit', right: 1, fmt: (v, g) => g.kind === 'concur' ? (g.min_amount ? 'from ' + money(g.min_amount) : 'all') : lim(v) }], c.authority, { empty: 'No approval authority.' })}
    <h4>Decisions</h4>${tableHtml([{ key: 'decision', label: 'Decision' }, { key: 'role', label: 'Role', fmt: v => ({ decides: 'Decides', recommends: 'Recommends', consulted: 'Consulted', informed: 'Informed' }[v]) }], c.decisions, { empty: 'None recorded.' })}`,
    actions: [{ label: 'Close' }, ...(can('governance') ? [{ label: 'Edit position', cls: 'btn-primary', onClick: async x => { x(); const ps = await GET('/gov/positions'); positionDialog(ps.find(p => p.id === id), reload); } }] : [])] });
}

/* ---------------- positions ---------------- */
async function positions(gb, reload) {
  const ps = await GET('/gov/positions');
  gb.innerHTML = `<div class="card">${tableHtml([{ key: 'title', label: 'Position', html: 1, fmt: (v, p) => `<b>${esc(v)}</b>${p.is_head ? ' ' + badge('head', 'ok') : ''}${p.grade ? ` <small class="muted">${esc(p.grade)}</small>` : ''}` },
    { key: 'unit_name', label: 'Unit' }, { key: 'reports_to_title', label: 'Reports to' }, { key: 'holder_name', label: 'Holder', html: 1, fmt: v => v ? esc(v) : '<i class="muted">vacant</i>' },
    { key: 'acting_name', label: 'Acting', html: 1, fmt: (v, p) => v ? `${esc(v)}<br><small class="muted">until ${d(p.acting_until)}</small>` : '' }, { key: 'employee_name', label: 'Employee record' }], ps,
    { rowAttr: p => `data-p="${p.id}" style="cursor:pointer"`, empty: 'No positions yet – start from the Organogram tab.' })}</div>`;
  $$('[data-p]', gb).forEach(tr => tr.onclick = () => can('governance') ? positionDialog(ps.find(p => p.id === Number(tr.dataset.p)), reload) : commsDialog(Number(tr.dataset.p), reload));
}
async function positionDialog(p, reload) {
  const [ps, us, ppl] = await Promise.all([GET('/gov/positions'), GET('/gov/units'), GET('/gov/people')]);
  const o = (rows, lbl = x => x.name) => [{ value: '', label: '–' }, ...rows.map(x => ({ value: x.id, label: lbl(x) }))];
  const f = [{ key: 'title', label: 'Position title', required: true }, { key: 'code', label: 'Code' }, { key: 'unit_id', label: 'Unit', type: 'select', options: o(us) },
    { key: 'reports_to_id', label: 'Reports to', type: 'select', options: o(ps.filter(x => !p || x.id !== p.id), x => x.title) }, { key: 'grade', label: 'Grade' }, { key: 'is_head', label: 'Head of the unit', type: 'checkbox' },
    { type: 'heading', label: 'People' }, { key: 'user_id', label: 'Holder (S-ERP user)', type: 'select', options: o(ppl.users, x => `${x.name} (${x.role})`) },
    { key: 'employee_id', label: 'Employee record', type: 'select', options: o(ppl.employees, x => `${x.name}${x.job_title ? ' – ' + x.job_title : ''}`) },
    { key: 'acting_user_id', label: 'Acting in this position', type: 'select', options: o(ppl.users) }, { key: 'acting_until', label: 'Acting until', type: 'date', help: 'An acting appointment always has an end date; it then lapses on its own.' },
    { type: 'heading', label: 'The job' }, { key: 'communication_style', label: 'Communication style (blank = the unit\'s)', type: 'select', options: [{ value: '', label: '–' }, ...Object.entries(STYLE).map(([value, label]) => ({ value, label }))] },
    { key: 'purpose', label: 'Purpose', type: 'textarea', span: 2 }, { key: 'responsibilities', label: 'Key responsibilities', type: 'textarea', rows: 4, span: 2 }];
  const v = p ? { ...p, acting_until: d(p.acting_until) } : {};
  modal({ title: p ? 'Position: ' + p.title : 'New position', wide: true, body: formHtml(f, v), actions: [{ label: 'Cancel' },
    ...(p ? [{ label: 'Remove position', cls: 'btn-danger', onClick: async c => { if (!(await confirmBox(`Remove "${p.title}"? Its authority stops; positions reporting to it must be moved first.`, { danger: true }))) return; await PUT('/gov/positions/' + p.id, { active: 0 }); c(); reload(); } }] : []),
    { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const b = readForm(r, f); for (const k of ['unit_id', 'reports_to_id', 'user_id', 'employee_id', 'acting_user_id']) b[k] = b[k] ? Number(b[k]) : null; if (!b.acting_user_id) b.acting_until = null;
      if (p) await PUT('/gov/positions/' + p.id, b); else await POST('/gov/positions', b); c(); toast('Saved'); reload(); } }] });
}

/* ---------------- units ---------------- */
async function units(gb, reload) {
  const us = await GET('/gov/units');
  const name = new Map(us.map(u => [u.id, u.name]));
  gb.innerHTML = `<div class="card">${tableHtml([{ key: 'name', label: 'Unit', html: 1, fmt: (v, u) => `<b>${esc(v)}</b> <small class="muted">${esc(KIND[u.kind])}</small>` }, { key: 'parent_id', label: 'Part of', fmt: v => name.get(v) || '' },
    { key: 'communication_style', label: 'Communication', fmt: v => (STYLE[v] || '').split(' – ')[0] }, { key: 'channels', label: 'Channels' }, { key: 'meeting_cadence', label: 'Meetings' },
    { key: 'escalation_days', label: 'Escalate after', right: 1, fmt: v => `${v} d` }, { key: 'cost_centre', label: 'Cost centre' }], us, { rowAttr: u => `data-u="${u.id}" style="cursor:pointer"`, empty: 'No units yet.' })}
    <p class="muted">Approvals waiting longer than the unit's escalation period appear for the next manager up the line.</p></div>`;
  if (can('governance')) $$('[data-u]', gb).forEach(tr => tr.onclick = () => unitDialog(us.find(u => u.id === Number(tr.dataset.u)), reload));
}
async function unitDialog(u, reload) {
  const [us, ppl] = await Promise.all([GET('/gov/units'), GET('/gov/people')]);
  const f = [{ key: 'name', label: 'Name', required: true }, { key: 'code', label: 'Code' }, { key: 'kind', label: 'Kind', type: 'select', options: Object.entries(KIND).map(([value, label]) => ({ value, label })) },
    { key: 'parent_id', label: 'Part of', type: 'select', options: [{ value: '', label: '–' }, ...us.filter(x => !u || x.id !== u.id).map(x => ({ value: x.id, label: x.name }))] },
    { key: 'cost_centre_id', label: 'Cost centre', type: 'select', options: [{ value: '', label: '–' }, ...ppl.cost_centres.map(x => ({ value: x.id, label: `${x.code} ${x.name}` }))] },
    { key: 'communication_style', label: 'Communication style', type: 'select', options: Object.entries(STYLE).map(([value, label]) => ({ value, label })) },
    { key: 'channels', label: 'Channels (e.g. memos, email, WhatsApp group)' }, { key: 'meeting_cadence', label: 'Meetings' }, { key: 'escalation_days', label: 'Escalate approvals after (days)', type: 'number', default: 3 },
    { key: 'mandate', label: 'Mandate', type: 'textarea', span: 2 }];
  modal({ title: u ? 'Unit: ' + u.name : 'New unit', wide: true, body: formHtml(f, u || {}), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => {
    const b = readForm(r, f); b.parent_id = Number(b.parent_id) || null; b.cost_centre_id = Number(b.cost_centre_id) || null;
    if (u) await PUT('/gov/units/' + u.id, b); else await POST('/gov/units', b); c(); toast('Saved'); reload(); } }] });
}

/* ---------------- delegation of authority ---------------- */
async function doa(gb, reload) {
  const [m, ps, gs] = await Promise.all([meta(), GET('/gov/positions'), GET('/gov/grants')]);
  const types = Object.entries(m.doc_types);
  const cell = (p, t) => {
    const a = gs.find(g => g.position_id === p.id && g.doc_type === t && g.kind === 'approve'), c = gs.find(g => g.position_id === p.id && g.doc_type === t && g.kind === 'concur');
    return `<td class="doa-cell ${a || c ? 'doa-on' : ''}" data-c="${p.id}|${t}">${a ? `<b>${lim(a.max_amount === null ? null : Number(a.max_amount), m.doc_types[t].unit)}</b>` : ''}${c ? `<br><small>agrees${Number(c.min_amount) ? ' ≥ ' + money(c.min_amount) : ''}</small>` : ''}</td>`;
  };
  const governed = new Set(gs.map(g => g.doc_type));
  gb.innerHTML = `<div class="row no-print" style="margin-bottom:10px"><span class="muted">Who may approve each kind of document, up to what amount. The first manager up the requester's reporting line with enough authority approves; positions that must agree sign first. A document type with no authorities uses the module's own permissions.${can('governance') ? ' Click a cell to change it.' : ''}</span><span class="spacer"></span>${exportButtons('xp')}</div>
    <div class="card" id="rep" style="overflow:auto"><table class="grid doa"><thead><tr><th>Position</th>${types.map(([k, t]) => `<th title="${esc(t.name)}">${esc(t.name)}<br><small class="${governed.has(k) ? '' : 'muted'}">${governed.has(k) ? 'organogram' : 'module rights'}</small></th>`).join('')}</tr></thead>
      <tbody>${ps.map(p => `<tr><th style="white-space:nowrap">${esc(p.title)}<br><small class="muted">${esc(p.holder_name || 'vacant')}</small></th>${types.map(([k]) => cell(p, k)).join('')}</tr>`).join('')}</tbody></table></div>`;
  wireExport('xp', '#rep', 'Delegation of authority');
  if (!can('governance')) return;
  $$('[data-c]', gb).forEach(td => td.onclick = () => {
    const [pid, t] = td.dataset.c.split('|'), p = ps.find(x => x.id === Number(pid)), T = m.doc_types[t];
    const a = gs.find(g => g.position_id === p.id && g.doc_type === t && g.kind === 'approve'), c = gs.find(g => g.position_id === p.id && g.doc_type === t && g.kind === 'concur');
    const f = [{ key: 'approve', label: 'May approve', type: 'checkbox' }, ...(T.amount ? [{ key: 'max_amount', label: `Up to (${T.unit === 'days' ? 'days' : 'M'}) – blank = no limit`, type: 'number', step: '0.01', nullable: true }] : []),
      { key: 'concur', label: 'Must agree before approval (concurrence)', type: 'checkbox' }, ...(T.amount ? [{ key: 'min_amount', label: 'Agrees only from this amount', type: 'number', step: '0.01' }] : [])];
    modal({ title: `${p.title} – ${T.name}`, body: formHtml(f, { approve: a ? 1 : 0, max_amount: a && a.max_amount !== null ? Number(a.max_amount) : '', concur: c ? 1 : 0, min_amount: c ? Number(c.min_amount) : 0 }),
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (x, r) => { const v = readForm(r, f);
        await PUT('/gov/grants', { rows: [{ position_id: p.id, doc_type: t, kind: 'approve', remove: !v.approve, max_amount: v.max_amount ?? null }, { position_id: p.id, doc_type: t, kind: 'concur', remove: !v.concur, min_amount: v.min_amount || 0 }] });
        x(); toast('Delegation of authority updated'); reload(); } }] });
  });
}
async function simulate(gb) {
  const [m, ppl] = await Promise.all([meta(), can('governance') ? GET('/gov/people') : Promise.resolve({ users: [state.user] })]);
  const f = [{ key: 'doc_type', label: 'Document', type: 'select', options: Object.entries(m.doc_types).map(([value, t]) => ({ value, label: t.name })) }, { key: 'amount', label: 'Amount (M or days)', type: 'number', step: '0.01' },
    { key: 'user_id', label: 'Raised by', type: 'select', options: ppl.users.map(u => ({ value: u.id, label: u.name })) }];
  gb.innerHTML = `<div class="card" style="max-width:760px"><h3>Who would approve this?</h3>${formHtml(f, { user_id: state.user.id })}<button class="btn btn-primary" id="run" style="margin-top:10px">Show the approval path</button><div id="out" style="margin-top:14px"></div></div>`;
  $('#run').onclick = async () => { try { const v = readForm(gb, f); const x = await POST('/gov/simulate', v);
    $('#out').innerHTML = !x.governed ? `<p>${esc(x.message)}</p>` : `<p>Raised by: <b>${esc(x.requester_position || 'someone with no position')}</b></p><ol>${x.steps.map(s => `<li>${s.kind === 'concur' ? 'Agrees' : '<b>Approves</b>'}: ${esc(s.approver)}</li>`).join('')}</ol>`;
  } catch (e) { $('#out').innerHTML = `<p class="neg">${esc(e.message)}</p>`; } };
}

/* ---------------- decision rights ---------------- */
async function decisions(gb, reload) {
  const [ds, ps] = await Promise.all([GET('/gov/decisions'), GET('/gov/positions')]);
  const names = s => String(s || '').split(',').filter(Boolean).map(id => (ps.find(p => p.id === Number(id)) || {}).title || '').filter(Boolean).join(', ');
  gb.innerHTML = `<div class="row no-print" style="margin-bottom:10px"><span class="muted">Who decides, who recommends, who must be consulted and who is informed (RACI).</span><span class="spacer"></span>${exportButtons('xp')}${can('governance') ? ' <button class="btn btn-primary" id="nd">＋ Decision</button>' : ''}</div>
    <div class="card" id="rep">${tableHtml([{ key: 'category', label: 'Area' }, { key: 'decision', label: 'Decision' }, { key: 'decides_title', label: 'Decides' }, { key: 'recommends_title', label: 'Recommends' }, { key: 'consulted', label: 'Consulted', fmt: names }, { key: 'informed', label: 'Informed', fmt: names }], ds,
      { rowAttr: x => `data-d="${x.id}" style="cursor:pointer"`, empty: 'No decision rights recorded yet.' })}</div>`;
  wireExport('xp', '#rep', 'Decision rights');
  const dlg = x => {
    const o = [{ value: '', label: '–' }, ...ps.map(p => ({ value: p.id, label: p.title }))];
    const f = [{ key: 'category', label: 'Area' }, { key: 'decision', label: 'Decision', required: true, span: 2 }, { key: 'decides_position_id', label: 'Decides', type: 'select', options: o }, { key: 'recommends_position_id', label: 'Recommends', type: 'select', options: o }];
    const chk = (k, sel) => `<div class="field" style="grid-column:1/-1"><span>${k === 'consulted' ? 'Consulted' : 'Informed'}</span><div class="row" style="flex-wrap:wrap;gap:8px">${ps.map(p => `<label class="check"><input type="checkbox" data-${k}="${p.id}" ${String(sel || '').split(',').includes(String(p.id)) ? 'checked' : ''}> ${esc(p.title)}</label>`).join('')}</div></div>`;
    modal({ title: x ? 'Decision' : 'New decision', wide: true, body: formHtml(f, x || {}) + chk('consulted', x && x.consulted) + chk('informed', x && x.informed), actions: [{ label: 'Cancel' },
      ...(x ? [{ label: 'Remove', cls: 'btn-danger', onClick: async c => { await PUT('/gov/decisions/' + x.id, { ...x, remove: 1 }); c(); reload(); } }] : []),
      { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const b = readForm(r, f); b.consulted = $$('[data-consulted]', r).filter(i => i.checked).map(i => Number(i.dataset.consulted)); b.informed = $$('[data-informed]', r).filter(i => i.checked).map(i => Number(i.dataset.informed));
        if (x) await PUT('/gov/decisions/' + x.id, b); else await POST('/gov/decisions', b); c(); reload(); } }] });
  };
  if (can('governance')) { $('#nd').onclick = () => dlg(null); $$('[data-d]', gb).forEach(tr => tr.onclick = () => dlg(ds.find(x => x.id === Number(tr.dataset.d)))); }
}

/* ---------------- approvals ---------------- */
async function inbox(gb, reload) {
  const [rows, mine] = await Promise.all([GET('/gov/inbox'), GET('/gov/mine')]);
  gb.innerHTML = `<div class="card"><h3>Waiting for my approval</h3>${inboxHtml(rows)}</div>
    <div class="card"><h3>My requests</h3>${tableHtml([{ key: 'doc_name', label: 'What' }, { key: 'summary', label: 'Details' }, { key: 'created_at', label: 'Sent', fmt: dt }, { key: 'status', label: 'Status', html: 1, fmt: (v, r) => badge(v, v === 'approved' ? 'ok' : v === 'rejected' ? 'cancelled' : 'draft') + (r.waiting_for ? `<br><small class="muted">waiting for ${esc(r.waiting_for)}</small>` : '') }], mine, { empty: 'You have not sent anything for approval yet.' })}</div>`;
  wireInbox(gb, rows, reload);
}
async function history(gb) {
  const rows = await GET('/gov/history');
  gb.innerHTML = `<div class="row no-print" style="margin-bottom:10px"><span class="spacer"></span>${exportButtons('xp')}</div><div class="card" id="rep">${tableHtml([{ key: 'created_at', label: 'Raised', fmt: dt }, { key: 'doc_type', label: 'Document', fmt: v => (META && META.doc_types[v] ? META.doc_types[v].name : v) },
    { key: 'summary', label: 'Details' }, { key: 'requester_name', label: 'By' }, { key: 'amount', label: 'Amount', right: 1, fmt: v => Number(v) ? money(v) : '' }, { key: 'steps', label: 'Path & signatures', html: 1, fmt: (v, r) => trail(r) + (r.steps || []).filter(s => s.decided_by_name).map(s => `<br><small class="muted">${esc(s.decided_by_name)} ${s.via && s.via !== 'holder' ? '(' + esc(s.via) + ')' : ''} ${dt(s.decided_at)}${s.note ? ' – ' + esc(s.note) : ''}</small>`).join('') },
    { key: 'status', label: 'Status', html: 1, fmt: v => badge(v, v === 'approved' ? 'ok' : v === 'rejected' ? 'cancelled' : 'draft') }], rows, { empty: 'No approvals yet.' })}</div>`;
  await meta(); wireExport('xp', '#rep', 'Approval history');
}

/* ---------------- my role ---------------- */
export async function myRole(view) {
  const me = await GET('/gov/me');
  const S = x => x ? `${esc(x.title)}${x.holder ? ` (${esc(x.holder)})` : ''}` : '–';
  view.innerHTML = page('My role', '', !me.positions.length ? '<div class="empty">You do not hold a position in the organogram yet.</div>' : me.positions.map(c => `<div class="card"><h3>${esc(c.position.title)}</h3>
    <div class="cols cols-2"><div><p><b>I report to:</b> ${S(c.reports_to)}</p><p><b>Reporting to me:</b> ${c.direct_reports.map(S).join(', ') || '–'}</p><p><b>If something is stuck, escalate to:</b> ${c.escalation.map(S).join(' → ') || '–'}</p></div>
    <div><p><b>How we communicate:</b> ${esc(STYLE[c.style] || c.style)}</p>${c.unit ? `<p><b>Channels:</b> ${esc(c.unit.channels || '–')}<br><b>Meetings:</b> ${esc(c.unit.meetings || '–')}</p>` : ''}</div></div>
    <h4>What I may approve</h4>${tableHtml([{ key: 'name', label: 'Document' }, { key: 'kind', label: 'Role', fmt: v => v === 'concur' ? 'Must agree' : 'Approve' }, { key: 'max_amount', label: 'Up to', right: 1, fmt: (v, g) => g.kind === 'concur' ? '' : lim(v) }], c.authority, { empty: 'Nothing – requests go to your manager.' })}
    <h4>My decisions</h4>${tableHtml([{ key: 'decision', label: 'Decision' }, { key: 'role', label: 'My role' }], c.decisions, { empty: 'None recorded.' })}</div>`).join(''));
}
