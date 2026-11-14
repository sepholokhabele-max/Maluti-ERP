// Fixed asset register routes (permission 'assets'; the accountant and manager have it).
const express = require('express');
const db = require('../db');
const { requirePerm } = require('../auth');
const { ah, bad } = require('../util');
const A = require('../services/assets');
const gov = require('../services/governance');

const r = express.Router();
const P = requirePerm('assets');
r.get('/assets/summary', P, ah(async (req, res) => res.json(await A.summary())));
r.get('/assets/categories', P, ah(async (req, res) => res.json(await A.categories())));
r.post('/assets/categories', P, ah(async (req, res) => res.json({ id: await A.saveCategory(req.body || {}) })));
r.put('/assets/categories/:id(\\d+)', P, ah(async (req, res) => res.json({ id: await A.saveCategory(req.body || {}, Number(req.params.id)) })));
r.get('/assets', P, ah(async (req, res) => res.json(await A.list(req.query))));
r.get('/assets/locations', P, ah(async (req, res) => res.json((await db.query(`SELECT DISTINCT location FROM fixed_assets WHERE location IS NOT NULL ORDER BY location`)).map(x => x.location))));
r.get('/assets/:id(\\d+)', P, ah(async (req, res) => res.json(await A.get(req.params.id))));
r.post('/assets', P, ah(async (req, res) => res.json({ id: await A.create(req.user, req.body || {}) })));
r.put('/assets/:id(\\d+)', P, ah(async (req, res) => res.json({ id: await A.update(req.user, Number(req.params.id), req.body || {}) })));
r.post('/assets/:id(\\d+)/transfer', P, ah(async (req, res) => { await A.transfer(req.user, Number(req.params.id), req.body || {}); res.json({ ok: true }); }));
// disposals and write-offs: when the organogram governs them, the request waits for the delegated approvers and the disposal
// is booked when the last one approves (Approvals inbox); otherwise it is booked straight away
gov.onApproved('asset_disposal', (user, rq, payload) => A.dispose(user, rq.doc_id, { ...payload, date: payload.date && payload.date <= new Date().toISOString().slice(0, 10) ? payload.date : undefined }));
r.post('/assets/:id(\\d+)/dispose', P, ah(async (req, res) => {
  const id = Number(req.params.id), b = req.body || {};
  if (await gov.isGoverned('asset_disposal')) {
    const a = await db.one('SELECT * FROM fixed_assets WHERE id = ?', [id]); if (!a) throw bad('Asset not found');
    if (a.status !== 'active') throw bad('Already disposed');
    if (!String(b.note || '').trim()) throw bad('Give the reason for the disposal');
    const value = Math.round((Number(a.cost) - Number(a.accum_dep)) * 100) / 100;
    const g = await db.tx(c => gov.request(c, { doc_type: 'asset_disposal', doc_id: id, amount: value, requester_id: req.user.id, summary: `${b.kind === 'written_off' ? 'Write off' : 'Dispose of'} ${a.asset_no} ${a.name} (book value M ${value.toFixed(2)})`, link: `#/asset/${id}`, payload: b }));
    return res.json({ pending: true, request_id: g.request_id, message: `Sent to ${g.next} for approval – the disposal is booked once approved` });
  }
  res.json(await A.dispose(req.user, id, b));
}));
r.post('/assets/depreciation', P, ah(async (req, res) => res.json(await A.runDepreciation(req.user, (req.body || {}).upto))));
r.get('/assets/depreciation/runs', P, ah(async (req, res) => res.json(await db.query('SELECT d.*, u.name user_name FROM asset_dep_runs d LEFT JOIN users u ON u.id = d.user_id WHERE d.total > 0 ORDER BY d.id DESC LIMIT 100'))));
r.get('/assets/movement', P, ah(async (req, res) => res.json(await A.movement(req.query.from, req.query.to))));
r.get('/assets/counts', P, ah(async (req, res) => res.json(await db.query(`SELECT c.*, u.name user_name, (SELECT COUNT(*) FROM asset_count_lines l WHERE l.count_id = c.id AND l.found = 1) seen FROM asset_counts c LEFT JOIN users u ON u.id = c.user_id ORDER BY c.id DESC LIMIT 100`))));
r.post('/assets/counts', P, ah(async (req, res) => res.json({ id: await A.startCount(req.user, req.body || {}) })));
r.get('/assets/counts/:id(\\d+)', P, ah(async (req, res) => res.json(await A.getCount(req.params.id))));
r.post('/assets/counts/:id(\\d+)/scan', P, ah(async (req, res) => res.json(await A.countAsset(req.user, req.params.id, req.body || {}))));
r.post('/assets/counts/:id(\\d+)/close', P, ah(async (req, res) => res.json(await A.closeCount(req.user, req.params.id))));
// QR labels: each label carries the asset number (scan it during a count)
r.get('/assets/labels', P, ah(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean); if (!ids.length) throw bad('Choose the assets');
  const qr = require('../services/qr'), co = (await db.getSetting('company', {})) || {};
  const rows = await db.query('SELECT id, asset_no, name, serial_no FROM fixed_assets WHERE id IN (?) ORDER BY asset_no', [ids]);
  res.json(await Promise.all(rows.map(async a => ({ ...a, company: co.name || '', qr_svg: await qr.svg(a.asset_no) }))));
}));
module.exports = r;
