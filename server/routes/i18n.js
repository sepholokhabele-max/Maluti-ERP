// Sesotho screen texts: corrections made by a native speaker (override the built-in words) and the texts still missing.
const express = require('express');
const db = require('../db');
const { requirePerm } = require('../auth');
const { ah, bad } = require('../util');

const pub = express.Router();
pub.get('/i18n', ah(async (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.json({ overrides: db.isConnected() ? ((await db.getSetting('i18n_overrides', {})) || {}) : {} });
}));

const r = express.Router();
r.get('/i18n/review', requirePerm('settings'), ah(async (req, res) => {
  res.json({ overrides: (await db.getSetting('i18n_overrides', {})) || {}, missing: (await db.getSetting('i18n_missing', {})) || {} });
}));
r.put('/i18n/overrides', requirePerm('settings'), ah(async (req, res) => {
  const o = req.body && req.body.overrides;
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw bad('Nothing to save');
  const clean = {};
  for (const [k, v] of Object.entries(o)) {
    const en = String(k).trim().slice(0, 300), st = String(v || '').trim().slice(0, 300);
    if (en && st) clean[en] = st;
  }
  if (Object.keys(clean).length > 10000) throw bad('Too many entries');
  await db.setSetting('i18n_overrides', clean);
  // a text that now has Sesotho is no longer missing
  const miss = (await db.getSetting('i18n_missing', {})) || {};
  for (const k of Object.keys(clean)) delete miss[k];
  await db.setSetting('i18n_missing', miss);
  res.json({ overrides: clean, saved: Object.keys(clean).length });
}));
r.post('/i18n/missing', ah(async (req, res) => {
  const list = Array.isArray(req.body && req.body.strings) ? req.body.strings.slice(0, 200) : [];
  if (!list.length) return res.json({ ok: true });
  const miss = (await db.getSetting('i18n_missing', {})) || {};
  for (const x of list) {
    const t = String((x && x.t) || '').trim();
    if (t.length < 2 || t.length > 90 || !/^[\x20-\x7E–—…’‘“”·→←▶＋✓✕]+$/.test(t)) continue;
    if (!(t in miss) && Object.keys(miss).length >= 3000) continue;
    miss[t] = (miss[t] || 0) + Math.min(Number(x.n) || 1, 50);
  }
  await db.setSetting('i18n_missing', miss);
  res.json({ ok: true });
}));
r.delete('/i18n/missing', requirePerm('settings'), ah(async (req, res) => { await db.setSetting('i18n_missing', {}); res.json({ ok: true }); }));

module.exports = { pub, router: r };
