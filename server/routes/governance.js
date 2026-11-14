// Governance (organogram, delegation of authority, approvals inbox, decision rights, communication), Policies and Legal.
const express = require('express');
const db = require('../db');
const { requirePerm } = require('../auth');
const { ah, bad } = require('../util');
const G = require('../services/governance');
const LG = require('../services/legal');

const r = express.Router();
const GOV = requirePerm('governance'), POL = requirePerm('governance|hrm'), LEG = requirePerm('legal'), LEGD = requirePerm('legal|hrm'), HIST = requirePerm('governance|audit|internal_audit');
const id = req => Number(req.params.id);

/* ---------------- organogram ---------------- */
r.get('/gov/meta', ah(async (req, res) => res.json({ doc_types: G.DOC_TYPES, styles: ['formal', 'consultative', 'collaborative', 'directive'], unit_kinds: ['board', 'executive', 'division', 'department', 'section', 'unit', 'committee'] })));
r.get('/gov/chart', ah(async (req, res) => res.json(await G.chart())));
r.get('/gov/units', ah(async (req, res) => res.json(await G.units())));
r.post('/gov/units', GOV, ah(async (req, res) => res.json({ id: await G.saveUnit(req.body || {}) })));
r.put('/gov/units/:id(\\d+)', GOV, ah(async (req, res) => res.json({ id: await G.saveUnit(req.body || {}, id(req)) })));
r.get('/gov/positions', ah(async (req, res) => res.json(await G.positions())));
r.post('/gov/positions', GOV, ah(async (req, res) => res.json({ id: await G.savePosition(req.user, req.body || {}) })));
r.put('/gov/positions/:id(\\d+)', GOV, ah(async (req, res) => res.json({ id: await G.savePosition(req.user, req.body || {}, id(req)) })));
r.post('/gov/seed', GOV, ah(async (req, res) => res.json(await G.seedStructure(req.user, (req.body || {}).kind === 'water' ? 'water' : 'standard'))));
r.get('/gov/people', GOV, ah(async (req, res) => res.json({
  users: await db.query('SELECT id, name, username, role FROM users WHERE active = 1 ORDER BY name'),
  employees: await db.query(`SELECT id, CONCAT(first_name, ' ', last_name) name, job_title, user_id FROM employees WHERE termination_date IS NULL OR termination_date > CURDATE() ORDER BY first_name`).catch(() => []),
  cost_centres: await db.query('SELECT id, code, name FROM cost_centres WHERE active = 1 ORDER BY code').catch(() => [])
})));

/* ---------------- delegation of authority ---------------- */
r.get('/gov/grants', ah(async (req, res) => res.json(await G.grants())));
r.put('/gov/grants', GOV, ah(async (req, res) => { await G.saveGrants(req.user, (req.body || {}).rows); res.json({ ok: true }); }));
r.post('/gov/simulate', ah(async (req, res) => { const b = req.body || {}; res.json(await G.simulate(b.doc_type, Number(b.amount) || 0, Number(b.user_id) || req.user.id)); }));
r.get('/gov/my-authority', ah(async (req, res) => res.json(await G.authorityOf(req.user.id))));

/* ---------------- approvals ---------------- */
r.get('/gov/inbox', ah(async (req, res) => res.json(await G.inbox(req.user))));
r.get('/gov/history', HIST, ah(async (req, res) => res.json(await G.history(req.query))));
r.get('/gov/status/:type/:id(\\d+)', ah(async (req, res) => res.json(await G.statusOf(req.params.type, id(req)))));
r.get('/gov/mine', ah(async (req, res) => {
  const rows = await db.query(`SELECT * FROM approval_requests WHERE requester_id = ? ORDER BY id DESC LIMIT 50`, [req.user.id]);
  for (const x of rows) { const s = await G.statusOf(x.doc_type, x.doc_id); x.waiting_for = s && s.id === x.id ? s.waiting_for : null; x.doc_name = (G.DOC_TYPES[x.doc_type] || {}).name; }
  res.json(rows);
}));
r.post('/gov/requests/:id(\\d+)/decide', ah(async (req, res) => res.json(await G.decide(req.user, id(req), req.body || {}))));

/* ---------------- decision rights & communication ---------------- */
r.get('/gov/decisions', ah(async (req, res) => res.json(await G.decisions())));
r.post('/gov/decisions', GOV, ah(async (req, res) => res.json({ id: await G.saveDecision(req.body || {}) })));
r.put('/gov/decisions/:id(\\d+)', GOV, ah(async (req, res) => res.json({ id: await G.saveDecision(req.body || {}, id(req)) })));
r.get('/gov/comms/:id(\\d+)', ah(async (req, res) => res.json(await G.commsFor(id(req)))));
r.get('/gov/me', ah(async (req, res) => {
  const ps = await G.positionsOf(req.user.id);
  res.json({ positions: await Promise.all(ps.map(p => G.commsFor(p.id))), authority: await G.authorityOf(req.user.id) });
}));

/* ---------------- policies ---------------- */
r.get('/policies', ah(async (req, res) => res.json(await LG.policies(req.user))));
r.get('/policies/templates', ah(async (req, res) => res.json(LG.policyTemplates())));
r.get('/policies/unread', ah(async (req, res) => res.json(await LG.unread(req.user))));
r.get('/policies/:id(\\d+)', ah(async (req, res) => res.json(await LG.getPolicy(id(req), req.user))));
r.post('/policies', POL, ah(async (req, res) => res.json({ id: await LG.createPolicy(req.user, req.body || {}) })));
r.post('/policies/seed', POL, ah(async (req, res) => {
  // adopt a starter set: every template in the chosen departments
  const deps = (req.body || {}).departments || [];
  if ((await db.one('SELECT COUNT(*) n FROM policies')).n > 0 && !(req.body || {}).add) throw bad('Policies already exist');
  let n = 0; for (const d of LG.policyTemplates().filter(x => !deps.length || deps.includes(x.key))) for (const t of d.items) { await LG.createPolicy(req.user, { template_key: t.key }); n++; }
  res.json({ created: n });
}));
r.put('/policies/:id(\\d+)', POL, ah(async (req, res) => { await LG.saveDraft(req.user, id(req), req.body || {}); res.json({ ok: true }); }));
r.post('/policies/:id(\\d+)/submit', POL, ah(async (req, res) => res.json(await LG.submitPolicy(req.user, id(req)))));
r.post('/policies/:id(\\d+)/approve', ah(async (req, res) => res.json(await LG.approvePolicy(req.user, id(req), req.body || {}))));
r.post('/policies/:id(\\d+)/retire', GOV, ah(async (req, res) => { await LG.retirePolicy(req.user, id(req)); res.json({ ok: true }); }));
r.post('/policies/:id(\\d+)/ack', ah(async (req, res) => { await LG.ack(req.user, id(req)); res.json({ ok: true }); }));

/* ---------------- legal ---------------- */
r.get('/legal/templates', LEGD, ah(async (req, res) => res.json(LG.legalTemplates())));
r.get('/legal/sources', LEGD, ah(async (req, res) => {
  const q = `%${String(req.query.q || '').slice(0, 60)}%`;
  const S = {
    partner: () => db.query('SELECT id, name, COALESCE(phone, \'\') extra FROM partners WHERE active = 1 AND name LIKE ? ORDER BY name LIMIT 50', [q]),
    employee: () => db.query(`SELECT id, CONCAT(first_name, ' ', last_name) name, COALESCE(job_title, '') extra FROM employees WHERE CONCAT(first_name, ' ', last_name) LIKE ? ORDER BY first_name LIMIT 50`, [q]),
    tender: () => db.query(`SELECT id, CONCAT(number, ' ', title) name, status extra FROM tenders WHERE status IN ('recommended','awarded','approved') AND (title LIKE ? OR number LIKE ?) ORDER BY id DESC LIMIT 50`, [q, q]),
    water_account: () => db.query(`SELECT a.id, CONCAT(a.account_no, ' ', p.name) name, COALESCE(a.address, '') extra FROM water_accounts a JOIN partners p ON p.id = a.partner_id WHERE a.account_no LIKE ? OR p.name LIKE ? ORDER BY a.id DESC LIMIT 50`, [q, q])
  };
  if (!S[req.query.source]) return res.json([]);
  res.json(await S[req.query.source]().catch(() => []));
}));
r.get('/legal/documents', LEGD, ah(async (req, res) => res.json(await LG.documents(req.query))));
r.get('/legal/documents/:id(\\d+)', LEGD, ah(async (req, res) => res.json(await LG.getDocument(id(req)))));
r.post('/legal/documents', LEGD, ah(async (req, res) => res.json({ id: await LG.draft(req.user, req.body || {}) })));
r.put('/legal/documents/:id(\\d+)', LEGD, ah(async (req, res) => { await LG.saveDocument(req.user, id(req), req.body || {}); res.json({ ok: true }); }));
r.post('/legal/documents/:id(\\d+)/copy', LEGD, ah(async (req, res) => res.json({ id: await LG.copyDocument(req.user, id(req)) })));
// approving is open to anyone the delegation of authority names (checked in the service); the other actions need the legal permission
r.post('/legal/documents/:id(\\d+)/:action(submit|approve|reject|sign|terminate|renew)', (req, res, next) => ['approve', 'reject'].includes(req.params.action) ? next() : LEGD(req, res, next),
  ah(async (req, res) => res.json(await LG.docAction(req.user, id(req), req.params.action, req.body || {}))));
r.get('/legal/obligations', LEGD, ah(async (req, res) => res.json(await LG.obligations())));
r.post('/legal/obligations', LEG, ah(async (req, res) => res.json({ id: await LG.saveObligation(req.body || {}) })));
r.put('/legal/obligations/:id(\\d+)', LEG, ah(async (req, res) => res.json({ id: await LG.saveObligation(req.body || {}, id(req)) })));
r.post('/legal/obligations/:id(\\d+)/done', LEG, ah(async (req, res) => res.json(await LG.obligationDone(id(req), (req.body || {}).date))));
r.post('/legal/obligations/seed', LEG, ah(async (req, res) => res.json({ created: await LG.seedObligations() })));
r.get('/legal/alerts', LEGD, ah(async (req, res) => res.json(await LG.alerts())));

module.exports = r;
