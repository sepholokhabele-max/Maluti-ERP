const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { HttpError } = require('./util');

const ROLE_PERMS = {
  admin: ['*'],
  manager: ['dashboard', 'governance', 'legal', 'audit', 'finance.close', 'assets', 'paypartners', 'procurement', 'procurement.approve', 'pos', 'pos.refund', 'pos.discount', 'pos.void', 'catalog', 'inventory', 'partners', 'purchasing',
    'invoicing', 'accounting', 'reports', 'vas', 'kitchen', 'users', 'sessions', 'crm', 'recon', 'recon.approve', 'hrm', 'payroll',
    'sales', 'expenses.approve', 'purchase.approve', 'attendance', 'maintenance', 'projects', 'helpdesk', 'property', 'school', 'sites', 'reminders', 'rooms', 'fleet', 'hire', 'patients', 'farm', 'campaigns', 'water', 'water.vend'],
  accountant: ['dashboard', 'legal', 'finance.close', 'assets', 'paypartners', 'procurement', 'partners', 'purchasing', 'invoicing', 'accounting', 'reports', 'inventory', 'crm', 'recon', 'recon.approve', 'hrm', 'payroll',
    'sales', 'expenses.approve', 'attendance', 'projects', 'helpdesk', 'property', 'school', 'reminders', 'rooms', 'fleet', 'hire', 'farm', 'water'],
  cashier: ['pos', 'vas', 'helpdesk', 'water.vend'],
  waiter: ['pos'],
  bartender: ['pos', 'vas'],
  kitchen: ['kitchen'],
  technician: ['helpdesk', 'maintenance'],
  staff: ['helpdesk'],
  supervisor: ['sites', 'attendance'],
  receptionist: ['rooms', 'pos', 'crm', 'patients'],
  clinician: ['patients', 'helpdesk'],
  farmworker: ['farm', 'attendance'],
  meterreader: ['water.read', 'attendance'],
  // external auditors: read the books and run the audit tools, change nothing
  auditor: ['audit', 'accounting.view', 'reports', 'dashboard'],
  // the internal audit function: independent of management, reports to the audit committee
  internal_auditor: ['internal_audit', 'audit', 'accounting.view', 'reports', 'dashboard']
};

function can(user, perm) {
  const perms = ROLE_PERMS[user.role] || [];
  return perms.includes('*') || String(perm).split('|').some(p => perms.includes(p));
}

const sec = () => require('./services/security');

/** a session: away from the office it is shorter, and it remembers where it was started */
async function issueToken(userId, ctx = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const hours = ctx.remote ? (await sec().settings()).remote_session_hours : 14 * 24;
  await db.query('INSERT INTO auth_tokens (token, user_id, expires_at, last_seen, ip, user_agent, remote, method) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR), NOW(), ?, ?, ?, ?)',
    [token, userId, hours, ctx.ip ? sec().cleanIp(ctx.ip).slice(0, 64) : null, ctx.ua ? String(ctx.ua).slice(0, 160) : null, ctx.remote ? 1 : 0, ctx.method || null]);
  await db.query('DELETE FROM auth_tokens WHERE expires_at < NOW()');
  return token;
}
const forbidden = m => new HttpError(403, m);

/**
 * username + password. ctx = { ip, ua } from the request; without ctx (first-run set-up on this machine) the office rules apply.
 * Returns a session, or – when a second step is needed – { two_factor: 'code' | 'enrol', ticket, … }.
 */
async function login(username, password, ctx = null) {
  const S = sec();
  if (ctx) await S.checkLocked(username, ctx.ip);
  let u = await db.one('SELECT * FROM users WHERE username = ? AND active = 1', [username]);
  let viaAgent = false;
  if (!u || !bcrypt.compareSync(password || '', u.password_hash)) {
    // the owner may also sign in with the My Wallet agent number and password used to activate S-ERP
    const ag = await require('./services/activation').agentLogin(username, password).catch(() => null);
    if (!ag) { if (ctx) S.recordFail(username, ctx.ip); throw new HttpError(401, 'Invalid username or password'); }
    u = ag; viaAgent = true;
  }
  const remote = ctx ? !(await S.isTrusted(ctx.ip)) : false;
  if (remote && !(await S.mayWorkRemotely(u))) throw forbidden('Your account can only sign in from the office network. Ask an administrator if you need to work from elsewhere.');
  if (ctx) S.clearFails(username);
  if (ctx && await S.needsTwoFactor(u, remote)) {
    if (u.totp_enabled && u.totp_secret) return { two_factor: 'code', ticket: S.ticketFor(u.id, { remote }), name: u.name };
    const secret = S.newSecret(), uri = await S.otpauth(u, secret);
    return { two_factor: 'enrol', ticket: S.ticketFor(u.id, { remote, secret }), name: u.name, secret, otpauth: uri, qr_svg: await require('qrcode').toString(uri, { type: 'svg', margin: 1 }) };
  }
  return { token: await issueToken(u.id, { ...(ctx || {}), remote, method: viaAgent ? 'agent' : 'password' }), user: publicUser(u), remote };
}
/** the second step: the 6-digit code from the authenticator app (and, the first time, switching it on) */
async function loginCode(ticket, code, ctx = {}) {
  const S = sec();
  const t = S.takeTicket(ticket, true); if (!t) throw new HttpError(401, 'The sign-in took too long – start again');
  const u = await db.one('SELECT * FROM users WHERE id = ? AND active = 1', [t.userId]); if (!u) throw new HttpError(401, 'Start again');
  const secret = t.secret || u.totp_secret;
  if (!S.verifyTotp(secret, code, u.id)) { S.attempt(ticket); S.recordFail(u.username, ctx.ip); throw new HttpError(401, 'That code is not right – check the time on your phone and try the newest code'); }
  S.takeTicket(ticket);
  if (t.secret) await db.query('UPDATE users SET totp_secret = ?, totp_enabled = 1 WHERE id = ?', [t.secret, u.id]);
  return { token: await issueToken(u.id, { ...ctx, remote: t.remote, method: '2fa' }), user: publicUser({ ...u, totp_enabled: 1 }), remote: t.remote };
}

async function pinLogin(userId, pin, ctx = null) {
  const S = sec();
  const remote = ctx ? !(await S.isTrusted(ctx.ip)) : false;
  if (remote && !(await S.settings()).pin_remote) throw forbidden('PIN sign-in only works on the office network. Use your username and password.');
  if (ctx) await S.checkLocked('pin:' + userId, ctx.ip);
  const u = await db.one('SELECT * FROM users WHERE id = ? AND active = 1', [userId]);
  if (!u || !u.pin_hash || !bcrypt.compareSync(String(pin || ''), u.pin_hash)) { if (ctx) S.recordFail('pin:' + userId, ctx.ip); throw new HttpError(401, 'Invalid PIN'); }
  if (remote && !(await S.mayWorkRemotely(u))) throw forbidden('Your account can only sign in from the office network.');
  if (ctx) S.clearFails('pin:' + userId);
  return { token: await issueToken(u.id, { ...(ctx || {}), remote, method: 'pin' }), user: publicUser(u), remote };
}

function publicUser(u) {
  return { id: u.id, name: u.name, username: u.username, email: u.email, role: u.role, active: u.active,
    permissions: ROLE_PERMS[u.role] || [], has_pin: !!u.pin_hash, location_id: u.location_id || null, two_factor: !!u.totp_enabled };
}

/** Express middleware: attaches req.user, rejects if not logged in */
async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : (req.query.token || '');
    if (!token) throw new HttpError(401, 'Login required');
    const u = await db.one(
      `SELECT u.*, t.last_seen t_last_seen, t.remote t_remote, TIMESTAMPDIFF(SECOND, COALESCE(t.last_seen, t.created_at), NOW()) t_idle FROM auth_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token = ? AND t.expires_at > NOW() AND u.active = 1`, [token]);
    if (!u) throw new HttpError(401, 'Session expired, please log in again');
    // idle sign-out (shorter away from the office)
    const s = await sec().settings(), idle = u.t_remote ? s.remote_idle_minutes : s.idle_minutes;
    if (idle > 0 && Number(u.t_idle) > idle * 60) { await db.query('DELETE FROM auth_tokens WHERE token = ?', [token]); throw new HttpError(401, `You were signed out after ${idle} minutes without activity – please sign in again`); }
    if (Number(u.t_idle) > 60) db.query('UPDATE auth_tokens SET last_seen = NOW() WHERE token = ?', [token]).catch(() => {});
    req.user = publicUser(u);
    req.remote = !!u.t_remote;
    req.token = token;
    next();
  } catch (e) { next(e); }
}

/** requirePerm('accounting') or requirePerm('accounting|accounting.view') – any one of them */
const requirePerm = perm => (req, res, next) => {
  if (!req.user || !String(perm).split('|').some(p => can(req.user, p))) return next(new HttpError(403, `You do not have permission: ${String(perm).split('|')[0]}`));
  next();
};

const hash = s => bcrypt.hashSync(String(s), 10);

module.exports = { ROLE_PERMS, can, login, loginCode, pinLogin, issueToken, requireAuth, requirePerm, hash, publicUser };
