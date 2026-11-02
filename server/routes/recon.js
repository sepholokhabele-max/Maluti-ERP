const express = require('express');
const recon = require('../services/recon');
const { requirePerm } = require('../auth');
const { ah } = require('../util');

const r = express.Router();
r.use(requirePerm('recon'));

r.get('/', ah(async (req, res) => res.json(await recon.list(req.query.days))));
r.get('/:date', ah(async (req, res) => res.json(await recon.get(req.params.date))));
r.get('/:date/transactions', ah(async (req, res) => res.json(await recon.transactions(req.params.date, Number(req.query.method_id)))));
r.put('/:date', ah(async (req, res) => { await recon.save(req.user, req.params.date, req.body); res.json(await recon.get(req.params.date)); }));
r.post('/:date/submit', ah(async (req, res) => { await recon.submit(req.user, req.params.date, req.body); res.json(await recon.get(req.params.date)); }));
r.post('/:date/approve', requirePerm('recon.approve'), ah(async (req, res) => { await recon.approve(req.user, req.params.date, req.body); res.json(await recon.get(req.params.date)); }));
r.post('/:date/reject', requirePerm('recon.approve'), ah(async (req, res) => { await recon.reject(req.user, req.params.date, req.body); res.json(await recon.get(req.params.date)); }));
r.post('/:date/reopen', ah(async (req, res) => { await recon.reopen(req.user, req.params.date); res.json(await recon.get(req.params.date)); }));

module.exports = r;
