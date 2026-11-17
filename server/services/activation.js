// Activation with a My Wallet agent number and password (1.28). The business enters the agent number and password of
// its My Wallet agent account – during set-up or later under Settings → Activation – and S-ERP is activated for good:
// no trial period, no activation codes, no expiry dates. The same agent number and password also sign the owner in.
//
// 1.29: when a My Wallet server is set (Settings → My Wallet payments, or MALUTI_MYWALLET_API_URL), My Wallet itself
// checks the agent number and password (public API v4 /merchant/activate – never core banking) and returns the shop's
// payment key. Without a server the check stays local (format only). Either way only a one-way hash is kept here.
//
// Installations activated with the old My Wallet activation codes stay activated (their expiry dates no longer apply).
// Installations set up with sample (demo) data run in demo mode until they are activated.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');

// the old activation codes (before 1.28): kept only to recognise existing activations
const PUBLIC_KEYS = [`-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi1Oa/cZWJHUlRugqfs1PJ9LDRKvX+K79sOLYxfQe7jg=
-----END PUBLIC KEY-----`];
// where KYC requests are sent: the Smartel Money / My Wallet KYC desk (MALUTI_KYC_EMAIL overrides it)
const KYC_EMAIL = process.env.MALUTI_KYC_EMAIL || 'kyc@smartelmoney.com';
const KYC_DOCS = [
  { key: 'owner_id', name: 'ID or passport of the owner / director', name_st: 'ID kapa phasepoto ea mong\'a khoebo', required: true },
  { key: 'registration', name: 'Company registration certificate or trader\'s licence', name_st: 'Setifikeiti sa ngoliso sa khamphani kapa laesense ea khoebo', required: true },
  { key: 'address', name: 'Proof of business address (lease, utility bill or council letter)', name_st: 'Bopaki ba aterese ea khoebo', required: true },
  { key: 'tax', name: 'TIN / VAT certificate from Revenue Services Lesotho', name_st: 'Setifikeiti sa TIN / VAT', required: false },
  { key: 'bank', name: 'Bank confirmation letter', name_st: 'Lengolo la netefatso la banka', required: false }
];

const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const today = () => new Date().toISOString().slice(0, 10);

async function get() {
  let a = await db.getSetting('activation', null);
  if (!a) { a = { install_id: newInstallId(), created: today() }; await db.setSetting('activation', a); }
  if (!a.install_id) { a.install_id = newInstallId(); await db.setSetting('activation', a); }
  return a;
}
function newInstallId() { const s = crypto.randomBytes(8).toString('hex').toUpperCase(); return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`; }
async function save(patch) { const a = { ...(await get()), ...patch }; await db.setSetting('activation', a); return a; }

/** an agent number as typed (spaces, dashes, upper / lower case) → one form */
const normAgent = n => String(n || '').replace(/[\s-]+/g, '').toUpperCase();
/** the agent number shown on screens: the last 4 characters only */
const maskAgent = n => { const x = normAgent(n); return x.length > 4 ? `${'•'.repeat(Math.min(6, x.length - 4))}${x.slice(-4)}` : x; };

/** is the install activated? 'agent' (My Wallet agent), 'legacy' (old activation code), 'demo' or null */
function modeOf(a) {
  if (a.agent && a.agent.number) return 'agent';
  if (a.licence) return 'legacy';
  if (a.demo || (!a.v2 && a.trial_start)) return 'demo'; // installs from before 1.28 that were still on trial carry on in demo mode
  return null;
}

/** what the screens need to know */
async function status() {
  const a = await get();
  const mode = modeOf(a);
  const docs = await db.query(`SELECT id, note doc, filename, size, created_at FROM attachments WHERE entity = 'kyc' ORDER BY id`).catch(() => []);
  const ent = require('./entity').byKey(((await db.getSetting('company', {})) || {}).entity_type);
  const docTypes = KYC_DOCS.map(d => ({ ...d, required: ent && ent.kyc[d.key] !== undefined ? ent.kyc[d.key] : d.required,
    ...(d.key === 'registration' && ent && ent.key === 'informal' ? { name: 'Market / hawker\'s permit or a letter from the chief or council (if you have one)', name_st: 'Tumello ea ho rekisa kapa lengolo la morena (haeba u na le lona)' } : {}),
    ...(d.key === 'registration' && ent && ent.key === 'government' ? { name: 'Letter of authority from the accounting officer', name_st: 'Lengolo la tumello le tsoang ho ofisiri ea lichelete' } : {}) }));
  const kyc = a.kyc || {};
  const missing = kyc.path === 'merchant' ? [] : docTypes.filter(d => d.required && !docs.some(x => x.doc === d.key)).map(d => d.key);
  const owner = a.agent && a.agent.user_id ? await db.one('SELECT id, name, username FROM users WHERE id = ?', [a.agent.user_id]).catch(() => null) : null;
  return {
    activated: mode === 'agent' || mode === 'legacy', demo: mode === 'demo', locked: !mode, mode, install_id: a.install_id,
    agent: a.agent ? { number: maskAgent(a.agent.number), activated_at: a.agent.activated_at, owner: owner ? owner.name : null, owner_username: owner ? owner.username : null, check: a.agent.check || 'local', till_number: a.agent.till_number || null, name: a.agent.name || null } : null,
    legacy: a.licence ? { business: a.licence.b, issued: a.licence.d } : null,
    kyc: { path: kyc.path || null, merchant_no: kyc.merchant_no || null, merchant_phone: kyc.merchant_phone || null, submitted_at: kyc.submitted_at || null, ready: !!kyc.path && !missing.length, missing },
    documents: docs, doc_types: docTypes, entity_type: ent ? ent.key : null, kyc_email: KYC_EMAIL
  };
}

/**
 * check an agent number and password. Today: format only (the account is not yet looked up at My Wallet).
 * Later: ask My Wallet through the Smartel pos-api adapter and keep the agent's name and status it returns.
 */
async function verifyAgent(agentNo, password) {
  const n = normAgent(agentNo);
  if (!/^[A-Z0-9]{3,20}$/.test(n)) throw Object.assign(new Error('Enter your My Wallet agent number (letters and numbers, as on your agent profile)'), { status: 400 });
  if (String(password || '').length < 4) throw Object.assign(new Error('Enter the password of your My Wallet agent account'), { status: 400 });
  return { number: n, check: 'local' };
}
/** activate with a My Wallet agent number and password; the owner (an administrator) can then also sign in with them */
async function activateAgent(user, { agent_no, password }) {
  if (user && user.role !== 'admin' && !(user.permissions || []).includes('*')) throw Object.assign(new Error('Only the owner / an administrator can activate S-ERP'), { status: 403 });
  const v = await verifyAgent(agent_no, password);
  const clash = user ? await db.one('SELECT id FROM users WHERE UPPER(REPLACE(username, \' \', \'\')) = ? AND id <> ?', [v.number, user.id]) : null;
  if (clash) throw Object.assign(new Error('A staff member already uses this agent number as a username – change that username first'), { status: 400 });
  // when a My Wallet server is set (Settings → My Wallet payments, or MALUTI_MYWALLET_API_URL) My Wallet itself checks the
  // agent number and password and returns the shop's payment key; otherwise the check stays local
  const live = await require('./mywallet').linkAgent(String(agent_no || '').trim(), String(password));
  if (live) v.check = 'mywallet';
  const a = await get();
  await save({ v2: true, demo: false, agent: { number: v.number, hash: bcrypt.hashSync(String(password), 10), user_id: user ? user.id : (a.agent && a.agent.user_id) || null, activated_at: new Date().toISOString(), check: v.check, ...(live ? { till_number: live.till_number, name: live.name } : {}) } });
  await db.query(`INSERT INTO audit_log (user_id, action, entity, details) VALUES (?, 'activation.agent', 'activation', ?)`, [user ? user.id : null, JSON.stringify({ agent: maskAgent(v.number), check: v.check })]).catch(() => {});
  return status();
}
/** sign-in with the agent number and password → the owner's user record (or null) */
async function agentLogin(username, password) {
  const a = await db.getSetting('activation', null).catch(() => null);
  if (!a || !a.agent || !a.agent.hash || !a.agent.user_id) return null;
  if (normAgent(username) !== a.agent.number) return null;
  if (!bcrypt.compareSync(String(password || ''), a.agent.hash)) return false;
  return db.one('SELECT * FROM users WHERE id = ? AND active = 1', [a.agent.user_id]);
}
/** first-run set-up: mark the installation as new-style; demo installs run in demo mode until activated */
async function initialise(user, { demo, mywallet }) {
  await save({ v2: true, demo: !!demo && !(mywallet && mywallet.agent_no), created: today() });
  if (mywallet && mywallet.agent_no) await activateAgent(user, mywallet);
}

/** used by every place that sells: the till, customer invoices (rooms, hire, clinic, contracts…) and airtime / electricity */
async function assertCanSell() {
  const s = await status();
  if (s.locked) {
    const e = new Error('S-ERP is not activated yet. The owner activates it once with the My Wallet agent number and password under Settings → Activation – then selling works without any expiry.');
    e.status = 402; throw e;
  }
}

/** recognise an activation code from before 1.28 (kept for installations that were activated that way) */
function verify(code, installId) {
  const raw = String(code || '').replace(/\s+/g, '');
  const [p, sg] = raw.split('.');
  if (!p || !sg) throw new Error('That is not an activation code');
  let payload; try { payload = JSON.parse(unb64u(p).toString('utf8')); } catch (_) { throw new Error('That activation code is damaged'); }
  const keys = [...PUBLIC_KEYS, ...String(process.env.MALUTI_ACTIVATION_PUBKEYS || '').split('|').filter(Boolean)];
  if (!keys.some(k => { try { return crypto.verify(null, Buffer.from(p), k, unb64u(sg)); } catch (_) { return false; } })) throw new Error('This activation code is not valid');
  if (payload.i !== installId) throw new Error('This code is for another installation');
  return payload;
}
async function activate(code) { const a = await get(); await save({ licence: verify(code, a.install_id), activated_at: new Date().toISOString() }); return status(); }

module.exports = { get, save, status, verify, activate, activateAgent, verifyAgent, agentLogin, initialise, assertCanSell, normAgent, maskAgent, KYC_DOCS };
