// Internal audit: audit committee dashboard, audit universe & risk heat map, annual plan / engagements, action tracker;
// one engagement (planning, work programme with data tests, findings & action plans, the report with PDF / Word / Excel
// export); and "My audit actions" for managers who own an action.
import { state, GET, POST, PUT, esc, $, $$, toast, err, can, money, modal, confirmBox, formHtml, readForm, tableHtml, badge, page, d, dt, today, query } from './core.js';
import { exportButtons, wireExport, toWord, toPdf } from './reportexport.js';
import { workbook, download } from './xlsx.js';

const RT = { critical: ['critical', 'cancelled'], high: ['high', 'cancelled'], medium: ['medium', 'partial'], low: ['low', 'draft'] };
const rBadge = r => badge((RT[r] || [r])[0], (RT[r] || [r, ''])[1]);
const ES = { planned: 'planned', fieldwork: 'fieldwork', review: 'in review', draft_report: 'draft report', final: 'report issued', closed: 'closed', cancelled: 'cancelled' };
const AS = { open: ['open', 'draft'], in_progress: ['in progress', 'partial'], implemented: ['implemented – to verify', 'posted'], verified: ['verified', 'ok'], overdue_extended: ['extended', 'partial'], not_implemented: ['not implemented', 'cancelled'] };
const aBadge = (s, over) => over ? badge('overdue', 'cancelled') : badge((AS[s] || [s])[0], (AS[s] || [s, ''])[1]);
const OVR = { satisfactory: 'Satisfactory', needs_improvement: 'Needs improvement', unsatisfactory: 'Unsatisfactory' };
const year = () => Number(query().year) || Number(today().slice(0, 4));

export async function internalAudit(view) {
  const tab = query().tab || 'dashboard';
  const tabs = [['dashboard', 'Audit committee dashboard'], ['plan', 'Annual plan & engagements'], ['universe', 'Audit universe & risk'], ['actions', 'Action tracker']];
  view.innerHTML = page('Internal audit', '<button class="btn btn-primary" id="ne">＋ Engagement</button>', `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/internalaudit?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="ib"></div>`);
  $('#ne').onclick = () => engagementDialog(null, id => { location.hash = '#/iaeng/' + id; });
  const T = { dashboard, plan, universe, actions };
  await (T[tab] || dashboard)($('#ib'), () => internalAudit(view));
}
async function dashboard(ib) {
  const x = await GET('/ia/dashboard?year=' + year());
  ib.innerHTML = `<div class="row no-print" style="margin-bottom:10px"><label>Year <input type="number" id="dy" value="${x.year}" style="width:90px"></label><span class="spacer"></span>${exportButtons('xp')}</div><div id="rep">
    <div class="cols cols-4" style="margin-bottom:12px"><div class="kpi"><div class="label">Plan ${x.year}</div><div class="value">${x.engagements.completed} / ${x.engagements.planned}</div><div class="hint">engagements completed</div></div>
      <div class="kpi"><div class="label">High-risk areas covered</div><div class="value">${x.coverage.high_risk_planned} / ${x.coverage.high_risk}</div><div class="hint">${x.coverage.overdue_areas} areas due for audit</div></div>
      <div class="kpi"><div class="label">Open actions</div><div class="value">${x.actions.open}</div><div class="hint" style="color:${x.actions.overdue ? 'var(--bad)' : 'inherit'}">${x.actions.overdue} overdue</div></div>
      <div class="kpi"><div class="label">Implementation rate</div><div class="value">${x.actions.implementation_rate === null ? '–' : x.actions.implementation_rate + '%'}</div><div class="hint">of actions that fell due</div></div></div>
    <div class="cols cols-2"><div class="card"><h3>Engagements by stage</h3>${tableHtml([{ key: 'status', label: 'Stage', fmt: v => ES[v] }, { key: 'n', label: 'Engagements', right: 1 }], x.engagements.by_status.filter(s => s.n))}</div>
      <div class="card"><h3>Findings ${x.year}</h3>${tableHtml([{ key: 'rating', label: 'Rating', html: 1, fmt: rBadge }, { key: 'total', label: 'Raised', right: 1 }, { key: 'open', label: 'Still open', right: 1 }], x.findings)}</div></div>
    <div class="card"><h3>Overdue management actions</h3>${tableHtml([{ key: 'engagement_no', label: 'Engagement' }, { key: 'finding', label: 'Finding' }, { key: 'rating', label: 'Rating', html: 1, fmt: rBadge }, { key: 'action_text', label: 'Action' }, { key: 'owner', label: 'Owner' }, { key: 'effective_due', label: 'Due', fmt: d }], x.actions.overdue_list, { empty: 'No overdue actions. ✅' })}</div></div>`;
  $('#dy').onchange = e => { location.hash = '#/internalaudit?tab=dashboard&year=' + e.target.value; };
  wireExport('xp', '#rep', `Internal audit – audit committee report ${x.year}`);
}
async function plan(ib) {
  const rows = await GET('/ia/engagements?year=' + year());
  ib.innerHTML = `<div class="row no-print" style="margin-bottom:10px"><label>Year <input type="number" id="py" value="${year()}" style="width:90px"></label><span class="spacer"></span>${exportButtons('xp')}</div>
    <div class="card" id="rep"><h3>Internal audit plan ${year()}</h3>${tableHtml([{ key: 'number', label: 'No.' }, { key: 'title', label: 'Engagement' }, { key: 'universe_name', label: 'Area' }, { key: 'kind', label: 'Type' }, { key: 'lead_name', label: 'Lead' },
      { key: 'planned_start', label: 'Start', fmt: d }, { key: 'planned_end', label: 'End', fmt: d }, { key: 'steps', label: 'Work done', right: 1, fmt: (v, g) => v ? `${g.steps_done}/${v}` : '' }, { key: 'findings', label: 'Findings', right: 1, fmt: (v, g) => v ? `${v}${g.high_findings ? ` (${g.high_findings} high)` : ''}` : '' },
      { key: 'overall_rating', label: 'Rating', fmt: v => OVR[v] || '' }, { key: 'status', label: 'Stage', fmt: v => ES[v] }], rows, { rowAttr: g => `data-g="${g.id}"`, empty: 'No engagements planned yet – start from the audit universe (highest risk first).' })}</div>`;
  $('#py').onchange = e => { location.hash = '#/internalaudit?tab=plan&year=' + e.target.value; };
  wireExport('xp', '#rep', `Internal audit plan ${year()}`);
  $$('[data-g]', ib).forEach(tr => tr.onclick = () => { location.hash = '#/iaeng/' + tr.dataset.g; });
}
async function universe(ib, reload) {
  const rows = await GET('/ia/universe');
  const cell = (i, l) => rows.filter(u => Number(u.impact) === i && Number(u.likelihood) === l);
  const colr = s => s >= 20 ? '#fecaca' : s >= 12 ? '#fed7aa' : s >= 6 ? '#fef08a' : '#bbf7d0';
  ib.innerHTML = `<div class="row no-print" style="margin-bottom:10px"><span class="spacer"></span>${exportButtons('xp')}<button class="btn btn-primary" id="un">＋ Area</button></div><div id="rep">
    <div class="cols cols-2"><div class="card"><h3>Risk heat map</h3><table class="grid" style="table-layout:fixed"><tr><th style="width:80px">Impact ↓ / Likelihood →</th>${[1, 2, 3, 4, 5].map(l => `<th class="r">${l}</th>`).join('')}</tr>
      ${[5, 4, 3, 2, 1].map(i => `<tr><th>${i}</th>${[1, 2, 3, 4, 5].map(l => `<td style="background:${colr(i * l)};font-size:11px;height:48px">${cell(i, l).map(u => esc(u.name)).join('<br>')}</td>`).join('')}</tr>`).join('')}</table></div>
    <div class="card"><h3>How the risk score works</h3><p>Score = impact × likelihood (1–5 each), plus 5 when controls are weak, plus 2 when unknown, less 3 when strong. High ≥ 20, medium ≥ 10. Areas past their audit frequency are flagged as due.</p></div></div>
    <div class="card"><h3>Audit universe</h3>${tableHtml([{ key: 'name', label: 'Area' }, { key: 'owner', label: 'Owner' }, { key: 'impact', label: 'Impact', right: 1 }, { key: 'likelihood', label: 'Likelihood', right: 1 }, { key: 'control_rating', label: 'Controls' },
      { key: 'risk_score', label: 'Score', right: 1, html: 1, fmt: (v, u) => `<b>${v}</b> ${rBadge(u.risk_level)}` }, { key: 'last_audited', label: 'Last audited', fmt: d }, { key: 'next_due', label: 'Due', html: 1, fmt: (v, u) => u.overdue ? `<b class="neg">${v ? d(v) : 'never audited'}</b>` : d(v) },
      { key: 'id', label: '', html: 1, fmt: v => `<button class="btn btn-sm" data-plan="${v}">Plan audit</button>` }], rows, { rowAttr: u => `data-u="${u.id}"` })}</div></div>`;
  wireExport('xp', '#rep', 'Internal audit universe and risk assessment');
  const f = [{ key: 'name', label: 'Area', required: true }, { key: 'area', label: 'Programme', type: 'select', options: [{ value: '', label: '–' }, ...(await GET('/ia/programmes')).map(p => ({ value: p.key, label: p.name }))] }, { key: 'owner', label: 'Owner (manager)' },
    { key: 'impact', label: 'Impact 1–5', type: 'number' }, { key: 'likelihood', label: 'Likelihood 1–5', type: 'number' }, { key: 'control_rating', label: 'Controls', type: 'select', options: ['strong', 'adequate', 'weak', 'unknown'].map(v => ({ value: v, label: v })) },
    { key: 'frequency_months', label: 'Audit every … months', type: 'number' }, { key: 'last_audited', label: 'Last audited', type: 'date' }, { key: 'description', label: 'Notes', span: 2 }];
  const dlg = u => modal({ title: u ? u.name : 'New auditable area', body: formHtml(f, u || { impact: 3, likelihood: 3, control_rating: 'unknown', frequency_months: 12 }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); if (u) await PUT('/ia/universe/' + u.id, v); else await POST('/ia/universe', v); c(); reload(); } }] });
  $('#un').onclick = () => dlg(null);
  $$('[data-u]', ib).forEach(tr => tr.onclick = e => { if (e.target.dataset.plan) return; dlg(rows.find(u => u.id === Number(tr.dataset.u))); });
  $$('[data-plan]', ib).forEach(b => b.onclick = () => { const u = rows.find(x => x.id === Number(b.dataset.plan)); engagementDialog({ universe_id: u.id, title: `Audit of ${u.name.toLowerCase()}`, programme: u.area }, id => { location.hash = '#/iaeng/' + id; }); });
}
async function actions(ib) {
  const rows = await GET('/ia/actions');
  ib.innerHTML = `<div class="row no-print" style="margin-bottom:10px"><span class="spacer"></span>${exportButtons('xp')}</div><div class="card" id="rep"><h3>Management action tracker</h3>${actTable(rows)}</div>`;
  wireExport('xp', '#rep', 'Internal audit action tracker');
  wireActions(ib, rows, () => actions(ib));
}
const actTable = rows => tableHtml([{ key: 'engagement_no', label: 'Engagement' }, { key: 'finding_ref', label: 'Ref' }, { key: 'finding', label: 'Finding' }, { key: 'rating', label: 'Rating', html: 1, fmt: rBadge }, { key: 'action_text', label: 'Agreed action' },
  { key: 'owner', label: 'Owner' }, { key: 'effective_due', label: 'Due', fmt: d }, { key: 'status', label: 'Status', html: 1, fmt: (v, a) => aBadge(v, a.overdue) }, { key: 'progress_note', label: 'Progress' }], rows, { rowAttr: a => `data-a="${a.id}"`, empty: 'No agreed actions yet.' });
function wireActions(root, rows, reload) {
  $$('[data-a]', root).forEach(tr => tr.onclick = () => {
    const a = rows.find(x => x.id === Number(tr.dataset.a)); const ia = can('internal_audit');
    const f = ia ? [{ key: 'status', label: 'Verification', type: 'select', options: [{ value: 'verified', label: 'Verified – the action works' }, { value: 'not_implemented', label: 'Not implemented – risk remains' }] }, { key: 'verification_note', label: 'Evidence checked', type: 'textarea', span: 2 }]
      : [{ key: 'status', label: 'Status', type: 'select', options: [{ value: 'in_progress', label: 'In progress' }, { value: 'implemented', label: 'Implemented – ready for audit to check' }, { value: 'overdue_extended', label: 'Need more time' }] }, { key: 'revised_due', label: 'New due date (if more time)', type: 'date' }, { key: 'progress_note', label: 'Progress / what was done', type: 'textarea', span: 2 }];
    modal({ title: `${a.engagement_no} ${a.finding_ref}: ${a.finding}`, body: `<p><b>Action:</b> ${esc(a.action_text)}<br>Owner ${esc(a.owner)} · due ${d(a.effective_due)} · ${aBadge(a.status, a.overdue)}</p>${a.progress_note ? `<p><b>Progress:</b> ${esc(a.progress_note)}</p>` : ''}${a.verification_note ? `<p><b>Verified:</b> ${esc(a.verification_note)}</p>` : ''}
      ${['verified', 'not_implemented'].includes(a.status) ? '' : formHtml(f, ia ? { status: 'verified' } : { status: a.status === 'open' ? 'in_progress' : a.status })}`,
      actions: ['verified', 'not_implemented'].includes(a.status) ? [{ label: 'Close' }] : [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/ia/actions/${a.id}/update`, readForm(r, f)); toast('Saved'); c(); reload(); } }] });
  });
}
export async function myActions(view) {
  const rows = await GET('/ia/actions');
  view.innerHTML = page('My audit actions', '', `<div class="card"><p class="muted">Actions you agreed to after an internal audit. Report progress here; internal audit checks and closes them.</p>${actTable(rows)}</div>`);
  wireActions(view, rows, () => myActions(view));
}
async function engagementDialog(pre, done) {
  const [uni, progs, users] = await Promise.all([GET('/ia/universe'), GET('/ia/programmes'), GET('/users').catch(() => [])]);
  const f = [{ key: 'title', label: 'Title', required: true, span: 2 }, { key: 'universe_id', label: 'Area', type: 'select', options: [{ value: '', label: '–' }, ...uni.map(u => ({ value: u.id, label: `${u.name} (risk ${u.risk_score})` }))] },
    { key: 'kind', label: 'Type', type: 'select', options: ['assurance', 'compliance', 'financial', 'it', 'investigation', 'follow_up', 'consulting'].map(v => ({ value: v, label: v.replace('_', ' ') })) },
    ...(pre && pre.id ? [] : [{ key: 'programme', label: 'Start from the standard work programme', type: 'select', options: [{ value: '', label: '– none –' }, ...progs.map(p => ({ value: p.key, label: `${p.name} (${p.steps} steps)` }))] }, { key: 'plan_year', label: 'Plan year', type: 'number' }]),
    { key: 'lead_id', label: 'Engagement lead', type: 'select', options: users.filter(u => u.active).map(u => ({ value: u.id, label: u.name })) }, { key: 'team', label: 'Team' }, { key: 'auditee', label: 'Auditee (department)' },
    { key: 'planned_start', label: 'Planned start', type: 'date' }, { key: 'planned_end', label: 'Planned end', type: 'date' }, { key: 'budget_days', label: 'Budget (days)', type: 'number' },
    { key: 'objectives', label: 'Objectives', type: 'textarea', span: 2 }, { key: 'scope', label: 'Scope (and what is excluded)', type: 'textarea', span: 2 }, { key: 'methodology', label: 'Approach', type: 'textarea', span: 2 }];
  modal({ title: pre && pre.id ? `Edit ${pre.number}` : 'New engagement', size: 'lg', body: formHtml(f, { kind: 'assurance', plan_year: Number(today().slice(0, 4)), lead_id: state.user.id, ...(pre || {}) }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => {
    const v = readForm(r, f); const x = pre && pre.id ? await PUT('/ia/engagements/' + pre.id, v) : await POST('/ia/engagements', v); c(); done && done(x.id);
  } }] });
}

/* ============================== one engagement ============================== */
export async function iaEngagement(view, [idq]) {
  const id = Number(String(idq || '').split('?')[0]);
  const g = await GET('/ia/engagements/' + id), reload = () => iaEngagement(view, [String(id)]);
  const tab = query().tab || 'programme';
  const frozen = ['final', 'closed', 'cancelled'].includes(g.status);
  const nextLabel = { planned: 'Start fieldwork', fieldwork: 'Send for review', review: 'Review done → draft report', draft_report: 'Issue final report', final: 'Close engagement' }[g.status];
  view.innerHTML = page(`${g.number} – ${g.title}`, `<a class="btn" href="#/internalaudit?tab=plan">← Plan</a>${!frozen ? '<button class="btn" id="ge">Edit</button>' : ''}${nextLabel ? `<button class="btn btn-primary" id="gn">${nextLabel}</button>` : ''}`,
    `<div class="cols cols-4" style="margin-bottom:12px"><div class="kpi"><div class="label">Stage</div><div class="value" style="font-size:18px">${ES[g.status]}</div><div class="hint">${esc(g.kind)} · ${esc(g.universe_name || '')}</div></div>
      <div class="kpi"><div class="label">Work programme</div><div class="value">${g.steps.filter(s => s.result !== 'not_started').length} / ${g.steps.length}</div><div class="hint">${g.steps.filter(s => s.result === 'exceptions').length} with exceptions</div></div>
      <div class="kpi"><div class="label">Findings</div><div class="value">${g.findings.length}</div><div class="hint">${['critical', 'high', 'medium', 'low'].map(r => `${g.findings.filter(f => f.rating === r).length} ${r}`).join(' · ')}</div></div>
      <div class="kpi"><div class="label">Lead / reviewer</div><div class="value" style="font-size:16px">${esc(g.lead_name || '')}</div><div class="hint">${g.reviewed_by_name ? 'reviewed by ' + esc(g.reviewed_by_name) : 'not reviewed yet'}</div></div></div>
    <div class="tabs">${[['programme', 'Work programme'], ['findings', 'Findings & actions'], ['planning', 'Planning'], ['report', 'Report']].map(([k, l]) => `<a href="#/iaeng/${id}?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="eb"></div>`);
  if ($('#ge')) $('#ge').onclick = () => engagementDialog(g, reload);
  if ($('#gn')) $('#gn').onclick = async () => { if (!(await confirmBox(`${nextLabel}?`, { okLabel: nextLabel }))) return; try { await POST(`/ia/engagements/${id}/advance`); toast('Done'); reload(); } catch (e) { err(e); } };
  const eb = $('#eb');
  if (tab === 'planning') {
    eb.innerHTML = `<div class="card"><h3>Objectives</h3><p style="white-space:pre-wrap">${esc(g.objectives || '–')}</p><h3>Scope</h3><p style="white-space:pre-wrap">${esc(g.scope || '–')}</p><h3>Approach</h3><p style="white-space:pre-wrap">${esc(g.methodology || '–')}</p>
      <p class="muted">Auditee ${esc(g.auditee || '–')} · team ${esc(g.team || '–')} · planned ${d(g.planned_start)} – ${d(g.planned_end)} · actual ${d(g.actual_start)} – ${d(g.actual_end)} · budget ${g.budget_days || '–'} days</p></div>`;
  }
  if (tab === 'programme') {
    const progs = await GET('/ia/programmes');
    eb.innerHTML = `<div class="row wrap" style="margin-bottom:10px">${!frozen ? `<select id="pp"><option value="">Add a standard programme…</option>${progs.map(p => `<option value="${p.key}">${esc(p.name)}</option>`).join('')}</select><button class="btn" id="ps">＋ Step</button>` : ''}<span class="spacer"></span><label>Data from <input type="date" id="tf" value="${today().slice(0, 4)}-01-01"></label><label>to <input type="date" id="tt" value="${today()}"></label></div>
      <div class="card">${tableHtml([{ key: 'ref', label: 'Ref' }, { key: 'objective', label: 'Objective' }, { key: 'procedure_text', label: 'Procedure' }, { key: 'sample_size', label: 'Sample', right: 1 }, { key: 'exceptions', label: 'Exceptions', right: 1 },
        { key: 'result', label: 'Result', html: 1, fmt: v => v === 'satisfactory' ? badge('satisfactory', 'ok') : v === 'exceptions' ? badge('exceptions', 'cancelled') : v === 'not_applicable' ? badge('n/a', 'closed') : badge('to do', 'draft') },
        { key: 'done_by_name', label: 'Done by', fmt: (v, s) => v ? `${v}${s.reviewed_by_name ? ' ✓ ' + s.reviewed_by_name : ''}` : '' }, { key: 'notes', label: '', html: 1, fmt: (v, s) => /\[data test:/.test(v || '') && !frozen ? `<button class="btn btn-sm" data-test="${s.id}">▶ Run data test</button>` : '' }], g.steps, { rowAttr: s => `data-s="${s.id}"`, empty: 'Add a standard programme or your own steps.' })}</div>`;
    if ($('#pp')) $('#pp').onchange = async e => { if (!e.target.value) return; const x = await POST(`/ia/engagements/${id}/programme`, { programme: e.target.value }); toast(`${x.added} steps added`); reload(); };
    const stepDlg = s => { const f = [{ key: 'ref', label: 'Ref' }, { key: 'objective', label: 'Objective' }, { key: 'procedure_text', label: 'Audit procedure', type: 'textarea', span: 2, required: true }, { key: 'sample_size', label: 'Sample size', type: 'number' }, { key: 'exceptions', label: 'Exceptions found', type: 'number' },
        { key: 'result', label: 'Result', type: 'select', options: [['not_started', 'To do'], ['satisfactory', 'Satisfactory'], ['exceptions', 'Exceptions found'], ['not_applicable', 'Not applicable']].map(([value, label]) => ({ value, label })) }, { key: 'notes', label: 'Working paper notes', type: 'textarea', rows: 6, span: 2 }];
      modal({ title: s ? `Step ${s.ref || ''}` : 'New step', size: 'lg', body: formHtml(f, s || { result: 'not_started' }), actions: [{ label: 'Cancel' }, ...(s && s.done_by && s.done_by !== state.user.id && !s.reviewed_by ? [{ label: 'Mark reviewed', onClick: async c => { await PUT(`/ia/engagements/${id}/steps/${s.id}`, { review: true }); c(); reload(); } }] : []),
        ...(frozen ? [] : [{ label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); if (s) await PUT(`/ia/engagements/${id}/steps/${s.id}`, v); else await POST(`/ia/engagements/${id}/steps`, v); c(); reload(); } }])] }); };
    if ($('#ps')) $('#ps').onclick = () => stepDlg(null);
    $$('[data-s]', eb).forEach(tr => tr.onclick = e => { if (e.target.dataset.test) return; stepDlg(g.steps.find(s => s.id === Number(tr.dataset.s))); });
    $$('[data-test]', eb).forEach(b => b.onclick = async () => { try { const x = await POST(`/ia/steps/${b.dataset.test}/test`, { from: $('#tf').value, to: $('#tt').value });
      modal({ title: `${x.title}: ${x.count} item(s)`, size: 'lg', body: x.rows.length ? tableHtml(x.cols.map(k => ({ key: k, label: k.replace(/_/g, ' ') })), x.rows) : '<p>No exceptions in this period. ✅</p>', actions: [{ label: 'Close', onClick: c => { c(); reload(); } }, ...(x.count ? [{ label: 'Raise finding', cls: 'btn-primary', onClick: c => { c(); findingDialog(g, { title: x.title, condition_text: `The data test "${x.title}" returned ${x.count} item(s) for the period.` }, reload); } }] : [])] }); } catch (e) { err(e); } });
  }
  if (tab === 'findings') {
    eb.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="spacer"></span>${!frozen ? '<button class="btn btn-primary" id="fn">＋ Finding</button>' : ''}</div>
      ${g.findings.map(f => `<div class="card"><div class="row"><h3 style="flex:1">${esc(f.ref)} ${esc(f.title)} ${rBadge(f.rating)}</h3>${!frozen ? `<button class="btn btn-sm" data-ef="${f.id}">Edit</button>` : `<button class="btn btn-sm" data-resp="${f.id}">Management response</button>`}<button class="btn btn-sm" data-aa="${f.id}">＋ Action</button></div>
        <p><b>Condition:</b> ${esc(f.condition_text)}</p>${f.criteria ? `<p><b>Criteria:</b> ${esc(f.criteria)}</p>` : ''}${f.cause ? `<p><b>Cause:</b> ${esc(f.cause)}</p>` : ''}${f.effect ? `<p><b>Effect:</b> ${esc(f.effect)}</p>` : ''}<p><b>Recommendation:</b> ${esc(f.recommendation)}</p>
        <p><b>Management response</b>${f.response_by ? ` (${esc(f.response_by)})` : ''}: ${f.management_response ? esc(f.management_response) : '<span class="muted">awaited</span>'} ${f.agreed === 0 ? badge('not agreed – risk accepted', 'cancelled') : f.agreed ? badge('agreed', 'ok') : ''}</p>
        ${f.actions.length ? tableHtml([{ key: 'action_text', label: 'Agreed action' }, { key: 'owner', label: 'Owner' }, { key: 'due_date', label: 'Due', fmt: d }, { key: 'status', label: 'Status', html: 1, fmt: v => aBadge(v) }], f.actions) : ''}</div>`).join('') || '<div class="card"><div class="empty">No findings yet.</div></div>'}`;
    if ($('#fn')) $('#fn').onclick = () => findingDialog(g, null, reload);
    $$('[data-ef]', eb).forEach(b => b.onclick = () => findingDialog(g, g.findings.find(f => f.id === Number(b.dataset.ef)), reload));
    $$('[data-resp]', eb).forEach(b => b.onclick = () => { const f = g.findings.find(x => x.id === Number(b.dataset.resp)); const ff = [{ key: 'management_response', label: 'Management response', type: 'textarea', span: 2 }];
      modal({ title: 'Management response', body: formHtml(ff, f), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await PUT(`/ia/engagements/${id}/findings/${f.id}`, readForm(r, ff)); c(); reload(); } }] }); });
    $$('[data-aa]', eb).forEach(b => b.onclick = async () => { const users = await GET('/users').catch(() => []);
      const ff = [{ key: 'action_text', label: 'Action management will take', type: 'textarea', span: 2, required: true }, { key: 'owner', label: 'Responsible person', required: true }, { key: 'owner_user_id', label: '… their login (so they can report progress)', type: 'select', options: [{ value: '', label: '–' }, ...users.filter(u => u.active).map(u => ({ value: u.id, label: u.name }))] }, { key: 'due_date', label: 'Due date', type: 'date', required: true }];
      modal({ title: 'Agreed action', body: formHtml(ff, {}), actions: [{ label: 'Cancel' }, { label: 'Add', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/ia/findings/${b.dataset.aa}/actions`, readForm(r, ff)); c(); reload(); } }] }); });
  }
  if (tab === 'report') {
    const rp = await GET(`/ia/engagements/${id}/report`);
    const sumF = [{ key: 'executive_summary', label: 'Executive summary', type: 'textarea', rows: 5, span: 2 }, { key: 'overall_rating', label: 'Overall rating', type: 'select', options: [{ value: '', label: '–' }, ...Object.entries(OVR).map(([value, label]) => ({ value, label }))] }, { key: 'conclusion', label: 'Conclusion', type: 'textarea', span: 2 }];
    eb.innerHTML = `${!frozen ? `<div class="card no-print">${formHtml(sumF, g)}<div class="row"><span class="spacer"></span><button class="btn" id="ss">Save summary</button></div></div>` : ''}
      <div class="row no-print" style="margin-bottom:10px"><span class="spacer"></span>${exportButtons('xp')}</div><div class="card" id="rep">${reportHtml(rp)}</div>`;
    if ($('#ss')) $('#ss').onclick = async () => { try { await PUT('/ia/engagements/' + id, readForm(eb, sumF)); toast('Saved'); reload(); } catch (e) { err(e); } };
    const title = `Internal audit report ${g.number} – ${g.title}`;
    $('#xp-pdf').onclick = () => toPdf(reportHtml(rp), title);
    $('#xp-doc').onclick = () => toWord(reportHtml(rp), title);
    $('#xp-xls').onclick = () => download(workbook([
      { name: 'Summary', rows: [['Engagement', g.number], ['Title', g.title], ['Area', g.universe_name || ''], ['Stage', ES[g.status]], ['Overall rating', OVR[g.overall_rating] || ''], ['Issued', g.issued_at ? String(g.issued_at).slice(0, 10) : ''], ['Executive summary', g.executive_summary || '']], header: false },
      { name: 'Findings', rows: [['Ref', 'Title', 'Rating', 'Condition', 'Criteria', 'Cause', 'Effect', 'Recommendation', 'Management response', 'Agreed', 'Status'], ...g.findings.map(f => [f.ref, f.title, f.rating, f.condition_text, f.criteria || '', f.cause || '', f.effect || '', f.recommendation, f.management_response || '', f.agreed ? 'Yes' : f.agreed === 0 ? 'No' : '', f.status])] },
      { name: 'Action plan', rows: [['Finding', 'Action', 'Owner', 'Due', 'Status', 'Progress', 'Verification'], ...g.findings.flatMap(f => f.actions.map(a => [f.ref, a.action_text, a.owner, String(a.due_date).slice(0, 10), a.status, a.progress_note || '', a.verification_note || '']))] },
      { name: 'Work programme', rows: [['Ref', 'Objective', 'Procedure', 'Sample', 'Exceptions', 'Result', 'Notes'], ...g.steps.map(s => [s.ref || '', s.objective || '', s.procedure_text, s.sample_size ?? '', s.exceptions ?? '', s.result, s.notes || ''])] }]), `${g.number.replace(/\//g, '-')}-report.xlsx`);
  }
}
function findingDialog(g, f, done) {
  const ff = [{ key: 'title', label: 'Title', required: true, span: 2 }, { key: 'rating', label: 'Rating', type: 'select', options: ['critical', 'high', 'medium', 'low'].map(v => ({ value: v, label: v })) }, { key: 'amount', label: 'Amount involved (optional)', type: 'number' },
    { key: 'condition_text', label: 'Condition – what we found', type: 'textarea', span: 2, required: true }, { key: 'criteria', label: 'Criteria – what should be (policy, law, good practice)', type: 'textarea', span: 2 },
    { key: 'cause', label: 'Cause – why it happened', type: 'textarea', span: 2 }, { key: 'effect', label: 'Effect – the risk or loss', type: 'textarea', span: 2 }, { key: 'recommendation', label: 'Recommendation', type: 'textarea', span: 2, required: true },
    { key: 'management_response', label: 'Management response', type: 'textarea', span: 2 }, { key: 'response_by', label: 'Response from' }, { key: 'agreed', label: 'Management agrees', type: 'checkbox' }];
  modal({ title: f && f.id ? `Finding ${f.ref}` : 'New finding', size: 'lg', body: formHtml(ff, { rating: 'medium', agreed: 1, ...(f || {}) }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => {
    const v = readForm(r, ff); if (f && f.id) await PUT(`/ia/engagements/${g.id}/findings/${f.id}`, v); else await POST(`/ia/engagements/${g.id}/findings`, v); c(); done && done();
  } }] });
}
/** the engagement report: cover, executive summary, scope, rating, findings summary, detailed findings with responses and actions, work programme appendix */
function reportHtml(rp) {
  const g = rp.engagement, co = rp.company, s = rp.summary;
  const p = t => esc(t || '').replace(/\n/g, '<br>');
  return `<div style="border:2px solid #333;padding:16px;margin-bottom:16px"><div class="muted">${esc(co.name || '')} – Internal Audit</div><h1 style="margin:6px 0">${esc(g.title)}</h1>
      <p>Report ${esc(g.number)} · ${g.status === 'final' || g.status === 'closed' ? `issued ${d(g.issued_at)}` : '<b>DRAFT</b>'} · overall rating: <b>${esc(OVR[g.overall_rating] || 'not rated')}</b></p>
      <p class="muted">Distribution: ${rp.distribution.map(esc).join('; ')}</p></div>
    <h2>1. Executive summary</h2><p>${p(g.executive_summary) || '<i>To be written.</i>'}</p>
    <table><tr><th>Critical</th><th>High</th><th>Medium</th><th>Low</th><th>Procedures performed</th><th>With exceptions</th></tr><tr><td>${s.critical}</td><td>${s.high}</td><td>${s.medium}</td><td>${s.low}</td><td>${s.steps}</td><td>${s.exceptions}</td></tr></table>
    <h2>2. Background, objectives and scope</h2><p><b>Area:</b> ${esc(g.universe_name || '')} · <b>Auditee:</b> ${esc(g.auditee || '')} · <b>Type:</b> ${esc(g.kind)}</p><h3>Objectives</h3><p>${p(g.objectives)}</p><h3>Scope</h3><p>${p(g.scope)}</p>${g.methodology ? `<h3>Approach</h3><p>${p(g.methodology)}</p>` : ''}
      <p>Fieldwork ${d(g.actual_start) || d(g.planned_start)} to ${d(g.actual_end) || d(g.planned_end)} by ${esc(g.lead_name || '')}${g.team ? ', ' + esc(g.team) : ''}; reviewed by ${esc(g.reviewed_by_name || '–')}.</p>
    <h2>3. Summary of findings</h2><table><tr><th>Ref</th><th>Finding</th><th>Rating</th><th>Agreed</th><th>Action owner</th><th>Due</th></tr>${g.findings.map(f => `<tr><td>${esc(f.ref)}</td><td>${esc(f.title)}</td><td>${esc(f.rating)}</td><td>${f.agreed ? 'Yes' : f.agreed === 0 ? 'No' : ''}</td><td>${f.actions.map(a => esc(a.owner)).join(', ')}</td><td>${f.actions.map(a => d(a.due_date)).join(', ')}</td></tr>`).join('') || '<tr><td colspan="6">No findings.</td></tr>'}</table>
    <h2>4. Detailed findings</h2>${g.findings.map(f => `<h3>${esc(f.ref)}. ${esc(f.title)} (${esc(f.rating)})</h3><table>
      <tr><th style="width:22%">Condition</th><td>${p(f.condition_text)}</td></tr>${f.criteria ? `<tr><th>Criteria</th><td>${p(f.criteria)}</td></tr>` : ''}${f.cause ? `<tr><th>Cause</th><td>${p(f.cause)}</td></tr>` : ''}${f.effect ? `<tr><th>Effect</th><td>${p(f.effect)}</td></tr>` : ''}
      <tr><th>Recommendation</th><td>${p(f.recommendation)}</td></tr><tr><th>Management response</th><td>${p(f.management_response) || '<i>awaited</i>'}${f.response_by ? `<br><i>– ${esc(f.response_by)}</i>` : ''}</td></tr>
      ${f.actions.map(a => `<tr><th>Agreed action</th><td>${p(a.action_text)}<br><b>Owner:</b> ${esc(a.owner)} · <b>Due:</b> ${d(a.due_date)} · <b>Status:</b> ${esc((AS[a.status] || [a.status])[0])}</td></tr>`).join('')}</table>`).join('') || '<p>No findings.</p>'}
    <h2>5. Conclusion</h2><p>${p(g.conclusion) || '–'}</p>
    <h2>Appendix A – Rating definitions</h2><table><tr><th>Critical</th><td>Immediate action; significant loss, fraud or legal breach likely.</td></tr><tr><th>High</th><td>Action within 1–3 months; key control missing or not working.</td></tr><tr><th>Medium</th><td>Action within 6 months; control weakness with moderate risk.</td></tr><tr><th>Low</th><td>Improvement to good practice.</td></tr></table>
    <h2>Appendix B – Work performed</h2><table><tr><th>Ref</th><th>Procedure</th><th>Sample</th><th>Exceptions</th><th>Result</th></tr>${g.steps.map(st => `<tr><td>${esc(st.ref || '')}</td><td>${esc(st.procedure_text)}</td><td>${st.sample_size ?? ''}</td><td>${st.exceptions ?? ''}</td><td>${esc(st.result.replace('_', ' '))}</td></tr>`).join('')}</table>`;
}
