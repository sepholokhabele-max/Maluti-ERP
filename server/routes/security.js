// Settings → Access & security, and "My account → Sign-in & security" for every user.
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requirePerm } = require('../auth');
const { ah, bad, notFound } = require('../util');
const S = require('../services/security');

const r = express.Router();
const ADM = requirePerm('settings');
const sid = token => crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 16);
const SESS = `SELECT t.token, t.user_id, u.name, u.username, u.role, t.created_at, t.last_seen, t.expires_at, t.ip, t.user_agent, t.remote, t.method FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.expires_at > NOW()`;
const device = ua => { const s = String(ua || ''); if (!s) return ''; if (/Electron/.test(s)) return 'S-ERP desktop app'; const b = /Edg\//.test(s) ? 'Edge' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'Browser';
  const o = /Android/.test(s) ? 'Android' : /iPhone|iPad/.test(s) ? 'iPhone / iPad' : /Windows/.test(s) ? 'Windows' : /Mac OS/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : ''; return `${b}${o ? ' on ' + o : ''}`; };
const shape = (x, me) => ({ id: sid(x.token), user_id: x.user_id, name: x.name, username: x.username, role: x.role, started: x.created_at, last_seen: x.last_seen, ends: x.expires_at, ip: x.ip, device: device(x.user_agent), remote: !!x.remote, method: x.method, current: me && x.token === me });

/* ---------------- administrator ---------------- */
r.get('/security', ADM, ah(async (req, res) => {
  const s = await S.settings(), L = req.app.locals;
  const users = await db.query('SELECT role, totp_enabled FROM users WHERE active = 1');
  const managersNo2fa = users.filter(u => S.MANAGER_ROLES.includes(u.role) && !u.totp_enabled).length;
  const fails = (await db.one(`SELECT COUNT(*) n FROM audit_log WHERE action = 'login_failed' AND created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)`).catch(() => ({ n: 0 }))).n;
  const remoteSessions = (await db.one(`SELECT COUNT(*) n FROM auth_tokens WHERE expires_at > NOW() AND remote = 1`)).n;
  const https = !!(L.https || req.secure || (s.public_url || '').startsWith('https://'));
  const status = {
    mode: L.mode || 'server', version: require('../../package.json').version, port: L.port, lan: S.lanAddresses(L.port || 8069), https, https_builtin: !!L.https,
    behind_proxy: !!req.get('x-forwarded-for'), setup_key: !!process.env.MALUTI_SETUP_KEY, you_are_in_office: await S.isTrusted(req.ip), your_address: S.cleanIp(req.ip),
    users_2fa: users.filter(u => u.totp_enabled).length, users: users.length, managers_without_2fa: managersNo2fa, failed_logins_24h: Number(fails), remote_sessions: Number(remoteSessions)
  };
  // the checklist for opening S-ERP to the internet
  const checks = [
    { key: 'https', ok: https, label: 'Traffic is encrypted (HTTPS)', fix: 'Use the server edition with a certificate, Caddy (Docker) or a secure tunnel – never open plain http to the internet.' },
    { key: 'public', ok: !!s.public_url, label: 'The address people use from outside is recorded', fix: 'Enter the public address below so links in emails and QR codes point to it.' },
    { key: '2fa', ok: s.twofa_for !== 'nobody', label: 'Two-step sign-in is required away from the office', fix: 'Require it at least for managers.' },
    { key: 'pin', ok: !s.pin_remote, label: 'Staff PIN sign-in only works in the office', fix: 'Switch off PIN sign-in from outside.' },
    { key: 'idle', ok: s.remote_idle_minutes > 0 && s.remote_idle_minutes <= 240, label: 'Idle sessions away from the office are signed out', fix: 'Set an idle time of 4 hours or less.' },
    { key: 'lock', ok: s.max_failed <= 10, label: 'Repeated wrong passwords lock the account for a while', fix: 'Use 10 attempts or fewer.' },
    { key: 'backup', ok: !!L.backups, label: 'The database is backed up every day', fix: L.mode === 'docker' ? 'Back up the database volume with your host\'s tools.' : 'Use the built-in database, or set up backups of your MySQL server.' }
  ];
  res.json({ settings: s, status, checks, roles: Object.keys(require('../auth').ROLE_PERMS) });
}));
r.put('/security', ADM, ah(async (req, res) => res.json(await S.saveSettings(req.body || {}))));
r.get('/security/sessions', ADM, ah(async (req, res) => res.json((await db.query(`${SESS} ORDER BY COALESCE(t.last_seen, t.created_at) DESC LIMIT 500`)).map(x => shape(x, req.token)))));
r.post('/security/sessions/:sid/end', ADM, ah(async (req, res) => {
  const rows = await db.query('SELECT token FROM auth_tokens WHERE expires_at > NOW()'); const t = rows.find(x => sid(x.token) === req.params.sid);
  if (!t) throw notFound('Session'); await db.query('DELETE FROM auth_tokens WHERE token = ?', [t.token]); res.json({ ok: true });
}));
r.post('/security/users/:id(\\d+)/end-sessions', ADM, ah(async (req, res) => { await db.query('DELETE FROM auth_tokens WHERE user_id = ? AND token <> ?', [req.params.id, req.token]); res.json({ ok: true }); }));
r.post('/security/users/:id(\\d+)/reset-2fa', ADM, ah(async (req, res) => {
  await db.query('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?', [req.params.id]);
  await db.query('DELETE FROM auth_tokens WHERE user_id = ? AND remote = 1', [req.params.id]);
  await db.query(`INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES (?, 'security.reset_2fa', 'users', ?, '{}', ?)`, [req.user.id, req.params.id, S.cleanIp(req.ip).slice(0, 64)]);
  res.json({ ok: true });
}));

/* ---------------- my account ---------------- */
r.get('/me/security', ah(async (req, res) => {
  const u = await db.one('SELECT role, totp_enabled FROM users WHERE id = ?', [req.user.id]);
  const s = await S.settings();
  res.json({ two_factor: !!u.totp_enabled, required: s.twofa_for === 'everyone' || (s.twofa_for === 'managers' && S.MANAGER_ROLES.includes(u.role)), scope: s.twofa_scope,
    in_office: await S.isTrusted(req.ip), this_session_remote: !!req.remote,
    sessions: (await db.query(`${SESS} AND t.user_id = ? ORDER BY COALESCE(t.last_seen, t.created_at) DESC`, [req.user.id])).map(x => shape(x, req.token)) });
}));
r.post('/me/2fa/start', ah(async (req, res) => {
  const u = await db.one('SELECT * FROM users WHERE id = ?', [req.user.id]);
  const secret = S.newSecret(), uri = await S.otpauth(u, secret);
  res.json({ ticket: S.ticketFor(u.id, { secret, setup: true }), secret, otpauth: uri, qr_svg: await require('qrcode').toString(uri, { type: 'svg', margin: 1 }) });
}));
r.post('/me/2fa/enable', ah(async (req, res) => {
  const t = S.takeTicket((req.body || {}).ticket, true);
  if (!t || t.userId !== req.user.id || !t.setup) throw bad('Start again – the set-up took too long');
  if (!S.verifyTotp(t.secret, (req.body || {}).code, req.user.id)) { S.attempt(req.body.ticket); throw bad('That code is not right – check the time on your phone and try the newest code'); }
  S.takeTicket(req.body.ticket);
  await db.query('UPDATE users SET totp_secret = ?, totp_enabled = 1 WHERE id = ?', [t.secret, req.user.id]);
  await db.query(`INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES (?, 'security.2fa_on', 'users', ?, '{}', ?)`, [req.user.id, req.user.id, S.cleanIp(req.ip).slice(0, 64)]);
  res.json({ ok: true });
}));
r.post('/me/2fa/disable', ah(async (req, res) => {
  const u = await db.one('SELECT * FROM users WHERE id = ?', [req.user.id]); const s = await S.settings();
  if (!bcrypt.compareSync(String((req.body || {}).password || ''), u.password_hash)) throw bad('Your password is not right');
  if (s.twofa_for === 'everyone' || (s.twofa_for === 'managers' && S.MANAGER_ROLES.includes(u.role))) throw bad('Two-step sign-in is required for your role – it cannot be switched off. An administrator can reset it if you lost your phone.');
  await db.query('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?', [u.id]);
  res.json({ ok: true });
}));
r.post('/me/sessions/end-others', ah(async (req, res) => { const x = await db.query('DELETE FROM auth_tokens WHERE user_id = ? AND token <> ?', [req.user.id, req.token]); res.json({ ended: x.affectedRows }); }));
r.post('/me/sessions/:sid/end', ah(async (req, res) => {
  const rows = await db.query('SELECT token FROM auth_tokens WHERE user_id = ?', [req.user.id]); const t = rows.find(x => sid(x.token) === req.params.sid);
  if (!t) throw notFound('Session'); await db.query('DELETE FROM auth_tokens WHERE token = ?', [t.token]); res.json({ ok: true });
}));

module.exports = r;
