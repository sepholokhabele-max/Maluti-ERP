// Recruitment & appraisals. Job openings with an advert, applicants moving new → screening → interview → offer → hired
// (or rejected / withdrawn), interview invitations and regrets by SMS, hiring straight into HR as an employee; and staff
// appraisals scored on weighted criteria with strengths, improvements, goals and an optional salary increase.
const express = require('express');
const db = require('../db');
const sms = require('../services/sms');
const { requirePerm } = require('../auth');
const { ah, bad, notFound, round2, today } = require('../util');

const r = express.Router();
const H = requirePerm('hrm');
const s = (x, n) => x === undefined || x === null || String(x).trim() === '' ? null : String(x).trim().slice(0, n);
const d10 = x => x ? String(x).slice(0, 10) : null;
const STAGES = ['new', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn'];
const DEFAULT_CRITERIA = [['Quality of work', 2], ['Attendance & punctuality', 1], ['Customer service', 1], ['Teamwork', 1], ['Following procedures & safety', 1], ['Initiative', 1]];

/* ---------- openings ---------- */
const OSQL = `SELECT o.*, d.name department_name,
    (SELECT COUNT(*) FROM applicants a WHERE a.opening_id = o.id) applicants,
    (SELECT COUNT(*) FROM applicants a WHERE a.opening_id = o.id AND a.stage IN ('new','screening','interview','offer')) active,
    (SELECT COUNT(*) FROM applicants a WHERE a.opening_id = o.id AND a.stage = 'hired') hired
  FROM job_openings o LEFT JOIN departments d ON d.id = o.department_id`;
r.get('/recruitment/openings', H, ah(async (req, res) => res.json(await db.query(`${OSQL} ${req.query.all ? '' : `WHERE o.status IN ('draft','open') OR o.created_at >= DATE_SUB(CURDATE(), INTERVAL 1 YEAR)`} ORDER BY FIELD(o.status, 'open', 'draft', 'filled', 'closed'), o.id DESC`))));
function cleanOpening(b) {
  const v = { title: s(b.title, 120) }; if (!v.title) throw bad('Enter the job title, e.g. "Cashier", "Security guard", "Bookkeeper"');
  v.department_id = Number(b.department_id) || null; v.location = s(b.location, 120);
  v.employment_type = ['permanent', 'fixed_term', 'casual', 'intern'].includes(b.employment_type) ? b.employment_type : 'permanent';
  v.positions = Math.max(1, Math.round(Number(b.positions) || 1));
  v.salary_from = Number(b.salary_from) > 0 ? round2(b.salary_from) : null; v.salary_to = Number(b.salary_to) > 0 ? round2(b.salary_to) : null;
  if (v.salary_from && v.salary_to && v.salary_to < v.salary_from) throw bad('The top of the salary range is below the bottom');
  v.description = s(b.description, 6000); v.requirements = s(b.requirements, 6000); v.how_to_apply = s(b.how_to_apply, 255); v.closing_date = d10(b.closing_date);
  if (b.status && ['draft', 'open', 'closed', 'filled'].includes(b.status)) v.status = b.status;
  return v;
}
r.post('/recruitment/openings', H, ah(async (req, res) => res.json({ id: (await db.query('INSERT INTO job_openings SET ?', [{ ...cleanOpening(req.body), user_id: req.user.id }])).insertId })));
r.put('/recruitment/openings/:id(\\d+)', H, ah(async (req, res) => {
  const o = await db.one('SELECT * FROM job_openings WHERE id = ?', [req.params.id]); if (!o) throw notFound();
  await db.query('UPDATE job_openings SET ? WHERE id = ?', [cleanOpening({ ...o, ...req.body }), o.id]); res.json({ id: o.id });
}));
r.get('/recruitment/openings/:id(\\d+)', H, ah(async (req, res) => {
  const o = await db.one(`${OSQL} WHERE o.id = ?`, [req.params.id]); if (!o) throw notFound();
  o.applicants_list = await db.query(`SELECT a.*, (SELECT COUNT(*) FROM attachments f WHERE f.entity = 'applicant' AND f.entity_id = a.id) files FROM applicants a WHERE a.opening_id = ? ORDER BY FIELD(a.stage, 'offer', 'interview', 'screening', 'new', 'hired', 'rejected', 'withdrawn'), a.rating DESC, a.id`, [o.id]);
  res.json(o);
}));

/* ---------- applicants ---------- */
function cleanApplicant(b) {
  const v = { first_name: s(b.first_name, 80) }; if (!v.first_name) throw bad('Enter the applicant\'s name');
  v.last_name = s(b.last_name, 80); v.phone = s(b.phone, 40); v.email = s(b.email, 120); v.id_number = s(b.id_number, 40);
  v.source = ['walk_in', 'referral', 'facebook', 'newspaper', 'radio', 'website', 'whatsapp', 'other'].includes(b.source) ? b.source : 'walk_in';
  v.rating = b.rating === '' || b.rating == null ? null : Math.max(0, Math.min(5, Math.round(Number(b.rating))));
  v.interview_at = b.interview_at ? String(b.interview_at).replace('T', ' ').slice(0, 16) : null; v.interviewer = s(b.interviewer, 120);
  v.salary_offered = Number(b.salary_offered) > 0 ? round2(b.salary_offered) : null; v.start_date = d10(b.start_date);
  v.notes = s(b.notes, 6000); v.reject_reason = s(b.reject_reason, 160);
  return v;
}
r.post('/recruitment/applicants', H, ah(async (req, res) => {
  const o = await db.one('SELECT * FROM job_openings WHERE id = ?', [req.body.opening_id]); if (!o) throw bad('Choose the job');
  const v = cleanApplicant(req.body);
  if (v.phone && await db.one(`SELECT id FROM applicants WHERE opening_id = ? AND phone = ?`, [o.id, v.phone])) throw bad(`Someone with phone ${v.phone} has already applied for this job`);
  res.json({ id: (await db.query('INSERT INTO applicants SET ?', [{ ...v, opening_id: o.id }])).insertId });
}));
const ASQL = `SELECT a.*, o.title job_title, o.department_id, o.employment_type, o.status opening_status, e.code employee_code FROM applicants a JOIN job_openings o ON o.id = a.opening_id LEFT JOIN employees e ON e.id = a.employee_id`;
r.get('/recruitment/applicants/:id(\\d+)', H, ah(async (req, res) => { const a = await db.one(`${ASQL} WHERE a.id = ?`, [req.params.id]); if (!a) throw notFound(); res.json(a); }));
r.put('/recruitment/applicants/:id(\\d+)', H, ah(async (req, res) => {
  const a = await db.one('SELECT * FROM applicants WHERE id = ?', [req.params.id]); if (!a) throw notFound();
  await db.query('UPDATE applicants SET ?, updated_at = NOW() WHERE id = ?', [cleanApplicant({ ...a, ...req.body }), a.id]);
  res.json(await db.one(`${ASQL} WHERE a.id = ?`, [a.id]));
}));
/** move to another stage; interview / offer / regret can SMS the applicant */
r.post('/recruitment/applicants/:id(\\d+)/stage', H, ah(async (req, res) => {
  const a = await db.one(`${ASQL} WHERE a.id = ?`, [req.params.id]); if (!a) throw notFound();
  const stage = req.body.stage; if (!STAGES.includes(stage) || stage === 'hired') throw bad('Choose the stage (use Hire to employ someone)');
  if (a.stage === 'hired') throw bad('This person is already hired');
  const sets = { stage };
  if (stage === 'interview') { if (!req.body.interview_at) throw bad('Enter the interview date and time'); sets.interview_at = String(req.body.interview_at).replace('T', ' ').slice(0, 16); sets.interviewer = s(req.body.interviewer, 120) || a.interviewer; }
  if (stage === 'offer') { sets.salary_offered = Number(req.body.salary_offered) > 0 ? round2(req.body.salary_offered) : a.salary_offered; sets.start_date = d10(req.body.start_date) || a.start_date; }
  if (stage === 'rejected') sets.reject_reason = s(req.body.reject_reason, 160);
  await db.query('UPDATE applicants SET ?, updated_at = NOW() WHERE id = ?', [sets, a.id]);
  let sent = null;
  if (req.body.notify && a.phone) {
    const c = (await db.getSetting('company', {})) || {};
    const when = sets.interview_at ? new Date(sets.interview_at.replace(' ', 'T')).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    const text = req.body.message || ({
      interview: `Dear ${a.first_name}, ${c.name || 'we'} invite you for an interview for ${a.job_title} on ${when}${c.address ? ' at ' + c.address : ''}. Please bring your ID and certificates. Queries: ${c.phone || ''}`,
      offer: `Dear ${a.first_name}, we are happy to offer you the position of ${a.job_title} at ${c.name || 'our company'}. Please contact us on ${c.phone || ''} to accept.`,
      rejected: `Dear ${a.first_name}, thank you for applying for ${a.job_title} at ${c.name || 'our company'}. Unfortunately you were not successful this time. We wish you well.`
    })[stage];
    if (text) sent = await sms.send(a.phone, text).then(() => 'sent').catch(e => `not sent: ${e.message}`);
  }
  res.json({ applicant: await db.one(`${ASQL} WHERE a.id = ?`, [a.id]), sms: sent });
}));
/** hire: the applicant becomes an employee in HR; the job is marked filled when all positions are taken */
r.post('/recruitment/applicants/:id(\\d+)/hire', H, ah(async (req, res) => {
  const out = await db.tx(async c => {
    const a = await c.one(`${ASQL} WHERE a.id = ? FOR UPDATE`, [req.params.id]); if (!a) throw notFound();
    if (a.stage === 'hired') throw bad('Already hired');
    const salary = Number(req.body.basic_salary || a.salary_offered); if (!(salary > 0)) throw bad('Enter the basic salary');
    const start = d10(req.body.hire_date) || a.start_date || today();
    if (!a.last_name && !req.body.last_name) throw bad('Enter the surname before hiring (it is needed for payroll)');
    const ins = await c.query('INSERT INTO employees SET ?', [{ first_name: a.first_name, last_name: a.last_name || req.body.last_name, id_number: a.id_number, phone: a.phone, email: a.email,
      job_title: a.job_title, department_id: a.department_id, employment_type: a.employment_type, hire_date: start, basic_salary: round2(salary), status: 'active', paye_applies: 1, pay_method: 'bank', notes: `Hired through recruitment (${a.job_title})` }]);
    await c.query(`UPDATE employees SET code = ? WHERE id = ? AND code IS NULL`, [`EMP${String(ins.insertId).padStart(4, '0')}`, ins.insertId]);
    await c.query(`UPDATE applicants SET stage = 'hired', employee_id = ?, salary_offered = ?, start_date = ?, updated_at = NOW() WHERE id = ?`, [ins.insertId, round2(salary), start, a.id]);
    // CV and documents follow the person into their HR file
    await c.query(`INSERT INTO attachments (entity, entity_id, filename, mime, size, data, note, user_id) SELECT 'employee', ?, filename, mime, size, data, note, user_id FROM attachments WHERE entity = 'applicant' AND entity_id = ?`, [ins.insertId, a.id]).catch(() => {});
    const o = await c.one(`SELECT positions, (SELECT COUNT(*) FROM applicants WHERE opening_id = ? AND stage = 'hired') hired FROM job_openings WHERE id = ?`, [a.opening_id, a.opening_id]);
    if (Number(o.hired) >= Number(o.positions)) await c.query(`UPDATE job_openings SET status = 'filled' WHERE id = ?`, [a.opening_id]);
    return { employee_id: ins.insertId, filled: Number(o.hired) >= Number(o.positions) };
  });
  res.json(out);
}));
r.get('/recruitment/stats', H, ah(async (req, res) => {
  const x = await db.one(`SELECT (SELECT COUNT(*) FROM job_openings WHERE status = 'open') open_jobs, SUM(stage IN ('new','screening')) to_screen, SUM(stage = 'interview') interviews,
      SUM(stage = 'interview' AND interview_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 7 DAY)) interviews_week, SUM(stage = 'offer') offers,
      SUM(stage = 'hired' AND updated_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)) hired_90 FROM applicants`);
  const by = await db.query(`SELECT source, COUNT(*) n, SUM(stage = 'hired') hired FROM applicants GROUP BY source ORDER BY n DESC`);
  res.json({ ...Object.fromEntries(Object.entries(x).map(([k, v]) => [k, Number(v || 0)])), by_source: by.map(b => ({ ...b, n: Number(b.n), hired: Number(b.hired || 0) })) });
}));

/* ---------- appraisals ---------- */
r.get('/appraisals/settings', H, ah(async (req, res) => res.json({ criteria: ((await db.getSetting('appraisals', {})) || {}).criteria || DEFAULT_CRITERIA.map(([name, weight]) => ({ name, weight })) })));
r.put('/appraisals/settings', requirePerm('settings'), ah(async (req, res) => {
  const cr = (req.body.criteria || []).map(c => ({ name: s(c.name, 80), weight: Math.max(0.5, Math.min(5, Number(c.weight) || 1)) })).filter(c => c.name);
  if (!cr.length) throw bad('Keep at least one thing to score');
  await db.setSetting('appraisals', { criteria: cr }); res.json({ criteria: cr });
}));
const PSQL = `SELECT p.*, CONCAT(e.first_name, ' ', e.last_name) employee_name, e.job_title, e.basic_salary, d.name department_name, u.name reviewer_name
  FROM appraisals p JOIN employees e ON e.id = p.employee_id LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN users u ON u.id = p.reviewer_id`;
r.get('/appraisals', H, ah(async (req, res) => {
  const cond = [], args = [];
  if (req.query.period) { cond.push('p.period = ?'); args.push(req.query.period); }
  if (req.query.employee_id) { cond.push('p.employee_id = ?'); args.push(req.query.employee_id); }
  res.json(await db.query(`${PSQL} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY p.review_date DESC, p.id DESC LIMIT 1000`, args));
}));
async function getAppraisal(id) {
  const p = await db.one(`${PSQL} WHERE p.id = ?`, [id]); if (!p) throw notFound();
  p.scores = await db.query('SELECT * FROM appraisal_scores WHERE appraisal_id = ? ORDER BY id', [p.id]);
  p.previous = await db.query('SELECT id, period, overall, review_date FROM appraisals WHERE employee_id = ? AND id <> ? ORDER BY review_date DESC LIMIT 5', [p.employee_id, p.id]);
  return p;
}
r.get('/appraisals/:id(\\d+)', H, ah(async (req, res) => res.json(await getAppraisal(req.params.id))));
// a new appraisal starts from the current list of criteria
r.post('/appraisals', H, ah(async (req, res) => {
  const e = await db.one(`SELECT * FROM employees WHERE id = ? AND status = 'active'`, [req.body.employee_id]); if (!e) throw bad('Choose an active employee');
  const period = s(req.body.period, 40) || String(new Date().getFullYear());
  if (await db.one('SELECT id FROM appraisals WHERE employee_id = ? AND period = ?', [e.id, period])) throw bad(`${e.first_name} already has an appraisal for ${period}`);
  const cr = ((await db.getSetting('appraisals', {})) || {}).criteria || DEFAULT_CRITERIA.map(([name, weight]) => ({ name, weight }));
  const id = await db.tx(async c => {
    const ins = await c.query('INSERT INTO appraisals (employee_id, period, review_date, reviewer_id) VALUES (?, ?, ?, ?)', [e.id, period, d10(req.body.review_date) || today(), req.user.id]);
    for (const x of cr) await c.query('INSERT INTO appraisal_scores (appraisal_id, criterion, weight) VALUES (?, ?, ?)', [ins.insertId, x.name, x.weight]);
    return ins.insertId;
  });
  res.json(await getAppraisal(id));
}));
r.put('/appraisals/:id(\\d+)', H, ah(async (req, res) => {
  const p = await db.one('SELECT * FROM appraisals WHERE id = ?', [req.params.id]); if (!p) throw notFound();
  if (p.status === 'closed') throw bad('This appraisal is closed');
  const b = req.body;
  await db.tx(async c => {
    for (const x of b.scores || []) {
      const sc = x.score === '' || x.score == null ? null : Math.max(1, Math.min(5, Math.round(Number(x.score))));
      await c.query('UPDATE appraisal_scores SET score = ?, comment = ? WHERE id = ? AND appraisal_id = ?', [sc, s(x.comment, 255), Number(x.id), p.id]);
    }
    const sc = await c.query('SELECT weight, score FROM appraisal_scores WHERE appraisal_id = ? AND score IS NOT NULL', [p.id]);
    const w = sc.reduce((t, x) => t + Number(x.weight), 0);
    const overall = w ? Math.round(sc.reduce((t, x) => t + Number(x.weight) * x.score, 0) / w * 100) / 100 : null;
    const sets = { overall };
    for (const k of ['strengths', 'improvements', 'goals', 'employee_comment']) if (b[k] !== undefined) sets[k] = s(b[k], 6000);
    if (b.increase_pct !== undefined) sets.increase_pct = b.increase_pct === '' || b.increase_pct == null ? null : Math.max(0, Math.min(100, Number(b.increase_pct)));
    if (b.review_date) sets.review_date = d10(b.review_date);
    if (b.status && ['draft', 'discussed'].includes(b.status)) sets.status = b.status;
    await c.query('UPDATE appraisals SET ? WHERE id = ?', [sets, p.id]);
  });
  res.json(await getAppraisal(p.id));
}));
// close: scores are final; an agreed increase is put on the employee's basic salary from the next payroll
r.post('/appraisals/:id(\\d+)/close', H, ah(async (req, res) => {
  const out = await db.tx(async c => {
    const p = await c.one('SELECT * FROM appraisals WHERE id = ? FOR UPDATE', [req.params.id]); if (!p) throw notFound();
    if (p.status === 'closed') throw bad('Already closed');
    const open = Number((await c.one('SELECT COUNT(*) n FROM appraisal_scores WHERE appraisal_id = ? AND score IS NULL', [p.id])).n);
    if (open) throw bad(`Score all ${open} remaining item(s) first`);
    let newSalary = null;
    if (req.body.apply_increase && Number(p.increase_pct) > 0) {
      const e = await c.one('SELECT basic_salary FROM employees WHERE id = ? FOR UPDATE', [p.employee_id]);
      newSalary = round2(Number(e.basic_salary) * (1 + Number(p.increase_pct) / 100));
      await c.query('UPDATE employees SET basic_salary = ? WHERE id = ?', [newSalary, p.employee_id]);
    }
    await c.query(`UPDATE appraisals SET status = 'closed', increase_applied = ? WHERE id = ?`, [newSalary ? 1 : 0, p.id]);
    return { new_salary: newSalary };
  });
  res.json({ ...out, appraisal: await getAppraisal(req.params.id) });
}));
r.get('/appraisals/summary', H, ah(async (req, res) => {
  const period = req.query.period || String(new Date().getFullYear());
  const rows = await db.query(`SELECT e.id employee_id, CONCAT(e.first_name, ' ', e.last_name) name, e.job_title, d.name department_name, p.id appraisal_id, p.status, p.overall
    FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN appraisals p ON p.employee_id = e.id AND p.period = ? WHERE e.status = 'active' ORDER BY d.name, e.first_name`, [period]);
  res.json({ period, rows, done: rows.filter(x => x.status === 'closed').length, total: rows.length });
}));

module.exports = r;
