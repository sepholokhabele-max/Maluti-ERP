// Finance centre (Sage-level GL), audit tools and internal audit.
// Permissions: 'accounting' (change the books), 'accounting.view' (read-only: auditors), 'finance.close' (year-end),
// 'audit' (audit tools, queries), 'internal_audit' (the internal audit function – independent of management).
const express = require('express');
const db = require('../db');
const { requirePerm } = require('../auth');
const { ah, bad, today } = require('../util');
const L = require('../services/ledger');
const gov = require('../services/governance');
const A = require('../services/audit');
const IA = require('../services/internalaudit');

const r = express.Router();
const VIEW = requirePerm('accounting|accounting.view|audit'), EDIT = requirePerm('accounting'), AUD = requirePerm('audit'), IAP = requirePerm('internal_audit');
const range = q => { const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : today(); const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : `${to.slice(0, 4)}-01-01`; if (from > to) throw bad('"From" is after "to"'); return { from, to }; };

/* ---------------- finance ---------------- */
r.get('/finance/settings', VIEW, ah(async (req, res) => res.json(await L.settings())));
r.put('/finance/settings', EDIT, ah(async (req, res) => res.json(await L.saveSettings(req.user, req.body || {}))));
r.post('/finance/lock', EDIT, ah(async (req, res) => res.json(await L.setLock(req.user, (req.body || {}).lock_date))));
r.get('/finance/accounts', VIEW, ah(async (req, res) => res.json({ accounts: await L.accounts(), categories: Object.entries(L.CATS).map(([key, [type, name]]) => ({ key, type, name })) })));
r.post('/finance/accounts', EDIT, ah(async (req, res) => res.json({ id: await L.saveAccount(req.user, req.body || {}) })));
r.put('/finance/accounts/:id(\\d+)', EDIT, ah(async (req, res) => res.json({ id: await L.saveAccount(req.user, req.body || {}, Number(req.params.id)) })));
r.get('/finance/cost-centres', ah(async (req, res) => res.json(await L.costCentres())));
r.post('/finance/cost-centres', EDIT, ah(async (req, res) => res.json({ id: await L.saveCostCentre(req.body || {}) })));
r.put('/finance/cost-centres/:id(\\d+)', EDIT, ah(async (req, res) => res.json({ id: await L.saveCostCentre(req.body || {}, Number(req.params.id)) })));
r.get('/finance/years', VIEW, ah(async (req, res) => res.json({ years: await L.years(), lock_date: (await L.settings()).lock_date })));
r.post('/finance/years/:id(\\d+)/close', requirePerm('finance.close'), ah(async (req, res) => res.json(await L.closeYear(req.user, Number(req.params.id)))));
r.post('/finance/years/:id(\\d+)/reopen', requirePerm('finance.close'), ah(async (req, res) => { await L.reopenYear(req.user, Number(req.params.id)); res.json({ ok: true }); }));
r.get('/finance/journals', VIEW, ah(async (req, res) => res.json(await L.batches(req.query))));
r.get('/finance/journals/:id(\\d+)', VIEW, ah(async (req, res) => { const j = await db.one('SELECT j.*, u.name created_by_name, a.name approved_by_name FROM journal_batches j LEFT JOIN users u ON u.id = j.created_by LEFT JOIN users a ON a.id = j.approved_by WHERE j.id = ?', [req.params.id]); if (!j) throw bad('Not found'); j.lines = typeof j.lines === 'string' ? JSON.parse(j.lines) : j.lines; res.json(j); }));
r.post('/finance/journals', EDIT, ah(async (req, res) => res.json({ id: await L.saveBatch(req.user, req.body || {}) })));
r.put('/finance/journals/:id(\\d+)', EDIT, ah(async (req, res) => res.json({ id: await L.saveBatch(req.user, req.body || {}, Number(req.params.id)) })));
r.post('/finance/journals/:id(\\d+)/submit', EDIT, ah(async (req, res) => res.json(await L.submitBatch(req.user, Number(req.params.id)))));
r.post('/finance/journals/:id(\\d+)/approve', gov.gate('journal', 'accounting'), ah(async (req, res) => res.json(await L.approveBatch(req.user, Number(req.params.id), req.body || {}))));
r.post('/finance/journals/:id(\\d+)/cancel', EDIT, ah(async (req, res) => { await L.cancelBatch(req.user, Number(req.params.id)); res.json({ ok: true }); }));
r.post('/finance/entries/:id(\\d+)/reverse', EDIT, ah(async (req, res) => res.json(await L.reverseEntry(req.user, Number(req.params.id), req.body || {}))));
r.get('/finance/entries/:id(\\d+)', VIEW, ah(async (req, res) => {
  const e = await db.one(`SELECT e.*, u.name user_name FROM journal_entries e LEFT JOIN users u ON u.id = e.user_id WHERE e.id = ?`, [req.params.id]); if (!e) throw bad('Not found');
  e.lines = await db.query(`SELECT l.*, a.code, a.name account_name, p.name partner_name, c.code cost_centre FROM journal_lines l JOIN accounts a ON a.id = l.account_id LEFT JOIN partners p ON p.id = l.partner_id LEFT JOIN cost_centres c ON c.id = l.cost_centre_id WHERE l.entry_id = ? ORDER BY l.id`, [e.id]);
  e.queries = await db.query(`SELECT id, subject, status FROM audit_queries WHERE entity = 'journal_entry' AND entity_id = ?`, [e.id]);
  res.json(e);
}));
r.get('/finance/recurring', VIEW, ah(async (req, res) => res.json(await db.query('SELECT r.*, u.name created_by_name FROM recurring_journals r LEFT JOIN users u ON u.id = r.created_by ORDER BY r.active DESC, r.next_date'))));
r.post('/finance/recurring', EDIT, ah(async (req, res) => res.json({ id: await L.saveRecurring(req.user, req.body || {}) })));
r.put('/finance/recurring/:id(\\d+)', EDIT, ah(async (req, res) => res.json({ id: await L.saveRecurring(req.user, req.body || {}, Number(req.params.id)) })));
r.post('/finance/recurring/run', EDIT, ah(async (req, res) => res.json({ made: await L.runRecurring(req.user) })));
// reports
const cc = q => Number(q.cost_centre_id) || null;
r.get('/finance/tb', VIEW, ah(async (req, res) => { const { from, to } = range(req.query); res.json(await L.trialBalance(from, to, cc(req.query))); }));
r.get('/finance/gl', VIEW, ah(async (req, res) => { const { from, to } = range(req.query); res.json(await L.generalLedger(from, to, { accounts: String(req.query.accounts || '').split(',').filter(Boolean), cc: cc(req.query) })); }));
r.get('/finance/income-statement', VIEW, ah(async (req, res) => { const { from, to } = range(req.query); res.json(await L.incomeStatement(from, to, { compare: req.query.compare || 'prior_year', cc: cc(req.query), budget_id: Number(req.query.budget_id) || null })); }));
r.get('/finance/income-monthly', VIEW, ah(async (req, res) => res.json(await L.monthlyIncome(Number(req.query.year_id), cc(req.query)))));
r.get('/finance/balance-sheet', VIEW, ah(async (req, res) => { const to = req.query.as_of || today(); res.json(await L.balanceSheet(to, req.query.compare_as_of || `${Number(to.slice(0, 4)) - 1}${to.slice(4)}`)); }));
r.get('/finance/cash-flow', VIEW, ah(async (req, res) => { const { from, to } = range(req.query); res.json(await L.cashFlow(from, to)); }));
r.get('/finance/ratios', VIEW, ah(async (req, res) => res.json(await L.ratios(req.query.as_of || today(), req.query.from))));
r.get('/finance/checklist', VIEW, ah(async (req, res) => res.json(await L.closeChecklist(req.query.month || today().slice(0, 7)))));
// budgets
r.get('/finance/budgets', VIEW, ah(async (req, res) => res.json(await L.budgets())));
r.get('/finance/budgets/:id(\\d+)', VIEW, ah(async (req, res) => res.json(await L.budget(Number(req.params.id)))));
r.post('/finance/budgets', EDIT, ah(async (req, res) => res.json({ id: await L.createBudget(req.user, req.body || {}) })));
r.put('/finance/budgets/:id(\\d+)/lines', EDIT, ah(async (req, res) => { await L.saveBudgetLines(req.user, Number(req.params.id), (req.body || {}).rows); res.json({ ok: true }); }));
r.post('/finance/budgets/:id(\\d+)/approve', gov.gate('budget', 'accounting'), ah(async (req, res) => res.json({ ok: true, ...(await L.approveBudget(req.user, Number(req.params.id), req.body || {})) })));

/* ---------------- audit ---------------- */
r.get('/audit/integrity', AUD, ah(async (req, res) => res.json(await A.integrity())));
r.post('/audit/seal', AUD, ah(async (req, res) => res.json(await A.seal({ all: !!(req.body || {}).all }))));
r.get('/audit/chain', AUD, ah(async (req, res) => res.json(await A.verifyChain())));
r.get('/audit/control-recon', AUD, ah(async (req, res) => res.json(await A.controlRecon(req.query.as_of))));
r.get('/audit/exceptions', AUD, ah(async (req, res) => { const { from, to } = range(req.query); res.json(await A.exceptions(from, to)); }));
r.get('/audit/benford', AUD, ah(async (req, res) => { const { from, to } = range(req.query); res.json(await A.benford(from, to, req.query.source)); }));
r.get('/audit/trail', AUD, ah(async (req, res) => res.json(await A.trail(req.query))));
r.get('/audit/pack', AUD, ah(async (req, res) => { const { from, to } = range(req.query); res.json(await A.pack(from, to)); }));
r.get('/audit/queries', ah(async (req, res) => res.json(await A.queries({ ...req.query, mine: req.user.permissions.includes('*') || req.user.permissions.includes('audit') ? null : req.user.id }))));
r.post('/audit/queries', AUD, ah(async (req, res) => res.json({ id: await A.raiseQuery(req.user, req.body || {}) })));
r.post('/audit/queries/:id(\\d+)/answer', ah(async (req, res) => {
  const q = await db.one('SELECT * FROM audit_queries WHERE id = ?', [req.params.id]); if (!q) throw bad('Not found');
  const p = req.user.permissions; if (!(p.includes('*') || p.includes('accounting') || q.assigned_to === req.user.id)) throw bad('This query is not assigned to you');
  await A.answerQuery(req.user, Number(req.params.id), req.body || {}); res.json({ ok: true });
}));
r.post('/audit/queries/:id(\\d+)/close', AUD, ah(async (req, res) => { await A.closeQuery(req.user, Number(req.params.id), req.body || {}); res.json({ ok: true }); }));

/* ---------------- internal audit ---------------- */
r.get('/ia/dashboard', IAP, ah(async (req, res) => res.json(await IA.dashboard(req.query.year))));
r.get('/ia/programmes', IAP, ah(async (req, res) => res.json(Object.entries(IA.PROGRAMMES).map(([key, p]) => ({ key, name: p.name, steps: p.steps.length })))));
r.get('/ia/universe', IAP, ah(async (req, res) => { await IA.seedUniverse(); res.json(await IA.universe()); }));
r.post('/ia/universe', IAP, ah(async (req, res) => res.json({ id: await IA.saveUniverse(req.body || {}) })));
r.put('/ia/universe/:id(\\d+)', IAP, ah(async (req, res) => res.json({ id: await IA.saveUniverse(req.body || {}, Number(req.params.id)) })));
r.get('/ia/engagements', IAP, ah(async (req, res) => res.json(await IA.engagements(req.query))));
r.get('/ia/engagements/:id(\\d+)', IAP, ah(async (req, res) => res.json(await IA.engagement(Number(req.params.id)))));
r.post('/ia/engagements', IAP, ah(async (req, res) => res.json({ id: await IA.saveEngagement(req.user, req.body || {}) })));
r.put('/ia/engagements/:id(\\d+)', IAP, ah(async (req, res) => res.json({ id: await IA.saveEngagement(req.user, req.body || {}, Number(req.params.id)) })));
r.post('/ia/engagements/:id(\\d+)/programme', IAP, ah(async (req, res) => res.json({ added: await IA.loadProgramme(Number(req.params.id), (req.body || {}).programme) })));
r.post('/ia/engagements/:id(\\d+)/advance', IAP, ah(async (req, res) => res.json(await IA.advance(req.user, Number(req.params.id), req.body || {}))));
r.get('/ia/engagements/:id(\\d+)/report', IAP, ah(async (req, res) => res.json(await IA.report(Number(req.params.id)))));
r.post('/ia/engagements/:id(\\d+)/steps', IAP, ah(async (req, res) => res.json({ id: await IA.saveStep(req.user, Number(req.params.id), req.body || {}) })));
r.put('/ia/engagements/:id(\\d+)/steps/:sid(\\d+)', IAP, ah(async (req, res) => res.json({ id: await IA.saveStep(req.user, Number(req.params.id), req.body || {}, Number(req.params.sid)) })));
r.post('/ia/steps/:sid(\\d+)/test', IAP, ah(async (req, res) => { const { from, to } = range(req.body || {}); res.json(await IA.runStepTest(req.user, Number(req.params.sid), from, to)); }));
r.post('/ia/engagements/:id(\\d+)/findings', IAP, ah(async (req, res) => res.json({ id: await IA.saveFinding(req.user, Number(req.params.id), req.body || {}) })));
r.put('/ia/engagements/:id(\\d+)/findings/:fid(\\d+)', IAP, ah(async (req, res) => res.json({ id: await IA.saveFinding(req.user, Number(req.params.id), req.body || {}, Number(req.params.fid)) })));
r.post('/ia/findings/:fid(\\d+)/actions', IAP, ah(async (req, res) => res.json({ id: await IA.saveAction(req.user, Number(req.params.fid), req.body || {}) })));
r.get('/ia/actions', ah(async (req, res) => res.json(await IA.actions({ mine: req.user.permissions.includes('*') || req.user.permissions.includes('internal_audit') ? (req.query.mine ? req.user.id : null) : req.user.id }))));
r.post('/ia/actions/:aid(\\d+)/update', ah(async (req, res) => { await IA.actionUpdate(req.user, Number(req.params.aid), req.body || {}); res.json({ ok: true }); }));

module.exports = r;
