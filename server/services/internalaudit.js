// Internal audit (IIA-style): audit universe with risk scores → risk-based annual plan → engagements with a work programme
// (standard programmes per area, steps linked to the data tests in the audit module) → findings written as
// condition / criteria / cause / effect / recommendation with a risk rating → management responses and action plans with
// owners and due dates → follow-up and verification → the engagement report and the audit committee dashboard.
const db = require('../db');
const { round2, bad, notFound, pad, today } = require('../util');

const STATUS_FLOW = ['planned', 'fieldwork', 'review', 'draft_report', 'final', 'closed'];
const RISK_ORDER = { critical: 4, high: 3, medium: 2, low: 1 };

/** standard work programmes; `test` links a step to an exception test in the audit module */
const PROGRAMMES = {
  cash: { name: 'Cash, banking & till controls', steps: [
    ['C1', 'Bank reconciliations', 'Check that every bank and mobile-money account was reconciled monthly, reviewed and that old reconciling items were cleared.'],
    ['C2', 'Cash counts', 'Surprise-count the till floats and petty cash; agree to the session expected cash and records.'],
    ['C3', 'Till variances', 'Review till-session over/short by cashier for the period; follow up repeated shortages.'],
    ['C4', 'Refunds and voids', 'Analyse refunds and voids by cashier and test a sample for authority and support.', 'refunds'],
    ['C5', 'Large cash payments', 'Test cash payments above the limit for approval and supporting documents.', 'large_cash'],
    ['C6', 'Segregation', 'Confirm the people who receive cash do not also record or reconcile it.']] },
  procurement: { name: 'Procurement & payables', steps: [
    ['P1', 'Procurement method', 'Check that each award used the method the thresholds require; review every waiver for justification and approval.'],
    ['P2', 'Evaluation', 'Re-perform the evaluation scores for a sample of tenders; check conflict-of-interest declarations and that the highest-ranked bid won.'],
    ['P3', 'Duplicate payments', 'Investigate possible duplicate supplier bills.', 'dup_bills'],
    ['P4', 'Fictitious suppliers', 'Investigate suppliers sharing contact details or ID / TIN with staff.', 'supplier_staff'],
    ['P5', 'Three-way match', 'For a sample of supplier payments, agree the purchase order, goods received and the bill.'],
    ['P6', 'Supplier master file', 'Review changes to supplier details, tax clearance validity and debarred suppliers.']] },
  payroll: { name: 'Payroll', steps: [
    ['PR1', 'Starters and leavers', 'Agree starters and leavers to HR authority; check leavers were removed in time.'],
    ['PR2', 'Ghost employees', 'Match employees to ID numbers, bank accounts and phone numbers; look for duplicates.'],
    ['PR3', 'Pay changes', 'Test pay increases and allowances to approved documents.'],
    ['PR4', 'PAYE', 'Re-perform PAYE for a sample and agree payroll PAYE to the return and payment to RSL.'],
    ['PR5', 'Approval', 'Check each payroll run was approved by someone other than the preparer before payment.']] },
  inventory: { name: 'Inventory', steps: [
    ['I1', 'Stock counts', 'Attend a stock count; test counts from shelf to system and system to shelf.'],
    ['I2', 'Stock adjustments', 'Review write-offs, wastage and count adjustments for authority and patterns.'],
    ['I3', 'Valuation', 'Agree inventory in the ledger to the stock valuation (control account reconciliation).'],
    ['I4', 'Expiry and slow stock', 'Review expired and slow-moving items for provision.']] },
  revenue: { name: 'Revenue, billing & receivables', steps: [
    ['R1', 'Completeness', 'Check invoice number sequences for gaps.', 'gaps'],
    ['R2', 'Pricing', 'Agree a sample of invoices and POS sales to approved price lists / tariffs.'],
    ['R3', 'Credit notes and write-offs', 'Test credit notes and bad-debt write-offs for authority.'],
    ['R4', 'Receivables', 'Review the age analysis, follow-up of overdue accounts and the receivables control reconciliation.'],
    ['R5', 'Cut-off', 'Test sales either side of the period end for correct period.', 'backdated']] },
  journals: { name: 'General ledger & journals', steps: [
    ['G1', 'Manual journals to control accounts', 'Investigate manual journals posted to control accounts.', 'control_manual'],
    ['G2', 'Unusual journals', 'Review journals captured after hours, back-dated, or in round amounts.', 'after_hours'],
    ['G3', 'Journal approval', 'Check large journals were approved by a second person.', 'self_posted'],
    ['G4', 'Period close', 'Confirm month-end close steps and the period lock; review postings into closed periods.'],
    ['G5', 'Ledger integrity', 'Verify the ledger hash chain and that the trial balance balances.']] },
  assets: { name: 'Fixed assets', steps: [
    ['FA1', 'Existence', 'Verify a sample of assets physically (asset count with QR labels).'],
    ['FA2', 'Additions and disposals', 'Test additions to invoices and disposals to authority and proceeds.'],
    ['FA3', 'Depreciation', 'Re-perform depreciation for a sample; check useful lives against policy.'],
    ['FA4', 'Register vs ledger', 'Agree the register to the ledger (control account reconciliation).']] },
  it: { name: 'IT access & security', steps: [
    ['IT1', 'User access', 'Review users and roles; leavers removed; no shared logins; admin rights limited.'],
    ['IT2', 'Failed logins', 'Review failed login attempts.', 'failed_logins'],
    ['IT3', 'Backups', 'Check backups run daily and a restore was tested.'],
    ['IT4', 'Audit trail', 'Confirm the audit trail is complete and cannot be changed by users.']] },
  water: { name: 'Water billing & non-revenue water', steps: [
    ['W1', 'Meter reading', 'Test a sample of readings to meters; review estimated and flagged readings.'],
    ['W2', 'Tariffs', 'Agree tariffs in the system to the approved (LEWA) tariff schedule; re-calculate a sample of bills.'],
    ['W3', 'Prepaid vending', 'Agree token sales to cash-ups and partner settlements.'],
    ['W4', 'Disconnections', 'Check disconnections and reconnections followed policy and fees were billed.'],
    ['W5', 'Water loss', 'Analyse non-revenue water per zone; follow up zones above target.']] },
  fleet: { name: 'Fleet', steps: [
    ['F1', 'Vehicle use', 'Test pool-vehicle requests for approval and logbook km.'],
    ['F2', 'Fuel', 'Review fuel efficiency exceptions and fuel cards.'],
    ['F3', 'Fines and accidents', 'Check fines were recovered from drivers where policy requires; insurance claims followed up.'],
    ['F4', 'Licensing', 'Confirm vehicle papers and driver licences are valid.']] }
};

/* ---------------- universe ---------------- */
const score = u => Number(u.impact) * Number(u.likelihood) + (u.control_rating === 'weak' ? 5 : u.control_rating === 'unknown' ? 2 : u.control_rating === 'strong' ? -3 : 0);
async function universe() {
  const rows = await db.query('SELECT * FROM ia_universe WHERE active = 1 ORDER BY name');
  return rows.map(u => {
    const due = u.last_audited ? (() => { const d = new Date(String(u.last_audited).slice(0, 10) + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + Number(u.frequency_months)); return d.toISOString().slice(0, 10); })() : null;
    const s = score(u); return { ...u, risk_score: s, risk_level: s >= 20 ? 'high' : s >= 10 ? 'medium' : 'low', next_due: due, overdue: !due || due <= today() };
  }).sort((a, b) => b.risk_score - a.risk_score);
}
async function saveUniverse(b, id = null) {
  const v = { name: String(b.name || '').trim().slice(0, 120) }; if (!v.name) throw bad('Name the auditable area');
  for (const k of ['area', 'owner', 'description']) v[k] = b[k] ? String(b[k]).slice(0, k === 'description' ? 255 : 80) : null;
  for (const k of ['impact', 'likelihood']) { v[k] = Math.round(Number(b[k]) || 3); if (!(v[k] >= 1 && v[k] <= 5)) throw bad('Impact and likelihood are scored 1 to 5'); }
  v.control_rating = ['strong', 'adequate', 'weak', 'unknown'].includes(b.control_rating) ? b.control_rating : 'unknown';
  v.frequency_months = Math.max(1, Math.round(Number(b.frequency_months) || 12)); v.last_audited = b.last_audited || null;
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  if (id) await db.query('UPDATE ia_universe SET ? WHERE id = ?', [v, id]); else id = (await db.query('INSERT INTO ia_universe SET ?', [v])).insertId;
  return id;
}
/** a starting universe built from the modules the business uses */
async function seedUniverse() {
  if ((await db.one('SELECT COUNT(*) n FROM ia_universe')).n > 0) return 0;
  const mods = (await require('./modules').get().catch(() => ({ modules: [] }))).modules || [];
  const base = [['Cash, banking & tills', 'cash', 4, 4], ['Procurement & payables', 'procurement', 5, 4], ['Payroll', 'payroll', 4, 3], ['Revenue, billing & receivables', 'revenue', 5, 3],
    ['General ledger & journals', 'journals', 4, 3], ['IT access & security', 'it', 4, 3], ['Inventory', 'inventory', 3, 3], ['Fixed assets', 'assets', 3, 2]];
  if (mods.includes('water')) base.push(['Water billing & non-revenue water', 'water', 5, 4]);
  if (mods.includes('fleet')) base.push(['Fleet', 'fleet', 3, 3]);
  for (const [n, a, i, l] of base) await db.query('INSERT INTO ia_universe (name, area, impact, likelihood) VALUES (?, ?, ?, ?)', [n, a, i, l]);
  return base.length;
}

/* ---------------- engagements ---------------- */
async function engagements(q = {}) {
  return db.query(`SELECT g.*, u.name universe_name, l.name lead_name,
      (SELECT COUNT(*) FROM ia_findings f WHERE f.engagement_id = g.id) findings,
      (SELECT COUNT(*) FROM ia_findings f WHERE f.engagement_id = g.id AND f.rating IN ('high','critical')) high_findings,
      (SELECT COUNT(*) FROM ia_steps s WHERE s.engagement_id = g.id) steps, (SELECT COUNT(*) FROM ia_steps s WHERE s.engagement_id = g.id AND s.result <> 'not_started') steps_done
    FROM ia_engagements g LEFT JOIN ia_universe u ON u.id = g.universe_id LEFT JOIN users l ON l.id = g.lead_id WHERE ${q.year ? 'g.plan_year = ?' : '1=1'} ORDER BY g.plan_year DESC, g.planned_start, g.id`, q.year ? [q.year] : []);
}
async function engagement(id) {
  const g = await db.one(`SELECT g.*, u.name universe_name, u.area, l.name lead_name, r.name reviewed_by_name FROM ia_engagements g LEFT JOIN ia_universe u ON u.id = g.universe_id LEFT JOIN users l ON l.id = g.lead_id LEFT JOIN users r ON r.id = g.reviewed_by WHERE g.id = ?`, [id]);
  if (!g) throw notFound('Engagement');
  g.steps = await db.query('SELECT s.*, d.name done_by_name, r.name reviewed_by_name FROM ia_steps s LEFT JOIN users d ON d.id = s.done_by LEFT JOIN users r ON r.id = s.reviewed_by WHERE s.engagement_id = ? ORDER BY s.sort_order, s.id', [id]);
  g.findings = await db.query(`SELECT f.* FROM ia_findings f WHERE f.engagement_id = ? ORDER BY FIELD(f.rating, 'critical','high','medium','low'), f.id`, [id]);
  for (const f of g.findings) f.actions = await db.query('SELECT a.*, v.name verified_by_name FROM ia_actions a LEFT JOIN users v ON v.id = a.verified_by WHERE a.finding_id = ? ORDER BY a.id', [f.id]);
  return g;
}
async function saveEngagement(user, b, id = null) {
  const v = {};
  if (b.title !== undefined || !id) { v.title = String(b.title || '').trim().slice(0, 200); if (!v.title) throw bad('Give the engagement a title'); }
  for (const k of ['objectives', 'scope', 'methodology', 'executive_summary', 'conclusion']) if (b[k] !== undefined) v[k] = b[k] || null;
  for (const k of ['team', 'auditee']) if (b[k] !== undefined) v[k] = b[k] ? String(b[k]).slice(0, k === 'team' ? 255 : 120) : null;
  for (const k of ['planned_start', 'planned_end', 'actual_start', 'actual_end']) if (b[k] !== undefined) v[k] = b[k] || null;
  if (b.universe_id !== undefined) v.universe_id = Number(b.universe_id) || null;
  if (b.lead_id !== undefined) v.lead_id = Number(b.lead_id) || null;
  if (b.budget_days !== undefined) v.budget_days = b.budget_days === '' ? null : Number(b.budget_days);
  if (b.kind !== undefined) v.kind = ['assurance', 'compliance', 'financial', 'it', 'investigation', 'follow_up', 'consulting'].includes(b.kind) ? b.kind : 'assurance';
  if (b.overall_rating !== undefined) v.overall_rating = ['satisfactory', 'needs_improvement', 'unsatisfactory'].includes(b.overall_rating) ? b.overall_rating : null;
  if (!id) {
    v.plan_year = Number(b.plan_year) || Number(today().slice(0, 4)); v.created_by = user.id; v.lead_id = v.lead_id || user.id;
    id = (await db.query('INSERT INTO ia_engagements SET ?', [v])).insertId;
    await db.query('UPDATE ia_engagements SET number = ? WHERE id = ?', [`IA/${v.plan_year}/${pad(id, 3)}`, id]);
    if (b.programme && PROGRAMMES[b.programme]) await loadProgramme(id, b.programme);
  } else {
    const g = await db.one('SELECT status FROM ia_engagements WHERE id = ?', [id]); if (!g) throw notFound('Engagement');
    if (['final', 'closed'].includes(g.status) && Object.keys(v).some(k => !['conclusion'].includes(k))) throw bad('The report is issued – the engagement can no longer be changed');
    if (Object.keys(v).length) await db.query('UPDATE ia_engagements SET ? WHERE id = ?', [v, id]);
  }
  return id;
}
async function loadProgramme(id, key) {
  const p = PROGRAMMES[key]; if (!p) throw bad('Unknown work programme');
  const n = (await db.one('SELECT COUNT(*) n FROM ia_steps WHERE engagement_id = ?', [id])).n;
  for (const [i, [ref, obj, proc, test]] of p.steps.entries()) await db.query('INSERT INTO ia_steps (engagement_id, ref, objective, procedure_text, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?)', [id, ref, obj, proc, test ? `[data test: ${test}]` : null, Number(n) + i]);
  return p.steps.length;
}
/** move the engagement on; the reviewer must not be the engagement lead */
async function advance(user, id, b = {}) {
  const g = await db.one('SELECT * FROM ia_engagements WHERE id = ?', [id]); if (!g) throw notFound('Engagement');
  const next = b.to || STATUS_FLOW[STATUS_FLOW.indexOf(g.status) + 1];
  if (b.to === 'cancelled') { if (['final', 'closed'].includes(g.status)) throw bad('An issued report cannot be cancelled'); await db.query(`UPDATE ia_engagements SET status = 'cancelled' WHERE id = ?`, [id]); return { status: 'cancelled' }; }
  if (!next || STATUS_FLOW.indexOf(next) !== STATUS_FLOW.indexOf(g.status) + 1) throw bad('Engagements move one step at a time');
  const v = { status: next };
  if (next === 'fieldwork') v.actual_start = g.actual_start || today();
  if (next === 'review') {
    const open = (await db.one(`SELECT COUNT(*) n FROM ia_steps WHERE engagement_id = ? AND result = 'not_started'`, [id])).n;
    if (Number(open)) throw bad(`${open} work programme steps are not done yet`);
    v.actual_end = today();
  }
  if (next === 'draft_report') {
    if (g.lead_id === user.id && !user.permissions.includes('*')) throw bad('The review is done by someone other than the engagement lead');
    v.reviewed_by = user.id; v.reviewed_at = new Date();
  }
  if (next === 'final') {
    if (!g.executive_summary || !g.overall_rating) throw bad('Write the executive summary and give the overall rating before issuing the report');
    const noResp = (await db.one(`SELECT COUNT(*) n FROM ia_findings WHERE engagement_id = ? AND (management_response IS NULL OR management_response = '')`, [id])).n;
    if (Number(noResp)) throw bad(`${noResp} findings have no management response yet`);
    const noAct = (await db.one(`SELECT COUNT(*) n FROM ia_findings f WHERE f.engagement_id = ? AND f.agreed = 1 AND NOT EXISTS (SELECT 1 FROM ia_actions a WHERE a.finding_id = f.id)`, [id])).n;
    if (Number(noAct)) throw bad(`${noAct} agreed findings have no action plan`);
    v.issued_at = new Date();
    await db.query(`UPDATE ia_findings SET status = IF(agreed = 0, 'risk_accepted', 'open') WHERE engagement_id = ? AND status IN ('draft','agreed')`, [id]);
    if (g.universe_id) await db.query('UPDATE ia_universe SET last_audited = ?, control_rating = ? WHERE id = ?', [today(), g.overall_rating === 'satisfactory' ? 'strong' : g.overall_rating === 'needs_improvement' ? 'adequate' : 'weak', g.universe_id]);
  }
  if (next === 'closed') {
    const open = (await db.one(`SELECT COUNT(*) n FROM ia_actions a JOIN ia_findings f ON f.id = a.finding_id WHERE f.engagement_id = ? AND a.status NOT IN ('verified','not_implemented')`, [id])).n;
    if (Number(open)) throw bad(`${open} agreed actions are not yet verified`);
  }
  await db.query('UPDATE ia_engagements SET ? WHERE id = ?', [v, id]);
  return { status: next };
}

/* ---------------- work programme ---------------- */
async function saveStep(user, engagementId, b, id = null) {
  const g = await db.one('SELECT status FROM ia_engagements WHERE id = ?', [engagementId]); if (!g) throw notFound('Engagement');
  if (['final', 'closed', 'cancelled'].includes(g.status)) throw bad('The engagement is finished');
  const v = {};
  for (const k of ['ref', 'objective']) if (b[k] !== undefined) v[k] = b[k] ? String(b[k]).slice(0, k === 'ref' ? 20 : 255) : null;
  if (b.procedure_text !== undefined || !id) { v.procedure_text = String(b.procedure_text || '').trim(); if (!v.procedure_text) throw bad('Describe the audit procedure'); }
  for (const k of ['sample_size', 'exceptions']) if (b[k] !== undefined) v[k] = b[k] === '' || b[k] === null ? null : Math.max(0, Math.round(Number(b[k])));
  if (b.notes !== undefined) v.notes = b.notes || null;
  if (b.result !== undefined) {
    v.result = ['not_started', 'satisfactory', 'exceptions', 'not_applicable'].includes(b.result) ? b.result : 'not_started';
    if (v.result !== 'not_started') { v.done_by = user.id; v.done_at = new Date(); }
    if (v.result === 'exceptions' && !(Number(b.exceptions ?? 1) > 0)) throw bad('Say how many exceptions were found');
  }
  if (b.review) { const s = await db.one('SELECT done_by FROM ia_steps WHERE id = ?', [id]); if (s && s.done_by === user.id) throw bad('A step is reviewed by someone other than who did it'); v.reviewed_by = user.id; v.reviewed_at = new Date(); }
  if (id) await db.query('UPDATE ia_steps SET ? WHERE id = ? AND engagement_id = ?', [v, id, engagementId]);
  else id = (await db.query('INSERT INTO ia_steps SET ?', [{ ...v, engagement_id: engagementId, sort_order: 999 }])).insertId;
  return id;
}
/** run the data test linked to a step and keep the result as evidence */
async function runStepTest(user, stepId, from, to) {
  const s = await db.one('SELECT * FROM ia_steps WHERE id = ?', [stepId]); if (!s) throw notFound('Step');
  const m = /\[data test: (\w+)\]/.exec(s.notes || ''); if (!m) throw bad('This step has no data test');
  const ex = await require('./audit').exceptions(from, to); const t = ex.tests.find(x => x.key === m[1]); if (!t) throw bad('Unknown data test');
  const note = `${(s.notes || '').replace(/\n\[result [^\]]*\][\s\S]*$/, '')}\n[result ${today()} ${from}…${to}] ${t.title}: ${t.count} item(s).`;
  await db.query('UPDATE ia_steps SET notes = ?, sample_size = COALESCE(sample_size, ?), exceptions = ? WHERE id = ?', [note, t.count, t.count, stepId]);
  return { test: t.key, title: t.title, count: t.count, rows: t.rows.slice(0, 200), cols: t.cols };
}

/* ---------------- findings & actions ---------------- */
async function saveFinding(user, engagementId, b, id = null) {
  const g = await db.one('SELECT status FROM ia_engagements WHERE id = ?', [engagementId]); if (!g) throw notFound('Engagement');
  const v = {};
  if (b.title !== undefined || !id) { v.title = String(b.title || '').trim().slice(0, 200); if (!v.title) throw bad('Give the finding a title'); }
  if (b.condition_text !== undefined || !id) { v.condition_text = String(b.condition_text || '').trim(); if (!v.condition_text) throw bad('Describe what was found (condition)'); }
  if (b.recommendation !== undefined || !id) { v.recommendation = String(b.recommendation || '').trim(); if (!v.recommendation) throw bad('Give the recommendation'); }
  for (const k of ['criteria', 'cause', 'effect', 'management_response']) if (b[k] !== undefined) v[k] = b[k] || null;
  if (b.response_by !== undefined) v.response_by = b.response_by || null;
  if (b.agreed !== undefined) v.agreed = b.agreed === '' || b.agreed === null ? null : (b.agreed ? 1 : 0);
  if (b.rating !== undefined) v.rating = RISK_ORDER[b.rating] ? b.rating : 'medium';
  if (b.amount !== undefined) v.amount = b.amount === '' || b.amount === null ? null : round2(b.amount);
  for (const k of ['source_entity']) if (b[k] !== undefined) v[k] = b[k] || null;
  if (b.source_id !== undefined) v.source_id = Number(b.source_id) || null;
  if (['final', 'closed'].includes(g.status) && Object.keys(v).some(k => k !== 'management_response')) throw bad('The report is issued – findings can no longer be changed');
  if (v.management_response && v.agreed === undefined && !id) v.agreed = 1;
  if (id) await db.query('UPDATE ia_findings SET ? WHERE id = ? AND engagement_id = ?', [v, id, engagementId]);
  else {
    const n = (await db.one('SELECT COUNT(*) n FROM ia_findings WHERE engagement_id = ?', [engagementId])).n;
    id = (await db.query('INSERT INTO ia_findings SET ?', [{ ...v, engagement_id: engagementId, ref: `F${Number(n) + 1}`, created_by: user.id }])).insertId;
  }
  return id;
}
async function saveAction(user, findingId, b, id = null) {
  const f = await db.one('SELECT * FROM ia_findings WHERE id = ?', [findingId]); if (!f) throw notFound('Finding');
  const v = {};
  if (b.action_text !== undefined || !id) { v.action_text = String(b.action_text || '').trim(); if (!v.action_text) throw bad('Describe the action management will take'); }
  if (b.owner !== undefined || !id) { v.owner = String(b.owner || '').trim().slice(0, 80); if (!v.owner) throw bad('Name the person responsible'); }
  if (b.owner_user_id !== undefined) v.owner_user_id = Number(b.owner_user_id) || null;
  if (b.due_date !== undefined || !id) { if (!/^\d{4}-\d{2}-\d{2}$/.test(b.due_date || '')) throw bad('Give the due date'); v.due_date = b.due_date; }
  if (id) await db.query('UPDATE ia_actions SET ? WHERE id = ? AND finding_id = ?', [v, id, findingId]); else id = (await db.query('INSERT INTO ia_actions SET ?', [{ ...v, finding_id: findingId }])).insertId;
  return id;
}
/** the action owner reports progress; the auditor verifies (or records not implemented) */
async function actionUpdate(user, id, b) {
  const a = await db.one('SELECT a.*, f.engagement_id FROM ia_actions a JOIN ia_findings f ON f.id = a.finding_id WHERE a.id = ?', [id]); if (!a) throw notFound('Action');
  const isAuditor = user.permissions.includes('*') || user.permissions.includes('internal_audit');
  const v = {};
  if (b.status && ['in_progress', 'implemented', 'overdue_extended'].includes(b.status)) {
    if (!isAuditor && a.owner_user_id !== user.id) throw bad('Only the action owner or internal audit can update this action');
    v.status = b.status; v.progress_note = b.progress_note || a.progress_note;
    if (b.status === 'overdue_extended') { if (!b.revised_due) throw bad('Give the new due date'); v.revised_due = b.revised_due; }
  } else if (b.status && ['verified', 'not_implemented'].includes(b.status)) {
    if (!isAuditor) throw bad('Internal audit verifies actions');
    if (b.status === 'verified' && a.status !== 'implemented') throw bad('Management must first report the action as implemented');
    v.status = b.status; v.verified_by = user.id; v.verified_at = new Date(); v.verification_note = b.verification_note || null;
    if (!v.verification_note) throw bad('Record the evidence you checked');
  } else throw bad('Choose the new status');
  await db.query('UPDATE ia_actions SET ? WHERE id = ?', [v, id]);
  // a finding is resolved when all its actions are verified
  const left = (await db.one(`SELECT COUNT(*) n FROM ia_actions WHERE finding_id = ? AND status NOT IN ('verified')`, [a.finding_id])).n;
  if (!Number(left)) await db.query(`UPDATE ia_findings SET status = 'resolved' WHERE id = ?`, [a.finding_id]);
}
async function actions(q = {}) {
  const rows = await db.query(`SELECT a.*, f.title finding, f.rating, f.ref finding_ref, g.number engagement_no, g.title engagement, g.id engagement_id, COALESCE(a.revised_due, a.due_date) effective_due
    FROM ia_actions a JOIN ia_findings f ON f.id = a.finding_id JOIN ia_engagements g ON g.id = f.engagement_id WHERE g.status IN ('final','closed') ${q.mine ? 'AND a.owner_user_id = ?' : ''}
    ORDER BY FIELD(a.status, 'open','in_progress','overdue_extended','implemented','verified','not_implemented'), effective_due`, q.mine ? [q.mine] : []);
  return rows.map(a => ({ ...a, overdue: !['implemented', 'verified', 'not_implemented'].includes(a.status) && String(a.effective_due).slice(0, 10) < today() }));
}

/* ---------------- dashboard & report ---------------- */
async function dashboard(year) {
  year = Number(year) || Number(today().slice(0, 4));
  const eng = await engagements({ year });
  const acts = await actions();
  const u = await universe();
  const done = acts.filter(a => ['verified', 'implemented'].includes(a.status)).length, closedish = acts.filter(a => ['verified', 'not_implemented', 'implemented'].includes(a.status)).length;
  const fnd = await db.query(`SELECT f.rating, f.status, COUNT(*) n FROM ia_findings f JOIN ia_engagements g ON g.id = f.engagement_id WHERE g.plan_year = ? GROUP BY f.rating, f.status`, [year]);
  return { year, engagements: { planned: eng.length, by_status: STATUS_FLOW.concat('cancelled').map(s => ({ status: s, n: eng.filter(e => e.status === s).length })), completed: eng.filter(e => ['final', 'closed'].includes(e.status)).length },
    findings: ['critical', 'high', 'medium', 'low'].map(r => ({ rating: r, total: fnd.filter(x => x.rating === r).reduce((s, x) => s + Number(x.n), 0), open: fnd.filter(x => x.rating === r && ['open', 'agreed', 'draft'].includes(x.status)).reduce((s, x) => s + Number(x.n), 0) })),
    actions: { total: acts.length, open: acts.filter(a => !['verified', 'not_implemented'].includes(a.status)).length, overdue: acts.filter(a => a.overdue).length, implementation_rate: closedish ? Math.round(done / closedish * 100) : null,
      overdue_list: acts.filter(a => a.overdue).slice(0, 50) },
    coverage: { areas: u.length, high_risk: u.filter(x => x.risk_level === 'high').length, high_risk_planned: u.filter(x => x.risk_level === 'high' && eng.some(e => e.universe_id === x.id)).length, overdue_areas: u.filter(x => x.overdue).length } };
}
/** everything the engagement report needs, in order */
async function report(id) {
  const g = await engagement(id);
  const co = (await db.getSetting('company', {})) || {};
  const count = r => g.findings.filter(f => f.rating === r).length;
  return { company: co, engagement: g, summary: { critical: count('critical'), high: count('high'), medium: count('medium'), low: count('low'), steps: g.steps.length, exceptions: g.steps.filter(s => s.result === 'exceptions').length },
    distribution: ['Accounting officer / managing director', 'Audit committee', g.auditee ? `Head of ${g.auditee}` : 'Head of the audited area'], generated_at: new Date().toISOString() };
}

module.exports = { PROGRAMMES, universe, saveUniverse, seedUniverse, engagements, engagement, saveEngagement, loadProgramme, advance, saveStep, runStepTest, saveFinding, saveAction, actionUpdate, actions, dashboard, report };
