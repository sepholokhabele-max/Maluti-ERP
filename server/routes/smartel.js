// Smartel POS backend connection: settings, tills, agent services at the till, digital tenders, sync, NPR, Thoki, bulk wages.
const express = require('express');
const db = require('../db');
const sm = require('../services/smartel');
const { requirePerm, can } = require('../auth');
const { ah, bad } = require('../util');

const r = express.Router();
const tillPerm = (req, res, next) => (can(req.user, 'vas') || can(req.user, 'pos')) ? next() : next(Object.assign(new Error('No till access'), { status: 403 }));
const adminOrAcc = (req, res, next) => (can(req.user, 'settings') || can(req.user, 'accounting')) ? next() : next(Object.assign(new Error('No access'), { status: 403 }));

// ---- connection settings (owner / admin) ----
r.get('/smartel/status', adminOrAcc, ah(async (req, res) => res.json(await sm.status())));
r.put('/smartel/settings', requirePerm('settings'), ah(async (req, res) => res.json(await sm.saveSettings(req.body || {}))));
r.post('/smartel/test', requirePerm('settings'), ah(async (req, res) => {
  const out = {};
  const t = req.body.pos_terminal_id ? await db.one('SELECT * FROM smartel_terminals WHERE pos_terminal_id = ?', [req.body.pos_terminal_id]) : await db.one('SELECT * FROM smartel_terminals ORDER BY pos_terminal_id LIMIT 1');
  for (const [k, svc, path] of [['pos_api', 'pos-api', '/healthz'], ['syncd', 'syncd', '/healthz']]) {
    try { await sm.call(svc, 'GET', path, undefined, { terminal: t || undefined }); out[k] = { ok: true }; } catch (e) { out[k] = { ok: false, error: e.message }; }
  }
  if (t) { try { const reg = await sm.call('pos-api', 'GET', '/v1/register/scope', undefined, { terminal: t }); out.till = { ok: true, register_version: reg.version || 0 }; } catch (e) { out.till = { ok: false, error: e.message }; } }
  else out.till = { ok: false, error: 'No till is linked yet' };
  res.json(out);
}));
r.put('/smartel/terminals/:id', requirePerm('settings'), ah(async (req, res) => {
  const t = await db.one('SELECT id FROM pos_terminals WHERE id = ?', [req.params.id]);
  if (!t) throw bad('Unknown till');
  const b = req.body || {};
  const tid = String(b.terminal_uuid || '').trim();
  if (!tid) { await db.query('DELETE FROM smartel_terminals WHERE pos_terminal_id = ? AND device_seq = 0', [t.id]); return res.json({ ok: true, unlinked: true }); }
  if (!/^[0-9a-f-]{8,64}$/i.test(tid)) throw bad('The Smartel terminal ID looks wrong – copy it exactly from the Smartel welcome letter');
  const cur = await db.one('SELECT * FROM smartel_terminals WHERE pos_terminal_id = ?', [t.id]);
  if (cur && cur.terminal_uuid !== tid && Number(cur.device_seq) > 0) throw bad('This till already sent receipts under another Smartel terminal ID. Ask Smartel support before changing it.');
  const cert = b.cert_pem && b.cert_pem !== '********' ? String(b.cert_pem).trim() : (cur ? cur.cert_pem : null);
  const key = b.key_pem && b.key_pem !== '********' ? String(b.key_pem).trim() : (cur ? cur.key_pem : null);
  if (cert && !/BEGIN CERTIFICATE/.test(cert)) throw bad('The certificate must be the PEM text that starts with -----BEGIN CERTIFICATE-----');
  if (key && !/BEGIN [A-Z ]*PRIVATE KEY/.test(key)) throw bad('The key must be the PEM text that starts with -----BEGIN PRIVATE KEY-----');
  await db.query(`INSERT INTO smartel_terminals (pos_terminal_id, terminal_uuid, cert_pem, key_pem) VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE terminal_uuid = VALUES(terminal_uuid), cert_pem = VALUES(cert_pem), key_pem = VALUES(key_pem)`, [t.id, tid, cert || null, key || null]);
  res.json({ ok: true });
}));
r.post('/smartel/terminals/:id/release', requirePerm('settings'), ah(async (req, res) => {
  // after Smartel support fixed the chain on their side (posctl verify-chain) the till may send again
  await db.query(`UPDATE smartel_terminals SET quarantined = 0, quarantine_reason = NULL WHERE pos_terminal_id = ?`, [req.params.id]);
  await db.query(`UPDATE smartel_outbox SET status = 'pending' WHERE pos_terminal_id = ? AND status = 'held'`, [req.params.id]);
  res.json({ ok: true });
}));

// ---- sync ----
r.post('/smartel/push', adminOrAcc, ah(async (req, res) => res.json(await sm.push())));
r.post('/smartel/pull', adminOrAcc, ah(async (req, res) => res.json(await sm.pull())));
r.post('/smartel/heartbeat', adminOrAcc, ah(async (req, res) => res.json({ terminals: await sm.heartbeat() })));
r.post('/smartel/register', adminOrAcc, ah(async (req, res) => res.json(await sm.loadRegister())));
r.get('/smartel/outbox', adminOrAcc, ah(async (req, res) => {
  const cond = []; const args = [];
  if (req.query.status) { cond.push('o.status = ?'); args.push(req.query.status); }
  if (req.query.terminal) { cond.push('o.pos_terminal_id = ?'); args.push(req.query.terminal); }
  res.json(await db.query(`SELECT o.id, o.pos_terminal_id, t.name terminal_name, o.client_id, o.type, o.schema_version, o.device_seq, o.hash, o.prev_hash, o.status, o.code, o.reason, o.source_type, o.source_id, o.attempts, o.created_at, o.sent_at
    FROM smartel_outbox o JOIN pos_terminals t ON t.id = o.pos_terminal_id ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY o.id DESC LIMIT 300`, args));
}));
r.get('/smartel/outbox/:id', adminOrAcc, ah(async (req, res) => {
  const e = await db.one('SELECT * FROM smartel_outbox WHERE id = ?', [req.params.id]);
  if (!e) throw bad('Not found');
  e.check = sm.envelopeHash(e.prev_hash, e.device_seq, e.body) === e.hash;
  e.body = JSON.parse(e.body);
  res.json(e);
}));
/** re-check the whole local chain of a till (what syncd will check) */
r.get('/smartel/verify/:terminal', adminOrAcc, ah(async (req, res) => {
  const rows = await db.query('SELECT device_seq, prev_hash, hash, body FROM smartel_outbox WHERE pos_terminal_id = ? ORDER BY device_seq', [req.params.terminal]);
  let prev = 'GENESIS', expect = 1;
  for (const e of rows) {
    if (Number(e.device_seq) !== expect) return res.json({ ok: false, at: e.device_seq, error: `gap: expected ${expect}` });
    if (e.prev_hash !== prev) return res.json({ ok: false, at: e.device_seq, error: 'link broken' });
    if (sm.envelopeHash(e.prev_hash, e.device_seq, e.body) !== e.hash) return res.json({ ok: false, at: e.device_seq, error: 'hash does not match body' });
    prev = e.hash; expect++;
  }
  res.json({ ok: true, envelopes: rows.length, head: prev });
}));
r.get('/smartel/changes', adminOrAcc, ah(async (req, res) => res.json(await db.query('SELECT * FROM smartel_changes ORDER BY id DESC LIMIT 200'))));
r.get('/smartel/recalls', ah(async (req, res) => res.json(await db.query(`SELECT r.*, (SELECT GROUP_CONCAT(p.name SEPARATOR ', ') FROM products p WHERE LPAD(p.barcode, 14, '0') = r.gtin) products
  FROM smartel_recalls r ORDER BY r.closed_at IS NULL DESC, r.received_at DESC LIMIT 200`))));
r.get('/smartel/products', adminOrAcc, ah(async (req, res) => {
  const blocked = await sm.blockedProducts();
  const rows = await db.query(`SELECT id, name, barcode, smartel_product_id, stock_qty FROM products WHERE active = 1 AND type = 'stock' ORDER BY name LIMIT 2000`);
  res.json(rows.map(p => ({ ...p, gtin_ok: sm.validGtin(p.barcode), gtin: sm.gtinFor(p), blocked: blocked[p.id] || null })));
}));
r.put('/smartel/products/:id', requirePerm('catalog'), ah(async (req, res) => {
  await db.query('UPDATE products SET smartel_product_id = ? WHERE id = ?', [String(req.body.smartel_product_id || '').trim() || null, req.params.id]);
  res.json({ ok: true });
}));
r.get('/smartel/credit', adminOrAcc, ah(async (req, res) => res.json(await db.query('SELECT * FROM smartel_credit ORDER BY as_of DESC LIMIT 60'))));
r.post('/smartel/settle', requirePerm('accounting'), ah(async (req, res) => res.json(await sm.settle(req.user, req.body || {}))));
r.get('/smartel/ops', adminOrAcc, ah(async (req, res) => {
  const d = req.query.date || null;
  res.json(await db.query(`SELECT o.*, u.name user_name, t.name terminal_name FROM smartel_ops o JOIN smartel_sessions s ON s.session_uuid = o.session_uuid
    LEFT JOIN users u ON u.id = o.user_id LEFT JOIN pos_terminals t ON t.id = s.pos_terminal_id ${d ? 'WHERE DATE(o.created_at) = ?' : ''} ORDER BY o.id DESC LIMIT 500`, d ? [d] : []));
}));

// ---- the till: agent services, digital tenders, finishing a customer, scan flags ----
r.get('/smartel/sessions/:uuid', tillPerm, ah(async (req, res) => res.json(await sm.sessionView(req.params.uuid))));
r.post('/smartel/ops', tillPerm, ah(async (req, res) => {
  if (!can(req.user, 'vas')) throw bad('Your role cannot do payment services. Ask the manager.');
  await require('../services/activation').assertCanSell();
  const out = await sm.startOp(req.user, req.body || {});
  res.json({ ...out, session: await sm.sessionView(out.session_uuid) });
}));
r.post('/smartel/ops/:id/confirm', tillPerm, ah(async (req, res) => {
  const op = await sm.confirmOp(req.user, Number(req.params.id), { otp: req.body.otp, pin: req.body.pin });
  res.json({ op, session: await sm.sessionView(op.session_uuid) });
}));
r.post('/smartel/ops/:id/refresh', tillPerm, ah(async (req, res) => {
  const op = await sm.refreshOp(Number(req.params.id));
  res.json({ op, session: await sm.sessionView(op.session_uuid) });
}));
r.post('/smartel/ops/:id/cancel', tillPerm, ah(async (req, res) => {
  const op = await sm.cancelOp(Number(req.params.id));
  res.json({ op, session: await sm.sessionView(op.session_uuid) });
}));
r.post('/smartel/sessions/:uuid/finish', tillPerm, ah(async (req, res) => {
  const out = await sm.finishServices(req.user, req.params.uuid);
  res.json({ ...out, session: await sm.sessionView(req.params.uuid) });
}));
r.post('/smartel/intents', tillPerm, ah(async (req, res) => {
  await require('../services/activation').assertCanSell();
  res.json(await sm.createIntent(req.user, req.body || {}));
}));
r.get('/smartel/intents/:id', tillPerm, ah(async (req, res) => res.json(await sm.refreshIntent(Number(req.params.id)))));
r.post('/smartel/flags', tillPerm, ah(async (req, res) => res.json({ ok: true, flag: await sm.flag(Number(req.body.terminal_id), req.body) })));

// ---- bulk wages (owner portal) ----
r.get('/smartel/bulk', requirePerm('payroll'), ah(async (req, res) => res.json(await db.query(`SELECT b.*, r.period, (SELECT COUNT(*) FROM smartel_bulk_lines l WHERE l.bulk_id = b.id) lines_n,
  (SELECT COUNT(*) FROM smartel_bulk_lines l WHERE l.bulk_id = b.id AND l.state = 'paid') paid_n, (SELECT COUNT(*) FROM smartel_bulk_lines l WHERE l.bulk_id = b.id AND l.state = 'failed') failed_n
  FROM smartel_bulk b LEFT JOIN payroll_runs r ON r.id = b.payroll_run_id ORDER BY b.id DESC LIMIT 100`))));
r.get('/smartel/bulk/:id', requirePerm('payroll'), ah(async (req, res) => res.json(await sm.bulkView(Number(req.params.id)))));
r.post('/smartel/bulk/from-payroll/:runId', requirePerm('payroll'), ah(async (req, res) => res.json(await sm.bulkFromPayroll(req.user, Number(req.params.runId)))));
r.post('/smartel/bulk/:id/send', requirePerm('payroll'), ah(async (req, res) => res.json(await sm.bulkSend(req.user, Number(req.params.id)))));
r.post('/smartel/bulk/:id/refresh', requirePerm('payroll'), ah(async (req, res) => res.json(await sm.bulkRefresh(Number(req.params.id)))));
r.post('/smartel/bulk/:id/cancel', requirePerm('payroll'), ah(async (req, res) => {
  const b = await db.one('SELECT * FROM smartel_bulk WHERE id = ?', [req.params.id]);
  if (!b) throw bad('Not found');
  if (b.batch_id && b.state !== 'draft' && b.state !== 'created') throw bad('This batch is already being paid');
  await db.query(`UPDATE smartel_bulk SET state = 'cancelled' WHERE id = ?`, [b.id]);
  res.json({ ok: true });
}));

module.exports = r;
