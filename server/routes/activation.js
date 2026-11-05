// Activation & KYC screens: status for everyone (the banner), KYC path, document uploads, the KYC pack and the code.
const express = require('express');
const db = require('../db');
const A = require('../services/activation');
const { requirePerm } = require('../auth');
const { ah, bad } = require('../util');

const r = express.Router();
const S = requirePerm('settings');
r.get('/activation', ah(async (req, res) => {
  const s = await A.status();
  // staff see only what the banner needs
  if (!req.user.permissions.includes('*') && !req.user.permissions.includes('settings')) return res.json({ activated: s.activated, locked: s.locked, days_left: s.days_left, trial_ends: s.trial_ends });
  res.json(s);
}));
r.put('/activation/kyc', S, ah(async (req, res) => {
  const b = req.body;
  const path = ['merchant', 'documents'].includes(b.path) ? b.path : null; if (!path) throw bad('Choose: existing My Wallet agent / merchant, or new');
  const kyc = { ...((await A.get()).kyc || {}), path };
  if (path === 'merchant') {
    kyc.merchant_no = String(b.merchant_no || '').trim().slice(0, 40); kyc.merchant_phone = String(b.merchant_phone || '').trim().slice(0, 40);
    if (!/^[A-Za-z0-9-]{3,40}$/.test(kyc.merchant_no)) throw bad('Enter your My Wallet agent or merchant number');
    if (kyc.merchant_phone.replace(/\D/g, '').length < 8) throw bad('Enter the phone number registered with My Wallet');
  }
  res.json((await A.save({ kyc })) && await A.status());
}));
r.post('/activation/documents', S, ah(async (req, res) => {
  const doc = A.KYC_DOCS.find(d => d.key === req.body.doc); if (!doc) throw bad('Choose which document this is');
  const m = /^data:([^;]+);base64,(.+)$/.exec(String(req.body.data_url || '')); if (!m) throw bad('Choose the file');
  if (!/^(image\/(png|jpe?g|webp)|application\/pdf)$/.test(m[1])) throw bad('Upload a photo (JPG / PNG) or a PDF');
  const data = Buffer.from(m[2], 'base64'); if (data.length > 8 * 1024 * 1024) throw bad('The file is bigger than 8 MB – take the photo again at a lower size');
  await db.query(`DELETE FROM attachments WHERE entity = 'kyc' AND note = ?`, [doc.key]);
  await db.query(`INSERT INTO attachments (entity, entity_id, filename, mime, size, data, note, user_id) VALUES ('kyc', 1, ?, ?, ?, ?, ?, ?)`,
    [String(req.body.filename || doc.key).slice(0, 200), m[1], data.length, data, doc.key, req.user.id]);
  res.json(await A.status());
}));
r.delete('/activation/documents/:id(\\d+)', S, ah(async (req, res) => { await db.query(`DELETE FROM attachments WHERE entity = 'kyc' AND id = ?`, [req.params.id]); res.json(await A.status()); }));
r.get('/activation/documents/:id(\\d+)', S, ah(async (req, res) => {
  const f = await db.one(`SELECT * FROM attachments WHERE entity = 'kyc' AND id = ?`, [req.params.id]); if (!f) throw bad('Not found');
  res.setHeader('Content-Type', f.mime); res.send(f.data);
}));
// the request sent to My Wallet: who the business is, the install ID, and the documents (or the merchant number)
async function request() {
  const s = await A.status(); const c = (await db.getSetting('company', {})) || {};
  if (!s.kyc.path) throw bad('First choose whether you are an existing My Wallet agent / merchant');
  if (s.kyc.missing.length) throw bad(`Upload these first: ${s.kyc.missing.map(k => A.KYC_DOCS.find(d => d.key === k).name).join('; ')}`);
  return { s, c, text: [`MALUTI ERP – ACTIVATION REQUEST`, ``, `Install ID: ${s.install_id}`, `Business: ${c.name || ''}`, `Phone: ${c.phone || ''}`, `Email: ${c.email || ''}`, `Address: ${c.address || ''}`, `TIN / VAT: ${c.tax_number || '-'}`,
    s.kyc.path === 'merchant' ? `Existing My Wallet agent / merchant number: ${s.kyc.merchant_no} (registered phone ${s.kyc.merchant_phone}) – KYC already on file with My Wallet` : `New business – KYC documents attached: ${s.documents.map(d => d.doc).join(', ')}`,
    `Requested: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`].join('\r\n') };
}
r.post('/activation/submit', S, ah(async (req, res) => {
  const { s, text } = await request();
  await A.save({ kyc: { ...((await A.get()).kyc || {}), submitted_at: new Date().toISOString() } });
  let emailed = false, email_error = null;
  if (s.kyc_email) {
    // the KYC documents travel with the request (merchants / agents have none – their KYC is on file)
    const attachments = [];
    for (const d of s.documents) { const f = await db.one('SELECT filename, mime, data FROM attachments WHERE id = ?', [d.id]); if (f) attachments.push({ filename: `${d.doc}-${f.filename}`, content: f.data, contentType: f.mime }); }
    const c = (await db.getSetting('company', {})) || {};
    emailed = await require('../services/mailer').sendMail({ to: s.kyc_email, subject: `Activation request ${s.install_id} – ${c.name || ''}`.trim(), text, kind: 'kyc', attachments, replyTo: c.email || undefined })
      .then(() => true).catch(e => { email_error = /not configured|SMTP|host/i.test(e.message) ? 'Email is not set up on this computer (Settings → Email)' : e.message; return false; });
  }
  res.json({ ...(await A.status()), request_text: text, emailed, email_error });
}));
r.get('/activation/pack', S, ah(async (req, res) => {
  const { s, c, text } = await request();
  const files = [{ name: 'activation-request.txt', data: text }];
  for (const d of s.documents) { const f = await db.one('SELECT filename, data FROM attachments WHERE id = ?', [d.id]); files.push({ name: `${d.doc}-${f.filename}`.replace(/[\\/:*?"<>|]+/g, '-'), data: f.data }); }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="KYC ${String(c.name || 'business').replace(/[^\w .-]+/g, '')} ${s.install_id}.zip"`);
  res.send(require('../services/zipstore').zip(files));
}));
r.post('/activation/code', S, ah(async (req, res) => { try { res.json(await A.activate(req.body.code)); } catch (e) { throw bad(e.message); } }));

module.exports = r;
