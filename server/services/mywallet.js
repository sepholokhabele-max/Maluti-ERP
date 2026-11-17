// My Wallet payments at the till (My Wallet API v4, /api/v4/pos/*) – part of the Smartel adapter layer.
//
// The till never talks to My Wallet: the browser asks this server, and this server signs each call with the shop's
// merchant key (HMAC-SHA256, see the v4 docs §5.1). The secret stays in the S-ERP database, is never sent to a
// browser and is never logged. Only the public v4 POS endpoints are used – never My Wallet's core banking.
//
//   1. the cashier chooses "My Wallet" (or "Other wallet") and presses Ask customer to pay
//   2. a payment request is made at My Wallet → a code and QR (MWPAY:<code>); with the customer's number they also get
//      a notification. Customers of M-Pesa / EcoCash / … send the money through the national switch with the code.
//   3. the till waits until the request is PAID; only then can the sale be validated (checked again on the server)
//   4. refunds to "My Wallet" go back the way the money came (wallet, or through the switch)
//
// Modes: demo (a built-in simulator – nothing leaves the computer) and live (a My Wallet v4 server).
// The shop is linked by activating with its My Wallet agent number and password: My Wallet returns the merchant key.
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const db = require('../db');
const { round2, bad } = require('../util');

const DEFAULTS = { enabled: false, mode: 'demo', api_url: '', key_id: '', secret: '', till_number: '', merchant_name: '', cell: '', timeout_s: 25, request_ttl: 300, linked_at: null };
const SECRET = '********';
const METHODS = { 'mywallet:wallet': 'wallet', 'mywallet:switch': 'switch' };
const FINAL = ['PAID', 'DECLINED', 'CANCELLED', 'EXPIRED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'];
const MY_MEMBER = '2010002';
const MEMBERS = [['2010002', 'My Wallet'], ['2010001', 'M-Pesa'], ['4010001', 'EcoCash'], ['4010002', 'C-Pay'], ['101001', 'Khetsi']];
const link = { ok: null, at: null, error: null };

const envUrl = () => String(process.env.MALUTI_MYWALLET_API_URL || '').trim().replace(/\/+$/, '');
const isMyWallet = m => !!(m && METHODS[m.plugin_id]);

async function settings(raw = false) {
  const s = { ...DEFAULTS, ...((await db.getSetting('mywallet', {})) || {}) };
  if (!s.api_url && envUrl()) s.api_url = envUrl();
  if (!raw) { s.has_secret = !!s.secret; s.secret = s.secret ? SECRET : ''; }
  return s;
}

async function saveSettings(patch) {
  const cur = await settings(true);
  const next = { ...cur };
  for (const k of ['enabled', 'mode', 'api_url', 'key_id', 'secret', 'timeout_s', 'request_ttl']) {
    if (patch[k] === undefined) continue;
    if (k === 'secret' && (patch[k] === SECRET || patch[k] === '')) continue;
    next[k] = patch[k];
  }
  next.enabled = !!next.enabled;
  next.mode = next.mode === 'live' ? 'live' : 'demo';
  next.api_url = String(next.api_url || '').trim().replace(/\/+$/, '').replace(/\/api\/v4$/, '');
  if (next.api_url && !/^https:\/\//i.test(next.api_url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(next.api_url)) throw bad('The My Wallet address must start with https://');
  next.timeout_s = Math.min(Math.max(Number(next.timeout_s) || 25, 5), 60);
  next.request_ttl = Math.min(Math.max(Number(next.request_ttl) || 300, 60), 900);
  if (next.enabled && next.mode === 'live' && (!next.api_url || !next.key_id || !next.secret)) throw bad('Link the shop first (agent number and password), or enter the My Wallet address, key id and secret');
  await db.setSetting('mywallet', next);
  await syncMethods(next.enabled);
  return settings();
}

/** the two tenders exist (active) only while My Wallet payments are switched on */
async function syncMethods(on) {
  const want = [['mywallet:wallet', 'My Wallet', 24], ['mywallet:switch', 'Other wallet (M-Pesa, EcoCash…)', 25]];
  for (const [pid, name, sort] of want) {
    const m = await db.one('SELECT id FROM payment_methods WHERE plugin_id = ?', [pid]);
    if (m) await db.query('UPDATE payment_methods SET active = ? WHERE id = ?', [on ? 1 : 0, m.id]);
    else if (on) await db.query(`INSERT INTO payment_methods (name, kind, account_code, requires_reference, plugin_id, sort_order) VALUES (?, 'mobile_money', '1150', 0, ?, ?)`, [name, pid, sort]);
  }
}

// ------------------------------------------------------------------ signed calls to My Wallet v4
function rawRequest(urlStr, { method, body, headers, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({ method, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, headers, timeout: timeoutMs }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch (_) { /* not json */ } resolve({ status: res.statusCode, json, text }); });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { timeout: true })));
    req.on('error', e => reject(Object.assign(new Error(e.timeout ? 'My Wallet did not answer in time' : `Cannot reach My Wallet (${e.code || e.message}). Check the internet connection.`), { status: e.timeout ? 504 : 503, offline: true })));
    if (body) req.write(body);
    req.end();
  });
}

/** the string My Wallet signs: timestamp, nonce, METHOD, /api/v4/path?query, sha256(body) – one per line */
function signature(secret, ts, nonce, method, path, body) {
  const base = [ts, nonce, method.toUpperCase(), path, crypto.createHash('sha256').update(body || '', 'utf8').digest('hex')].join('\n');
  return crypto.createHmac('sha256', secret).update(base).digest('hex');
}

async function api(method, path, bodyObj, { idem, s: given, unsigned } = {}) {
  const s = given || await settings(true);
  if (!s.api_url) throw bad('The My Wallet address is not set (Settings → My Wallet payments)');
  const full = '/api/v4' + path;
  const body = bodyObj === undefined ? '' : JSON.stringify(bodyObj);
  const headers = { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) };
  if (!unsigned) {
    if (!s.key_id || !s.secret) throw bad('This shop is not linked to My Wallet yet (Settings → My Wallet payments)');
    const ts = String(Math.floor(Date.now() / 1000)), nonce = crypto.randomBytes(12).toString('hex');
    Object.assign(headers, { 'X-Key-Id': s.key_id, 'X-Timestamp': ts, 'X-Nonce': nonce, 'X-Signature': signature(s.secret, ts, nonce, method, full, body) });
  }
  if (idem) headers['Idempotency-Key'] = idem;
  let r;
  try { r = await rawRequest(s.api_url + full, { method, body, headers, timeoutMs: Number(s.timeout_s || 25) * 1000 }); }
  catch (e) { Object.assign(link, { ok: false, at: new Date().toISOString(), error: e.message }); throw e; }
  Object.assign(link, { ok: true, at: new Date().toISOString(), error: null });
  const j = r.json || {};
  if (r.status >= 200 && r.status < 300 && j.ok !== false) return j.data || {};
  const e = j.error || {};
  const msg = e.message || (r.status === 401 ? 'My Wallet refused the shop key – link the shop again under Settings → My Wallet payments' : `My Wallet answered ${r.status}`);
  throw Object.assign(new Error(msg), { status: r.status >= 500 ? 502 : r.status === 401 ? 400 : r.status, code: e.code || 'HTTP_' + r.status, remote: e });
}

async function installId() { return (await require('./activation').get()).install_id; }

// ------------------------------------------------------------------ linking the shop (activation with the agent number)
/** My Wallet checks the agent number and password and returns this installation's merchant key */
async function linkAgent(agentNo, password, { label } = {}) {
  const s = await settings(true);
  if (!s.api_url) return null; // no My Wallet server configured: activation stays local
  const iid = await installId();
  const company = ((await db.getSetting('company', {})) || {}).name || 'S-ERP';
  const r = await api('POST', '/merchant/activate', { agent_no: agentNo, password, install_id: iid, label: label || company }, { s, unsigned: true });
  await db.setSetting('mywallet', { ...s, enabled: true, mode: 'live', key_id: r.key_id, secret: r.secret, till_number: r.till_number, merchant_name: r.name, cell: r.cell, linked_at: new Date().toISOString() });
  await syncMethods(true);
  return { till_number: r.till_number, name: r.name };
}

async function test() {
  const s = await settings(true);
  if (s.mode === 'demo') return { ok: true, demo: true, till_number: s.till_number || 'DEMO', name: s.merchant_name || 'Demo shop' };
  const me = await api('GET', '/pos/me', undefined, { s });
  await db.setSetting('mywallet', { ...s, till_number: me.till_number, merchant_name: me.name, cell: me.cell });
  return { ok: true, till_number: me.till_number, name: me.name, balance_today: me.balance_today, merchant_fee_percent: me.merchant_fee_percent };
}

// ------------------------------------------------------------------ payment requests
const demoCode = () => Array.from(crypto.randomBytes(6)).map(b => '23456789ABCDEFGHJKMNPQRSTUVWXYZ'[b % 31]).join('');

async function view(id) {
  const p = await db.one('SELECT * FROM mywallet_payments WHERE id = ?', [id]);
  if (!p) return null;
  const qr = p.code && p.channel === 'wallet' ? 'MWPAY:' + p.code : null;
  return { ...p, amount: Number(p.amount), refunded: Number(p.refunded), qr_text: qr, qr_svg: qr ? await require('./qr').svg(qr) : null,
    paid: p.status === 'PAID', final: FINAL.includes(p.status), member_name: (MEMBERS.find(m => m[0] === p.payer_member) || [])[1] || null };
}

function cleanCell(v) {
  const d = String(v || '').replace(/\D+/g, '').replace(/^266(?=[56]\d{7}$)/, '');
  return /^[56]\d{7}$/.test(d) ? d : null;
}

async function createPayment(user, { method_id, amount, payer_cell, payer_member, session_id, partner_id }) {
  const s = await settings(true);
  if (!s.enabled) throw bad('My Wallet payments are switched off (Settings → My Wallet payments)');
  await require('./activation').assertCanSell();
  const m = await db.one('SELECT * FROM payment_methods WHERE id = ? AND active = 1', [method_id]);
  if (!isMyWallet(m)) throw bad('Choose My Wallet or Other wallet');
  const amt = round2(amount);
  if (!(amt > 0)) throw bad('Enter the amount to pay');
  const channel = METHODS[m.plugin_id];
  const cell = payer_cell ? cleanCell(payer_cell) : null;
  if (payer_cell && !cell) throw bad('The customer’s number is not a Lesotho cell number');
  const member = channel === 'wallet' ? MY_MEMBER : String(payer_member || '');
  if (channel === 'switch' && (!member || member === MY_MEMBER || !MEMBERS.some(x => x[0] === member))) throw bad('Choose the customer’s wallet (M-Pesa, EcoCash, …)');
  const ins = await db.query(`INSERT INTO mywallet_payments (mode, channel, method_id, amount, payer_cell, payer_member, session_id, partner_id, user_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW')`, [s.mode, channel, m.id, amt, cell, member, session_id || null, partner_id || null, user ? user.id : null]);
  const id = ins.insertId;
  const iid = await installId();
  const ref = `SERP-${String(iid).replace(/-/g, '').slice(0, 8)}-${id}`;
  if (s.mode === 'demo') {
    const code = demoCode();
    await db.query(`UPDATE mywallet_payments SET merchant_reference = ?, remote_id = ?, code = ?, status = 'PENDING', expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
      instructions = ? WHERE id = ?`, [ref, crypto.randomUUID(), code, s.request_ttl, channel === 'switch' ? `Ask the customer to send ${amt.toFixed(2)} from ${(MEMBERS.find(x => x[0] === member) || [])[1]} to the shop's My Wallet number with reference ${code}. (Demo – nothing is sent.)` : null, id]);
    return view(id);
  }
  try {
    const r = await api('POST', '/pos/payments', { amount: amt, merchant_reference: ref, description: 'S-ERP sale', ...(cell ? { payer_cell: cell } : {}), payer_member: member, expires_in: s.request_ttl },
      { s, idem: `serp-pay-${iid}-${id}` });
    await save(id, r, { merchant_reference: ref });
  } catch (e) {
    await db.query(`UPDATE mywallet_payments SET status = 'FAILED', error = ? WHERE id = ?`, [String(e.message).slice(0, 255), id]);
    throw e;
  }
  return view(id);
}

async function save(id, r, extra = {}) {
  await db.query(`UPDATE mywallet_payments SET merchant_reference = COALESCE(?, merchant_reference), remote_id = COALESCE(?, remote_id), code = COALESCE(?, code),
      status = ?, payer_cell = COALESCE(?, payer_cell), mw_reference = COALESCE(?, mw_reference), merchant_fee = COALESCE(?, merchant_fee),
      instructions = COALESCE(?, instructions), expires_at = COALESCE(?, expires_at), paid_at = COALESCE(?, paid_at), refunded = COALESCE(?, refunded), updated_at = NOW() WHERE id = ?`,
  [extra.merchant_reference || null, r.id || null, r.code || null, r.status || 'PENDING', r.payer_cell || null, r.reference || null, r.merchant_fee ?? null,
    r.instructions || null, r.expires_at ? new Date(r.expires_at) : null, r.paid_at ? new Date(r.paid_at) : null, r.refunded ?? null, id]);
}

/** ask My Wallet for the latest state (demo: expire when the time is up) */
async function refresh(id) {
  const p = await db.one('SELECT * FROM mywallet_payments WHERE id = ?', [id]);
  if (!p) throw bad('Payment request not found');
  if (p.status === 'PENDING') {
    if (p.mode === 'demo') {
      if (p.expires_at && new Date(p.expires_at) < new Date()) await db.query(`UPDATE mywallet_payments SET status = 'EXPIRED', updated_at = NOW() WHERE id = ? AND status = 'PENDING'`, [id]);
    } else if (p.remote_id) {
      try { await save(id, await api('GET', '/pos/payments/' + p.remote_id)); } catch (e) { if (!e.offline) throw e; }
    }
  }
  return view(id);
}

async function cancel(id) {
  const p = await db.one('SELECT * FROM mywallet_payments WHERE id = ?', [id]);
  if (!p) throw bad('Payment request not found');
  if (p.status !== 'PENDING') return view(id);
  if (p.mode === 'live' && p.remote_id) {
    try { await save(id, await api('POST', `/pos/payments/${p.remote_id}/cancel`, {})); }
    catch (e) { if (e.code === 'NOT_CANCELLABLE') return refresh(id); throw e; }
  } else await db.query(`UPDATE mywallet_payments SET status = 'CANCELLED', updated_at = NOW() WHERE id = ?`, [id]);
  return view(id);
}

/** demo only: play the customer's part */
async function simulate(id, outcome = 'approve') {
  const p = await db.one('SELECT * FROM mywallet_payments WHERE id = ?', [id]);
  if (!p || p.mode !== 'demo') throw bad('Only demo payments can be simulated');
  if (p.status !== 'PENDING') return view(id);
  if (outcome === 'decline') await db.query(`UPDATE mywallet_payments SET status = 'DECLINED', updated_at = NOW() WHERE id = ?`, [id]);
  else await db.query(`UPDATE mywallet_payments SET status = 'PAID', paid_at = NOW(), payer_cell = COALESCE(payer_cell, '58000000'), mw_reference = ?, updated_at = NOW() WHERE id = ?`, [`MW4P.DEMO.${p.code}`, id]);
  return view(id);
}

// ------------------------------------------------------------------ the sale and its refund
/**
 * Inside the pay / checkout transaction: every My Wallet tender must point at a PAID request for exactly that amount
 * that no other sale has used. The request is tied to the order; the payment reference becomes the My Wallet code.
 */
async function claimForOrder(conn, orderId, pays) {
  for (const p of pays) {
    if (!isMyWallet(p.m)) continue;
    const id = Number(p.mywallet_payment_id);
    const row = id ? await conn.one('SELECT * FROM mywallet_payments WHERE id = ? FOR UPDATE', [id]) : null;
    if (!row) throw bad(`Ask the customer to pay with ${p.m.name} first and wait until it shows approved`);
    if (row.status !== 'PAID') throw bad(`The ${p.m.name} payment is ${String(row.status).toLowerCase()}, not approved`);
    if (row.order_id && Number(row.order_id) !== Number(orderId)) throw bad('This My Wallet payment was already used for another sale');
    if (Number(row.method_id) !== Number(p.m.id)) throw bad('This My Wallet payment was made for another payment method');
    if (Math.round(Number(row.amount) * 100) !== Math.round(Number(p.amount) * 100)) throw bad(`The approved amount (${Number(row.amount).toFixed(2)}) does not match this payment line (${Number(p.amount).toFixed(2)})`);
    await conn.query('UPDATE mywallet_payments SET order_id = ? WHERE id = ?', [orderId, id]);
    p.reference = `MW ${row.code}`;
    p.phone = p.phone || row.payer_cell;
  }
}

/**
 * Inside the refund transaction, as its last step: send the refund to My Wallet (back to the customer's wallet, or
 * through the switch). If My Wallet refuses, the whole refund is rolled back. Oldest My Wallet payment first.
 */
async function refundForOrder(conn, origOrderId, refundOrderId, amount) {
  const rows = await conn.query(`SELECT * FROM mywallet_payments WHERE order_id = ? AND status IN ('PAID','PARTIALLY_REFUNDED') ORDER BY id FOR UPDATE`, [origOrderId]);
  let left = Math.round(round2(amount) * 100);
  const room = rows.reduce((a, r) => a + Math.round((Number(r.amount) - Number(r.refunded)) * 100), 0);
  if (!rows.length) throw bad('This sale was not paid with My Wallet – refund it in cash or another way');
  if (left > room) throw bad(`Only ${(room / 100).toFixed(2)} of this sale can still go back to My Wallet`);
  const iid = await installId();
  const out = [];
  for (const r of rows) {
    if (left <= 0) break;
    const part = Math.min(left, Math.round((Number(r.amount) - Number(r.refunded)) * 100));
    if (part <= 0) continue;
    const amt = part / 100;
    let status = 'DONE', ref = `MW4R.DEMO.${r.code}`;
    if (r.mode === 'live') {
      const res = await api('POST', `/pos/payments/${r.remote_id}/refund`, { amount: amt, reason: 'S-ERP refund' }, { idem: `serp-refund-${iid}-${refundOrderId}-${r.id}` });
      status = res.refund.status; ref = res.refund.reference;
      if (status === 'FAILED') throw bad('My Wallet could not send the refund back to the customer’s wallet. Nothing was refunded.');
    }
    const refunded = round2(Number(r.refunded) + amt);
    await conn.query(`UPDATE mywallet_payments SET refunded = ?, status = ?, updated_at = NOW() WHERE id = ?`, [refunded, refunded + 0.001 >= Number(r.amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED', r.id]);
    await conn.query('INSERT INTO mywallet_refunds (payment_id, refund_order_id, amount, status, mw_reference) VALUES (?, ?, ?, ?, ?)', [r.id, refundOrderId, amt, status, ref]);
    out.push({ code: r.code, amount: amt, status, reference: ref });
    left -= part;
  }
  return out;
}

// ------------------------------------------------------------------ status page / scheduler
async function status() {
  const s = await settings();
  const today = await db.one(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) total FROM mywallet_payments WHERE status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') AND DATE(paid_at) = CURDATE()`);
  const recent = await db.query(`SELECT p.*, o.number order_number, m.name method_name FROM mywallet_payments p LEFT JOIN orders o ON o.id = p.order_id
    LEFT JOIN payment_methods m ON m.id = p.method_id ORDER BY p.id DESC LIMIT 30`);
  const refunds = await db.query('SELECT f.*, p.code FROM mywallet_refunds f JOIN mywallet_payments p ON p.id = f.payment_id ORDER BY f.id DESC LIMIT 20');
  const due = await db.one(`SELECT COALESCE(SUM(l.debit - l.credit),0) bal FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '1150'`).catch(() => ({ bal: 0 }));
  const unused = await db.one(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) total FROM mywallet_payments WHERE status = 'PAID' AND order_id IS NULL AND paid_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)`);
  return { settings: s, link, members: MEMBERS.map(([code, name]) => ({ code, name })), today: { count: Number(today.n), total: round2(today.total) }, recent, refunds,
    digital_due: round2(due.bal), unused: { count: Number(unused.n), total: round2(unused.total) } };
}

async function catalogInfo() {
  const s = await settings(true);
  return { enabled: !!s.enabled, mode: s.mode, members: MEMBERS.filter(m => m[0] !== MY_MEMBER).map(([code, name]) => ({ code, name })) };
}

let timer = null;
function startScheduler() {
  stopScheduler();
  timer = setInterval(async () => {
    try {
      if (!db.isConnected() || !(await settings(true)).enabled) return;
      const rows = await db.query(`SELECT id FROM mywallet_payments WHERE status = 'PENDING' AND created_at > DATE_SUB(NOW(), INTERVAL 2 HOUR)`);
      for (const r of rows) await refresh(r.id).catch(() => {});
    } catch (_) { /* shown on the status page */ }
  }, 60 * 1000);
  if (timer.unref) timer.unref();
}
function stopScheduler() { if (timer) clearInterval(timer); timer = null; }

module.exports = { settings, saveSettings, syncMethods, signature, api, linkAgent, test, createPayment, refresh, cancel, simulate, view, claimForOrder, refundForOrder,
  status, catalogInfo, isMyWallet, startScheduler, stopScheduler, MEMBERS, link };
