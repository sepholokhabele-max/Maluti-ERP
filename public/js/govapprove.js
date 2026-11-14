// The approvals inbox for everything the organogram routes to a person, from any module. Approving calls the module's own
// endpoint (so its checks and postings run); the delegation of authority decides whether this person may sign.
import { GET, POST, esc, $$, toast, err, money, promptBox, tableHtml, badge, d } from './core.js';

const A = {
  purchase_order: { open: id => `#/purchase/${id}`, ok: id => POST(`/purchases/${id}/approve`, {}), no: (id, n) => POST(`/purchases/${id}/reject`, { reason: n }) },
  expense_claim: { open: () => '#/claims?tab=approve', ok: id => POST(`/expense-claims/${id}/approve`, {}), no: (id, n) => POST(`/expense-claims/${id}/reject`, { reason: n }) },
  journal: { open: () => '#/finance?tab=journals', ok: id => POST(`/finance/journals/${id}/approve`, {}), no: (id, n) => POST(`/finance/journals/${id}/approve`, { reject: true, note: n }) },
  payroll: { open: id => `#/payrun/${id}`, ok: id => POST(`/hrm/payroll/${id}/approve`, {}) },
  leave: { open: () => '#/hrm?tab=leave', ok: id => POST(`/hrm/leave/${id}/approve`, {}), no: (id, n) => POST(`/hrm/leave/${id}/reject`, { reason: n }) },
  procurement: { open: id => `#/tender/${id}`, ok: id => POST(`/tenders/${id}/approve`, {}), no: (id, n) => POST(`/tenders/${id}/approve`, { reject: true, note: n }) },
  procurement_waiver: { open: id => `#/tender/${id}`, ok: id => POST(`/tenders/${id}/approve`, {}), no: (id, n) => POST(`/tenders/${id}/approve`, { reject: true, note: n }) },
  procurement_award: { open: id => `#/tender/${id}`, ok: id => POST(`/tenders/${id}/award`, {}), no: (id, n) => POST(`/tenders/${id}/award`, { reject: true, note: n }) },
  budget: { open: () => '#/finance?tab=budgets', ok: id => POST(`/finance/budgets/${id}/approve`, {}), no: (id, n) => POST(`/finance/budgets/${id}/approve`, { reject: true, note: n }) },
  asset_disposal: { open: id => `#/asset/${id}` },
  policy: { open: id => `#/policies/${id}`, ok: id => POST(`/policies/${id}/approve`, {}), no: (id, n) => POST(`/policies/${id}/approve`, { reject: true, note: n }) },
  legal_document: { open: id => `#/legal/${id}`, ok: id => POST(`/legal/documents/${id}/approve`, {}), no: (id, n) => POST(`/legal/documents/${id}/reject`, { note: n }) }
};
const VIA = { holder: '', acting: 'acting', higher: 'escalated to you', admin: 'vacant post' };
const amt = r => r.doc_type === 'leave' ? `${Number(r.amount)} day(s)` : Number(r.amount) ? money(r.amount) : '';
const trail = r => (r.steps || []).map(s => `<span title="${esc(s.position_title)}${s.decided_by_name ? ' – ' + esc(s.decided_by_name) : ''}" class="badge badge-${s.status === 'approved' ? 'ok' : s.status === 'rejected' ? 'cancelled' : 'draft'}">${s.kind === 'concur' ? 'agree' : 'approve'}: ${esc(s.position_title)}${s.status === 'approved' ? ' ✓' : s.status === 'rejected' ? ' ✗' : ''}</span>`).join(' → ');

export function inboxHtml(rows, empty = 'Nothing waiting for your approval 👍') {
  return tableHtml([{ key: 'doc_name', label: 'What' }, { key: 'summary', label: 'Details' }, { key: 'requester_name', label: 'From' }, { key: 'amount', label: 'Amount', right: 1, fmt: (v, r) => amt(r) },
    { key: 'steps', label: 'Approval path', html: 1, fmt: (v, r) => trail(r) },
    { key: 'days_waiting', label: 'Waiting', html: 1, fmt: (v, r) => `${v} day(s)${r.overdue ? ' ' + badge('overdue', 'cancelled') : ''}${VIA[r.via] ? `<br><small class="muted">${esc(VIA[r.via])}</small>` : ''}` },
    { key: 'id', label: '', html: 1, fmt: (v, r) => `<span class="row" style="gap:4px;flex-wrap:nowrap"><a class="btn btn-sm" href="${esc((A[r.doc_type] || {}).open ? A[r.doc_type].open(r.doc_id) : r.link || '#/')}">Open</a>
      <button class="btn btn-sm btn-ok" data-gok="${v}">${r.step_kind === 'concur' ? 'Agree' : 'Approve'}</button><button class="btn btn-sm" data-gno="${v}">Send back</button></span>` }], rows, { empty });
}
export function wireInbox(root, rows, reload) {
  const R = id => rows.find(x => x.id === Number(id));
  $$('[data-gok]', root).forEach(b => b.onclick = async () => {
    const r = R(b.dataset.gok), a = A[r.doc_type] || {};
    b.disabled = true;
    try {
      const x = a.ok ? await a.ok(r.doc_id) : await POST(`/gov/requests/${r.id}/decide`, {});
      toast(x && x.message ? x.message : r.step_kind === 'concur' ? 'Agreed – passed on' : 'Approved', 'ok', 5000); reload();
    } catch (e) {
      if (r.doc_type === 'leave' && /Approve anyway/.test(e.message)) { try { await POST(`/hrm/leave/${r.doc_id}/approve`, { allow_negative: true }); toast('Approved'); reload(); } catch (e2) { err(e2); } }
      else err(e);
    } finally { b.disabled = false; }
  });
  $$('[data-gno]', root).forEach(b => b.onclick = async () => {
    const r = R(b.dataset.gno), a = A[r.doc_type] || {};
    const note = await promptBox('Why is it sent back?', { label: 'Reason (the requester sees this)' }); if (note === null) return;
    try { if (a.no) await a.no(r.doc_id, note); else await POST(`/gov/requests/${r.id}/decide`, { reject: true, note }); toast('Sent back'); reload(); } catch (e) { err(e); }
  });
}
/** "waiting for …" line for a document page */
export async function approvalStrip(docType, docId) {
  const s = await GET(`/gov/status/${docType}/${docId}`).catch(() => null);
  if (!s) return '';
  return `<div class="card" style="margin-bottom:10px"><b>Approval</b> ${badge(s.status, s.status === 'approved' ? 'ok' : s.status === 'rejected' ? 'cancelled' : 'draft')} ${trail(s)}${s.waiting_for ? ` <span class="muted">· waiting for ${esc(s.waiting_for)} since ${esc(d(s.created_at))}</span>` : ''}</div>`;
}
export { trail };
