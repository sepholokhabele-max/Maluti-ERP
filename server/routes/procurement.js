// e-Procurement routes: the back office (/api/procurement…, /api/tenders…), the supplier bid portal (/s/<token>) and
// public tender notices (/tenders, /tenders/<slug>).
const express = require('express');
const gov = require('../services/governance');
const db = require('../db');
const { requirePerm } = require('../auth');
const { ah, bad, notFound } = require('../util');
const PR = require('../services/procurement');

const can = (u, p) => u.permissions.includes('*') || u.permissions.includes(p);
const baseUrl = req => `${req.protocol}://${req.get('host')}`;
/** procurement office, or a member of this case's committee */
const officeOrMember = (...perms) => ah(async (req, res, next) => {
  if (perms.some(p => can(req.user, p))) return next();
  if (await db.one('SELECT id FROM tender_committee WHERE tender_id = ? AND user_id = ?', [req.params.id, req.user.id])) return next();
  throw Object.assign(new Error('You do not have permission: procurement'), { status: 403 });
});
const P = requirePerm('procurement'), A = requirePerm('procurement.approve');

/* ============================== back office ============================== */
const r = express.Router();
r.get('/procurement/settings', officeOrMember('procurement', 'procurement.approve'), ah(async (req, res) => res.json({ settings: await PR.settings(), methods: PR.METHODS, waiver_reasons: PR.WAIVER_REASONS })));
r.put('/procurement/settings', requirePerm('settings'), ah(async (req, res) => res.json(await PR.saveSettings(req.body || {}))));
r.get('/procurement/scorecard', P, ah(async (req, res) => res.json(await PR.scorecard(req.query.from, req.query.to))));
r.get('/procurement/compliance', P, ah(async (req, res) => res.json(await PR.compliance())));
r.get('/procurement/suppliers', P, ah(async (req, res) => res.json(await PR.suppliers(req.query))));
r.get('/procurement/suppliers/:id(\\d+)', P, ah(async (req, res) => res.json(await PR.supplier(req.params.id))));
r.post('/procurement/suppliers', P, ah(async (req, res) => res.json({ id: await PR.saveSupplier(req.user, req.body || {}) })));
r.put('/procurement/suppliers/:id(\\d+)', P, ah(async (req, res) => res.json({ id: await PR.saveSupplier(req.user, req.body || {}, Number(req.params.id)) })));
r.get('/procurement/my', ah(async (req, res) => res.json(await PR.list({ mine: req.user.id, status: 'active' }))));

r.get('/tenders', P, ah(async (req, res) => res.json(await PR.list(req.query))));
r.post('/tenders', P, ah(async (req, res) => res.json({ id: await PR.saveTender(req.user, req.body || {}) })));
r.get('/tenders/:id(\\d+)', officeOrMember('procurement', 'procurement.approve'), ah(async (req, res) => res.json(await PR.getTender(req.params.id, req.user))));
r.put('/tenders/:id(\\d+)', P, ah(async (req, res) => res.json({ id: await PR.saveTender(req.user, req.body || {}, Number(req.params.id)) })));
r.post('/tenders/:id(\\d+)/submit', P, ah(async (req, res) => res.json({ ok: true, ...(await PR.submit(req.user, req.params.id)) })));
// approvals: when the organogram governs this kind of approval, the delegation of authority decides who may sign
const govGate = kind => async (req, res, next) => {
  try { const t = await db.one('SELECT method FROM tenders WHERE id = ?', [req.params.id]); return gov.gate(kind === 'award' ? 'procurement_award' : PR.approvalType(t || {}), 'procurement.approve')(req, res, next); } catch (e) { next(e); }
};
r.post('/tenders/:id(\\d+)/approve', govGate('procure'), ah(async (req, res) => res.json({ ok: true, ...(await PR.approve(req.user, req.params.id, req.body || {})) })));
r.post('/tenders/:id(\\d+)/publish', P, ah(async (req, res) => res.json(await PR.publish(req.user, req.params.id, req.body || {}, baseUrl(req)))));
r.post('/tenders/:id(\\d+)/invite', P, ah(async (req, res) => res.json(await PR.invite(req.user, req.params.id, (req.body || {}).partner_ids, baseUrl(req)))));
r.get('/tenders/:id(\\d+)/links', P, ah(async (req, res) => res.json((await PR.bidderLinks(req.params.id)).map(x => ({ ...x, url: `${baseUrl(req)}/s/${x.token}` })))));
r.post('/tenders/:id(\\d+)/bid', P, ah(async (req, res) => res.json(await PR.enterBid(req.user, req.params.id, req.body || {}))));
r.post('/tenders/:id(\\d+)/addendum', P, ah(async (req, res) => { await PR.addendum(req.user, req.params.id, req.body || {}); res.json({ ok: true }); }));
r.post('/tenders/clarifications/:cid(\\d+)/answer', P, ah(async (req, res) => { await PR.answer(req.user, req.params.cid, req.body || {}); res.json({ ok: true }); }));
r.post('/tenders/challenges/:cid(\\d+)', A, ah(async (req, res) => { await PR.decideChallenge(req.user, req.params.cid, req.body || {}); res.json({ ok: true }); }));
r.post('/tenders/:id(\\d+)/committee', P, ah(async (req, res) => { await db.tx(c => PR.setCommittee(c, req.user, Number(req.params.id), (req.body || {}).committee)); res.json({ ok: true }); }));
r.post('/tenders/:id(\\d+)/open', officeOrMember('procurement'), ah(async (req, res) => res.json(await PR.openBids(req.user, req.params.id, req.body || {}))));
r.post('/tenders/:id(\\d+)/declare', ah(async (req, res) => { await PR.declare(req.user, req.params.id, req.body || {}); res.json({ ok: true }); }));
r.post('/tenders/:id(\\d+)/score', ah(async (req, res) => { await PR.score(req.user, req.params.id, req.body || {}); res.json({ ok: true }); }));
r.post('/tenders/:id(\\d+)/evaluate', officeOrMember('procurement'), ah(async (req, res) => res.json(await PR.evaluate(req.user, req.params.id))));
r.post('/tenders/:id(\\d+)/disqualify', officeOrMember('procurement'), ah(async (req, res) => { await PR.disqualify(req.user, req.params.id, req.body || {}); res.json({ ok: true }); }));
r.post('/tenders/:id(\\d+)/recommend', officeOrMember('procurement'), ah(async (req, res) => res.json({ ok: true, ...(await PR.recommend(req.user, req.params.id, req.body || {})) })));
r.post('/tenders/:id(\\d+)/award', govGate('award'), ah(async (req, res) => res.json(await PR.approveAward(req.user, req.params.id, req.body || {}))));
r.post('/tenders/:id(\\d+)/contract', P, ah(async (req, res) => res.json(await PR.contract(req.user, req.params.id, req.body || {}))));
r.post('/tenders/:id(\\d+)/rate', P, ah(async (req, res) => { await PR.rate(req.user, req.params.id, req.body || {}); res.json({ ok: true }); }));
r.post('/tenders/:id(\\d+)/cancel', A, ah(async (req, res) => { await PR.cancel(req.user, req.params.id, req.body || {}); res.json({ ok: true }); }));

/* ============================== supplier portal & public notices ============================== */
const pub = express.Router();
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hits = new Map();
const limited = (req, max = 120) => { const k = req.ip + '|' + Math.floor(Date.now() / 60000), n = (hits.get(k) || 0) + 1; hits.set(k, n); if (hits.size > 5000) hits.clear(); return n > max; };
pub.use(['/s', '/tenders'], (req, res, next) => { res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex').set('Referrer-Policy', 'no-referrer'); if (limited(req)) return res.status(429).send('Too many requests'); if (!db.isConnected()) return res.status(503).send('Starting – try again shortly'); next(); });
const money = n => 'M ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const utc = s => s ? String(s).slice(0, 16) + ' UTC' : '';
async function shell(title, body) {
  const c = (await db.getSetting('company', {})) || {};
  const logo = await require('../services/logo').get().catch(() => null);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} – ${esc(c.name || '')}</title>
<style>:root{--b:#3f3d9e;--ok:#15803d;--bad:#b91c1c}*{box-sizing:border-box}body{margin:0;background:#eef0f6;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#1e2233}
.wrap{max-width:860px;margin:0 auto;padding:14px}.card{background:#fff;border-radius:14px;box-shadow:0 4px 18px rgba(0,0,0,.06);padding:18px;margin-bottom:14px}
.hd{display:flex;gap:12px;align-items:center}.hd img{max-height:52px;max-width:140px}h1{font-size:20px;margin:0}h2{font-size:16px;margin:0 0 10px}.muted{color:#6b7189;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:14px}th{text-align:left;color:#6b7189;font-size:12px;padding:6px;border-bottom:1px solid #e3e6ef}td{padding:7px 6px;border-bottom:1px solid #f0f1f6;vertical-align:top}.r{text-align:right}
input,textarea,select{padding:9px;border:1px solid #cfd3e3;border-radius:9px;font-size:14px;width:100%;font-family:inherit}label{display:block;font-size:13px;color:#4b5168;margin:8px 0 4px}
.btn{display:inline-block;padding:11px 18px;border-radius:999px;border:0;background:var(--b);color:#fff;font-weight:600;font-size:15px;cursor:pointer;text-decoration:none}.btn.ghost{background:#eef0f6;color:var(--b)}.btn.red{background:var(--bad)}
.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;background:#eef0f6}.ok{color:var(--ok);font-weight:700}.err{color:var(--bad);font-weight:600}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}
@media(max-width:600px){.grid2{grid-template-columns:1fr}}</style></head><body><div class="wrap">
<div class="card hd">${logo ? `<img src="${logo.data_url}" alt="">` : ''}<div><h1>${esc(c.name || '')}</h1><div class="muted">${esc(c.address || '')}${c.phone ? ' · ' + esc(c.phone) : ''}${c.email ? ' · ' + esc(c.email) : ''}</div></div></div>
${body}<div class="muted" style="text-align:center">e-Procurement · S-ERP</div></div></body></html>`;
}
const JS = `async function post(u,b){const r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Error');return j}
function msg(id,t,ok){const e=document.getElementById(id);e.className=ok?'ok':'err';e.textContent=t}`;

pub.get('/s/:token', async (req, res) => {
  try {
    const x = await PR.portalData(req.params.token);
    if (!x) return res.status(404).type('html').send(await shell('Not found', '<div class="card"><h2>Link not found</h2><p>Ask the procurement office for a new link.</p></div>'));
    const { bd, t, lines, crit, qa, bid, docs, myDocs, result } = x;
    const price = id => bid && bid.lines.find(l => l.line_id === id) ? bid.lines.find(l => l.line_id === id).unit_price : '';
    const body = `<div class="card"><div class="muted">${esc(PR.METHODS[t.method])} · ${esc(t.number)}</div><h1 style="margin:4px 0 8px">${esc(t.title)}</h1>
      <p>For: <b>${esc(bd.partner_name)}</b> · Closing: <b>${esc(utc(t.closing_at))}</b> · Bid validity ${t.bid_validity_days} days${Number(t.bid_security) ? ` · Bid security ${money(t.bid_security)}` : ''}</p>
      <p><span class="badge">${x.open_for_bids ? 'Open for bids' : esc(t.status === 'cancelled' ? 'Cancelled' : 'Closed for bids')}</span></p>
      ${t.description ? `<p style="white-space:pre-wrap">${esc(t.description)}</p>` : ''}
      ${docs.length ? `<h2>Tender documents</h2>${docs.map(d => `<div><a href="/s/${esc(req.params.token)}/doc/${d.id}">📄 ${esc(d.filename)}</a></div>`).join('')}` : ''}
      ${crit.length ? `<h2 style="margin-top:12px">How bids are evaluated</h2><ul>${crit.map(k => `<li>${esc(k.name)} ${k.kind === 'mandatory' ? '<span class="badge">must have</span>' : `(${Number(k.max_points)} points)`}</li>`).join('')}</ul>
        <p class="muted">Points: technical ${Number(t.tech_weight)}, price ${Number(t.price_weight)}, preference ${Number(t.pref_weight)} (citizen, women, youth and disability ownership and small businesses)</p>` : `<p class="muted">Points: technical ${Number(t.tech_weight)}, price ${Number(t.price_weight)}, preference ${Number(t.pref_weight)}.</p>`}</div>
    ${result ? `<div class="card"><h2>Result</h2>${result.won ? `<p class="ok">Congratulations – your bid was successful (${money(result.award_value)}). The office will contact you about the contract${result.standstill_until ? ` after the standstill period (${esc(result.standstill_until)})` : ''}.</p>`
      : `<p>The award went to <b>${esc(result.awarded_name)}</b>. Thank you for bidding.</p>${result.standstill_until && result.standstill_until >= new Date().toISOString().slice(0, 10) && bid ? `<p class="muted">If you believe the evaluation was wrong you may lodge a challenge until ${esc(result.standstill_until)}.</p><textarea id="ch" rows="4" placeholder="Grounds of your challenge"></textarea><p><button class="btn red" id="chb">Lodge challenge</button> <span id="chm"></span></p>` : ''}`}</div>` : ''}
    <div class="card"><h2>${x.open_for_bids ? (bid ? 'Your bid (you can change it until the closing time)' : 'Submit your sealed bid') : 'Your bid'}</h2>
      ${bid ? `<p class="ok">Bid received ${esc(String(bid.submitted_at).slice(0, 16))} – seal <code>${esc(bid.seal.slice(0, 16))}…</code>. Nobody can see the prices until the bids are opened after closing.</p>` : ''}
      <table><tr><th>Item</th><th class="r">Qty</th><th class="r" style="width:160px">Unit price excl. VAT</th></tr>${lines.map(l => `<tr><td>${esc(l.description)}</td><td class="r">${Number(l.qty)} ${esc(l.uom || '')}</td><td><input type="number" step="0.01" min="0" data-l="${l.id}" value="${price(l.id)}" ${x.open_for_bids ? '' : 'disabled'}></td></tr>`).join('')}</table>
      <div class="grid2"><div><label>VAT %</label><input id="vat" type="number" value="${bid && Number(bid.subtotal) ? Math.round(Number(bid.vat) / Number(bid.subtotal) * 100) : 15}" ${x.open_for_bids ? '' : 'disabled'}></div>
        <div><label>Delivery / completion (days)</label><input id="dd" type="number" value="${bid && bid.delivery_days != null ? bid.delivery_days : ''}" ${x.open_for_bids ? '' : 'disabled'}></div>
        <div><label>Bid valid for (days)</label><input id="vd" type="number" value="${bid ? bid.validity_days : t.bid_validity_days}" ${x.open_for_bids ? '' : 'disabled'}></div></div>
      <label>Notes</label><textarea id="nt" rows="3" ${x.open_for_bids ? '' : 'disabled'}>${esc(bid ? bid.notes || '' : '')}</textarea>
      ${x.open_for_bids ? `<label style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" id="dc" style="width:auto;margin-top:3px"> We declare that this bid is true and complete, that we have not colluded with other bidders and that no official involved has an interest in our company.</label>
      <p><button class="btn" id="sb">${bid ? 'Replace my bid' : 'Submit sealed bid'}</button> ${bid ? '<button class="btn ghost" id="wd">Withdraw</button>' : ''} <span id="sm"></span></p>` : ''}
      ${bid ? `<h2 style="margin-top:14px">Your documents</h2>${myDocs.map(d => `<div>📎 ${esc(d.filename)}</div>`).join('') || '<p class="muted">None yet – attach company registration, tax clearance, CVs, technical proposal…</p>'}
        ${x.open_for_bids ? '<input type="file" id="fl"><p><button class="btn ghost" id="ub">Upload</button> <span id="um"></span></p>' : ''}` : ''}</div>
    <div class="card"><h2>Questions and addenda</h2>${qa.filter(q => q.kind !== 'challenge').map(q => q.kind === 'addendum' ? `<p><span class="badge">Addendum</span> ${esc(q.question)}</p>` : `<p><b>Q:</b> ${esc(q.question)}<br>${q.answer ? `<b>A:</b> ${esc(q.answer)}` : '<span class="muted">waiting for an answer</span>'}</p>`).join('') || '<p class="muted">None yet.</p>'}
      ${qa.filter(q => q.kind === 'challenge').map(q => `<p><span class="badge">Your challenge</span> ${esc(q.question)}<br>${q.answer ? `<b>Decision (${esc(q.status)}):</b> ${esc(q.answer)}` : '<span class="muted">being considered</span>'}</p>`).join('')}
      ${x.open_for_bids ? '<textarea id="qq" rows="3" placeholder="Ask a question – the answer is shared with all bidders without your name"></textarea><p><button class="btn ghost" id="qb">Send question</button> <span id="qm"></span></p>' : ''}</div>
<script>${JS}
const B=location.pathname;
const g=id=>document.getElementById(id);
if(g('sb'))g('sb').onclick=async()=>{try{const lines=[...document.querySelectorAll('[data-l]')].map(i=>({line_id:Number(i.dataset.l),unit_price:i.value}));
 const j=await post(B+'/bid',{lines,vat_rate:g('vat').value,delivery_days:g('dd').value,validity_days:g('vd').value,notes:g('nt').value,declaration:g('dc').checked});msg('sm','Bid received – seal '+j.seal.slice(0,16)+'…',1);setTimeout(()=>location.reload(),1200)}catch(e){msg('sm',e.message)}};
if(g('wd'))g('wd').onclick=async()=>{if(!confirm('Withdraw your bid?'))return;try{await post(B+'/withdraw',{});location.reload()}catch(e){msg('sm',e.message)}};
if(g('qb'))g('qb').onclick=async()=>{try{await post(B+'/ask',{question:g('qq').value});msg('qm','Sent – the answer will appear here',1);g('qq').value=''}catch(e){msg('qm',e.message)}};
if(g('chb'))g('chb').onclick=async()=>{try{await post(B+'/challenge',{text:g('ch').value});location.reload()}catch(e){msg('chm',e.message)}};
if(g('ub'))g('ub').onclick=async()=>{const f=g('fl').files[0];if(!f)return;if(f.size>8*1024*1024)return msg('um','Max 8 MB');const d=await new Promise(r=>{const x=new FileReader();x.onload=()=>r(x.result);x.readAsDataURL(f)});
 try{await post(B+'/upload',{filename:f.name,data_url:d});location.reload()}catch(e){msg('um',e.message)}};
</script>`;
    res.type('html').send(await shell(t.title, body));
  } catch (e) { console.error('[portal]', e.message); res.status(500).type('text').send('Sorry, something went wrong.'); }
});
const pj = fn => [express.json({ limit: '9mb' }), async (req, res) => { try { res.json((await fn(req)) || { ok: true }); } catch (e) { res.status(e.status && e.status < 500 ? e.status : 500).json({ error: e.status && e.status < 500 ? e.message : 'Something went wrong' }); } }];
pub.post('/s/:token/bid', ...pj(req => PR.portalBid(req.params.token, req.body || {})));
pub.post('/s/:token/withdraw', ...pj(req => PR.portalWithdraw(req.params.token)));
pub.post('/s/:token/ask', ...pj(req => PR.portalAsk(req.params.token, (req.body || {}).question)));
pub.post('/s/:token/challenge', ...pj(req => PR.portalChallenge(req.params.token, (req.body || {}).text)));
pub.post('/s/:token/upload', ...pj(async req => {
  const x = await PR.portalData(req.params.token); if (!x) throw notFound();
  if (!x.open_for_bids) throw bad('Documents can be added only before the closing time');
  if (!x.bid) throw bad('Submit your bid first, then attach documents');
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(String(req.body.data_url || '')); if (!m) throw bad('Choose a file');
  const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
  if (!buf.length || buf.length > 8 * 1024 * 1024) throw bad('Files can be at most 8 MB');
  const name = String(req.body.filename || 'file').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 200);
  if (/\.(exe|bat|cmd|com|msi|scr|js|vbs|ps1|html?)$/i.test(name)) throw bad('That kind of file is not accepted');
  await db.query(`INSERT INTO attachments (entity, entity_id, filename, mime, size, data, note) VALUES ('bid', ?, ?, ?, ?, ?, ?)`, [x.bid.id, name, (m[1] || 'application/octet-stream').slice(0, 100), buf.length, buf, `Uploaded by ${x.bd.partner_name}`]);
  await db.query('INSERT INTO tender_events (tender_id, partner_id, action, details) VALUES (?, ?, ?, ?)', [x.t.id, x.bd.partner_id, 'document uploaded', name]);
}));
pub.get('/s/:token/doc/:id', async (req, res) => {
  const x = await PR.byToken(req.params.token); if (!x) return res.status(404).send('Not found');
  const a = await db.one(`SELECT filename, mime, data FROM attachments WHERE id = ? AND entity = 'tender' AND entity_id = ?`, [req.params.id, x.t.id]);
  if (!a) return res.status(404).send('Not found');
  res.set('Content-Type', a.mime).set('Content-Disposition', `attachment; filename="${a.filename.replace(/"/g, '')}"`).set('X-Content-Type-Options', 'nosniff').send(a.data);
});

pub.get('/tenders', async (req, res) => {
  const rows = await db.query(`SELECT number, title, category, closing_at, slug FROM tenders WHERE method = 'open' AND status = 'published' AND closing_at > UTC_TIMESTAMP() ORDER BY closing_at`);
  res.type('html').send(await shell('Tenders', `<div class="card"><h2>Open tenders</h2>${rows.length ? `<table><tr><th>Number</th><th>Tender</th><th>Closes</th></tr>${rows.map(t => `<tr><td>${esc(t.number)}</td><td><a href="/tenders/${t.slug}">${esc(t.title)}</a><br><span class="muted">${esc(t.category)}</span></td><td>${esc(utc(t.closing_at))}</td></tr>`).join('')}</table>` : '<p class="muted">There are no open tenders at the moment.</p>'}</div>`));
});
pub.get('/tenders/:slug', async (req, res) => {
  const t = await PR.publicTender(req.params.slug);
  if (!t) return res.status(404).type('html').send(await shell('Not found', '<div class="card"><h2>Tender not found</h2></div>'));
  const lines = await db.query('SELECT description, qty, uom FROM tender_lines WHERE tender_id = ? ORDER BY id', [t.id]);
  const open = t.status === 'published';
  res.type('html').send(await shell(t.title, `<div class="card"><div class="muted">Open tender · ${esc(t.number)}</div><h1 style="margin:4px 0 8px">${esc(t.title)}</h1><p>Closing: <b>${esc(utc(t.closing_at))}</b> · <span class="badge">${open ? 'Open for bids' : 'Closed'}</span></p>
    ${t.description ? `<p style="white-space:pre-wrap">${esc(t.description)}</p>` : ''}<table><tr><th>Item</th><th class="r">Qty</th></tr>${lines.map(l => `<tr><td>${esc(l.description)}</td><td class="r">${Number(l.qty)} ${esc(l.uom || '')}</td></tr>`).join('')}</table></div>
    ${open ? `<div class="card"><h2>Register to bid</h2><p class="muted">Register once; your private bid link is emailed to you (and shown here for new suppliers). Ownership details count for preference points – false details disqualify the bid.</p>
      <div class="grid2"><div><label>Company name *</label><input id="n"></div><div><label>Email *</label><input id="e" type="email"></div><div><label>Phone</label><input id="p"></div><div><label>Company registration no.</label><input id="rg"></div>
      <div><label>Contact person</label><input id="cp"></div><div><label>District</label><input id="ds"></div>
      <div><label>% owned by Basotho citizens</label><input id="cz" type="number" min="0" max="100"></div><div><label>% owned by women</label><input id="wm" type="number" min="0" max="100"></div>
      <div><label>% owned by youth (under 35)</label><input id="yt" type="number" min="0" max="100"></div><div><label>Business size</label><select id="sz"><option value="micro">Micro</option><option value="small" selected>Small</option><option value="medium">Medium</option><option value="large">Large</option></select></div></div>
      <label style="display:flex;gap:8px"><input type="checkbox" id="db" style="width:auto"> Majority-owned by a person or people with disability</label>
      <p><button class="btn" id="rb">Register</button> <span id="rm"></span></p><div id="lk"></div></div>
      <script>${JS}document.getElementById('rb').onclick=async()=>{const g=i=>document.getElementById(i).value;try{const j=await post(location.pathname+'/register',{name:g('n'),email:g('e'),phone:g('p'),reg_no:g('rg'),contact_person:g('cp'),district:g('ds'),citizen_pct:g('cz'),women_pct:g('wm'),youth_pct:g('yt'),size:g('sz'),disabled_owned:document.getElementById('db').checked});
        msg('rm',j.message,1);if(j.link)document.getElementById('lk').innerHTML='<p><a class="btn" href="'+j.link+'">Open my bid page</a></p><p class="muted">Keep this link private – it is your company\\'s key to this tender.</p>'}catch(e){msg('rm',e.message)}}</script>` : ''}`));
});
pub.post('/tenders/:slug/register', ...pj(async req => {
  const x = await PR.registerForTender(req.params.slug, req.body || {});
  const mailed = await PR.mailInvite(x.t, x.bd, baseUrl(req));
  // an email that already belongs to a supplier: the link goes only to that mailbox, never to the screen
  if (x.existing) return { message: mailed ? `This email is already registered – your bid link was sent to ${x.email}` : 'This email is already registered – ask the procurement office to send your bid link' };
  return { message: mailed ? `Registered – your bid link was also sent to ${x.email}` : 'Registered', link: `/s/${x.bd.token}` };
}));

module.exports = { router: r, pub };
