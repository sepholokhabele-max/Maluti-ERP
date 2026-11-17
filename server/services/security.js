// Working from anywhere, safely: which networks count as "the office", two-step sign-in with an authenticator app (TOTP,
// RFC 6238), limits on failed sign-ins, idle sign-out and shorter sessions away from the office, and the list of where
// each person is signed in.
const crypto = require('crypto');
const os = require('os');
const db = require('../db');
const { bad } = require('../util');

const DEFAULTS = {
  // who may sign in from outside the office networks: everyone | office_only (nobody) | roles (the roles listed)
  remote_access: 'everyone', remote_roles: ['admin', 'manager', 'accountant', 'auditor', 'internal_auditor', 'staff', 'supervisor', 'technician'],
  // two-step sign-in: required for nobody | managers (admin, manager, accountant, auditors) | everyone; asked away from the office only, or always
  twofa_for: 'managers', twofa_scope: 'remote',
  pin_remote: false,                  // staff PIN sign-in only works on the office network
  trusted_networks: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
  max_failed: 5, lock_minutes: 15,    // per username, and 4× that per address
  idle_minutes: 0,                    // sign out after this many minutes without activity (0 = never) – everywhere
  remote_idle_minutes: 60,            // … and away from the office
  remote_session_hours: 12,           // sessions started away from the office end after this
  public_url: ''                      // the address people use from outside, e.g. https://erp.example.co.ls
};
const MANAGER_ROLES = ['admin', 'manager', 'accountant', 'auditor', 'internal_auditor'];

let cache = null, cacheAt = 0;
async function settings() {
  if (cache && Date.now() - cacheAt < 15000) return cache;
  cache = { ...DEFAULTS, ...((db.isConnected() && await db.getSetting('security', {}).catch(() => ({}))) || {}) }; cacheAt = Date.now();
  return cache;
}
async function saveSettings(b) {
  const cur = await settings(), n = { ...cur };
  if (b.remote_access !== undefined) n.remote_access = ['everyone', 'office_only', 'roles'].includes(b.remote_access) ? b.remote_access : 'everyone';
  if (Array.isArray(b.remote_roles)) n.remote_roles = b.remote_roles.map(String).slice(0, 30);
  if (b.twofa_for !== undefined) n.twofa_for = ['nobody', 'managers', 'everyone'].includes(b.twofa_for) ? b.twofa_for : 'managers';
  if (b.twofa_scope !== undefined) n.twofa_scope = b.twofa_scope === 'always' ? 'always' : 'remote';
  if (b.pin_remote !== undefined) n.pin_remote = !!b.pin_remote;
  if (b.trusted_networks !== undefined) {
    const list = (Array.isArray(b.trusted_networks) ? b.trusted_networks : String(b.trusted_networks).split(/[\s,;]+/)).map(x => String(x).trim()).filter(Boolean);
    for (const c of list) if (!parseCidr(c)) throw bad(`"${c}" is not a network address – use the form 192.168.1.0/24 or a single address`);
    n.trusted_networks = list.slice(0, 50);
  }
  for (const [k, lo, hi] of [['max_failed', 3, 50], ['lock_minutes', 1, 1440], ['idle_minutes', 0, 1440], ['remote_idle_minutes', 0, 1440], ['remote_session_hours', 1, 336]])
    if (b[k] !== undefined) { const v = Math.round(Number(b[k])); if (!(v >= lo && v <= hi)) throw bad(`${k.replace(/_/g, ' ')} must be between ${lo} and ${hi}`); n[k] = v; }
  if (b.public_url !== undefined) {
    const u = String(b.public_url || '').trim().replace(/\/+$/, '');
    if (u && !/^https?:\/\/[^\s/]+(:\d+)?$/i.test(u)) throw bad('The public address must look like https://erp.example.co.ls');
    n.public_url = u;
  }
  await db.setSetting('security', n); cache = null;
  return n;
}

/* ---------- networks ---------- */
function ipv4ToInt(ip) { const p = ip.split('.').map(Number); if (p.length !== 4 || p.some(x => !(x >= 0 && x <= 255) || !Number.isInteger(x))) return null; return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]; }
function parseCidr(c) {
  const [ip, bits0] = String(c).split('/');
  const n = ipv4ToInt(ip); if (n === null) return null;
  const bits = bits0 === undefined ? 32 : Number(bits0); if (!(bits >= 0 && bits <= 32) || !Number.isInteger(bits)) return null;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return { net: (n & mask) >>> 0, mask };
}
const cleanIp = ip => String(ip || '').replace(/^::ffff:/, '');
/** is this address inside the office (loopback, the trusted networks)? */
async function isTrusted(ip0) {
  const ip = cleanIp(ip0);
  if (!ip) return false;
  if (ip === '::1' || /^127\./.test(ip)) return true;
  if (ip.includes(':')) return /^(fe80|fc|fd)/i.test(ip) && (await settings()).trusted_networks.some(c => /^(10|172|192)\./.test(c)); // IPv6 link-local / ULA = LAN when LANs are trusted
  const n = ipv4ToInt(ip); if (n === null) return false;
  return (await settings()).trusted_networks.some(c => { const x = parseCidr(c); return x && ((n & x.mask) >>> 0) === x.net; });
}

/* ---------- failed sign-in limits ---------- */
const fails = new Map(); // key -> [timestamps]
function recent(key, minutes) { const cut = Date.now() - minutes * 60000; const a = (fails.get(key) || []).filter(t => t > cut); fails.set(key, a); return a; }
async function checkLocked(username, ip) {
  const s = await settings();
  const u = recent('u:' + String(username || '').toLowerCase(), s.lock_minutes), a = recent('ip:' + cleanIp(ip), s.lock_minutes);
  if (u.length >= s.max_failed || a.length >= s.max_failed * 4) {
    const wait = Math.max(1, Math.ceil(((Math.min(...(u.length >= s.max_failed ? u : a)) + s.lock_minutes * 60000) - Date.now()) / 60000));
    throw Object.assign(new Error(`Too many wrong attempts. Try again in ${wait} minute${wait === 1 ? '' : 's'}, or ask an administrator.`), { status: 429 });
  }
}
function recordFail(username, ip) { const now = Date.now(); for (const k of ['u:' + String(username || '').toLowerCase(), 'ip:' + cleanIp(ip)]) fails.set(k, [...(fails.get(k) || []), now].slice(-200)); }
function clearFails(username) { fails.delete('u:' + String(username || '').toLowerCase()); }

/* ---------- TOTP (authenticator apps: Google / Microsoft Authenticator, Authy …) ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32encode(buf) { let bits = 0, val = 0, out = ''; for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; }
function b32decode(s) { const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, ''); let bits = 0, val = 0; const out = []; for (const ch of clean) { val = (val << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
function totp(secret, t = Date.now(), step = 30) {
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(t / 1000 / step)));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(ctr).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
const usedCodes = new Map(); // userId -> last accepted time step (no replay)
function verifyTotp(secret, code, userId) {
  const c = String(code || '').replace(/\s/g, ''); if (!/^\d{6}$/.test(c) || !secret) return false;
  for (const w of [0, -1, 1]) {
    const t = Date.now() + w * 30000;
    if (crypto.timingSafeEqual(Buffer.from(totp(secret, t)), Buffer.from(c))) {
      const stepNo = Math.floor(t / 30000);
      if (userId && usedCodes.get(userId) >= stepNo) return false;
      if (userId) usedCodes.set(userId, stepNo);
      return true;
    }
  }
  return false;
}
const newSecret = () => b32encode(crypto.randomBytes(20));
async function otpauth(user, secret) {
  const c = (await db.getSetting('company', {}).catch(() => ({}))) || {};
  const issuer = (c.name ? `S-ERP ${c.name}` : 'S-ERP').replace(/[:]/g, '');
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(user.username)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/* ---------- sign-in decisions ---------- */
async function needsTwoFactor(user, remote) {
  if (user.totp_enabled) return true; // a person who has switched it on is always asked
  const s = await settings();
  if (s.twofa_scope === 'remote' && !remote) return false;
  return s.twofa_for === 'everyone' || (s.twofa_for === 'managers' && MANAGER_ROLES.includes(user.role));
}
async function mayWorkRemotely(user) {
  const s = await settings();
  if (s.remote_access === 'office_only') return false;
  if (s.remote_access === 'roles') return s.remote_roles.includes(user.role);
  return true;
}
// short-lived tickets between "password correct" and "code correct" (5 minutes, single use)
const tickets = new Map();
function ticketFor(userId, extra = {}) {
  const t = crypto.randomBytes(24).toString('hex');
  tickets.set(t, { userId, at: Date.now(), ...extra });
  for (const [k, v] of tickets) if (Date.now() - v.at > 300000) tickets.delete(k);
  return t;
}
function takeTicket(t, keep) { const v = tickets.get(String(t || '')); if (!v || Date.now() - v.at > 300000) { tickets.delete(String(t || '')); return null; } if (!keep) tickets.delete(String(t)); return v; }
function attempt(t) { const v = tickets.get(String(t || '')); if (v) { v.tries = (v.tries || 0) + 1; if (v.tries >= 5) tickets.delete(String(t)); } }

/* ---------- deployment status (for Settings → Access & security) ---------- */
function lanAddresses(port) {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push(`http://${n.address}:${port}`);
  return out;
}

module.exports = { DEFAULTS, MANAGER_ROLES, settings, saveSettings, isTrusted, parseCidr, cleanIp, checkLocked, recordFail, clearFails, totp, verifyTotp, newSecret, otpauth, b32encode,
  needsTwoFactor, mayWorkRemotely, ticketFor, takeTicket, attempt, lanAddresses };
