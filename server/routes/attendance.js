// Attendance: staff clock in / out with their PIN at the till; hours, overtime and payroll link
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requirePerm } = require('../auth');
const { HttpError } = require('../util');
const { ah, bad, notFound, round2, today } = require('../util');

const pub = express.Router();
const r = express.Router();

// Lesotho Labour Code: 45 normal hours a week; overtime paid at 1.25 × the normal hourly rate (check your sector's wage order)
const DEFAULTS = { weekly_hours: 45, daily_hours: 9, overtime_rate: 1.25, max_shift_hours: 16 };
async function settings() { return { ...DEFAULTS, ...((await db.getSetting('attendance', {})) || {}) }; }

const fmt = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const hoursBetween = (a, b) => Math.max(0, (new Date(String(b).replace(' ', 'T')) - new Date(String(a).replace(' ', 'T'))) / 3600000);

async function openShift(userId) {
  return db.one('SELECT * FROM attendance WHERE user_id = ? AND check_out IS NULL ORDER BY id DESC LIMIT 1', [userId]);
}
async function toggle(user, source = 'pin') {
  const s = await settings();
  const open = await openShift(user.id);
  const now = fmt(new Date());
  if (open) {
    // a forgotten clock-out from an earlier day is closed at the maximum shift length and flagged
    const h = hoursBetween(open.check_in, now);
    if (h > s.max_shift_hours) {
      const capped = fmt(new Date(new Date(String(open.check_in).replace(' ', 'T')).getTime() + s.max_shift_hours * 3600000));
      await db.query(`UPDATE attendance SET check_out = ?, note = CONCAT(COALESCE(note,''), 'No clock-out – closed automatically, please correct') WHERE id = ?`, [capped, open.id]);
      await db.query('INSERT INTO attendance (user_id, check_in, source) VALUES (?, ?, ?)', [user.id, now, source]);
      return { status: 'in', at: now, name: user.name, warning: 'Your previous shift had no clock-out. A manager should correct it.' };
    }
    await db.query('UPDATE attendance SET check_out = ? WHERE id = ?', [now, open.id]);
    return { status: 'out', at: now, name: user.name, hours: round2(h) };
  }
  await db.query('INSERT INTO attendance (user_id, check_in, source) VALUES (?, ?, ?)', [user.id, now, source]);
  return { status: 'in', at: now, name: user.name };
}

// public: clock in/out from the login screen with a PIN (no session needed)
pub.post('/attendance/clock', ah(async (req, res) => {
  if (!db.isConnected()) throw new HttpError(503, 'Database not configured');
  const u = await db.one('SELECT * FROM users WHERE id = ? AND active = 1', [req.body.user_id]);
  if (!u || !u.pin_hash || !bcrypt.compareSync(String(req.body.pin || ''), u.pin_hash)) throw new HttpError(401, 'Wrong PIN');
  res.json(await toggle(u));
}));

r.get('/attendance/me', ah(async (req, res) => {
  const open = await openShift(req.user.id);
  res.json({ clocked_in: !!open, since: open ? open.check_in : null });
}));
r.post('/attendance/me', ah(async (req, res) => res.json(await toggle(req.user, 'pin'))));
r.get('/attendance/settings', requirePerm('attendance'), ah(async (req, res) => res.json(await settings())));
r.put('/attendance/settings', requirePerm('settings'), ah(async (req, res) => {
  const v = {};
  for (const k of Object.keys(DEFAULTS)) v[k] = Number(req.body[k] ?? DEFAULTS[k]);
  if (!(v.weekly_hours > 0 && v.daily_hours > 0 && v.overtime_rate >= 1)) throw bad('Check the hours and overtime rate');
  await db.setSetting('attendance', v); res.json(v);
}));

/** hours per person per day/week with overtime: hours above the daily limit, or above the weekly limit, whichever is more */
async function report(from, to, userId) {
  const s = await settings();
  const rows = await db.query(`SELECT a.*, u.name user_name, u.role FROM attendance a JOIN users u ON u.id = a.user_id
    WHERE a.check_in BETWEEN ? AND ? ${userId ? 'AND a.user_id = ?' : ''} ORDER BY u.name, a.check_in`, [from + ' 00:00:00', to + ' 23:59:59', ...(userId ? [userId] : [])]);
  const now = fmt(new Date());
  const people = new Map();
  for (const a of rows) {
    const h = hoursBetween(a.check_in, a.check_out || now);
    a.hours = round2(h); a.open = !a.check_out;
    const p = people.get(a.user_id) || { user_id: a.user_id, name: a.user_name, role: a.role, days: new Map(), entries: [] };
    p.entries.push(a);
    const day = String(a.check_in).slice(0, 10);
    p.days.set(day, (p.days.get(day) || 0) + h);
    people.set(a.user_id, p);
  }
  const weekKey = day => { const d = new Date(day + 'T12:00:00'); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return d.toISOString().slice(0, 10); };
  const out = [];
  for (const p of people.values()) {
    let total = 0, dailyOt = 0; const weeks = new Map();
    for (const [day, h] of p.days) { total += h; dailyOt += Math.max(0, h - s.daily_hours); weeks.set(weekKey(day), (weeks.get(weekKey(day)) || 0) + h); }
    let weeklyOt = 0; for (const h of weeks.values()) weeklyOt += Math.max(0, h - s.weekly_hours);
    const ot = Math.max(dailyOt, weeklyOt);
    const emp = await db.one(`SELECT id, basic_salary, CONCAT(first_name, ' ', last_name) name FROM employees WHERE user_id = ? AND status = 'active'`, [p.user_id]).catch(() => null);
    const hourly = emp && Number(emp.basic_salary) ? Number(emp.basic_salary) * 12 / 52 / s.weekly_hours : null;
    out.push({ user_id: p.user_id, name: p.name, role: p.role, days_worked: p.days.size, hours: round2(total), overtime_hours: round2(ot), regular_hours: round2(total - ot),
      employee_id: emp ? emp.id : null, hourly_rate: hourly ? round2(hourly) : null, overtime_pay: hourly ? round2(ot * hourly * s.overtime_rate) : null,
      open_shift: p.entries.some(e => e.open), flagged: p.entries.filter(e => /No clock-out/.test(e.note || '')).length,
      daily: [...p.days].map(([day, h]) => ({ day, hours: round2(h) })), entries: p.entries });
  }
  return { from, to, settings: s, people: out };
}

r.get('/attendance', requirePerm('attendance'), ah(async (req, res) => {
  const to = req.query.to || today(); const from = req.query.from || to;
  res.json(await report(from, to, req.query.user_id));
}));
r.post('/attendance', requirePerm('attendance'), ah(async (req, res) => {
  const b = req.body;
  if (!b.user_id || !b.check_in) throw bad('Choose the person and the clock-in time');
  if (b.check_out && b.check_out <= b.check_in) throw bad('Clock-out must be after clock-in');
  const ins = await db.query(`INSERT INTO attendance (user_id, check_in, check_out, source, note, edited_by) VALUES (?, ?, ?, 'manual', ?, ?)`,
    [b.user_id, String(b.check_in).replace('T', ' '), b.check_out ? String(b.check_out).replace('T', ' ') : null, b.note || 'Added by manager', req.user.id]);
  res.json({ id: ins.insertId });
}));
r.put('/attendance/:id', requirePerm('attendance'), ah(async (req, res) => {
  const b = req.body;
  const a = await db.one('SELECT * FROM attendance WHERE id = ?', [req.params.id]);
  if (!a) throw notFound();
  const ci = String(b.check_in || a.check_in).replace('T', ' '), co = b.check_out ? String(b.check_out).replace('T', ' ') : null;
  if (co && co <= ci) throw bad('Clock-out must be after clock-in');
  await db.query('UPDATE attendance SET check_in = ?, check_out = ?, note = ?, edited_by = ? WHERE id = ?', [ci, co, b.note || `Corrected by ${req.user.name}`, req.user.id, a.id]);
  res.json({ ok: true });
}));
r.delete('/attendance/:id', requirePerm('attendance'), ah(async (req, res) => { await db.query('DELETE FROM attendance WHERE id = ?', [req.params.id]); res.json({ ok: true }); }));
r.get('/attendance/now', requirePerm('attendance'), ah(async (req, res) => {
  res.json(await db.query(`SELECT a.*, u.name user_name, u.role FROM attendance a JOIN users u ON u.id = a.user_id WHERE a.check_out IS NULL ORDER BY a.check_in`));
}));

// add overtime for the period to a draft payroll run as once-off earnings
r.post('/attendance/to-payroll', requirePerm('payroll'), ah(async (req, res) => {
  const run = await db.one('SELECT * FROM payroll_runs WHERE id = ?', [req.body.run_id]);
  if (!run || run.status !== 'draft') throw bad('Choose a draft payroll run');
  const rep = await report(req.body.from, req.body.to);
  let added = 0;
  for (const p of rep.people) {
    if (!p.employee_id || !(p.overtime_pay > 0)) continue;
    await db.query(`INSERT INTO payslip_adjustments (run_id, employee_id, kind, name, amount, taxable) VALUES (?, ?, 'earning', ?, ?, 1)`,
      [run.id, p.employee_id, `Overtime ${p.overtime_hours} h (${req.body.from} – ${req.body.to})`, p.overtime_pay]);
    added++;
  }
  await require('../services/payroll').recalc(run.id);
  res.json({ added });
}));

module.exports = { pub, router: r, report };
