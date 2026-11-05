// Activation & KYC. A new business can use everything for a 30-day trial. To keep selling after that it must be activated
// by My Wallet: new businesses upload their KYC documents; existing My Wallet agents / merchants only give their
// agent or merchant number (their KYC is already on file). My Wallet reviews the request and sends an activation code,
// signed with My Wallet's private key – the program checks it with the public key below, works offline, and the code
// only fits this installation (install ID).
const crypto = require('crypto');
const db = require('../db');

const TRIAL_DAYS = 30;
// My Wallet's public key. The private key that signs codes is kept by My Wallet only (never in this repository).
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
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

async function get() {
  let a = await db.getSetting('activation', null);
  if (!a) { a = { install_id: newInstallId(), trial_start: today() }; await db.setSetting('activation', a); }
  if (!a.install_id) { a.install_id = newInstallId(); await db.setSetting('activation', a); }
  return a;
}
function newInstallId() { const s = crypto.randomBytes(8).toString('hex').toUpperCase(); return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`; }
async function save(patch) { const a = { ...(await get()), ...patch }; await db.setSetting('activation', a); return a; }

/** what the screens need to know */
async function status() {
  const a = await get();
  const trialEnds = addDays(a.trial_start || today(), TRIAL_DAYS);
  const lic = a.licence || null;
  const valid = !!lic && (!lic.e || lic.e >= today());
  const daysLeft = Math.ceil((new Date(trialEnds + 'T23:59:59Z') - Date.now()) / 86400000);
  const docs = await db.query(`SELECT id, note doc, filename, size, created_at FROM attachments WHERE entity = 'kyc' ORDER BY id`).catch(() => []);
  const kyc = a.kyc || {};
  const missing = kyc.path === 'merchant' ? [] : KYC_DOCS.filter(d => d.required && !docs.some(x => x.doc === d.key)).map(d => d.key);
  return {
    activated: valid, licence: lic ? { business: lic.b, issued: lic.d, expires: lic.e || null } : null, expired_licence: !!lic && !valid,
    trial_ends: trialEnds, days_left: Math.max(0, daysLeft), locked: !valid && daysLeft <= 0, install_id: a.install_id,
    kyc: { path: kyc.path || null, merchant_no: kyc.merchant_no || null, merchant_phone: kyc.merchant_phone || null, submitted_at: kyc.submitted_at || null, ready: !!kyc.path && !missing.length, missing },
    documents: docs, doc_types: KYC_DOCS, kyc_email: KYC_EMAIL
  };
}

/** check an activation code against My Wallet's public key(s); returns the decoded licence or throws */
function verify(code, installId) {
  const raw = String(code || '').replace(/\s+/g, '');
  const [p, sg] = raw.split('.');
  if (!p || !sg) throw new Error('That is not an activation code – copy the whole code exactly as you received it');
  let payload; try { payload = JSON.parse(unb64u(p).toString('utf8')); } catch (_) { throw new Error('That activation code is damaged – copy it again'); }
  const keys = [...PUBLIC_KEYS, ...String(process.env.MALUTI_ACTIVATION_PUBKEYS || '').split('|').filter(Boolean)];
  const ok = keys.some(k => { try { return crypto.verify(null, Buffer.from(p), k, unb64u(sg)); } catch (_) { return false; } });
  if (!ok) throw new Error('This activation code is not valid – it was not issued by My Wallet');
  if (payload.v !== 1) throw new Error('This activation code is for another version');
  if (payload.i !== installId) throw new Error(`This code is for another installation (${payload.i}). Your install ID is ${installId}.`);
  if (payload.e && payload.e < today()) throw new Error(`This activation code expired on ${payload.e}`);
  return payload;
}
async function activate(code) {
  const a = await get();
  const lic = verify(code, a.install_id);
  await save({ licence: lic, activated_at: new Date().toISOString() });
  return status();
}

/** used by every place that sells: the till, customer invoices (rooms, hire, clinic, contracts…) and airtime / electricity */
async function assertCanSell() {
  const s = await status();
  if (s.locked) {
    const e = new Error(s.expired_licence ? `Your activation expired on ${s.licence.expires}. Ask My Wallet for a new activation code (Settings → Activation & KYC).`
      : `The 30-day trial has ended. Selling is paused until this business is activated – finish your KYC under Settings → Activation & KYC and enter the activation code from My Wallet.`);
    e.status = 402; throw e;
  }
}

/** the code My Wallet issues (used by tools/activation/make-code.js) */
function makeCode(privateKeyPem, { install_id, business, expires = null, days = null }) {
  const payload = { v: 1, i: install_id, b: business || '', d: today(), e: expires || (days ? addDays(today(), days) : null) };
  const p = b64u(JSON.stringify(payload));
  return `${p}.${b64u(crypto.sign(null, Buffer.from(p), privateKeyPem))}`;
}

module.exports = { get, save, status, verify, activate, assertCanSell, makeCode, KYC_DOCS, TRIAL_DAYS };
