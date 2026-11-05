// SMS & email campaigns: specials, events and news to a chosen group of customers. The audience is worked out when the
// campaign is sent (so new customers count), people who opted out are never messaged, every message is logged per
// customer and added to their CRM history. Campaigns can go now or at a set time (the hourly scheduler sends them).
const express = require('express');
const db = require('../db');
const sms = require('../services/sms');
const { requirePerm } = require('../auth');
const { ah, bad, notFound, today } = require('../util');

const r = express.Router();
const P = requirePerm('campaigns');
const s = (x, n) => x === undefined || x === null || String(x).trim() === '' ? null : String(x).trim().slice(0, n);

/** audience: { group: customers|tenants|parents|patients|hire|all, tags:[], bought_within, not_bought_for, birthday_month, min_spent, partner_ids:[] } */
function cleanAudience(a = {}) {
  const v = { group: ['customers', 'tenants', 'parents', 'patients', 'hire', 'suppliers', 'all'].includes(a.group) ? a.group : 'customers' };
  v.tags = (Array.isArray(a.tags) ? a.tags : String(a.tags || '').split(',')).map(t => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 10);
  for (const k of ['bought_within', 'not_bought_for', 'min_spent']) v[k] = Number(a[k]) > 0 ? Number(a[k]) : null;
  v.birthday_month = Number(a.birthday_month) >= 1 && Number(a.birthday_month) <= 12 ? Number(a.birthday_month) : null;
  return v;
}
const LASTBUY = `GREATEST(COALESCE((SELECT MAX(o.created_at) FROM orders o WHERE o.partner_id = p.id AND o.status = 'paid'), '1900-01-01'),
  COALESCE((SELECT MAX(i.invoice_date) FROM invoices i WHERE i.partner_id = p.id AND i.kind = 'customer_invoice' AND i.status <> 'draft'), '1900-01-01'))`;
const SPENT = `(COALESCE((SELECT SUM(o.total) FROM orders o WHERE o.partner_id = p.id AND o.status = 'paid'), 0) + COALESCE((SELECT SUM(i.total) FROM invoices i WHERE i.partner_id = p.id AND i.kind = 'customer_invoice' AND i.status IN ('posted','partial','paid')), 0))`;
async function audience(a, channel) {
  const cond = ['p.active = 1', 'p.marketing_opt_out = 0'], args = [];
  const g = a.group;
  if (g === 'customers') cond.push('p.is_customer = 1');
  if (g === 'suppliers') cond.push('p.is_supplier = 1');
  if (g === 'tenants') cond.push(`EXISTS (SELECT 1 FROM leases l WHERE l.tenant_id = p.id AND l.status IN ('active','notice'))`);
  if (g === 'parents') cond.push(`EXISTS (SELECT 1 FROM learners l WHERE l.guardian_id = p.id AND l.status = 'enrolled')`);
  if (g === 'patients') cond.push(`EXISTS (SELECT 1 FROM patients x WHERE x.partner_id = p.id AND x.active = 1)`);
  if (g === 'hire') cond.push(`EXISTS (SELECT 1 FROM hire_orders h WHERE h.partner_id = p.id)`);
  if (a.tags.length) { cond.push('(' + a.tags.map(() => `FIND_IN_SET(?, REPLACE(LOWER(COALESCE(p.tags, '')), ' ', ''))`).join(' OR ') + ')'); args.push(...a.tags.map(t => t.replace(/\s+/g, ''))); }
  if (a.birthday_month) { cond.push('MONTH(p.birthday) = ?'); args.push(a.birthday_month); }
  if (a.bought_within) { cond.push(`${LASTBUY} >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`); args.push(a.bought_within); }
  if (a.not_bought_for) { cond.push(`${LASTBUY} < DATE_SUB(CURDATE(), INTERVAL ? DAY)`); args.push(a.not_bought_for); }
  if (a.min_spent) { cond.push(`${SPENT} >= ?`); args.push(a.min_spent); }
  const reach = channel === 'email' ? `p.email LIKE '%@%'` : channel === 'sms' ? `COALESCE(p.phone, '') <> ''` : `(COALESCE(p.phone, '') <> '' OR p.email LIKE '%@%')`;
  // tags such as medical_aid / supplier-only partners are not marketed to unless asked for
  const rows = await db.query(`SELECT p.id, p.name, p.phone, p.email FROM partners p WHERE ${cond.join(' AND ')} AND ${reach}
    AND NOT FIND_IN_SET('medical_aid', REPLACE(COALESCE(p.tags, ''), ' ', '')) ORDER BY p.name LIMIT 20000`, args);
  const opted = Number((await db.one(`SELECT COUNT(*) n FROM partners p WHERE p.marketing_opt_out = 1 AND p.active = 1`)).n);
  return { rows, opted_out: opted };
}
async function personalise(tpl, x) {
  const c = (await db.getSetting('company', {})) || {};
  const first = String(x.name || '').split(' ')[0];
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => ({ name: x.name, first_name: first, company: c.name || '', phone: c.phone || '' })[k] ?? m);
}
const footer = async ch => { const c = (await db.getSetting('company', {})) || {}; return ch === 'sms' ? (c.phone ? ` STOP? call ${c.phone}` : '') : `\n\n—\nYou receive this because you are a customer of ${c.name || 'ours'}. To stop these messages reply STOP${c.phone ? ` or call ${c.phone}` : ''}.`; };

const CSQL = `SELECT c.*, u.name user_name FROM campaigns c LEFT JOIN users u ON u.id = c.user_id`;
const out = c => ({ ...c, audience: (() => { try { return JSON.parse(c.audience || '{}'); } catch (_) { return {}; } })() });
r.get('/campaigns', P, ah(async (req, res) => res.json((await db.query(`${CSQL} ORDER BY c.id DESC LIMIT 300`)).map(out))));
r.get('/campaigns/:id(\\d+)', P, ah(async (req, res) => {
  const c = await db.one(`${CSQL} WHERE c.id = ?`, [req.params.id]); if (!c) throw notFound();
  const v = out(c);
  v.log = await db.query(`SELECT r.*, p.name FROM campaign_recipients r JOIN partners p ON p.id = r.partner_id WHERE r.campaign_id = ? ORDER BY r.status, p.name LIMIT 3000`, [c.id]);
  res.json(v);
}));
function clean(b) {
  const v = { name: s(b.name, 120) }; if (!v.name) throw bad('Name the campaign, e.g. "Easter specials 2027"');
  v.channel = ['sms', 'email', 'both'].includes(b.channel) ? b.channel : 'sms';
  v.audience = JSON.stringify(cleanAudience(b.audience || {}));
  v.subject = s(b.subject, 160); v.message = s(b.message, 4000);
  return v;
}
r.post('/campaigns', P, ah(async (req, res) => { const ins = await db.query('INSERT INTO campaigns SET ?', [{ ...clean(req.body), user_id: req.user.id }]); res.json({ id: ins.insertId }); }));
r.put('/campaigns/:id(\\d+)', P, ah(async (req, res) => {
  const c = await db.one('SELECT * FROM campaigns WHERE id = ?', [req.params.id]); if (!c) throw notFound();
  if (!['draft', 'scheduled'].includes(c.status)) throw bad('This campaign has been sent');
  await db.query('UPDATE campaigns SET ? WHERE id = ?', [clean({ ...out(c), ...req.body }), c.id]); res.json({ id: c.id });
}));
// how many it would reach, what it costs in SMS parts, and a sample message
r.post('/campaigns/preview', P, ah(async (req, res) => {
  const a = cleanAudience(req.body.audience || {}); const ch = ['sms', 'email', 'both'].includes(req.body.channel) ? req.body.channel : 'sms';
  const { rows, opted_out } = await audience(a, ch);
  const sample = rows[0] || { name: 'Thabo Mokoena' };
  const text = (await personalise(req.body.message, sample)) + (ch !== 'email' ? await footer('sms') : '');
  const parts = Math.max(1, Math.ceil(text.length / 160));
  res.json({ count: rows.length, with_phone: rows.filter(x => x.phone).length, with_email: rows.filter(x => /@/.test(x.email || '')).length, opted_out,
    sms_text: text, sms_parts: parts, sms_total: ch === 'email' ? 0 : rows.filter(x => x.phone).length * parts, sample_names: rows.slice(0, 8).map(x => x.name) });
}));
r.post('/campaigns/:id(\\d+)/test', P, ah(async (req, res) => {
  const c = out(await db.one('SELECT * FROM campaigns WHERE id = ?', [req.params.id]) || {}); if (!c.id) throw notFound();
  const x = { name: req.user.name };
  if (req.body.phone) await sms.send(req.body.phone, (await personalise(c.message, x)) + await footer('sms')).catch(e => { throw bad(e.message); });
  if (req.body.email) await require('../services/mailer').sendMail({ to: req.body.email, subject: await personalise(c.subject || c.name, x), text: (await personalise(c.message, x)) + await footer('email'), kind: 'campaign' }).catch(e => { throw bad(e.message); });
  if (!req.body.phone && !req.body.email) throw bad('Enter your phone or email for the test');
  res.json({ ok: true });
}));
r.post('/campaigns/:id(\\d+)/schedule', P, ah(async (req, res) => {
  const c = await db.one('SELECT * FROM campaigns WHERE id = ?', [req.params.id]); if (!c) throw notFound();
  if (!['draft', 'scheduled'].includes(c.status)) throw bad('This campaign has been sent');
  if (!req.body.at) { await db.query(`UPDATE campaigns SET status = 'draft', scheduled_at = NULL WHERE id = ?`, [c.id]); return res.json({ ok: true }); }
  const at = String(req.body.at).replace('T', ' ').slice(0, 16) + ':00';
  if (new Date(at.replace(' ', 'T')) < new Date(Date.now() - 60000)) throw bad('Choose a time in the future');
  await db.query(`UPDATE campaigns SET status = 'scheduled', scheduled_at = ? WHERE id = ?`, [at, c.id]); res.json({ ok: true });
}));
r.post('/campaigns/:id(\\d+)/send', P, ah(async (req, res) => res.json(await send(Number(req.params.id), req.user))));
r.post('/campaigns/:id(\\d+)/cancel', P, ah(async (req, res) => { await db.query(`UPDATE campaigns SET status = 'cancelled' WHERE id = ? AND status IN ('draft','scheduled')`, [req.params.id]); res.json({ ok: true }); }));
r.put('/partners/:id(\\d+)/opt-out', requirePerm('partners'), ah(async (req, res) => {
  await db.query('UPDATE partners SET marketing_opt_out = ?, opt_out_at = ? WHERE id = ?', [req.body.opt_out ? 1 : 0, req.body.opt_out ? new Date() : null, req.params.id]); res.json({ ok: true });
}));

async function send(id, user) {
  // claim the campaign so it is never sent twice (two clicks, or the scheduler at the same moment)
  const claim = await db.query(`UPDATE campaigns SET status = 'sending' WHERE id = ? AND status IN ('draft','scheduled')`, [id]);
  if (!claim.affectedRows) throw bad('This campaign is already sent or being sent');
  const c = out(await db.one('SELECT * FROM campaigns WHERE id = ?', [id]));
  try {
    if (!String(c.message || '').trim()) throw bad('Write the message first');
    if (c.channel !== 'sms' && !c.subject) c.subject = c.name;
    const { rows } = await audience(c.audience, c.channel);
    if (!rows.length) throw bad('Nobody matches this audience');
    const smsCfg = c.channel !== 'email' ? await sms.settings() : null;
    if (smsCfg && smsCfg.mode === 'off') throw bad('SMS is not set up yet (Reminders → Settings)');
    const mailer = require('../services/mailer');
    const fs = await footer('sms'), fe = await footer('email');
    let sent = 0, failed = 0;
    for (const x of rows) {
      for (const ch of c.channel === 'both' ? ['sms', 'email'] : [c.channel]) {
        const to = ch === 'sms' ? x.phone : x.email; if (!to || (ch === 'email' && !/@/.test(to))) continue;
        let status = 'sent', error = null, dest = to;
        try {
          const text = await personalise(c.message, x);
          if (ch === 'sms') dest = (await sms.send(to, text + fs, smsCfg)).to;
          else await mailer.sendMail({ to, subject: await personalise(c.subject, x), text: text + fe, kind: 'campaign' });
        } catch (e) { status = 'failed'; error = String(e.message).slice(0, 250); }
        await db.query('INSERT INTO campaign_recipients (campaign_id, partner_id, channel, sent_to, status, error) VALUES (?, ?, ?, ?, ?, ?)', [c.id, x.id, ch, dest, status, error]);
        if (status === 'sent') { sent++; await db.query(`INSERT INTO crm_activities (partner_id, type, subject, body, done, done_at, created_by) VALUES (?, ?, ?, ?, 1, NOW(), ?)`, [x.id, ch, `Campaign: ${c.name}`, c.message, user ? user.id : c.user_id]).catch(() => {}); }
        else failed++;
      }
    }
    await db.query(`UPDATE campaigns SET status = 'sent', sent_at = NOW(), recipients = ?, sent = ?, failed = ? WHERE id = ?`, [rows.length, sent, failed, c.id]);
    return { recipients: rows.length, sent, failed };
  } catch (e) {
    await db.query(`UPDATE campaigns SET status = ? WHERE id = ?`, [c.scheduled_at ? 'scheduled' : 'draft', id]);
    throw e;
  }
}
/** scheduled campaigns whose time has come (called hourly with the other background jobs) */
async function runScheduled() {
  const due = await db.query(`SELECT id FROM campaigns WHERE status = 'scheduled' AND scheduled_at <= NOW()`).catch(() => []);
  for (const c of due) {
    try { const o = await send(c.id, null); console.log(`[campaigns] #${c.id}: ${o.sent} sent, ${o.failed} failed`); }
    catch (e) { console.error(`[campaigns] #${c.id}: ${e.message}`); await db.query(`UPDATE campaigns SET status = 'draft' WHERE id = ? AND status = 'scheduled'`, [c.id]).catch(() => {}); }
  }
}

module.exports = { router: r, runScheduled, audience, cleanAudience };
