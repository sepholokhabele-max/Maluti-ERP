// Policies: standard editable templates per department, drafts and versions, approval through the delegation of authority,
// publication and read-and-acknowledge tracking. Also the small document editor used by Legal.
import { state, GET, POST, PUT, esc, $, $$, toast, err, can, modal, confirmBox, promptBox, formHtml, readForm, tableHtml, badge, page, d, dt, query } from './core.js';
import { toWord, toPdf } from './reportexport.js';
import { approvalStrip } from './govapprove.js';

const PS = { draft: ['draft', 'draft'], in_review: ['waiting for approval', 'partial'], approved: ['in force', 'ok'], retired: ['retired', 'cancelled'] };
const pBadge = s => badge((PS[s] || [s])[0], (PS[s] || [s, ''])[1]);
const editPol = () => can('governance') || can('hrm');

/** a simple word-processor area: bold, italic, headings, lists, undo; content stays HTML (sanitised on the server) */
export function editorHtml(id, html, editable) {
  const B = (cmd, label, arg = '') => `<button class="btn btn-sm" type="button" data-cmd="${cmd}" data-arg="${arg}" title="${esc(label)}">${label}</button>`;
  return `${editable ? `<div class="doc-tools no-print" data-for="${id}">${B('bold', '<b>B</b>')}${B('italic', '<i>I</i>')}${B('underline', '<u>U</u>')}${B('formatBlock', 'H1', 'H1')}${B('formatBlock', 'H2', 'H2')}${B('formatBlock', '¶', 'P')}${B('insertUnorderedList', '• list')}${B('insertOrderedList', '1. list')}${B('removeFormat', 'clear')}${B('undo', '↶')}${B('redo', '↷')}
    <span class="muted" style="align-self:center;margin-left:8px">Yellow <mark>[marks]</mark> are details still to fill in.</span></div>` : ''}
    <div class="doc-paper" id="${id}" ${editable ? 'contenteditable="true"' : ''}>${html || ''}</div>`;
}
export function wireEditor(root) {
  $$('.doc-tools [data-cmd]', root).forEach(b => {
    b.onmousedown = e => e.preventDefault();
    b.onclick = () => { const html = b.innerHTML; document.execCommand(b.dataset.cmd, false, b.dataset.arg ? `<${b.dataset.arg}>` : null); void html; };
  });
}
const marks = el => el.querySelectorAll('mark').length;

export async function policies(view, args) {
  if (args && args[0]) return policy(view, Number(args[0]));
  const tab = query().tab || 'all';
  const [rows, unread] = await Promise.all([GET('/policies'), GET('/policies/unread')]);
  const tabs = [['all', 'All policies'], ['read', `To read (${unread.length})`], ...(editPol() ? [['templates', 'Templates']] : [])];
  view.innerHTML = page('Policies', editPol() ? '<button class="btn btn-primary" id="np">＋ Policy from a template</button>' : '', `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/policies?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="pb"></div>`);
  if ($('#np')) $('#np').onclick = () => newPolicy(id => { location.hash = '#/policies/' + id; });
  const pb = $('#pb');
  if (tab === 'read') {
    pb.innerHTML = `<div class="card">${tableHtml([{ key: 'title', label: 'Policy' }, { key: 'department', label: 'Department' }, { key: 'id', label: '', html: 1, fmt: v => `<a class="btn btn-sm btn-primary" href="#/policies/${v}">Read</a>` }], unread, { empty: 'You have read and acknowledged every policy in force 👍' })}</div>`;
    return;
  }
  if (tab === 'templates') {
    const T = await GET('/policies/templates'), have = new Set(rows.map(p => p.template_key));
    pb.innerHTML = `${!rows.length ? `<div class="card"><h3>Adopt a starter set</h3><p>Create a draft of every standard policy below at once; then edit, approve and publish them one by one.</p><button class="btn btn-primary" id="seed">Create all drafts</button></div>` : ''}
      <div class="cols cols-2">${T.map(dp => `<div class="card"><h3>${esc(dp.name)}</h3><ul>${dp.items.map(i => `<li style="margin:4px 0">${esc(i.title)} ${have.has(i.key) ? badge('adopted', 'ok') : `<button class="btn btn-sm" data-t="${esc(i.key)}">Use</button>`}</li>`).join('')}</ul></div>`).join('')}</div>
      <p class="muted">The templates are written for Lesotho businesses and refer to the laws in force when they were written (for example the Labour Act, 2024). Have them checked by a Lesotho legal practitioner, and fill in the yellow marks with your own figures.</p>`;
    if ($('#seed')) $('#seed').onclick = async () => { try { const x = await POST('/policies/seed', {}); toast(`${x.created} draft policies created`); policies(view, []); } catch (e) { err(e); } };
    $$('[data-t]', pb).forEach(b => b.onclick = async () => { try { const x = await POST('/policies', { template_key: b.dataset.t }); location.hash = '#/policies/' + x.id; } catch (e) { err(e); } });
    return;
  }
  const deps = [...new Set(rows.map(p => p.department || 'General'))];
  pb.innerHTML = rows.length ? deps.map(dp => `<div class="card"><h3>${esc(dp)}</h3>${tableHtml([{ key: 'code', label: 'No.' }, { key: 'title', label: 'Policy' }, { key: 'owner_title', label: 'Owner' }, { key: 'current_version', label: 'Version', fmt: v => v ? 'v' + v : '' },
    { key: 'effective_date', label: 'In force from', fmt: d }, { key: 'next_review', label: 'Review by', fmt: d }, { key: 'status', label: 'Status', html: 1, fmt: (v, p) => pBadge(v) + (p.draft_version && p.current_version ? ' ' + badge('revision drafted', 'partial') : '') },
    { key: 'acked', label: 'Me', html: 1, fmt: (v, p) => p.status === 'approved' && p.requires_ack !== 'none' ? (v ? '✓ read' : badge('to read', 'partial')) : '' }, { key: 'acks', label: 'Read by', right: 1 }],
    rows.filter(p => (p.department || 'General') === dp), { rowAttr: p => `data-p="${p.id}" style="cursor:pointer"` })}</div>`).join('')
    : `<div class="empty">No policies yet.${editPol() ? ' Start from the Templates tab – there are standard policies for governance, finance, procurement, HR, IT, operations and customer service.' : ''}</div>`;
  $$('[data-p]', pb).forEach(tr => tr.onclick = () => { location.hash = '#/policies/' + tr.dataset.p; });
}
async function newPolicy(done) {
  const [T, ps] = await Promise.all([GET('/policies/templates'), GET('/gov/positions').catch(() => [])]);
  const f = [{ key: 'template_key', label: 'Template', type: 'select', options: [{ value: '', label: '– blank policy –' }, ...T.flatMap(dp => dp.items.map(i => ({ value: i.key, label: `${dp.name}: ${i.title}` })))] },
    { key: 'title', label: 'Title (blank = the template\'s)' }, { key: 'owner_position_id', label: 'Policy owner', type: 'select', options: [{ value: '', label: '–' }, ...ps.map(p => ({ value: p.id, label: p.title }))] },
    { key: 'review_months', label: 'Review every (months)', type: 'number', default: 12 }, { key: 'requires_ack', label: 'Staff must read and acknowledge', type: 'select', options: [{ value: 'all', label: 'Everyone' }, { value: 'none', label: 'No' }] }];
  modal({ title: 'New policy', body: formHtml(f, {}), actions: [{ label: 'Cancel' }, { label: 'Create draft', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); if (!v.template_key && !v.title) throw new Error('Choose a template or give a title'); const x = await POST('/policies', v); c(); done(x.id); } }] });
}
async function policy(view, id) {
  const p = await GET('/policies/' + id);
  const editing = editPol() && p.draft !== null && p.status !== 'in_review';
  const showDraft = p.draft !== null && (editPol() || !p.content);
  const acts = [];
  if (editing) acts.push('<button class="btn" id="sv">Save draft</button>', '<button class="btn btn-primary" id="sub">Send for approval</button>');
  if (editPol() && p.draft === null && p.status !== 'in_review') acts.push('<button class="btn" id="rev">Start a revision</button>');
  if (p.status === 'in_review') acts.push('<button class="btn" id="back">Send back</button>', '<button class="btn btn-ok" id="ap">Approve & publish</button>');
  if (p.status === 'approved' && p.requires_ack !== 'none' && !p.acked) acts.push('<button class="btn btn-primary" id="ack">I have read and understood this policy</button>');
  acts.push('<button class="btn btn-sm" id="pdf">🖨 PDF</button> <button class="btn btn-sm" id="doc">⬇ Word</button>');
  if (can('governance') && p.status === 'approved') acts.push('<button class="btn btn-sm btn-danger" id="ret">Retire</button>');
  view.innerHTML = page(`${p.code || ''} ${p.title}`, acts.join(' '), `
    <div class="row" style="margin-bottom:10px;gap:10px;flex-wrap:wrap">${pBadge(p.status)}<span class="muted">${esc(p.department || '')}${p.owner_title ? ' · owner: ' + esc(p.owner_title) : ''}${p.current_version ? ` · v${p.current_version} in force from ${d(p.effective_date)}` : ''}${p.next_review ? ' · review by ' + d(p.next_review) : ''}</span></div>
    ${p.status === 'in_review' ? await approvalStrip('policy', id) : ''}
    ${showDraft && p.content ? '<p class="muted">Showing the revised draft. The version in force stays until the revision is approved.</p>' : ''}
    ${editorHtml('pd', showDraft ? p.draft : p.content, editing)}
    <div class="cols cols-2" style="margin-top:14px"><div class="card"><h3>Versions</h3>${tableHtml([{ key: 'version', label: 'v' }, { key: 'change_note', label: 'Change' }, { key: 'created_by_name', label: 'By' }, { key: 'approved_by_name', label: 'Approved by' }, { key: 'effective_date', label: 'In force from', fmt: d }], p.versions)}</div>
    ${p.ack_list ? `<div class="card"><h3>Read and acknowledged (${p.ack_list.length})</h3>${tableHtml([{ key: 'name', label: 'Person' }, { key: 'acked_at', label: 'When', fmt: dt }], p.ack_list, { empty: 'Nobody yet.' })}${p.not_acked && p.not_acked.length && editPol() ? `<p class="muted">Not yet: ${p.not_acked.map(u => esc(u.name)).join(', ')}</p>` : ''}</div>` : ''}</div>`, { back: '#/policies' });
  wireEditor(view);
  const body = () => $('#pd').innerHTML;
  const on = (sel, f) => { const b = $(sel); if (b) b.onclick = async () => { try { await f(); } catch (e) { err(e); } }; };
  on('#sv', async () => { await PUT('/policies/' + id, { content: body() }); toast('Draft saved'); });
  on('#sub', async () => { if (marks($('#pd')) && !(await confirmBox(`${marks($('#pd'))} yellow mark(s) are still not filled in. Send for approval anyway?`))) return; await PUT('/policies/' + id, { content: body() }); const x = await POST(`/policies/${id}/submit`); toast(x.message, 'ok', 6000); policy(view, id); });
  on('#rev', async () => { await PUT('/policies/' + id, { content: p.content, change_note: 'Revision' }); policy(view, id); });
  on('#ap', async () => { const x = await POST(`/policies/${id}/approve`, {}); toast(x.message || 'Approved – the policy is now in force', 'ok', 6000); policy(view, id); });
  on('#back', async () => { const note = await promptBox('What must change?'); if (note === null) return; await POST(`/policies/${id}/approve`, { reject: true, note }); policy(view, id); });
  on('#ack', async () => { await POST(`/policies/${id}/ack`); toast('Thank you – recorded'); policy(view, id); });
  on('#ret', async () => { if (await confirmBox('Retire this policy? It stays on record but is no longer in force.', { danger: true })) { await POST(`/policies/${id}/retire`); policy(view, id); } });
  on('#pdf', () => toPdf(body(), p.title, { bare: true }));
  on('#doc', () => toWord(body(), p.title, { bare: true }));
}
