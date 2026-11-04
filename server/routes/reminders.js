// Payment reminders by SMS, email or WhatsApp for customers with overdue invoices – tenants, parents, contract clients –
// sent by hand from a list or automatically N days after the due date.
const express = require('express');
const db = require('../db');
const sms = require('../services/sms');
const { requirePerm } = require('../auth');
const { ah, bad, round2, today } = require('../util');

const r = express.Router();
const P = requirePerm('reminders');
const SOURCES = {
  all: '1=1',
  rent: 'i.lease_id IS NOT NULL',
  school: 'i.learner_id IS NOT NULL',
  contracts: 'i.contract_id IS NOT NULL AND i.lease_id IS NULL',
  hire: 'i.hire_order_id IS NOT NULL',
  invoices: 'i.lease_id IS NULL AND i.learner_id IS NULL AND i.contract_id IS NULL AND i.hire_order_id IS NULL'
};
const DEFAULT_TEMPLATES = {
  sms: 'Dear {name}, M{amount} is overdue on your {company} account since {oldest_date}{details}. Please pay soon. Queries: {phone}',
  email_subject: 'Payment reminder – {company}',
  email_body: 'Dear {name},\n\nOur records show that M{amount} is overdue on your account since {oldest_date}{details}.\n\nPlease arrange payment as soon as possible. If you have already paid, please send us the proof of payment so we can update your account.\n\nKind regards\n{company}\n{phone}'
};
async function settings() {
  const s = (await db.getSetting('reminders', {})) || {};
  return { templates: { ...DEFAULT_TEMPLATES, ...(s.templates || {}) }, sms: { ...sms.DEFAULTS, ...(s.sms || {}) },
    auto: { enabled: false, days: [3, 14, 30], channel: 'sms', sources: ['rent', 'school', 'contracts'], min_amount: 50, ...(s.auto || {}) }, last_auto_run: s.last_auto_run || null };
}
r.get('/reminders/settings', P, ah(async (req, res) => { const s = await settings(); if (s.sms.headers) s.sms.headers_set = true; res.json(s); }));
r.put('/reminders/settings', requirePerm('settings'), ah(async (req, res) => {
  const cur = await settings(); const b = req.body;
  const smsIn = { ...cur.sms, ...(b.sms || {}) };
  if (!['off', 'log', 'http'].includes(smsIn.mode)) smsIn.mode = 'off';
  if (smsIn.mode === 'http' && !/^https?:\/\//i.test(smsIn.url || '')) throw bad('Enter the SMS provider\'s web address, starting with https://');
  delete smsIn.headers_set;
  const days = [...new Set((b.auto && b.auto.days !== undefined ? String(b.auto.days).split(/[ ,;]+/) : cur.auto.days).map(Number).filter(n => n > 0 && n < 366))].sort((a, c) => a - c);
  const auto = { ...cur.auto, ...(b.auto || {}), days };
  auto.enabled = !!auto.enabled; auto.channel = ['sms', 'email', 'both'].includes(auto.channel) ? auto.channel : 'sms';
  auto.sources = (Array.isArray(auto.sources) ? auto.sources : []).filter(x => SOURCES[x]); auto.min_amount = Math.max(0, Number(auto.min_amount) || 0);
  const templates = { ...cur.templates, ...(b.templates || {}) };
  for (const k of Object.keys(DEFAULT_TEMPLATES)) if (!String(templates[k] || '').trim()) templates[k] = DEFAULT_TEMPLATES[k];
  await db.setSetting('reminders', { sms: smsIn, auto, templates, last_auto_run: cur.last_auto_run });
  res.json(await settings());
}));
r.post('/sms/test', requirePerm('settings'), ah(async (req, res) => {
  const c = (await db.getSetting('company', {})) || {};
  res.json(await sms.send(req.body.to, req.body.message || `Test SMS from ${c.name || 'Maluti ERP'}. If you can read this, SMS reminders work.`).catch(e => { throw bad(e.message); }));
}));

/** customers with overdue invoices (due date passed) for the chosen kind of business, with what to say about them */
async function overdue(source = 'all', minDays = 1) {
  const where = SOURCES[source] || SOURCES.all;
  const rows = await db.query(`SELECT i.partner_id, p.name, p.phone, p.email, SUM(i.total - i.amount_paid) amount, MIN(COALESCE(i.due_date, i.invoice_date)) oldest,
      DATEDIFF(CURDATE(), MIN(COALESCE(i.due_date, i.invoice_date))) days, COUNT(*) invoices,
      (SELECT MAX(l.created_at) FROM reminder_log l WHERE l.partner_id = i.partner_id AND l.status = 'sent') last_reminded
    FROM invoices i JOIN partners p ON p.id = i.partner_id
    WHERE i.kind = 'customer_invoice' AND i.status IN ('posted','partial') AND COALESCE(i.due_date, i.invoice_date) < CURDATE() AND ${where}
    GROUP BY i.partner_id, p.name, p.phone, p.email HAVING amount > 0.004 AND days >= ? ORDER BY days DESC, amount DESC`, [minDays]);
  for (const x of rows) {
    x.amount = round2(x.amount); x.oldest = String(x.oldest).slice(0, 10);
    const units = source === 'school' ? [] : await db.query(`SELECT DISTINCT CONCAT(u.name, ', ', pr.name) n FROM invoices i JOIN leases l ON l.id = i.lease_id JOIN units u ON u.id = l.unit_id JOIN properties pr ON pr.id = u.property_id
      WHERE i.partner_id = ? AND i.status IN ('posted','partial')`, [x.partner_id]).catch(() => []);
    const kids = source === 'rent' ? [] : await db.query(`SELECT DISTINCT l.first_name n FROM invoices i JOIN learners l ON l.id = i.learner_id WHERE i.partner_id = ? AND i.status IN ('posted','partial')`, [x.partner_id]).catch(() => []);
    x.details = [units.length ? ` for ${units.map(u => u.n).join(' & ')}` : '', kids.length ? ` (school fees for ${kids.map(k => k.n).join(', ')})` : ''].join('');
  }
  return rows;
}
r.get('/reminders/due', P, ah(async (req, res) => res.json(await overdue(req.query.source || 'all', Math.max(1, Number(req.query.min_days) || 1)))));

async function personalise(tpl, x) {
  const c = (await db.getSetting('company', {})) || {};
  const v = { name: x.name, amount: x.amount.toFixed(2), oldest_date: x.oldest, days: x.days, details: x.details || '', company: c.name || '', phone: c.phone || '', invoices: x.invoices };
  return String(tpl).replace(/\{(\w+)\}/g, (m, k) => v[k] !== undefined ? v[k] : m);
}
/** send reminders to the chosen customers; each one is logged and added to the customer's CRM history */
async function sendTo(list, { channel, source, user, auto, templates }) {
  const s = await settings(); const t = { ...s.templates, ...(templates || {}) };
  const mailer = require('../services/mailer');
  const results = [];
  for (const x of list) {
    for (const ch of channel === 'both' ? ['sms', 'email'] : [channel]) {
      let status = 'sent', error = null, to = ch === 'sms' ? x.phone : x.email, msg;
      try {
        if (!to) throw new Error(ch === 'sms' ? 'no phone number' : 'no email address');
        if (ch === 'sms') { msg = await personalise(t.sms, x); const out = await sms.send(to, msg, s.sms); to = out.to; }
        else { const subject = await personalise(t.email_subject, x); msg = await personalise(t.email_body, x); await mailer.sendMail({ to, subject, text: msg, kind: 'reminder' }); }
      } catch (e) { status = 'failed'; error = e.message.slice(0, 250); }
      await db.query('INSERT INTO reminder_log (partner_id, channel, source, amount, sent_to, message, status, error, auto, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [x.partner_id, ch, source, x.amount, to || null, msg || null, status, error, auto ? 1 : 0, user ? user.id : null]);
      if (status === 'sent') await db.query(`INSERT INTO crm_activities (partner_id, type, subject, body, done, done_at, created_by) VALUES (?, ?, ?, ?, 1, NOW(), ?)`,
        [x.partner_id, ch, `Payment reminder – M ${x.amount.toFixed(2)} overdue`, msg, user ? user.id : null]).catch(() => {});
      results.push({ partner_id: x.partner_id, name: x.name, channel: ch, status, error });
    }
  }
  return results;
}
r.post('/reminders/send', P, ah(async (req, res) => {
  const ids = new Set((req.body.partner_ids || []).map(Number));
  if (!ids.size) throw bad('Choose who to remind');
  const channel = ['sms', 'email', 'both'].includes(req.body.channel) ? req.body.channel : 'sms';
  const list = (await overdue(req.body.source || 'all', 0)).filter(x => ids.has(x.partner_id));
  if (!list.length) throw bad('None of them owe anything overdue');
  const out = await sendTo(list, { channel, source: req.body.source || 'all', user: req.user, templates: req.body.templates });
  res.json({ sent: out.filter(x => x.status === 'sent').length, failed: out.filter(x => x.status === 'failed'), results: out });
}));
r.post('/reminders/preview', P, ah(async (req, res) => {
  const s = await settings(); const t = { ...s.templates, ...(req.body.templates || {}) };
  const list = await overdue(req.body.source || 'all', 0);
  const x = list.find(y => y.partner_id === Number(req.body.partner_id)) || list[0] || { name: 'Thabo Mokoena', amount: 1500, oldest: today(), days: 10, details: ' for Flat 1, Mokhele Flats', invoices: 1 };
  const smsText = await personalise(t.sms, x);
  res.json({ sms: smsText, sms_parts: Math.ceil(smsText.length / 160), email_subject: await personalise(t.email_subject, x), email_body: await personalise(t.email_body, x), whatsapp: smsText });
}));
r.get('/reminders/log', P, ah(async (req, res) => res.json(await db.query(`SELECT l.*, p.name partner_name, u.name user_name FROM reminder_log l JOIN partners p ON p.id = l.partner_id LEFT JOIN users u ON u.id = l.user_id
  ${req.query.partner_id ? 'WHERE l.partner_id = ' + Number(req.query.partner_id) : ''} ORDER BY l.id DESC LIMIT 500`))));

/**
 * Automatic reminders, once a day from 09:00: customers whose oldest overdue invoice is exactly one of the
 * chosen numbers of days late (e.g. 3, 14, 30) – so nobody gets a message every day.
 */
async function runAuto(force) {
  const s = await settings();
  if (!s.auto.enabled && !force) return { skipped: 'off' };
  const now = new Date();
  if (!force && (s.last_auto_run === today() || now.getHours() < 9)) return { skipped: 'not now' };
  const raw = (await db.getSetting('reminders', {})) || {};
  await db.setSetting('reminders', { ...raw, last_auto_run: today() });
  const results = [];
  for (const src of s.auto.sources) {
    const list = (await overdue(src, 1)).filter(x => s.auto.days.includes(Number(x.days)) && x.amount >= s.auto.min_amount
      && !(x.last_reminded && (Date.now() - new Date(String(x.last_reminded).replace(' ', 'T'))) < 2 * 86400000));
    if (list.length) results.push(...await sendTo(list, { channel: s.auto.channel, source: src, auto: true }));
  }
  if (results.length) console.log(`[reminders] ${results.filter(x => x.status === 'sent').length} sent, ${results.filter(x => x.status === 'failed').length} failed`);
  return { results };
}
r.post('/reminders/run-auto', requirePerm('settings'), ah(async (req, res) => res.json(await runAuto(true))));

module.exports = { router: r, runAuto, overdue };
