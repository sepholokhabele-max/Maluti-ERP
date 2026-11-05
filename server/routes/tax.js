// Tax centre: calendar, returns from the books (VAT, PAYE, withholding, fringe benefits, income tax, levies), filing and paying RSL
const express = require('express');
const db = require('../db');
const T = require('../services/tax');
const { requirePerm } = require('../auth');
const { ah, bad } = require('../util');

const r = express.Router();
const acc = requirePerm('accounting');

r.get('/tax/settings', acc, ah(async (req, res) => res.json({ settings: await T.settings(), wht_kinds: T.WHT_KINDS, taxes: T.TAXES })));
r.put('/tax/settings', requirePerm('settings'), ah(async (req, res) => res.json(await T.saveSettings(req.body || {}))));
r.get('/tax/calendar', acc, ah(async (req, res) => {
  const d = new Date(); const from = req.query.from || new Date(d.getFullYear(), d.getMonth() - 3, 1).toISOString().slice(0, 10);
  const to = req.query.to || new Date(d.getFullYear(), d.getMonth() + 12, 28).toISOString().slice(0, 10);
  const s = await T.settings(); const ty = T.taxYear(new Date().toISOString().slice(0, 10), s.year_end_month);
  res.json({ items: await T.schedule(from, to), liabilities: await T.liabilities(), payments: await T.paymentSummary(ty.from, ty.to), tax_year: ty.label });
}));
r.get('/tax/returns', acc, ah(async (req, res) => {
  const rows = await db.query(`SELECT id, tax, period_label, period_from, period_to, due_date, status, amount_due, amount_paid, filed_at, filed_ref FROM tax_returns ${req.query.tax ? 'WHERE tax = ?' : ''} ORDER BY due_date DESC, id DESC LIMIT 300`, req.query.tax ? [req.query.tax] : []);
  res.json(rows.map(x => ({ ...x, name: (T.TAXES[x.tax] || {}).name || x.tax })));
}));
r.get('/tax/returns/:id', acc, ah(async (req, res) => res.json(await T.getReturn(Number(req.params.id)))));
r.post('/tax/returns/prepare', acc, ah(async (req, res) => res.json(await T.prepare(req.user, req.body || {}))));
r.post('/tax/returns/:id/file', acc, ah(async (req, res) => res.json(await T.file(req.user, Number(req.params.id), req.body || {}))));
r.post('/tax/returns/:id/reopen', acc, ah(async (req, res) => res.json(await T.reopen(req.user, Number(req.params.id)))));
r.post('/tax/returns/:id/pay', acc, ah(async (req, res) => {
  const b = req.body || {};
  if (b.method === 'smartel') res.json(await T.paySmartel(req.user, Number(req.params.id), b));
  else res.json(await T.payManual(req.user, Number(req.params.id), b));
}));
r.get('/tax/fee', acc, ah(async (req, res) => res.json({ fee: await T.rslFee(Number(req.query.amount || 0)) })));
r.post('/tax/payments/:id/confirm', acc, ah(async (req, res) => res.json(await T.settleSmartel(req.user, Number(req.params.id), 'confirm', req.body || {}))));
r.post('/tax/payments/:id/refresh', acc, ah(async (req, res) => res.json(await T.settleSmartel(req.user, Number(req.params.id), 'refresh'))));
r.get('/tax/withholding', acc, ah(async (req, res) => res.json(await db.query(`SELECT w.*, p.name partner_name FROM tax_withholding w JOIN partners p ON p.id = w.partner_id
  ${req.query.direction ? 'WHERE w.direction = ?' : ''} ORDER BY w.tx_date DESC, w.id DESC LIMIT 500`, req.query.direction ? [req.query.direction] : []))));
r.post('/tax/withholding', acc, ah(async (req, res) => res.json(await T.recordWithholding(req.user, req.body || {}))));
r.get('/tax/withholding/:id/certificate', acc, ah(async (req, res) => {
  const w = await db.one('SELECT w.*, p.name partner_name, p.tax_number partner_tin, p.address partner_address FROM tax_withholding w JOIN partners p ON p.id = w.partner_id WHERE w.id = ?', [req.params.id]);
  if (!w || w.direction !== 'deducted') throw bad('Certificates are only issued for tax you withheld');
  res.json({ ...w, company: (await db.getSetting('company', {})) || {}, tin: (await T.settings()).tin, kind_name: T.WHT_KINDS[w.kind] || w.kind });
}));

module.exports = r;
