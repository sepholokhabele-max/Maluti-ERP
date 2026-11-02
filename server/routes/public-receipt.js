// Public digital receipt: the QR on a printed receipt opens /r/<token> on the customer's phone.
// Shows the receipt and "Add to Samsung Wallet / Google Wallet" buttons from enabled wallet plugins.
const express = require('express');
const db = require('../db');
const plugins = require('../services/plugins');
const qr = require('../services/qr');

const r = express.Router();
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function loadReceipt(token) {
  if (!/^[A-Za-z0-9_-]{24}$/.test(token) || !db.isConnected()) return null;
  const o = await db.one(
    `SELECT o.*, u.name user_name, t.name table_name, p.name partner_name FROM orders o
     LEFT JOIN users u ON u.id = o.user_id LEFT JOIN restaurant_tables t ON t.id = o.table_id LEFT JOIN partners p ON p.id = o.partner_id
     WHERE o.receipt_token = ? AND o.status IN ('paid','refunded')`, [token]);
  if (!o) return null;
  o.lines = await db.query('SELECT name, qty, unit_price, discount_pct, line_total FROM order_lines WHERE order_id = ? ORDER BY id', [o.id]);
  o.payments = await db.query(`SELECT m.name method, p.amount, p.direction, p.reference FROM payments p JOIN payment_methods m ON m.id = p.method_id WHERE p.order_id = ? ORDER BY p.id`, [o.id]);
  o.vas = await db.query('SELECT service, provider, recipient, token, message FROM vas_transactions WHERE order_id = ?', [o.id]);
  return o;
}

async function walletButtons(o, company, url) {
  const out = [];
  for (const p of plugins.list().filter(x => x.type === 'wallet')) {
    try {
      const pl = await plugins.get(p.id);
      if (typeof pl.impl.addToWallet !== 'function') continue;
      const b = await pl.impl.addToWallet(pl.config, { company, order: o, receipt_url: url, token: o.receipt_token });
      if (b && b.url) out.push({ ...b, plugin: p.id });
    } catch (_) { /* disabled / misconfigured plugin: skip */ }
  }
  return out;
}

r.get('/r/:token', async (req, res) => {
  try {
    const o = await loadReceipt(req.params.token);
    res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex').set('Referrer-Policy', 'no-referrer');
    if (!o) return res.status(404).type('html').send('<!doctype html><meta name=viewport content="width=device-width"><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>Receipt not found</h2><p>This link is invalid or has been removed.</p></body>');
    const c = (await db.getSetting('company', {})) || {};
    const logo = await require('../services/logo').get();
    const url = `${await qr.baseUrl(req)}/r/${o.receipt_token}`;
    const buttons = await walletButtons(o, c, url);
    const m = n => `${esc(c.currency_symbol || 'M')} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const when = new Date(String(o.paid_at || o.created_at).replace(' ', 'T')).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Receipt ${esc(o.number)} – ${esc(c.name || '')}</title>
<style>
  :root{--b:#3f3d9e} *{box-sizing:border-box} body{margin:0;background:#eef0f6;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#1e2233}
  .wrap{max-width:460px;margin:0 auto;padding:16px} .card{background:#fff;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,.08);padding:20px}
  .hd{text-align:center;border-bottom:1px dashed #ccd;padding-bottom:14px} .hd img{max-width:180px;max-height:80px;object-fit:contain} .hd h1{font-size:20px;margin:8px 0 2px}
  .muted{color:#7a8099;font-size:13px} table{width:100%;border-collapse:collapse;margin-top:12px} td{padding:6px 0;vertical-align:top} .r{text-align:right;white-space:nowrap}
  .tot td{border-top:1px solid #e3e5ee;font-weight:700;font-size:18px;padding-top:10px} .sub td{color:#4b5168;font-size:14px}
  .tok{margin:14px 0;padding:12px;border:2px dashed #ca8a04;background:#fef9c3;border-radius:10px;text-align:center;font-family:Consolas,monospace;font-size:20px;font-weight:700;letter-spacing:1px}
  .btns{display:flex;flex-direction:column;gap:10px;margin-top:16px} .btn{display:flex;align-items:center;justify-content:center;gap:8px;padding:13px;border-radius:999px;text-decoration:none;font-weight:600;font-size:15px;border:0;cursor:pointer}
  .w-samsung{background:#000;color:#fff} .w-google{background:#000;color:#fff} .w-other{background:var(--b);color:#fff} .ghost{background:#fff;color:var(--b);border:1px solid #c7c9e6}
  .ft{text-align:center;margin-top:14px} @media print{.btns,.noprint{display:none}body{background:#fff}.card{box-shadow:none}}
</style></head><body><div class="wrap"><div class="card">
  <div class="hd">${logo ? `<img src="/api/company/logo?v=${logo.version}" alt="">` : ''}<h1>${esc(c.name || '')}</h1>
    <div class="muted">${esc(c.address || '')}${c.phone ? ' · ' + esc(c.phone) : ''}${c.tax_number ? '<br>VAT ' + esc(c.tax_number) : ''}</div></div>
  <div style="margin-top:12px"><b>${o.refund_of ? 'REFUND ' : ''}${esc(o.number)}</b><div class="muted">${esc(when)} · served by ${esc(o.user_name || '')}${o.table_name ? ' · table ' + esc(o.table_name) : ''}${o.partner_name ? '<br>Customer: ' + esc(o.partner_name) : ''}</div></div>
  <table>${o.lines.map(l => `<tr><td>${esc(l.name)}<div class="muted">${Number(l.qty)} × ${m(l.unit_price)}${Number(l.discount_pct) ? ` (−${Number(l.discount_pct)}%)` : ''}</div></td><td class="r">${m(l.line_total)}</td></tr>`).join('')}
    <tr class="sub"><td>Excl. VAT</td><td class="r">${m(o.subtotal)}</td></tr><tr class="sub"><td>VAT</td><td class="r">${m(o.tax_total)}</td></tr>
    <tr class="tot"><td>Total</td><td class="r">${m(o.total)}</td></tr>
    ${o.payments.map(p => `<tr class="sub"><td>${esc(p.method)}${p.reference ? ' · ' + esc(p.reference) : ''}</td><td class="r">${m(p.direction === 'out' ? -p.amount : p.amount)}</td></tr>`).join('')}
    ${Number(o.change_given) ? `<tr class="sub"><td>Change</td><td class="r">${m(o.change_given)}</td></tr>` : ''}</table>
  ${o.vas.filter(v => v.token).map(v => `<div class="muted" style="margin-top:12px">${esc(v.service)} token for ${esc(v.recipient)}</div><div class="tok">${esc(v.token)}</div>`).join('')}
  <div class="btns">
    ${buttons.map(b => `<a class="btn ${b.plugin.includes('samsung') ? 'w-samsung' : b.plugin.includes('google') ? 'w-google' : 'w-other'}" href="${esc(b.url)}" rel="noopener">${esc(b.label || 'Add to wallet')}</a>`).join('')}
    <button class="btn ghost" onclick="window.print()">Save / print receipt</button>
  </div>
  <div class="ft muted">${esc(c.receipt_footer || 'Thank you!')}</div></div>
  <div class="ft muted noprint" style="font-size:11px">Digital receipt · keep this link private</div></div></body></html>`);
  } catch (e) {
    console.error('[receipt page]', e);
    res.status(500).type('text').send('Receipt temporarily unavailable');
  }
});

module.exports = r;
