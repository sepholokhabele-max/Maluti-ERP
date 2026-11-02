// QR codes: digital receipts (scan → receipt page with Add-to-Wallet buttons) and pay-by-QR on bills/invoices.
const os = require('os');
const crypto = require('crypto');
const QRCode = require('qrcode');
const db = require('../db');
const plugins = require('./plugins');

const DEFAULTS = { receipt_qr: true, base_url: '', receipt_qr_text: 'Scan for your digital receipt', pay_qr: true };

async function settings() { return { ...DEFAULTS, ...((await db.getSetting('qr', {})) || {}) }; }

/** LAN addresses customers' phones can reach while on the shop Wi-Fi */
function lanUrls(port = 8069) {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const n of list || [])
    if (n.family === 'IPv4' && !n.internal) out.push(`http://${n.address}:${port}`);
  return out;
}

let serverPort = 8069;
const setPort = p => { serverPort = p; };

async function baseUrl(req) {
  const s = await settings();
  if (s.base_url) return s.base_url.replace(/\/+$/, '');
  const lan = lanUrls(serverPort);
  return lan[0] || (req ? `${req.protocol}://${req.get('host')}` : 'http://localhost:8069');
}

const svg = (text, opts = {}) => QRCode.toString(String(text), { type: 'svg', margin: 1, errorCorrectionLevel: opts.ecl || 'M' });

async function ensureReceiptToken(conn, orderId) {
  const o = await conn.one('SELECT receipt_token FROM orders WHERE id = ?', [orderId]);
  if (!o) return null;
  if (o.receipt_token) return o.receipt_token;
  const t = crypto.randomBytes(18).toString('base64url').slice(0, 24);
  await conn.query('UPDATE orders SET receipt_token = ? WHERE id = ? AND receipt_token IS NULL', [t, orderId]);
  return (await conn.one('SELECT receipt_token FROM orders WHERE id = ?', [orderId])).receipt_token;
}

/** Adds receipt_url + receipt_qr_svg to a paid order (no-op when the feature is off) */
async function decorateOrder(conn, o, req) {
  const s = await settings();
  if (!s.receipt_qr || !['paid', 'refunded'].includes(o.status)) return o;
  const token = await ensureReceiptToken(conn, o.id);
  o.receipt_url = `${await baseUrl(req)}/r/${token}`;
  o.receipt_qr_svg = await svg(o.receipt_url);
  o.receipt_qr_text = s.receipt_qr_text;
  return o;
}

/** Fill a payment method's QR template */
function fillTemplate(tpl, vars) {
  return String(tpl).replace(/\{\{?\s*(amount|amount_cents|reference|merchant|company)\s*\}?\}/g, (_, k) => vars[k] == null ? '' : String(vars[k]));
}

/** Pay-by-QR codes for an amount, one per payment method that has a QR configured (or a payment plugin that makes one) */
async function payQrs({ amount, reference }) {
  const s = await settings();
  if (!s.pay_qr) return [];
  const company = (await db.getSetting('company', {})) || {};
  const methods = await db.query(`SELECT * FROM payment_methods WHERE active = 1 AND kind <> 'account' ORDER BY sort_order, id`);
  const out = [];
  for (const m of methods) {
    let payload = null, label = m.qr_label || `Pay with ${m.name}`;
    if (m.plugin_id) {
      try {
        const p = await plugins.get(m.plugin_id);
        if (typeof p.impl.paymentQr === 'function') {
          const r = await p.impl.paymentQr(p.config, { amount, reference });
          if (r && r.payload) { payload = r.payload; if (r.label) label = r.label; }
        }
      } catch (_) { /* plugin disabled or failing: fall back to template */ }
    }
    if (!payload && m.qr_payload) payload = fillTemplate(m.qr_payload, { amount: Number(amount).toFixed(2), amount_cents: Math.round(amount * 100), reference, company: company.name || '' });
    if (payload) out.push({ method_id: m.id, method: m.name, label, payload, svg: await svg(payload) });
  }
  return out;
}

module.exports = { setPort, DEFAULTS, settings, lanUrls, baseUrl, svg, ensureReceiptToken, decorateOrder, payQrs, fillTemplate };
