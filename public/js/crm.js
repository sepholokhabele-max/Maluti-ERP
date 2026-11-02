// CRM: customer list with stats, activities board, customer 360
import { state, GET, POST, PUT, DEL, esc, $, $$, toast, err, can, money, qty, modal, confirmBox, formHtml, readForm, tableHtml, badge, page, dt, d, today, debounce, query, printHtml } from './core.js';

const ICON = { note: '📝', call: '📞', meeting: '🤝', task: '✅', email: '✉️', sms: '💬', visit: '🚶' };
const TYPES = Object.keys(ICON);
const tagChips = t => (t || '').split(',').map(x => x.trim()).filter(Boolean).map(x => `<span class="tag">${esc(x)}</span>`).join('');
const ago = s => {
  if (!s) return 'never';
  const days = Math.floor((Date.now() - new Date(String(s).replace(' ', 'T'))) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 60 ? `${days} days ago` : `${Math.round(days / 30)} months ago`;
};
const localDT = s => s ? String(s).replace(' ', 'T').slice(0, 16) : '';

let usersCache = null;
const users = async () => usersCache || (usersCache = await GET('/crm/users'));

export const PARTNER_EXTRA_FIELDS = [
  { key: 'contact_person', label: 'Contact person' }, { key: 'birthday', label: 'Birthday', type: 'date' },
  { key: 'tags', label: 'Tags (comma separated, e.g. vip, wholesale)', span: 2 }
];

// ---------------------------------------------------------------- CRM home
export async function crm(view) {
  const tab = query().tab || 'customers';
  view.innerHTML = page('CRM', `<button class="btn" id="newAct">＋ Activity</button><button class="btn btn-primary" id="newCust">＋ Customer</button>`, `
    <div class="tabs"><a href="#/crm?tab=customers" class="${tab === 'customers' ? 'active' : ''}">Customers</a>
    <a href="#/crm?tab=activities" class="${tab === 'activities' ? 'active' : ''}">Activities & follow-ups</a></div><div id="cb"></div>`);
  $('#newAct').onclick = () => activityDialog({ onSaved: () => crm(view) });
  $('#newCust').onclick = () => newCustomer();
  if (tab === 'activities') return activitiesTab($('#cb'), view);
  return customersTab($('#cb'));
}

async function customersTab(root) {
  const q = query();
  root.innerHTML = `<div class="row wrap" style="margin-bottom:10px">
      <input id="cq" placeholder="Search name, phone, email, tag…" style="max-width:280px" value="${esc(q.q || '')}">
      <select id="ctag" style="max-width:180px"><option value="">All tags</option></select>
      <select id="cin" style="max-width:200px"><option value="">Any activity</option><option value="30">No visit in 30 days</option><option value="60">No visit in 60 days</option><option value="90">No visit in 90 days</option></select>
      <select id="csort" style="max-width:200px"><option value="name">Sort: name</option><option value="spent">Sort: top spenders</option><option value="last_visit">Sort: most recent</option><option value="orders">Sort: most orders</option><option value="balance">Sort: balance owed</option></select>
      <span class="spacer"></span><span class="muted" id="ccount"></span></div><div id="ct"></div>`;
  let tagsLoaded = false;
  const load = async () => {
    const rows = await GET(`/crm/customers?q=${encodeURIComponent($('#cq').value)}&tag=${encodeURIComponent($('#ctag').value)}&inactive_days=${$('#cin').value}&sort=${$('#csort').value}`);
    if (!tagsLoaded) {
      const tags = [...new Set(rows.flatMap(r => (r.tags || '').split(',').map(t => t.trim()).filter(Boolean)))].sort();
      $('#ctag').innerHTML += tags.map(t => `<option>${esc(t)}</option>`).join(''); tagsLoaded = true;
    }
    $('#ccount').textContent = `${rows.length} customers · ${money(rows.reduce((s, r) => s + r.total_spent, 0))} lifetime`;
    $('#ct').innerHTML = tableHtml([
      { key: 'name', label: 'Customer', html: 1, fmt: (v, r) => `<b>${esc(v)}</b> ${tagChips(r.tags)}` },
      { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' },
      { key: 'pos_orders', label: 'Orders', right: 1 }, { key: 'total_spent', label: 'Lifetime spend', right: 1, fmt: money },
      { key: 'last_visit', label: 'Last visit', fmt: v => ago(v) },
      { key: 'balance', label: 'Owes', right: 1, html: 1, fmt: v => v > 0 ? `<b style="color:var(--bad)">${money(v)}</b>` : '' },
      { key: 'open_activities', label: 'Open tasks', right: 1, html: 1, fmt: v => v ? badge(String(v), 'pending') : '' }
    ], rows, { rowAttr: r => `data-href="#/customer/${r.id}"`, empty: 'No customers match.' });
    $$('[data-href]', root).forEach(tr => tr.onclick = () => location.hash = tr.dataset.href);
  };
  $('#cq').oninput = debounce(load); ['#ctag', '#cin', '#csort'].forEach(s => $(s).onchange = load);
  load();
}

async function activitiesTab(root, view) {
  const [sum] = await Promise.all([GET('/crm/summary')]);
  root.innerHTML = `<div class="cols cols-4" style="margin-bottom:14px">
      <div class="kpi"><div class="label">Overdue (mine)</div><div class="value" style="color:${sum.overdue ? 'var(--bad)' : 'inherit'}">${sum.overdue}</div></div>
      <div class="kpi"><div class="label">Due today (mine)</div><div class="value">${sum.today}</div></div>
      <div class="kpi"><div class="label">Open (mine)</div><div class="value">${sum.open}</div></div>
      <div class="kpi"><div class="label">Birthdays this week</div><div class="value">${sum.birthdays.length}</div>
        <div class="hint">${sum.birthdays.map(b => `<a href="#/customer/${b.id}">${esc(b.name)}</a> ${b.in_days === 0 ? '🎂 today' : `in ${b.in_days}d`}`).join(' · ')}</div></div></div>
    <div class="row wrap" style="margin-bottom:10px">
      <select id="asc" style="max-width:180px"><option value="mine">Assigned to me</option><option value="all">Everyone</option></select>
      <select id="ast" style="max-width:160px"><option value="open">Open</option><option value="done">Done</option><option value="any">All</option></select>
      <select id="aty" style="max-width:160px"><option value="">All types</option>${TYPES.map(t => `<option value="${t}">${ICON[t]} ${t}</option>`).join('')}</select></div>
    <div id="al"></div>`;
  const load = async () => {
    const rows = await GET(`/crm/activities?scope=${$('#asc').value}&status=${$('#ast').value}&type=${$('#aty').value}`);
    const now = new Date(); const tday = today();
    const group = a => a.done ? 'Done' : !a.due_at ? 'No due date' : a.overdue ? 'Overdue' : String(a.due_at).slice(0, 10) === tday ? 'Today' : 'Upcoming';
    const order = ['Overdue', 'Today', 'Upcoming', 'No due date', 'Done'];
    const groups = order.map(g => [g, rows.filter(a => group(a) === g)]).filter(([, l]) => l.length);
    $('#al').innerHTML = groups.map(([g, list]) => `<h4 class="act-group ${g === 'Overdue' ? 'od' : ''}">${g} <span class="muted">(${list.length})</span></h4>
      <div class="card" style="padding:0">${list.map(activityRow).join('')}</div>`).join('') || '<div class="empty">Nothing here. 🎉</div>';
    wireActivityRows($('#al'), rows, load);
  };
  ['#asc', '#ast', '#aty'].forEach(s => $(s).onchange = load);
  load();
}

function activityRow(a, opts = {}) {
  const due = a.due_at ? `<span class="${!a.done && a.overdue ? 'var-bad' : 'muted'}">${a.done ? '' : 'due '}${dt(a.due_at)}</span>` : '';
  return `<div class="act ${a.done ? 'done' : ''}" data-a="${a.id}">
    <input type="checkbox" data-done="${a.id}" ${a.done ? 'checked' : ''} title="Mark done">
    <div class="ico">${ICON[a.type] || '•'}</div>
    <div class="body"><div><b>${esc(a.subject)}</b>${opts.hidePartner ? '' : ` · <a href="#/customer/${a.partner_id}">${esc(a.partner_name || '')}</a>`}</div>
      ${a.body ? `<div class="txt">${esc(a.body)}</div>` : ''}
      <div class="meta">${[due, a.assigned_name ? `👤 ${esc(a.assigned_name)}` : '', `added by ${esc(a.created_name || '?')}, ${dt(a.created_at)}`].filter(Boolean).join(' · ')}</div></div>
    <button class="icon-btn" data-edit="${a.id}" title="Edit">✎</button></div>`;
}

function wireActivityRows(root, rows, reload) {
  $$('[data-done]', root).forEach(cb => cb.onchange = async () => {
    try { await PUT('/crm/activities/' + cb.dataset.done, { done: cb.checked }); toast(cb.checked ? 'Done ✓' : 'Reopened'); reload(); } catch (e) { err(e); }
  });
  $$('[data-edit]', root).forEach(b => b.onclick = () => activityDialog({ activity: rows.find(r => String(r.id) === b.dataset.edit), onSaved: reload }));
}

async function activityDialog({ activity, partnerId, type, onSaved }) {
  const us = await users();
  const partners = partnerId || activity ? [] : await GET('/partners?is_customer=1');
  const a = activity || { type: type || 'task', assigned_to: state.user.id, partner_id: partnerId };
  const fields = [
    ...(partnerId || activity ? [] : [{ key: 'partner_id', label: 'Customer', type: 'select', numeric: true, required: true, options: [{ value: '', label: '— choose —' }, ...partners.map(p => ({ value: p.id, label: p.name }))], span: 2 }]),
    { key: 'type', label: 'Type', type: 'select', options: TYPES.map(t => ({ value: t, label: `${ICON[t]} ${t}` })) },
    { key: 'subject', label: 'Subject', required: true },
    { key: 'body', label: 'Details', type: 'textarea', span: 2, rows: 4 },
    { key: 'due_at', label: 'Due / scheduled for', type: 'datetime-local' },
    { key: 'assigned_to', label: 'Assigned to', type: 'select', numeric: true, options: us.map(u => ({ value: u.id, label: u.name })) },
    { key: 'done', label: 'Already done (log only)', type: 'checkbox' }
  ];
  const vals = { ...a, due_at: localDT(a.due_at), done: activity ? a.done : 0 };
  const actions = [{ label: 'Cancel' }];
  if (activity) actions.push({ label: 'Delete', cls: 'btn-danger', onClick: async c => { if (await confirmBox('Delete this activity?', { danger: true })) { await DEL('/crm/activities/' + activity.id); c(); onSaved && onSaved(); } } });
  actions.push({ label: 'Save', cls: 'btn-primary', onClick: async (c, r) => {
    const v = readForm(r, fields);
    if (activity) await PUT('/crm/activities/' + activity.id, v);
    else await POST('/crm/activities', { ...v, partner_id: partnerId || v.partner_id, done: v.done ? 1 : (['note', 'email', 'sms', 'visit'].includes(v.type) && !v.due_at ? 1 : 0) });
    c(); toast('Saved'); onSaved && onSaved();
  } });
  modal({ title: activity ? 'Edit activity' : 'New activity', size: 'lg', body: formHtml(fields, vals), actions });
}

const CUSTOMER_FIELDS = [{ key: 'name', label: 'Name', required: true, span: 2 }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email', type: 'email' },
  ...PARTNER_EXTRA_FIELDS, { key: 'address', label: 'Address', span: 2 }, { key: 'tax_number', label: 'VAT / TIN' }, { key: 'credit_limit', label: 'Credit limit', type: 'number' },
  { key: 'notes', label: 'Notes (shown to staff)', type: 'textarea', span: 2 }];

function newCustomer() {
  modal({ title: 'New customer', size: 'lg', body: formHtml(CUSTOMER_FIELDS, {}, { ctx: 'partner' }), actions: [{ label: 'Cancel' }, { label: 'Create', cls: 'btn-primary', onClick: async (c, r) => {
    const v = readForm(r, CUSTOMER_FIELDS); if (!v.birthday) v.birthday = null;
    const p = await POST('/partners', { ...v, is_customer: 1 }); c(); location.hash = '#/customer/' + p.id;
  } }] });
}

// ---------------------------------------------------------------- customer 360
export async function customer360(view, [id]) {
  const x = await GET('/crm/customers/' + id);
  const c = x.customer, s = x.stats;
  const max = Math.max(1, ...x.monthly.map(m => m.total));
  const open = x.activities.filter(a => !a.done).sort((a, b) => String(a.due_at || '9').localeCompare(String(b.due_at || '9')));
  const now = Date.now();
  open.forEach(a => a.overdue = a.due_at && new Date(String(a.due_at).replace(' ', 'T')).getTime() < now);

  // unified timeline
  const feed = [
    ...x.activities.filter(a => a.done).map(a => ({ at: a.done_at || a.created_at, html: `${ICON[a.type]} <b>${esc(a.subject)}</b>${a.body ? `<div class="txt">${esc(a.body)}</div>` : ''}<div class="meta">${esc(a.type)} · ${esc(a.created_name || '')}</div>`, cls: 'activity', id: a.id })),
    ...x.orders.map(o => ({ at: o.at, html: `${o.refund_of ? '↩️' : '🧾'} <b>${esc(o.number || 'Order #' + o.id)}</b> · ${money(o.total)} ${badge(o.status)}<div class="meta">${esc(o.mode)}${o.table_name ? ' · table ' + esc(o.table_name) : ''}${o.tab_name ? ' · ' + esc(o.tab_name) : ''} · ${esc(o.user_name || '')}</div>`, cls: 'order', order: o.id })),
    ...x.invoices.map(i => ({ at: i.invoice_date + ' 00:00:00', html: `📄 <b>${esc(i.number || 'Draft invoice')}</b> · ${money(i.total)} ${badge(i.status)}${i.status !== 'paid' && i.status !== 'draft' ? ` <span class="muted">due ${money(i.total - i.amount_paid)}</span>` : ''}`, cls: 'invoice', href: '#/invoice/' + i.id })),
    ...x.payments.filter(p => !p.order_id).map(p => ({ at: p.created_at, html: `💰 Payment ${p.direction === 'out' ? 'out' : 'received'} · <b>${money(p.amount)}</b> · ${esc(p.method)} ${esc(p.reference || '')}`, cls: 'payment' }))
  ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 80);

  view.innerHTML = page(c.name, `${c.phone ? `<a class="btn" href="tel:${esc(c.phone)}">📞 ${esc(c.phone)}</a>` : ''}
      <button class="btn" id="edit">Edit</button><button class="btn" id="mail" ${c.email ? '' : 'disabled title="No email address"'}>✉ Email</button>
      ${s.balance > 0 && can('invoicing') ? '<button class="btn" id="recv">Receive payment</button>' : ''}
      ${can('invoicing') ? `<a class="btn" href="#/invoice/new?kind=customer_invoice&partner_id=${c.id}">＋ Invoice</a>` : ''}
      <button class="btn btn-primary" id="addAct">＋ Activity</button>`, `
    <div class="card c360-head">
      <div class="avatar-lg">${esc(c.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase())}</div>
      <div style="flex:1"><div class="row wrap">${tagChips(c.tags)}${c.birthday ? `<span class="muted">🎂 ${esc(String(c.birthday).slice(5))}</span>` : ''}</div>
        <div class="muted" style="margin-top:4px">${[c.contact_person, c.email, c.address, c.tax_number ? 'VAT ' + c.tax_number : ''].filter(Boolean).map(esc).join(' · ') || 'No contact details yet'}</div>
        ${c.notes ? `<div class="notice-inline">📌 ${esc(c.notes)}</div>` : ''}</div>
      <div class="muted" style="text-align:right;font-size:12.5px">Customer since<br><b>${s.first_visit ? d(s.first_visit) : d(c.created_at)}</b></div>
    </div>
    <div class="cols cols-6" style="margin:14px 0">
      ${kpi('Lifetime spend', money(s.total_spent), `${money(s.pos_spent)} POS · ${money(s.invoiced)} invoiced`)}
      ${kpi('Orders', s.orders + s.invoices, `${s.orders} POS · ${s.invoices} invoices`)}
      ${kpi('Average ticket', money(s.avg_ticket))}
      ${kpi('Last visit', ago(s.last_visit), s.last_visit ? dt(s.last_visit) : '')}
      ${kpi('Visits (90 days)', s.visits_90d)}
      ${kpi('Owes us', `<span style="color:${s.balance > 0 ? 'var(--bad)' : 'inherit'}">${money(s.balance)}</span>`, s.overdue > 0 ? `<span style="color:var(--bad)">${money(s.overdue)} overdue</span>` : 'nothing overdue')}
    </div>
    <div class="cols c360">
      <div>
        <div class="card"><div class="row" style="margin-bottom:8px"><h3 style="flex:1;margin:0">Open follow-ups</h3><button class="btn btn-sm" id="quickTask">＋ Task</button></div>
          <div id="openActs">${open.length ? open.map(a => activityRow(a, { hidePartner: true })).join('') : '<div class="muted">No open tasks.</div>'}</div></div>
        <div class="card"><h3>Log something</h3>
          <div class="row wrap" style="margin-bottom:8px">${['note', 'call', 'visit', 'meeting', 'sms'].map(t => `<button class="btn btn-sm ${t === 'note' ? 'btn-primary' : ''}" data-qt="${t}">${ICON[t]} ${t}</button>`).join('')}</div>
          <textarea id="qlog" rows="3" placeholder="What happened? e.g. Called about the overdue invoice, promised to pay Friday"></textarea>
          <div class="row" style="margin-top:8px"><span class="spacer"></span><button class="btn btn-primary" id="qsave">Log</button></div></div>
        <div class="card"><h3>Timeline</h3><div class="timeline">${feed.map(f => `<div class="tl ${f.cls}" ${f.order ? `data-order="${f.order}"` : ''} ${f.href ? `data-href="${f.href}"` : ''} ${f.id ? `data-aid="${f.id}"` : ''}>
            <div class="when">${dt(f.at)}</div><div class="what">${f.html}</div></div>`).join('') || '<div class="muted">No history yet.</div>'}</div></div>
      </div>
      <div>
        <div class="card"><h3>Spend — last 12 months</h3><div class="bars">${x.monthly.map(m => `<div class="b" style="height:${Math.max(2, m.total / max * 100)}%" title="${m.month}: ${money(m.total)}"><span>${m.month.slice(5)}</span></div>`).join('')}</div><div style="height:18px"></div></div>
        <div class="card"><h3>Favourite items</h3>${tableHtml([{ key: 'name', label: 'Item' }, { key: 'qty', label: 'Qty', right: 1, fmt: qty }, { key: 'total', label: 'Spent', right: 1, fmt: money }, { key: 'last_bought', label: 'Last', fmt: v => ago(v) }], x.favourites, { empty: 'No purchases yet' })}</div>
        <div class="card"><h3>Invoices</h3>${tableHtml([{ key: 'number', label: 'Number', fmt: v => v || 'Draft' }, { key: 'invoice_date', label: 'Date', fmt: d }, { key: 'status', label: 'Status', html: 1, fmt: v => badge(v) }, { key: 'total', label: 'Total', right: 1, fmt: money }, { key: 'amount_paid', label: 'Due', right: 1, fmt: (v, r) => money(r.total - v) }], x.invoices, { rowAttr: r => `data-href="#/invoice/${r.id}"`, empty: 'No invoices' })}</div>
      </div>
    </div>`, { back: '#/crm' });

  const reload = () => customer360(view, [id]);
  wireActivityRows($('#openActs'), open, reload);
  $$('[data-href]', view).forEach(el => el.onclick = () => location.hash = el.dataset.href);
  $$('[data-order]', view).forEach(el => el.onclick = () => showOrder(el.dataset.order));
  $$('[data-aid]', view).forEach(el => el.onclick = () => activityDialog({ activity: x.activities.find(a => String(a.id) === el.dataset.aid), onSaved: reload }));
  $('#addAct').onclick = () => activityDialog({ partnerId: c.id, onSaved: reload });
  $('#quickTask').onclick = () => activityDialog({ partnerId: c.id, type: 'task', onSaved: reload });
  let qtype = 'note';
  $$('[data-qt]').forEach(b => b.onclick = () => { qtype = b.dataset.qt; $$('[data-qt]').forEach(x2 => x2.classList.toggle('btn-primary', x2 === b)); });
  $('#qsave').onclick = async () => {
    const text = $('#qlog').value.trim(); if (!text) return toast('Write something first', 'info');
    try { await POST('/crm/activities', { partner_id: c.id, type: qtype, subject: text.split('\n')[0].slice(0, 120), body: text.includes('\n') || text.length > 120 ? text : null, done: 1 }); toast('Logged'); reload(); } catch (e) { err(e); }
  };
  $('#edit').onclick = () => modal({ title: 'Edit ' + c.name, size: 'lg', body: formHtml(CUSTOMER_FIELDS, { ...c, birthday: d(c.birthday) }, { ctx: 'partner' }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (cl, r) => {
    const v = readForm(r, CUSTOMER_FIELDS); if (!v.birthday) v.birthday = null; await PUT('/partners/' + c.id, v); cl(); toast('Saved'); reload();
  } }] });
  const mail = $('#mail');
  if (mail && c.email) mail.onclick = () => modal({ title: `Email ${c.name} <${c.email}>`, size: 'lg', body: formHtml([{ key: 'subject', label: 'Subject', required: true, span: 2 }, { key: 'body', label: 'Message', type: 'textarea', rows: 8, span: 2 }], {
      body: `Dear ${c.contact_person || c.name},\n\n\n\nKind regards,\n${state.user.name}\n${state.company.name || ''}${s.balance > 0 ? `\n\nAccount balance: ${money(s.balance)}` : ''}` }),
    actions: [{ label: 'Cancel' }, { label: 'Send', cls: 'btn-primary', onClick: async (cl, r) => { await POST(`/crm/customers/${c.id}/email`, readForm(r, [{ key: 'subject', label: 'Subject', required: true }, { key: 'body' }])); cl(); toast('Email sent'); reload(); } }] });
  const recv = $('#recv');
  if (recv) recv.onclick = async () => {
    const methods = (await GET('/payment-methods')).filter(m => m.kind !== 'account');
    const f = [{ key: 'amount', label: 'Amount', type: 'number', default: s.balance }, { key: 'method_id', label: 'Method', type: 'select', numeric: true, options: methods.map(m => ({ value: m.id, label: m.name })) }, { key: 'reference', label: 'Reference' }];
    modal({ title: `Payment from ${c.name}`, size: 'sm', body: formHtml(f), actions: [{ label: 'Cancel' }, { label: 'Record', cls: 'btn-primary', onClick: async (cl, r) => { await POST('/customer-payments', { ...readForm(r, f), partner_id: c.id }); cl(); toast('Payment recorded'); reload(); } }] });
  };
}

const kpi = (label, value, hint = '') => `<div class="kpi"><div class="label">${label}</div><div class="value" style="font-size:20px">${value}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;

async function showOrder(id) {
  try {
    const { receiptHtml } = await import('./pos.js');
    const o = await GET('/pos/orders/' + id);
    modal({ title: o.number || 'Order #' + o.id, size: 'lg', body: '<iframe id="rc" style="width:100%;height:460px;border:1px solid var(--line);border-radius:8px"></iframe>',
      onOpen: r => { const f = r.querySelector('#rc'); f.contentDocument.open(); f.contentDocument.write(receiptHtml(o)); f.contentDocument.close(); },
      actions: [{ label: 'Close' }, { label: '🖨 Print', cls: 'btn-primary', onClick: () => printHtml(receiptHtml(o)) }] });
  } catch (e) { err(e); }
}
