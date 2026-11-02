const nodemailer = require('nodemailer');
const cron = require('node-cron');
const db = require('../db');
const reports = require('./reports');
const { today } = require('../util');

const DEFAULT_EMAIL = {
  smtp_host: '', smtp_port: 587, smtp_secure: false, smtp_user: '', smtp_pass: '',
  from_address: '', recipients: [], eod_enabled: false, eod_time: '21:00', send_on_session_close: false,
  attach_csv: true
};

async function getEmailSettings() {
  return { ...DEFAULT_EMAIL, ...((await db.getSetting('email', {})) || {}) };
}

async function transport(s) {
  if (!s.smtp_host) throw Object.assign(new Error('SMTP server is not configured (Settings → Email)'), { status: 400 });
  return nodemailer.createTransport({
    host: s.smtp_host, port: Number(s.smtp_port) || 587, secure: !!s.smtp_secure,
    auth: s.smtp_user ? { user: s.smtp_user, pass: s.smtp_pass } : undefined
  });
}

async function log(kind, date, recipients, subject, status, error) {
  await db.query('INSERT INTO email_log (kind, report_date, recipients, subject, status, error) VALUES (?, ?, ?, ?, ?, ?)',
    [kind, date, recipients.join(', '), subject, status, error || null]);
}

/** Send the EOD report for a date. Returns { sent, recipients }. */
async function sendEod(date = today(), { recipients, kind = 'eod' } = {}) {
  const s = await getEmailSettings();
  const to = (recipients && recipients.length ? recipients : s.recipients).filter(Boolean);
  if (!to.length) throw Object.assign(new Error('No report recipients configured (Settings → Email)'), { status: 400 });
  const lg = await require('./logo').binary();
  const { html, data, company } = await reports.eodHtml(date, { logo: lg ? 'cid:company-logo' : null });
  const subject = `${company.name || 'Maluti ERP'} – End of Day Report ${date}`;
  try {
    const t = await transport(s);
    await t.sendMail({
      from: s.from_address || s.smtp_user, to: to.join(', '), subject, html,
      attachments: [
        ...(s.attach_csv ? [{ filename: `eod-${date}.csv`, content: reports.toCsv(data) }] : []),
        ...(lg ? [{ filename: lg.mime === 'image/png' ? 'logo.png' : 'logo.jpg', content: lg.buffer, cid: 'company-logo' }] : [])
      ]
    });
    await log(kind, date, to, subject, 'sent');
    return { sent: true, recipients: to };
  } catch (e) {
    await log(kind, date, to, subject, 'failed', e.message);
    throw Object.assign(new Error(`Email failed: ${e.message}`), { status: 502 });
  }
}

let job = null;

/** (Re)schedule the automatic daily report. Safe to run on several PCs sharing one DB. */
async function schedule() {
  if (job) { job.stop(); job = null; }
  if (!db.isConnected()) return;
  const s = await getEmailSettings();
  if (!s.eod_enabled) return;
  const [hh, mm] = String(s.eod_time || '21:00').split(':').map(Number);
  job = cron.schedule(`${mm || 0} ${hh || 21} * * *`, async () => {
    const date = today();
    // Claim the run atomically so only one machine sends it
    await db.query(`INSERT IGNORE INTO settings (k, v) VALUES ('eod_last_sent', JSON_QUOTE(''))`);
    const r = await db.query(
      `UPDATE settings SET v = JSON_QUOTE(?) WHERE k = 'eod_last_sent' AND JSON_UNQUOTE(v) <> ?`, [date, date]);
    if (r.affectedRows === 0) return; // already sent today by another machine
    try { await sendEod(date, { kind: 'eod-auto' }); console.log('[mailer] EOD report sent for', date); }
    catch (e) { console.error('[mailer] EOD report failed:', e.message); }
  });
  console.log(`[mailer] EOD report scheduled daily at ${hh}:${String(mm || 0).padStart(2, '0')}`);
}

/** Generic send using the configured SMTP account (logged to email_log) */
async function sendMail({ to, subject, text, html, kind = 'other' }) {
  const s = await getEmailSettings();
  const t = await transport(s);
  try {
    await t.sendMail({ from: s.from_address || s.smtp_user, to, subject, text, html });
    await log(kind, null, [to], subject, 'sent');
  } catch (e) {
    await log(kind, null, [to], subject, 'failed', e.message);
    throw Object.assign(new Error(`Email failed: ${e.message}`), { status: 502 });
  }
}

async function sendTest(to) {
  const s = await getEmailSettings();
  const t = await transport(s);
  await t.sendMail({ from: s.from_address || s.smtp_user, to, subject: 'Maluti ERP test email', text: 'Your email settings work.' });
  await log('test', null, [to], 'Maluti ERP test email', 'sent');
}

module.exports = { sendEod, schedule, sendTest, sendMail, getEmailSettings, DEFAULT_EMAIL };
