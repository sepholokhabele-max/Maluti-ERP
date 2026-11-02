// Auth, setup wizard, users, settings, email reports
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const setup = require('../services/setup');
const mailer = require('../services/mailer');
const logo = require('../services/logo');
const { ah, bad, today, pick } = require('../util');

// ---------- public (no login) ----------
const pub = express.Router();

pub.get('/status', ah(async (req, res) => {
  const connected = db.isConnected();
  res.json({ connected, initialised: connected ? await setup.isInitialised() : false, version: require('../../package.json').version,
    db_config_editable: !!req.app.locals.configStore, embedded_available: !!req.app.locals.embeddedDb,
    embedded_running: !!(req.app.locals.embeddedDb && req.app.locals.embeddedDb.running()) });
}));

// First run: use the MySQL server that ships with the desktop app
pub.post('/db-embedded', ah(async (req, res) => {
  const store = req.app.locals.configStore, emb = req.app.locals.embeddedDb;
  if (!store || !emb) throw bad('The built-in database is not available in this copy of Maluti ERP');
  if (db.isConnected() && await setup.isInitialised().catch(() => false)) throw bad('Already set up.');
  const cfg = await emb.start();
  await db.connect(cfg);
  await db.migrate();
  store.save({ db: cfg });
  res.json({ ok: true, initialised: await setup.isInitialised() });
}));

// Save DB connection (first run). Only allowed when not yet initialised.
pub.post('/db-config', ah(async (req, res) => {
  const store = req.app.locals.configStore;
  if (!store) throw bad('Database is configured by the server administrator');
  if (db.isConnected() && await setup.isInitialised().catch(() => false)) throw bad('Already set up. Change the database from Settings as an admin.');
  const cfg = pick(req.body, ['host', 'port', 'user', 'password', 'database']);
  cfg.port = Number(cfg.port || 3306); cfg.database = cfg.database || 'maluti_erp';
  await db.connect(cfg);
  await db.migrate();
  store.save({ db: cfg });
  res.json({ ok: true, initialised: await setup.isInitialised() });
}));

pub.post('/setup', ah(async (req, res) => {
  const { company, admin, demo } = req.body;
  if (!admin || !admin.username || !admin.password || admin.password.length < 6) throw bad('Admin username and a password of at least 6 characters are required');
  await setup.initialise({ company: company || {}, admin, demo: !!demo });
  // remember the kinds of business for the setup guide; butchery mode is switched on straight away
  const types = Array.isArray(req.body.business_types) ? req.body.business_types : [];
  if (types.length) await require('../services/guide').save({ types });
  if (types.includes('butchery')) { const B = require('../services/butchery'); await db.setSetting('butchery', { ...(await B.settings()), enabled: true }); }
  res.json(await auth.login(admin.username, admin.password));
}));

pub.post('/login', ah(async (req, res) => res.json(await auth.login(req.body.username, req.body.password))));
pub.post('/pin-login', ah(async (req, res) => res.json(await auth.pinLogin(req.body.user_id, req.body.pin))));
// staff list for the PIN lock screen (names only)
pub.get('/pin-users', ah(async (req, res) => {
  res.json(await db.query('SELECT id, name, role FROM users WHERE active = 1 AND pin_hash IS NOT NULL ORDER BY name'));
}));
pub.get('/company', ah(async (req, res) => res.json(await logo.companyWithLogo())));
// company logo as an image (used on login screen, receipts, invoices)
pub.get('/company/logo', ah(async (req, res) => {
  const l = db.isConnected() ? await logo.binary() : null;
  if (!l) return res.status(404).json({ error: 'No logo' });
  res.set('Content-Type', l.mime).set('Cache-Control', 'no-cache').set('X-Content-Type-Options', 'nosniff').send(l.buffer);
}));

// ---------- authenticated ----------
const priv = express.Router();

priv.get('/me', (req, res) => res.json(req.user));
priv.post('/logout', ah(async (req, res) => { await db.query('DELETE FROM auth_tokens WHERE token = ?', [req.token]); res.json({ ok: true }); }));
priv.post('/me/password', ah(async (req, res) => {
  const u = await db.one('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!require('bcryptjs').compareSync(req.body.current || '', u.password_hash)) throw bad('Current password is wrong');
  if (!req.body.password || req.body.password.length < 6) throw bad('New password must be at least 6 characters');
  await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [auth.hash(req.body.password), u.id]);
  res.json({ ok: true });
}));

priv.get('/users', auth.requirePerm('users'), ah(async (req, res) => {
  const rows = await db.query('SELECT * FROM users ORDER BY name');
  res.json(rows.map(auth.publicUser));
}));
priv.post('/users', auth.requirePerm('users'), ah(async (req, res) => {
  const b = req.body;
  if (!b.name || !b.username || !b.password) throw bad('Name, username and password are required');
  if (b.role === 'admin' && req.user.role !== 'admin') throw bad('Only an admin can create admins');
  if (b.pin && !/^\d{4,6}$/.test(String(b.pin))) throw bad('PIN must be 4–6 digits');
  await db.query('INSERT INTO users (name, username, email, password_hash, pin_hash, role) VALUES (?, ?, ?, ?, ?, ?)',
    [b.name, b.username, b.email || null, auth.hash(b.password), b.pin ? auth.hash(b.pin) : null, b.role || 'cashier']);
  res.json({ ok: true });
}));
priv.put('/users/:id', auth.requirePerm('users'), ah(async (req, res) => {
  const b = req.body; const sets = [], args = [];
  const target = await db.one('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!target) throw bad('User not found');
  if ((target.role === 'admin' || b.role === 'admin') && req.user.role !== 'admin') throw bad('Only an admin can change admins');
  for (const k of ['name', 'username', 'email', 'role', 'active']) if (b[k] !== undefined) { sets.push(`${k} = ?`); args.push(b[k]); }
  if (b.password) { sets.push('password_hash = ?'); args.push(auth.hash(b.password)); }
  if (b.pin) { if (!/^\d{4,6}$/.test(String(b.pin))) throw bad('PIN must be 4–6 digits'); sets.push('pin_hash = ?'); args.push(auth.hash(b.pin)); }
  if (b.clear_pin) sets.push('pin_hash = NULL');
  if (sets.length) await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...args, req.params.id]);
  if (b.active === 0 || b.active === false) await db.query('DELETE FROM auth_tokens WHERE user_id = ?', [req.params.id]);
  res.json({ ok: true });
}));

priv.get('/settings', auth.requirePerm('settings'), ah(async (req, res) => {
  const email = await mailer.getEmailSettings();
  res.json({ company: await db.getSetting('company', {}), email: { ...email, smtp_pass: email.smtp_pass ? '********' : '' },
    pos: await db.getSetting('pos', { require_pin_between_sales: false, print_kitchen_tickets: false, allow_negative_stock: true }) });
}));
priv.put('/settings/:key', auth.requirePerm('settings'), ah(async (req, res) => {
  const key = req.params.key;
  if (!['company', 'email', 'pos'].includes(key)) throw bad('Unknown settings group');
  let v = req.body;
  if (key === 'email') {
    const cur = await mailer.getEmailSettings();
    if (v.smtp_pass === '********') v.smtp_pass = cur.smtp_pass;
    if (typeof v.recipients === 'string') v.recipients = v.recipients.split(/[,;\s]+/).filter(Boolean);
    v = { ...cur, ...v };
  }
  await db.setSetting(key, v);
  if (key === 'email') await mailer.schedule();
  res.json({ ok: true });
}));
priv.get('/settings-qr', auth.requirePerm('settings'), ah(async (req, res) => {
  const q = require('../services/qr');
  res.json({ settings: await q.settings(), lan_urls: q.lanUrls(req.app.locals.port || 8069), effective_base_url: await q.baseUrl(req) });
}));
priv.put('/settings-qr', auth.requirePerm('settings'), ah(async (req, res) => {
  const q = require('../services/qr');
  const v = { ...(await q.settings()), ...pick(req.body, ['receipt_qr', 'base_url', 'receipt_qr_text', 'pay_qr']) };
  v.receipt_qr = !!v.receipt_qr; v.pay_qr = !!v.pay_qr;
  if (v.base_url && !/^https?:\/\/[^\s]+$/i.test(v.base_url)) throw bad('Public address must start with http:// or https://');
  await db.setSetting('qr', v);
  res.json(v);
}));
priv.put('/settings-logo', auth.requirePerm('settings'), ah(async (req, res) => {
  const r = await logo.save(req.body.data_url);
  await db.query(`INSERT INTO audit_log (user_id, action, entity) VALUES (?, 'logo.upload', 'settings')`, [req.user.id]);
  res.json(r);
}));
priv.delete('/settings-logo', auth.requirePerm('settings'), ah(async (req, res) => {
  await logo.remove();
  await db.query(`INSERT INTO audit_log (user_id, action, entity) VALUES (?, 'logo.remove', 'settings')`, [req.user.id]);
  res.json({ ok: true });
}));
priv.post('/email/test', auth.requirePerm('settings'), ah(async (req, res) => {
  if (!req.body.to) throw bad('Enter an address to send the test to');
  await mailer.sendTest(req.body.to);
  res.json({ ok: true });
}));
priv.post('/email/eod', auth.requirePerm('reports'), ah(async (req, res) => {
  res.json(await mailer.sendEod(req.body.date || today(), { recipients: req.body.recipients, kind: 'eod-manual' }));
}));
priv.get('/email/log', auth.requirePerm('settings'), ah(async (req, res) => {
  res.json(await db.query('SELECT * FROM email_log ORDER BY id DESC LIMIT 100'));
}));
priv.get('/audit', auth.requirePerm('settings'), ah(async (req, res) => {
  res.json(await db.query('SELECT a.*, u.name user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 300'));
}));

// Store setup guide
priv.get('/setup-guide', auth.requirePerm('settings'), ah(async (req, res) => res.json(await require('../services/guide').guide())));
priv.put('/setup-guide', auth.requirePerm('settings'), ah(async (req, res) => res.json(await require('../services/guide').save(req.body || {}))));

// Back up the built-in database (desktop app with built-in MySQL)
priv.post('/backup', auth.requirePerm('settings'), ah(async (req, res) => {
  const emb = req.app.locals.embeddedDb;
  if (!emb || !emb.running()) throw bad('Backups from here are for the built-in database. For your own MySQL server use mysqldump or MySQL Workbench.');
  res.json({ file: await emb.backup() });
}));

module.exports = { pub, priv };
