const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { HttpError } = require('./util');

const ROLE_PERMS = {
  admin: ['*'],
  manager: ['dashboard', 'pos', 'pos.refund', 'pos.discount', 'pos.void', 'catalog', 'inventory', 'partners', 'purchasing',
    'invoicing', 'accounting', 'reports', 'vas', 'kitchen', 'users', 'sessions', 'crm', 'recon', 'recon.approve', 'hrm', 'payroll',
    'sales', 'expenses.approve', 'purchase.approve', 'attendance'],
  accountant: ['dashboard', 'partners', 'purchasing', 'invoicing', 'accounting', 'reports', 'inventory', 'crm', 'recon', 'recon.approve', 'hrm', 'payroll',
    'sales', 'expenses.approve', 'attendance'],
  cashier: ['pos', 'vas'],
  waiter: ['pos'],
  bartender: ['pos', 'vas'],
  kitchen: ['kitchen']
};

function can(user, perm) {
  const perms = ROLE_PERMS[user.role] || [];
  return perms.includes('*') || perms.includes(perm);
}

async function issueToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.query('INSERT INTO auth_tokens (token, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 14 DAY))', [token, userId]);
  await db.query('DELETE FROM auth_tokens WHERE expires_at < NOW()');
  return token;
}

async function login(username, password) {
  const u = await db.one('SELECT * FROM users WHERE username = ? AND active = 1', [username]);
  if (!u || !bcrypt.compareSync(password || '', u.password_hash)) throw new HttpError(401, 'Invalid username or password');
  return { token: await issueToken(u.id), user: publicUser(u) };
}

async function pinLogin(userId, pin) {
  const u = await db.one('SELECT * FROM users WHERE id = ? AND active = 1', [userId]);
  if (!u || !u.pin_hash || !bcrypt.compareSync(String(pin || ''), u.pin_hash)) throw new HttpError(401, 'Invalid PIN');
  return { token: await issueToken(u.id), user: publicUser(u) };
}

function publicUser(u) {
  return { id: u.id, name: u.name, username: u.username, email: u.email, role: u.role, active: u.active,
    permissions: ROLE_PERMS[u.role] || [], has_pin: !!u.pin_hash, location_id: u.location_id || null };
}

/** Express middleware: attaches req.user, rejects if not logged in */
async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : (req.query.token || '');
    if (!token) throw new HttpError(401, 'Login required');
    const u = await db.one(
      `SELECT u.* FROM auth_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token = ? AND t.expires_at > NOW() AND u.active = 1`, [token]);
    if (!u) throw new HttpError(401, 'Session expired, please log in again');
    req.user = publicUser(u);
    req.token = token;
    next();
  } catch (e) { next(e); }
}

const requirePerm = perm => (req, res, next) => {
  if (!req.user || !can(req.user, perm)) return next(new HttpError(403, `You do not have permission: ${perm}`));
  next();
};

const hash = s => bcrypt.hashSync(String(s), 10);

module.exports = { ROLE_PERMS, can, login, pinLogin, requireAuth, requirePerm, hash, publicUser };
