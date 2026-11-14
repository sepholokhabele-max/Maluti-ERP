// Payment partners: the public collections API that partners call (pub, mounted at /api/collect/v1 before login),
// and the back-office screens' API (router, /api/paypartners…, permission 'paypartners').
const express = require('express');
const db = require('../db');
const { requirePerm } = require('../auth');
const { ah } = require('../util');
const PP = require('../services/paypartners');

/* ============================== public collections API ============================== */
const pub = express.Router();
const hits = new Map();
function limited(key, max) {
  const k = key + '|' + Math.floor(Date.now() / 60000), n = (hits.get(k) || 0) + 1; hits.set(k, n);
  if (hits.size > 5000) { const now = '|' + Math.floor(Date.now() / 60000); for (const x of hits.keys()) if (!x.endsWith(now)) hits.delete(x); }
  return n > max;
}
const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });
pub.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (limited('ip:' + req.ip, 600)) return fail(res, 429, 'RATE_LIMITED', 'Too many requests – slow down');
  if (!db.isConnected()) return fail(res, 503, 'UNAVAILABLE', 'The service is starting – try again shortly');
  next();
});
// authentication: Authorization: Bearer sk_live_… (or X-Api-Key). Every call is logged.
pub.use(async (req, res, next) => {
  try {
    const h = String(req.get('authorization') || '');
    const key = h.startsWith('Bearer ') ? h.slice(7).trim() : String(req.get('x-api-key') || '').trim();
    const p = await PP.byKey(key);
    res.on('finish', () => db.query('INSERT INTO pay_partner_log (partner_id, ip, method, path, status, error) VALUES (?, ?, ?, ?, ?, ?)',
      [p ? p.id : null, String(req.ip || '').slice(0, 64), req.method, req.originalUrl.slice(0, 160), res.statusCode, res.locals.err ? String(res.locals.err).slice(0, 250) : null]).catch(() => {}));
    if (!p) { res.locals.err = 'bad key'; return fail(res, 401, 'UNAUTHORIZED', 'Missing or wrong API key'); }
    if (p.status !== 'active') return fail(res, 403, 'SUSPENDED', 'This partner is suspended – contact the utility');
    if (!PP.ipAllowed(p, req.ip)) { res.locals.err = 'ip ' + req.ip; return fail(res, 403, 'IP_NOT_ALLOWED', 'Calls are not allowed from this IP address'); }
    if (limited('p:' + p.id, 1200)) return fail(res, 429, 'RATE_LIMITED', 'Too many requests – slow down');
    req.partner = p; next();
  } catch (e) { next(e); }
});
const api = fn => async (req, res) => {
  try { res.json(await fn(req, res)); } catch (e) {
    res.locals.err = e.message;
    if (e instanceof PP.ApiError) return fail(res, e.status, e.code, e.message);
    console.error('[collect]', e.message); fail(res, 500, 'SERVER_ERROR', 'Something went wrong – try again with the same reference');
  }
};
pub.get('/ping', api(async req => ({ ok: true, partner: req.partner.name, mode: req.partner.mode, time: new Date().toISOString() })));
pub.get('/accounts/:ref(*)', api(async req => PP.lookup(req.partner, decodeURIComponent(req.params.ref))));
pub.post('/payments', api(async req => PP.pay(req.partner, req.body || {})));
pub.get('/payments/:reference(*)', api(async req => PP.status(req.partner, decodeURIComponent(req.params.reference))));
pub.get('/transactions', api(async req => PP.statement(req.partner, req.query.from || req.query.date, req.query.to)));
pub.use((req, res) => fail(res, 404, 'NOT_FOUND', 'Unknown endpoint – see the API guide'));

/* ============================== back office ============================== */
const r = express.Router();
const P = requirePerm('paypartners');
r.get('/paypartners', P, ah(async (req, res) => res.json(await PP.list())));
r.post('/paypartners', P, ah(async (req, res) => res.json(await PP.create(req.user, req.body || {}))));
r.put('/paypartners/:id(\\d+)', P, ah(async (req, res) => res.json(await PP.update(req.params.id, req.body || {}))));
r.post('/paypartners/:id(\\d+)/key', P, ah(async (req, res) => {
  const out = await PP.newPartnerKey(req.params.id, (req.body || {}).mode);
  await db.query(`INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES (?, 'paypartner.key', 'pay_partners', ?, ?)`, [req.user.id, req.params.id, JSON.stringify({ mode: out.mode })]).catch(() => {});
  res.json(out);
}));
r.get('/paypartners/txns', P, ah(async (req, res) => res.json(await PP.txns(req.query))));
r.get('/paypartners/settlements', P, ah(async (req, res) => res.json(await db.query(`SELECT s.*, p.name partner_name, u.name user_name FROM pay_partner_settlements s
  JOIN pay_partners p ON p.id = s.partner_id LEFT JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 500`))));
r.post('/paypartners/:id(\\d+)/settle', P, ah(async (req, res) => res.json(await PP.settle(req.user, req.params.id, req.body || {}))));
r.get('/paypartners/log', P, ah(async (req, res) => res.json(await db.query(`SELECT l.*, p.name partner_name FROM pay_partner_log l LEFT JOIN pay_partners p ON p.id = l.partner_id
  ${req.query.partner_id ? 'WHERE l.partner_id = ?' : ''} ORDER BY l.id DESC LIMIT 300`, req.query.partner_id ? [req.query.partner_id] : []))));

module.exports = { pub, router: r };
