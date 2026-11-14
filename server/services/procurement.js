// e-Procurement: supplier register, procurement cases (open tender, restricted tender, RFQ, waiver / direct procurement),
// online sealed bids, clarifications, bid opening, committee evaluation, preference scorecards (nationality, gender,
// youth, disability, SMME), award approval with standstill and challenges, contract (purchase order) and supplier rating.
//
// Life of a case:  draft → submitted → approved (approval to procure / waiver approved) → published (invitations or public
// notice; bids come in sealed) → closed (closing time passed – automatic) → opened (opening register, ≥2 committee members)
// → evaluated (scores) → recommended → awarded (approved by someone else; standstill starts) [→ challenged → …] → contracted.
// A waiver skips publishing: once approved, the officer enters the named supplier's quotation and recommends it.
const crypto = require('crypto');
const db = require('../db');
const { round2, bad, notFound, pad, today } = require('../util');

const METHODS = { open: 'Open tender', restricted: 'Restricted tender', rfq: 'Request for quotations', waiver: 'Waiver (direct procurement)' };
const PREFIX = { open: 'OT', restricted: 'RT', rfq: 'RQ', waiver: 'DP' };
const WAIVER_REASONS = { single_source: 'Only one supplier can provide it', emergency: 'Emergency', proprietary: 'Proprietary / compatible with existing equipment',
  continuity: 'Continuation of existing work', below_threshold: 'Below the competition threshold', other: 'Other (explain)' };
const gov = () => require('./governance');
/** which delegation of authority applies to an approval to procure */
const approvalType = t => t.method === 'waiver' ? 'procurement_waiver' : 'procurement';
const DEFAULTS = {
  rfq_max: 1000000,           // above this, an RFQ is not allowed – use a tender (or an approved waiver)
  min_rfq_suppliers: 3, min_restricted_suppliers: 3, min_opening_members: 2,
  standstill_days: 10, standstill_methods: ['open', 'restricted', 'rfq'],
  segregation: true,          // approver ≠ creator, award approver ≠ recommender
  price_formula: 'ratio',     // ratio: lowest ÷ price × points;  ppfa: (1 − (price − lowest) ÷ lowest) × points
  majority_pct: 51,           // "citizen-owned" / "women-owned" / "youth-owned" means at least this % ownership
  pref: { citizen: 50, women: 25, youth: 15, disability: 5, smme: 5 } // how the preference points are shared
};
const r2 = n => round2(Number(n) || 0);
const now = () => new Date();

async function settings() { const s = (await db.getSetting('procurement', {})) || {}; return { ...DEFAULTS, ...s, pref: { ...DEFAULTS.pref, ...(s.pref || {}) } }; }
async function saveSettings(b) {
  const s = await settings(), n = { ...s };
  for (const k of ['rfq_max', 'min_rfq_suppliers', 'min_restricted_suppliers', 'min_opening_members', 'standstill_days', 'majority_pct']) if (b[k] !== undefined) n[k] = Math.max(0, Number(b[k]) || 0);
  if (b.segregation !== undefined) n.segregation = !!b.segregation;
  if (b.price_formula !== undefined) n.price_formula = b.price_formula === 'ppfa' ? 'ppfa' : 'ratio';
  if (Array.isArray(b.standstill_methods)) n.standstill_methods = b.standstill_methods.filter(m => METHODS[m]);
  if (b.pref) for (const k of Object.keys(DEFAULTS.pref)) if (b.pref[k] !== undefined) n.pref[k] = Math.max(0, Number(b.pref[k]) || 0);
  if (!Object.values(n.pref).some(v => v > 0)) throw bad('Give at least one preference group some weight');
  n.min_opening_members = Math.max(1, n.min_opening_members);
  await db.setSetting('procurement', n);
  return n;
}
async function event(c, tenderId, { user, partner, action, details }) {
  await c.query('INSERT INTO tender_events (tender_id, user_id, partner_id, action, details) VALUES (?, ?, ?, ?, ?)', [tenderId, user ? user.id : null, partner || null, action, details ? String(details).slice(0, 500) : null]);
}
const can = (user, p) => !!user && (user.permissions.includes('*') || user.permissions.includes(p));

/* ============================== suppliers ============================== */
const PROFILE_SQL = `SELECT p.id, p.name, p.phone, p.email, p.address, p.tax_number, p.active, sp.*, p.id partner_id,
    (sp.tax_clearance_expiry IS NOT NULL AND sp.tax_clearance_expiry < CURDATE()) tax_expired,
    (sp.trader_licence_expiry IS NOT NULL AND sp.trader_licence_expiry < CURDATE()) licence_expired
  FROM partners p LEFT JOIN supplier_profiles sp ON sp.partner_id = p.id`;
/** share (0–1) of the preference points a supplier earns from its ownership */
function prefRatio(sp, cfg) {
  if (!sp) return 0;
  const w = cfg.pref, tot = Object.values(w).reduce((a, b) => a + Number(b), 0) || 1;
  const got = w.citizen * Number(sp.citizen_pct || 0) / 100 + w.women * Number(sp.women_pct || 0) / 100 + w.youth * Number(sp.youth_pct || 0) / 100
    + w.disability * (sp.disabled_owned ? 1 : 0) + w.smme * (['micro', 'small'].includes(sp.size) ? 1 : 0);
  return Math.min(1, got / tot);
}
const tags = (sp, cfg) => sp ? {
  citizen_owned: Number(sp.citizen_pct) >= cfg.majority_pct, women_owned: Number(sp.women_pct) >= cfg.majority_pct,
  youth_owned: Number(sp.youth_pct) >= cfg.majority_pct, disabled_owned: !!sp.disabled_owned, smme: ['micro', 'small'].includes(sp.size)
} : {};
async function suppliers(q = {}) {
  const cfg = await settings();
  const where = ['p.is_supplier = 1'], args = [];
  if (q.q) { where.push('(p.name LIKE ? OR sp.reg_no LIKE ? OR sp.categories LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
  if (q.status) { where.push('COALESCE(sp.status, \'pending\') = ?'); args.push(q.status); }
  const rows = await db.query(`${PROFILE_SQL} WHERE ${where.join(' AND ')} ORDER BY p.name LIMIT 2000`, args);
  return rows.map(r => ({ ...r, status: r.status || 'pending', ...tags(r, cfg), pref_pct: Math.round(prefRatio(r, cfg) * 1000) / 10 }));
}
async function supplier(id) {
  const cfg = await settings();
  const r = await db.one(`${PROFILE_SQL} WHERE p.id = ?`, [id]); if (!r) throw notFound('Supplier');
  r.status = r.status || 'pending'; Object.assign(r, tags(r, cfg)); r.pref_pct = Math.round(prefRatio(r, cfg) * 1000) / 10;
  r.history = await db.query(`SELECT t.id, t.number, t.title, t.method, t.status, b.total, b.rank_no, b.status bid_status, (t.awarded_to = b.partner_id) won
    FROM tender_bids b JOIN tenders t ON t.id = b.tender_id WHERE b.partner_id = ? ORDER BY t.id DESC LIMIT 100`, [id]);
  return r;
}
const pct = v => { const n = Number(v); if (v === '' || v === undefined || v === null) return 0; if (!(n >= 0 && n <= 100)) throw bad('Ownership percentages are between 0 and 100'); return r2(n); };
async function saveSupplier(user, b, id = null) {
  return db.tx(async c => {
    let pid = id;
    if (!pid) {
      const name = String(b.name || '').trim().slice(0, 160); if (!name) throw bad('Enter the supplier\'s name');
      pid = (await c.query('INSERT INTO partners (name, phone, email, address, tax_number, is_customer, is_supplier) VALUES (?, ?, ?, ?, ?, 0, 1)',
        [name, b.phone || null, b.email || null, b.address || null, b.tax_number || null])).insertId;
    } else {
      if (!await c.one('SELECT id FROM partners WHERE id = ?', [pid])) throw notFound('Supplier');
      const pv = {}; for (const k of ['name', 'phone', 'email', 'address', 'tax_number']) if (b[k] !== undefined) pv[k] = b[k] || null;
      pv.is_supplier = 1; await c.query('UPDATE partners SET ? WHERE id = ?', [pv, pid]);
    }
    const v = {};
    for (const k of ['reg_no', 'tax_clearance_no', 'trader_licence_no', 'country', 'district', 'categories', 'contact_person']) if (b[k] !== undefined) v[k] = b[k] ? String(b[k]).slice(0, k === 'categories' ? 255 : 80) : null;
    for (const k of ['tax_clearance_expiry', 'trader_licence_expiry']) if (b[k] !== undefined) v[k] = b[k] || null;
    for (const k of ['citizen_pct', 'women_pct', 'youth_pct']) if (b[k] !== undefined) v[k] = pct(b[k]);
    if (b.disabled_owned !== undefined) v.disabled_owned = b.disabled_owned ? 1 : 0;
    if (b.size !== undefined) v.size = ['micro', 'small', 'medium', 'large'].includes(b.size) ? b.size : 'small';
    const cur = await c.one('SELECT * FROM supplier_profiles WHERE partner_id = ?', [pid]);
    if (b.status !== undefined && user && can(user, 'procurement')) {
      v.status = ['pending', 'approved', 'suspended', 'debarred'].includes(b.status) ? b.status : 'pending';
      if (v.status === 'debarred') { if (!b.debar_reason) throw bad('Give the reason for debarring the supplier'); v.debar_reason = String(b.debar_reason).slice(0, 255); v.debar_until = b.debar_until || null; }
      if (v.status === 'approved' && (!cur || cur.status !== 'approved')) { v.verified_by = user.id; v.verified_at = now(); }
    }
    if (cur) { if (Object.keys(v).length) await c.query('UPDATE supplier_profiles SET ? WHERE partner_id = ?', [v, pid]); }
    else await c.query('INSERT INTO supplier_profiles SET ?', [{ ...v, partner_id: pid }]);
    return pid;
  });
}
/** a supplier that may take part: not debarred / suspended (a debarment with an end date lapses by itself) */
async function eligible(c, pid) {
  const sp = await c.one('SELECT p.name, sp.status, sp.debar_until FROM partners p LEFT JOIN supplier_profiles sp ON sp.partner_id = p.id WHERE p.id = ?', [pid]);
  if (!sp) throw bad('Unknown supplier');
  if (sp.status === 'debarred' && (!sp.debar_until || String(sp.debar_until) >= today())) throw bad(`${sp.name} is debarred and cannot take part`);
  if (sp.status === 'suspended') throw bad(`${sp.name} is suspended and cannot take part`);
  return sp;
}

/* ============================== cases ============================== */
const EDITABLE = ['draft', 'submitted', 'approved'];
async function autoClose(c, t) {
  if (t.status === 'published' && t.closing_at && new Date(String(t.closing_at).replace(' ', 'T') + 'Z') <= now()) {
    await c.query(`UPDATE tenders SET status = 'closed' WHERE id = ? AND status = 'published'`, [t.id]);
    await event(c, t.id, { action: 'closed', details: 'Closing time reached – no more bids' });
    t.status = 'closed';
  }
  return t;
}
async function closeDue() { // called from lists: tenders past closing time stop taking bids
  const due = await db.query(`SELECT * FROM tenders WHERE status = 'published' AND closing_at <= UTC_TIMESTAMP()`);
  for (const t of due) await db.tx(c => autoClose(c, t));
}
const sealedPhase = t => ['draft', 'submitted', 'approved', 'published', 'closed'].includes(t.status) && t.method !== 'waiver';

async function getTender(id, user) {
  const t = await db.one(`SELECT t.*, u.name created_by_name, a.name approved_by_name, w.name waiver_supplier, aw.name awarded_name, ap.name award_approved_by_name, rb.name recommended_by_name, po.number po_number, po.status po_status
    FROM tenders t LEFT JOIN users u ON u.id = t.created_by LEFT JOIN users a ON a.id = t.approved_by LEFT JOIN partners w ON w.id = t.waiver_supplier_id
    LEFT JOIN partners aw ON aw.id = t.awarded_to LEFT JOIN users ap ON ap.id = t.award_approved_by LEFT JOIN users rb ON rb.id = t.recommended_by LEFT JOIN purchase_orders po ON po.id = t.po_id WHERE t.id = ?`, [id]);
  if (!t) throw notFound('Procurement');
  await db.tx(c => autoClose(c, t));
  const cfg = await settings();
  t.lines = await db.query('SELECT * FROM tender_lines WHERE tender_id = ? ORDER BY id', [id]);
  t.criteria = await db.query('SELECT * FROM tender_criteria WHERE tender_id = ? ORDER BY kind, sort_order, id', [id]);
  t.committee = await db.query('SELECT c.*, u.name, u.role user_role FROM tender_committee c JOIN users u ON u.id = c.user_id WHERE c.tender_id = ? ORDER BY FIELD(c.role, \'chair\', \'secretary\', \'member\'), u.name', [id]);
  t.bidders = await db.query(`SELECT b.id, b.partner_id, b.status, b.invited_at, b.viewed_at, p.name, p.email, p.phone, COALESCE(sp.status, 'pending') supplier_status
    FROM tender_bidders b JOIN partners p ON p.id = b.partner_id LEFT JOIN supplier_profiles sp ON sp.partner_id = b.partner_id WHERE b.tender_id = ? ORDER BY p.name`, [id]);
  t.clarifications = await db.query('SELECT q.*, p.name partner_name, u.name answered_by_name FROM tender_clarifications q LEFT JOIN partners p ON p.id = q.partner_id LEFT JOIN users u ON u.id = q.answered_by WHERE q.tender_id = ? ORDER BY q.id', [id]);
  t.events = await db.query('SELECT e.*, u.name user_name, p.name partner_name FROM tender_events e LEFT JOIN users u ON u.id = e.user_id LEFT JOIN partners p ON p.id = e.partner_id WHERE e.tender_id = ? ORDER BY e.id DESC', [id]);
  const bids = await db.query(`SELECT b.*, p.name, sp.citizen_pct, sp.women_pct, sp.youth_pct, sp.disabled_owned, sp.size, sp.tax_clearance_expiry, sp.status supplier_status
    FROM tender_bids b JOIN partners p ON p.id = b.partner_id LEFT JOIN supplier_profiles sp ON sp.partner_id = b.partner_id WHERE b.tender_id = ? ORDER BY COALESCE(b.rank_no, 999), b.total`, [id]);
  t.sealed = sealedPhase(t);
  if (t.sealed) t.bids = bids.map(b => ({ id: b.id, partner_id: b.partner_id, name: b.name, submitted_at: b.submitted_at, status: b.status, seal: b.seal, sealed: true }));
  else {
    for (const b of bids) { b.lines = await db.query('SELECT * FROM tender_bid_lines WHERE bid_id = ?', [b.id]); Object.assign(b, tags(b, cfg)); b.pref_pct_potential = Math.round(prefRatio(b, cfg) * 1000) / 10; }
    t.bids = bids;
    const me = user && t.committee.find(m => m.user_id === user.id);
    t.scores = await db.query(`SELECT s.*, u.name user_name FROM tender_scores s JOIN tender_bids b ON b.id = s.bid_id JOIN users u ON u.id = s.user_id WHERE b.tender_id = ?`, [id]);
    t.my_scores = me ? t.scores.filter(s => s.user_id === user.id) : [];
  }
  t.me = user ? (t.committee.find(m => m.user_id === user.id) || null) : null;
  t.settings = { standstill_days: cfg.standstill_days, min_opening_members: cfg.min_opening_members, rfq_max: cfg.rfq_max, price_formula: cfg.price_formula };
  t.public_url = t.slug ? `/tenders/${t.slug}` : null;
  return t;
}

function cleanLines(lines) {
  const out = (Array.isArray(lines) ? lines : []).filter(l => l && String(l.description || '').trim()).map(l => ({
    description: String(l.description).trim().slice(0, 200), qty: Math.max(0.001, Number(l.qty) || 1), uom: l.uom ? String(l.uom).slice(0, 20) : null,
    est_unit: Math.max(0, r2(l.est_unit)), product_id: Number(l.product_id) || null }));
  if (!out.length) throw bad('Add at least one item, service or works package to buy');
  return out;
}
async function saveTender(user, b, id = null) {
  const cfg = await settings();
  return db.tx(async c => {
    const cur = id ? await c.one('SELECT * FROM tenders WHERE id = ? FOR UPDATE', [id]) : null;
    if (id && !cur) throw notFound('Procurement');
    if (cur && !EDITABLE.includes(cur.status)) throw bad('This procurement can no longer be changed – it has been published. Issue an addendum instead.');
    const v = {};
    v.title = String(b.title ?? (cur && cur.title) ?? '').trim().slice(0, 200); if (!v.title) throw bad('Give the procurement a title');
    v.description = b.description !== undefined ? b.description || null : cur ? cur.description : null;
    v.category = ['goods', 'works', 'services', 'consultancy'].includes(b.category) ? b.category : (cur ? cur.category : 'goods');
    v.method = METHODS[b.method] ? b.method : (cur ? cur.method : 'rfq');
    for (const k of ['budget_code', 'department']) v[k] = b[k] !== undefined ? (b[k] ? String(b[k]).slice(0, 80) : null) : cur ? cur[k] : null;
    v.closing_at = b.closing_at !== undefined ? (b.closing_at ? new Date(b.closing_at).toISOString().slice(0, 19).replace('T', ' ') : null) : cur ? cur.closing_at : null;
    for (const k of ['bid_validity_days']) v[k] = b[k] !== undefined ? Math.max(1, Math.round(Number(b[k]) || 90)) : cur ? cur[k] : 90;
    v.bid_security = b.bid_security !== undefined ? Math.max(0, r2(b.bid_security)) : cur ? cur.bid_security : 0;
    // evaluation weights: technical + price + preference = 100
    for (const k of ['tech_weight', 'price_weight', 'pref_weight', 'min_tech_pct']) v[k] = b[k] !== undefined && b[k] !== '' ? Math.max(0, r2(b[k])) : cur ? Number(cur[k]) : ({ tech_weight: 0, price_weight: 80, pref_weight: 20, min_tech_pct: 0 })[k];
    if (Math.abs(v.tech_weight + v.price_weight + v.pref_weight - 100) > 0.001) throw bad('Technical + price + preference points must add up to 100 (e.g. 0 / 80 / 20, or 70 / 20 / 10)');
    if (!(v.price_weight > 0)) throw bad('Price must carry some points');
    const lines = b.lines !== undefined ? cleanLines(b.lines) : null;
    v.estimated_value = r2(b.estimated_value) || (lines ? r2(lines.reduce((s, l) => s + l.qty * l.est_unit, 0)) : cur ? Number(cur.estimated_value) : 0);
    if (v.method === 'rfq' && v.estimated_value > cfg.rfq_max) throw bad(`Above M ${cfg.rfq_max.toLocaleString('en-US')} a request for quotations is not allowed – use an open or restricted tender, or a waiver with approval`);
    if (v.method === 'waiver') {
      v.waiver_reason = WAIVER_REASONS[b.waiver_reason] ? b.waiver_reason : cur ? cur.waiver_reason : null;
      v.waiver_justification = b.waiver_justification !== undefined ? String(b.waiver_justification || '').trim() : cur ? cur.waiver_justification : '';
      v.waiver_supplier_id = Number(b.waiver_supplier_id) || (cur ? cur.waiver_supplier_id : null);
      if (!v.waiver_reason) throw bad('Choose why competition is waived');
      if (String(v.waiver_justification || '').length < 30) throw bad('Explain in full (at least a few sentences) why this cannot be competed – the waiver register is audited');
      if (!v.waiver_supplier_id) throw bad('Choose the supplier the waiver is for');
      await eligible(c, v.waiver_supplier_id);
    } else { v.waiver_reason = null; v.waiver_justification = null; v.waiver_supplier_id = null; }
    let tid = id;
    if (cur) {
      // a change after approval needs a new approval
      if (cur.status === 'approved') { v.status = 'draft'; v.approved_by = null; v.approved_at = null; }
      await c.query('UPDATE tenders SET ? WHERE id = ?', [v, id]);
      await event(c, id, { user, action: 'edited', details: cur.status === 'approved' ? 'Changed after approval – needs approval again' : null });
    } else {
      v.created_by = user.id; v.status = 'draft';
      tid = (await c.query('INSERT INTO tenders SET ?', [v])).insertId;
      await c.query('UPDATE tenders SET number = ? WHERE id = ?', [`${PREFIX[v.method]}/${new Date().getFullYear()}/${pad(tid, 4)}`, tid]);
      await event(c, tid, { user, action: 'created', details: METHODS[v.method] });
    }
    if (lines) {
      await c.query('DELETE FROM tender_lines WHERE tender_id = ?', [tid]);
      for (const l of lines) await c.query('INSERT INTO tender_lines SET ?', [{ ...l, tender_id: tid }]);
    }
    if (b.criteria !== undefined) {
      await c.query('DELETE FROM tender_criteria WHERE tender_id = ?', [tid]);
      let i = 0;
      for (const k of (Array.isArray(b.criteria) ? b.criteria : [])) {
        const name = String(k.name || '').trim().slice(0, 160); if (!name) continue;
        const kind = k.kind === 'technical' ? 'technical' : 'mandatory';
        const mx = kind === 'technical' ? Math.max(0, r2(k.max_points)) : 1;
        if (kind === 'technical' && !(mx > 0)) throw bad(`Give "${name}" its maximum points`);
        await c.query('INSERT INTO tender_criteria (tender_id, kind, name, max_points, sort_order) VALUES (?, ?, ?, ?, ?)', [tid, kind, name, mx, i++]);
      }
    }
    if (v.tech_weight > 0 && !(await c.one(`SELECT id FROM tender_criteria WHERE tender_id = ? AND kind = 'technical' LIMIT 1`, [tid]))) throw bad('Technical points are given, so add the technical criteria they are scored on');
    if (b.committee !== undefined) await setCommittee(c, user, tid, b.committee);
    return tid;
  });
}
async function setCommittee(c, user, tid, list) {
  const t = await c.one('SELECT status, created_by FROM tenders WHERE id = ?', [tid]);
  if (['opened', 'evaluated', 'recommended', 'awarded', 'challenged', 'contracted', 'cancelled'].includes(t.status)) throw bad('The committee cannot change after the bids are opened');
  const keep = [];
  for (const m of (Array.isArray(list) ? list : [])) {
    const uid = Number(m.user_id); if (!uid || keep.includes(uid)) continue;
    if (!await c.one('SELECT id FROM users WHERE id = ? AND active = 1', [uid])) throw bad('Unknown user on the committee');
    const role = ['chair', 'member', 'secretary'].includes(m.role) ? m.role : 'member';
    await c.query('INSERT INTO tender_committee (tender_id, user_id, role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)', [tid, uid, role]);
    keep.push(uid);
  }
  if (keep.length) await c.query('DELETE FROM tender_committee WHERE tender_id = ? AND user_id NOT IN (?)', [tid, keep]);
  else await c.query('DELETE FROM tender_committee WHERE tender_id = ?', [tid]);
  if (keep.length && (await c.query(`SELECT id FROM tender_committee WHERE tender_id = ? AND role = 'chair'`, [tid])).length !== 1) throw bad('The committee needs exactly one chairperson');
}
async function lockT(c, id) { const t = await c.one('SELECT * FROM tenders WHERE id = ? FOR UPDATE', [id]); if (!t) throw notFound('Procurement'); return autoClose(c, t); }

async function submit(user, id) {
  return db.tx(async c => {
    const t = await lockT(c, id);
    if (t.status !== 'draft') throw bad('Only a draft can be sent for approval');
    if (!(await c.query('SELECT id FROM tender_lines WHERE tender_id = ?', [id])).length) throw bad('Add the items first');
    await c.query(`UPDATE tenders SET status = 'submitted' WHERE id = ?`, [id]);
    await event(c, id, { user, action: 'submitted', details: `Estimated M ${Number(t.estimated_value).toFixed(2)}` });
    const g = await gov().request(c, { doc_type: approvalType(t), doc_id: t.id, amount: Number(t.estimated_value), requester_id: user.id, summary: `${t.number}: ${t.title} – est. M ${Number(t.estimated_value).toFixed(2)}`, link: `#/tender/${t.id}` });
    return g.governed ? { message: `Sent to ${g.next} for approval` } : {};
  });
}
async function approve(user, id, b = {}) {
  const cfg = await settings();
  return db.tx(async c => {
    const t = await lockT(c, id);
    if (t.status !== 'submitted') throw bad('Only a procurement sent for approval can be approved');
    if (cfg.segregation && t.created_by === user.id) throw bad('Someone other than the person who prepared it must approve it (segregation of duties)');
    if (b.reject) {
      await gov().reject(c, user, { doc_type: approvalType(t), doc_id: t.id, note: b.note });
      await c.query(`UPDATE tenders SET status = 'draft' WHERE id = ?`, [id]);
      await event(c, id, { user, action: 'returned', details: b.note || 'Returned for changes' });
      return;
    }
    const g = await gov().authorize(c, user, { doc_type: approvalType(t), doc_id: t.id, amount: Number(t.estimated_value), requester_id: t.created_by, summary: `${t.number}: ${t.title}`, link: `#/tender/${t.id}`, note: b.note });
    if (!g.final) { await event(c, id, { user, action: 'concurred', details: b.note || g.message }); return { message: g.message }; }
    await c.query(`UPDATE tenders SET status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?`, [user.id, id]);
    await event(c, id, { user, action: t.method === 'waiver' ? 'waiver approved' : 'approved to procure', details: b.note || null });
    return {};
  });
}

/* ---- invitations, notice, portal links ---- */
const token = () => crypto.randomBytes(16).toString('hex');
async function addBidder(c, t, pid, status = 'invited') {
  await eligible(c, pid);
  const ex = await c.one('SELECT * FROM tender_bidders WHERE tender_id = ? AND partner_id = ?', [t.id, pid]);
  if (ex) return ex;
  const tk = token();
  await c.query('INSERT INTO tender_bidders (tender_id, partner_id, token, status) VALUES (?, ?, ?, ?)', [t.id, pid, tk, status]);
  return c.one('SELECT * FROM tender_bidders WHERE token = ?', [tk]);
}
async function mailInvite(t, bidder, baseUrl) {
  const p = await db.one('SELECT name, email FROM partners WHERE id = ?', [bidder.partner_id]);
  if (!p || !p.email || !baseUrl) return false;
  const co = (await db.getSetting('company', {})) || {};
  try {
    await require('./mailer').sendMail({ to: p.email, kind: 'procurement', subject: `${t.method === 'open' ? 'Tender' : 'Invitation to bid'}: ${t.number} – ${t.title}`,
      text: `Dear ${p.name},\n\n${co.name || 'We'} invite${co.name ? 's' : ''} you to bid for ${t.number} "${t.title}".\nClosing: ${t.closing_at} (UTC).\n\nRead the documents, ask questions and submit your sealed bid here:\n${baseUrl}/s/${bidder.token}\n\nThis link is for ${p.name} only – do not share it.\n` });
    return true;
  } catch (_) { return false; }
}
async function publish(user, id, b, baseUrl) {
  const cfg = await settings();
  const out = await db.tx(async c => {
    const t = await lockT(c, id);
    if (t.method === 'waiver') throw bad('A waiver is not published – enter the supplier\'s quotation');
    if (t.status !== 'approved') throw bad('It must be approved before it is published');
    if (!t.closing_at || new Date(String(t.closing_at).replace(' ', 'T') + 'Z') <= new Date(Date.now() + 3600e3)) throw bad('Set a closing date and time at least an hour from now');
    if (!(await c.query('SELECT id FROM tender_committee WHERE tender_id = ?', [id])).length) throw bad('Name the evaluation committee first');
    const ids = [...new Set((b.partner_ids || []).map(Number).filter(Boolean))];
    const need = t.method === 'rfq' ? cfg.min_rfq_suppliers : t.method === 'restricted' ? cfg.min_restricted_suppliers : 0;
    if (ids.length < need) throw bad(`Invite at least ${need} suppliers for a ${METHODS[t.method].toLowerCase()}`);
    const inv = [];
    for (const pid of ids) inv.push(await addBidder(c, t, pid));
    const slug = t.method === 'open' ? (t.slug || crypto.randomBytes(8).toString('hex')) : null;
    await c.query(`UPDATE tenders SET status = 'published', published_at = NOW(), slug = ? WHERE id = ?`, [slug, id]);
    await event(c, id, { user, action: 'published', details: `${inv.length} suppliers invited${slug ? ' · public notice' : ''} · closes ${t.closing_at} UTC` });
    return { t: { ...t, slug }, inv };
  });
  let mailed = 0; for (const x of out.inv) if (await mailInvite(out.t, x, baseUrl)) mailed++;
  return { invited: out.inv.length, mailed, slug: out.t.slug, links: await bidderLinks(id) };
}
async function invite(user, id, partnerIds, baseUrl) {
  const out = await db.tx(async c => {
    const t = await lockT(c, id);
    if (t.status !== 'published') throw bad('Suppliers can be invited only while the procurement is open for bids');
    const inv = []; for (const pid of [...new Set((partnerIds || []).map(Number).filter(Boolean))]) inv.push(await addBidder(c, t, pid));
    await event(c, id, { user, action: 'invited', details: `${inv.length} more suppliers` });
    return { t, inv };
  });
  for (const x of out.inv) await mailInvite(out.t, x, baseUrl);
  return { invited: out.inv.length, links: await bidderLinks(id) };
}
const bidderLinks = id => db.query('SELECT b.partner_id, p.name, p.email, p.phone, b.token, b.status FROM tender_bidders b JOIN partners p ON p.id = b.partner_id WHERE b.tender_id = ? ORDER BY p.name', [id]);

/* ---- bids ---- */
const seal = (t, pid, lines, extra) => crypto.createHash('sha256').update(JSON.stringify({ t: t.id, p: pid, l: lines.map(l => [l.line_id, l.unit_price]), x: extra, at: Date.now() })).digest('hex');
/** a bid from the supplier portal (by = null) or typed in by staff from a paper / emailed bid (by = user) */
async function placeBid(c, t, pid, b, by) {
  const lines = await c.query('SELECT * FROM tender_lines WHERE tender_id = ?', [t.id]);
  const got = new Map((b.lines || []).map(l => [Number(l.line_id), l.unit_price]));
  const bl = [];
  for (const l of lines) {
    const raw = got.get(l.id);
    if (raw === undefined || raw === null || raw === '') throw bad(`Give a price for every item – "${l.description}" has none`);
    const u = r2(raw); if (!(u >= 0)) throw bad(`The price for "${l.description}" is not valid`);
    bl.push({ line_id: l.id, unit_price: u, qty: Number(l.qty) });
  }
  const sub = r2(bl.reduce((s, l) => s + l.unit_price * l.qty, 0));
  const vatRate = b.vat_rate === undefined || b.vat_rate === '' ? 15 : Math.max(0, Number(b.vat_rate) || 0);
  const vat = r2(sub * vatRate / 100), total = r2(sub + vat);
  if (!b.declaration) throw bad('The bidder must confirm the declaration (true information, no collusion, no conflict of interest)');
  const v = { tender_id: t.id, partner_id: pid, subtotal: sub, vat, total, delivery_days: b.delivery_days === '' || b.delivery_days == null ? null : Math.max(0, Math.round(Number(b.delivery_days))),
    validity_days: Math.max(1, Math.round(Number(b.validity_days) || t.bid_validity_days)), notes: b.notes ? String(b.notes).slice(0, 2000) : null, declaration: 1, entered_by: by ? by.id : null,
    status: 'valid', submitted_at: now(), seal: seal(t, pid, bl, { sub, vat, by: by ? by.id : null }) };
  const ex = await c.one('SELECT id FROM tender_bids WHERE tender_id = ? AND partner_id = ?', [t.id, pid]);
  let bid;
  if (ex) { await c.query('UPDATE tender_bids SET ? WHERE id = ?', [v, ex.id]); bid = ex.id; await c.query('DELETE FROM tender_bid_lines WHERE bid_id = ?', [bid]); }
  else bid = (await c.query('INSERT INTO tender_bids SET ?', [v])).insertId;
  for (const l of bl) await c.query('INSERT INTO tender_bid_lines (bid_id, line_id, unit_price) VALUES (?, ?, ?)', [bid, l.line_id, l.unit_price]);
  await c.query(`UPDATE tender_bidders SET status = 'submitted' WHERE tender_id = ? AND partner_id = ?`, [t.id, pid]);
  await event(c, t.id, { user: by, partner: pid, action: ex ? 'bid replaced' : 'bid received', details: `seal ${v.seal.slice(0, 12)}…${by ? ' (entered by staff)' : ''}` });
  return { id: bid, seal: v.seal, submitted_at: v.submitted_at, replaced: !!ex };
}
async function enterBid(user, id, b) {
  return db.tx(async c => {
    const t = await lockT(c, id);
    const pid = Number(b.partner_id);
    if (t.method === 'waiver') {
      if (t.status !== 'approved') throw bad('The waiver must be approved before the quotation is entered');
      if (pid !== t.waiver_supplier_id) throw bad('A waiver is for the named supplier only');
    } else if (t.status !== 'published') throw bad(t.status === 'closed' ? 'The closing time has passed – late bids are not accepted' : 'Bids are taken only while it is open for bids');
    await eligible(c, pid);
    if (t.method !== 'waiver') { const bd = await c.one('SELECT id FROM tender_bidders WHERE tender_id = ? AND partner_id = ?', [id, pid]); if (!bd) { if (t.method !== 'open') throw bad('That supplier was not invited'); await addBidder(c, t, pid, 'registered'); } }
    else await addBidder(c, t, pid, 'invited');
    return placeBid(c, t, pid, b, user);
  });
}

/* ---- clarifications, addenda, challenges ---- */
async function answer(user, cid, b) {
  return db.tx(async c => {
    const q = await c.one('SELECT * FROM tender_clarifications WHERE id = ? FOR UPDATE', [cid]); if (!q) throw notFound('Question');
    if (q.kind === 'challenge') throw bad('Decide a challenge with "uphold" or "dismiss"');
    const a = String(b.answer || '').trim(); if (!a) throw bad('Type the answer');
    await c.query(`UPDATE tender_clarifications SET answer = ?, answered_by = ?, answered_at = NOW(), status = 'answered' WHERE id = ?`, [a, user.id, cid]);
    await event(c, q.tender_id, { user, action: 'clarification answered', details: 'Published to all bidders' });
  });
}
async function addendum(user, id, b) {
  return db.tx(async c => {
    const t = await lockT(c, id);
    if (!['published'].includes(t.status)) throw bad('Addenda are issued while the procurement is open for bids');
    const text = String(b.text || '').trim(); if (!text) throw bad('Type the addendum');
    await c.query(`INSERT INTO tender_clarifications (tender_id, kind, question, answered_by, answered_at, status) VALUES (?, 'addendum', ?, ?, NOW(), 'answered')`, [id, text, user.id]);
    if (b.closing_at) {
      const nc = new Date(b.closing_at); if (!(nc > new Date(String(t.closing_at).replace(' ', 'T') + 'Z'))) throw bad('An addendum can only move the closing time later');
      await c.query('UPDATE tenders SET closing_at = ? WHERE id = ?', [nc.toISOString().slice(0, 19).replace('T', ' '), id]);
    }
    await event(c, id, { user, action: 'addendum', details: text.slice(0, 200) + (b.closing_at ? ` · closing moved to ${b.closing_at}` : '') });
  });
}

/* ---- opening, conflict of interest, scoring, evaluation ---- */
async function openBids(user, id, b) {
  const cfg = await settings();
  return db.tx(async c => {
    const t = await lockT(c, id);
    if (t.status !== 'closed') throw bad(t.status === 'published' ? 'Bids stay sealed until the closing time' : 'The bids are already open');
    const com = await c.query('SELECT user_id FROM tender_committee WHERE tender_id = ?', [id]);
    const present = [...new Set([user.id, ...(b.present || []).map(Number)])].filter(u => com.some(m => m.user_id === u));
    if (present.length < cfg.min_opening_members) throw bad(`At least ${cfg.min_opening_members} committee members must be present to open the bids`);
    const bids = await c.query('SELECT b.total, b.seal, p.name FROM tender_bids b JOIN partners p ON p.id = b.partner_id WHERE b.tender_id = ? AND b.status = \'valid\' ORDER BY p.name', [id]);
    const names = await c.query('SELECT name FROM users WHERE id IN (?)', [present]);
    await c.query(`UPDATE tenders SET status = 'opened', opened_at = NOW() WHERE id = ?`, [id]);
    await event(c, id, { user, action: 'bids opened', details: `Present: ${names.map(n => n.name).join(', ')}. ${bids.length} bids: ${bids.map(x => `${x.name} M ${Number(x.total).toFixed(2)}`).join('; ')}`.slice(0, 500) });
    return { bids: bids.length };
  });
}
async function declare(user, id, b) {
  return db.tx(async c => {
    const m = await c.one('SELECT * FROM tender_committee WHERE tender_id = ? AND user_id = ?', [id, user.id]); if (!m) throw bad('You are not on this committee');
    await c.query('UPDATE tender_committee SET coi_declared_at = NOW(), coi_conflict = ?, coi_note = ? WHERE id = ?', [b.conflict ? 1 : 0, b.note ? String(b.note).slice(0, 255) : null, m.id]);
    await event(c, id, { user, action: b.conflict ? 'conflict of interest declared' : 'no conflict of interest declared', details: b.note || null });
  });
}
async function score(user, id, b) {
  return db.tx(async c => {
    const t = await lockT(c, id);
    if (!['opened', 'evaluated'].includes(t.status)) throw bad('Scoring happens after the bids are opened and before a recommendation');
    const m = await c.one('SELECT * FROM tender_committee WHERE tender_id = ? AND user_id = ?', [id, user.id]);
    if (!m) throw bad('Only committee members score bids');
    if (!m.coi_declared_at) throw bad('Declare any conflict of interest first');
    if (m.coi_conflict) throw bad('You declared a conflict of interest, so you may not score this procurement');
    const bid = await c.one('SELECT * FROM tender_bids WHERE id = ? AND tender_id = ?', [b.bid_id, id]); if (!bid) throw bad('Unknown bid');
    const crit = await c.query('SELECT * FROM tender_criteria WHERE tender_id = ?', [id]);
    for (const s of b.scores || []) {
      const k = crit.find(x => x.id === Number(s.criterion_id)); if (!k) throw bad('Unknown criterion');
      const v = Number(s.score);
      if (k.kind === 'mandatory' ? ![0, 1].includes(v) : !(v >= 0 && v <= Number(k.max_points))) throw bad(k.kind === 'mandatory' ? `"${k.name}" is pass (1) or fail (0)` : `"${k.name}" is scored from 0 to ${Number(k.max_points)}`);
      await c.query('INSERT INTO tender_scores (bid_id, criterion_id, user_id, score, comment) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE score = VALUES(score), comment = VALUES(comment)',
        [bid.id, k.id, user.id, v, s.comment ? String(s.comment).slice(0, 255) : null]);
    }
    if (t.status === 'evaluated') await c.query(`UPDATE tenders SET status = 'opened' WHERE id = ?`, [id]); // scores changed: evaluate again
  });
}
/** work out compliance, technical %, price and preference points and the ranking */
async function evaluate(user, id) {
  const cfg = await settings();
  return db.tx(async c => {
    const t = await lockT(c, id);
    if (!['opened', 'evaluated'].includes(t.status)) throw bad('Open the bids first');
    const me = await c.one('SELECT role FROM tender_committee WHERE tender_id = ? AND user_id = ?', [id, user.id]);
    if (!me && !can(user, 'procurement')) throw bad('Only the committee or the procurement office can run the evaluation');
    const crit = await c.query('SELECT * FROM tender_criteria WHERE tender_id = ?', [id]);
    const mand = crit.filter(k => k.kind === 'mandatory'), tech = crit.filter(k => k.kind === 'technical');
    const techMax = tech.reduce((s, k) => s + Number(k.max_points), 0);
    const bids = await c.query(`SELECT b.*, sp.citizen_pct, sp.women_pct, sp.youth_pct, sp.disabled_owned, sp.size FROM tender_bids b LEFT JOIN supplier_profiles sp ON sp.partner_id = b.partner_id
      WHERE b.tender_id = ? AND b.status = 'valid'`, [id]);
    if (!bids.length) throw bad('There are no valid bids – cancel and re-advertise');
    const scores = await c.query('SELECT s.* FROM tender_scores s JOIN tender_bids b ON b.id = s.bid_id WHERE b.tender_id = ?', [id]);
    for (const b of bids) {
      const mine = scores.filter(s => s.bid_id === b.id);
      // mandatory: each criterion passes when most of the members who checked it said pass
      let ok = true;
      for (const k of mand) {
        const v = mine.filter(s => s.criterion_id === k.id);
        if (!v.length) throw bad(`Nobody has checked "${k.name}" for every bid yet`);
        if (v.filter(s => Number(s.score) === 1).length * 2 <= v.length) ok = false;
      }
      // technical: the average of each member's total, as a % of the maximum
      let techPct = null;
      if (tech.length) {
        const per = {};
        for (const s of mine.filter(s => tech.some(k => k.id === s.criterion_id))) (per[s.user_id] = per[s.user_id] || []).push(s);
        const full = Object.values(per).filter(l => l.length === tech.length);
        if (!full.length) throw bad('Every bid needs a complete technical score from at least one member');
        techPct = r2(full.reduce((a, l) => a + l.reduce((x, s) => x + Number(s.score), 0), 0) / full.length / techMax * 100);
        if (techPct < Number(t.min_tech_pct)) ok = false;
      }
      b.ok = ok; b.techPct = techPct;
    }
    const q = bids.filter(b => b.ok), low = q.length ? Math.min(...q.map(b => Number(b.total))) : 0;
    for (const b of bids) {
      if (!b.ok) { await c.query('UPDATE tender_bids SET compliant = 0, tech_pct = ?, price_score = NULL, pref_score = NULL, total_score = NULL, rank_no = NULL WHERE id = ?', [b.techPct, b.id]); continue; }
      const P = Number(b.total);
      const priceRatio = P <= 0 ? 1 : cfg.price_formula === 'ppfa' ? Math.max(0, 1 - (P - low) / low) : low / P;
      const ps = r2(Number(t.price_weight) * priceRatio), pr = r2(Number(t.pref_weight) * prefRatio(b, cfg)), ts = r2(Number(t.tech_weight) * (b.techPct || 0) / 100);
      b.total_score = r2(ps + pr + ts);
      await c.query('UPDATE tender_bids SET compliant = 1, tech_pct = ?, price_score = ?, pref_score = ?, total_score = ? WHERE id = ?', [b.techPct, ps, pr, b.total_score, b.id]);
    }
    q.sort((a, b) => b.total_score - a.total_score || Number(a.total) - Number(b.total));
    for (const [i, b] of q.entries()) await c.query('UPDATE tender_bids SET rank_no = ? WHERE id = ?', [i + 1, b.id]);
    await c.query(`UPDATE tenders SET status = 'evaluated' WHERE id = ?`, [id]);
    await event(c, id, { user, action: 'evaluated', details: `${q.length} of ${bids.length} bids qualify${q[0] ? ` – highest score ${q[0].total_score}` : ''}` });
    return { qualifying: q.length, bids: bids.length };
  });
}
async function disqualify(user, id, b) {
  return db.tx(async c => {
    const t = await lockT(c, id);
    if (!['opened', 'evaluated'].includes(t.status)) throw bad('Bids are disqualified during evaluation');
    const reason = String(b.reason || '').trim(); if (!reason) throw bad('Give the reason');
    const bid = await c.one('SELECT * FROM tender_bids WHERE id = ? AND tender_id = ?', [b.bid_id, id]); if (!bid) throw bad('Unknown bid');
    await c.query(`UPDATE tender_bids SET status = 'disqualified', disqualified_reason = ?, rank_no = NULL WHERE id = ?`, [reason.slice(0, 255), bid.id]);
    await c.query(`UPDATE tenders SET status = 'opened' WHERE id = ?`, [id]);
    await event(c, id, { user, partner: bid.partner_id, action: 'bid disqualified', details: reason });
  });
}
async function recommend(user, id, b) {
  return db.tx(async c => {
    const t = await lockT(c, id);
    const bid = await c.one('SELECT * FROM tender_bids WHERE id = ? AND tender_id = ? AND status = \'valid\'', [b.bid_id, id]); if (!bid) throw bad('Choose a valid bid');
    if (t.method === 'waiver') { if (t.status !== 'approved') throw bad('Enter the supplier\'s quotation first'); }
    else {
      if (t.status !== 'evaluated') throw bad('Run the evaluation first');
      if (!bid.compliant) throw bad('That bid did not qualify');
      if (bid.rank_no !== 1 && String(b.reason || '').trim().length < 20) throw bad('This is not the highest-scoring bid – explain in full why it is recommended');
    }
    await c.query(`UPDATE tenders SET status = 'recommended', recommended_bid_id = ?, recommended_by = ?, recommendation = ? WHERE id = ?`, [bid.id, user.id, b.reason || null, id]);
    await event(c, id, { user, partner: bid.partner_id, action: 'award recommended', details: `M ${Number(bid.total).toFixed(2)}${b.reason ? ' – ' + b.reason : ''}` });
    const g = await gov().request(c, { doc_type: 'procurement_award', doc_id: t.id, amount: Number(bid.total), requester_id: user.id, summary: `Award ${t.number}: ${t.title} – M ${Number(bid.total).toFixed(2)}`, link: `#/tender/${t.id}` });
    return g.governed ? { message: `Sent to ${g.next} for approval` } : {};
  });
}
async function approveAward(user, id, b = {}) {
  const cfg = await settings();
  return db.tx(async c => {
    const t = await lockT(c, id);
    if (t.status !== 'recommended') throw bad('There is no recommendation to approve');
    if (cfg.segregation && t.recommended_by === user.id) throw bad('The award must be approved by someone other than the person who recommended it');
    if (cfg.segregation && (await c.one('SELECT id FROM tender_committee WHERE tender_id = ? AND user_id = ? AND role <> \'secretary\'', [id, user.id]))) throw bad('An evaluation committee member cannot approve the award');
    if (b.reject) {
      await gov().reject(c, user, { doc_type: 'procurement_award', doc_id: t.id, note: b.note });
      await c.query(`UPDATE tenders SET status = ?, recommended_bid_id = NULL, recommended_by = NULL WHERE id = ?`, [t.method === 'waiver' ? 'approved' : 'evaluated', id]);
      await event(c, id, { user, action: 'recommendation rejected', details: b.note || null });
      return { rejected: true };
    }
    const bid = await c.one('SELECT * FROM tender_bids WHERE id = ?', [t.recommended_bid_id]);
    const g = await gov().authorize(c, user, { doc_type: 'procurement_award', doc_id: t.id, amount: Number(bid.total), requester_id: t.recommended_by, summary: `Award ${t.number}: ${t.title}`, link: `#/tender/${t.id}`, note: b.note });
    if (!g.final) { await event(c, id, { user, partner: bid.partner_id, action: 'award concurred', details: b.note || g.message }); return { message: g.message }; }
    const ss = cfg.standstill_methods.includes(t.method) && cfg.standstill_days > 0 ? require('./stock').addDays(today(), cfg.standstill_days) : null;
    await c.query(`UPDATE tenders SET status = 'awarded', awarded_to = ?, award_value = ?, award_approved_by = ?, awarded_at = NOW(), standstill_until = ? WHERE id = ?`, [bid.partner_id, bid.total, user.id, ss, id]);
    await event(c, id, { user, partner: bid.partner_id, action: 'award approved', details: `M ${Number(bid.total).toFixed(2)}${ss ? ` · standstill until ${ss}` : ''}` });
    return { standstill_until: ss };
  });
}
/** a losing bidder objects during the standstill (from the portal) */
async function challenge(c, t, pid, text) {
  if (!['awarded', 'challenged'].includes(t.status) || !t.standstill_until || String(t.standstill_until) < today()) throw bad('Challenges can be lodged only during the standstill period after an award');
  if (pid === t.awarded_to) throw bad('The successful bidder cannot challenge the award');
  if (!(await c.one('SELECT id FROM tender_bids WHERE tender_id = ? AND partner_id = ?', [t.id, pid]))) throw bad('Only bidders can challenge the award');
  const s = String(text || '').trim(); if (s.length < 30) throw bad('Explain the grounds of the challenge in full');
  await c.query(`INSERT INTO tender_clarifications (tender_id, partner_id, kind, question) VALUES (?, ?, 'challenge', ?)`, [t.id, pid, s.slice(0, 5000)]);
  await c.query(`UPDATE tenders SET status = 'challenged' WHERE id = ?`, [t.id]);
  await event(c, t.id, { partner: pid, action: 'award challenged', details: s.slice(0, 200) });
}
async function decideChallenge(user, cid, b) {
  return db.tx(async c => {
    const q = await c.one(`SELECT * FROM tender_clarifications WHERE id = ? AND kind = 'challenge' FOR UPDATE`, [cid]); if (!q) throw notFound('Challenge');
    if (q.status !== 'open') throw bad('Already decided');
    const a = String(b.answer || '').trim(); if (!a) throw bad('Give the reasons for the decision');
    const upheld = b.decision === 'upheld';
    await c.query('UPDATE tender_clarifications SET status = ?, answer = ?, answered_by = ?, answered_at = NOW() WHERE id = ?', [upheld ? 'upheld' : 'dismissed', a, user.id, cid]);
    if (upheld) await c.query(`UPDATE tenders SET status = 'evaluated', awarded_to = NULL, award_value = NULL, award_approved_by = NULL, awarded_at = NULL, standstill_until = NULL, recommended_bid_id = NULL WHERE id = ?`, [q.tender_id]);
    else if (!(await c.one(`SELECT id FROM tender_clarifications WHERE tender_id = ? AND kind = 'challenge' AND status = 'open'`, [q.tender_id]))) await c.query(`UPDATE tenders SET status = 'awarded' WHERE id = ?`, [q.tender_id]);
    await event(c, q.tender_id, { user, partner: q.partner_id, action: upheld ? 'challenge upheld – evaluation reopened' : 'challenge dismissed', details: a.slice(0, 300) });
  });
}
/** the contract: a purchase order to the winner (draft, so it goes through the normal approval / receiving) */
async function contract(user, id, b = {}) {
  return db.tx(async c => {
    const t = await lockT(c, id);
    if (t.status === 'challenged') throw bad('The award is challenged – decide the challenge first');
    if (t.status !== 'awarded') throw bad('Only an approved award becomes a contract');
    if (t.standstill_until && String(t.standstill_until) >= today()) throw bad(`The standstill period runs until ${t.standstill_until} – the contract can be signed after that`);
    const bid = await c.one('SELECT * FROM tender_bids WHERE tender_id = ? AND partner_id = ?', [id, t.awarded_to]);
    const lines = await c.query('SELECT l.*, bl.unit_price FROM tender_lines l JOIN tender_bid_lines bl ON bl.line_id = l.id AND bl.bid_id = ? WHERE l.tender_id = ? ORDER BY l.id', [bid.id, id]);
    const rate = Number(bid.subtotal) > 0 ? r2(Number(bid.vat) / Number(bid.subtotal) * 100) : 0;
    const ins = await c.query('INSERT INTO purchase_orders (supplier_id, order_date, expected_date, notes, user_id) VALUES (?, CURDATE(), ?, ?, ?)',
      [t.awarded_to, bid.delivery_days != null ? require('./stock').addDays(today(), bid.delivery_days) : null, `Contract for ${t.number} – ${t.title}`.slice(0, 255), user.id]);
    const number = `PO/${new Date().getFullYear()}/${pad(ins.insertId, 5)}`;
    await c.query('UPDATE purchase_orders SET number = ? WHERE id = ?', [number, ins.insertId]);
    let sub = 0, tax = 0;
    for (const l of lines) {
      const net = r2(Number(l.qty) * Number(l.unit_price)), vat = r2(net * rate / 100); sub += net; tax += vat;
      await c.query('INSERT INTO purchase_lines (po_id, product_id, description, qty, unit_cost, tax_rate, net_amount, tax_amount, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ins.insertId, l.product_id, l.description, l.qty, l.unit_price, rate, net, vat, r2(net + vat)]);
    }
    await c.query('UPDATE purchase_orders SET subtotal = ?, tax_total = ?, total = ? WHERE id = ?', [r2(sub), r2(tax), r2(sub + tax), ins.insertId]);
    await c.query(`UPDATE tenders SET status = 'contracted', po_id = ?, contract_start = ?, contract_end = ? WHERE id = ?`, [ins.insertId, b.contract_start || today(), b.contract_end || null, id]);
    await event(c, id, { user, partner: t.awarded_to, action: 'contract issued', details: `${number} M ${r2(sub + tax).toFixed(2)}` });
    return { po_id: ins.insertId, number, total: r2(sub + tax) };
  });
}
async function rate(user, id, b) {
  return db.tx(async c => {
    const t = await lockT(c, id);
    if (t.status !== 'contracted') throw bad('Rate the supplier once the contract is running or done');
    const r = Math.round(Number(b.rating)); if (!(r >= 1 && r <= 5)) throw bad('Rate from 1 (poor) to 5 (excellent)');
    if (t.supplier_rating) throw bad('Already rated');
    await c.query('UPDATE tenders SET supplier_rating = ?, rating_note = ? WHERE id = ?', [r, b.note ? String(b.note).slice(0, 255) : null, id]);
    await c.query(`INSERT INTO supplier_profiles (partner_id, rating, ratings) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE rating = ROUND((COALESCE(rating, 0) * ratings + ?) / (ratings + 1), 2), ratings = ratings + 1`, [t.awarded_to, r, r]);
    await event(c, id, { user, partner: t.awarded_to, action: 'supplier rated', details: `${r}/5 ${b.note || ''}` });
  });
}
async function cancel(user, id, b) {
  return db.tx(async c => {
    const t = await lockT(c, id);
    if (['contracted', 'cancelled'].includes(t.status)) throw bad('It cannot be cancelled now');
    const reason = String(b.reason || '').trim(); if (reason.length < 10) throw bad('Give the reason for cancelling');
    await c.query(`UPDATE tenders SET status = 'cancelled', cancel_reason = ? WHERE id = ?`, [reason.slice(0, 255), id]);
    await event(c, id, { user, action: 'cancelled', details: reason });
  });
}

/* ============================== supplier portal ============================== */
async function byToken(tk) {
  if (!/^[a-f0-9]{32}$/.test(String(tk || ''))) return null;
  const bd = await db.one('SELECT b.*, p.name partner_name FROM tender_bidders b JOIN partners p ON p.id = b.partner_id WHERE b.token = ?', [tk]);
  if (!bd) return null;
  const t = await db.one('SELECT * FROM tenders WHERE id = ?', [bd.tender_id]);
  await db.tx(c => autoClose(c, t));
  if (!bd.viewed_at) await db.query('UPDATE tender_bidders SET viewed_at = NOW() WHERE id = ?', [bd.id]);
  return { bd, t };
}
async function portalData(tk) {
  const x = await byToken(tk); if (!x) return null;
  const { bd, t } = x;
  const lines = await db.query('SELECT id, description, qty, uom FROM tender_lines WHERE tender_id = ? ORDER BY id', [t.id]);
  const crit = await db.query('SELECT kind, name, max_points FROM tender_criteria WHERE tender_id = ? ORDER BY kind, sort_order', [t.id]);
  const qa = await db.query(`SELECT kind, question, answer, answered_at, status, (partner_id = ?) mine FROM tender_clarifications WHERE tender_id = ? AND (kind = 'addendum' OR (kind = 'question' AND (status = 'answered' OR partner_id = ?)) OR (kind = 'challenge' AND partner_id = ?)) ORDER BY id`, [bd.partner_id, t.id, bd.partner_id, bd.partner_id]);
  const bid = await db.one('SELECT id, subtotal, vat, total, delivery_days, validity_days, notes, submitted_at, seal, status, rank_no FROM tender_bids WHERE tender_id = ? AND partner_id = ?', [t.id, bd.partner_id]);
  if (bid) bid.lines = await db.query('SELECT line_id, unit_price FROM tender_bid_lines WHERE bid_id = ?', [bid.id]);
  const docs = await db.query(`SELECT id, filename, size FROM attachments WHERE entity = 'tender' AND entity_id = ? ORDER BY id`, [t.id]);
  const myDocs = bid ? await db.query(`SELECT id, filename, size FROM attachments WHERE entity = 'bid' AND entity_id = ? ORDER BY id`, [bid.id]) : [];
  const result = ['awarded', 'challenged', 'contracted'].includes(t.status) ? { won: t.awarded_to === bd.partner_id, award_value: t.awarded_to === bd.partner_id ? Number(t.award_value) : null,
    awarded_name: (await db.one('SELECT name FROM partners WHERE id = ?', [t.awarded_to])).name, standstill_until: t.standstill_until } : null;
  return { bd, t, lines, crit, qa, bid, docs, myDocs, result, open_for_bids: t.status === 'published' };
}
async function portalBid(tk, b) {
  const x = await byToken(tk); if (!x) throw notFound();
  return db.tx(async c => {
    const t = await lockT(c, x.t.id);
    if (t.status !== 'published') throw bad('This procurement is closed for bids');
    await eligible(c, x.bd.partner_id);
    return placeBid(c, t, x.bd.partner_id, b, null);
  });
}
async function portalWithdraw(tk) {
  const x = await byToken(tk); if (!x) throw notFound();
  return db.tx(async c => {
    const t = await lockT(c, x.t.id);
    if (t.status !== 'published') throw bad('Bids can be withdrawn only before the closing time');
    const r = await c.query('DELETE FROM tender_bids WHERE tender_id = ? AND partner_id = ?', [t.id, x.bd.partner_id]);
    if (!r.affectedRows) throw bad('You have no bid to withdraw');
    await c.query(`UPDATE tender_bidders SET status = 'withdrawn' WHERE id = ?`, [x.bd.id]);
    await event(c, t.id, { partner: x.bd.partner_id, action: 'bid withdrawn' });
  });
}
async function portalAsk(tk, text) {
  const x = await byToken(tk); if (!x) throw notFound();
  const s = String(text || '').trim(); if (s.length < 5) throw bad('Type your question');
  if (x.t.status !== 'published') throw bad('Questions are taken while the procurement is open');
  await db.query(`INSERT INTO tender_clarifications (tender_id, partner_id, kind, question) VALUES (?, ?, 'question', ?)`, [x.t.id, x.bd.partner_id, s.slice(0, 3000)]);
  await db.query('INSERT INTO tender_events (tender_id, partner_id, action, details) VALUES (?, ?, ?, ?)', [x.t.id, x.bd.partner_id, 'question asked', s.slice(0, 200)]);
}
async function portalChallenge(tk, text) {
  const x = await byToken(tk); if (!x) throw notFound();
  return db.tx(async c => challenge(c, await lockT(c, x.t.id), x.bd.partner_id, text));
}
/** open tenders: a supplier registers on the public notice and gets its own bid link */
async function publicTender(slug) {
  if (!/^[a-f0-9]{16}$/.test(String(slug || ''))) return null;
  const t = await db.one(`SELECT * FROM tenders WHERE slug = ? AND method = 'open' AND status NOT IN ('draft','submitted','approved')`, [slug]);
  if (t) await db.tx(c => autoClose(c, t));
  return t;
}
async function registerForTender(slug, b) {
  const t = await publicTender(slug); if (!t) throw notFound();
  if (t.status !== 'published') throw bad('This tender is closed');
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Enter a valid email address – your private bid link is sent there');
  const name = String(b.name || '').trim(); if (name.length < 2) throw bad('Enter the company name');
  return db.tx(async c => {
    let p = await c.one('SELECT id FROM partners WHERE LOWER(email) = ? AND is_supplier = 1', [email]);
    let pid = p && p.id;
    if (!pid) {
      pid = (await c.query('INSERT INTO partners (name, phone, email, tax_number, is_customer, is_supplier) VALUES (?, ?, ?, ?, 0, 1)', [name.slice(0, 160), b.phone || null, email, b.tax_number || null])).insertId;
      await c.query('INSERT INTO supplier_profiles SET ?', [{ partner_id: pid, reg_no: b.reg_no || null, citizen_pct: pct(b.citizen_pct), women_pct: pct(b.women_pct), youth_pct: pct(b.youth_pct),
        disabled_owned: b.disabled_owned ? 1 : 0, size: ['micro', 'small', 'medium', 'large'].includes(b.size) ? b.size : 'small', district: b.district || null, contact_person: b.contact_person || null, status: 'pending' }]);
    }
    const bd = await addBidder(c, t, pid, 'registered');
    await event(c, t.id, { partner: pid, action: 'registered to bid', details: name });
    return { t, bd, email, existing: !!p };
  });
}

/* ============================== scorecards & registers ============================== */
async function scorecard(from, to) {
  const cfg = await settings(), M = cfg.majority_pct;
  from = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : today().slice(0, 4) + '-01-01'; to = /^\d{4}-\d{2}-\d{2}$/.test(to || '') ? to : today();
  // all purchasing (orders not cancelled) by the supplier's ownership
  const po = await db.query(`SELECT po.supplier_id, po.total, sp.citizen_pct, sp.women_pct, sp.youth_pct, sp.disabled_owned, sp.size, sp.district, sp.country
    FROM purchase_orders po LEFT JOIN supplier_profiles sp ON sp.partner_id = po.supplier_id WHERE po.status <> 'cancelled' AND po.order_date BETWEEN ? AND ?`, [from, to]);
  const total = r2(po.reduce((s, x) => s + Number(x.total), 0));
  const grp = (label, f) => { const rows = po.filter(f); const v = r2(rows.reduce((s, x) => s + Number(x.total), 0)); return { label, value: v, pct: total ? r2(v / total * 100) : 0, suppliers: new Set(rows.map(x => x.supplier_id)).size }; };
  const known = x => x.citizen_pct !== null && x.citizen_pct !== undefined;
  const ownership = [
    grp('Citizen-owned (Basotho)', x => known(x) && Number(x.citizen_pct) >= M),
    grp('Joint (part citizen)', x => known(x) && Number(x.citizen_pct) > 0 && Number(x.citizen_pct) < M),
    grp('Foreign-owned', x => known(x) && Number(x.citizen_pct) === 0),
    grp('No ownership details yet', x => !known(x))];
  const groups = [grp('Women-owned', x => Number(x.women_pct) >= M), grp('Youth-owned', x => Number(x.youth_pct) >= M), grp('Owned by people with disability', x => !!x.disabled_owned),
    grp('Micro & small (SMME)', x => ['micro', 'small'].includes(x.size))];
  const districts = {}; for (const x of po) { const k = x.district || 'Unknown'; districts[k] = r2((districts[k] || 0) + Number(x.total)); }
  // procurement cases by method
  const tenders = await db.query(`SELECT method, status, estimated_value, award_value, approved_at, awarded_at, (SELECT b.subtotal FROM tender_bids b WHERE b.id = tenders.recommended_bid_id) award_net FROM tenders WHERE created_at BETWEEN ? AND ?`, [from + ' 00:00:00', to + ' 23:59:59']);
  const aw = tenders.filter(t => t.award_value !== null && ['awarded', 'challenged', 'contracted'].includes(t.status));
  const awTotal = r2(aw.reduce((s, t) => s + Number(t.award_value), 0));
  const methods = Object.keys(METHODS).map(m => { const a = aw.filter(t => t.method === m); const v = r2(a.reduce((s, t) => s + Number(t.award_value), 0)); return { method: m, label: METHODS[m], cases: tenders.filter(t => t.method === m).length, awards: a.length, value: v, pct: awTotal ? r2(v / awTotal * 100) : 0 }; });
  // savings: estimate (excl. VAT) against the awarded prices excl. VAT
  const est = r2(aw.reduce((s, t) => s + Number(t.estimated_value), 0)), awNet = r2(aw.reduce((s, t) => s + Number(t.award_net ?? t.award_value), 0));
  const days = aw.filter(t => t.approved_at && t.awarded_at).map(t => (new Date(t.awarded_at) - new Date(t.approved_at)) / 864e5);
  // who takes part: bids received by ownership
  const bids = await db.query(`SELECT sp.citizen_pct, sp.women_pct, sp.youth_pct FROM tender_bids b JOIN tenders t ON t.id = b.tender_id LEFT JOIN supplier_profiles sp ON sp.partner_id = b.partner_id WHERE t.created_at BETWEEN ? AND ?`, [from + ' 00:00:00', to + ' 23:59:59']);
  return { from, to, majority_pct: M, spend_total: total, ownership, groups, districts: Object.entries(districts).map(([district, value]) => ({ district, value, pct: total ? r2(value / total * 100) : 0 })).sort((a, b) => b.value - a.value),
    methods, awards_total: awTotal, waiver_pct: methods.find(m => m.method === 'waiver').pct, savings: r2(est - awNet), savings_pct: est ? r2((est - awNet) / est * 100) : 0,
    avg_days_to_award: days.length ? r2(days.reduce((a, b) => a + b, 0) / days.length) : null,
    participation: { bids: bids.length, women_owned: bids.filter(b => Number(b.women_pct) >= M).length, citizen_owned: bids.filter(b => Number(b.citizen_pct) >= M).length, youth_owned: bids.filter(b => Number(b.youth_pct) >= M).length } };
}
async function list(q = {}) {
  await closeDue();
  const where = ['1=1'], args = [];
  if (q.method) { where.push('t.method = ?'); args.push(q.method); }
  if (q.status) { if (q.status === 'active') where.push(`t.status NOT IN ('contracted','cancelled')`); else { where.push('t.status = ?'); args.push(q.status); } }
  if (q.q) { where.push('(t.title LIKE ? OR t.number LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`); }
  if (q.mine) { where.push('EXISTS (SELECT 1 FROM tender_committee c WHERE c.tender_id = t.id AND c.user_id = ?)'); args.push(q.mine); }
  return db.query(`SELECT t.id, t.number, t.title, t.method, t.category, t.status, t.estimated_value, t.award_value, t.closing_at, t.department, t.created_at, t.waiver_reason, t.standstill_until,
      p.name awarded_name, w.name waiver_supplier, (SELECT COUNT(*) FROM tender_bids b WHERE b.tender_id = t.id AND b.status = 'valid') bids
    FROM tenders t LEFT JOIN partners p ON p.id = t.awarded_to LEFT JOIN partners w ON w.id = t.waiver_supplier_id WHERE ${where.join(' AND ')} ORDER BY t.id DESC LIMIT 1000`, args);
}
async function compliance() {
  return db.query(`${PROFILE_SQL} WHERE p.is_supplier = 1 AND sp.status IN ('approved','pending') AND (
      sp.tax_clearance_expiry IS NULL OR sp.tax_clearance_expiry < DATE_ADD(CURDATE(), INTERVAL 30 DAY) OR (sp.trader_licence_expiry IS NOT NULL AND sp.trader_licence_expiry < DATE_ADD(CURDATE(), INTERVAL 30 DAY)))
    ORDER BY COALESCE(sp.tax_clearance_expiry, '1900-01-01') LIMIT 500`);
}

module.exports = { approvalType, METHODS, WAIVER_REASONS, DEFAULTS, settings, saveSettings, prefRatio, suppliers, supplier, saveSupplier, list, getTender, saveTender, submit, approve, publish, invite, bidderLinks,
  enterBid, answer, addendum, openBids, declare, score, evaluate, disqualify, recommend, approveAward, decideChallenge, contract, rate, cancel,
  portalData, portalBid, portalWithdraw, portalAsk, portalChallenge, publicTender, registerForTender, mailInvite, scorecard, compliance, setCommittee, byToken };
