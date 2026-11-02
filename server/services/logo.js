// Company logo, stored in settings as a PNG/JPEG data URL (resized in the browser before upload).
const db = require('../db');
const { bad } = require('../util');

const MAX_BYTES = 1.5 * 1024 * 1024;
const RE = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/;

async function get() {
  const l = await db.getSetting('company_logo', null);
  return l && l.data_url ? l : null;
}

async function save(dataUrl) {
  const m = RE.exec(String(dataUrl || ''));
  if (!m) throw bad('Logo must be a PNG or JPEG image');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_BYTES) throw bad('Logo is too large (max 1.5 MB after resizing)');
  // basic magic-number check so only real images are stored
  const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
  if (!(isPng && m[1] === 'png') && !(isJpg && m[1] === 'jpeg')) throw bad('File is not a valid image');
  const version = Date.now();
  await db.setSetting('company_logo', { data_url: dataUrl, mime: `image/${m[1]}`, bytes: buf.length, version });
  return { version, bytes: buf.length };
}

async function remove() { await db.setSetting('company_logo', null); }

/** { mime, buffer } or null */
async function binary() {
  const l = await get();
  if (!l) return null;
  const m = RE.exec(l.data_url);
  return m ? { mime: `image/${m[1]}`, buffer: Buffer.from(m[2], 'base64'), version: l.version } : null;
}

/** company settings plus logo_version (so clients know when to refetch) */
async function companyWithLogo() {
  const c = (await db.getSetting('company', {})) || {};
  const l = await get();
  return { ...c, logo_version: l ? l.version : null };
}

module.exports = { get, save, remove, binary, companyWithLogo };
