// My Wallet payments (My Wallet API v4): settings, linking the shop, payment requests at the till.
const express = require('express');
const { requirePerm, can } = require('../auth');
const { ah, bad } = require('../util');
const MW = require('../services/mywallet');

const r = express.Router();
const SET = requirePerm('settings'), VIEW = requirePerm('settings|accounting');
const till = (req, res, next) => (can(req.user, 'pos') || can(req.user, 'settings')) ? next() : next(Object.assign(new Error('No till access'), { status: 403 }));

r.get('/mywallet/status', VIEW, ah(async (req, res) => res.json(await MW.status())));
r.put('/mywallet/settings', SET, ah(async (req, res) => res.json(await MW.saveSettings(req.body || {}))));
r.post('/mywallet/test', SET, ah(async (req, res) => { try { res.json(await MW.test()); } catch (e) { throw bad(e.message); } }));
r.post('/mywallet/link', SET, ah(async (req, res) => {
  const b = req.body || {};
  if (b.api_url !== undefined) await MW.saveSettings({ api_url: b.api_url });
  const out = await MW.linkAgent(String(b.agent_no || ''), String(b.password || ''));
  if (!out) throw bad('Enter the My Wallet address first');
  res.json(out);
}));

r.post('/mywallet/payments', till, ah(async (req, res) => res.json(await MW.createPayment(req.user, req.body || {}))));
r.get('/mywallet/payments/:id(\\d+)', till, ah(async (req, res) => res.json(await MW.refresh(Number(req.params.id)))));
r.post('/mywallet/payments/:id(\\d+)/cancel', till, ah(async (req, res) => res.json(await MW.cancel(Number(req.params.id)))));
r.post('/mywallet/payments/:id(\\d+)/simulate', till, ah(async (req, res) => res.json(await MW.simulate(Number(req.params.id), (req.body || {}).outcome))));

module.exports = r;
