// e-Procurement: overview & scorecards, procurement cases (tenders, RFQs, waivers), supplier register, waiver register,
// compliance, my evaluations, settings – and one procurement case with every step from approval to contract.
import { state, GET, POST, PUT, esc, $, $$, toast, err, can, money, qty, modal, confirmBox, formHtml, readForm, tableHtml, badge, page, d, dt, today, query, filesCard, printHtml } from './core.js';
import { docButton } from './legalui.js';

const METHOD = { open: 'Open tender', restricted: 'Restricted tender', rfq: 'Request for quotations', waiver: 'Waiver (direct)' };
const STATUS = { draft: ['draft', 'draft'], submitted: ['waiting for approval', 'partial'], approved: ['approved', 'posted'], published: ['open for bids', 'posted'], closed: ['closed – to open', 'partial'],
  opened: ['bids opened', 'partial'], evaluated: ['evaluated', 'partial'], recommended: ['award recommended', 'partial'], awarded: ['awarded', 'ok'], challenged: ['challenged', 'cancelled'],
  contracted: ['contract issued', 'paid'], cancelled: ['cancelled', 'cancelled'] };
const stBadge = s => badge((STATUS[s] || [s])[0], (STATUS[s] || [s, ''])[1]);
const SUP = { pending: ['not yet verified', 'draft'], approved: ['approved', 'ok'], suspended: ['suspended', 'partial'], debarred: ['debarred', 'cancelled'] };
const supBadge = s => badge((SUP[s] || [s])[0], (SUP[s] || [s, ''])[1]);
const STEPS = ['draft', 'submitted', 'approved', 'published', 'closed', 'opened', 'evaluated', 'recommended', 'awarded', 'contracted'];
const flags = s => [s.citizen_owned && '🇱🇸 citizen', s.women_owned && '♀ women', s.youth_owned && 'youth', s.disabled_owned && '♿ disability', s.smme && 'SMME'].filter(Boolean).join(' · ');
const utcLocal = s => s ? new Date(String(s).replace(' ', 'T') + 'Z').toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
const office = () => can('procurement'), approver = () => can('procurement.approve');

/* ============================== main page ============================== */
export async function procurement(view) {
  const tab = query().tab || (office() ? 'overview' : 'my');
  const tabs = [...(office() ? [['overview', 'Overview & scorecards'], ['cases', 'Procurements'], ['suppliers', 'Supplier register'], ['waivers', 'Waiver register'], ['compliance', 'Expiring documents']] : []), ['my', 'My evaluations'], ...(can('settings') ? [['settings', 'Settings']] : [])];
  view.innerHTML = page('e-Procurement', office() ? '<a class="btn" href="/tenders" target="_blank">🌐 Public tender page</a><button class="btn" id="ns">＋ Supplier</button><button class="btn btn-primary" id="nt">＋ New procurement</button>' : '',
    `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/procurement?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="eb"></div>`);
  if ($('#nt')) $('#nt').onclick = () => tenderDialog(null, id => { location.hash = '#/tender/' + id; });
  if ($('#ns')) $('#ns').onclick = () => supplierDialog(null, () => { location.hash = '#/procurement?tab=suppliers'; procurement(view); });
  const T = { overview, cases, suppliers, waivers, compliance, my, settings };
  await (T[tab] || my)($('#eb'), () => procurement(view));
}

async function overview(eb) {
  const q = query(), from = q.from || today().slice(0, 4) + '-01-01', to = q.to || today();
  const x = await GET(`/procurement/scorecard?from=${from}&to=${to}`);
  const bar = (rows, color) => tableHtml([{ key: 'label', label: '' }, { key: 'value', label: 'Spend', right: 1, fmt: money }, { key: 'pct', label: '', html: 1, fmt: v => `<div style="display:flex;align-items:center;gap:6px;min-width:150px"><div style="height:10px;width:${Math.max(1, v)}%;max-width:100px;background:${color};border-radius:4px"></div>${v}%</div>` }, { key: 'suppliers', label: 'Suppliers', right: 1 }], rows);
  eb.innerHTML = `<div class="row wrap" style="margin-bottom:10px"><label>From <input type="date" id="of" value="${from}"></label><label>To <input type="date" id="ot" value="${to}"></label><button class="btn" id="og">Show</button><span class="spacer"></span><button class="btn" id="opr">🖨 Print scorecard</button></div>
    <div id="sc"><div class="cols cols-4" style="margin-bottom:12px">
      <div class="kpi"><div class="label">Purchasing (orders)</div><div class="value">${money(x.spend_total)}</div><div class="hint">${esc(x.from)} – ${esc(x.to)}</div></div>
      <div class="kpi"><div class="label">Citizen-owned share</div><div class="value">${x.ownership[0].pct}%</div><div class="hint">≥ ${x.majority_pct}% owned by Basotho</div></div>
      <div class="kpi"><div class="label">Women-owned share</div><div class="value">${x.groups[0].pct}%</div><div class="hint">youth ${x.groups[1].pct}% · SMME ${x.groups[3].pct}%</div></div>
      <div class="kpi"><div class="label">Awarded through waivers</div><div class="value" style="color:${x.waiver_pct > 20 ? 'var(--bad)' : 'inherit'}">${x.waiver_pct}%</div><div class="hint">${x.savings >= 0 ? 'saved' : 'over estimate'} ${money(Math.abs(x.savings))} (${Math.abs(x.savings_pct)}%) excl. VAT${x.avg_days_to_award !== null ? ` · ${x.avg_days_to_award} days approval → award` : ''}</div></div></div>
    <div class="cols cols-2"><div class="card"><h3>Nationality scorecard</h3>${bar(x.ownership, '#0e7490')}</div><div class="card"><h3>Gender, youth, disability & SMME scorecard</h3>${bar(x.groups, '#be185d')}
      <p class="muted">Bids received: ${x.participation.bids} – ${x.participation.women_owned} women-owned, ${x.participation.citizen_owned} citizen-owned, ${x.participation.youth_owned} youth-owned.</p></div></div>
    <div class="cols cols-2"><div class="card"><h3>By procurement method</h3>${tableHtml([{ key: 'label', label: 'Method' }, { key: 'cases', label: 'Cases', right: 1 }, { key: 'awards', label: 'Awards', right: 1 }, { key: 'value', label: 'Awarded', right: 1, fmt: money }, { key: 'pct', label: '%', right: 1, fmt: v => v + '%' }], x.methods)}</div>
      <div class="card"><h3>By district</h3>${tableHtml([{ key: 'district', label: 'District' }, { key: 'value', label: 'Spend', right: 1, fmt: money }, { key: 'pct', label: '%', right: 1, fmt: v => v + '%' }], x.districts, { empty: 'No purchasing yet.' })}</div></div></div>`;
  $('#og').onclick = () => { location.hash = `#/procurement?tab=overview&from=${$('#of').value}&to=${$('#ot').value}`; };
  $('#opr').onclick = () => printHtml(`<div style="font-family:Arial;font-size:12px"><h2>${esc(state.company.name || '')} – procurement scorecard ${esc(x.from)} to ${esc(x.to)}</h2>${$('#sc').innerHTML}</div>`);
}

async function cases(eb) {
  const q = query();
  const rows = await GET(`/tenders?status=${q.status || 'active'}${q.method ? '&method=' + q.method : ''}${q.q ? '&q=' + encodeURIComponent(q.q) : ''}`);
  eb.innerHTML = `<div class="row wrap" style="margin-bottom:10px"><input id="cq" placeholder="Number or title" value="${esc(q.q || '')}">
      <select id="cm"><option value="">All methods</option>${Object.entries(METHOD).map(([k, l]) => `<option value="${k}" ${q.method === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select id="cs"><option value="active">In progress</option><option value="">All</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${q.status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select><button class="btn" id="cg">Show</button></div>
    <div class="card">${tableHtml([{ key: 'number', label: 'Number' }, { key: 'title', label: 'Procurement' }, { key: 'method', label: 'Method', fmt: v => METHOD[v] }, { key: 'department', label: 'Department' },
      { key: 'estimated_value', label: 'Estimate', right: 1, fmt: money }, { key: 'closing_at', label: 'Closes', fmt: utcLocal }, { key: 'bids', label: 'Bids', right: 1 },
      { key: 'awarded_name', label: 'Awarded to', fmt: (v, t) => v ? `${v} (${money(t.award_value)})` : '' }, { key: 'status', label: 'Status', html: 1, fmt: stBadge }], rows, { rowAttr: t => `data-t="${t.id}"`, empty: 'No procurements here. Start one with ＋ New procurement.' })}</div>`;
  if (q.status !== undefined) $('#cs').value = q.status;
  $('#cg').onclick = () => { location.hash = `#/procurement?tab=cases&q=${encodeURIComponent($('#cq').value)}&method=${$('#cm').value}&status=${$('#cs').value}`; };
  $$('[data-t]', eb).forEach(tr => tr.onclick = () => { location.hash = '#/tender/' + tr.dataset.t; });
}
async function suppliers(eb, reload) {
  const q = query(), rows = await GET(`/procurement/suppliers?q=${encodeURIComponent(q.q || '')}${q.status ? '&status=' + q.status : ''}`);
  eb.innerHTML = `<div class="row wrap" style="margin-bottom:10px"><input id="sq" placeholder="Name, registration no. or category" value="${esc(q.q || '')}"><select id="ss"><option value="">Any status</option>${Object.entries(SUP).map(([k, v]) => `<option value="${k}" ${q.status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select><button class="btn" id="sg">Search</button><span class="spacer"></span><span class="muted">${rows.length} suppliers</span></div>
    <div class="card">${tableHtml([{ key: 'name', label: 'Supplier' }, { key: 'reg_no', label: 'Reg. no.' }, { key: 'district', label: 'District' }, { key: 'categories', label: 'Supplies' },
      { key: 'citizen_pct', label: 'Ownership', fmt: (v, s) => flags(s) || (v === null ? 'not captured' : 'none of the groups') }, { key: 'pref_pct', label: 'Preference', right: 1, fmt: v => v + '%' },
      { key: 'tax_clearance_expiry', label: 'Tax clearance', html: 1, fmt: (v, s) => v ? (s.tax_expired ? `<b class="neg">expired ${d(v)}</b>` : d(v)) : '<span class="muted">none</span>' },
      { key: 'rating', label: 'Rating', right: 1, fmt: v => v ? `${Number(v).toFixed(1)} ★` : '' }, { key: 'status', label: 'Status', html: 1, fmt: supBadge }], rows, { rowAttr: s => `data-s="${s.id}"`, empty: 'No suppliers yet.' })}</div>`;
  $('#sg').onclick = () => { location.hash = `#/procurement?tab=suppliers&q=${encodeURIComponent($('#sq').value)}&status=${$('#ss').value}`; };
  $$('[data-s]', eb).forEach(tr => tr.onclick = async () => supplierDialog(await GET('/procurement/suppliers/' + tr.dataset.s), reload));
}
const SFIELDS = [{ key: 'name', label: 'Company / trading name', required: true }, { key: 'reg_no', label: 'Company registration no.' }, { key: 'tax_number', label: 'TIN' }, { key: 'contact_person', label: 'Contact person' },
  { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email (bid invitations go here)' }, { key: 'address', label: 'Address', span: 2 }, { key: 'district', label: 'District' }, { key: 'country', label: 'Country' },
  { key: 'categories', label: 'What they supply (e.g. stationery, plumbing, ICT)', span: 2 },
  { type: 'heading', label: 'Compliance documents' }, { key: 'tax_clearance_no', label: 'Tax clearance certificate no.' }, { key: 'tax_clearance_expiry', label: 'Tax clearance expires', type: 'date' },
  { key: 'trader_licence_no', label: 'Trader\'s licence no.' }, { key: 'trader_licence_expiry', label: 'Licence expires', type: 'date' },
  { type: 'heading', label: 'Ownership (for preference points and the scorecards)' }, { key: 'citizen_pct', label: '% owned by Basotho citizens', type: 'number' }, { key: 'women_pct', label: '% owned by women', type: 'number' },
  { key: 'youth_pct', label: '% owned by youth (under 35)', type: 'number' }, { key: 'size', label: 'Business size', type: 'select', options: [['micro', 'Micro (up to 5 staff)'], ['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']].map(([value, label]) => ({ value, label })) },
  { key: 'disabled_owned', label: 'Majority-owned by people with disability', type: 'checkbox' },
  { type: 'heading', label: 'Status' }, { key: 'status', label: 'Status', type: 'select', options: Object.entries(SUP).map(([value, v]) => ({ value, label: v[0] })) },
  { key: 'debar_reason', label: 'Reason (when debarred)', span: 2 }, { key: 'debar_until', label: 'Debarred until (empty = indefinitely)', type: 'date' }];
export function supplierDialog(s, done) {
  modal({ title: s ? s.name : 'New supplier', size: 'lg', body: `${s ? `<p>${flags(s) ? `<b>${flags(s)}</b> · ` : ''}preference ${s.pref_pct}% ${s.rating ? `· rating ${Number(s.rating).toFixed(1)} ★ (${s.ratings})` : ''}</p>` : ''}${formHtml(SFIELDS, s || { country: 'Lesotho', size: 'small', status: 'pending' }, { ctx: 'supplier' })}
      ${s && s.history && s.history.length ? `<h4>Bids</h4>${tableHtml([{ key: 'number', label: 'Procurement' }, { key: 'title', label: '' }, { key: 'total', label: 'Bid', right: 1, fmt: money }, { key: 'rank_no', label: 'Rank', right: 1 }, { key: 'won', label: '', fmt: v => v ? '🏆 won' : '' }], s.history)}` : ''}`,
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, SFIELDS); if (s) await PUT('/procurement/suppliers/' + s.id, v); else await POST('/procurement/suppliers', v); toast('Supplier saved'); c(); done && done(); } }] });
}
async function waivers(eb) {
  const rows = await GET('/tenders?method=waiver&status=');
  eb.innerHTML = `<div class="card"><p class="muted">Every procurement where competition was waived, with the reason and who approved it. Auditors look at this register first – keep waivers rare and fully justified.</p>
    ${tableHtml([{ key: 'number', label: 'Number' }, { key: 'title', label: 'What' }, { key: 'waiver_supplier', label: 'Supplier' }, { key: 'waiver_reason', label: 'Reason', fmt: v => (v || '').replace('_', ' ') },
      { key: 'estimated_value', label: 'Estimate', right: 1, fmt: money }, { key: 'award_value', label: 'Awarded', right: 1, fmt: v => v ? money(v) : '' }, { key: 'created_at', label: 'Date', fmt: d }, { key: 'status', label: 'Status', html: 1, fmt: stBadge }], rows, { rowAttr: t => `data-t="${t.id}"`, empty: 'No waivers.' })}</div>`;
  $$('[data-t]', eb).forEach(tr => tr.onclick = () => { location.hash = '#/tender/' + tr.dataset.t; });
}
async function compliance(eb, reload) {
  const rows = await GET('/procurement/compliance');
  eb.innerHTML = `<div class="card"><p class="muted">Suppliers whose tax clearance or trader's licence is missing, expired or expiring within 30 days. Ask them for the new certificate before awarding.</p>
    ${tableHtml([{ key: 'name', label: 'Supplier' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'tax_clearance_expiry', label: 'Tax clearance', html: 1, fmt: v => v ? (v < today() ? `<b class="neg">expired ${d(v)}</b>` : `expires ${d(v)}`) : '<b class="neg">missing</b>' },
      { key: 'trader_licence_expiry', label: 'Trader\'s licence', html: 1, fmt: v => v ? (v < today() ? `<b class="neg">expired ${d(v)}</b>` : d(v)) : '' }], rows, { rowAttr: s => `data-s="${s.id}"`, empty: 'All approved suppliers have valid documents.' })}</div>`;
  $$('[data-s]', eb).forEach(tr => tr.onclick = async () => supplierDialog(await GET('/procurement/suppliers/' + tr.dataset.s), reload));
}
async function my(eb) {
  const rows = await GET('/procurement/my');
  eb.innerHTML = `<div class="card"><p class="muted">Procurements where you are on the evaluation committee. Declare any conflict of interest, then score each bid after opening.</p>
    ${tableHtml([{ key: 'number', label: 'Number' }, { key: 'title', label: 'Procurement' }, { key: 'method', label: 'Method', fmt: v => METHOD[v] }, { key: 'closing_at', label: 'Closes', fmt: utcLocal }, { key: 'bids', label: 'Bids', right: 1 }, { key: 'status', label: 'Status', html: 1, fmt: stBadge }], rows, { rowAttr: t => `data-t="${t.id}"`, empty: 'You are not on any committee right now.' })}</div>`;
  $$('[data-t]', eb).forEach(tr => tr.onclick = () => { location.hash = '#/tender/' + tr.dataset.t; });
}
async function settings(eb) {
  const s = (await GET('/procurement/settings')).settings;
  const f = [{ type: 'heading', label: 'Thresholds and rules (from your procurement policy)' }, { key: 'rfq_max', label: 'Largest value allowed for a request for quotations', type: 'number' },
    { key: 'min_rfq_suppliers', label: 'Suppliers to invite for an RFQ (at least)', type: 'number' }, { key: 'min_restricted_suppliers', label: 'Suppliers to invite for a restricted tender (at least)', type: 'number' },
    { key: 'min_opening_members', label: 'Committee members present to open bids', type: 'number' }, { key: 'standstill_days', label: 'Standstill days after an award (challenges allowed)', type: 'number' },
    { key: 'segregation', label: 'Segregation of duties (preparer ≠ approver, recommender / committee ≠ award approver)', type: 'checkbox' },
    { key: 'price_formula', label: 'Price points', type: 'select', options: [{ value: 'ratio', label: 'Lowest price ÷ bid price × points' }, { value: 'ppfa', label: '(1 − (bid − lowest) ÷ lowest) × points' }] },
    { type: 'heading', label: 'Preference scorecard: how the preference points are shared' }, { key: 'majority_pct', label: '"Owned by" means at least … % ownership', type: 'number' },
    { key: 'p_citizen', label: 'Basotho citizen ownership', type: 'number' }, { key: 'p_women', label: 'Women ownership', type: 'number' }, { key: 'p_youth', label: 'Youth ownership', type: 'number' },
    { key: 'p_disability', label: 'Disability ownership', type: 'number' }, { key: 'p_smme', label: 'Micro & small businesses', type: 'number' }];
  const v = { ...s, ...Object.fromEntries(Object.entries(s.pref).map(([k, x]) => ['p_' + k, x])) };
  eb.innerHTML = `<div class="card">${formHtml(f, v, { ctx: 'procurement' })}<p class="muted">Example: with citizen 50, women 25, youth 15, disability 5, SMME 5, a 100% Basotho-owned, 100% women-owned small business earns 80% of a tender's preference points; a foreign-owned large company earns none.</p>
    <div class="row"><span class="spacer"></span><button class="btn btn-primary" id="psave">Save</button></div></div>`;
  $('#psave').onclick = async () => { try { const x = readForm(eb, f); x.pref = { citizen: x.p_citizen, women: x.p_women, youth: x.p_youth, disability: x.p_disability, smme: x.p_smme }; await PUT('/procurement/settings', x); toast('Saved'); } catch (e) { err(e); } };
}

/* ============================== new / edit procurement ============================== */
async function tenderDialog(t, done) {
  const [users, sups, cfg] = await Promise.all([GET('/users').catch(() => []), GET('/procurement/suppliers'), GET('/procurement/settings')]);
  const f = [{ key: 'method', label: 'Method', type: 'select', options: Object.entries(METHOD).map(([value, label]) => ({ value, label })) },
    { key: 'category', label: 'Category', type: 'select', options: ['goods', 'works', 'services', 'consultancy'].map(v => ({ value: v, label: v })) },
    { key: 'title', label: 'Title', required: true, span: 2 }, { key: 'description', label: 'Scope / specification', type: 'textarea', span: 2 },
    { key: 'department', label: 'Department' }, { key: 'budget_code', label: 'Budget (account code)' },
    { type: 'heading', label: 'Bidding' }, { key: 'closing_at', label: 'Closing date and time', type: 'datetime-local' }, { key: 'bid_validity_days', label: 'Bids valid for (days)', type: 'number' }, { key: 'bid_security', label: 'Bid security (0 = none)', type: 'number' },
    { type: 'heading', label: 'Evaluation points (must add up to 100)' }, { key: 'tech_weight', label: 'Technical', type: 'number' }, { key: 'price_weight', label: 'Price', type: 'number' }, { key: 'pref_weight', label: 'Preference (ownership scorecard)', type: 'number' },
    { key: 'min_tech_pct', label: 'Minimum technical % to qualify', type: 'number' },
    { type: 'heading', label: 'Waiver (direct procurement only)' }, { key: 'waiver_reason', label: 'Why competition is waived', type: 'select', options: [{ value: '', label: '–' }, ...Object.entries(cfg.waiver_reasons).map(([value, label]) => ({ value, label }))] },
    { key: 'waiver_supplier_id', label: 'Supplier', type: 'select', options: [{ value: '', label: '–' }, ...sups.filter(s => !['debarred', 'suspended'].includes(s.status)).map(s => ({ value: s.id, label: s.name }))] },
    { key: 'waiver_justification', label: 'Full justification', type: 'textarea', span: 2 }];
  const local = s => s ? new Date(String(s).replace(' ', 'T') + 'Z').toISOString().slice(0, 16) : '';
  const vals = t ? { ...t, closing_at: t.closing_at ? (() => { const x = new Date(String(t.closing_at).replace(' ', 'T') + 'Z'); return new Date(x - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); })() : '' }
    : { method: 'rfq', category: 'goods', bid_validity_days: 90, bid_security: 0, tech_weight: 0, price_weight: 80, pref_weight: 20, min_tech_pct: 0 };
  void local;
  const lines = t ? t.lines : [{ description: '', qty: 1, uom: '', est_unit: '' }];
  const crit = t ? t.criteria : [{ kind: 'mandatory', name: 'Valid tax clearance certificate' }, { kind: 'mandatory', name: 'Company registration documents' }];
  const com = t ? t.committee : [];
  const lrow = l => `<div class="row" data-ln><input data-k="description" placeholder="Item / service / works" value="${esc(l.description)}" style="flex:3"><input data-k="qty" type="number" step="any" value="${l.qty}" style="width:80px" title="Quantity"><input data-k="uom" placeholder="unit" value="${esc(l.uom || '')}" style="width:70px"><input data-k="est_unit" type="number" step="0.01" placeholder="estimate each" value="${l.est_unit}" style="width:120px"><button class="btn btn-sm" data-x>✕</button></div>`;
  const crow = k => `<div class="row" data-cr><select data-k="kind"><option value="mandatory" ${k.kind === 'mandatory' ? 'selected' : ''}>Must have (pass / fail)</option><option value="technical" ${k.kind === 'technical' ? 'selected' : ''}>Technical (points)</option></select><input data-k="name" value="${esc(k.name)}" placeholder="Criterion" style="flex:3"><input data-k="max_points" type="number" value="${k.kind === 'technical' ? Number(k.max_points) : ''}" placeholder="max points" style="width:100px"><button class="btn btn-sm" data-x>✕</button></div>`;
  const mrow = m => `<div class="row" data-cm><select data-k="user_id">${users.filter(u => u.active).map(u => `<option value="${u.id}" ${u.id === m.user_id ? 'selected' : ''}>${esc(u.name)} (${esc(u.role)})</option>`).join('')}</select><select data-k="role">${['chair', 'member', 'secretary'].map(r => `<option ${r === m.role ? 'selected' : ''}>${r}</option>`).join('')}</select><button class="btn btn-sm" data-x>✕</button></div>`;
  modal({ title: t ? `Edit ${t.number}` : 'New procurement', size: 'lg', body: `${formHtml(f, vals, { ctx: 'tender' })}
      <div class="row" style="margin:6px 0"><span class="muted">Presets:</span><button class="btn btn-sm" data-pre="0,100,0">Lowest compliant price</button><button class="btn btn-sm" data-pre="0,80,20">80 / 20 preference</button><button class="btn btn-sm" data-pre="0,90,10">90 / 10 preference</button><button class="btn btn-sm" data-pre="70,20,10">Quality & cost (70/20/10)</button></div>
      <h4>What is being bought</h4><div id="lns">${lines.map(lrow).join('')}</div><button class="btn btn-sm" id="al">＋ Item</button>
      <h4>Evaluation criteria</h4><div id="crs">${crit.map(crow).join('')}</div><button class="btn btn-sm" id="ac">＋ Criterion</button>
      <h4>Evaluation committee</h4><p class="muted">At least ${cfg.settings.min_opening_members} members open the bids together; one chairperson. Members declare any conflict of interest before scoring.</p><div id="cms">${com.map(mrow).join('')}</div><button class="btn btn-sm" id="am">＋ Member</button>`,
    onOpen: r => {
      const wire = () => $$('[data-x]', r).forEach(b => b.onclick = () => b.parentElement.remove());
      r.querySelector('#al').onclick = () => { r.querySelector('#lns').insertAdjacentHTML('beforeend', lrow({ description: '', qty: 1, uom: '', est_unit: '' })); wire(); };
      r.querySelector('#ac').onclick = () => { r.querySelector('#crs').insertAdjacentHTML('beforeend', crow({ kind: 'technical', name: '', max_points: '' })); wire(); };
      r.querySelector('#am').onclick = () => { r.querySelector('#cms').insertAdjacentHTML('beforeend', mrow({ role: r.querySelectorAll('[data-cm]').length ? 'member' : 'chair' })); wire(); };
      $$('[data-pre]', r).forEach(b => b.onclick = () => { const [a, p, q] = b.dataset.pre.split(','); r.querySelector('[name=tech_weight]').value = a; r.querySelector('[name=price_weight]').value = p; r.querySelector('[name=pref_weight]').value = q; });
      wire();
    },
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => {
      const v = readForm(r, f);
      v.closing_at = v.closing_at ? new Date(v.closing_at).toISOString() : null;
      const rd = (sel) => $$(sel, r).map(x => Object.fromEntries($$('[data-k]', x).map(i => [i.dataset.k, i.value])));
      v.lines = rd('[data-ln]'); v.criteria = rd('[data-cr]'); v.committee = rd('[data-cm]').map(m => ({ ...m, user_id: Number(m.user_id) }));
      const res = t ? await PUT('/tenders/' + t.id, v) : await POST('/tenders', v);
      toast('Saved'); c(); done && done(res.id);
    } }] });
}

/* ============================== one procurement ============================== */
export async function tender(view, [idq]) {
  const id = Number(String(idq || '').split('?')[0]);
  const t = await GET('/tenders/' + id);
  const reload = () => tender(view, [String(id)]);
  const me = t.me, isWaiver = t.method === 'waiver';
  const steps = isWaiver ? ['draft', 'submitted', 'approved', 'recommended', 'awarded', 'contracted'] : STEPS;
  const at = steps.indexOf(t.status === 'challenged' ? 'awarded' : t.status);
  const act = [];
  const A = (id2, label, cls = '') => act.push(`<button class="btn ${cls}" id="${id2}">${label}</button>`);
  if (office() && ['draft', 'submitted', 'approved'].includes(t.status)) A('xe', 'Edit');
  if (can('legal') && ['awarded', 'contracted'].includes(t.status)) act.push(docButton('tender_contract', t.id));
  if (office() && t.status === 'draft') A('xs', 'Send for approval', 'btn-primary');
  if (approver() && t.status === 'submitted') { A('xr', 'Return'); A('xa', isWaiver ? 'Approve waiver' : 'Approve to procure', 'btn-primary'); }
  if (office() && t.status === 'approved' && !isWaiver) A('xp', '📣 Publish / invite', 'btn-primary');
  if (office() && t.status === 'approved' && isWaiver && !t.bids.length) A('xq', 'Enter quotation', 'btn-primary');
  if (office() && t.status === 'published') { A('xi', 'Invite more'); A('xq', 'Enter a paper bid'); A('xd', 'Addendum'); A('xl', 'Bid links'); }
  if ((me || office()) && t.status === 'closed') A('xo', '🔓 Open bids', 'btn-primary');
  if (me && !me.coi_declared_at && ['published', 'closed', 'opened', 'evaluated'].includes(t.status)) A('xc', 'Declare conflict of interest', 'btn-primary');
  if ((me || office()) && t.status === 'opened') A('xv', 'Run evaluation', 'btn-primary');
  if ((me || office()) && (t.status === 'evaluated' || (isWaiver && t.status === 'approved' && t.bids.length))) A('xm', 'Recommend award', 'btn-primary');
  if (approver() && t.status === 'recommended') { A('xw', 'Reject recommendation'); A('xx', '✔ Approve award', 'btn-primary'); }
  if (office() && t.status === 'awarded') A('xk', 'Issue contract (PO)', 'btn-primary');
  if (office() && t.status === 'contracted' && !t.supplier_rating) A('xg', 'Rate supplier');
  if (['awarded', 'contracted', 'opened', 'evaluated'].includes(t.status)) A('xpr', '🖨 Report');
  if (approver() && !['contracted', 'cancelled'].includes(t.status)) A('xz', 'Cancel', 'btn-danger');
  const total = t.lines.reduce((s, l) => s + Number(l.qty) * Number(l.est_unit), 0);
  view.innerHTML = page(`${t.number} – ${t.title}`, `<a class="btn" href="#/procurement?tab=${me && !office() ? 'my' : 'cases'}">← Back</a>${act.join('')}`, `
    <div class="card"><div style="display:flex;gap:4px;flex-wrap:wrap">${steps.map((s, i) => `<span class="badge" style="background:${i < at ? 'var(--ok,#15803d)' : i === at ? 'var(--primary,#3f3d9e)' : '#e5e7eb'};color:${i <= at ? '#fff' : '#555'}">${i + 1}. ${STATUS[s][0]}</span>`).join('')}${t.status === 'challenged' ? badge('challenged', 'cancelled') : ''}${t.status === 'cancelled' ? badge('cancelled', 'cancelled') : ''}</div></div>
    <div class="cols cols-4" style="margin-bottom:12px">
      <div class="kpi"><div class="label">Method</div><div class="value" style="font-size:17px">${METHOD[t.method]}</div><div class="hint">${esc(t.category)} · ${esc(t.department || '')} ${t.budget_code ? '· budget ' + esc(t.budget_code) : ''}</div></div>
      <div class="kpi"><div class="label">Estimate</div><div class="value">${money(t.estimated_value)}</div><div class="hint">${t.approved_by_name ? `approved by ${esc(t.approved_by_name)}` : `prepared by ${esc(t.created_by_name || '')}`}</div></div>
      <div class="kpi"><div class="label">${isWaiver ? 'Supplier' : 'Closing'}</div><div class="value" style="font-size:17px">${isWaiver ? esc(t.waiver_supplier || '') : utcLocal(t.closing_at) || '—'}</div><div class="hint">${t.public_url ? `<a href="${t.public_url}" target="_blank">public notice</a> · ` : ''}${t.bidders.length} invited/registered · ${t.bids.length} bids</div></div>
      <div class="kpi"><div class="label">Points</div><div class="value" style="font-size:17px">${Number(t.tech_weight)} / ${Number(t.price_weight)} / ${Number(t.pref_weight)}</div><div class="hint">technical / price / preference${Number(t.min_tech_pct) ? ` · min technical ${Number(t.min_tech_pct)}%` : ''}</div></div></div>
    ${t.awarded_name ? `<div class="card"><h3>🏆 Awarded to ${esc(t.awarded_name)} – ${money(t.award_value)}</h3><p>Approved by ${esc(t.award_approved_by_name || '')} ${dt(t.awarded_at)}${t.standstill_until ? ` · standstill until <b>${d(t.standstill_until)}</b>` : ''}${t.po_number ? ` · contract <a href="#/purchase/${t.po_id}">${esc(t.po_number)}</a> (${esc(t.po_status)})` : ''}${t.supplier_rating ? ` · rated ${t.supplier_rating}/5` : ''}</p></div>` : ''}
    ${t.recommendation || t.status === 'recommended' ? `<div class="card"><b>Recommendation</b> by ${esc(t.recommended_by_name || '')}: ${esc(t.recommendation || 'highest-scoring bid')}</div>` : ''}
    ${isWaiver ? `<div class="card"><h3>Waiver justification</h3><p><b>${esc((t.waiver_reason || '').replace('_', ' '))}</b></p><p style="white-space:pre-wrap">${esc(t.waiver_justification || '')}</p></div>` : ''}
    ${t.description ? `<div class="card"><h3>Scope</h3><p style="white-space:pre-wrap">${esc(t.description)}</p></div>` : ''}
    <div class="cols cols-2"><div class="card"><h3>Items</h3>${tableHtml([{ key: 'description', label: 'Item' }, { key: 'qty', label: 'Qty', right: 1, fmt: (v, l) => `${qty(v)} ${l.uom || ''}` }, { key: 'est_unit', label: 'Estimate each', right: 1, fmt: money }, { key: 'id', label: 'Estimate', right: 1, fmt: (v, l) => money(Number(l.qty) * Number(l.est_unit)) }], t.lines)}<p class="r"><b>${money(total)}</b> excl. VAT</p></div>
      <div class="card"><h3>Criteria & committee</h3>${tableHtml([{ key: 'name', label: 'Criterion' }, { key: 'kind', label: '', fmt: (v, k) => v === 'mandatory' ? 'must have' : `${Number(k.max_points)} points` }], t.criteria, { empty: 'Price and preference only.' })}
        ${tableHtml([{ key: 'name', label: 'Member' }, { key: 'role', label: 'Role' }, { key: 'coi_declared_at', label: 'Conflict of interest', html: 1, fmt: (v, m) => !v ? '<span class="muted">not declared yet</span>' : m.coi_conflict ? `${badge('conflict', 'cancelled')} ${esc(m.coi_note || '')}` : badge('none', 'ok') }], t.committee, { empty: 'No committee yet.' })}</div></div>
    <div class="card" id="bidsCard"><h3>Bids</h3>${bidsHtml(t)}</div>
    ${!isWaiver ? `<div class="cols cols-2"><div class="card"><h3>Bidders</h3>${tableHtml([{ key: 'name', label: 'Supplier' }, { key: 'email', label: 'Email' }, { key: 'status', label: 'Status' }, { key: 'viewed_at', label: 'Opened link', fmt: dt }, { key: 'supplier_status', label: '', html: 1, fmt: supBadge }], t.bidders, { empty: 'Nobody invited yet.' })}</div>
      <div class="card"><h3>Questions, addenda & challenges</h3>${t.clarifications.map(q => `<div style="border-bottom:1px solid var(--line,#eee);padding:6px 0">${q.kind === 'addendum' ? badge('addendum', 'posted') : q.kind === 'challenge' ? badge('challenge – ' + q.status, 'cancelled') : badge('question', 'draft')} ${q.partner_name ? `<small class="muted">${esc(q.partner_name)}</small>` : ''}
        <div style="white-space:pre-wrap">${esc(q.question)}</div>${q.answer ? `<div><b>${q.kind === 'challenge' ? 'Decision' : 'Answer'}:</b> ${esc(q.answer)}</div>` : q.kind === 'question' && office() ? `<button class="btn btn-sm" data-ans="${q.id}">Answer</button>` : q.kind === 'challenge' && approver() ? `<button class="btn btn-sm" data-chal="${q.id}">Decide</button>` : ''}</div>`).join('') || '<p class="muted">None.</p>'}</div></div>` : ''}
    <div class="card"><h3>History (audit trail)</h3>${tableHtml([{ key: 'created_at', label: 'When', fmt: dt }, { key: 'user_name', label: 'Who', fmt: (v, e) => v || e.partner_name || 'system' }, { key: 'action', label: 'What' }, { key: 'details', label: 'Details' }], t.events)}</div>`);
  if (office()) filesCard('tender', t.id, 'Tender documents (suppliers can download these from their bid page)');
  wire(t, reload);
}
function bidsHtml(t) {
  if (!t.bids.length) return '<p class="muted">No bids yet.</p>';
  if (t.sealed) return `<p>🔒 <b>${t.bids.length} sealed bid${t.bids.length === 1 ? '' : 's'}</b> received. Prices stay hidden from everyone until the bids are opened after closing.</p>${tableHtml([{ key: 'name', label: 'Bidder' }, { key: 'submitted_at', label: 'Received', fmt: dt }, { key: 'seal', label: 'Seal (fingerprint)', fmt: v => v ? v.slice(0, 16) + '…' : '' }], t.bids)}`;
  const crit = t.criteria, me = t.me, canScore = me && me.coi_declared_at && !me.coi_conflict && ['opened', 'evaluated'].includes(t.status);
  return `${tableHtml([{ key: 'rank_no', label: '#', fmt: v => v || '' }, { key: 'name', label: 'Bidder' }, { key: 'citizen_pct', label: 'Ownership', fmt: (v, b) => flags(b) || '—' }, { key: 'total', label: 'Price incl. VAT', right: 1, fmt: money },
      { key: 'delivery_days', label: 'Days', right: 1 }, { key: 'compliant', label: 'Must-haves', html: 1, fmt: v => v === null ? '' : v ? badge('pass', 'ok') : badge('fail', 'cancelled') },
      { key: 'tech_pct', label: 'Technical %', right: 1, fmt: v => v === null ? '' : v + '%' }, { key: 'price_score', label: 'Price pts', right: 1, fmt: v => v ?? '' }, { key: 'pref_score', label: 'Pref. pts', right: 1, fmt: v => v ?? '' },
      { key: 'total_score', label: 'Total', right: 1, html: 1, fmt: v => v === null || v === undefined ? '' : `<b>${v}</b>` },
      { key: 'status', label: '', html: 1, fmt: (v, b) => v === 'disqualified' ? `${badge('disqualified', 'cancelled')} ${esc(b.disqualified_reason || '')}` : t.recommended_bid_id === b.id ? badge('recommended', 'partial') : '' },
      { key: 'id', label: '', html: 1, fmt: (v, b) => [canScore && b.status === 'valid' ? `<button class="btn btn-sm" data-score="${v}">Score</button>` : '', (office() || me) && ['opened', 'evaluated'].includes(t.status) && b.status === 'valid' ? `<button class="btn btn-sm btn-danger" data-dq="${v}">Disqualify</button>` : ''].join(' ') }], t.bids)}
    ${crit.length && t.scores && t.scores.length ? `<details style="margin-top:8px"><summary>All scores by member</summary>${tableHtml([{ key: 'user_name', label: 'Member' }, { key: 'bid_id', label: 'Bid', fmt: v => (t.bids.find(b => b.id === v) || {}).name }, { key: 'criterion_id', label: 'Criterion', fmt: v => (crit.find(k => k.id === v) || {}).name }, { key: 'score', label: 'Score', right: 1 }, { key: 'comment', label: 'Comment' }], t.scores)}</details>` : ''}`;
}
function wire(t, reload) {
  const on = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = async () => { try { await fn(); } catch (e) { err(e); } }; };
  on('xe', () => tenderDialog(t, reload));
  on('xs', async () => { const s = await POST(`/tenders/${t.id}/submit`); toast(s.message || 'Sent for approval'); reload(); });
  on('xa', async () => { const s = await POST(`/tenders/${t.id}/approve`, {}); toast(s.message || 'Approved'); reload(); });
  on('xr', () => noteDialog('Return for changes', 'What must change?', async note => { await POST(`/tenders/${t.id}/approve`, { reject: true, note }); reload(); }));
  on('xp', async () => {
    const sups = (await GET('/procurement/suppliers')).filter(s => !['debarred', 'suspended'].includes(s.status));
    modal({ title: t.method === 'open' ? 'Publish the tender' : 'Invite suppliers', size: 'lg', body: `${t.method === 'open' ? '<p>The tender is published on your public tender page; any supplier can register and bid. You can also invite suppliers directly:</p>' : `<p>Choose the suppliers to invite (${t.method === 'rfq' ? 'RFQ' : 'restricted tender'} – see the minimum in Settings). Each gets a private link to read the documents, ask questions and submit a sealed bid.</p>`}
        <div style="max-height:320px;overflow:auto">${sups.map(s => `<label class="check" style="display:block"><input type="checkbox" data-sp="${s.id}"> ${esc(s.name)} <small class="muted">${esc(s.categories || '')} ${flags(s)} ${s.email ? '' : '· no email – send the link yourself'}</small></label>`).join('')}</div>`,
      actions: [{ label: 'Cancel' }, { label: 'Publish', cls: 'btn-primary', onClick: async (c, r) => { const x = await POST(`/tenders/${t.id}/publish`, { partner_ids: $$('[data-sp]', r).filter(i => i.checked).map(i => Number(i.dataset.sp)) }); c(); toast(`Published – ${x.invited} invited, ${x.mailed} emailed`); showLinks(t); reload(); } }] });
  });
  on('xi', async () => {
    const sups = (await GET('/procurement/suppliers')).filter(s => !['debarred', 'suspended'].includes(s.status) && !t.bidders.some(b => b.partner_id === s.id));
    modal({ title: 'Invite more suppliers', body: sups.map(s => `<label class="check" style="display:block"><input type="checkbox" data-sp="${s.id}"> ${esc(s.name)}</label>`).join('') || 'Everyone is invited.', actions: [{ label: 'Cancel' }, { label: 'Invite', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/tenders/${t.id}/invite`, { partner_ids: $$('[data-sp]', r).filter(i => i.checked).map(i => Number(i.dataset.sp)) }); c(); showLinks(t); reload(); } }] });
  });
  on('xl', () => showLinks(t));
  on('xq', () => bidDialog(t, reload));
  on('xd', () => {
    const f = [{ key: 'text', label: 'Addendum (sent to all bidders)', type: 'textarea', required: true, span: 2 }, { key: 'closing_at', label: 'New closing time (only later; empty = unchanged)', type: 'datetime-local' }];
    modal({ title: 'Issue an addendum', body: formHtml(f, {}), actions: [{ label: 'Cancel' }, { label: 'Issue', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); if (v.closing_at) v.closing_at = new Date(v.closing_at).toISOString(); await POST(`/tenders/${t.id}/addendum`, v); c(); reload(); } }] });
  });
  on('xo', () => {
    modal({ title: 'Open the bids', body: `<p>Tick the committee members present at the opening (at least ${t.settings.min_opening_members}, including you). The bidders, prices and seals are written to the opening register.</p>${t.committee.map(m => `<label class="check" style="display:block"><input type="checkbox" data-pm="${m.user_id}" ${m.user_id === state.user.id ? 'checked disabled' : ''}> ${esc(m.name)} (${m.role})</label>`).join('')}`,
      actions: [{ label: 'Cancel' }, { label: '🔓 Open bids', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/tenders/${t.id}/open`, { present: $$('[data-pm]', r).filter(i => i.checked).map(i => Number(i.dataset.pm)) }); c(); toast('Bids opened'); reload(); } }] });
  });
  on('xc', () => {
    const f = [{ key: 'conflict', label: 'I have a conflict of interest (a relationship with, or interest in, a bidder)', type: 'checkbox' }, { key: 'note', label: 'Details', span: 2 }];
    modal({ title: 'Conflict of interest declaration', body: `<p>Before you see or score the bids, declare whether you, your family or close associates have any interest in any bidder: ${t.bidders.map(b => esc(b.name)).join(', ') || '(bidders not known yet)'}.</p>${formHtml(f, {})}`,
      actions: [{ label: 'Cancel' }, { label: 'Declare', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/tenders/${t.id}/declare`, readForm(r, f)); c(); reload(); } }] });
  });
  on('xv', async () => { const x = await POST(`/tenders/${t.id}/evaluate`); toast(`${x.qualifying} of ${x.bids} bids qualify`); reload(); });
  on('xm', () => {
    const ok = t.bids.filter(b => b.status === 'valid' && (t.method === 'waiver' || b.compliant));
    const f = [{ key: 'bid_id', label: 'Recommend', type: 'select', options: ok.map(b => ({ value: b.id, label: `${b.rank_no ? '#' + b.rank_no + ' ' : ''}${b.name} – ${money(b.total)}${b.total_score != null ? ` (${b.total_score} pts)` : ''}` })) }, { key: 'reason', label: 'Reasons (required if not the top-ranked bid)', type: 'textarea', span: 2 }];
    modal({ title: 'Recommend the award', body: formHtml(f, {}), actions: [{ label: 'Cancel' }, { label: 'Recommend', cls: 'btn-primary', onClick: async (c, r) => { const s = await POST(`/tenders/${t.id}/recommend`, readForm(r, f)); c(); if (s.message) toast(s.message); reload(); } }] });
  });
  on('xw', () => noteDialog('Reject the recommendation', 'Why?', async note => { await POST(`/tenders/${t.id}/award`, { reject: true, note }); reload(); }));
  on('xx', async () => { if (!(await confirmBox('Approve this award? Bidders see the result on their bid pages; the standstill period starts now.', { okLabel: 'Approve award' }))) return; const x = await POST(`/tenders/${t.id}/award`, {}); toast(x.message || (x.standstill_until ? `Awarded – standstill until ${x.standstill_until}` : 'Awarded')); reload(); });
  on('xk', () => {
    const f = [{ key: 'contract_start', label: 'Contract starts', type: 'date' }, { key: 'contract_end', label: 'Contract ends', type: 'date' }];
    modal({ title: 'Issue the contract', body: `<p>A purchase order is made for ${esc(t.awarded_name)} with the winning prices. Confirm and receive it as usual under Purchasing.</p>${formHtml(f, { contract_start: today() })}`, actions: [{ label: 'Cancel' }, { label: 'Issue', cls: 'btn-primary', onClick: async (c, r) => { const x = await POST(`/tenders/${t.id}/contract`, readForm(r, f)); c(); toast(`Purchase order ${x.number} made`); reload(); } }] });
  });
  on('xg', () => {
    const f = [{ key: 'rating', label: 'How did the supplier perform? (1 poor – 5 excellent)', type: 'select', options: [5, 4, 3, 2, 1].map(v => ({ value: v, label: '★'.repeat(v) })) }, { key: 'note', label: 'Comment', span: 2 }];
    modal({ title: 'Rate the supplier', body: formHtml(f, { rating: 4 }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/tenders/${t.id}/rate`, readForm(r, f)); c(); reload(); } }] });
  });
  on('xz', () => noteDialog('Cancel this procurement', 'Reason (shown in the audit trail)', async reason => { await POST(`/tenders/${t.id}/cancel`, { reason }); reload(); }));
  on('xpr', () => printHtml(`<div style="font-family:Arial;font-size:12px"><h2>${esc(state.company.name || '')}</h2><h3>Evaluation report – ${esc(t.number)} ${esc(t.title)}</h3><p>${METHOD[t.method]} · estimate ${money(t.estimated_value)} · points ${Number(t.tech_weight)}/${Number(t.price_weight)}/${Number(t.pref_weight)}</p>
    <h4>Committee</h4>${t.committee.map(m => `${esc(m.name)} (${m.role}) – conflict: ${m.coi_conflict ? 'YES – ' + esc(m.coi_note || '') : 'none declared'}`).join('<br>')}<h4>Bids</h4>${document.getElementById('bidsCard').innerHTML.replace(/<button[\s\S]*?<\/button>/g, '')}
    ${t.awarded_name ? `<h4>Award</h4>${esc(t.awarded_name)} – ${money(t.award_value)}; approved by ${esc(t.award_approved_by_name || '')}` : ''}<h4>History</h4>${t.events.slice().reverse().map(e => `${dt(e.created_at)} – ${esc(e.user_name || e.partner_name || '')}: ${esc(e.action)} ${esc(e.details || '')}`).join('<br>')}</div>`));
  $$('[data-score]').forEach(b => b.onclick = () => scoreDialog(t, Number(b.dataset.score), reload));
  $$('[data-dq]').forEach(b => b.onclick = () => noteDialog('Disqualify bid', 'Reason', async reason => { await POST(`/tenders/${t.id}/disqualify`, { bid_id: Number(b.dataset.dq), reason }); reload(); }));
  $$('[data-ans]').forEach(b => b.onclick = () => noteDialog('Answer the question', 'Answer (published to all bidders without the asker\'s name)', async answer => { await POST(`/tenders/clarifications/${b.dataset.ans}/answer`, { answer }); reload(); }));
  $$('[data-chal]').forEach(b => b.onclick = () => {
    const f = [{ key: 'decision', label: 'Decision', type: 'select', options: [{ value: 'dismissed', label: 'Dismiss – the award stands' }, { value: 'upheld', label: 'Uphold – reopen the evaluation' }] }, { key: 'answer', label: 'Reasons (sent to the bidder)', type: 'textarea', span: 2, required: true }];
    modal({ title: 'Decide the challenge', body: formHtml(f, {}), actions: [{ label: 'Cancel' }, { label: 'Decide', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/tenders/challenges/${b.dataset.chal}`, readForm(r, f)); c(); reload(); } }] });
  });
}
function noteDialog(title, label, fn) {
  const f = [{ key: 'v', label, type: 'textarea', span: 2, required: true }];
  modal({ title, body: formHtml(f, {}), actions: [{ label: 'Cancel' }, { label: 'OK', cls: 'btn-primary', onClick: async (c, r) => { await fn(readForm(r, f).v); c(); } }] });
}
async function showLinks(t) {
  const links = await GET(`/tenders/${t.id}/links`);
  modal({ title: 'Private bid links', size: 'lg', body: `<p class="muted">Each supplier has its own link. Suppliers with an email got it by email; send the others the link by SMS or WhatsApp.</p>${tableHtml([{ key: 'name', label: 'Supplier' }, { key: 'email', label: 'Email' }, { key: 'status', label: 'Status' }, { key: 'url', label: 'Link', html: 1, fmt: v => `<input readonly value="${esc(v)}" style="width:100%;font-family:monospace;font-size:11px" onclick="this.select()">` }], links)}`, actions: [{ label: 'Close' }] });
}
async function bidDialog(t, reload) {
  const sups = t.method === 'waiver' ? [{ id: t.waiver_supplier_id, name: t.waiver_supplier }] : t.method === 'open' ? (await GET('/procurement/suppliers')).filter(s => !['debarred', 'suspended'].includes(s.status)) : t.bidders.map(b => ({ id: b.partner_id, name: b.name }));
  modal({ title: t.method === 'waiver' ? 'Supplier\'s quotation' : 'Enter a paper / emailed bid', size: 'lg', body: `<label class="field"><span>Supplier</span><select id="bs">${sups.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
      ${tableHtml([{ key: 'description', label: 'Item' }, { key: 'qty', label: 'Qty', right: 1, fmt: qty }, { key: 'id', label: 'Unit price excl. VAT', html: 1, fmt: v => `<input type="number" step="0.01" data-bl="${v}" style="width:130px">` }], t.lines)}
      <div class="form-grid"><label class="field"><span>VAT %</span><input id="bv" type="number" value="15"></label><label class="field"><span>Delivery days</span><input id="bd" type="number"></label></div>
      <label class="check"><input type="checkbox" id="bdc"> The signed bid form includes the bidder's declaration</label>`,
    actions: [{ label: 'Cancel' }, { label: 'Save bid', cls: 'btn-primary', onClick: async (c, r) => {
      await POST(`/tenders/${t.id}/bid`, { partner_id: Number(r.querySelector('#bs').value), lines: $$('[data-bl]', r).map(i => ({ line_id: Number(i.dataset.bl), unit_price: i.value })), vat_rate: r.querySelector('#bv').value, delivery_days: r.querySelector('#bd').value, declaration: r.querySelector('#bdc').checked });
      toast('Bid saved (sealed until opening)'); c(); reload();
    } }] });
}
function scoreDialog(t, bidId, reload) {
  const b = t.bids.find(x => x.id === bidId), mine = t.my_scores.filter(s => s.bid_id === bidId);
  const val = k => { const s = mine.find(x => x.criterion_id === k.id); return s ? Number(s.score) : ''; };
  modal({ title: `Score ${b.name}`, size: 'lg', body: `<p>Price ${money(b.total)} · ${flags(b) || 'no preference groups'}. Score from the bid documents (Files on the bid) against each criterion.</p>
      <table class="grid"><tr><th>Criterion</th><th>Score</th><th>Comment</th></tr>${t.criteria.map(k => `<tr><td>${esc(k.name)}</td><td>${k.kind === 'mandatory' ? `<select data-sc="${k.id}"><option value="">–</option><option value="1" ${val(k) === 1 ? 'selected' : ''}>Pass</option><option value="0" ${val(k) === 0 ? 'selected' : ''}>Fail</option></select>` : `<input type="number" min="0" max="${Number(k.max_points)}" step="0.5" data-sc="${k.id}" value="${val(k)}" style="width:80px"> / ${Number(k.max_points)}`}</td><td><input data-cm="${k.id}" value="${esc((mine.find(x => x.criterion_id === k.id) || {}).comment || '')}"></td></tr>`).join('')}</table>`,
    actions: [{ label: 'Cancel' }, { label: 'Save scores', cls: 'btn-primary', onClick: async (c, r) => {
      const scores = $$('[data-sc]', r).filter(i => i.value !== '').map(i => ({ criterion_id: Number(i.dataset.sc), score: Number(i.value), comment: r.querySelector(`[data-cm="${i.dataset.sc}"]`).value }));
      await POST(`/tenders/${t.id}/score`, { bid_id: bidId, scores }); toast('Scores saved'); c(); reload();
    } }] });
}
