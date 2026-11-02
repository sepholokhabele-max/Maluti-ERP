const express = require('express');
const db = require('../db');
const Bar = require('../services/bar');
const B = require('../services/butchery');
const { requirePerm } = require('../auth');
const { ah, bad, today } = require('../util');

const r = express.Router();
r.use(requirePerm('inventory'));

// scale serial settings are shared with butchery mode (Butchery → Settings)
r.get('/scale', ah(async (req, res) => {
  const s = await B.settings();
  res.json({ baud_rate: s.baud_rate, data_bits: s.data_bits, parity: s.parity, stop_bits: s.stop_bits, request_cmd: s.request_cmd });
}));
r.get('/bottles', ah(async (req, res) => res.json(await Bar.bottles())));
r.post('/ml-from-weight', ah(async (req, res) => {
  const p = await db.one('SELECT * FROM products WHERE id = ?', [req.body.product_id]);
  if (!p || !(Number(p.bottle_ml) > 0)) throw bad('Not a bottle product');
  res.json({ ml: Bar.mlFromWeight(p, req.body.grams) });
}));
r.get('/counts', ah(async (req, res) => res.json(await db.query(`SELECT b.*, u.name user_name, (SELECT COUNT(*) FROM bar_count_lines l WHERE l.count_id = b.id) line_count
  FROM bar_counts b LEFT JOIN users u ON u.id = b.user_id ORDER BY b.id DESC LIMIT 200`))));
r.get('/counts/:id', ah(async (req, res) => res.json(await Bar.getCount(req.params.id))));
r.post('/counts', ah(async (req, res) => res.json({ id: await Bar.saveCount(req.user, null, req.body) })));
r.put('/counts/:id', ah(async (req, res) => res.json({ id: await Bar.saveCount(req.user, Number(req.params.id), req.body) })));
r.post('/counts/:id/post', ah(async (req, res) => res.json(await Bar.postCount(req.user, req.params.id))));
r.delete('/counts/:id', ah(async (req, res) => { await db.query(`DELETE FROM bar_counts WHERE id = ? AND status = 'draft'`, [req.params.id]); res.json({ ok: true }); }));
r.get('/pours', ah(async (req, res) => { const from = req.query.from || today(); res.json(await Bar.pourReport(from, req.query.to || from)); }));

module.exports = r;
