// Customer portal: a private link per customer (/p/<token>) – balance, open invoices, statement, pay with MyWallet / card /
// Switch (a payment request through the Smartel POS backend – never MyWallet directly), or upload proof of a bank payment.
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requirePerm } = require('../auth');
const { ah, bad, round2 } = require('../util');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TOKEN = /^[a-f0-9]{32}$/;
const hits = new Map(); // tiny per-IP limiter for the public pages
function limited(req, max = 120) {
  const k = req.ip + '|' + Math.floor(Date.now() / 60000);
  const n = (hits.get(k) || 0) + 1; hits.set(k, n);
  if (hits.size > 5000) for (const key of hits.keys()) { if (!key.endsWith('|' + Math.floor(Date.now() / 60000))) hits.delete(key); }
  return n > max;
}
async function portalSettings() { return { enabled: true, terminal_id: null, allow_proof: true, ...((await db.getSetting('portal', {})) || {}) }; }
async function partnerByToken(token) {
  if (!TOKEN.test(String(token || '')) || !db.isConnected()) return null;
  return db.one('SELECT id, name, phone, email, address, tax_number FROM partners WHERE portal_token = ? AND active = 1', [token]);
}
const log = (pid, action, detail, req) => db.query('INSERT INTO portal_log (partner_id, action, detail, ip) VALUES (?, ?, ?, ?)', [pid, action, detail ? String(detail).slice(0, 250) : null, String(req.ip || '').slice(0, 60)]).catch(() => {});

async function account(pid) {
  const invoices = await db.query(`SELECT id, number, invoice_date, due_date, total, amount_paid, status FROM invoices WHERE kind = 'customer_invoice' AND partner_id = ? AND status IN ('posted','partial','paid') ORDER BY invoice_date DESC, id DESC LIMIT 200`, [pid]);
  const open = invoices.filter(i => ['posted', 'partial'].includes(i.status));
  const bal = await db.one(`SELECT COALESCE(SUM(l.debit - l.credit),0) b FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '1100' AND l.partner_id = ?`, [pid]);
  const from = new Date(Date.now() - 183 * 86400000).toISOString().slice(0, 10);
  const before = await db.one(`SELECT COALESCE(SUM(l.debit - l.credit),0) b FROM journal_lines l JOIN accounts a ON a.id = l.account_id JOIN journal_entries e ON e.id = l.entry_id WHERE a.code = '1100' AND l.partner_id = ? AND e.entry_date < ?`, [pid, from]);
  const moves = await db.query(`SELECT e.entry_date d, e.reference ref, e.memo, l.debit, l.credit FROM journal_lines l JOIN accounts a ON a.id = l.account_id JOIN journal_entries e ON e.id = l.entry_id
    WHERE a.code = '1100' AND l.partner_id = ? AND e.entry_date >= ? ORDER BY e.entry_date, e.id, l.id`, [pid, from]);
  let run = round2(before.b);
  const statement = [{ d: from, ref: '', memo: 'Opening balance', debit: 0, credit: 0, balance: run }];
  for (const m of moves) { run = round2(run + Number(m.debit) - Number(m.credit)); statement.push({ d: String(m.d).slice(0, 10), ref: m.ref, memo: m.memo, debit: Number(m.debit), credit: Number(m.credit), balance: run }); }
  return { invoices, open, balance: round2(bal.b), statement };
}

// ============================================================ public pages
const pub = express.Router();
pub.use('/p', (req, res, next) => { res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex').set('Referrer-Policy', 'no-referrer'); if (limited(req)) return res.status(429).send('Too many requests – wait a minute.'); next(); });

const T = {
  en: { hello: 'Hello', owe: 'You owe', credit: 'In credit', nothing: 'Nothing to pay – thank you!', pay: 'Pay', with: 'with', open: 'Open invoices', inv: 'Invoice', date: 'Date', due: 'Due', total: 'Total', left: 'To pay', stmt: 'Statement – last 6 months', bal: 'Balance', proof: 'Paid at the bank or by EFT?', proofTxt: 'Upload the deposit slip or proof of payment. We check it and put it on your account.', amount: 'Amount (M)', ref: 'Bank reference', file: 'Slip / proof (photo or PDF)', send: 'Send proof', sent: 'Thank you – we received your proof of payment.', scan: 'Scan with MyWallet and approve on your phone', waiting: 'Waiting for your approval…', paid: 'Paid – thank you! Your account is updated.', cardLink: 'Open the card payment page', other: 'Other amount', print: 'Print', lang: 'Sesotho' },
  st: { hello: 'Lumela', owe: 'U kolota', credit: 'U na le chelete e setseng', nothing: 'Ha ho letho le lokelang ho lefshoa – re a leboha!', pay: 'Lefa', with: 'ka', open: 'Li-invoice tse sa lefshoang', inv: 'Invoice', date: 'Letsatsi', due: 'E lefshoa', total: 'Kakaretso', left: 'Se setseng', stmt: 'Statement – likhoeli tse 6', bal: 'Se setseng', proof: 'U lefile bankeng kapa ka EFT?', proofTxt: 'Kenya slip kapa bopaki ba tefo. Re tla e hlahloba ’me re e kenye akhaontong ea hau.', amount: 'Chelete (M)', ref: 'Referense ea banka', file: 'Slip (foto kapa PDF)', send: 'Romela bopaki', sent: 'Re a leboha – re amohetse bopaki ba tefo.', scan: 'Scan ka MyWallet ’me u amohele fonong', waiting: 'Re emetse hore u amohele…', paid: 'E lefiloe – re a leboha!', cardLink: 'Bula leqephe la karete', other: 'Chelete e ’ngoe', print: 'Hatisa', lang: 'English' }
};

pub.get('/p/:token', async (req, res) => {
  try {
    const p = await partnerByToken(req.params.token);
    if (!p) return res.status(404).type('html').send('<!doctype html><meta name=viewport content="width=device-width"><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>Link not found</h2><p>This link is invalid or was switched off. Ask the business for a new one.</p></body>');
    const ps = await portalSettings();
    if (!ps.enabled) return res.status(403).type('html').send('<!doctype html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>The customer portal is switched off.</h2></body>');
    const lang = req.query.lang === 'st' ? 'st' : 'en'; const t = T[lang];
    const c = (await db.getSetting('company', {})) || {};
    const logo = await require('../services/logo').get().catch(() => null);
    const a = await account(p.id);
    const sm = await require('../services/smartel').settings(true);
    const tenders = sm.enabled && ps.terminal_id ? (await db.query(`SELECT plugin_id FROM payment_methods WHERE active = 1 AND plugin_id LIKE 'smartel:%' ORDER BY sort_order`)).map(m => m.plugin_id.slice(8)) : [];
    const tName = { mywallet: 'MyWallet', card: lang === 'st' ? 'karete' : 'card', switch: 'Switch' };
    const m = n => `${esc(c.currency_symbol || 'M')} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    log(p.id, 'view', null, req);
    res.type('html').send(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.name || '')} – ${esc(p.name)}</title>
<style>:root{--b:#3f3d9e;--ok:#15803d;--bad:#b91c1c} *{box-sizing:border-box} body{margin:0;background:#eef0f6;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#1e2233}
.wrap{max-width:760px;margin:0 auto;padding:14px} .card{background:#fff;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,.07);padding:18px;margin-bottom:14px}
.hd{display:flex;align-items:center;gap:12px} .hd img{max-height:56px;max-width:140px;object-fit:contain} h1{font-size:19px;margin:0} h2{font-size:16px;margin:0 0 10px}
.muted{color:#6b7189;font-size:13px} .big{font-size:30px;font-weight:800;margin:6px 0} table{width:100%;border-collapse:collapse;font-size:14px} th{text-align:left;color:#6b7189;font-weight:600;font-size:12px;padding:6px 4px;border-bottom:1px solid #e3e5ee} td{padding:7px 4px;border-bottom:1px solid #f0f1f6} .r{text-align:right;white-space:nowrap}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:12px 18px;border-radius:999px;border:0;background:var(--b);color:#fff;font-weight:600;font-size:15px;cursor:pointer;text-decoration:none} .btn.ghost{background:#fff;color:var(--b);border:1px solid #c7c9e6}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center} input{padding:10px;border:1px solid #cfd3e3;border-radius:10px;font-size:15px;width:100%} label{display:block;font-size:13px;color:#4b5168;margin:8px 0 4px}
.ov{position:fixed;inset:0;background:rgba(20,22,40,.55);display:none;align-items:center;justify-content:center;padding:14px} .ov .card{max-width:380px;width:100%;text-align:center} .ok{color:var(--ok);font-weight:700} .err{color:var(--bad)}
@media print{.noprint{display:none!important} body{background:#fff} .card{box-shadow:none}}</style></head><body><div class="wrap">
<div class="card hd">${logo ? `<img src="${logo.data_url}" alt="">` : ''}<div style="flex:1"><h1>${esc(c.name || '')}</h1><div class="muted">${esc(c.address || '')}${c.phone ? ' · ' + esc(c.phone) : ''}</div></div><a class="muted noprint" href="?lang=${lang === 'st' ? 'en' : 'st'}">${t.lang}</a></div>
<div class="card"><div class="muted">${t.hello} ${esc(p.name)}</div><div class="big" style="color:${a.balance > 0 ? 'var(--bad)' : 'var(--ok)'}">${a.balance > 0 ? m(a.balance) : a.balance < 0 ? m(-a.balance) : m(0)}</div><div class="muted">${a.balance > 0 ? t.owe : a.balance < 0 ? t.credit : t.nothing}</div>
${a.balance > 0 && tenders.length ? `<div class="row noprint" style="margin-top:12px"><input id="amt" type="number" step="0.01" min="1" value="${a.balance.toFixed(2)}" style="max-width:160px">${tenders.map(x => `<button class="btn" data-pay="${x}">${t.pay} ${t.with} ${tName[x]}</button>`).join('')}</div>` : ''}</div>
${a.open.length ? `<div class="card"><h2>${t.open}</h2><table><tr><th>${t.inv}</th><th>${t.date}</th><th>${t.due}</th><th class="r">${t.total}</th><th class="r">${t.left}</th></tr>${a.open.map(i => `<tr><td><a href="/p/${esc(req.params.token)}/i/${i.id}?lang=${lang}">${esc(i.number)}</a></td><td>${esc(String(i.invoice_date).slice(0, 10))}</td><td>${esc(String(i.due_date || '').slice(0, 10))}</td><td class="r">${m(i.total)}</td><td class="r"><b>${m(Number(i.total) - Number(i.amount_paid))}</b></td></tr>`).join('')}</table></div>` : ''}
<div class="card"><div class="row"><h2 style="flex:1">${t.stmt}</h2><button class="btn ghost noprint" onclick="print()">${t.print}</button></div><table><tr><th>${t.date}</th><th></th><th class="r">+</th><th class="r">−</th><th class="r">${t.bal}</th></tr>${a.statement.map(s => `<tr><td>${esc(s.d)}</td><td>${esc(s.ref || '')} <span class="muted">${esc(s.memo || '')}</span></td><td class="r">${s.debit ? m(s.debit) : ''}</td><td class="r">${s.credit ? m(s.credit) : ''}</td><td class="r">${m(s.balance)}</td></tr>`).join('')}</table></div>
${ps.allow_proof ? `<div class="card noprint"><h2>${t.proof}</h2><div class="muted">${t.proofTxt}</div><form id="pf"><label>${t.amount}</label><input name="amount" type="number" step="0.01" min="1" required><label>${t.ref}</label><input name="reference" maxlength="60" required><label>${t.file}</label><input name="file" type="file" accept="image/*,application/pdf" required><div style="margin-top:12px"><button class="btn">${t.send}</button> <span id="pfm"></span></div></form></div>` : ''}
<div class="muted" style="text-align:center">Maluti ERP</div></div>
<div class="ov" id="ov"><div class="card"><div id="ovb"></div><button class="btn ghost" style="margin-top:12px" onclick="document.getElementById('ov').style.display='none';if(window._done)location.reload()">OK</button></div></div>
<script>
const T=${JSON.stringify({ scan: t.scan, waiting: t.waiting, paid: t.paid, cardLink: t.cardLink, sent: t.sent })}, base=location.pathname;
document.querySelectorAll('[data-pay]').forEach(b=>b.onclick=async()=>{const ov=document.getElementById('ov'),ob=document.getElementById('ovb');ov.style.display='flex';ob.textContent='…';
 try{let r=await fetch(base+'/pay',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tender:b.dataset.pay,amount:Number(document.getElementById('amt').value)})});let j=await r.json();if(!r.ok)throw new Error(j.error);
 ob.innerHTML=(j.qr_svg?'<div style="width:230px;margin:0 auto">'+j.qr_svg+'</div><p>'+T.scan+'</p>':'')+(j.url?'<p><a class="btn" target="_blank" rel="noopener" href="'+j.url.replace(/"/g,'')+'">'+T.cardLink+'</a></p>':'')+'<p class="muted" id="st">'+T.waiting+'</p>';
 for(let i=0;i<150&&ov.style.display==='flex';i++){await new Promise(x=>setTimeout(x,3000));r=await fetch(base+'/pay/'+j.id);const k=await r.json();if(k.paid&&k.allocated){ob.innerHTML='<p class="ok">'+T.paid+'</p>';window._done=1;return}if(k.final&&!k.paid){ob.innerHTML='<p class="err">'+k.state+'</p>';return}}
 }catch(e){ob.innerHTML='<p class="err">'+e.message+'</p>'}});
const pf=document.getElementById('pf');if(pf)pf.onsubmit=async e=>{e.preventDefault();const f=pf.file.files[0],msg=document.getElementById('pfm');if(!f)return;if(f.size>5*1024*1024){msg.textContent='Max 5 MB';return}
 const data=await new Promise(r=>{const x=new FileReader();x.onload=()=>r(x.result);x.readAsDataURL(f)});msg.textContent='…';
 const r=await fetch(base+'/proof',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount:Number(pf.amount.value),reference:pf.reference.value,filename:f.name,data_url:data})});const j=await r.json();msg.innerHTML=r.ok?'<span class="ok">'+T.sent+'</span>':'<span class="err">'+j.error+'</span>';if(r.ok)pf.reset()};
</script></body></html>`);
  } catch (e) { res.status(500).type('text').send('Sorry, something went wrong. Try again later.'); }
});

pub.get('/p/:token/i/:id', async (req, res) => {
  const p = await partnerByToken(req.params.token);
  if (!p) return res.status(404).send('Not found');
  const i = await db.one(`SELECT * FROM invoices WHERE id = ? AND partner_id = ? AND kind = 'customer_invoice' AND status IN ('posted','partial','paid')`, [req.params.id, p.id]);
  if (!i) return res.status(404).send('Not found');
  const lines = await db.query('SELECT description, qty, unit_price, tax_rate, line_total FROM invoice_lines WHERE invoice_id = ? ORDER BY id', [i.id]);
  const c = (await db.getSetting('company', {})) || {};
  const m = n => `${esc(c.currency_symbol || 'M')} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  log(p.id, 'invoice', i.number, req);
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(i.number)}</title><style>body{font-family:Arial,sans-serif;max-width:760px;margin:20px auto;padding:0 14px;color:#1e2233}table{width:100%;border-collapse:collapse}td,th{padding:6px;border-bottom:1px solid #e3e5ee;text-align:left}.r{text-align:right}@media print{a{display:none}}</style></head><body>
  <a href="/p/${esc(req.params.token)}">← back</a> <button onclick="print()">Print</button><h2>${esc(c.name || '')}</h2><div>${esc(c.address || '')}${c.tax_number ? ' · VAT ' + esc(c.tax_number) : ''}</div><h3>TAX INVOICE ${esc(i.number)}</h3>
  <div>To: <b>${esc(p.name)}</b>${p.tax_number ? ' · ' + esc(p.tax_number) : ''}<br>Date ${esc(String(i.invoice_date).slice(0, 10))}${i.due_date ? ' · Due ' + esc(String(i.due_date).slice(0, 10)) : ''}</div><br>
  <table><tr><th>Description</th><th class="r">Qty</th><th class="r">Price</th><th class="r">VAT %</th><th class="r">Total</th></tr>${lines.map(l => `<tr><td>${esc(l.description)}</td><td class="r">${Number(l.qty)}</td><td class="r">${m(l.unit_price)}</td><td class="r">${Number(l.tax_rate)}</td><td class="r">${m(l.line_total)}</td></tr>`).join('')}
  <tr><td colspan="4" class="r">Excl. VAT</td><td class="r">${m(i.subtotal)}</td></tr><tr><td colspan="4" class="r">VAT</td><td class="r">${m(i.tax_total)}</td></tr><tr><td colspan="4" class="r"><b>Total</b></td><td class="r"><b>${m(i.total)}</b></td></tr><tr><td colspan="4" class="r">Paid</td><td class="r">${m(i.amount_paid)}</td></tr><tr><td colspan="4" class="r"><b>To pay</b></td><td class="r"><b>${m(Number(i.total) - Number(i.amount_paid))}</b></td></tr></table></body></html>`);
});

pub.post('/p/:token/pay', express.json({ limit: '10kb' }), async (req, res) => {
  try {
    if (limited(req, 20)) return res.status(429).json({ error: 'Too many requests' });
    const p = await partnerByToken(req.params.token);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const a = await account(p.id);
    const amt = round2(req.body.amount);
    if (!(amt >= 1)) throw bad('Enter the amount to pay');
    if (amt > Math.max(a.balance, 0) + 0.004) throw bad(`You can pay up to ${a.balance.toFixed(2)}`);
    if (!['mywallet', 'card', 'switch'].includes(req.body.tender)) throw bad('Choose how to pay');
    const it = await require('../services/smartel').portalIntent(p.id, req.body.tender, amt);
    log(p.id, 'pay_start', `${req.body.tender} ${amt}`, req);
    res.json({ id: it.id, qr_svg: it.qr_svg, url: it.url, state: it.state });
  } catch (e) { res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.status && e.status < 500 ? e.message : 'Online payment is not available right now. Please try again later.' }); }
});
pub.get('/p/:token/pay/:id', async (req, res) => {
  try {
    const p = await partnerByToken(req.params.token);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const it = await db.one('SELECT id FROM smartel_intents WHERE id = ? AND partner_id = ?', [req.params.id, p.id]);
    if (!it) return res.status(404).json({ error: 'Not found' });
    const v = await require('../services/smartel').settlePortalIntent(it.id);
    if (v.paid && v.allocated) log(p.id, 'paid', `${v.tender} ${v.amount} ${v.mw_ref || ''}`, req);
    res.json({ state: v.state, paid: v.paid, final: v.final, allocated: !!v.allocated });
  } catch (e) { res.status(502).json({ error: 'Could not check the payment – try again' }); }
});
pub.post('/p/:token/proof', express.json({ limit: '8mb' }), async (req, res) => {
  try {
    if (limited(req, 10)) return res.status(429).json({ error: 'Too many requests' });
    const p = await partnerByToken(req.params.token);
    if (!p) return res.status(404).json({ error: 'Not found' });
    if (!(await portalSettings()).allow_proof) throw bad('Not allowed');
    const amt = round2(req.body.amount);
    if (!(amt > 0)) throw bad('Enter the amount you paid');
    const ref = String(req.body.reference || '').trim().slice(0, 60);
    if (!ref) throw bad('Enter the bank reference');
    const mm = /^data:(image\/(png|jpeg|webp|gif)|application\/pdf);base64,(.+)$/.exec(String(req.body.data_url || ''));
    if (!mm) throw bad('Send a photo or a PDF');
    const buf = Buffer.from(mm[3], 'base64');
    if (buf.length > 5 * 1024 * 1024) throw bad('The file is bigger than 5 MB');
    const name = String(req.body.filename || 'proof').replace(/[^\w.\- ]/g, '_').slice(0, 120);
    await db.query('INSERT INTO attachments (entity, entity_id, filename, mime, size, data, note) VALUES (?, ?, ?, ?, ?, ?, ?)', ['partner', p.id, name, mm[1], buf.length, buf, `Proof of payment (portal): M ${amt.toFixed(2)} ref ${ref}`]);
    // a task for the office to check it and record the payment
    await db.query(`INSERT INTO crm_activities (partner_id, type, subject, body, due_at) VALUES (?, 'task', ?, ?, NOW())`, [p.id, `Check proof of payment M ${amt.toFixed(2)} (${ref})`, 'Uploaded by the customer on the portal. Check the bank statement, then Receive payment.']).catch(() => {});
    log(p.id, 'proof', `${amt} ${ref}`, req);
    res.json({ ok: true });
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

// ============================================================ staff API
const r = express.Router();
r.get('/portal/settings', requirePerm('settings'), ah(async (req, res) => res.json(await portalSettings())));
r.put('/portal/settings', requirePerm('settings'), ah(async (req, res) => {
  const b = req.body || {};
  const cur = await portalSettings();
  const n = { ...cur, enabled: !!Number(b.enabled ?? cur.enabled) || b.enabled === true, allow_proof: !!Number(b.allow_proof ?? cur.allow_proof) || b.allow_proof === true, terminal_id: b.terminal_id ? Number(b.terminal_id) : null };
  if (n.terminal_id && !(await db.one('SELECT 1 x FROM smartel_terminals WHERE pos_terminal_id = ?', [n.terminal_id]))) throw bad('That till is not linked to Smartel');
  await db.setSetting('portal', n);
  res.json(n);
}));
r.post('/partners/:id/portal-link', requirePerm('partners'), ah(async (req, res) => {
  const p = await db.one('SELECT id, name, phone, portal_token FROM partners WHERE id = ?', [req.params.id]);
  if (!p) throw bad('Not found');
  let tok = p.portal_token;
  if (!tok || req.body.renew) { tok = crypto.randomBytes(16).toString('hex'); await db.query('UPDATE partners SET portal_token = ? WHERE id = ?', [tok, p.id]); }
  const url = `${await require('../services/qr').baseUrl(req)}/p/${tok}`;
  res.json({ url, qr_svg: await require('../services/qr').svg(url), phone: p.phone, name: p.name });
}));
r.delete('/partners/:id/portal-link', requirePerm('partners'), ah(async (req, res) => { await db.query('UPDATE partners SET portal_token = NULL WHERE id = ?', [req.params.id]); res.json({ ok: true }); }));
r.post('/partners/:id/portal-link/sms', requirePerm('partners'), ah(async (req, res) => {
  const p = await db.one('SELECT id, name, phone, portal_token FROM partners WHERE id = ?', [req.params.id]);
  if (!p || !p.portal_token) throw bad('Make the link first');
  if (!p.phone) throw bad('This customer has no phone number');
  const c = (await db.getSetting('company', {})) || {};
  const url = `${await require('../services/qr').baseUrl(req)}/p/${p.portal_token}`;
  await require('../services/sms').send(p.phone, `${c.name || 'We'}: see your account and pay online: ${url}`);
  res.json({ ok: true });
}));
r.get('/partners/:id/portal-log', requirePerm('partners'), ah(async (req, res) => res.json(await db.query('SELECT * FROM portal_log WHERE partner_id = ? ORDER BY id DESC LIMIT 50', [req.params.id]))));

module.exports = { pub, router: r, account };
