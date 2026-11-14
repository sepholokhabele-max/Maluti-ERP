// Policies (editable per-department templates, versions, approval through the delegation of authority, acknowledgements)
// and Legal (document templates filled from S-ERP data, a contract register with expiry alerts, a compliance register).
const db = require('../db');
const { round2, bad, notFound, today, pad } = require('../util');
const T = require('./govtemplates');
const gov = require('./governance');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ymd = d => d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : '';

/* ---------- HTML sanitizer (whitelist) for edited documents ---------- */
const TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'p', 'b', 'i', 'u', 's', 'strong', 'em', 'br', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'blockquote', 'hr', 'a', 'sub', 'sup', 'mark', 'small']);
const ATTRS = new Set(['style', 'class', 'colspan', 'rowspan', 'href', 'align']);
function sanitize(html) {
  let s = String(html || '').slice(0, 2_000_000);
  s = s.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|iframe|object|embed|svg|math|template|noscript|textarea|select|form)[\s\S]*?<\/\1\s*>/gi, '');
  return s.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>|</g, (m, tag, attrs) => {
    if (!tag) return '&lt;';
    const t = tag.toLowerCase(); if (!TAGS.has(t)) return '';
    if (m.startsWith('</')) return `</${t}>`;
    const keep = [];
    String(attrs || '').replace(/([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g, (_, k, __, a, b2, c) => {
      k = k.toLowerCase(); let v = a ?? b2 ?? c ?? '';
      if (!ATTRS.has(k)) return;
      if (k === 'href' && !/^(https?:|mailto:|#)/i.test(v.trim())) return;
      if (k === 'style' && /expression|url\s*\(|javascript|@import|behavio/i.test(v)) return;
      keep.push(`${k}="${v.replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`);
    });
    return `<${t}${keep.length ? ' ' + keep.join(' ') : ''}${t === 'br' || t === 'hr' ? '' : ''}>`;
  });
}

/* ---------- filling placeholders ---------- */
// keys that hold ready-made HTML (built here from escaped data); everything else is escaped
const HTML_KEYS = new Set(['doa_table', 'decision_table', 'schedule', 'partner.overdue_table']);
function fill(html, ctx) {
  return String(html).replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi, (m, k) => {
    const v = ctx[k];
    if (v === '' && /_clause$/.test(k)) return ''; // optional wording that does not apply
    if (v === undefined || v === null || v === '') return `<mark>[${esc(k.replace(/[._]/g, ' '))}]</mark>`;
    return HTML_KEYS.has(k) ? String(v) : esc(v);
  });
}
const placeholders = html => [...new Set([...String(html).matchAll(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi)].map(m => m[1]))];

async function companyCtx() {
  const c = (await db.getSetting('company', {})) || {};
  const ent = c.entity_type ? require('./entity').byKey(c.entity_type) : null;
  const pr = await require('./procurement').settings().catch(() => ({}));
  const ceo = await db.one(`SELECT p.title, u.name FROM positions p LEFT JOIN users u ON u.id = p.user_id WHERE p.active = 1 AND p.reports_to_id IN (SELECT id FROM positions WHERE reports_to_id IS NULL) AND p.is_head = 1 ORDER BY p.id LIMIT 1`).catch(() => null);
  return {
    'company.name': c.name, 'company.address': c.address, 'company.phone': c.phone, 'company.email': c.email, 'company.tax_number': c.tax_number,
    'company.entity': ent ? ent.name.replace(/\s*\(.*\)$/, '').toLowerCase() : 'business',
    'company.reg_no_clause': c.reg_no ? ` (registration number ${c.reg_no})` : '',
    'company.bank_details': c.bank_details || null,
    'signatory.name': ceo && ceo.name, 'signatory.title': ceo && ceo.title,
    'procurement.rfq_max': pr.rfq_max ? money(pr.rfq_max) : null, 'procurement.min_rfq': pr.min_rfq_suppliers, 'procurement.min_restricted': pr.min_restricted_suppliers,
    'procurement.min_opening': pr.min_opening_members, 'procurement.standstill': pr.standstill_days,
    'policy.review_months': 12, date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  };
}
/** the DoA and decision rights as tables (for the Delegation of Authority policy) */
async function doaTables() {
  const gs = await gov.grants();
  const rows = gs.map(g => `<tr><td>${esc(gov.DOC_TYPES[g.doc_type] ? gov.DOC_TYPES[g.doc_type].name : g.doc_type)}</td><td>${esc(g.title)}</td><td>${g.kind === 'concur' ? 'Concurs' : 'Approves'}</td><td>${g.max_amount === null ? 'No limit' : (gov.DOC_TYPES[g.doc_type] || {}).unit === 'days' ? `up to ${Number(g.max_amount)} days` : 'up to M ' + money(g.max_amount)}${Number(g.min_amount) > 0 ? ` (from ${money(g.min_amount)})` : ''}</td></tr>`).join('');
  const ds = await gov.decisions();
  const pos = new Map((await db.query('SELECT id, title FROM positions')).map(p => [String(p.id), p.title]));
  const names = s => String(s || '').split(',').filter(Boolean).map(x => esc(pos.get(x) || '')).join(', ');
  return {
    doa_table: gs.length ? `<table><tr><th>Document</th><th>Position</th><th>Role</th><th>Limit</th></tr>${rows}</table>` : '<p><mark>[No authorities set yet – define them in Governance → Delegation of authority]</mark></p>',
    decision_table: ds.length ? `<table><tr><th>Decision</th><th>Decides</th><th>Recommends</th><th>Consulted</th><th>Informed</th></tr>${ds.map(d => `<tr><td>${esc(d.decision)}</td><td>${esc(d.decides_title)}</td><td>${esc(d.recommends_title || '')}</td><td>${names(d.consulted)}</td><td>${names(d.informed)}</td></tr>`).join('')}</table>` : ''
  };
}
/** context for a legal document from the entity it is made for */
async function entityCtx(source, id) {
  const x = {};
  if (!source || !id) return x;
  const partnerInto = async pid => {
    const p = await db.one('SELECT * FROM partners WHERE id = ?', [pid]); if (!p) throw notFound('Partner');
    Object.assign(x, { 'partner.name': p.name, 'partner.address': p.address, 'other.name': p.name, 'partner.reg_no_clause': p.tax_number ? ` (TIN ${p.tax_number})` : '', _partner_id: p.id });
    const inv = await db.query(`SELECT number, invoice_date, due_date, total, amount_paid FROM invoices WHERE kind = 'customer_invoice' AND partner_id = ? AND status IN ('posted','partial') AND total > amount_paid AND due_date < CURDATE() ORDER BY due_date`, [pid]).catch(() => []);
    if (inv.length) {
      const bal = round2(inv.reduce((s, i) => s + Number(i.total) - Number(i.amount_paid), 0));
      x['partner.balance'] = money(bal);
      x['partner.overdue_table'] = `<table><tr><th>Invoice</th><th>Date</th><th>Due</th><th>Owing (M)</th></tr>${inv.map(i => `<tr><td>${esc(i.number)}</td><td>${esc(ymd(i.invoice_date))}</td><td>${esc(ymd(i.due_date))}</td><td style="text-align:right">${money(Number(i.total) - Number(i.amount_paid))}</td></tr>`).join('')}</table>`;
    }
  };
  if (source === 'partner') await partnerInto(id);
  if (source === 'employee') {
    const e = await db.one(`SELECT e.*, d.name department FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE e.id = ?`, [id]); if (!e) throw notFound('Employee');
    const pos = await db.one('SELECT p.*, r.title reports_title FROM positions p LEFT JOIN positions r ON r.id = p.reports_to_id WHERE p.active = 1 AND (p.employee_id = ? OR (p.user_id IS NOT NULL AND p.user_id = ?))', [e.id, e.user_id || 0]);
    Object.assign(x, { 'employee.name': `${e.first_name} ${e.last_name}`, 'employee.id_number': e.id_number, 'employee.address': e.address, 'employee.job_title': (pos && pos.title) || e.job_title,
      'employee.department': e.department, 'employee.reports_to': pos && pos.reports_title, 'employee.employment_type': String(e.employment_type || 'permanent').replace('_', '-'),
      'employee.start_date': ymd(e.hire_date), 'employee.salary': e.basic_salary ? money(e.basic_salary) : null, 'employee.end_clause': '', 'other.name': `${e.first_name} ${e.last_name}`, _employee_id: e.id });
  }
  if (source === 'tender') {
    const t = await db.one('SELECT * FROM tenders WHERE id = ?', [id]); if (!t) throw notFound('Procurement');
    if (t.awarded_to) await partnerInto(t.awarded_to);
    const lines = await db.query('SELECT * FROM tender_lines WHERE tender_id = ?', [id]);
    const bid = t.recommended_bid_id ? await db.one('SELECT * FROM tender_bids WHERE id = ?', [t.recommended_bid_id]) : null;
    Object.assign(x, { 'tender.title': t.title, 'tender.number': t.number, 'tender.method': { open: 'open tender', restricted: 'restricted tender', rfq: 'request for quotations', waiver: 'direct procurement (waiver)' }[t.method],
      'tender.clause': ` (procurement ${t.number})`, 'contract.value': t.award_value ? money(t.award_value) : bid ? money(bid.total) : null, _value: Number(t.award_value || (bid && bid.total) || 0),
      schedule: lines.length ? `<table><tr><th>Item</th><th>Qty</th><th>Unit</th></tr>${lines.map(l => `<tr><td>${esc(l.description)}</td><td>${Number(l.qty)}</td><td>${esc(l.uom || '')}</td></tr>`).join('')}</table><p>Prices as in the Contractor's bid.</p>` : null });
  }
  if (source === 'water_account') {
    const a = await db.one(`SELECT a.*, t.name tariff, m.serial FROM water_accounts a LEFT JOIN water_tariffs t ON t.id = a.tariff_id LEFT JOIN water_meters m ON m.id = a.meter_id WHERE a.id = ?`, [id]); if (!a) throw notFound('Water account');
    await partnerInto(a.partner_id);
    Object.assign(x, { 'account.number': a.account_no, 'account.address': a.address, 'account.plot_clause': a.plot_no ? `, plot ${a.plot_no}` : '', 'account.meter': a.serial || '(to be installed)',
      'account.billing': a.billing, 'account.tariff': a.tariff, 'account.deposit': money(a.deposit_held) });
  }
  return x;
}

/* ============================== policies ============================== */
const POL_SQL = `SELECT p.*, u.name unit_name, o.title owner_title, v.version current_version, v.effective_date, v.approved_at, d.version draft_version
  FROM policies p LEFT JOIN org_units u ON u.id = p.unit_id LEFT JOIN positions o ON o.id = p.owner_position_id LEFT JOIN policy_versions v ON v.id = p.current_version_id LEFT JOIN policy_versions d ON d.id = p.draft_version_id`;
function policyTemplates() {
  return Object.entries(T.POLICIES).map(([dk, d]) => ({ key: dk, name: d.name, items: Object.entries(d.items).map(([k, v]) => ({ key: `${dk}.${k}`, title: v.title })) }));
}
function policyTemplate(key) { const [d, k] = String(key || '').split('.'); const t = T.POLICIES[d] && T.POLICIES[d].items[k]; if (!t) throw bad('Unknown template'); return { dept: T.POLICIES[d].name, ...t }; }
async function policies(user) {
  const rows = await db.query(`${POL_SQL} ORDER BY p.department, p.title`);
  for (const p of rows) {
    p.acks = p.current_version_id ? Number((await db.one('SELECT COUNT(*) n FROM policy_acks WHERE version_id = ?', [p.current_version_id])).n) : 0;
    p.acked = p.current_version_id ? !!(await db.one('SELECT 1 x FROM policy_acks WHERE version_id = ? AND user_id = ?', [p.current_version_id, user.id])) : false;
  }
  return rows;
}
async function createPolicy(user, b) {
  let title = String(b.title || '').trim(), content = b.content ? sanitize(b.content) : '', department = b.department || null;
  if (b.template_key) {
    const t = policyTemplate(b.template_key);
    title = title || t.title; department = department || t.dept;
    const ctx = { ...(await companyCtx()), ...(await doaTables()) };
    if (b.owner_position_id) { const p = await db.one('SELECT title FROM positions WHERE id = ?', [b.owner_position_id]); if (p) ctx['policy.owner'] = p.title; }
    content = fill(t.html(), ctx);
  }
  if (!title) throw bad('Give the policy a title');
  if (!content) content = `<h1>${esc(title)}</h1><p></p>`;
  return db.tx(async c => {
    const id = (await c.query('INSERT INTO policies (title, unit_id, department, template_key, owner_position_id, review_months, requires_ack, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [title.slice(0, 200), Number(b.unit_id) || null, department, b.template_key || null, Number(b.owner_position_id) || null, Math.max(1, Number(b.review_months) || 12), ['none', 'unit', 'all'].includes(b.requires_ack) ? b.requires_ack : 'all', user.id])).insertId;
    await c.query('UPDATE policies SET code = ? WHERE id = ?', [`POL-${pad(id, 3)}`, id]);
    const v = (await c.query('INSERT INTO policy_versions (policy_id, version, content, change_note, created_by) VALUES (?, 1, ?, ?, ?)', [id, content, 'First draft', user.id])).insertId;
    await c.query('UPDATE policies SET draft_version_id = ? WHERE id = ?', [v, id]);
    return id;
  });
}
async function getPolicy(id, user) {
  const p = await db.one(`${POL_SQL} WHERE p.id = ?`, [id]); if (!p) throw notFound('Policy');
  p.versions = await db.query('SELECT v.id, v.version, v.change_note, v.created_at, v.approved_at, v.effective_date, u.name created_by_name, a.name approved_by_name FROM policy_versions v LEFT JOIN users u ON u.id = v.created_by LEFT JOIN users a ON a.id = v.approved_by WHERE v.policy_id = ? ORDER BY v.version DESC', [id]);
  const cur = p.current_version_id ? await db.one('SELECT content FROM policy_versions WHERE id = ?', [p.current_version_id]) : null;
  const dr = p.draft_version_id ? await db.one('SELECT content FROM policy_versions WHERE id = ?', [p.draft_version_id]) : null;
  p.content = cur ? cur.content : null; p.draft = dr ? dr.content : null;
  if (p.current_version_id) {
    p.ack_list = await db.query('SELECT u.name, a.acked_at FROM policy_acks a JOIN users u ON u.id = a.user_id WHERE a.version_id = ? ORDER BY a.acked_at', [p.current_version_id]);
    p.acked = p.ack_list.some(a => a.name === user.name) && !!(await db.one('SELECT 1 x FROM policy_acks WHERE version_id = ? AND user_id = ?', [p.current_version_id, user.id]));
    p.not_acked = p.requires_ack === 'none' ? [] : await db.query('SELECT name FROM users WHERE active = 1 AND id NOT IN (SELECT user_id FROM policy_acks WHERE version_id = ?) ORDER BY name', [p.current_version_id]);
  }
  p.approval = (await gov.history({ doc_type: 'policy', doc_id: id }))[0] || null;
  return p;
}
async function saveDraft(user, id, b) {
  const p = await db.one('SELECT * FROM policies WHERE id = ?', [id]); if (!p) throw notFound('Policy');
  if (p.status === 'in_review') throw bad('The policy is waiting for approval – send it back first to change it');
  const content = sanitize(b.content);
  const meta = {};
  if (b.title) meta.title = String(b.title).slice(0, 200);
  for (const k of ['unit_id', 'owner_position_id']) if (b[k] !== undefined) meta[k] = Number(b[k]) || null;
  if (b.review_months !== undefined) meta.review_months = Math.max(1, Number(b.review_months) || 12);
  if (b.requires_ack !== undefined && ['none', 'unit', 'all'].includes(b.requires_ack)) meta.requires_ack = b.requires_ack;
  if (b.department !== undefined) meta.department = b.department || null;
  if (Object.keys(meta).length) await db.query('UPDATE policies SET ? WHERE id = ?', [meta, id]);
  if (b.content === undefined) return;
  if (p.draft_version_id) await db.query('UPDATE policy_versions SET content = ?, change_note = COALESCE(?, change_note) WHERE id = ?', [content, b.change_note || null, p.draft_version_id]);
  else {
    const n = Number((await db.one('SELECT COALESCE(MAX(version),0) n FROM policy_versions WHERE policy_id = ?', [id])).n) + 1;
    const v = (await db.query('INSERT INTO policy_versions (policy_id, version, content, change_note, created_by) VALUES (?, ?, ?, ?, ?)', [id, n, content, b.change_note || `Revision ${n}`, user.id])).insertId;
    await db.query(`UPDATE policies SET draft_version_id = ?, status = IF(status = 'retired', 'draft', status) WHERE id = ?`, [v, id]);
  }
}
async function publishVersion(c, approverId, p) {
  await c.query('UPDATE policy_versions SET approved_by = ?, approved_at = NOW(), effective_date = ? WHERE id = ?', [approverId, today(), p.draft_version_id]);
  await c.query(`UPDATE policies SET status = 'approved', current_version_id = draft_version_id, draft_version_id = NULL, next_review = DATE_ADD(CURDATE(), INTERVAL review_months MONTH) WHERE id = ?`, [p.id]);
}
/** send the draft for approval: through the DoA when policies are governed, else straight to approved by a governance user */
async function submitPolicy(user, id) {
  const p = await db.one('SELECT * FROM policies WHERE id = ?', [id]); if (!p) throw notFound('Policy');
  if (!p.draft_version_id) throw bad('There is no draft to approve – edit the policy first');
  if (p.status === 'in_review') throw bad('Already waiting for approval');
  return db.tx(async c => {
    const r = await gov.request(c, { doc_type: 'policy', doc_id: id, amount: 0, requester_id: user.id, summary: `Policy: ${p.title}`, link: `#/policies/${id}` });
    if (r.governed) { await c.query(`UPDATE policies SET status = 'in_review' WHERE id = ?`, [id]); return { status: 'in_review', message: `Sent to ${r.next} for approval` }; }
    await c.query(`UPDATE policies SET status = 'in_review' WHERE id = ?`, [id]);
    return { status: 'in_review', message: 'Waiting for a manager to approve' };
  });
}
async function approvePolicy(user, id, b = {}) {
  const p = await db.one('SELECT * FROM policies WHERE id = ?', [id]); if (!p) throw notFound('Policy');
  if (p.status !== 'in_review') throw bad('This policy is not waiting for approval');
  const v = await db.one('SELECT created_by FROM policy_versions WHERE id = ?', [p.draft_version_id]);
  return db.tx(async c => {
    if (b.reject) { await gov.reject(c, user, { doc_type: 'policy', doc_id: id, note: b.note }); await c.query(`UPDATE policies SET status = IF(current_version_id IS NULL, 'draft', 'approved') WHERE id = ?`, [id]); return { status: 'returned' }; }
    const out = await gov.authorize(c, user, { doc_type: 'policy', doc_id: id, amount: 0, requester_id: v && v.created_by, summary: `Policy: ${p.title}`, link: `#/policies/${id}`, note: b.note });
    if (!out.governed) {
      if (!user.permissions.includes('*') && !user.permissions.includes('governance')) throw Object.assign(new Error('Only a manager may approve policies'), { status: 403 });
      if (v && v.created_by === user.id && !user.permissions.includes('*')) throw bad('Someone other than the author approves the policy');
    }
    if (!out.final) return { status: 'in_review', message: out.message };
    await publishVersion(c, user.id, p);
    return { status: 'approved' };
  });
}
async function retirePolicy(user, id) { await db.query(`UPDATE policies SET status = 'retired' WHERE id = ?`, [id]); }
async function ack(user, id) {
  const p = await db.one('SELECT current_version_id FROM policies WHERE id = ? AND status = \'approved\'', [id]); if (!p || !p.current_version_id) throw bad('There is no approved version to acknowledge');
  await db.query('INSERT IGNORE INTO policy_acks (version_id, user_id) VALUES (?, ?)', [p.current_version_id, user.id]);
}
/** approved policies this user has not yet read and acknowledged */
async function unread(user) {
  return db.query(`SELECT p.id, p.title, p.department FROM policies p WHERE p.status = 'approved' AND p.requires_ack <> 'none' AND p.current_version_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM policy_acks a WHERE a.version_id = p.current_version_id AND a.user_id = ?) ORDER BY p.title`, [user.id]);
}

/* ============================== legal documents ============================== */
function legalTemplates() { return Object.entries(T.LEGAL).map(([k, t]) => ({ key: k, name: t.name, category: t.category, source: t.source, placeholders: placeholders(t.html()) })); }
const DOC_SQL = `SELECT d.*, p.name partner_name, CONCAT(e.first_name, ' ', e.last_name) employee_name, o.title owner_title, u.name created_by_name,
  DATEDIFF(d.end_date, CURDATE()) days_left FROM legal_documents d LEFT JOIN partners p ON p.id = d.partner_id LEFT JOIN employees e ON e.id = d.employee_id
  LEFT JOIN positions o ON o.id = d.owner_position_id LEFT JOIN users u ON u.id = d.created_by`;
async function documents(q = {}) {
  const w = [], a = [];
  if (q.status) { w.push('d.status = ?'); a.push(q.status); }
  if (q.category) { w.push('d.category = ?'); a.push(q.category); }
  if (q.entity) { w.push('d.entity = ? AND d.entity_id = ?'); a.push(q.entity, q.entity_id); }
  if (q.expiring) w.push(`d.status IN ('signed','approved') AND d.end_date IS NOT NULL AND d.end_date <= DATE_ADD(CURDATE(), INTERVAL GREATEST(COALESCE(d.renewal_notice_days, 30), ${Number(q.expiring) || 30}) DAY)`);
  return db.query(`${DOC_SQL} ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY d.id DESC LIMIT 500`, a);
}
async function getDocument(id) {
  const d = await db.one(`${DOC_SQL} WHERE d.id = ?`, [id]); if (!d) throw notFound('Document');
  d.approval = (await gov.history({ doc_type: 'legal_document', doc_id: id }))[0] || null;
  return d;
}
/** draft a document from a template, filled from the company and the entity it is for */
async function draft(user, b) {
  const t = T.LEGAL[b.template_key]; if (!t) throw bad('Choose a template');
  const ctx = { ...(await companyCtx()), ...(await entityCtx(t.source, Number(b.entity_id) || null)) };
  for (const [k, v] of Object.entries(b.values || {})) if (/^[a-z0-9_.]+$/i.test(k) && !HTML_KEYS.has(k)) ctx[k] = v;
  const content = fill(t.html(), ctx);
  const v = {
    template_key: b.template_key, title: String(b.title || `${t.name}${ctx['partner.name'] ? ' – ' + ctx['partner.name'] : ctx['employee.name'] ? ' – ' + ctx['employee.name'] : ''}`).slice(0, 200), category: t.category,
    entity: t.source || null, entity_id: Number(b.entity_id) || null, partner_id: ctx._partner_id || null, employee_id: ctx._employee_id || null, content,
    value: b.value !== undefined && b.value !== '' ? round2(b.value) : ctx._value || null, start_date: b.start_date || null, end_date: b.end_date || null,
    renewal_notice_days: Number(b.renewal_notice_days) || null, owner_position_id: Number(b.owner_position_id) || null, created_by: user.id
  };
  const id = (await db.query('INSERT INTO legal_documents SET ?', [v])).insertId;
  await db.query('UPDATE legal_documents SET number = ? WHERE id = ?', [`LGL/${today().slice(0, 4)}/${pad(id, 4)}`, id]);
  return id;
}
async function saveDocument(user, id, b) {
  const d = await db.one('SELECT * FROM legal_documents WHERE id = ?', [id]); if (!d) throw notFound('Document');
  const v = {};
  if (b.content !== undefined) { if (['in_review', 'approved', 'signed'].includes(d.status)) throw bad('An approved or signed document cannot be edited – make a new version (copy) instead'); v.content = sanitize(b.content); }
  if (b.title) v.title = String(b.title).slice(0, 200);
  for (const k of ['start_date', 'end_date', 'signed_date']) if (b[k] !== undefined) v[k] = b[k] || null;
  for (const k of ['renewal_notice_days', 'owner_position_id', 'partner_id']) if (b[k] !== undefined) v[k] = Number(b[k]) || null;
  if (b.value !== undefined) v.value = b.value === '' || b.value === null ? null : round2(b.value);
  if (b.auto_renew !== undefined) v.auto_renew = b.auto_renew ? 1 : 0;
  if (b.notes !== undefined) v.notes = b.notes ? String(b.notes).slice(0, 255) : null;
  if (b.category) v.category = String(b.category).slice(0, 40);
  if (Object.keys(v).length) await db.query('UPDATE legal_documents SET ? WHERE id = ?', [v, id]);
}
async function copyDocument(user, id) {
  const d = await db.one('SELECT * FROM legal_documents WHERE id = ?', [id]); if (!d) throw notFound('Document');
  const { id: _i, number: _n, status: _s, signed_date: _sd, created_at: _c, updated_at: _u, ...rest } = d;
  const nid = (await db.query('INSERT INTO legal_documents SET ?', [{ ...rest, title: `${d.title} (copy)`.slice(0, 200), created_by: user.id }])).insertId;
  await db.query('UPDATE legal_documents SET number = ? WHERE id = ?', [`LGL/${today().slice(0, 4)}/${pad(nid, 4)}`, nid]);
  return nid;
}
async function docAction(user, id, action, b = {}) {
  const d = await db.one('SELECT * FROM legal_documents WHERE id = ?', [id]); if (!d) throw notFound('Document');
  return db.tx(async c => {
    if (action === 'submit') {
      if (!['draft'].includes(d.status)) throw bad('Only a draft can be sent for approval');
      const r = await gov.request(c, { doc_type: 'legal_document', doc_id: id, amount: Number(d.value || 0), requester_id: user.id, summary: `${d.number}: ${d.title}`, link: `#/legal/${id}` });
      await c.query(`UPDATE legal_documents SET status = 'in_review' WHERE id = ?`, [id]);
      return { status: 'in_review', message: r.governed ? `Sent to ${r.next} for approval` : 'Waiting for a manager to approve' };
    }
    if (action === 'approve' || action === 'reject') {
      if (d.status !== 'in_review') throw bad('This document is not waiting for approval');
      if (action === 'reject') { await gov.reject(c, user, { doc_type: 'legal_document', doc_id: id, note: b.note }); await c.query(`UPDATE legal_documents SET status = 'draft' WHERE id = ?`, [id]); return { status: 'draft' }; }
      const out = await gov.authorize(c, user, { doc_type: 'legal_document', doc_id: id, amount: Number(d.value || 0), requester_id: d.created_by, summary: `${d.number}: ${d.title}`, link: `#/legal/${id}`, note: b.note });
      if (!out.governed) {
        if (!user.permissions.includes('*') && !user.permissions.includes('legal')) throw Object.assign(new Error('Only a manager may approve legal documents'), { status: 403 });
        if (d.created_by === user.id && !user.permissions.includes('*')) throw bad('Someone other than the person who drafted it approves it');
      }
      if (!out.final) return { status: 'in_review', message: out.message };
      await c.query(`UPDATE legal_documents SET status = 'approved' WHERE id = ?`, [id]); return { status: 'approved' };
    }
    if (action === 'sign') { if (d.status !== 'approved') throw bad('Only an approved document can be marked signed'); await c.query(`UPDATE legal_documents SET status = 'signed', signed_date = ? WHERE id = ?`, [b.date || today(), id]); return { status: 'signed' }; }
    if (action === 'terminate') { if (!['signed', 'approved'].includes(d.status)) throw bad('Only a signed agreement can be terminated'); await c.query(`UPDATE legal_documents SET status = 'terminated', notes = ? WHERE id = ?`, [String(b.note || 'Terminated').slice(0, 255), id]); return { status: 'terminated' }; }
    if (action === 'renew') {
      if (!d.end_date) throw bad('This agreement has no end date');
      const to = String(b.end_date || '').slice(0, 10); if (!to || to <= ymd(d.end_date)) throw bad('Give the new end date (after the current one)');
      await c.query('UPDATE legal_documents SET end_date = ?, status = \'signed\', notes = ? WHERE id = ?', [to, `Renewed to ${to}`, id]); return { status: 'signed' };
    }
    throw bad('Unknown action');
  });
}
/** mark agreements past their end date as expired (unless they renew themselves) */
async function expireDue() {
  await db.query(`UPDATE legal_documents SET end_date = DATE_ADD(end_date, INTERVAL 1 YEAR) WHERE auto_renew = 1 AND status = 'signed' AND end_date < CURDATE()`);
  await db.query(`UPDATE legal_documents SET status = 'expired' WHERE status = 'signed' AND auto_renew = 0 AND end_date IS NOT NULL AND end_date < CURDATE()`);
}

/* ============================== compliance obligations ============================== */
const obligations = () => db.query(`SELECT o.*, p.title owner_title, DATEDIFF(o.next_due, CURDATE()) days_left FROM legal_obligations o LEFT JOIN positions p ON p.id = o.owner_position_id WHERE o.active = 1 ORDER BY o.next_due IS NULL, o.next_due, o.title`);
async function saveObligation(b, id = null) {
  const v = { title: String(b.title || '').trim().slice(0, 200) }; if (!v.title) throw bad('Describe the obligation');
  for (const [k, n] of [['law', 160], ['authority', 120], ['notes', 255]]) if (b[k] !== undefined) v[k] = b[k] ? String(b[k]).slice(0, n) : null;
  if (b.frequency !== undefined) v.frequency = ['once', 'monthly', 'quarterly', 'yearly'].includes(b.frequency) ? b.frequency : 'yearly';
  if (b.next_due !== undefined) v.next_due = b.next_due || null;
  if (b.owner_position_id !== undefined) v.owner_position_id = Number(b.owner_position_id) || null;
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  if (id) await db.query('UPDATE legal_obligations SET ? WHERE id = ?', [v, id]); else id = (await db.query('INSERT INTO legal_obligations SET ?', [v])).insertId;
  return id;
}
async function obligationDone(id, date) {
  const o = await db.one('SELECT * FROM legal_obligations WHERE id = ?', [id]); if (!o) throw notFound('Obligation');
  const d = String(date || today()).slice(0, 10);
  const months = { monthly: 1, quarterly: 3, yearly: 12 }[o.frequency];
  const base = o.next_due ? ymd(o.next_due) : d;
  let next = null;
  if (months) { const [y, m, dd] = base.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + months, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); next = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(dd, last)).padStart(2, '0')}`; }
  await db.query('UPDATE legal_obligations SET last_done = ?, next_due = ?, active = ? WHERE id = ?', [d, next, months ? 1 : 0, id]);
  return { next_due: next };
}
async function seedObligations() {
  if ((await db.one('SELECT COUNT(*) n FROM legal_obligations')).n > 0) throw bad('The compliance register already has items');
  const y = Number(today().slice(0, 4));
  const isWater = !!(await db.one('SELECT 1 x FROM water_tariffs LIMIT 1').catch(() => null));
  const list = [...T.OBLIGATIONS, ...(isWater ? T.WATER_OBLIGATIONS : [])];
  for (const [title, law, authority, frequency] of list) await saveObligation({ title, law, authority, frequency, next_due: frequency === 'monthly' ? `${today().slice(0, 7)}-20` : frequency === 'quarterly' ? null : `${y}-12-31` });
  return list.length;
}
/** for the dashboard: contracts expiring / obligations due in the next 30 days */
async function alerts() {
  await expireDue();
  const contracts = await documents({ expiring: 30 });
  const due = (await obligations()).filter(o => o.next_due && Number(o.days_left) <= 30);
  return { contracts, obligations: due, count: contracts.length + due.length };
}

module.exports = { sanitize, fill, placeholders, companyCtx, entityCtx, doaTables, policyTemplates, policyTemplate, policies, createPolicy, getPolicy, saveDraft, submitPolicy, approvePolicy, retirePolicy, ack, unread,
  legalTemplates, documents, getDocument, draft, saveDocument, copyDocument, docAction, expireDue, obligations, saveObligation, obligationDone, seedObligations, alerts };
