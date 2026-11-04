// CRM pipeline (leads → quotation → won/lost), contracts with recurring invoices, and file attachments on any record
const express = require('express');
const db = require('../db');
const { requirePerm, can } = require('../auth');
const { ah, bad, notFound, round2, pad, today, HttpError } = require('../util');
const stock = require('../services/stock');

const r = express.Router();
const SOURCES = ['walk_in', 'phone', 'whatsapp', 'facebook', 'referral', 'website', 'tender', 'other'];

/* ======================= PIPELINE ======================= */
r.get('/crm/stages', requirePerm('crm'), ah(async (req, res) => res.json(await db.query('SELECT * FROM crm_stages WHERE active = 1 ORDER BY sort, id'))));
r.put('/crm/stages', requirePerm('settings'), ah(async (req, res) => {
  const list = (req.body.stages || []).filter(s => String(s.name || '').trim());
  if (list.length < 2) throw bad('Keep at least two stages');
  await db.tx(async c => {
    const keep = [];
    for (const [i, s] of list.entries()) {
      const p = Math.max(0, Math.min(100, Math.round(Number(s.probability) || 0)));
      if (s.id) { await c.query('UPDATE crm_stages SET name = ?, sort = ?, probability = ?, active = 1 WHERE id = ?', [String(s.name).slice(0, 60), i + 1, p, s.id]); keep.push(Number(s.id)); }
      else keep.push((await c.query('INSERT INTO crm_stages (name, sort, probability) VALUES (?, ?, ?)', [String(s.name).slice(0, 60), i + 1, p])).insertId);
    }
    await c.query('UPDATE crm_stages SET active = 0 WHERE id NOT IN (?)', [keep]);
    await c.query(`UPDATE leads SET stage_id = ? WHERE status = 'open' AND (stage_id IS NULL OR stage_id NOT IN (?))`, [keep[0], keep]);
  });
  res.json(await db.query('SELECT * FROM crm_stages WHERE active = 1 ORDER BY sort, id'));
}));

const LEAD_SQL = `SELECT l.*, s.name stage_name, s.sort stage_sort, COALESCE(l.probability, s.probability) prob, p.name partner_name, u.name owner_name, so.number sale_order_number, so.quote_number, so.status sale_status,
    (SELECT MIN(a.due_at) FROM crm_activities a WHERE a.lead_id = l.id AND a.done = 0) next_activity,
    (SELECT a.subject FROM crm_activities a WHERE a.lead_id = l.id AND a.done = 0 ORDER BY a.due_at IS NULL, a.due_at LIMIT 1) next_subject
  FROM leads l LEFT JOIN crm_stages s ON s.id = l.stage_id LEFT JOIN partners p ON p.id = l.partner_id LEFT JOIN users u ON u.id = l.owner_id LEFT JOIN sale_orders so ON so.id = l.sale_order_id`;

r.get('/leads', requirePerm('crm'), ah(async (req, res) => {
  const cond = [], args = [];
  const st = req.query.status || 'open';
  if (st !== 'all') { cond.push('l.status = ?'); args.push(st); }
  if (req.query.mine) { cond.push('l.owner_id = ?'); args.push(req.user.id); }
  if (req.query.q) { cond.push('(l.title LIKE ? OR l.company LIKE ? OR l.contact_name LIKE ? OR l.phone LIKE ? OR p.name LIKE ?)'); for (let i = 0; i < 5; i++) args.push(`%${req.query.q}%`); }
  res.json(await db.query(`${LEAD_SQL} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY s.sort, l.priority DESC, l.expected_close IS NULL, l.expected_close, l.id DESC LIMIT 1000`, args));
}));
r.get('/leads/summary', requirePerm('crm'), ah(async (req, res) => {
  const stages = await db.query(`SELECT s.id, s.name, s.probability, COUNT(l.id) n, COALESCE(SUM(l.expected_value),0) value,
      COALESCE(SUM(l.expected_value * COALESCE(l.probability, s.probability) / 100),0) weighted
    FROM crm_stages s LEFT JOIN leads l ON l.stage_id = s.id AND l.status = 'open' WHERE s.active = 1 GROUP BY s.id ORDER BY s.sort`);
  const w = await db.one(`SELECT SUM(status = 'won') won, SUM(status = 'lost') lost, COALESCE(SUM(CASE WHEN status = 'won' THEN expected_value END),0) won_value
    FROM leads WHERE closed_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)`);
  const reasons = await db.query(`SELECT lost_reason reason, COUNT(*) n FROM leads WHERE status = 'lost' AND closed_at >= DATE_SUB(NOW(), INTERVAL 90 DAY) GROUP BY lost_reason ORDER BY n DESC LIMIT 5`);
  const bySource = await db.query(`SELECT source, COUNT(*) n, SUM(status = 'won') won FROM leads WHERE created_at >= DATE_SUB(NOW(), INTERVAL 180 DAY) GROUP BY source ORDER BY n DESC`);
  stages.forEach(s => { s.value = round2(s.value); s.weighted = round2(s.weighted); s.n = Number(s.n); });
  const won = Number(w.won || 0), lost = Number(w.lost || 0);
  res.json({ stages, open_value: round2(stages.reduce((t, s) => t + s.value, 0)), weighted: round2(stages.reduce((t, s) => t + s.weighted, 0)),
    won_90: won, lost_90: lost, won_value_90: round2(w.won_value), win_rate: won + lost ? Math.round(won / (won + lost) * 100) : null, lost_reasons: reasons, by_source: bySource });
}));
async function getLead(id) {
  const l = await db.one(`${LEAD_SQL} WHERE l.id = ?`, [id]);
  if (!l) throw notFound('Lead');
  l.activities = await db.query('SELECT a.*, u.name assigned_name FROM crm_activities a LEFT JOIN users u ON u.id = a.assigned_to WHERE a.lead_id = ? ORDER BY a.done, a.due_at IS NULL, a.due_at, a.id DESC', [l.id]);
  return l;
}
r.get('/leads/:id(\\d+)', requirePerm('crm'), ah(async (req, res) => res.json(await getLead(req.params.id))));
async function cleanLead(b) {
  const v = { title: String(b.title || '').trim().slice(0, 200) };
  if (!v.title) throw bad('What is the opportunity? e.g. "Uniforms for 120 learners"');
  v.partner_id = Number(b.partner_id) || null;
  for (const [k, n] of [['company', 160], ['contact_name', 120], ['phone', 40], ['email', 120]]) v[k] = b[k] ? String(b[k]).trim().slice(0, n) : null;
  if (!v.partner_id && !v.company && !v.contact_name && !v.phone) throw bad('Choose the customer, or enter a company, contact name or phone');
  v.source = SOURCES.includes(b.source) ? b.source : 'other';
  const st = b.stage_id ? await db.one('SELECT id FROM crm_stages WHERE id = ? AND active = 1', [b.stage_id]) : await db.one('SELECT id FROM crm_stages WHERE active = 1 ORDER BY sort, id LIMIT 1');
  v.stage_id = st ? st.id : null;
  v.expected_value = round2(Math.max(0, Number(b.expected_value) || 0));
  v.probability = b.probability === '' || b.probability == null ? null : Math.max(0, Math.min(100, Math.round(Number(b.probability))));
  v.expected_close = b.expected_close || null;
  v.owner_id = Number(b.owner_id) || null;
  v.priority = [0, 1, 2, 3].includes(Number(b.priority)) ? Number(b.priority) : 1;
  v.notes = b.notes ? String(b.notes).slice(0, 5000) : null;
  return v;
}
r.post('/leads', requirePerm('crm'), ah(async (req, res) => {
  const v = await cleanLead(req.body);
  const ins = await db.query('INSERT INTO leads SET ?', [{ ...v, owner_id: v.owner_id || req.user.id, created_by: req.user.id }]);
  res.json(await getLead(ins.insertId));
}));
r.put('/leads/:id(\\d+)', requirePerm('crm'), ah(async (req, res) => {
  const l = await db.one('SELECT * FROM leads WHERE id = ?', [req.params.id]);
  if (!l) throw notFound();
  // moving a card on the board only sends the stage
  if (Object.keys(req.body).length === 1 && req.body.stage_id) {
    const st = await db.one('SELECT id FROM crm_stages WHERE id = ? AND active = 1', [req.body.stage_id]);
    if (!st) throw bad('Unknown stage');
    await db.query(`UPDATE leads SET stage_id = ?, status = 'open', closed_at = NULL WHERE id = ?`, [st.id, l.id]);
  } else await db.query('UPDATE leads SET ? WHERE id = ?', [await cleanLead({ ...l, ...req.body }), l.id]);
  res.json(await getLead(l.id));
}));
async function ensurePartner(c, l) {
  if (l.partner_id) return l.partner_id;
  const name = l.company || l.contact_name || l.phone;
  const ins = await c.query('INSERT INTO partners (name, phone, email, is_customer, notes) VALUES (?, ?, ?, 1, ?)', [name, l.phone, l.email, l.company && l.contact_name ? `Contact: ${l.contact_name}` : null]);
  await c.query('UPDATE leads SET partner_id = ? WHERE id = ?', [ins.insertId, l.id]);
  await c.query('UPDATE crm_activities SET partner_id = ? WHERE lead_id = ? AND partner_id IS NULL', [ins.insertId, l.id]);
  return ins.insertId;
}
r.post('/leads/:id(\\d+)/won', requirePerm('crm'), ah(async (req, res) => {
  await db.tx(async c => {
    const l = await c.one('SELECT * FROM leads WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!l) throw notFound();
    await ensurePartner(c, l);
    await c.query(`UPDATE leads SET status = 'won', closed_at = NOW(), lost_reason = NULL, expected_value = COALESCE(?, expected_value) WHERE id = ?`,
      [req.body.value !== undefined && req.body.value !== '' ? round2(req.body.value) : null, l.id]);
  });
  res.json(await getLead(req.params.id));
}));
r.post('/leads/:id(\\d+)/lost', requirePerm('crm'), ah(async (req, res) => {
  const reason = String(req.body.reason || '').trim();
  if (!reason) throw bad('Why was it lost? (price, went to a competitor, no budget, no reply…) – this helps you win the next one');
  await db.query(`UPDATE leads SET status = 'lost', closed_at = NOW(), lost_reason = ? WHERE id = ?`, [reason.slice(0, 160), req.params.id]);
  res.json(await getLead(req.params.id));
}));
r.post('/leads/:id(\\d+)/reopen', requirePerm('crm'), ah(async (req, res) => {
  await db.query(`UPDATE leads SET status = 'open', closed_at = NULL, lost_reason = NULL WHERE id = ?`, [req.params.id]);
  res.json(await getLead(req.params.id));
}));
// make a quotation for the lead (creates the customer when needed) and move it to the stage with ~60 % probability
r.post('/leads/:id(\\d+)/quote', requirePerm('sales'), ah(async (req, res) => {
  const out = await db.tx(async c => {
    const l = await c.one('SELECT * FROM leads WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!l) throw notFound();
    if (l.sale_order_id) return { sale_order_id: l.sale_order_id, existing: true };
    const pid = await ensurePartner(c, l);
    const date = today();
    const ins = await c.query(`INSERT INTO sale_orders (partner_id, order_date, valid_until, notes, user_id) VALUES (?, ?, ?, ?, ?)`, [pid, date, stock.addDays(date, 30), l.title.slice(0, 255), req.user.id]);
    await c.query('UPDATE sale_orders SET quote_number = ? WHERE id = ?', [`Q/${date.slice(0, 4)}/${pad(ins.insertId, 5)}`, ins.insertId]);
    const st = await c.one('SELECT id FROM crm_stages WHERE active = 1 AND probability >= 50 ORDER BY sort LIMIT 1');
    await c.query('UPDATE leads SET sale_order_id = ?, stage_id = COALESCE(?, stage_id) WHERE id = ?', [ins.insertId, st ? st.id : null, l.id]);
    return { sale_order_id: ins.insertId };
  });
  res.json(out);
}));

/* ======================= CONTRACTS & RECURRING INVOICES ======================= */
const PERIODS = { weekly: 7, monthly: 1, quarterly: 3, yearly: 12 };
function advance(date, period, every) {
  if (period === 'weekly') return stock.addDays(date, 7 * every);
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number);
  const months = PERIODS[period] * every;
  const t = new Date(y, m - 1 + months, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(d, last));
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
const CT_SQL = `SELECT k.*, p.name partner_name, p.email partner_email, pr.name project_name,
    (SELECT COALESCE(SUM(qty * unit_price),0) FROM contract_lines x WHERE x.contract_id = k.id) amount_excl,
    (SELECT COALESCE(SUM(qty * unit_price * (1 + tax_rate / 100)),0) FROM contract_lines x WHERE x.contract_id = k.id) amount
  FROM contracts k JOIN partners p ON p.id = k.partner_id LEFT JOIN projects pr ON pr.id = k.project_id`;
const monthly = k => { const a = Number(k.amount); return round2(k.period === 'weekly' ? a * 52 / 12 / k.every : a / (PERIODS[k.period] * k.every)); };

r.get('/contracts', requirePerm('invoicing'), ah(async (req, res) => {
  const st = req.query.status || 'current';
  const cond = st === 'current' ? `WHERE k.status IN ('draft','active','paused')` : st === 'all' ? '' : 'WHERE k.status = ?';
  const rows = await db.query(`${CT_SQL} ${cond} ORDER BY k.status = 'active' DESC, k.next_date`, st === 'current' || st === 'all' ? [] : [st]);
  rows.forEach(k => { k.amount = round2(k.amount); k.amount_excl = round2(k.amount_excl); k.monthly = monthly(k); });
  const act = rows.filter(k => k.status === 'active');
  res.json({ rows, mrr: round2(act.reduce((t, k) => t + k.monthly, 0)), due: act.filter(k => String(k.next_date).slice(0, 10) <= today()).length });
}));
async function getContract(id) {
  const k = await db.one(`${CT_SQL} WHERE k.id = ?`, [id]);
  if (!k) throw notFound('Contract');
  k.amount = round2(k.amount); k.amount_excl = round2(k.amount_excl); k.monthly = monthly(k);
  k.lines = await db.query('SELECT x.*, p.name product_name FROM contract_lines x LEFT JOIN products p ON p.id = x.product_id WHERE x.contract_id = ? ORDER BY x.id', [k.id]);
  k.invoices = await db.query(`SELECT id, number, status, invoice_date, due_date, total, amount_paid FROM invoices WHERE contract_id = ? ORDER BY invoice_date DESC, id DESC`, [k.id]);
  k.unpaid = round2(k.invoices.filter(i => ['posted', 'partial'].includes(i.status)).reduce((t, i) => t + Number(i.total) - Number(i.amount_paid), 0));
  return k;
}
r.get('/contracts/:id(\\d+)', requirePerm('invoicing'), ah(async (req, res) => res.json(await getContract(req.params.id))));
async function saveContract(c, id, b, user) {
  const p = await c.one('SELECT id FROM partners WHERE id = ?', [b.partner_id]);
  if (!p) throw bad('Choose the customer');
  const name = String(b.name || '').trim();
  if (!name) throw bad('Name the contract, e.g. "Security – Ha Abia clinic" or "Grade 3 fees 2027"');
  const period = PERIODS[b.period] ? b.period : 'monthly';
  const every = Math.max(1, Math.min(24, Math.round(Number(b.every) || 1)));
  const start = String(b.start_date || today()).slice(0, 10);
  const end = b.end_date ? String(b.end_date).slice(0, 10) : null;
  if (end && end < start) throw bad('The end date is before the start date');
  const lines = [];
  for (const l of b.lines || []) {
    if (!l.product_id && !String(l.description || '').trim()) continue;
    const q = Number(l.qty), u = Number(l.unit_price);
    if (!(q > 0) || !(u >= 0)) throw bad('Every line needs a quantity and a price');
    let desc = String(l.description || '').trim();
    if (!desc && l.product_id) desc = ((await c.one('SELECT name FROM products WHERE id = ?', [l.product_id])) || {}).name || 'Service';
    lines.push([Number(l.product_id) || null, desc.slice(0, 200), q, u, Number(l.tax_rate ?? 15)]);
  }
  if (!lines.length) throw bad('Add what is invoiced each time (e.g. "Monthly security service")');
  const v = { partner_id: p.id, name: name.slice(0, 160), period, every, start_date: start, end_date: end, auto_post: b.auto_post ? 1 : 0,
    due_days: Math.max(0, Math.round(Number(b.due_days ?? 7))), project_id: Number(b.project_id) || null, location_id: Number(b.location_id) || null, notes: b.notes ? String(b.notes).slice(0, 255) : null };
  if (id) {
    const cur = await c.one('SELECT * FROM contracts WHERE id = ?', [id]);
    // the next invoice date only follows the start date until the first invoice is made
    if (!cur.invoices_made) v.next_date = start;
    else if (b.next_date) v.next_date = String(b.next_date).slice(0, 10);
    await c.query('UPDATE contracts SET ? WHERE id = ?', [v, id]);
    await c.query('DELETE FROM contract_lines WHERE contract_id = ?', [id]);
  } else {
    id = (await c.query('INSERT INTO contracts SET ?', [{ ...v, next_date: start, user_id: user.id }])).insertId;
    await c.query('UPDATE contracts SET number = ? WHERE id = ?', [`CON/${new Date().getFullYear()}/${pad(id, 5)}`, id]);
  }
  for (const l of lines) await c.query('INSERT INTO contract_lines (contract_id, product_id, description, qty, unit_price, tax_rate) VALUES (?, ?, ?, ?, ?, ?)', [id, ...l]);
  return id;
}
r.post('/contracts', requirePerm('invoicing'), ah(async (req, res) => { const id = await db.tx(c => saveContract(c, null, req.body, req.user)); res.json(await getContract(id)); }));
r.put('/contracts/:id(\\d+)', requirePerm('invoicing'), ah(async (req, res) => {
  const k = await db.one('SELECT * FROM contracts WHERE id = ?', [req.params.id]);
  if (!k) throw notFound();
  if (k.status === 'ended') throw bad('This contract has ended');
  const lease = await db.one('SELECT number FROM leases WHERE contract_id = ?', [k.id]).catch(() => null);
  if (lease) throw bad(`This contract belongs to lease ${lease.number} – change the rent on the lease`);
  await db.tx(c => saveContract(c, k.id, req.body, req.user)); res.json(await getContract(k.id));
}));
const ctStatus = (from, to) => ah(async (req, res) => {
  const k = await db.one('SELECT * FROM contracts WHERE id = ?', [req.params.id]);
  if (!k) throw notFound();
  if (!from.includes(k.status)) throw bad(`This contract is ${k.status}`);
  await db.query('UPDATE contracts SET status = ? WHERE id = ?', [to, k.id]);
  res.json(await getContract(k.id));
});
r.post('/contracts/:id(\\d+)/activate', requirePerm('invoicing'), ctStatus(['draft', 'paused'], 'active'));
r.post('/contracts/:id(\\d+)/pause', requirePerm('invoicing'), ctStatus(['active'], 'paused'));
r.post('/contracts/:id(\\d+)/end', requirePerm('invoicing'), ctStatus(['draft', 'active', 'paused'], 'ended'));

/**
 * Make every invoice that is due: active contracts whose next date has come (catching up missed periods, at most 24 at a time).
 * Invoices are drafts unless the contract says "post automatically".
 */
async function runDue(user, onlyId) {
  const biz = require('./business');
  const made = [];
  const due = await db.query(`SELECT * FROM contracts WHERE status = 'active' AND next_date <= CURDATE() ${onlyId ? 'AND id = ?' : ''}`, onlyId ? [onlyId] : []);
  for (const k0 of due) {
    let guard = 0;
    while (guard++ < 24) {
      const res = await db.tx(async c => {
        const k = await c.one('SELECT * FROM contracts WHERE id = ? FOR UPDATE', [k0.id]);
        const date = String(k.next_date).slice(0, 10);
        if (k.status !== 'active' || date > today()) return null;
        if (k.end_date && date > String(k.end_date).slice(0, 10)) { await c.query(`UPDATE contracts SET status = 'ended' WHERE id = ?`, [k.id]); return null; }
        const lines = await c.query('SELECT * FROM contract_lines WHERE contract_id = ?', [k.id]);
        const until = stock.addDays(advance(date, k.period, k.every), -1);
        const periodTxt = k.period === 'weekly' && k.every === 1 ? `week from ${date}` : `${date} to ${until}`;
        const u = user || { id: k.user_id, location_id: null };
        const invId = await biz.createInvoice(c, u, { kind: 'customer_invoice', partner_id: k.partner_id, invoice_date: date, due_date: stock.addDays(date, k.due_days), location_id: k.location_id,
          notes: `${k.number} ${k.name} (${periodTxt})`.slice(0, 255),
          lines: biz.calcLines(lines.map(l => ({ product_id: l.product_id, description: `${l.description} – ${periodTxt}`.slice(0, 200), qty: Number(l.qty), unit_price: Number(l.unit_price), tax_rate: Number(l.tax_rate), account_code: l.account_code || null })), 'unit_price') });
        await c.query('UPDATE invoices SET contract_id = ?, project_id = ? WHERE id = ?', [k.id, k.project_id, invId]);
        const lease = await c.one('SELECT id FROM leases WHERE contract_id = ?', [k.id]).catch(() => null);
        if (lease) await c.query('UPDATE invoices SET lease_id = ? WHERE id = ?', [lease.id, invId]);
        let number = null;
        if (k.auto_post) number = (await biz.postInvoice(c, invId, u)).number;
        const next = advance(date, k.period, k.every);
        const ended = k.end_date && next > String(k.end_date).slice(0, 10);
        await c.query(`UPDATE contracts SET next_date = ?, invoices_made = invoices_made + 1, last_invoice_id = ?, status = ? WHERE id = ?`, [next, invId, ended ? 'ended' : 'active', k.id]);
        return { contract: k.number, name: k.name, invoice_id: invId, number, date };
      });
      if (!res) break;
      made.push(res);
    }
  }
  if (made.length) console.log(`[contracts] ${made.length} recurring invoice(s) made`);
  return made;
}
r.post('/contracts/run', requirePerm('invoicing'), ah(async (req, res) => res.json({ invoices: await runDue(req.user, Number(req.body.contract_id) || null) })));

/* ======================= ATTACHMENTS ======================= */
const ENTITIES = { partner: 'partners', lead: 'leads', invoice: 'invoices', purchase: 'purchase_orders', project: 'projects', ticket: 'tickets', contract: 'contracts',
  equipment: 'equipment', employee: 'employees', sale: 'sale_orders', maintenance: 'maintenance_requests', product: 'products',
  lease: 'leases', learner: 'learners', property: 'properties', site: 'sites', incident: 'incidents' };
const MAX = 8 * 1024 * 1024;
async function checkEntity(entity, id) {
  const t = ENTITIES[entity];
  if (!t) throw bad('Files cannot be attached here');
  if (!await db.one(`SELECT id FROM ${t} WHERE id = ?`, [id])) throw notFound();
}
r.get('/attachments', ah(async (req, res) => {
  await checkEntity(req.query.entity, req.query.entity_id);
  res.json(await db.query(`SELECT a.id, a.filename, a.mime, a.size, a.note, a.created_at, a.user_id, u.name user_name FROM attachments a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.entity = ? AND a.entity_id = ? ORDER BY a.id DESC`, [req.query.entity, req.query.entity_id]));
}));
r.post('/attachments', ah(async (req, res) => {
  const b = req.body;
  await checkEntity(b.entity, b.entity_id);
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(String(b.data_url || ''));
  if (!m) throw bad('Choose a file');
  const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
  if (!buf.length) throw bad('The file is empty');
  if (buf.length > MAX) throw bad('Files can be at most 8 MB – scan at a lower resolution or save as PDF');
  const name = String(b.filename || 'file').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 200);
  if (/\.(exe|bat|cmd|com|msi|scr|js|vbs|ps1)$/i.test(name)) throw bad('Program files cannot be attached');
  const ins = await db.query('INSERT INTO attachments (entity, entity_id, filename, mime, size, data, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [b.entity, b.entity_id, name, (m[1] || 'application/octet-stream').slice(0, 100), buf.length, buf, b.note ? String(b.note).slice(0, 200) : null, req.user.id]);
  res.json({ id: ins.insertId, filename: name, size: buf.length });
}));
r.get('/attachments/:id(\\d+)/file', ah(async (req, res) => {
  const a = await db.one('SELECT * FROM attachments WHERE id = ?', [req.params.id]);
  if (!a) throw notFound();
  res.setHeader('Content-Type', a.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(a.filename)}"`);
  res.end(a.data);
}));
r.delete('/attachments/:id(\\d+)', ah(async (req, res) => {
  const a = await db.one('SELECT id, user_id FROM attachments WHERE id = ?', [req.params.id]);
  if (!a) throw notFound();
  if (a.user_id !== req.user.id && !['admin', 'manager'].includes(req.user.role)) throw new HttpError(403, 'Only the person who added the file or a manager can remove it');
  await db.query('DELETE FROM attachments WHERE id = ?', [a.id]);
  res.json({ ok: true });
}));

module.exports = { router: r, runDue, advance };
