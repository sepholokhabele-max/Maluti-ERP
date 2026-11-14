// Governance: the organogram (units, positions, reporting lines, acting appointments) and the delegation of authority (DoA)
// that decides who approves what in every module.
//
// How an approval is worked out for a document of a given type and amount:
//   1. Start from the requester's position and walk UP the reporting line. The first position that holds an "approve"
//      authority for this document type with a limit covering the amount is the approver (most junior adequate manager).
//   2. If the requester has no position, or nobody in the line has enough authority, the most junior position anywhere
//      in the organisation with enough authority approves.
//   3. Positions with a "concur" authority (e.g. the Finance Manager must agree to all journals above M 10 000) must
//      agree first, junior to senior.
//   4. A step can be signed by the position holder, the person acting in the position, or anyone above it in the
//      reporting line (escalation). Nobody approves their own request. An administrator may sign only a vacant position.
// A document type with no authorities defined is not governed: the module's own permission rules apply.
const db = require('../db');
const { round2, bad, notFound, today } = require('../util');

const DOC_TYPES = {
  purchase_order: { name: 'Purchase orders', amount: true, perm: 'purchase.approve' },
  expense_claim: { name: 'Expense claims', amount: true, perm: 'expenses.approve' },
  journal: { name: 'Manual journals', amount: true, perm: 'accounting' },
  payroll: { name: 'Payroll runs', amount: true, perm: 'payroll' },
  leave: { name: 'Leave requests (days)', amount: true, unit: 'days', perm: 'hrm' },
  procurement: { name: 'Approval to procure (tender / RFQ)', amount: true, perm: 'procurement.approve' },
  procurement_waiver: { name: 'Procurement waivers', amount: true, perm: 'procurement.approve' },
  procurement_award: { name: 'Contract awards', amount: true, perm: 'procurement.approve' },
  budget: { name: 'Budgets', amount: false, perm: 'accounting' },
  asset_disposal: { name: 'Asset disposals & write-offs (book value)', amount: true, perm: 'assets' },
  policy: { name: 'Policies', amount: false, perm: 'governance' },
  legal_document: { name: 'Contracts & legal documents', amount: true, perm: 'legal' }
};
const r2 = n => round2(Number(n) || 0);
const handlers = {}; // actions run when a request held by the engine itself is finally approved (e.g. an asset disposal)
const onApproved = (docType, fn) => { handlers[docType] = fn; };

/* ============================== organogram ============================== */
async function units() { return db.query('SELECT u.*, c.code cost_centre FROM org_units u LEFT JOIN cost_centres c ON c.id = u.cost_centre_id ORDER BY u.sort_order, u.name'); }
async function positions() {
  return db.query(`SELECT p.*, u.name unit_name, us.name holder_name, us.username holder_username, au.name acting_name, CONCAT(e.first_name, ' ', e.last_name) employee_name, r.title reports_to_title
    FROM positions p LEFT JOIN org_units u ON u.id = p.unit_id LEFT JOIN users us ON us.id = p.user_id LEFT JOIN users au ON au.id = p.acting_user_id
    LEFT JOIN employees e ON e.id = p.employee_id LEFT JOIN positions r ON r.id = p.reports_to_id WHERE p.active = 1 ORDER BY p.sort_order, p.title`);
}
async function saveUnit(b, id = null) {
  const v = { name: String(b.name || '').trim().slice(0, 120) }; if (!v.name) throw bad('Name the unit');
  v.code = b.code ? String(b.code).trim().toUpperCase().slice(0, 20) : null;
  v.kind = ['board', 'executive', 'division', 'department', 'section', 'unit', 'committee'].includes(b.kind) ? b.kind : 'department';
  v.parent_id = Number(b.parent_id) || null; v.cost_centre_id = Number(b.cost_centre_id) || null;
  for (const k of ['mandate']) if (b[k] !== undefined) v[k] = b[k] || null;
  if (b.communication_style !== undefined) v.communication_style = ['formal', 'consultative', 'collaborative', 'directive'].includes(b.communication_style) ? b.communication_style : 'consultative';
  for (const [k, n] of [['channels', 255], ['meeting_cadence', 120]]) if (b[k] !== undefined) v[k] = b[k] ? String(b[k]).slice(0, n) : null;
  if (b.escalation_days !== undefined) v.escalation_days = Math.max(1, Math.round(Number(b.escalation_days) || 3));
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  if (id && v.parent_id) { // no loops
    let p = v.parent_id; for (let i = 0; p && i < 50; i++) { if (p === id) throw bad('A unit cannot sit under itself'); const x = await db.one('SELECT parent_id FROM org_units WHERE id = ?', [p]); p = x && x.parent_id; }
  }
  if (id) await db.query('UPDATE org_units SET ? WHERE id = ?', [v, id]); else id = (await db.query('INSERT INTO org_units SET ?', [v])).insertId;
  return id;
}
async function savePosition(user, b, id = null) {
  const v = {};
  if (b.title !== undefined || !id) { v.title = String(b.title || '').trim().slice(0, 120); if (!v.title) throw bad('Give the position a title'); }
  for (const [k, n] of [['code', 30], ['grade', 20]]) if (b[k] !== undefined) v[k] = b[k] ? String(b[k]).slice(0, n) : null;
  for (const k of ['unit_id', 'reports_to_id', 'user_id', 'employee_id', 'acting_user_id']) if (b[k] !== undefined) v[k] = Number(b[k]) || null;
  if (b.acting_until !== undefined) v.acting_until = b.acting_until || null;
  for (const k of ['purpose', 'responsibilities']) if (b[k] !== undefined) v[k] = b[k] || null;
  if (b.communication_style !== undefined) v.communication_style = ['formal', 'consultative', 'collaborative', 'directive'].includes(b.communication_style) ? b.communication_style : null;
  if (b.is_head !== undefined) v.is_head = b.is_head ? 1 : 0;
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  if (v.acting_user_id && !v.acting_until && b.acting_until === undefined) throw bad('Give the date the acting appointment ends');
  if (id && v.reports_to_id) { let p = v.reports_to_id; for (let i = 0; p && i < 100; i++) { if (p === id) throw bad('A position cannot report to itself or to someone below it'); const x = await db.one('SELECT reports_to_id FROM positions WHERE id = ?', [p]); p = x && x.reports_to_id; } }
  if (v.user_id) { const other = await db.one('SELECT title FROM positions WHERE user_id = ? AND id <> ? AND active = 1', [v.user_id, id || 0]); if (other) throw bad(`That person already holds the position "${other.title}" – one substantive position per person (use an acting appointment for a second one)`); }
  if (v.acting_user_id && v.acting_user_id === (v.user_id ?? (id ? (await db.one('SELECT user_id FROM positions WHERE id = ?', [id])).user_id : null))) throw bad('The holder cannot also act in the same position');
  if (id) await db.query('UPDATE positions SET ? WHERE id = ?', [v, id]); else id = (await db.query('INSERT INTO positions SET ?', [v])).insertId;
  await db.query(`INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES (?, 'org.position', 'positions', ?, ?)`, [user.id, id, JSON.stringify(v)]);
  return id;
}
/** the reporting line upwards from a position: [position, its manager, …, the top] */
async function lineUp(positionId, all) {
  const map = all || new Map((await db.query('SELECT * FROM positions WHERE active = 1')).map(p => [p.id, p]));
  const out = []; let p = map.get(positionId);
  for (let i = 0; p && i < 100; i++) { out.push(p); p = p.reports_to_id ? map.get(p.reports_to_id) : null; }
  return out;
}
const actingOk = p => p.acting_user_id && (!p.acting_until || String(p.acting_until).slice(0, 10) >= today());
/** positions a user can act for today: their own, and any where they are acting */
async function positionsOf(userId) {
  if (!userId) return [];
  return db.query(`SELECT * FROM positions WHERE active = 1 AND (user_id = ? OR (acting_user_id = ? AND (acting_until IS NULL OR acting_until >= CURDATE())))`, [userId, userId]);
}
async function requesterPosition(userId, employeeId) {
  if (employeeId) { const p = await db.one('SELECT * FROM positions WHERE employee_id = ? AND active = 1', [employeeId]); if (p) return p; const e = await db.one('SELECT user_id FROM employees WHERE id = ?', [employeeId]); if (e && e.user_id) userId = e.user_id; }
  if (!userId) return null;
  return db.one('SELECT * FROM positions WHERE user_id = ? AND active = 1', [userId]);
}
/** org chart as a tree with holders */
async function chart() {
  const ps = await positions();
  const byParent = new Map(); for (const p of ps) { const k = p.reports_to_id || 0; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(p); }
  const build = (pid, depth) => (byParent.get(pid) || []).map(p => ({ ...p, level: depth, vacant: !p.user_id, acting: actingOk(p), children: build(p.id, depth + 1) }));
  return { tree: build(0, 1), positions: ps.length, vacant: ps.filter(p => !p.user_id).length, units: (await units()).length };
}

/* ============================== delegation of authority ============================== */
async function grants(docType) { return db.query(`SELECT g.*, p.title, p.reports_to_id FROM authority_grants g JOIN positions p ON p.id = g.position_id AND p.active = 1 ${docType ? 'WHERE g.doc_type = ?' : ''} ORDER BY g.doc_type, g.kind, COALESCE(g.max_amount, 9e15)`, docType ? [docType] : []); }
async function isGoverned(docType) { return !!(await db.one('SELECT 1 x FROM authority_grants g JOIN positions p ON p.id = g.position_id AND p.active = 1 WHERE g.doc_type = ? LIMIT 1', [docType])); }
/** save the DoA matrix: [{ position_id, doc_type, kind, max_amount, min_amount }] – empty max = no limit; remove = null */
async function saveGrants(user, rows) {
  await db.tx(async c => {
    for (const g of rows || []) {
      if (!DOC_TYPES[g.doc_type]) throw bad('Unknown document type');
      const kind = g.kind === 'concur' ? 'concur' : 'approve';
      if (g.remove) { await c.query('DELETE FROM authority_grants WHERE position_id = ? AND doc_type = ? AND kind = ?', [g.position_id, g.doc_type, kind]); continue; }
      const max = g.max_amount === '' || g.max_amount === null || g.max_amount === undefined ? null : r2(g.max_amount);
      if (max !== null && max < 0) throw bad('Limits cannot be negative');
      await c.query('INSERT INTO authority_grants (position_id, doc_type, kind, max_amount, min_amount) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE max_amount = VALUES(max_amount), min_amount = VALUES(min_amount)',
        [g.position_id, g.doc_type, kind, max, Math.max(0, r2(g.min_amount))]);
    }
    await c.query(`INSERT INTO audit_log (user_id, action, entity, details) VALUES (?, 'org.authority', 'authority_grants', ?)`, [user.id, JSON.stringify({ changes: (rows || []).length, doc_types: [...new Set((rows || []).map(g => g.doc_type))] })]);
  });
}
/** who must approve: [{ kind, position }] in order */
async function chain(docType, amount, reqPos) {
  const gs = await grants(docType); if (!gs.length) return null;
  const all = new Map((await db.query('SELECT * FROM positions WHERE active = 1')).map(p => [p.id, p]));
  const covers = g => g.max_amount === null || Number(g.max_amount) >= Number(amount);
  const approvers = gs.filter(g => g.kind === 'approve' && covers(g));
  if (!approvers.length) throw bad(`Nobody in the organogram may approve ${DOC_TYPES[docType].name.toLowerCase()} of ${Number(amount).toLocaleString('en-US')} – add a higher authority in Governance → Delegation of authority`);
  let final = null;
  if (reqPos) for (const p of (await lineUp(reqPos.id, all)).slice(1)) { if (approvers.some(g => g.position_id === p.id)) { final = p; break; } }
  if (!final) { // most junior adequate authority (lowest limit), never the requester
    const sorted = approvers.filter(g => !reqPos || g.position_id !== reqPos.id).sort((a, b) => (a.max_amount === null ? 9e15 : Number(a.max_amount)) - (b.max_amount === null ? 9e15 : Number(b.max_amount)));
    if (!sorted.length) throw bad('Only you hold the authority for this – someone above you must approve it; add them in the delegation of authority');
    final = all.get(sorted[0].position_id);
  }
  const depth = id => { let d = 0, p = all.get(id); while (p && p.reports_to_id && d < 100) { d++; p = all.get(p.reports_to_id); } return d; };
  const concur = gs.filter(g => g.kind === 'concur' && Number(amount) >= Number(g.min_amount) && g.position_id !== final.id && (!reqPos || g.position_id !== reqPos.id))
    .sort((a, b) => depth(b.position_id) - depth(a.position_id)).map(g => ({ kind: 'concur', position: all.get(g.position_id) }));
  return [...concur, { kind: 'approve', position: final }];
}
async function holderText(p) {
  if (!p) return '';
  const u = p.user_id ? await db.one('SELECT name FROM users WHERE id = ?', [p.user_id]) : null;
  const a = actingOk(p) ? await db.one('SELECT name FROM users WHERE id = ?', [p.acting_user_id]) : null;
  return `${p.title}${u ? ` (${u.name}${a ? `, acting: ${a.name}` : ''})` : a ? ` (acting: ${a.name})` : ' (vacant)'}`;
}
/** what-if: who would approve this */
async function simulate(docType, amount, requesterUserId) {
  if (!DOC_TYPES[docType]) throw bad('Unknown document type');
  const rp = await requesterPosition(requesterUserId);
  const ch = await chain(docType, amount, rp);
  if (!ch) return { governed: false, message: 'No authorities set for this document type – the module\'s own permissions apply' };
  return { governed: true, requester_position: rp ? rp.title : null, steps: await Promise.all(ch.map(async s => ({ kind: s.kind, position_id: s.position.id, approver: await holderText(s.position) }))) };
}

/* ============================== approval requests ============================== */
async function pending(c, docType, docId) { return c.one(`SELECT * FROM approval_requests WHERE doc_type = ? AND doc_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`, [docType, docId]); }
/** start an approval for a document (any earlier pending request for it is cancelled) */
async function request(c, { doc_type, doc_id, amount = 0, requester_id, employee_id, summary, link, payload }) {
  if (!(await isGoverned(doc_type))) return { governed: false };
  const rp = await requesterPosition(requester_id, employee_id);
  const ch = await chain(doc_type, amount, rp);
  await c.query(`UPDATE approval_requests SET status = 'cancelled', decided_at = NOW() WHERE doc_type = ? AND doc_id = ? AND status = 'pending'`, [doc_type, doc_id]);
  const id = (await c.query('INSERT INTO approval_requests (doc_type, doc_id, amount, requester_id, requester_position_id, summary, link, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [doc_type, doc_id, r2(amount), requester_id || null, rp ? rp.id : null, summary ? String(summary).slice(0, 255) : null, link || null, payload ? JSON.stringify(payload) : null])).insertId;
  for (const [i, s] of ch.entries()) await c.query('INSERT INTO approval_steps (request_id, step_no, kind, position_id) VALUES (?, ?, ?, ?)', [id, i + 1, s.kind, s.position.id]);
  return { governed: true, request_id: id, next: await holderText(ch[0].position) };
}
/** may this user sign this step? → 'holder' | 'acting' | 'higher' | 'admin' | null */
async function canSign(user, step, requesterId) {
  if (user.id === requesterId) return null;
  const all = new Map((await db.query('SELECT * FROM positions WHERE active = 1')).map(p => [p.id, p]));
  const p = all.get(step.position_id); if (!p) return null;
  if (p.user_id === user.id) return 'holder';
  if (actingOk(p) && p.acting_user_id === user.id) return 'acting';
  const mine = (await positionsOf(user.id)).map(x => x.id);
  if (step.kind === 'approve' && mine.length) { const line = await lineUp(p.id, all); if (line.slice(1).some(x => mine.includes(x.id))) return 'higher'; }
  if (user.permissions.includes('*') && !p.user_id && !actingOk(p)) return 'admin';
  return null;
}
/**
 * called by a module when someone approves a document. Not governed → { governed: false, final: true } and the module's
 * own checks apply. Governed → the user must be allowed to sign the current step; returns final: true when the last step is signed.
 */
async function authorize(c, user, { doc_type, doc_id, amount = 0, requester_id, employee_id, summary, link, note }) {
  if (!(await isGoverned(doc_type))) return { governed: false, final: true };
  let rq = await pending(c, doc_type, doc_id);
  if (!rq) { await request(c, { doc_type, doc_id, amount, requester_id, employee_id, summary, link }); rq = await pending(c, doc_type, doc_id); }
  const step = await c.one(`SELECT * FROM approval_steps WHERE request_id = ? AND status = 'pending' ORDER BY step_no LIMIT 1`, [rq.id]);
  if (!step) throw bad('Nothing left to approve');
  const via = await canSign(user, step, rq.requester_id);
  if (!via) {
    if (user.id === rq.requester_id) throw Object.assign(new Error('You cannot approve your own request'), { status: 403 });
    const p = await db.one('SELECT * FROM positions WHERE id = ?', [step.position_id]);
    throw Object.assign(new Error(`This must be ${step.kind === 'concur' ? 'agreed' : 'approved'} by ${await holderText(p)} – or someone above in that reporting line`), { status: 403 });
  }
  await c.query(`UPDATE approval_steps SET status = 'approved', decided_by = ?, decided_at = NOW(), via = ?, note = ? WHERE id = ?`, [user.id, via, note ? String(note).slice(0, 255) : null, step.id]);
  const next = await c.one(`SELECT * FROM approval_steps WHERE request_id = ? AND status = 'pending' ORDER BY step_no LIMIT 1`, [rq.id]);
  if (next) { const p = await db.one('SELECT * FROM positions WHERE id = ?', [next.position_id]); return { governed: true, final: false, request_id: rq.id, next: await holderText(p), message: `Approved at your level – now waiting for ${await holderText(p)}` }; }
  await c.query(`UPDATE approval_requests SET status = 'approved', decided_at = NOW() WHERE id = ?`, [rq.id]);
  return { governed: true, final: true, request_id: rq.id };
}
async function reject(c, user, { doc_type, doc_id, note }) {
  if (!(await isGoverned(doc_type))) return { governed: false };
  const rq = await pending(c, doc_type, doc_id); if (!rq) return { governed: true, none: true };
  const step = await c.one(`SELECT * FROM approval_steps WHERE request_id = ? AND status = 'pending' ORDER BY step_no LIMIT 1`, [rq.id]);
  const via = step && await canSign(user, step, rq.requester_id);
  if (!via) throw Object.assign(new Error('Only the person whose approval is waiting (or someone above them) can send this back'), { status: 403 });
  await c.query(`UPDATE approval_steps SET status = 'rejected', decided_by = ?, decided_at = NOW(), via = ?, note = ? WHERE id = ?`, [user.id, via, note ? String(note).slice(0, 255) : null, step.id]);
  await c.query(`UPDATE approval_requests SET status = 'rejected', decided_at = NOW() WHERE id = ?`, [rq.id]);
  return { governed: true, rejected: true };
}
/** for requests the engine holds itself (payload actions such as asset disposals) */
async function decide(user, id, b) {
  const rq = await db.one('SELECT * FROM approval_requests WHERE id = ?', [id]); if (!rq) throw notFound('Approval');
  if (rq.status !== 'pending') throw bad('Already decided');
  if (b.reject) { await db.tx(c => reject(c, user, { doc_type: rq.doc_type, doc_id: rq.doc_id, note: b.note })); return { rejected: true }; }
  if (!handlers[rq.doc_type]) throw bad('Approve this from the document itself');
  const out = await db.tx(c => authorize(c, user, { doc_type: rq.doc_type, doc_id: rq.doc_id, amount: rq.amount, requester_id: rq.requester_id, note: b.note }));
  if (out.final) { const payload = typeof rq.payload === 'string' ? JSON.parse(rq.payload) : rq.payload; out.result = await handlers[rq.doc_type](user, rq, payload); }
  return out;
}
const REQ_SQL = `SELECT r.*, u.name requester_name FROM approval_requests r LEFT JOIN users u ON u.id = r.requester_id`;
async function stepsOf(rq) {
  return db.query(`SELECT s.*, p.title position_title, h.name holder_name, d.name decided_by_name FROM approval_steps s JOIN positions p ON p.id = s.position_id LEFT JOIN users h ON h.id = p.user_id LEFT JOIN users d ON d.id = s.decided_by WHERE s.request_id = ? ORDER BY s.step_no`, [rq.id]);
}
/** what is waiting for this user (holder, acting, or above the waiting position – shown when overdue) */
async function inbox(user) {
  const rows = await db.query(`${REQ_SQL} WHERE r.status = 'pending' ORDER BY r.id`);
  const out = [];
  for (const r of rows) {
    const step = await db.one(`SELECT s.*, p.title, p.unit_id FROM approval_steps s JOIN positions p ON p.id = s.position_id WHERE s.request_id = ? AND s.status = 'pending' ORDER BY s.step_no LIMIT 1`, [r.id]);
    if (!step) continue;
    const via = await canSign(user, step, r.requester_id);
    if (!via) continue;
    const unit = step.unit_id ? await db.one('SELECT escalation_days FROM org_units WHERE id = ?', [step.unit_id]) : null;
    const waiting = Math.floor((Date.now() - new Date(String(r.created_at).replace(' ', 'T')).getTime()) / 864e5);
    const overdue = waiting >= (unit ? Number(unit.escalation_days) : 3);
    if (via === 'higher' && !overdue) continue; // seniors see it only once it is overdue (escalation)
    out.push({ ...r, step_kind: step.kind, waiting_for: step.title, via, days_waiting: waiting, overdue, doc_name: (DOC_TYPES[r.doc_type] || {}).name, steps: await stepsOf(r) });
  }
  return out;
}
async function history(q = {}) {
  const rows = await db.query(`${REQ_SQL} ${q.doc_type ? 'WHERE r.doc_type = ? AND r.doc_id = ?' : ''} ORDER BY r.id DESC LIMIT 300`, q.doc_type ? [q.doc_type, q.doc_id] : []);
  for (const r of rows) r.steps = await stepsOf(r);
  return rows;
}
/** everything a person may approve, by document type and limit */
async function authorityOf(userId) {
  const ps = await positionsOf(userId); if (!ps.length) return { positions: [], authority: [] };
  const gs = (await grants()).filter(g => ps.some(p => p.id === g.position_id));
  return { positions: ps.map(p => ({ id: p.id, title: p.title, acting: p.user_id !== userId })), authority: gs.map(g => ({ doc_type: g.doc_type, name: DOC_TYPES[g.doc_type].name, kind: g.kind, max_amount: g.max_amount === null ? null : Number(g.max_amount), min_amount: Number(g.min_amount), position: g.title })) };
}

/* ============================== decision rights & communication ============================== */
const decisions = () => db.query(`SELECT d.*, a.title decides_title, b.title recommends_title FROM decision_rights d LEFT JOIN positions a ON a.id = d.decides_position_id LEFT JOIN positions b ON b.id = d.recommends_position_id ORDER BY d.category, d.sort_order, d.id`);
async function saveDecision(b, id = null) {
  const v = { decision: String(b.decision || '').trim().slice(0, 200) }; if (!v.decision) throw bad('Describe the decision');
  v.category = b.category ? String(b.category).slice(0, 60) : null; v.decides_position_id = Number(b.decides_position_id) || null; v.recommends_position_id = Number(b.recommends_position_id) || null;
  for (const k of ['consulted', 'informed']) v[k] = Array.isArray(b[k]) ? b[k].map(Number).filter(Boolean).join(',') : (b[k] || null);
  v.notes = b.notes ? String(b.notes).slice(0, 255) : null;
  if (!v.decides_position_id) throw bad('Choose who decides');
  if (b.remove && id) { await db.query('DELETE FROM decision_rights WHERE id = ?', [id]); return id; }
  if (id) await db.query('UPDATE decision_rights SET ? WHERE id = ?', [v, id]); else id = (await db.query('INSERT INTO decision_rights SET ?', [v])).insertId;
  return id;
}
/** for one position: who they report to, who reports to them, peers, how to communicate, and the escalation path */
async function commsFor(positionId) {
  const all = new Map((await db.query('SELECT p.*, u.name holder FROM positions p LEFT JOIN users u ON u.id = p.user_id WHERE p.active = 1')).map(p => [p.id, p]));
  const p = all.get(Number(positionId)); if (!p) throw notFound('Position');
  const unit = p.unit_id ? await db.one('SELECT * FROM org_units WHERE id = ?', [p.unit_id]) : null;
  const line = await lineUp(p.id, all);
  const S = x => x ? { id: x.id, title: x.title, holder: x.holder || null } : null;
  const decides = (await decisions()).filter(d => d.decides_position_id === p.id || d.recommends_position_id === p.id || String(d.consulted || '').split(',').includes(String(p.id)) || String(d.informed || '').split(',').includes(String(p.id)))
    .map(d => ({ decision: d.decision, role: d.decides_position_id === p.id ? 'decides' : d.recommends_position_id === p.id ? 'recommends' : String(d.consulted || '').split(',').includes(String(p.id)) ? 'consulted' : 'informed' }));
  return { position: S(p), unit: unit ? { name: unit.name, style: unit.communication_style, channels: unit.channels, meetings: unit.meeting_cadence, escalation_days: unit.escalation_days } : null,
    style: p.communication_style || (unit && unit.communication_style) || 'consultative', reports_to: S(all.get(p.reports_to_id)),
    direct_reports: [...all.values()].filter(x => x.reports_to_id === p.id).map(S), peers: p.reports_to_id ? [...all.values()].filter(x => x.reports_to_id === p.reports_to_id && x.id !== p.id).map(S) : [],
    escalation: line.slice(1).map(S), decisions: decides, authority: (await grants()).filter(g => g.position_id === p.id).map(g => ({ name: DOC_TYPES[g.doc_type].name, kind: g.kind, max_amount: g.max_amount === null ? null : Number(g.max_amount), min_amount: Number(g.min_amount) })) };
}

/* ============================== a ready-made structure ============================== */
/** a typical structure to start from, with a typical DoA (amounts in Maloti – edit to the board-approved DoA) */
async function seedStructure(user, kind = 'standard') {
  if ((await db.one('SELECT COUNT(*) n FROM positions')).n > 0) throw bad('The organogram already has positions');
  const U = async (name, k, parent, extra = {}) => saveUnit({ name, kind: k, parent_id: parent, ...extra });
  const board = await U('Board of Directors', 'board', null, { communication_style: 'formal', meeting_cadence: 'Quarterly board meetings', channels: 'Board papers, minutes', escalation_days: 14 });
  const exec = await U('Executive Office', 'executive', board, { communication_style: 'formal', meeting_cadence: 'Weekly management meeting', channels: 'Memos, email, management meeting', escalation_days: 5 });
  const fin = await U('Finance', 'department', exec, { channels: 'Email, finance system', meeting_cadence: 'Weekly finance meeting', escalation_days: 3 });
  const ops = await U(kind === 'water' ? 'Operations & Technical Services' : 'Operations', 'department', exec, { communication_style: 'directive', channels: 'Daily briefing, radio / phone, job cards', meeting_cadence: 'Daily toolbox talk', escalation_days: 2 });
  const hr = await U('Human Resources & Administration', 'department', exec, { channels: 'Email, notice board', meeting_cadence: 'Fortnightly', escalation_days: 3 });
  const proc = await U('Procurement', 'section', fin, { communication_style: 'formal', channels: 'Written requests, email', escalation_days: 3 });
  const com = await U(kind === 'water' ? 'Customer Services & Billing' : 'Sales & Customer Service', 'department', exec, { communication_style: 'collaborative', channels: 'Email, WhatsApp group, team huddle', meeting_cadence: 'Weekly team meeting', escalation_days: 2 });
  const ia = await U('Internal Audit', 'unit', board, { communication_style: 'formal', channels: 'Audit reports, audit committee', meeting_cadence: 'Quarterly audit committee', escalation_days: 10, mandate: 'Independent assurance; reports functionally to the Audit Committee of the Board and administratively to the Chief Executive.' });
  const P = async (title, unit, reports, extra = {}) => savePosition(user, { title, unit_id: unit, reports_to_id: reports, ...extra });
  const chair = await P('Board Chairperson', board, null, { is_head: 1, purpose: 'Leads the Board; holds the Chief Executive to account.' });
  const ceo = await P(kind === 'water' ? 'Managing Director' : 'Chief Executive Officer', exec, chair, { is_head: 1, purpose: 'Runs the organisation within the strategy, budget and authority delegated by the Board.' });
  const cfo = await P('Finance Manager', fin, ceo, { is_head: 1, purpose: 'Financial management, reporting, treasury, tax and internal financial control.' });
  const acc = await P('Accountant', fin, cfo, { purpose: 'Day-to-day accounting, reconciliations and month-end close.' });
  const po = await P('Procurement Officer', proc, cfo, { purpose: 'Runs procurement within the procurement policy and thresholds.' });
  const om = await P(kind === 'water' ? 'Technical Services Manager' : 'Operations Manager', ops, ceo, { is_head: 1, purpose: 'Delivers operations safely, on budget and to standard.' });
  const sup = await P(kind === 'water' ? 'Networks Supervisor' : 'Operations Supervisor', ops, om, { purpose: 'Supervises field teams and jobs.' });
  const hrm = await P('HR & Administration Manager', hr, ceo, { is_head: 1, purpose: 'People, payroll inputs, employee relations and administration.' });
  const cs = await P(kind === 'water' ? 'Customer Services & Billing Manager' : 'Sales & Customer Service Manager', com, ceo, { is_head: 1, purpose: 'Customers, billing, collections and service standards.' });
  const cao = await P('Chief Internal Auditor', ia, chair, { is_head: 1, purpose: 'Independent, objective assurance and advice to the Board on risk, control and governance.' });
  // a typical delegation of authority (edit to your board-approved DoA)
  const G = [];
  const add = (pos, doc, max, kind2 = 'approve', min = 0) => G.push({ position_id: pos, doc_type: doc, kind: kind2, max_amount: max, min_amount: min });
  for (const [pos, lim] of [[sup, 5000], [om, 50000], [cs, 50000], [hrm, 50000], [cfo, 250000], [ceo, 1000000], [chair, null]]) add(pos, 'purchase_order', lim);
  for (const [pos, lim] of [[sup, 1000], [om, 10000], [cs, 10000], [hrm, 10000], [cfo, 25000], [ceo, null]]) add(pos, 'expense_claim', lim);
  add(cfo, 'journal', 100000); add(ceo, 'journal', null); add(cfo, 'journal', null, 'concur', 50000);
  add(hrm, 'payroll', null, 'concur'); add(cfo, 'payroll', null, 'concur'); add(ceo, 'payroll', null);
  for (const [pos, lim] of [[sup, 5], [om, 15], [cs, 15], [hrm, 30], [cfo, 15], [ceo, null], [chair, null]]) add(pos, 'leave', lim);
  add(cfo, 'procurement', 500000); add(ceo, 'procurement', 5000000); add(chair, 'procurement', null);
  add(ceo, 'procurement_waiver', 500000); add(chair, 'procurement_waiver', null); add(cfo, 'procurement_waiver', null, 'concur');
  add(ceo, 'procurement_award', 5000000); add(chair, 'procurement_award', null); add(cfo, 'procurement_award', null, 'concur');
  add(ceo, 'budget', null, 'concur'); add(chair, 'budget', null);
  add(cfo, 'asset_disposal', 20000); add(ceo, 'asset_disposal', 200000); add(chair, 'asset_disposal', null);
  add(ceo, 'policy', null); add(ceo, 'legal_document', 1000000); add(chair, 'legal_document', null);
  await saveGrants(user, G);
  const D = [['Approve the strategic plan and annual budget', 'Strategy', chair, ceo, [cfo], [om, hrm, cs]], ['Appoint and dismiss the Chief Executive', 'People', chair, null, [], [hrm]],
    ['Appoint managers', 'People', ceo, hrm, [cfo], [chair]], ['Appoint staff below manager level', 'People', hrm, om, [], [ceo]], ['Set prices and tariffs (within regulator approval)', 'Commercial', ceo, cs, [cfo], [chair]],
    ['Write off bad debts', 'Finance', cfo, cs, [], [ceo]], ['Open or close bank accounts', 'Finance', chair, cfo, [ceo], []], ['Approve the annual internal audit plan', 'Governance', chair, cao, [ceo], []],
    ['Start legal proceedings', 'Legal', ceo, cfo, [hrm], [chair]], ['Take disciplinary action (dismissal)', 'People', ceo, hrm, [om], []]];
  for (const [d, c, by, rec, cons, inf] of D) await saveDecision({ decision: d, category: c, decides_position_id: by, recommends_position_id: rec, consulted: cons, informed: inf });
  void acc; void po;
  return { units: (await db.one('SELECT COUNT(*) n FROM org_units')).n, positions: (await db.one('SELECT COUNT(*) n FROM positions')).n, authorities: G.length, decisions: D.length };
}

/* ============================== wiring into the modules ============================== */
/**
 * route middleware for an approval endpoint: when the document type is governed by the organogram anyone may call it
 * (authorize() then decides whether this person may sign); otherwise the module's own permission applies.
 */
const gate = (docType, perm) => async (req, res, next) => {
  try { if (await isGoverned(docType)) return next(); } catch (e) { return next(e); }
  const { requirePerm } = require('../auth');
  return requirePerm(perm || DOC_TYPES[docType].perm)(req, res, next);
};
/** the request waiting for a document, with its steps (for showing "waiting for …" on a document) */
async function statusOf(docType, docId) {
  const rq = await db.one(`${REQ_SQL} WHERE r.doc_type = ? AND r.doc_id = ? ORDER BY r.id DESC LIMIT 1`, [docType, docId]);
  if (!rq) return null;
  rq.steps = await stepsOf(rq);
  const w = rq.status === 'pending' ? rq.steps.find(s => s.status === 'pending') : null;
  rq.waiting_for = w ? `${w.position_title}${w.holder_name ? ` (${w.holder_name})` : ' (vacant)'}` : null;
  return rq;
}

module.exports = { gate, statusOf, DOC_TYPES, onApproved, units, positions, saveUnit, savePosition, chart, lineUp, positionsOf, requesterPosition, grants, isGoverned, saveGrants, chain, simulate,
  request, authorize, reject, decide, inbox, history, authorityOf, decisions, saveDecision, commsFor, seedStructure, holderText };
