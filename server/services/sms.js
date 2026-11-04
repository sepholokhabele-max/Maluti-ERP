// SMS sending through any bulk-SMS provider with an HTTP API (BulkSMS, Clickatell, Africa's Talking, local resellers…).
// The admin pastes the provider's URL with placeholders; no provider-specific code is needed.
const db = require('../db');

const DEFAULTS = { mode: 'off', method: 'GET', url: '', body: '', headers: '', sender: '', success_text: '', country_code: '266' };
async function settings() { return { ...DEFAULTS, ...(((await db.getSetting('reminders', {})) || {}).sms || {}) }; }

/** Lesotho numbers: 5xxx xxxx / 6xxx xxxx → 266xxxxxxxx; numbers with a country code are kept (without +) */
function normalise(phone, cc = '266') {
  let p = String(phone || '').replace(/[^\d+]/g, '');
  if (!p) return null;
  if (p.startsWith('+')) p = p.slice(1);
  else if (p.startsWith('00')) p = p.slice(2);
  else if (p.length === 8) p = cc + p;
  else if (p.startsWith('0') && p.length === 9) p = cc + p.slice(1);
  return p.length >= 10 && p.length <= 15 ? p : null;
}
const fill = (tpl, v, enc) => String(tpl || '').replace(/\{(to|message|sender)\}/g, (_, k) => enc ? encodeURIComponent(v[k] || '') : String(v[k] || '').replace(/["\\]/g, m => '\\' + m).replace(/\r?\n/g, '\\n'));

/** send one SMS; returns { ok, to, response } or throws with a clear message */
async function send(phone, message, s0) {
  const s = s0 || await settings();
  const to = normalise(phone, s.country_code || '266');
  if (!to) throw new Error(`"${phone || ''}" is not a valid phone number`);
  if (s.mode === 'off') throw new Error('SMS is not set up (Reminders → Settings)');
  const text = String(message || '').slice(0, 640);
  if (s.mode === 'log') { console.log(`[sms:test] to ${to}: ${text}`); return { ok: true, to, response: 'test mode – not sent' }; }
  if (!/^https?:\/\//i.test(s.url || '')) throw new Error('Enter the SMS provider\'s web address (URL)');
  const v = { to, message: text, sender: s.sender };
  const headers = {};
  for (const line of String(s.headers || '').split('\n')) { const i = line.indexOf(':'); if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  const opt = { method: s.method === 'POST' ? 'POST' : 'GET', headers, signal: AbortSignal.timeout(20000) };
  if (opt.method === 'POST' && s.body) {
    const json = /^\s*[{[]/.test(s.body);
    opt.body = fill(s.body, v, !json);
    if (!Object.keys(headers).some(h => h.toLowerCase() === 'content-type')) headers['Content-Type'] = json ? 'application/json' : 'application/x-www-form-urlencoded';
  }
  let res, body;
  try { res = await fetch(fill(s.url, v, true), opt); body = (await res.text()).slice(0, 500); }
  catch (e) { throw new Error(`SMS provider could not be reached: ${e.message}`); }
  if (!res.ok) throw new Error(`SMS provider answered ${res.status}: ${body.slice(0, 160)}`);
  if (s.success_text && !body.includes(s.success_text)) throw new Error(`SMS provider did not confirm: ${body.slice(0, 160)}`);
  return { ok: true, to, response: body };
}

module.exports = { settings, send, normalise, DEFAULTS };
