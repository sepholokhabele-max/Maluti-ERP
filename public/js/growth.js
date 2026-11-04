// CRM sales pipeline (leads / opportunities) and contracts with repeat invoices
import { state, GET, POST, PUT, esc, $, $$, toast, err, can, money, qty, modal, confirmBox, promptBox, formHtml, readForm, tableHtml, badge, page, d, dt, today, plusDays, query, attachPanel, hasMod, locationOptions } from './core.js';

const SOURCES = [['walk_in', 'Walk-in'], ['phone', 'Phone'], ['whatsapp', 'WhatsApp'], ['facebook', 'Facebook'], ['referral', 'Referral'], ['website', 'Website'], ['tender', 'Tender'], ['other', 'Other']];
const srcLabel = v => (SOURCES.find(s => s[0] === v) || [v, v])[1];
const stars = n => '★'.repeat(Number(n) || 0);

/* ======================= PIPELINE ======================= */
export async function pipeline(view) {
  const q = query(); const st = q.status || 'open';
  const [rows, sm, stages] = await Promise.all([GET(`/leads?status=${st}${q.mine ? '&mine=1' : ''}${q.q ? '&q=' + encodeURIComponent(q.q) : ''}`), GET('/leads/summary'), GET('/crm/stages')]);
  view.innerHTML = page('Sales pipeline', `<a class="btn" href="#/crm">🤝 CRM</a>${can('settings') ? '<button class="btn" id="stg">Stages</button>' : ''}<button class="btn btn-primary" id="nl">＋ New lead</button>`, `
    <div class="cols cols-4" style="margin-bottom:14px">
      <div class="kpi"><div class="label">Open pipeline</div><div class="value">${money(sm.open_value)}</div><div class="hint">${sm.stages.reduce((t, s) => t + s.n, 0)} open leads</div></div>
      <div class="kpi"><div class="label">Expected (weighted)</div><div class="value">${money(sm.weighted)}</div><div class="hint">value × chance of winning</div></div>
      <div class="kpi"><div class="label">Won (90 days)</div><div class="value" style="color:var(--ok)">${sm.won_90}</div><div class="hint">${money(sm.won_value_90)}</div></div>
      <div class="kpi"><div class="label">Win rate (90 days)</div><div class="value">${sm.win_rate == null ? '–' : sm.win_rate + '%'}</div><div class="hint">${sm.lost_90} lost${sm.lost_reasons.length ? ' · mostly: ' + esc(sm.lost_reasons[0].reason) : ''}</div></div></div>
    <div class="row wrap" style="margin-bottom:8px">${[['open', 'Open'], ['won', 'Won'], ['lost', 'Lost'], ['all', 'All']].map(([k, l]) => `<a class="btn btn-sm ${k === st && !q.mine ? 'btn-primary' : ''}" href="#/pipeline?status=${k}">${l}</a>`).join('')}
      <a class="btn btn-sm ${q.mine ? 'btn-primary' : ''}" href="#/pipeline?status=open&mine=1">Mine</a><span class="spacer"></span><input id="lq" placeholder="Search…" value="${esc(q.q || '')}" style="max-width:260px"></div>
    ${st === 'open' ? `<div class="kanban" style="grid-template-columns:repeat(${stages.length}, minmax(210px, 1fr))">${stages.map(s => { const ls = rows.filter(l => l.stage_id === s.id); const sv = sm.stages.find(x => x.id === s.id) || {};
      return `<div class="kb-col"><div class="kb-head">${esc(s.name)} <span class="muted">${ls.length} · ${money(sv.value || 0)}</span></div>
        ${ls.map(l => `<div class="kb-card" data-l="${l.id}"><b>${esc(l.title)}</b> <span style="color:#d97706">${stars(l.priority)}</span>
          <small>${esc(l.partner_name || l.company || l.contact_name || '')}${Number(l.expected_value) ? ' · ' + money(l.expected_value) : ''}</small>
          <small>${l.next_activity ? `${new Date(String(l.next_activity).replace(' ', 'T')) < new Date() ? '⚠ ' : '📅 '}${esc(l.next_subject || '')} ${esc(d(l.next_activity))}` : '<span class="neg">no next step planned</span>'}</small>
          <div class="kb-move">${stages.filter(x => x.id !== s.id).map(x => `<button class="btn btn-sm" data-mv="${l.id}:${x.id}">→ ${esc(x.name)}</button>`).join('')}</div></div>`).join('')}</div>`; }).join('')}</div>`
    : `<div class="card">${tableHtml([{ key: 'title', label: 'Lead' }, { key: 'partner_name', label: 'Customer', fmt: (v, r) => v || r.company || r.contact_name || '' }, { key: 'source', label: 'Source', fmt: srcLabel },
      { key: 'expected_value', label: 'Value', right: 1, fmt: money }, { key: 'status', label: 'Result', html: 1, fmt: v => v === 'won' ? badge('won', 'ok') : v === 'lost' ? badge('lost', 'cancelled') : badge('open', 'draft') },
      { key: 'lost_reason', label: 'Why lost' }, { key: 'closed_at', label: 'Closed', fmt: d }, { key: 'owner_name', label: 'Owner' }], rows, { rowAttr: r => `data-l="${r.id}"`, empty: 'Nothing here.' })}</div>`}
    ${sm.by_source.length ? `<div class="card" style="margin-top:14px"><h3>Where leads come from (6 months)</h3>${tableHtml([{ key: 'source', label: 'Source', fmt: srcLabel }, { key: 'n', label: 'Leads', right: 1 }, { key: 'won', label: 'Won', right: 1 }, { key: 'source', label: 'Win %', right: 1, fmt: (v, r) => r.n ? Math.round(r.won / r.n * 100) + '%' : '' }], sm.by_source)}</div>` : ''}`);
  $$('[data-l]').forEach(c => c.onclick = () => { location.hash = '#/lead/' + c.dataset.l; });
  $$('[data-mv]').forEach(b => b.onclick = async e => { e.stopPropagation(); const [lid, sid] = b.dataset.mv.split(':'); try { await PUT('/leads/' + lid, { stage_id: Number(sid) }); pipeline(view); } catch (x) { err(x); } });
  $('#nl').onclick = () => leadDialog(null, l => { location.hash = '#/lead/' + l.id; });
  let tm; $('#lq').oninput = e => { clearTimeout(tm); tm = setTimeout(() => { location.hash = `#/pipeline?status=all&q=${encodeURIComponent(e.target.value)}`; }, 500); };
  if ($('#stg')) $('#stg').onclick = () => {
    const list = stages.map(s => ({ ...s }));
    const draw = r => { r.querySelector('#sl').innerHTML = list.map((s, i) => `<tr><td><input data-i="${i}" data-k="name" value="${esc(s.name)}"></td><td style="width:120px"><input type="number" class="r" data-i="${i}" data-k="probability" value="${s.probability}"></td><td style="width:32px"><button class="icon-btn" data-rm="${i}">✕</button></td></tr>`).join('');
      $$('[data-k]', r).forEach(inp => inp.oninput = () => { list[Number(inp.dataset.i)][inp.dataset.k] = inp.value; }); $$('[data-rm]', r).forEach(b => b.onclick = () => { list.splice(Number(b.dataset.rm), 1); draw(r); }); };
    modal({ title: 'Pipeline stages', body: `<table class="grid lines"><thead><tr><th>Stage</th><th class="r">Chance of winning %</th><th></th></tr></thead><tbody id="sl"></tbody></table><button class="btn btn-sm" id="sa" style="margin-top:6px">＋ Stage</button>
      <small class="help-note">Stages in the order a deal moves. The chance of winning gives the expected (weighted) value. Won and lost are not stages – use the buttons on a lead.</small>`,
      onOpen: r => { draw(r); r.querySelector('#sa').onclick = () => { list.push({ name: '', probability: 50 }); draw(r); }; },
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async c => { await PUT('/crm/stages', { stages: list }); c(); pipeline(view); } }] });
  };
}

async function leadDialog(l, done) {
  const [cust, us, stages] = await Promise.all([GET('/partners?is_customer=1'), GET('/crm/users').catch(() => []), GET('/crm/stages')]);
  const f = [{ key: 'title', label: 'Opportunity', required: true, span: 2 }, { key: 'partner_id', label: 'Existing customer', type: 'select', numeric: true, options: [{ value: '', label: '— new / not in contacts —' }, ...cust.map(c => ({ value: c.id, label: c.name }))] },
    { key: 'company', label: 'Company / organisation' }, { key: 'contact_name', label: 'Contact person' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' },
    { key: 'source', label: 'Where it came from', type: 'select', options: SOURCES.map(([value, label]) => ({ value, label })) },
    { key: 'stage_id', label: 'Stage', type: 'select', numeric: true, options: stages.map(s => ({ value: s.id, label: s.name })) },
    { key: 'expected_value', label: 'Expected value (M)', type: 'number' }, { key: 'probability', label: 'Chance of winning % (blank = from stage)', type: 'number', nullable: true },
    { key: 'expected_close', label: 'Expected decision date', type: 'date' }, { key: 'owner_id', label: 'Owner', type: 'select', numeric: true, options: us.map(u => ({ value: u.id, label: u.name })) },
    { key: 'priority', label: 'Priority', type: 'select', options: [['1', '★ normal'], ['2', '★★ high'], ['3', '★★★ hot'], ['0', 'low']].map(([value, label]) => ({ value, label })) },
    { key: 'notes', label: 'Notes – what they need, budget, competitors', type: 'textarea', rows: 3, span: 2 }];
  modal({ title: l ? l.title : 'New lead', size: 'lg', body: formHtml(f, l ? { ...l, expected_close: d(l.expected_close), priority: String(l.priority) } : { source: 'phone', stage_id: (stages[0] || {}).id, owner_id: state.user.id, priority: '1' }, { ctx: 'lead' }),
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); const out = l ? await PUT('/leads/' + l.id, v) : await POST('/leads', v); c(); toast('Saved'); done(out); } }] });
}

export async function leadForm(view, [idq]) {
  const id = (idq || '').split('?')[0];
  const l = await GET('/leads/' + id);
  const open = l.status === 'open';
  const acts = ['<button class="btn" id="lEdit">Edit</button>', '<button class="btn" id="lAct">＋ Activity</button>'];
  if (l.sale_order_id) acts.push(`<a class="btn" href="#/quote/${l.sale_order_id}">📝 ${esc(l.sale_order_number || l.quote_number || 'Quotation')}</a>`);
  else if (open && can('sales')) acts.push('<button class="btn btn-primary" id="lQuote">📝 Make quotation</button>');
  if (open) acts.push('<button class="btn btn-ok" id="lWon">✓ Won</button>', '<button class="btn btn-danger" id="lLost">✕ Lost</button>');
  else acts.push('<button class="btn" id="lReopen">Reopen</button>');
  view.innerHTML = page(l.title, acts.join(''), `<div class="cols" style="grid-template-columns:2fr 1fr;align-items:start"><div>
    <div class="card"><div class="row wrap" style="margin-bottom:8px">${l.status === 'won' ? badge('won', 'ok') : l.status === 'lost' ? badge('lost – ' + (l.lost_reason || ''), 'cancelled') : badge(l.stage_name || 'open', 'posted')}
      <span style="color:#d97706">${stars(l.priority)}</span><span class="muted">${srcLabel(l.source)} · created ${esc(d(l.created_at))} · owner ${esc(l.owner_name || '–')}</span></div>
      <div class="cols cols-3"><div class="kpi"><div class="label">Expected value</div><div class="value">${money(l.expected_value)}</div></div>
        <div class="kpi"><div class="label">Chance</div><div class="value">${l.prob ?? '–'}%</div></div><div class="kpi"><div class="label">Decision by</div><div class="value" style="font-size:18px">${esc(d(l.expected_close) || '–')}</div></div></div>
      ${l.notes ? `<p style="white-space:pre-wrap">${esc(l.notes)}</p>` : ''}</div>
    <div class="card" style="margin-top:14px"><h3>Activities</h3>${l.activities.length ? l.activities.map(a => `<div class="msg ${a.done ? '' : 'internal'}"><div class="row"><b style="flex:1">${esc(a.subject)}</b><small class="muted">${esc(a.type)} · ${a.due_at ? esc(dt(a.due_at)) : esc(dt(a.created_at))}${a.assigned_name ? ' · ' + esc(a.assigned_name) : ''}</small>
      ${a.done ? '' : `<button class="btn btn-sm" data-done="${a.id}">✓ Done</button>`}</div>${a.body ? `<div style="white-space:pre-wrap">${esc(a.body)}</div>` : ''}</div>`).join('') : '<div class="muted">No calls, meetings or tasks yet. Plan the next step so the lead does not go cold.</div>'}</div></div>
    <div><div class="card"><h3>Contact</h3><p style="margin-top:0"><b>${esc(l.partner_name || l.company || '')}</b><br>${esc(l.contact_name || '')}<br>${esc(l.phone || '')}<br>${esc(l.email || '')}</p>
      ${l.partner_id ? `<a class="btn btn-sm" href="#/customer/${l.partner_id}">Customer card</a>` : '<small class="muted">Becomes a customer when you make the quotation or mark it won.</small>'}</div>
      <div class="card" style="margin-top:14px" id="files"></div></div></div>`, { back: '#/pipeline' });
  attachPanel($('#files'), 'lead', l.id);
  const reload = () => leadForm(view, [id]);
  $('#lEdit').onclick = () => leadDialog(l, reload);
  $$('[data-done]').forEach(b => b.onclick = async () => { await PUT('/crm/activities/' + b.dataset.done, { done: 1 }); reload(); });
  $('#lAct').onclick = () => {
    const f = [{ key: 'type', label: 'Type', type: 'select', options: [['call', 'Call'], ['meeting', 'Meeting'], ['visit', 'Visit'], ['task', 'To do'], ['email', 'Email sent'], ['note', 'Note']].map(([value, label]) => ({ value, label })) },
      { key: 'due_at', label: 'When', type: 'datetime-local' }, { key: 'subject', label: 'Subject', required: true, span: 2 }, { key: 'body', label: 'Details', type: 'textarea', rows: 3, span: 2 }];
    modal({ title: 'Plan or log an activity', body: formHtml(f, { type: 'call', due_at: plusDays(1) + 'T09:00' }, { ctx: 'activity' }), actions: [{ label: 'Cancel' },
      { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); await POST('/crm/activities', { ...v, due_at: v.due_at ? v.due_at.replace('T', ' ') + ':00' : null, lead_id: l.id }); c(); reload(); } }] });
  };
  if ($('#lQuote')) $('#lQuote').onclick = async () => { try { const r = await POST(`/leads/${l.id}/quote`); toast('Quotation started – add the lines'); location.hash = '#/quote/' + r.sale_order_id; } catch (e) { err(e); } };
  if ($('#lWon')) $('#lWon').onclick = async () => { if (await confirmBox('Mark this lead as won? (Confirming its quotation does this automatically.)', { okLabel: 'Won' })) { await POST(`/leads/${l.id}/won`, {}); toast('🎉 Won'); reload(); } };
  if ($('#lLost')) $('#lLost').onclick = async () => { const reason = await promptBox('Why was it lost?', { label: 'e.g. price too high, chose a competitor, no budget, no reply' }); if (reason) { try { await POST(`/leads/${l.id}/lost`, { reason }); reload(); } catch (e) { err(e); } } };
  if ($('#lReopen')) $('#lReopen').onclick = async () => { await POST(`/leads/${l.id}/reopen`); reload(); };
}

/* ======================= CONTRACTS ======================= */
const PER = [['monthly', 'Month'], ['quarterly', 'Quarter (3 months)'], ['yearly', 'Year'], ['weekly', 'Week']];
const every = k => `every ${k.every > 1 ? k.every + ' ' : ''}${{ weekly: 'week', monthly: 'month', quarterly: 'quarter', yearly: 'year' }[k.period]}${k.every > 1 ? 's' : ''}`;
const ctBadge = s => s === 'active' ? badge('active', 'ok') : s === 'paused' ? badge('paused', 'draft') : s === 'ended' ? badge('ended', 'closed') : badge('draft', 'draft');

export async function contracts(view) {
  const st = query().status || 'current';
  const r = await GET('/contracts?status=' + st);
  view.innerHTML = page('Contracts & repeat invoices', `${r.due ? `<button class="btn btn-ok" id="run">🧾 Make ${r.due} due invoice(s) now</button>` : ''}<a class="btn btn-primary" href="#/contract/new">＋ New contract</a>`, `
    <div class="cols cols-3" style="margin-bottom:14px"><div class="kpi"><div class="label">Monthly recurring income</div><div class="value">${money(r.mrr)}</div><div class="hint">active contracts, incl. VAT, per month</div></div>
      <div class="kpi"><div class="label">Active contracts</div><div class="value">${r.rows.filter(k => k.status === 'active').length}</div></div>
      <div class="kpi"><div class="label">Invoices due now</div><div class="value" style="color:${r.due ? 'var(--warn)' : 'var(--ok)'}">${r.due}</div><div class="hint">made automatically every hour while the system runs</div></div></div>
    <div class="tabs">${[['current', 'Current'], ['ended', 'Ended'], ['all', 'All']].map(([k, l]) => `<a href="#/contracts?status=${k}" class="${k === st ? 'active' : ''}">${l}</a>`).join('')}</div>
    <div class="card">${tableHtml([{ key: 'number', label: 'Number' }, { key: 'name', label: 'Contract' }, { key: 'partner_name', label: 'Customer' }, { key: 'period', label: 'Invoiced', fmt: (v, k) => every(k) },
      { key: 'amount', label: 'Amount incl. VAT', right: 1, fmt: money }, { key: 'next_date', label: 'Next invoice', fmt: (v, k) => k.status === 'ended' ? '' : d(v) },
      { key: 'end_date', label: 'Ends', fmt: d }, { key: 'invoices_made', label: 'Invoices', right: 1 }, { key: 'auto_post', label: 'Auto-post', fmt: v => v ? '✓' : '' }, { key: 'status', label: 'Status', html: 1, fmt: ctBadge }], r.rows,
      { rowAttr: k => `data-id="${k.id}"`, empty: 'No contracts yet – rent, school fees, security or support contracts that are invoiced every period.' })}</div>`);
  $$('[data-id]').forEach(tr => tr.onclick = () => { location.hash = '#/contract/' + tr.dataset.id; });
  if ($('#run')) $('#run').onclick = async () => { try { const o = await POST('/contracts/run', {}); toast(`${o.invoices.length} invoice(s) made`); contracts(view); } catch (e) { err(e); } };
}

export async function contractForm(view, [idq]) {
  const id = (idq || '').split('?')[0];
  const isNew = id === 'new';
  const [cust, prods, projs] = await Promise.all([GET('/partners?is_customer=1'), GET('/products'), hasMod('projects') ? GET('/projects?status=active').catch(() => []) : []]);
  const k = isNew ? { period: 'monthly', every: 1, start_date: today(), due_days: 7, status: 'draft', lines: [] } : await GET('/contracts/' + id);
  const vat = Number((state.company && state.company.default_vat) ?? 15);
  const lines = (k.lines || []).map(l => ({ product_id: l.product_id, description: l.description, qty: Number(l.qty), unit_price: Number(l.unit_price), tax_rate: Number(l.tax_rate) }));
  if (!lines.length) lines.push({ product_id: null, description: '', qty: 1, unit_price: 0, tax_rate: vat });
  const editable = k.status !== 'ended';
  const acts = [];
  if (editable) acts.push('<button class="btn btn-primary" id="cSave">Save</button>');
  if (!isNew && ['draft', 'paused'].includes(k.status)) acts.push('<button class="btn btn-ok" id="cAct">▶ Activate</button>');
  if (!isNew && k.status === 'active') acts.push('<button class="btn" id="cNow">🧾 Invoice due now</button>', '<button class="btn" id="cPause">Pause</button>');
  if (!isNew && k.status !== 'ended') acts.push('<button class="btn btn-danger" id="cEnd">End contract</button>');
  const f = [{ key: 'partner_id', label: 'Customer', type: 'select', numeric: true, required: true, options: cust.map(c => ({ value: c.id, label: c.name })) }, { key: 'name', label: 'Contract name', required: true },
    { key: 'period', label: 'Invoice every', type: 'select', options: PER.map(([value, label]) => ({ value, label })) }, { key: 'every', label: 'Number of periods (2 = every second month)', type: 'number' },
    { key: 'start_date', label: 'First invoice date', type: 'date' }, { key: 'end_date', label: 'Contract ends (blank = until stopped)', type: 'date' },
    ...(!isNew && k.invoices_made ? [{ key: 'next_date', label: 'Next invoice date', type: 'date' }] : []),
    { key: 'due_days', label: 'Days to pay', type: 'number' }, { key: 'auto_post', label: 'Post invoices automatically (otherwise they wait as drafts)', type: 'checkbox' },
    ...(projs.length ? [{ key: 'project_id', label: 'Project', type: 'select', numeric: true, options: [{ value: '', label: '—' }, ...projs.map(p => ({ value: p.id, label: p.name }))] }] : []),
    { key: 'notes', label: 'Notes', span: 2 }];
  view.innerHTML = page(isNew ? 'New contract' : `${k.number} · ${k.name}`, acts.join(''), `
    <div class="card">${isNew ? '' : `<div class="row wrap" style="margin-bottom:10px">${ctBadge(k.status)}<span class="muted">${every(k)} · ${money(k.amount)} incl. VAT · next invoice ${esc(k.status === 'ended' ? '–' : d(k.next_date))}${k.unpaid ? ` · <b class="neg">${money(k.unpaid)} unpaid</b>` : ''}</span></div>`}
      <div id="ch">${formHtml(f, { ...k, start_date: d(k.start_date), end_date: d(k.end_date), next_date: d(k.next_date) }, { ctx: 'contract' })}</div>
      <h3 style="margin:16px 0 8px">Invoiced each time <small class="muted" style="font-weight:400">prices excl. VAT</small></h3><div id="cl"></div></div>
    ${isNew ? '' : `<div class="cols cols-2" style="margin-top:14px"><div class="card"><h3>Invoices</h3>${tableHtml([{ key: 'number', label: 'Invoice', fmt: v => v || 'Draft' }, { key: 'invoice_date', label: 'Date', fmt: d }, { key: 'due_date', label: 'Due', fmt: d },
      { key: 'status', label: 'Status', html: 1, fmt: v => badge(v) }, { key: 'total', label: 'Total', right: 1, fmt: money }], k.invoices, { rowAttr: i => `data-inv="${i.id}"`, empty: 'None yet.' })}</div><div class="card" id="files"></div></div>`}`, { back: '#/contracts' });
  if (!isNew) attachPanel($('#files'), 'contract', k.id, { title: 'Signed contract & files' });
  $$('[data-inv]').forEach(tr => tr.onclick = () => { location.hash = '#/invoice/' + tr.dataset.inv; });
  if (!editable) $$('#ch input, #ch select').forEach(i => i.disabled = true);
  const draw = () => {
    $('#cl').innerHTML = `<table class="grid lines"><thead><tr><th style="width:30%">Product / service</th><th>Description</th><th class="r" style="width:80px">Qty</th><th class="r" style="width:120px">Price</th><th class="r" style="width:80px">VAT %</th><th class="r" style="width:110px">Total</th>${editable ? '<th style="width:32px"></th>' : ''}</tr></thead><tbody>
      ${lines.map((l, i) => `<tr><td><select data-i="${i}" data-k="product_id" ${editable ? '' : 'disabled'}><option value="">— free text —</option>${prods.map(p => `<option value="${p.id}" ${p.id === Number(l.product_id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></td>
        <td><input data-i="${i}" data-k="description" value="${esc(l.description || '')}" ${editable ? '' : 'disabled'}></td><td><input data-i="${i}" data-k="qty" type="number" step="any" class="r" value="${l.qty}" ${editable ? '' : 'disabled'}></td>
        <td><input data-i="${i}" data-k="unit_price" type="number" step="any" class="r" value="${l.unit_price}" ${editable ? '' : 'disabled'}></td><td><input data-i="${i}" data-k="tax_rate" type="number" step="any" class="r" value="${l.tax_rate}" ${editable ? '' : 'disabled'}></td>
        <td class="r" data-t="${i}">${money(l.qty * l.unit_price * (1 + l.tax_rate / 100))}</td>${editable ? `<td><button class="icon-btn" data-del="${i}">✕</button></td>` : ''}</tr>`).join('')}</tbody></table>
      ${editable ? '<button class="btn btn-sm" id="cAdd" style="margin-top:8px">＋ Line</button>' : ''}`;
    $$('[data-k]', $('#cl')).forEach(inp => inp.oninput = inp.onchange = () => {
      const l = lines[Number(inp.dataset.i)]; const key = inp.dataset.k;
      l[key] = key === 'description' ? inp.value : key === 'product_id' ? Number(inp.value) || null : Number(inp.value);
      if (key === 'product_id') { const p = prods.find(x => x.id === l.product_id); if (p) { l.description = p.name; const r = Number(p.tax_rate ?? vat); l.tax_rate = r; l.unit_price = Math.round(Number(p.price) / (1 + r / 100) * 100) / 100; } draw(); }
      else $(`[data-t="${inp.dataset.i}"]`).textContent = money(l.qty * l.unit_price * (1 + l.tax_rate / 100));
    });
    $$('[data-del]', $('#cl')).forEach(b => b.onclick = () => { lines.splice(Number(b.dataset.del), 1); draw(); });
    if ($('#cAdd')) $('#cAdd').onclick = () => { lines.push({ product_id: null, description: '', qty: 1, unit_price: 0, tax_rate: vat }); draw(); };
  };
  draw();
  const save = async () => { const v = readForm($('#ch'), f); const b = { ...v, lines: lines.filter(l => l.product_id || l.description) }; return isNew ? (await POST('/contracts', b)).id : (await PUT('/contracts/' + k.id, b)).id; };
  if ($('#cSave')) $('#cSave').onclick = async () => { try { const nid = await save(); toast('Saved'); if (isNew) location.hash = '#/contract/' + nid; else contractForm(view, [id]); } catch (e) { err(e); } };
  const act = async (p, msg) => { try { if (editable && p === 'activate') await save(); await POST(`/contracts/${k.id}/${p}`); toast(msg); contractForm(view, [id]); } catch (e) { err(e); } };
  if ($('#cAct')) $('#cAct').onclick = () => act('activate', 'Active – invoices will be made on their dates');
  if ($('#cPause')) $('#cPause').onclick = () => act('pause', 'Paused – no invoices until you activate it again');
  if ($('#cEnd')) $('#cEnd').onclick = async () => { if (await confirmBox('End this contract? No more invoices will be made.', { danger: true, okLabel: 'End contract' })) act('end', 'Contract ended'); };
  if ($('#cNow')) $('#cNow').onclick = async () => { try { const o = await POST('/contracts/run', { contract_id: k.id }); toast(o.invoices.length ? `${o.invoices.length} invoice(s) made` : `Nothing due – next invoice ${d(k.next_date)}`); contractForm(view, [id]); } catch (e) { err(e); } };
}
