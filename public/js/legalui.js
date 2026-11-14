// Legal: Lesotho document templates filled from S-ERP (employees, customers / suppliers, tenders, water accounts), the
// document editor with Word / PDF export, approval through the delegation of authority, the contract register with
// renewal and expiry alerts, and the compliance (statutory obligations) register.
import { GET, POST, PUT, esc, $, $$, toast, err, can, money, modal, confirmBox, promptBox, formHtml, readForm, tableHtml, badge, page, d, today, query, debounce } from './core.js';
import { toWord, toPdf, exportButtons, wireExport } from './reportexport.js';
import { approvalStrip } from './govapprove.js';
import { editorHtml, wireEditor } from './policiesui.js';

const DS = { draft: ['draft', 'draft'], in_review: ['waiting for approval', 'partial'], approved: ['approved – to sign', 'posted'], signed: ['signed', 'ok'], expired: ['expired', 'cancelled'], terminated: ['terminated', 'cancelled'] };
const dBadge = s => badge((DS[s] || [s])[0], (DS[s] || [s, ''])[1]);
const SRC = { employee: 'Employee', partner: 'Customer / supplier', tender: 'Procurement (award)', water_account: 'Water account' };
const left = v => v === null || v === undefined ? '' : Number(v) < 0 ? `<b class="neg">${-v} days ago</b>` : Number(v) <= 30 ? `<b style="color:var(--warn)">${v} days</b>` : `${v} days`;
const editL = () => can('legal') || can('hrm');

export async function legal(view, args) {
  if (args && args[0]) return legalDoc(view, Number(args[0]));
  const tab = query().tab || 'documents';
  const tabs = [['documents', 'Documents'], ['contracts', 'Contract register'], ['compliance', 'Compliance register'], ['templates', 'Templates']];
  view.innerHTML = page('Legal', editL() ? '<button class="btn btn-primary" id="nd">＋ New document</button>' : '', `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/legal?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="lb"></div>`);
  if ($('#nd')) $('#nd').onclick = () => newDocument({}, id => { location.hash = '#/legal/' + id; });
  const T = { documents, contracts, compliance, templates };
  await (T[tab] || documents)($('#lb'), () => legal(view, []));
}
async function documents(lb) {
  const rows = await GET('/legal/documents');
  lb.innerHTML = `<div class="card">${tableHtml([{ key: 'number', label: 'No.' }, { key: 'title', label: 'Document' }, { key: 'category', label: 'Type' }, { key: 'partner_name', label: 'Other party', fmt: (v, x) => v || x.employee_name || '' },
    { key: 'value', label: 'Value', right: 1, fmt: v => v ? money(v) : '' }, { key: 'updated_at', label: 'Changed', fmt: d }, { key: 'status', label: 'Status', html: 1, fmt: dBadge }], rows,
    { rowAttr: x => `data-d="${x.id}" style="cursor:pointer"`, empty: 'No documents yet – start from a template.' })}</div>`;
  $$('[data-d]', lb).forEach(tr => tr.onclick = () => { location.hash = '#/legal/' + tr.dataset.d; });
}
async function contracts(lb) {
  const all = await GET('/legal/documents'), rows = all.filter(x => ['signed', 'approved', 'expired', 'terminated'].includes(x.status) && (x.end_date || x.value));
  const al = await GET('/legal/alerts');
  lb.innerHTML = `${al.contracts.length ? `<div class="card" style="border-left:4px solid var(--warn)"><h3>Renew or end soon (${al.contracts.length})</h3>${tableHtml([{ key: 'number', label: 'No.' }, { key: 'title', label: 'Contract' }, { key: 'end_date', label: 'Ends', fmt: d }, { key: 'days_left', label: 'Left', html: 1, fmt: left }], al.contracts)}</div>` : ''}
    <div class="row no-print" style="margin-bottom:10px"><span class="spacer"></span>${exportButtons('xp')}</div>
    <div class="card" id="rep"><h3>Contract register</h3>${tableHtml([{ key: 'number', label: 'No.' }, { key: 'title', label: 'Contract' }, { key: 'partner_name', label: 'Other party', fmt: (v, x) => v || x.employee_name || '' }, { key: 'value', label: 'Value', right: 1, fmt: v => v ? money(v) : '' },
      { key: 'start_date', label: 'From', fmt: d }, { key: 'end_date', label: 'To', fmt: d }, { key: 'days_left', label: 'Left', html: 1, fmt: (v, x) => x.status === 'signed' ? left(v) : '' }, { key: 'auto_renew', label: 'Auto-renews', fmt: v => Number(v) ? 'yes' : '' },
      { key: 'owner_title', label: 'Owner' }, { key: 'status', label: 'Status', html: 1, fmt: dBadge }], rows, { rowAttr: x => `data-d="${x.id}" style="cursor:pointer"`, empty: 'No signed contracts yet.' })}</div>`;
  wireExport('xp', '#rep', 'Contract register');
  $$('[data-d]', lb).forEach(tr => tr.onclick = () => { location.hash = '#/legal/' + tr.dataset.d; });
}
async function compliance(lb, reload) {
  const rows = await GET('/legal/obligations');
  lb.innerHTML = `<div class="row no-print" style="margin-bottom:10px"><span class="muted">Statutory filings, renewals and reviews with their next due dates. Tax returns are also tracked in the Tax centre.</span><span class="spacer"></span>${exportButtons('xp')}
      ${can('legal') ? `${!rows.length ? '<button class="btn" id="seed">Load the standard Lesotho list</button>' : ''} <button class="btn btn-primary" id="no">＋ Obligation</button>` : ''}</div>
    <div class="card" id="rep">${tableHtml([{ key: 'title', label: 'Obligation' }, { key: 'law', label: 'Law' }, { key: 'authority', label: 'Authority' }, { key: 'frequency', label: 'How often' }, { key: 'owner_title', label: 'Owner' },
      { key: 'next_due', label: 'Next due', fmt: d }, { key: 'days_left', label: 'Left', html: 1, fmt: left }, { key: 'last_done', label: 'Last done', fmt: d },
      { key: 'id', label: '', html: 1, fmt: v => can('legal') ? `<button class="btn btn-sm btn-ok" data-done="${v}">Done</button> <button class="btn btn-sm" data-e="${v}">Edit</button>` : '' }], rows, { empty: 'Nothing recorded yet.' })}</div>`;
  wireExport('xp', '#rep', 'Compliance register');
  if (!can('legal')) return;
  const ps = await GET('/gov/positions').catch(() => []);
  const f = [{ key: 'title', label: 'Obligation', required: true, span: 2 }, { key: 'law', label: 'Law' }, { key: 'authority', label: 'Authority' },
    { key: 'frequency', label: 'How often', type: 'select', options: ['once', 'monthly', 'quarterly', 'yearly'].map(v => ({ value: v, label: v })) }, { key: 'next_due', label: 'Next due', type: 'date' },
    { key: 'owner_position_id', label: 'Owner', type: 'select', options: [{ value: '', label: '–' }, ...ps.map(p => ({ value: p.id, label: p.title }))] }, { key: 'notes', label: 'Notes' }];
  const dlg = o => modal({ title: o ? 'Obligation' : 'New obligation', wide: true, body: formHtml(f, o ? { ...o, next_due: d(o.next_due) } : { frequency: 'yearly' }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => {
    const v = readForm(r, f); v.owner_position_id = Number(v.owner_position_id) || null; if (o) await PUT('/legal/obligations/' + o.id, v); else await POST('/legal/obligations', v); c(); reload(); } }] });
  $('#no').onclick = () => dlg(null);
  if ($('#seed')) $('#seed').onclick = async () => { try { const x = await POST('/legal/obligations/seed'); toast(`${x.created} obligations added – set the due dates that apply to you`); reload(); } catch (e) { err(e); } };
  $$('[data-e]', lb).forEach(b => b.onclick = () => dlg(rows.find(o => o.id === Number(b.dataset.e))));
  $$('[data-done]', lb).forEach(b => b.onclick = async () => { try { const x = await POST(`/legal/obligations/${b.dataset.done}/done`, { date: today() }); toast(x.next_due ? `Done – next due ${x.next_due}` : 'Done'); reload(); } catch (e) { err(e); } });
}
async function templates(lb) {
  const T = await GET('/legal/templates');
  const cats = [...new Set(T.map(t => t.category))];
  lb.innerHTML = `<p class="muted">Templates written for the Kingdom of Lesotho (Labour Act, 2024; Companies Act, 2011; Data Protection Act; Public Procurement Act, 2023; Land Act, 2010 and others). They fill in your company details and the other party from S-ERP; yellow marks show what is still to complete. <b>Have every document reviewed by a Lesotho legal practitioner before signing.</b></p>
    <div class="cols cols-3">${cats.map(c => `<div class="card"><h3>${esc(c)}</h3>${T.filter(t => t.category === c).map(t => `<p style="margin:6px 0"><button class="btn btn-sm" data-t="${esc(t.key)}">Use</button> ${esc(t.name)}${t.source ? ` <small class="muted">from ${esc(SRC[t.source].toLowerCase())}</small>` : ''}</p>`).join('')}</div>`).join('')}</div>`;
  $$('[data-t]', lb).forEach(b => b.onclick = () => newDocument({ template_key: b.dataset.t }, id => { location.hash = '#/legal/' + id; }));
}

/** a "Legal document" button for another page; main.js opens the dialog for any [data-legal] button */
export const docButton = (template, entityId) => `<button class="btn" data-legal="${esc(template)}|${Number(entityId)}">📄 Legal document</button>`;
/** start a document; ctx can preset the template and the record it is for (used by "Generate document" buttons elsewhere) */
export async function newDocument(ctx = {}, done) {
  const T = await GET('/legal/templates');
  const opts = T.map(t => ({ value: t.key, label: `${t.category}: ${t.name}` }));
  const f = [{ key: 'template_key', label: 'Template', type: 'select', options: opts }, { key: 'title', label: 'Title (blank = automatic)' },
    { key: 'value', label: 'Contract value (M)', type: 'number', step: '0.01', nullable: true }, { key: 'start_date', label: 'Starts', type: 'date' }, { key: 'end_date', label: 'Ends', type: 'date' }, { key: 'renewal_notice_days', label: 'Remind me this many days before it ends', type: 'number', default: 60 }];
  modal({ title: 'New legal document', wide: true, body: `${formHtml(f, ctx)}<div id="srcw" style="margin-top:10px"></div>`, onOpen: r => {
    const showSrc = () => {
      const t = T.find(x => x.key === r.querySelector('[name=template_key]').value);
      const w = r.querySelector('#srcw');
      if (!t || !t.source) { w.innerHTML = ''; return; }
      w.innerHTML = `<label class="field"><span>${esc(SRC[t.source])}</span><input id="sq" placeholder="Type to search…" autocomplete="off"></label><select id="sid" size="5" style="width:100%"></select>`;
      const load = async () => { const xs = await GET(`/legal/sources?source=${t.source}&q=${encodeURIComponent(w.querySelector('#sq').value)}`); w.querySelector('#sid').innerHTML = xs.map(x => `<option value="${x.id}" ${Number(ctx.entity_id) === x.id ? 'selected' : ''}>${esc(x.name)}${x.extra ? ' – ' + esc(x.extra) : ''}</option>`).join(''); if (!w.querySelector('#sid').value && xs[0] && xs.length === 1) w.querySelector('#sid').value = xs[0].id; };
      w.querySelector('#sq').oninput = debounce(load, 250); load();
    };
    r.querySelector('[name=template_key]').onchange = showSrc; showSrc();
  }, actions: [{ label: 'Cancel' }, { label: 'Draft the document', cls: 'btn-primary', onClick: async (c, r) => {
    const v = readForm(r, f); const t = T.find(x => x.key === v.template_key); const sid = r.querySelector('#sid');
    if (t.source && !(sid && sid.value) && !ctx.entity_id) throw new Error(`Choose the ${SRC[t.source].toLowerCase()} first`);
    const x = await POST('/legal/documents', { ...v, entity_id: sid && sid.value ? Number(sid.value) : ctx.entity_id || null }); c(); done(x.id); } }] });
}

async function legalDoc(view, id) {
  const x = await GET('/legal/documents/' + id);
  const editable = editL() && x.status === 'draft';
  const acts = [];
  if (editable) acts.push('<button class="btn" id="sv">Save</button>', '<button class="btn btn-primary" id="sub">Send for approval</button>');
  if (x.status === 'in_review') acts.push('<button class="btn" id="back">Send back</button>', '<button class="btn btn-ok" id="ap">Approve</button>');
  if (editL() && x.status === 'approved') acts.push('<button class="btn btn-primary" id="sg">Mark signed</button>');
  if (editL() && ['signed', 'expired'].includes(x.status) && x.end_date) acts.push('<button class="btn" id="rn">Renew</button>');
  if (editL() && x.status === 'signed') acts.push('<button class="btn btn-danger" id="tm">Terminate</button>');
  if (editL()) acts.push('<button class="btn btn-sm" id="cp">Copy</button>');
  acts.push('<button class="btn btn-sm" id="pdf">🖨 PDF</button> <button class="btn btn-sm" id="doc">⬇ Word</button>');
  const ps = editL() ? await GET('/gov/positions').catch(() => []) : [];
  const f = [{ key: 'value', label: 'Value (M)', type: 'number', step: '0.01', nullable: true }, { key: 'start_date', label: 'Starts', type: 'date' }, { key: 'end_date', label: 'Ends', type: 'date' },
    { key: 'renewal_notice_days', label: 'Remind days before end', type: 'number' }, { key: 'auto_renew', label: 'Renews automatically', type: 'checkbox' },
    { key: 'owner_position_id', label: 'Owner', type: 'select', options: [{ value: '', label: '–' }, ...ps.map(p => ({ value: p.id, label: p.title }))] }, { key: 'notes', label: 'Notes', span: 2 }];
  view.innerHTML = page(`${x.number} ${x.title}`, acts.join(' '), `
    <div class="row" style="margin-bottom:10px;gap:10px;flex-wrap:wrap">${dBadge(x.status)}<span class="muted">${esc(x.category || '')}${x.partner_name ? ' · ' + esc(x.partner_name) : ''}${x.employee_name ? ' · ' + esc(x.employee_name) : ''}${x.value ? ' · ' + money(x.value) : ''}${x.end_date ? ` · ends ${d(x.end_date)}` : ''}${x.signed_date ? ` · signed ${d(x.signed_date)}` : ''}</span></div>
    ${x.approval ? await approvalStrip('legal_document', id) : ''}
    ${editL() ? `<details class="card no-print" style="margin-bottom:10px" ${editable ? 'open' : ''}><summary><b>Register details</b> (value, dates, owner)</summary>${formHtml(f, { ...x, start_date: d(x.start_date), end_date: d(x.end_date) })}<button class="btn btn-sm" id="svm" style="margin-top:8px">Save details</button></details>` : ''}
    ${editorHtml('ld', x.content, editable)}`, { back: '#/legal' });
  wireEditor(view);
  const body = () => $('#ld').innerHTML;
  const on = (sel, fn) => { const b = $(sel); if (b) b.onclick = async () => { try { await fn(); } catch (e) { err(e); } }; };
  const meta = () => { const v = readForm(view, f); v.owner_position_id = Number(v.owner_position_id) || null; return v; };
  on('#svm', async () => { await PUT('/legal/documents/' + id, meta()); toast('Saved'); legalDoc(view, id); });
  on('#sv', async () => { await PUT('/legal/documents/' + id, { content: body(), ...meta() }); toast('Saved'); });
  on('#sub', async () => { const m = $('#ld').querySelectorAll('mark').length; if (m && !(await confirmBox(`${m} yellow mark(s) are still not filled in. Send for approval anyway?`))) return;
    await PUT('/legal/documents/' + id, { content: body(), ...meta() }); const r = await POST(`/legal/documents/${id}/submit`); toast(r.message, 'ok', 6000); legalDoc(view, id); });
  on('#ap', async () => { const r = await POST(`/legal/documents/${id}/approve`, {}); toast(r.message || 'Approved – print it for signing', 'ok', 6000); legalDoc(view, id); });
  on('#back', async () => { const note = await promptBox('What must change?'); if (note === null) return; await POST(`/legal/documents/${id}/reject`, { note }); legalDoc(view, id); });
  on('#sg', async () => { const dt = await promptBox('Date signed by all parties', { type: 'date', value: today() }); if (!dt) return; await POST(`/legal/documents/${id}/sign`, { date: dt }); toast('Recorded as signed – keep the signed copy under Files'); legalDoc(view, id); });
  on('#rn', async () => { const to = await promptBox('New end date', { type: 'date' }); if (!to) return; await POST(`/legal/documents/${id}/renew`, { end_date: to }); legalDoc(view, id); });
  on('#tm', async () => { const why = await promptBox('Why is it terminated (and from when)?'); if (!why) return; await POST(`/legal/documents/${id}/terminate`, { note: why }); legalDoc(view, id); });
  on('#cp', async () => { const r = await POST(`/legal/documents/${id}/copy`); location.hash = '#/legal/' + r.id; });
  on('#pdf', () => toPdf(body(), x.title, { bare: true }));
  on('#doc', () => toWord(body(), x.title, { bare: true }));
}
