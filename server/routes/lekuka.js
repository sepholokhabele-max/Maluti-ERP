// RSL Lekuka e-invoicing: register this installation as a device, options, status, documents, fiscal days, files.
const express = require('express');
const { requirePerm } = require('../auth');
const { ah, bad } = require('../util');
const L = require('../services/lekuka');

const r = express.Router();
const SET = requirePerm('settings'), VIEW = requirePerm('accounting|settings');
r.get('/lekuka/status', VIEW, ah(async (req, res) => res.json(await L.status())));
r.post('/lekuka/verify', SET, ah(async (req, res) => res.json(await L.verifyTaxpayer(req.body || {}))));
r.post('/lekuka/register', SET, ah(async (req, res) => res.json(await L.register(req.user, req.body || {}))));
r.put('/lekuka/options', SET, ah(async (req, res) => res.json(await L.saveOptions(req.body || {}))));
r.post('/lekuka/config', SET, ah(async (req, res) => { try { res.json(await L.refreshConfig()); } catch (e) { throw bad(e.message); } }));
r.post('/lekuka/send', VIEW, ah(async (req, res) => { await L.pump(); res.json(await L.status()); }));
r.post('/lekuka/close-day', VIEW, ah(async (req, res) => res.json(await L.closeDayNow())));
r.post('/lekuka/renew', SET, ah(async (req, res) => { try { res.json({ valid_till: await L.renewCertificate() }); } catch (e) { throw bad(e.message); } }));
r.get('/lekuka/receipts', VIEW, ah(async (req, res) => res.json(await L.receipts(req.query))));
r.get('/lekuka/days', VIEW, ah(async (req, res) => res.json(await L.days())));
r.get('/lekuka/days/:id(\\d+)/file', VIEW, ah(async (req, res) => {
  const f = await L.offlineFile(Number(req.params.id));
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="lekuka-${f.header.deviceID}-day-${f.header.fiscalDayNo}.json"`);
  res.send(JSON.stringify(f, null, 1));
}));
r.get('/lekuka/doc/:kind/:id(\\d+)', ah(async (req, res) => res.json(await L.fiscalFor(req.params.kind, Number(req.params.id)))));
// check a customer's TIN with RSL (for invoices to businesses and government)
r.post('/lekuka/verify-tin', requirePerm('partners|invoicing|sales|crm|accounting'), ah(async (req, res) => res.json(await L.verifyTin((req.body || {}).tin))));

module.exports = r;
