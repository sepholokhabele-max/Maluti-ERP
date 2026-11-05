// Smartel POS backend adapter.
//
// S-ERP never talks to the MyWallet core / core-banking API. Every money service, digital tender, register check and
// sync goes through the Smartel POS backend adapters:
//   pos-api  /v1/sessions, /v1/agent/ops, /v1/payments/intents, /v1/register/scope, /v1/portal/bulk-batches
//   syncd    /v1/sync/batches, /v1/sync/changes, /v1/sync/cursor
// Tills authenticate with their own client certificate (mTLS at the gateway). The owner portal (bulk wages) uses the
// owner's portal sign-in at the gateway. In "gateway" mode (a trusted gateway on the shop LAN, or a test backend) the
// identity headers are sent by S-ERP instead.
//
// Rules carried from SM-POS-BPD-001 / TDD-001:
//  * a session is one customer: goods, service lines and the goods tender close as ONE receipt and ONE sealed envelope
//  * a service is never sent twice; an unanswered one is "unknown" until pos-api resolves it from MyWallet's history (BR-11)
//  * the withdrawal OTP is passed straight through and never stored or logged (BR-10)
//  * offline: goods for cash only (BR-16); offline receipts are sealed and chained like online ones (BR-17)
//  * envelopes: hash = sha256(prev | seq | body bytes), first prev = "GENESIS"; the body is sent byte for byte as hashed
//  * payment services are not sales: no VAT, no revenue; only the commission is income (BR-19)
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const db = require('../db');
const accounting = require('./accounting');
const { round2, bad, HttpError, pad } = require('../util');

const GENESIS = 'GENESIS';
const DEFAULTS = {
  enabled: false, pos_api_url: '', syncd_url: '', auth: 'mtls', ca_pem: '', merchant_id: '',
  portal_auth: 'gateway', portal_sub: '', portal_token: '', npr: 'block', accept_prices: true, create_products: true,
  timeout_s: 25, offline_limit_hours: 72, gps_lat: null, gps_lng: null, grn_terminal_id: null, push_every_s: 30, pull_every_s: 300
};
const SECRET_KEYS = ['portal_token'];

// agent operations the till can run (pos-api agent catalogue) – the fields the cashier fills in
const OPS = {
  dep: { name: 'Cash deposit to MyWallet', st: 'Ho kenya chelete ho MyWallet', cash: +1, fields: ['cell', 'amount', 'reference'], need: ['cell'] },
  wd: { name: 'Cash withdrawal (customer OTP)', st: 'Ho ntša chelete (OTP ea moreki)', cash: -1, fields: ['cell', 'amount'], need: ['cell'], otp: true },
  tillout: { name: 'Till cash-out (agent account)', st: 'Ho ntša chelete ka till', cash: -1, fields: ['account', 'amount'], need: ['account'], otp: true },
  sthru: { name: 'Send money (send-through)', st: 'Romela chelete', cash: +1, fields: ['cell_sender', 'cell_recipient', 'amount'], need: ['cell_sender', 'cell_recipient'], pin: true },
  nps: { name: 'Cash-in to another network (NPS Switch)', st: 'Kenya chelete netweking e ngoe (NPS)', cash: +1, fields: ['tomember', 'account', 'cell', 'amount'], need: ['tomember', 'account'] },
  vredeem: { name: 'Redeem a Switch cash-out voucher', st: 'Lefa voucher ea Switch', cash: -1, fields: ['tomember', 'voucher', 'cell', 'amount'], need: ['tomember', 'voucher'] },
  airtime: { name: 'Airtime', st: 'Airtime', cash: +1, fields: ['network', 'cell', 'amount'], need: ['network', 'cell'] },
  lec: { name: 'Prepaid electricity (LEC)', st: 'Motlakase oa pele (LEC)', cash: +1, fields: ['meter', 'cell', 'amount'], need: ['meter'] },
  biller: { name: 'Pay a bill', st: 'Lefa sekoloto', cash: +1, fields: ['biller', 'account', 'cell', 'bouquet', 'amount'], need: ['biller', 'account'] }
};
// billers pos-api knows today; 'rsl' (Revenue Services Lesotho) is used by the tax centre once My Wallet / Smartel add it
const BILLERS = [['dstv', 'DStv'], ['wsb', 'WASCO (water)'], ['betting', 'Betting'], ['sima', 'SIMA'], ['spincity', 'Spin City'], ['rsl', 'Revenue Services Lesotho (tax)']];
const TENDERS = { 'smartel:card': 'card', 'smartel:mywallet': 'mywallet', 'smartel:switch': 'switch' };
const TERMINAL_OP = ['completed', 'failed', 'escalated'];
const BLOCKING = ['draft', 'submitted', 'unknown', 'unknown_start']; // a session cannot close while one of these is open (BR-11)

const link = { ok: null, at: null, error: null };
const minor = m => Math.round(round2(m) * 100);
const major = n => round2(Number(n || 0) / 100);
const uuid = () => crypto.randomUUID();
const envelopeHash = (prev, seq, body) => crypto.createHash('sha256').update(`${prev}|${seq}|`).update(Buffer.from(body, 'utf8')).digest('hex');

async function settings(raw = false) {
  const s = { ...DEFAULTS, ...((await db.getSetting('smartel', {})) || {}) };
  if (!raw) for (const k of SECRET_KEYS) if (s[k]) s[k] = '********';
  return s;
}
async function saveSettings(patch) {
  const cur = await settings(true);
  const next = { ...cur };
  for (const k of Object.keys(DEFAULTS)) if (patch[k] !== undefined) {
    if (SECRET_KEYS.includes(k) && patch[k] === '********') continue;
    next[k] = patch[k];
  }
  for (const k of ['pos_api_url', 'syncd_url']) next[k] = String(next[k] || '').trim().replace(/\/+$/, '');
  for (const k of ['pos_api_url', 'syncd_url']) if (next[k] && !/^https?:\/\//i.test(next[k])) throw bad(`The ${k === 'pos_api_url' ? 'pos-api' : 'syncd'} address must start with https://`);
  if (next.enabled && (!next.pos_api_url || !next.syncd_url)) throw bad('Enter both the pos-api and syncd addresses before switching the connection on');
  if (!['mtls', 'gateway'].includes(next.auth)) next.auth = 'mtls';
  if (!['block', 'warn', 'off'].includes(next.npr)) next.npr = 'block';
  await db.setSetting('smartel', next);
  await syncTenderMethods(next.enabled);
  return settings();
}
async function enabled() { return !!(await settings(true)).enabled; }

/** Card, MyWallet and Switch tenders exist as payment methods only while the connection is on (BR-05) */
async function syncTenderMethods(on) {
  const want = [['smartel:mywallet', 'MyWallet (scan to pay)', 'mobile_money', 21], ['smartel:card', 'Card (Smartel)', 'card', 22], ['smartel:switch', 'Switch – other wallets', 'mobile_money', 23]];
  for (const [pid, name, kind, sort] of want) {
    const m = await db.one('SELECT id FROM payment_methods WHERE plugin_id = ?', [pid]);
    if (m) await db.query('UPDATE payment_methods SET active = ? WHERE id = ?', [on ? 1 : 0, m.id]);
    else if (on) await db.query(`INSERT INTO payment_methods (name, kind, account_code, requires_reference, plugin_id, sort_order) VALUES (?, ?, '1150', 0, ?, ?)`, [name, kind, pid, sort]);
  }
}

// ------------------------------------------------------------------ HTTP client
class SmartelError extends HttpError {
  constructor(status, code, message, extra = {}) { super(status, message); this.code = code; Object.assign(this, extra); }
}
const FRIENDLY = {
  SES_BLOCKED: 'A service line is still waiting for MyWallet. Wait for it to finish (or be handed to operations) before closing this customer.',
  SES_TENDER_UNPAID: 'The card / MyWallet / Switch payment is not confirmed yet.',
  SES_NOT_FOUND: 'pos-api does not know this customer session. Start the service again.',
  AGT_OTP_INVALID: null, AGT_AMOUNT: 'Enter an amount bigger than 0.', AGT_OP_UNKNOWN: 'pos-api does not offer this service.',
  PAY_TENDER: 'pos-api only takes card, MyWallet or Switch payments.', TERM_SUSPENDED: 'This till is suspended by Smartel. Call Smartel support.',
  TERM_MISMATCH: 'The till ID does not match its certificate. Check the till settings under Smartel connection.',
  BULK_MSISDN: null, BULK_PROVIDER: null, BULK_EMPTY: 'There is nobody to pay in this batch.'
};

function request(urlStr, { method = 'GET', body, headers = {}, agentOpts = {}, timeoutMs = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(urlStr); } catch (_) { return reject(new SmartelError(400, 'CONFIG', `Bad address: ${urlStr}`)); }
    const lib = u.protocol === 'https:' ? https : http;
    const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = lib.request({
      method, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search,
      headers: { Accept: 'application/json', ...(data !== null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers },
      ...(u.protocol === 'https:' ? agentOpts : {}), timeout: timeoutMs
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('timeout', () => { req.destroy(Object.assign(new Error('timeout'), { timeout: true })); });
    req.on('error', e => reject(e.timeout ? new SmartelError(504, 'TIMEOUT', 'The Smartel backend did not answer in time', { timeout: true })
      : new SmartelError(503, 'OFFLINE', `Cannot reach the Smartel backend (${e.code || e.message}). Check the internet connection.`, { offline: true })));
    if (data !== null) req.write(data);
    req.end();
  });
}

async function terminalRow(posTerminalId, c = db) {
  const t = await c.one('SELECT * FROM smartel_terminals WHERE pos_terminal_id = ?', [posTerminalId]);
  return t || null;
}

/** call pos-api / syncd as a till (kind 'till') or as the owner portal (kind 'portal') */
async function call(service, method, path, body, { terminal, portal, timeoutMs } = {}) {
  const s = await settings(true);
  if (!s.enabled) throw bad('The Smartel connection is switched off (Settings → Smartel connection)');
  const base = service === 'syncd' ? s.syncd_url : s.pos_api_url;
  if (!base) throw bad(`The ${service} address is not set (Settings → Smartel connection)`);
  const headers = {}; const agentOpts = {};
  if (s.ca_pem) agentOpts.ca = s.ca_pem;
  if (portal) {
    if (s.portal_auth === 'bearer') { if (!s.portal_token) throw bad('Enter the owner portal token under Settings → Smartel connection'); headers.Authorization = `Bearer ${s.portal_token}`; }
    else { headers['X-User-Sub'] = s.portal_sub || 'maluti-owner'; headers['X-Merchant-ID'] = s.merchant_id; }
  } else if (terminal) {
    if (s.auth === 'mtls') { if (!terminal.cert_pem || !terminal.key_pem) throw bad('This till has no Smartel certificate yet (Settings → Smartel connection → Tills)'); agentOpts.cert = terminal.cert_pem; agentOpts.key = terminal.key_pem; }
    else headers['X-Terminal-ID'] = terminal.terminal_uuid;
  }
  let res;
  try { res = await request(base + path, { method, body, headers, agentOpts, timeoutMs: timeoutMs || Number(s.timeout_s || 25) * 1000 }); }
  catch (e) { link.ok = false; link.at = new Date().toISOString(); link.error = e.message; throw e; }
  link.ok = true; link.at = new Date().toISOString(); link.error = null;
  if (res.status >= 200 && res.status < 300) return res.json === null && res.status !== 204 ? {} : res.json;
  const j = res.json || {};
  const code = j.code || (res.status === 401 || res.status === 403 ? 'AUTH' : 'HTTP_' + res.status);
  const msg = FRIENDLY[code] || j.error || j.detail || j.message || res.text.slice(0, 200) || `Smartel backend answered ${res.status}`;
  throw new SmartelError(res.status >= 500 ? 502 : res.status === 404 ? 404 : res.status === 409 ? 409 : 400, code, msg, { remote: j });
}

// ------------------------------------------------------------------ GTIN helpers (GS1)
function gtinCheck(digits) { // digits without the check digit
  let sum = 0; const r = String(digits).split('').reverse();
  r.forEach((d, i) => { sum += Number(d) * (i % 2 === 0 ? 3 : 1); });
  return (10 - sum % 10) % 10;
}
const validGtin = g => /^\d{8}$|^\d{12,14}$/.test(String(g || '')) && gtinCheck(String(g).slice(0, -1)) === Number(String(g).slice(-1));
const gtin14 = g => String(g).padStart(14, '0');
/** the product's GTIN-14; products without a GS1 barcode get a restricted-circulation (in-store, prefix 2) number */
function gtinFor(p) {
  if (p && p.barcode && validGtin(p.barcode)) return gtin14(p.barcode);
  const body = '02' + String(p && p.id ? p.id : 0).padStart(11, '0').slice(-11);
  return body + gtinCheck(body);
}

// ------------------------------------------------------------------ envelopes: seal + push
/** seal an envelope on a till's hash chain (inside the caller's transaction) */
async function seal(c, posTerminalId, type, schemaVersion, bodyObj, { source_type = null, source_id = null, client_id = null } = {}) {
  const t = await c.one('SELECT * FROM smartel_terminals WHERE pos_terminal_id = ? FOR UPDATE', [posTerminalId]);
  if (!t) return null;
  const seq = Number(t.device_seq) + 1;
  const body = JSON.stringify(bodyObj);
  const hash = envelopeHash(t.head_hash, seq, body);
  const clientId = client_id || uuid();
  await c.query(`INSERT INTO smartel_outbox (pos_terminal_id, client_id, type, schema_version, device_seq, device_time, prev_hash, hash, body, source_type, source_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [posTerminalId, clientId, type, schemaVersion, seq, new Date().toISOString(), t.head_hash, hash, body, source_type, source_id]);
  await c.query('UPDATE smartel_terminals SET device_seq = ?, head_hash = ? WHERE pos_terminal_id = ?', [seq, hash, posTerminalId]);
  return { client_id: clientId, device_seq: seq, hash };
}

let pushing = null;
/** push every till's pending envelopes to syncd, oldest first (BR-17). Runs one at a time; a caller waits for a running push. */
async function push() {
  while (pushing) await pushing.catch(() => {});
  pushing = pushOnce();
  try { return await pushing; } finally { pushing = null; }
}
async function pushOnce() {
  const out = { sent: 0, applied: 0, held: 0, rejected: 0, errors: [] };
    if (!(await enabled())) return out;
    const terms = await db.query(`SELECT * FROM smartel_terminals t WHERE EXISTS (SELECT 1 FROM smartel_outbox o WHERE o.pos_terminal_id = t.pos_terminal_id AND o.status IN ('pending','held'))`);
    for (const t of terms) {
      const rows = await db.query(`SELECT * FROM smartel_outbox WHERE pos_terminal_id = ? AND status IN ('pending','held') ORDER BY device_seq LIMIT 200`, [t.pos_terminal_id]);
      if (!rows.length) continue;
      const batchId = uuid();
      // built by hand so each body goes out exactly as it was hashed
      const env = rows.map(e => `{"clientId":${JSON.stringify(e.client_id)},"type":${JSON.stringify(e.type)},"schemaVersion":${Number(e.schema_version)},"deviceSeq":${Number(e.device_seq)},"deviceTime":${JSON.stringify(e.device_time)},"prevHash":${JSON.stringify(e.prev_hash)},"hash":${JSON.stringify(e.hash)},"body":${e.body}}`);
      const batch = `{"batchId":${JSON.stringify(batchId)},"terminalId":${JSON.stringify(t.terminal_uuid)},"envelopes":[${env.join(',')}]}`;
      await db.query(`UPDATE smartel_outbox SET attempts = attempts + 1 WHERE id IN (?)`, [rows.map(r => r.id)]);
      let res;
      try { res = await call('syncd', 'POST', '/v1/sync/batches', batch, { terminal: t }); }
      catch (e) {
        await db.query('UPDATE smartel_terminals SET last_error = ? WHERE pos_terminal_id = ?', [String(e.message).slice(0, 250), t.pos_terminal_id]);
        if (e.code === 'TERM_SUSPENDED') await db.query(`UPDATE smartel_terminals SET quarantined = 1, quarantine_reason = 'Till suspended by Smartel' WHERE pos_terminal_id = ?`, [t.pos_terminal_id]);
        out.errors.push(`${t.terminal_uuid}: ${e.message}`); continue;
      }
      out.sent += rows.length;
      for (const r of (res && res.results) || []) {
        const st = ['applied', 'duplicate', 'held', 'rejected'].includes(r.status) ? r.status : 'held';
        await db.query('UPDATE smartel_outbox SET status = ?, code = ?, reason = ?, sent_at = NOW() WHERE client_id = ?', [st, r.code || null, (r.reason || '').slice(0, 250) || null, r.clientId]);
        if (st === 'applied' || st === 'duplicate') out.applied++; else if (st === 'held') out.held++; else out.rejected++;
        if (['ENV_HASH_MISMATCH', 'CHAIN_BROKEN', 'CHAIN_QUARANTINED'].includes(r.code))
          await db.query('UPDATE smartel_terminals SET quarantined = 1, quarantine_reason = ? WHERE pos_terminal_id = ?', [`${r.code}: ${r.reason || ''}`.slice(0, 250), t.pos_terminal_id]);
      }
      await db.query('UPDATE smartel_terminals SET last_push_at = NOW(), last_error = NULL WHERE pos_terminal_id = ?', [t.pos_terminal_id]);
    }
  return out;
}
const pushSoon = () => setImmediate(() => push().catch(() => {}));

// ------------------------------------------------------------------ change-log pull
const SCOPES = ['recall', 'catalogue', 'prices', 'credit']; // recalls first: they have priority (BR-25)
const pick = (o, ...ks) => { for (const k of ks) if (o && o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return undefined; };

async function applyChange(scope, ch, s) {
  const p = (typeof ch.payload === 'string' ? JSON.parse(ch.payload) : ch.payload) || {};
  const del = /delete|remove/i.test(ch.op || '');
  if (scope === 'recall') {
    const rid = pick(p, 'recallId', 'recall_id') || ch.entityId;
    const g = pick(p, 'gtin'); const lot = pick(p, 'lot') || null;
    if (!g) return 'no gtin';
    if (del || pick(p, 'closedAt', 'closed_at')) { await db.query('UPDATE smartel_recalls SET closed_at = NOW() WHERE recall_id = ?', [rid]); await markRecalledBatches(); return 'recall closed'; }
    await db.query(`INSERT INTO smartel_recalls (recall_id, gtin, lot, reason) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE gtin = VALUES(gtin), lot = VALUES(lot), reason = VALUES(reason), closed_at = NULL`,
      [rid, gtin14(g), lot, String(pick(p, 'reason') || '').slice(0, 250) || null]);
    const n = await markRecalledBatches();
    await ackRecall(rid);
    return `recall: ${n} batch(es) blocked`;
  }
  if (scope === 'catalogue') {
    const pid = pick(p, 'productId', 'product_id', 'entityId') || ch.entityId;
    const g = pick(p, 'gtin', 'barcode');
    const local = (pid && await db.one('SELECT id FROM products WHERE smartel_product_id = ?', [pid])) || (g && await db.one('SELECT id FROM products WHERE barcode IN (?, ?) ORDER BY id LIMIT 1', [String(g), String(g).replace(/^0+/, '')]));
    if (del) { if (local) await db.query('UPDATE products SET smartel_product_id = NULL WHERE id = ?', [local.id]); return local ? 'unlinked' : 'nothing to unlink'; }
    if (local) { await db.query('UPDATE products SET smartel_product_id = ? WHERE id = ?', [pid, local.id]); return `linked to product ${local.id}`; }
    const name = pick(p, 'name', 'productName', 'product_name');
    if (!s.create_products || !name) return 'not in this shop';
    const price = pick(p, 'priceMinor', 'price_minor', 'unitPriceMinor');
    const tax = await db.one(`SELECT id FROM taxes WHERE rate > 0 AND active = 1 ORDER BY id LIMIT 1`);
    const ins = await db.query(`INSERT INTO products (name, barcode, type, price, cost, tax_id, smartel_product_id) VALUES (?, ?, 'stock', ?, ?, ?, ?)`,
      [String(name).slice(0, 150), g ? String(g) : null, price !== undefined ? major(price) : 0, pick(p, 'costMinor', 'cost_minor') !== undefined ? major(pick(p, 'costMinor', 'cost_minor')) : 0, tax ? tax.id : null, pid]);
    return `created product ${ins.insertId}`;
  }
  if (scope === 'prices') {
    if (!s.accept_prices) return 'prices not accepted (setting)';
    const pid = pick(p, 'productId', 'product_id', 'entityId') || ch.entityId;
    const price = pick(p, 'priceMinor', 'price_minor', 'unitPriceMinor');
    if (price === undefined) return 'no price';
    const r = await db.query('UPDATE products SET price = ? WHERE smartel_product_id = ?', [major(price), pid]);
    return r.affectedRows ? `price ${major(price)}` : 'product not linked';
  }
  if (scope === 'credit') {
    const asOf = String(pick(p, 'asOf', 'as_of') || new Date().toISOString()).slice(0, 10);
    await db.query(`INSERT INTO smartel_credit (as_of, float_limit, arrears, stock_advance, pd_bp, elasticity, ref, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE float_limit = VALUES(float_limit), arrears = VALUES(arrears), stock_advance = VALUES(stock_advance), pd_bp = VALUES(pd_bp), elasticity = VALUES(elasticity), ref = VALUES(ref), payload = VALUES(payload), received_at = NOW()`,
      [asOf, major(pick(p, 'float_limit_minor', 'floatLimitMinor') || 0), major(pick(p, 'arrears_minor', 'arrearsMinor') || 0), major(pick(p, 'stock_advance_minor', 'stockAdvanceMinor') || 0),
        pick(p, 'pd_bp', 'pdBp') ?? null, pick(p, 'elasticity') ?? null, pick(p, 'ref', 'moralla_ref') || null, JSON.stringify(p)]);
    return 'Thoki line updated';
  }
  return 'ignored';
}

let pulling = null;
async function pull() {
  while (pulling) await pulling.catch(() => {});
  pulling = pullOnce();
  try { return await pulling; } finally { pulling = null; }
}
async function pullOnce() {
  const out = {};
  {
    const s = await settings(true);
    if (!s.enabled) return out;
    const t = await db.one('SELECT * FROM smartel_terminals ORDER BY pos_terminal_id LIMIT 1');
    if (!t) return { error: 'No till is linked to Smartel yet' };
    for (const scope of SCOPES) {
      const cur = await db.one('SELECT * FROM smartel_cursors WHERE scope = ?', [scope]) || { seq: 0 };
      let after = Number(cur.seq || 0), n = 0, more = true;
      try {
        while (more && n < 5000) {
          const page = await call('syncd', 'GET', `/v1/sync/changes?scope=${scope}&after=${after}&limit=500`, undefined, { terminal: t });
          const list = (page && page.changes) || [];
          for (const ch of list) {
            let note; try { note = await applyChange(scope, ch, s); } catch (e) { note = 'error: ' + e.message; }
            await db.query(`INSERT IGNORE INTO smartel_changes (scope, seq, entity, entity_id, op, payload, note) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [scope, ch.seq, ch.entity || null, ch.entityId || null, ch.op || null, JSON.stringify(ch.payload || null), String(note).slice(0, 250)]);
            after = Math.max(after, Number(ch.seq)); n++;
          }
          more = !!(page && page.more) && list.length > 0;
          if (list.length) await call('syncd', 'POST', '/v1/sync/cursor', { scope, seq: after }, { terminal: t });
        }
        await db.query(`INSERT INTO smartel_cursors (scope, seq, pulled_at, last_error) VALUES (?, ?, NOW(), NULL) ON DUPLICATE KEY UPDATE seq = VALUES(seq), pulled_at = NOW(), last_error = NULL`, [scope, after]);
        out[scope] = n;
      } catch (e) {
        await db.query(`INSERT INTO smartel_cursors (scope, seq, last_error) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE seq = VALUES(seq), last_error = VALUES(last_error)`, [scope, after, String(e.message).slice(0, 250)]);
        out[scope] = 'error: ' + e.message;
      }
    }
    try { out.register = await loadRegister(t); } catch (e) { out.register = 'error: ' + e.message; }
  }
  return out;
}

/** National Product Register slice for this merchant: GTINs, issued lots and open recalls */
async function loadRegister(t) {
  t = t || await db.one('SELECT * FROM smartel_terminals ORDER BY pos_terminal_id LIMIT 1');
  if (!t) throw bad('Link a till to Smartel first');
  const r = await call('pos-api', 'GET', '/v1/register/scope', undefined, { terminal: t });
  await db.tx(async c => {
    await c.query('DELETE FROM smartel_register');
    await c.query('DELETE FROM smartel_register_lots');
    for (const g of r.gtins || []) await c.query('INSERT IGNORE INTO smartel_register (gtin, product_name, status) VALUES (?, ?, ?)', [gtin14(g.gtin), g.product_name || null, g.status || 'active']);
    for (const l of r.lots || []) await c.query('INSERT IGNORE INTO smartel_register_lots (gtin, lot, expires_on) VALUES (?, ?, ?)', [gtin14(l.gtin), String(l.lot), l.expires_on ? String(l.expires_on).slice(0, 10) : null]);
    for (const x of r.recalls || []) await c.query(`INSERT INTO smartel_recalls (recall_id, gtin, lot) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE closed_at = NULL`, [x.recall_id, gtin14(x.gtin), x.lot || null]);
  });
  const prev = (await db.getSetting('smartel_register', {})) || {};
  await db.setSetting('smartel_register', { version: r.version || 0, sha256: r.sha256 || null, loaded_at: new Date().toISOString(), gtins: (r.gtins || []).length });
  await markRecalledBatches();
  for (const x of r.recalls || []) await ackRecall(x.recall_id).catch(() => {});
  return { version: r.version || 0, gtins: (r.gtins || []).length, recalls: (r.recalls || []).length, was: prev.version || 0 };
}

/** block stock batches whose lot is recalled (FEFO skips them, BR-26) */
async function markRecalledBatches() {
  await db.query('UPDATE stock_batches SET recalled = 0 WHERE recalled = 1');
  const rec = await db.query('SELECT * FROM smartel_recalls WHERE closed_at IS NULL AND lot IS NOT NULL');
  let n = 0;
  for (const r of rec) {
    const x = await db.query(`UPDATE stock_batches b JOIN products p ON p.id = b.product_id SET b.recalled = 1
      WHERE b.batch_no = ? AND (LPAD(p.barcode, 14, '0') = ? OR p.barcode = ?)`, [r.lot, r.gtin, r.gtin.replace(/^0+/, '')]);
    n += x.affectedRows;
  }
  return n;
}

/** tell Smartel the recall is blocked at this shop (recall_ack envelope) */
async function ackRecall(recallId) {
  const r = await db.one('SELECT * FROM smartel_recalls WHERE recall_id = ?', [recallId]);
  if (!r || r.acked_at) return;
  const t = await db.one('SELECT * FROM smartel_terminals ORDER BY pos_terminal_id LIMIT 1');
  if (!t) return;
  const p = await db.one(`SELECT * FROM products WHERE LPAD(barcode, 14, '0') = ? OR barcode = ? ORDER BY id LIMIT 1`, [r.gtin, r.gtin.replace(/^0+/, '')]);
  let units = 0;
  if (p) units = r.lot ? Number((await db.one('SELECT COALESCE(SUM(qty_remaining),0) q FROM stock_batches WHERE product_id = ? AND batch_no = ?', [p.id, r.lot])).q) : Math.max(0, Number(p.stock_qty));
  await db.tx(c => seal(c, t.pos_terminal_id, 'recall_ack', 1, { recallId, gtin: r.gtin, lot: r.lot || '', unitsBlocked: Math.floor(units), productId: (p && p.smartel_product_id) || '' }, { source_type: 'recall' }));
  await db.query('UPDATE smartel_recalls SET acked_at = NOW(), units_blocked = ? WHERE recall_id = ?', [units, recallId]);
  pushSoon();
}

/** products the till must not sell, with the reason (recalled, or not in the National Product Register) */
async function blockedProducts() {
  const s = await settings(true);
  if (!s.enabled) return {};
  const out = {};
  const rec = await db.query(`SELECT p.id, r.reason FROM smartel_recalls r JOIN products p ON (LPAD(p.barcode, 14, '0') = r.gtin) WHERE r.closed_at IS NULL AND r.lot IS NULL AND p.barcode IS NOT NULL`);
  for (const r of rec) out[r.id] = { kind: 'recalled', reason: `Recalled${r.reason ? ': ' + r.reason : ''} – do not sell` };
  const reg = (await db.getSetting('smartel_register', {})) || {};
  if (s.npr !== 'off' && Number(reg.gtins) > 0) {
    const prods = await db.query(`SELECT id, barcode FROM products WHERE active = 1 AND type = 'stock' AND barcode IS NOT NULL AND barcode <> ''`);
    const known = new Map((await db.query('SELECT gtin, status FROM smartel_register')).map(r => [r.gtin, r.status]));
    for (const p of prods) {
      if (out[p.id] || !validGtin(p.barcode)) continue;
      const st = known.get(gtin14(p.barcode));
      if (!st) out[p.id] = { kind: 'unregistered', reason: 'Barcode is not in the National Product Register', warn_only: s.npr === 'warn' };
      else if (/counterfeit|revoked|blocked|suspended/i.test(st)) out[p.id] = { kind: 'counterfeit', reason: `Register status: ${st}`, warn_only: s.npr === 'warn' };
    }
  }
  return out;
}

/** a failed scan check raises an integrity flag with the till, location and time (P12) */
async function flag(posTerminalId, { kind, gtin, lot, raw }) {
  const s = await settings(true);
  const t = await terminalRow(posTerminalId);
  if (!s.enabled || !t) return null;
  const body = { kind: ['unregistered', 'counterfeit', 'recalled'].includes(kind) ? kind : 'unregistered', gtin: gtin ? gtin14(gtin) : '', ...(lot ? { lot } : {}), rawScan: String(raw || gtin || '').slice(0, 120), at: new Date().toISOString(), ...(gps(s) ? { gps: gps(s) } : {}) };
  const r = await db.tx(c => seal(c, posTerminalId, 'integrity_flag', 1, body, { source_type: 'flag' }));
  pushSoon();
  return r;
}
const gps = s => (s.gps_lat !== null && s.gps_lat !== '' && s.gps_lng !== null && s.gps_lng !== '' && isFinite(Number(s.gps_lat)) && isFinite(Number(s.gps_lng)))
  ? { lat: Number(s.gps_lat), lng: Number(s.gps_lng), accuracyM: 50, fixAt: new Date().toISOString(), source: 'fixed' } : null;

async function heartbeat() {
  const s = await settings(true);
  if (!s.enabled) return 0;
  const reg = (await db.getSetting('smartel_register', {})) || {};
  const ver = require('../../package.json').version;
  const terms = await db.query('SELECT * FROM smartel_terminals');
  for (const t of terms) {
    const q = await db.one(`SELECT COUNT(*) n FROM smartel_outbox WHERE pos_terminal_id = ? AND status IN ('pending','held')`, [t.pos_terminal_id]);
    await db.tx(c => seal(c, t.pos_terminal_id, 'heartbeat', 1, { queueDepth: Number(q.n), appVersion: 'maluti-erp/' + ver, registerVersion: Number(reg.version || 0), ...(gps(s) ? { gps: gps(s) } : {}) }, { source_type: 'heartbeat' }));
    await db.query('UPDATE smartel_terminals SET last_heartbeat_at = NOW() WHERE pos_terminal_id = ?', [t.pos_terminal_id]);
  }
  pushSoon();
  return terms.length;
}

// ------------------------------------------------------------------ customer sessions & agent services
async function posSessionTerminal(c, posSessionId) {
  const ps = await c.one(`SELECT * FROM pos_sessions WHERE id = ? AND status = 'open'`, [posSessionId]);
  if (!ps) throw bad('Open a cashier session first');
  const t = await terminalRow(ps.terminal_id, c);
  if (!t) throw bad('This till is not linked to Smartel (Settings → Smartel connection → Tills)');
  if (t.quarantined) throw bad(`This till is held by Smartel: ${t.quarantine_reason || 'chain problem'}. Call Smartel support.`);
  return { ps, t };
}

/** make sure pos-api has the customer session open (services and digital tenders need it) */
async function ensureRemoteSession(user, posSessionId, sessionUuid) {
  const { ps, t } = await posSessionTerminal(db, posSessionId);
  let row = sessionUuid ? await db.one('SELECT * FROM smartel_sessions WHERE session_uuid = ?', [sessionUuid]) : null;
  if (row && row.state !== 'open') throw bad('That customer is already finished. Start a new sale.');
  if (row && row.pos_terminal_id !== ps.terminal_id) throw bad('That customer belongs to another till');
  if (!row) {
    const id = uuid();
    await db.query('INSERT INTO smartel_sessions (session_uuid, pos_terminal_id, pos_session_id, user_id) VALUES (?, ?, ?, ?)', [id, ps.terminal_id, ps.id, user.id]);
    row = await db.one('SELECT * FROM smartel_sessions WHERE session_uuid = ?', [id]);
  }
  if (!row.remote_open) {
    try { await call('pos-api', 'POST', '/v1/sessions', { sessionId: row.session_uuid }, { terminal: t }); }
    catch (e) { if (e.offline || e.timeout) throw new SmartelError(503, 'OFFLINE', 'Payment services and card / MyWallet / Switch need the internet. The till is offline – sell goods for cash only (BR-16).'); throw e; }
    await db.query('UPDATE smartel_sessions SET remote_open = 1 WHERE session_uuid = ?', [row.session_uuid]);
  }
  return { row: await db.one('SELECT * FROM smartel_sessions WHERE session_uuid = ?', [row.session_uuid]), t, ps };
}

const cleanCell = v => String(v || '').replace(/[\s\-()]/g, '').replace(/^\+/, '');
function validateFields(op, f) {
  const def = OPS[op];
  if (!def) throw bad('Unknown service');
  const out = {};
  for (const k of def.fields) if (f[k] !== undefined && f[k] !== null && String(f[k]).trim() !== '') out[k] = String(f[k]).trim();
  for (const k of def.need) if (!out[k]) throw bad(`Fill in ${k.replace(/_/g, ' ')}`);
  for (const k of ['cell', 'cell_sender', 'cell_recipient']) if (out[k]) {
    const c = cleanCell(out[k]);
    if (!/^(266)?[5-6]\d{7}$/.test(c)) throw bad(`${k.replace(/_/g, ' ')} must be a Lesotho mobile number (8 digits starting with 5 or 6)`);
    out[k] = c.length === 8 ? c : c.slice(3);
  }
  if (out.meter && !/^\d{11,13}$/.test(out.meter)) throw bad('An LEC meter number has 11 to 13 digits');
  if (op === 'biller' && !BILLERS.some(b => b[0] === out.biller)) throw bad('Choose the biller');
  const amount = round2(f.amount);
  if (!(amount > 0)) throw bad('Enter an amount bigger than 0');
  return { fields: out, amount };
}

function opView(o) {
  if (!o) return o;
  const def = OPS[o.op] || {};
  return { ...o, fields: typeof o.fields === 'string' ? JSON.parse(o.fields) : o.fields, name: def.name, name_st: def.st, needs_otp: o.state === 'otp_wait', needs_pin: !!def.pin && o.state === 'checked',
    resolved: TERMINAL_OP.includes(o.state), waiting: ['submitted', 'unknown', 'unknown_start'].includes(o.state) };
}

async function applyRemote(id, r) {
  if (!r) return;
  await db.query(`UPDATE smartel_ops SET operation_id = COALESCE(?, operation_id), state = ?, fee = ?, commission = ?, counterparty = COALESCE(?, counterparty), account_masked = COALESCE(?, account_masked),
      mw_ref = COALESCE(?, mw_ref), cash = ?, failure_code = ?, result = ?, updated_at = NOW() WHERE id = ?`,
    [r.operation_id || null, r.state || 'unknown', r.fee_minor != null ? major(r.fee_minor) : null, r.commission_minor != null ? major(r.commission_minor) : null,
      r.counterparty || null, r.account_masked || null, r.mw_ref || null, major(r.cash_minor || 0), r.failure_code || null, r.result ? String(r.result).slice(0, 250) : null, id]);
  if (r.state === 'completed') await bookOp(id);
}

/** start a payment service on the customer's session: pos-api runs the MyWallet check step */
async function startOp(user, { pos_session_id, session_uuid, op, fields }) {
  const { fields: f, amount } = validateFields(op, fields || {});
  const { row, t } = await ensureRemoteSession(user, pos_session_id, session_uuid);
  const ln = await db.one('SELECT COALESCE(MAX(line_no),0) + 1 n FROM smartel_ops WHERE session_uuid = ?', [row.session_uuid]);
  const ins = await db.query(`INSERT INTO smartel_ops (session_uuid, line_no, op, fields, amount, pos_session_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [row.session_uuid, ln.n, op, JSON.stringify(f), amount, pos_session_id, user.id]);
  const id = ins.insertId;
  await sendStart(id, t);
  return { session_uuid: row.session_uuid, op: opView(await db.one('SELECT * FROM smartel_ops WHERE id = ?', [id])) };
}
async function sendStart(id, t) {
  const o = await db.one('SELECT * FROM smartel_ops WHERE id = ?', [id]);
  const f = typeof o.fields === 'string' ? JSON.parse(o.fields) : o.fields;
  try {
    // pos-api keeps one operation per (session, line, op): sending the same start again returns the same operation (INV-B)
    const r = await call('pos-api', 'POST', '/v1/agent/ops', { sessionId: o.session_uuid, lineNo: o.line_no, op: o.op, fields: { ...f, amount_minor: minor(o.amount) } }, { terminal: t });
    await applyRemote(id, r);
  } catch (e) {
    if (e.offline || e.timeout) { await db.query(`UPDATE smartel_ops SET state = 'unknown_start', result = ?, updated_at = NOW() WHERE id = ?`, [String(e.message).slice(0, 250), id]); return; }
    await db.query(`UPDATE smartel_ops SET state = 'failed', failure_code = ?, result = ?, updated_at = NOW() WHERE id = ?`, [e.code || 'ERROR', String(e.message).slice(0, 250), id]);
  }
}

/** confirm (send) the service. The OTP / PIN go straight to pos-api and are never stored (BR-10) */
async function confirmOp(user, id, { otp, pin } = {}) {
  const o = await db.one('SELECT * FROM smartel_ops WHERE id = ?', [id]);
  if (!o) throw bad('Service line not found');
  if (!['checked', 'otp_wait'].includes(o.state)) return opView(o); // never send twice (BR-11)
  if (o.state === 'otp_wait' && !/^\d{4,8}$/.test(String(otp || '').trim())) throw bad('Type the PIN the customer received by SMS (5 digits)');
  const t = await terminalRow((await db.one('SELECT pos_terminal_id FROM smartel_sessions WHERE session_uuid = ?', [o.session_uuid])).pos_terminal_id);
  const body = {}; if (otp) body.otp = String(otp).trim(); if (pin) body.pin = String(pin).trim();
  await db.query(`UPDATE smartel_ops SET state = 'submitted', updated_at = NOW() WHERE id = ?`, [id]);
  try {
    const r = await call('pos-api', 'POST', `/v1/agent/ops/${o.operation_id}/confirm`, body, { terminal: t, timeoutMs: 45000 });
    await applyRemote(id, r);
  } catch (e) {
    if (e.code === 'AGT_OTP_INVALID') { await db.query(`UPDATE smartel_ops SET state = 'otp_wait', result = ? WHERE id = ?`, [String(e.message).slice(0, 250), id]); throw bad(e.message); }
    if (e.offline || e.timeout || e.status >= 500) await db.query(`UPDATE smartel_ops SET state = 'unknown', result = 'No answer yet – checking MyWallet. Do NOT do it again.', updated_at = NOW() WHERE id = ?`, [id]);
    else await db.query(`UPDATE smartel_ops SET state = 'failed', failure_code = ?, result = ?, updated_at = NOW() WHERE id = ?`, [e.code || 'ERROR', String(e.message).slice(0, 250), id]);
  }
  return opView(await db.one('SELECT * FROM smartel_ops WHERE id = ?', [id]));
}

/** ask pos-api how a line stands (resolves "unknown" from MyWallet's history; never re-sends) */
async function refreshOp(id) {
  const o = await db.one('SELECT * FROM smartel_ops WHERE id = ?', [id]);
  if (!o) throw bad('Service line not found');
  if (TERMINAL_OP.includes(o.state)) return opView(o);
  const t = await terminalRow((await db.one('SELECT pos_terminal_id FROM smartel_sessions WHERE session_uuid = ?', [o.session_uuid])).pos_terminal_id);
  if (o.state === 'unknown_start' || !o.operation_id) { await sendStart(id, t); return opView(await db.one('SELECT * FROM smartel_ops WHERE id = ?', [id])); }
  try { await applyRemote(id, await call('pos-api', 'GET', `/v1/agent/ops/${o.operation_id}`, undefined, { terminal: t })); }
  catch (e) { if (!(e.offline || e.timeout)) throw e; }
  return opView(await db.one('SELECT * FROM smartel_ops WHERE id = ?', [id]));
}

/** drop a line that never reached MyWallet (check failed / still a draft) – confirmed services are final (BR-09) */
async function cancelOp(id) {
  const o = await db.one('SELECT * FROM smartel_ops WHERE id = ?', [id]);
  if (!o) throw bad('Service line not found');
  if (['submitted', 'unknown', 'completed', 'escalated'].includes(o.state)) throw bad('This service already went to MyWallet. It cannot be cancelled here.');
  if (o.state === 'unknown_start') throw bad('Check this line first – it may have reached MyWallet.');
  await db.query(`UPDATE smartel_ops SET state = 'failed', failure_code = COALESCE(failure_code, 'CANCELLED'), result = COALESCE(result, 'Cancelled at the till'), updated_at = NOW() WHERE id = ?`, [id]);
  return opView(await db.one('SELECT * FROM smartel_ops WHERE id = ?', [id]));
}

async function cashMethod(c) {
  const m = await c.one(`SELECT * FROM payment_methods WHERE kind = 'cash' AND active = 1 ORDER BY sort_order, id LIMIT 1`);
  if (!m) throw bad('There is no active Cash payment method');
  return m;
}

/** book a completed service once: cash in the drawer against agency clearing (FP-06 / FP-07), commission (FP-09) */
async function bookOp(id) {
  await db.tx(async c => {
    const o = await c.one('SELECT * FROM smartel_ops WHERE id = ? FOR UPDATE', [id]);
    if (!o || o.booked || o.state !== 'completed') return;
    const cash = round2(o.cash);
    const lines = [];
    const m = await cashMethod(c);
    const label = `${(OPS[o.op] || {}).name || o.op} ${o.mw_ref || ''}`.trim();
    if (cash) {
      await c.query(`INSERT INTO payments (direction, method_id, amount, reference, phone, session_id, user_id) VALUES (?, ?, ?, ?, NULL, ?, ?)`,
        [cash > 0 ? 'in' : 'out', m.id, Math.abs(cash), `${o.op.toUpperCase()} ${o.mw_ref || ''}`.trim().slice(0, 120), o.pos_session_id, o.user_id]);
      if (cash > 0) lines.push({ code: m.account_code, debit: cash, description: label }, { code: '2450', credit: cash, description: label });
      else lines.push({ code: '2450', debit: -cash, description: label }, { code: m.account_code, credit: -cash, description: label });
    }
    const com = round2(o.commission || 0);
    if (com > 0) lines.push({ code: '1160', debit: com, description: `Commission ${label}` }, { code: '4150', credit: com, description: `Commission ${label}` });
    if (lines.length) await accounting.post(c, { reference: `SVC-${o.mw_ref || o.id}`.slice(0, 60), memo: label, source_type: 'smartel_op', source_id: o.id, user_id: o.user_id, lines });
    await c.query('UPDATE smartel_ops SET booked = 1 WHERE id = ?', [id]);
  });
}

async function sessionView(sessionUuid) {
  const s = await db.one('SELECT * FROM smartel_sessions WHERE session_uuid = ?', [sessionUuid]);
  if (!s) return null;
  const ops = (await db.query('SELECT * FROM smartel_ops WHERE session_uuid = ? ORDER BY line_no', [sessionUuid])).map(opView);
  const intents = await db.query('SELECT * FROM smartel_intents WHERE session_uuid = ? ORDER BY tender_seq', [sessionUuid]);
  return { ...s, ops, intents, services_cash: round2(ops.filter(o => o.state === 'completed').reduce((a, o) => a + Number(o.cash), 0)), blocked: ops.some(o => BLOCKING.includes(o.state)) };
}

// ------------------------------------------------------------------ digital tenders (payment intents)
async function createIntent(user, { pos_session_id, session_uuid, method_id, amount }) {
  const m = await db.one('SELECT * FROM payment_methods WHERE id = ? AND active = 1', [method_id]);
  if (!m || !TENDERS[m.plugin_id]) throw bad('Choose Card, MyWallet or Switch');
  const amt = round2(amount);
  if (!(amt > 0)) throw bad('Enter the amount to pay');
  const { row, t } = await ensureRemoteSession(user, pos_session_id, session_uuid);
  // a new tender number every time, so a changed cart never re-uses an old request (pos-api keys intents by sale + tender)
  await db.query('UPDATE smartel_sessions SET tender_seq = tender_seq + 1 WHERE session_uuid = ?', [row.session_uuid]);
  const seq = (await db.one('SELECT tender_seq FROM smartel_sessions WHERE session_uuid = ?', [row.session_uuid])).tender_seq;
  const ins = await db.query('INSERT INTO smartel_intents (session_uuid, tender_seq, tender, amount, user_id) VALUES (?, ?, ?, ?, ?)', [row.session_uuid, seq, TENDERS[m.plugin_id], amt, user.id]);
  const r = await call('pos-api', 'POST', '/v1/payments/intents', { saleId: row.session_uuid, tenderSeq: seq, tender: TENDERS[m.plugin_id], amountMinor: minor(amt) }, { terminal: t });
  await saveIntent(ins.insertId, r);
  return { session_uuid: row.session_uuid, intent: await intentView(ins.insertId) };
}
async function saveIntent(id, r) {
  const payload = r.payload === undefined || r.payload === null ? null : typeof r.payload === 'string' ? r.payload : JSON.stringify(r.payload);
  await db.query('UPDATE smartel_intents SET intent_id = COALESCE(?, intent_id), state = ?, payload = COALESCE(?, payload), mw_ref = COALESCE(?, mw_ref), updated_at = NOW() WHERE id = ?',
    [r.intentId || null, r.state || 'CREATED', payload, r.mwRef || null, id]);
}
async function intentView(id) {
  const i = await db.one('SELECT * FROM smartel_intents WHERE id = ?', [id]);
  if (!i) return null;
  let qrText = null, url = null;
  if (i.payload) {
    let p = i.payload; try { p = JSON.parse(i.payload); } catch (_) { /* plain text */ }
    if (typeof p === 'string') qrText = p;
    else if (p && typeof p === 'object') { qrText = p.qr || p.qrString || p.qr_payload || p.emv || null; url = p.url || p.redirectUrl || p.redirect_url || p.checkoutUrl || null; if (!qrText && url) qrText = url; }
  }
  return { ...i, qr_text: qrText, url, qr_svg: qrText ? await require('./qr').svg(qrText) : null, paid: i.state === 'PAID', final: ['PAID', 'FAILED', 'EXPIRED', 'CANCELLED', 'REVERSED'].includes(i.state) };
}
async function refreshIntent(id) {
  const i = await db.one('SELECT i.*, s.pos_terminal_id FROM smartel_intents i JOIN smartel_sessions s ON s.session_uuid = i.session_uuid WHERE i.id = ?', [id]);
  if (!i) throw bad('Payment request not found');
  if (i.intent_id && !['PAID', 'FAILED', 'EXPIRED', 'CANCELLED', 'REVERSED'].includes(i.state)) {
    try { await saveIntent(id, await call('pos-api', 'GET', `/v1/payments/intents/${i.intent_id}`, undefined, { terminal: await terminalRow(i.pos_terminal_id) })); }
    catch (e) { if (!(e.offline || e.timeout)) throw e; }
  }
  return intentView(id);
}

// ------------------------------------------------------------------ closing a customer: one receipt, one envelope
/**
 * Called inside the checkout / pay transaction after the order is paid. Checks the tenders (BR-05), closes the pos-api
 * session when it is open there, and seals the v2 sale envelope with goods, services and tenders.
 */
async function afterSale(c, user, orderId, body, payOut = {}) {
  const s = await settings(true);
  if (!s.enabled) return null;
  const o = await c.one('SELECT * FROM orders WHERE id = ?', [orderId]);
  const t = await terminalRow(o.terminal_id, c);
  if (!t) return null; // this till is not on Smartel
  if (t.quarantined) throw bad(`This till is held by Smartel: ${t.quarantine_reason || 'chain problem'}. Call Smartel support.`);
  const blocked = await blockedProducts();
  const bl = (await c.query('SELECT DISTINCT l.product_id, l.name FROM order_lines l WHERE l.order_id = ? AND l.product_id IS NOT NULL', [orderId])).find(l => blocked[l.product_id] && !blocked[l.product_id].warn_only);
  if (bl) throw bad(`${bl.name} cannot be sold: ${blocked[bl.product_id].reason}. Take it off the sale.`);
  const pays = await c.query(`SELECT p.*, m.kind, m.plugin_id, m.name method_name FROM payments p JOIN payment_methods m ON m.id = p.method_id WHERE p.order_id = ? AND p.direction = 'in' ORDER BY p.id`, [orderId]);
  const bad5 = pays.find(p => p.kind !== 'cash' && !TENDERS[p.plugin_id]);
  if (bad5) throw bad(`On a Smartel till goods are paid by Cash, Card, MyWallet or Switch only – not "${bad5.method_name}" (BR-05)`);
  const digital = pays.filter(p => TENDERS[p.plugin_id]);
  let sessUuid = body.smartel_session || null;
  let sess = sessUuid ? await c.one('SELECT * FROM smartel_sessions WHERE session_uuid = ? FOR UPDATE', [sessUuid]) : null;
  if (sess && sess.state !== 'open') throw bad('This customer was already finished');
  if (digital.length && (digital.length > 1 || pays.length > 1)) throw bad('A card / MyWallet / Switch payment must cover the whole amount on its own. Take it all by one method, or all in cash.');
  const tenders = []; let seq = 0;
  for (const p of pays) {
    seq++;
    if (TENDERS[p.plugin_id]) {
      const sent = (body.payments || []).find(x => Number(x.method_id) === p.method_id && x.intent_id);
      const it = sent && sess ? await c.one('SELECT * FROM smartel_intents WHERE id = ? AND session_uuid = ?', [sent.intent_id, sess.session_uuid]) : null;
      if (!it || it.state !== 'PAID') throw bad(`The ${p.method_name} payment is not confirmed yet. Wait until the customer has approved it.`);
      if (minor(it.amount) !== minor(p.amount) || it.tender !== TENDERS[p.plugin_id]) throw bad(`The confirmed ${p.method_name} amount (${it.amount}) does not match the bill (${p.amount}). Start a new payment request.`);
      tenders.push({ seq, type: it.tender, amountMinor: minor(p.amount), intentId: it.intent_id || undefined, mwRef: it.mw_ref || it.intent_id });
      await c.query('UPDATE smartel_intents SET order_id = ? WHERE id = ?', [orderId, it.id]);
      await c.query('UPDATE payments SET reference = COALESCE(reference, ?) WHERE id = ?', [it.mw_ref || it.intent_id, p.id]);
    } else tenders.push({ seq, type: 'cash', amountMinor: minor(p.amount) });
  }
  const ops = sess ? await c.query('SELECT * FROM smartel_ops WHERE session_uuid = ? ORDER BY line_no', [sess.session_uuid]) : [];
  if (ops.some(x => BLOCKING.includes(x.state))) throw bad(FRIENDLY.SES_BLOCKED);
  const done = ops.filter(x => x.state === 'completed');
  // goods lines
  const lines = await c.query(`SELECT l.*, p.barcode, p.smartel_product_id, p.id pid, tx.name tax_name FROM order_lines l LEFT JOIN products p ON p.id = l.product_id
    LEFT JOIN taxes tx ON tx.id = p.tax_id WHERE l.order_id = ? ORDER BY l.id`, [orderId]);
  const lotsBy = payOut.lots || {};
  const goods = []; let n = 0;
  for (const l of lines) {
    const gross = minor(l.line_total); const q = Math.round(Number(l.qty) * 1000);
    if (gross <= 0 || q <= 0) continue;
    const rate = Number(l.tax_rate || 0);
    const line = { lineNo: ++n, productId: l.smartel_product_id || `maluti:${l.product_id || 'misc'}`, gtin: gtinFor({ id: l.product_id || 0, barcode: l.barcode }), qtyScaled: q,
      unitPriceMinor: minor(l.unit_price), taxClass: rate > 0 ? 'STD' : /exempt/i.test(l.tax_name || '') ? 'EXEMPT' : 'ZERO', rateBp: Math.round(rate * 100), grossMinor: gross, taxMinor: minor(l.tax_amount), lots: [] };
    const used = lotsBy[l.id] || [];
    if (used.length) {
      const lots = [];
      for (const u of used) { const b = await c.one('SELECT batch_no FROM stock_batches WHERE id = ?', [u.batch_id]); if (b) lots.push({ lot: b.batch_no, qty: Math.round(Number(u.qty) * 1000) }); }
      if (lots.reduce((a, x) => a + x.qty, 0) === q) line.lots = lots;
    }
    goods.push(line);
  }
  const goodsMinor = goods.reduce((a, x) => a + x.grossMinor, 0);
  const tendered = tenders.reduce((a, x) => a + x.amountMinor, 0);
  if (tendered !== goodsMinor && tenders.length) { // VAT rounding / zero lines: the cash tender carries the cents
    const cashT = tenders.find(x => x.type === 'cash'); if (cashT) cashT.amountMinor += goodsMinor - tendered;
  }
  const svcs = done.map(x => ({ lineNo: x.line_no, operationId: x.operation_id, type: x.op, amountMinor: minor(x.amount), cashMinor: minor(x.cash), mwRef: x.mw_ref, ...(x.result ? { result: String(x.result).slice(0, 120) } : {}), state: 'completed' }));
  const cashTendered = tenders.filter(x => x.type === 'cash').reduce((a, x) => a + x.amountMinor, 0);
  const netCash = svcs.reduce((a, x) => a + x.cashMinor, 0) + cashTendered;
  const clientId = uuid();
  if (!sessUuid) sessUuid = uuid();
  const offline = !(sess && sess.remote_open) && link.ok === false;
  const env = { sessionId: sessUuid, receiptNo: o.number, businessTs: new Date().toISOString(), offline, lines: goods, tenders: tenders.filter(x => x.amountMinor > 0), svcs, netCashMinor: netCash, ...(gps(s) ? { gps: gps(s) } : {}) };
  if (!env.lines.length && !env.svcs.length) return null; // nothing fiscal (e.g. only zero-priced lines)
  await seal(c, o.terminal_id, 'sale', 2, env, { source_type: 'order', source_id: orderId, client_id: clientId });
  if (sess) {
    await c.query(`UPDATE smartel_sessions SET state = 'closed', order_id = ?, receipt_no = ?, goods_gross = ?, net_cash = ?, closed_at = NOW() WHERE session_uuid = ?`, [orderId, o.number, major(goodsMinor), major(netCash), sess.session_uuid]);
    await c.query('UPDATE smartel_ops SET order_id = ? WHERE session_uuid = ?', [orderId, sess.session_uuid]);
  }
  if (sess && sess.remote_open) {
    // last step before commit: if pos-api refuses (a line still open, tender unpaid) the whole sale rolls back
    const goodsTender = goodsMinor ? (digital.length ? TENDERS[digital[0].plugin_id] : 'cash') : undefined;
    await call('pos-api', 'POST', `/v1/sessions/${sess.session_uuid}/close`, { goodsGrossMinor: goodsMinor, ...(goodsTender ? { goodsTender } : {}), receiptNo: o.number, clientId }, { terminal: t });
  }
  return { client_id: clientId, net_cash: major(netCash) };
}

/** a customer who only used payment services (no goods): one non-fiscal receipt with a session number (BR-02) */
async function finishServices(user, sessionUuid) {
  const sess = await db.one('SELECT * FROM smartel_sessions WHERE session_uuid = ?', [sessionUuid]);
  if (!sess) throw bad('Customer session not found');
  if (sess.state !== 'open') throw bad('This customer is already finished');
  const ops = await db.query('SELECT * FROM smartel_ops WHERE session_uuid = ? ORDER BY line_no', [sessionUuid]);
  if (ops.some(x => BLOCKING.includes(x.state))) throw bad(FRIENDLY.SES_BLOCKED);
  const done = ops.filter(x => x.state === 'completed');
  const t = await terminalRow(sess.pos_terminal_id);
  const s = await settings(true);
  if (!done.length) {
    await db.query(`UPDATE smartel_sessions SET state = 'abandoned', closed_at = NOW() WHERE session_uuid = ?`, [sessionUuid]);
    if (sess.remote_open) await call('pos-api', 'POST', `/v1/sessions/${sessionUuid}/close`, { goodsGrossMinor: 0, receiptNo: `VOID-${sessionUuid.slice(0, 8)}`, clientId: uuid() }, { terminal: t }).catch(() => {});
    return { receipt_no: null, ops: [], net_cash: 0 };
  }
  return db.tx(async c => {
    const tt = await c.one('SELECT * FROM smartel_terminals WHERE pos_terminal_id = ? FOR UPDATE', [sess.pos_terminal_id]);
    const no = tt.receipt_seq + 1;
    await c.query('UPDATE smartel_terminals SET receipt_seq = ? WHERE pos_terminal_id = ?', [no, sess.pos_terminal_id]);
    const receiptNo = `SVC/${new Date().getFullYear()}/${sess.pos_terminal_id}-${pad(no, 5)}`;
    const svcs = done.map(x => ({ lineNo: x.line_no, operationId: x.operation_id, type: x.op, amountMinor: minor(x.amount), cashMinor: minor(x.cash), mwRef: x.mw_ref, ...(x.result ? { result: String(x.result).slice(0, 120) } : {}), state: 'completed' }));
    const net = svcs.reduce((a, x) => a + x.cashMinor, 0);
    const clientId = uuid();
    const env = { sessionId: sessionUuid, receiptNo, businessTs: new Date().toISOString(), offline: false, lines: [], tenders: [], svcs, netCashMinor: net, ...(gps(s) ? { gps: gps(s) } : {}) };
    await seal(c, sess.pos_terminal_id, 'sale', 2, env, { source_type: 'services', client_id: clientId });
    await c.query(`UPDATE smartel_sessions SET state = 'closed', receipt_no = ?, net_cash = ?, closed_at = NOW() WHERE session_uuid = ?`, [receiptNo, major(net), sessionUuid]);
    await call('pos-api', 'POST', `/v1/sessions/${sessionUuid}/close`, { goodsGrossMinor: 0, receiptNo, clientId }, { terminal: t });
    return { receipt_no: receiptNo, net_cash: major(net), ops: done.map(opView) };
  }).then(r => { pushSoon(); return r; });
}

/** service lines for a paid order's receipt */
async function orderServices(c, orderId) {
  try { return (await c.query('SELECT * FROM smartel_ops WHERE order_id = ? AND state = ? ORDER BY line_no', [orderId, 'completed'])).map(opView); } catch (_) { return []; }
}

// ------------------------------------------------------------------ goods received (GRN envelope, TP-08)
async function sealGrn(c, { grn_id, supplier_id, invoice_no, lines }) {
  const s = await settings(true);
  if (!s.enabled || !lines.length) return null;
  const t = s.grn_terminal_id ? await terminalRow(s.grn_terminal_id, c) : await c.one('SELECT * FROM smartel_terminals ORDER BY pos_terminal_id LIMIT 1');
  if (!t) return null;
  const out = [];
  for (const l of lines) {
    const p = await c.one('SELECT id, barcode, smartel_product_id FROM products WHERE id = ?', [l.product_id]);
    const qty = Math.round(Number(l.qty));
    if (!p || qty <= 0) continue;
    out.push({ productId: p.smartel_product_id || `maluti:${p.id}`, gtin: gtinFor(p), lot: String(l.lot || `GRN-${grn_id}`).slice(0, 40), qty, unitCostMinor: minor(l.unit_cost), inputVatMinor: minor(Number(l.unit_cost) * qty * Number(l.tax_rate || 0) / 100) });
  }
  if (!out.length) return null;
  const r = await seal(c, t.pos_terminal_id, 'grn', 1, { grnId: String(grn_id), ...(supplier_id ? { supplierId: String(supplier_id) } : {}), ...(invoice_no ? { invoiceNo: String(invoice_no) } : {}), receivedAt: new Date().toISOString(), lines: out }, { source_type: 'grn' });
  setImmediate(pushSoon);
  return r;
}

// ------------------------------------------------------------------ bulk wage payments (TP-11, FP-15)
const PROVIDERS = ['mywallet', 'mpesa', 'ecocash', 'khetsi', 'cpay'];
function msisdn(phone) { const c = cleanCell(phone); if (/^[56]\d{7}$/.test(c)) return '266' + c; if (/^266[56]\d{7}$/.test(c)) return c; return null; }

async function bulkFromPayroll(user, runId) {
  const run = await db.one('SELECT * FROM payroll_runs WHERE id = ?', [runId]);
  if (!run) throw bad('Payroll run not found');
  if (run.status !== 'approved') throw bad('Approve the payroll run first. Paid runs cannot be sent again.');
  const exist = await db.one(`SELECT id FROM smartel_bulk WHERE payroll_run_id = ? AND state NOT IN ('failed','cancelled')`, [runId]);
  if (exist) throw bad('This payroll run already has a wage batch');
  const slips = await db.query(`SELECT p.net, e.id employee_id, e.first_name, e.last_name, e.phone, e.bank_name FROM payslips p JOIN employees e ON e.id = p.employee_id
    WHERE p.run_id = ? AND e.pay_method = 'mobile_money' AND p.net > 0 ORDER BY e.last_name, e.first_name`, [runId]);
  if (!slips.length) throw bad('Nobody in this run is paid by mobile money. Set "Pay by" to Mobile money on the employees first.');
  const skipped = []; const lines = [];
  for (const sl of slips) {
    const m = msisdn(sl.phone);
    if (!m) { skipped.push(`${sl.first_name} ${sl.last_name}: phone "${sl.phone || ''}" is not a Lesotho mobile number`); continue; }
    const prov = PROVIDERS.find(p => String(sl.bank_name || '').toLowerCase().replace(/[^a-z]/g, '').includes(p)) || 'mywallet';
    lines.push({ employee_id: sl.employee_id, name: `${sl.first_name} ${sl.last_name}`, msisdn: m, provider: prov, amount: round2(sl.net) });
  }
  if (!lines.length) throw bad('No employee has a valid phone number: ' + skipped.join('; '));
  const id = await db.tx(async c => {
    const ins = await c.query('INSERT INTO smartel_bulk (payroll_run_id, title, total, user_id) VALUES (?, ?, ?, ?)', [runId, `Wages ${run.period}`, round2(lines.reduce((a, l) => a + l.amount, 0)), user.id]);
    let i = 0;
    for (const l of lines) await c.query('INSERT INTO smartel_bulk_lines (bulk_id, line_no, employee_id, name, msisdn, provider, amount) VALUES (?, ?, ?, ?, ?, ?, ?)', [ins.insertId, ++i, l.employee_id, l.name, l.msisdn, l.provider, l.amount]);
    return ins.insertId;
  });
  return { ...(await bulkView(id)), skipped };
}
async function bulkView(id) {
  const b = await db.one('SELECT * FROM smartel_bulk WHERE id = ?', [id]);
  if (!b) return null;
  b.lines = await db.query('SELECT * FROM smartel_bulk_lines WHERE bulk_id = ? ORDER BY line_no', [id]);
  return b;
}
/** send the batch to pos-api (owner portal) and start paying; MyWallet checks the wallet covers it all first (BR-37) */
async function bulkSend(user, id) {
  const b = await bulkView(id);
  if (!b) throw bad('Batch not found');
  if (!b.batch_id) {
    const r = await call('pos-api', 'POST', '/v1/portal/bulk-batches', { lines: b.lines.map(l => ({ name: l.name, msisdn: l.msisdn, provider: l.provider, amount_minor: minor(l.amount) })) }, { portal: true });
    await db.query(`UPDATE smartel_bulk SET batch_id = ?, state = 'created', updated_at = NOW() WHERE id = ?`, [r.batchId, id]);
    b.batch_id = r.batchId;
  }
  const d = await call('pos-api', 'POST', `/v1/portal/bulk-batches/${b.batch_id}/disburse`, {}, { portal: true });
  await db.query('UPDATE smartel_bulk SET state = ?, updated_at = NOW() WHERE id = ?', [d.state || 'sending', id]);
  return bulkRefresh(id);
}
/** read the line results; book each paid line once: Dr net salaries payable / Cr MyWallet business wallet (FP-15) */
async function bulkRefresh(id) {
  const b = await bulkView(id);
  if (!b || !b.batch_id) return b;
  const r = await call('pos-api', 'GET', `/v1/portal/bulk-batches/${b.batch_id}`, undefined, { portal: true });
  for (const rl of r.lines || []) {
    const no = Number(rl.line_no || rl.lineNo);
    await db.query('UPDATE smartel_bulk_lines SET state = ?, mw_ref = COALESCE(?, mw_ref), failure = ? WHERE bulk_id = ? AND line_no = ?', [rl.state || 'ready', rl.mw_ref || rl.mwRef || null, rl.failure || null, id, no]);
  }
  await db.tx(async c => {
    const paid = await c.query(`SELECT * FROM smartel_bulk_lines WHERE bulk_id = ? AND state = 'paid' AND booked = 0 FOR UPDATE`, [id]);
    for (const l of paid) {
      await accounting.post(c, { reference: `WAGES ${l.mw_ref || l.id}`.slice(0, 60), memo: `Wages via MyWallet bulk – ${l.name}`, source_type: 'smartel_bulk', source_id: l.id, user_id: b.user_id,
        lines: [{ code: '2300', debit: round2(l.amount), description: `Net pay ${l.name}` }, { code: '1170', credit: round2(l.amount), description: `MyWallet bulk ${l.mw_ref || ''}` }] });
      await c.query('UPDATE smartel_bulk_lines SET booked = 1 WHERE id = ?', [l.id]);
    }
    const left = await c.one(`SELECT COUNT(*) n FROM smartel_bulk_lines WHERE bulk_id = ? AND state IN ('ready','sending')`, [id]);
    if (Number(left.n) === 0) await c.query(`UPDATE smartel_bulk SET state = 'done', updated_at = NOW() WHERE id = ?`, [id]);
  });
  return bulkView(id);
}
/** net pay already paid through bulk batches for a payroll run (payroll "mark paid" leaves these out) */
async function bulkPaidForRun(c, runId) {
  try { return await c.query(`SELECT l.employee_id, SUM(l.amount) amount FROM smartel_bulk_lines l JOIN smartel_bulk b ON b.id = l.bulk_id WHERE b.payroll_run_id = ? AND l.state = 'paid' GROUP BY l.employee_id`, [runId]); }
  catch (_) { return []; }
}


// ------------------------------------------------------------------ customer portal payments (no cashier session)
/** a customer paying their account online: a payment request on the portal till, through pos-api */
async function portalIntent(partnerId, tender, amount) {
  const s = await settings(true);
  const ps = (await db.getSetting('portal', {})) || {};
  if (!s.enabled || !ps.terminal_id) throw bad('Online payment is not set up');
  const t = await terminalRow(ps.terminal_id);
  if (!t || t.quarantined) throw bad('Online payment is not available right now');
  const m = await db.one('SELECT * FROM payment_methods WHERE plugin_id = ? AND active = 1', ['smartel:' + tender]);
  if (!m) throw bad('That way of paying is not offered');
  const amt = round2(amount);
  if (!(amt > 0)) throw bad('Enter the amount to pay');
  const id = uuid();
  await db.query('INSERT INTO smartel_sessions (session_uuid, pos_terminal_id, pos_session_id, tender_seq) VALUES (?, ?, NULL, 1)', [id, t.pos_terminal_id]);
  await call('pos-api', 'POST', '/v1/sessions', { sessionId: id }, { terminal: t });
  await db.query('UPDATE smartel_sessions SET remote_open = 1 WHERE session_uuid = ?', [id]);
  const ins = await db.query('INSERT INTO smartel_intents (session_uuid, tender_seq, tender, amount, partner_id) VALUES (?, 1, ?, ?, ?)', [id, tender, amt, partnerId]);
  const r = await call('pos-api', 'POST', '/v1/payments/intents', { saleId: id, tenderSeq: 1, tender, amountMinor: minor(amt) }, { terminal: t });
  await saveIntent(ins.insertId, r);
  return intentView(ins.insertId);
}
/** once PAID: the money goes on the customer's account (oldest invoices first) and the pos-api session is closed – once */
async function settlePortalIntent(id) {
  const it = await refreshIntent(id);
  if (!it.paid || it.allocated || !it.partner_id) return it;
  const m = await db.one('SELECT * FROM payment_methods WHERE plugin_id = ?', ['smartel:' + it.tender]);
  const sys = await db.one(`SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1`);
  const done = await db.tx(async c => {
    const x = await c.one('SELECT allocated FROM smartel_intents WHERE id = ? FOR UPDATE', [id]);
    if (x.allocated) return false;
    await require('./receipts').allocate(c, { partner_id: it.partner_id, amount: Number(it.amount), method_id: m.id, reference: it.mw_ref || it.intent_id, user: { id: sys ? sys.id : null }, memo: `Paid online (${it.tender})`, source_type: 'portal_payment', source_id: id });
    await c.query('UPDATE smartel_intents SET allocated = 1 WHERE id = ?', [id]);
    await c.query(`UPDATE smartel_sessions SET state = 'closed', receipt_no = ?, goods_gross = ?, closed_at = NOW() WHERE session_uuid = ?`, [`WEB-${id}`, it.amount, it.session_uuid]);
    return true;
  });
  if (done) {
    const sess = await db.one('SELECT * FROM smartel_sessions WHERE session_uuid = ?', [it.session_uuid]);
    await call('pos-api', 'POST', `/v1/sessions/${it.session_uuid}/close`, { goodsGrossMinor: minor(it.amount), goodsTender: it.tender, receiptNo: `WEB-${id}`, clientId: uuid() }, { terminal: await terminalRow(sess.pos_terminal_id) }).catch(() => {});
  }
  return intentView(id);
}

// ------------------------------------------------------------------ status / scheduler
async function status() {
  const s = await settings();
  const terms = await db.query(`SELECT t.id pos_terminal_id, t.name, t.mode, st.terminal_uuid, st.device_seq, st.head_hash, st.quarantined, st.quarantine_reason, st.last_push_at, st.last_heartbeat_at, st.last_error,
      (st.cert_pem IS NOT NULL AND st.cert_pem <> '') has_cert,
      (SELECT COUNT(*) FROM smartel_outbox o WHERE o.pos_terminal_id = t.id AND o.status IN ('pending','held')) queued,
      (SELECT COUNT(*) FROM smartel_outbox o WHERE o.pos_terminal_id = t.id AND o.status = 'rejected') rejected
    FROM pos_terminals t LEFT JOIN smartel_terminals st ON st.pos_terminal_id = t.id WHERE t.active = 1 ORDER BY t.id`);
  const cursors = await db.query('SELECT * FROM smartel_cursors ORDER BY scope');
  const reg = (await db.getSetting('smartel_register', {})) || {};
  const credit = await db.one('SELECT * FROM smartel_credit ORDER BY as_of DESC LIMIT 1');
  const recalls = await db.query('SELECT * FROM smartel_recalls WHERE closed_at IS NULL ORDER BY received_at DESC LIMIT 50');
  const unlinked = await db.one(`SELECT COUNT(*) n FROM products WHERE active = 1 AND type = 'stock' AND (smartel_product_id IS NULL OR smartel_product_id = '')`);
  const openOps = await db.query(`SELECT o.*, s.pos_terminal_id FROM smartel_ops o JOIN smartel_sessions s ON s.session_uuid = o.session_uuid WHERE o.state IN ('submitted','unknown','unknown_start','escalated') ORDER BY o.id DESC LIMIT 50`);
  const today = await db.one(`SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN cash > 0 THEN cash END),0) cash_in, COALESCE(SUM(CASE WHEN cash < 0 THEN -cash END),0) cash_out, COALESCE(SUM(commission),0) commission
    FROM smartel_ops WHERE state = 'completed' AND DATE(created_at) = CURDATE()`);
  const clearing = await db.one(`SELECT COALESCE(SUM(l.credit - l.debit),0) bal FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '2450'`).catch(() => ({ bal: 0 }));
  const digital = await db.one(`SELECT COALESCE(SUM(l.debit - l.credit),0) bal FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '1150'`).catch(() => ({ bal: 0 }));
  const commissionDue = await db.one(`SELECT COALESCE(SUM(l.debit - l.credit),0) bal FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '1160'`).catch(() => ({ bal: 0 }));
  return { settings: s, link, terminals: terms, cursors, register: reg, credit, recalls, unlinked_products: Number(unlinked.n), open_ops: openOps.map(opView), today,
    balances: { agency_clearing: round2(clearing.bal), digital_due: round2(digital.bal), commission_due: round2(commissionDue.bal) }, ops: Object.entries(OPS).map(([code, o]) => ({ code, ...o })), billers: BILLERS };
}

/** settlement with MyWallet (FP-10): digital takings received, agency position settled, commission paid out */
async function settle(user, { kind, amount, account, reference, date }) {
  const amt = round2(amount);
  if (!(amt > 0)) throw bad('Enter the amount');
  const acc = account || '1170';
  const map = {
    digital: { lines: [{ code: acc, debit: amt }, { code: '1150', credit: amt }], memo: 'MyWallet paid out digital takings' },
    commission: { lines: [{ code: acc, debit: amt }, { code: '1160', credit: amt }], memo: 'MyWallet paid agency commission' },
    agency_out: { lines: [{ code: '2450', debit: amt }, { code: acc, credit: amt }], memo: 'Agency cash moved to MyWallet float (cash-in services)' },
    agency_in: { lines: [{ code: acc, debit: amt }, { code: '2450', credit: amt }], memo: 'MyWallet float paid back for cash-out services' }
  };
  const m = map[kind];
  if (!m) throw bad('Choose what is being settled');
  await db.tx(c => accounting.post(c, { date: date || undefined, reference: reference || `MW-SETTLE-${kind}`.slice(0, 60), memo: m.memo, source_type: 'smartel_settle', user_id: user.id, lines: m.lines }));
  return { ok: true };
}

let timers = [];
function startScheduler() {
  stopScheduler();
  const tick = async (fn) => { try { if (db.isConnected() && await enabled()) await fn(); } catch (_) { /* logged on the status screen */ } };
  timers.push(setInterval(() => tick(push), 30 * 1000));
  timers.push(setInterval(() => tick(pull), 5 * 60 * 1000));
  timers.push(setInterval(() => tick(heartbeat), 15 * 60 * 1000));
  timers.push(setInterval(() => tick(async () => {
    // keep asking pos-api about lines waiting on MyWallet (BR-11) – it hands them to operations after 10 minutes
    const rows = await db.query(`SELECT id FROM smartel_ops WHERE state IN ('submitted','unknown','unknown_start') AND created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)`);
    for (const r of rows) await refreshOp(r.id).catch(() => {});
  }), 20 * 1000));
  for (const t of timers) if (t.unref) t.unref();
}
function stopScheduler() { for (const t of timers) clearInterval(t); timers = []; }

module.exports = {
  OPS, BILLERS, TENDERS, settings, saveSettings, enabled, call, request, SmartelError, link,
  envelopeHash, seal, push, pushSoon, pull, applyChange, loadRegister, markRecalledBatches, ackRecall, blockedProducts, flag, heartbeat,
  validGtin, gtinFor, gtin14, gtinCheck,
  startOp, confirmOp, refreshOp, cancelOp, bookOp, sessionView, ensureRemoteSession, createIntent, refreshIntent, intentView,
  afterSale, finishServices, orderServices, sealGrn, bulkFromPayroll, bulkView, bulkSend, bulkRefresh, bulkPaidForRun, msisdn,
  status, settle, startScheduler, stopScheduler, syncTenderMethods, portalIntent, settlePortalIntent
};
