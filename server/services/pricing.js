// Pricing rules & promotions: percentage off, fixed price, amount off, multi-buy ("3 for 2"),
// limited to products/categories, customers or customer tags (e.g. "wholesale"), days, hours (happy hour) and dates.
// The same maths runs in the browser (public/js/pricing.js) so the till shows the price before the server confirms it.
const db = require('../db');

const pad = n => String(n).padStart(2, '0');
function localParts(when = new Date()) {
  return { date: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`,
    dow: when.getDay() === 0 ? 7 : when.getDay(), time: `${pad(when.getHours())}:${pad(when.getMinutes())}:00` };
}
const dstr = v => v ? (v instanceof Date ? `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}` : String(v).slice(0, 10)) : null;

function matches(rule, { product, qty, partner, when, channel }) {
  if (!Number(rule.active)) return false;
  if (channel === 'pos' && !Number(rule.on_pos)) return false;
  if (channel === 'invoice' && !Number(rule.on_invoice)) return false;
  const t = localParts(when);
  if (rule.date_from && t.date < dstr(rule.date_from)) return false;
  if (rule.date_to && t.date > dstr(rule.date_to)) return false;
  if (rule.days) { const ds = String(rule.days).split(',').map(Number).filter(Boolean); if (ds.length && !ds.includes(t.dow)) return false; }
  if (rule.time_from && rule.time_to) {
    const a = String(rule.time_from).slice(0, 8).padEnd(8, ':00'), b = String(rule.time_to).slice(0, 8).padEnd(8, ':00');
    const inside = a <= b ? (t.time >= a && t.time < b) : (t.time >= a || t.time < b); // overnight e.g. 22:00–02:00
    if (!inside) return false;
  }
  if (rule.applies_to === 'product' && Number(rule.product_id) !== Number(product.id)) return false;
  if (rule.applies_to === 'category' && Number(rule.category_id) !== Number(product.category_id)) return false;
  if (rule.customer_scope === 'partner' && (!partner || Number(partner.id) !== Number(rule.partner_id))) return false;
  if (rule.customer_scope === 'tag') {
    const tags = String((partner && partner.tags) || '').toLowerCase().split(',').map(s => s.trim());
    if (!partner || !tags.includes(String(rule.partner_tag || '').toLowerCase().trim())) return false;
  }
  if (Number(rule.min_qty) > 0 && Number(qty) + 1e-9 < Number(rule.min_qty)) return false;
  return true;
}

/** discount % a rule gives on one line */
function rulePct(rule, price, qty) {
  price = Number(price); qty = Number(qty); const v = Number(rule.value);
  if (!(price > 0) || !(qty > 0)) return 0;
  let p = 0;
  if (rule.kind === 'percent') p = v;
  else if (rule.kind === 'fixed_price') p = (price - v) / price * 100;
  else if (rule.kind === 'amount_off') p = v / price * 100;
  else if (rule.kind === 'multibuy') {
    const n = Number(rule.min_qty), free = Number(rule.free_qty);
    if (n > 0 && free > 0 && free < n) p = Math.floor(qty / n + 1e-9) * free / qty * 100;
  }
  return Math.max(0, Math.min(100, Math.round(p * 1000) / 1000));
}

/** best rule for a line → { pct, rule } (highest discount wins; rules never stack) */
function best(rules, ctx) {
  let out = { pct: 0, rule: null };
  for (const r of rules) {
    if (!matches(r, ctx)) continue;
    const p = rulePct(r, ctx.price ?? ctx.product.price, ctx.qty);
    if (p > out.pct) out = { pct: p, rule: r };
  }
  return out;
}

async function activeRules(conn = db) {
  return (conn.query ? conn : db).query('SELECT * FROM price_rules WHERE active = 1 ORDER BY id');
}

function describe(r) {
  const v = Number(r.value);
  return r.kind === 'percent' ? `${v}% off` : r.kind === 'fixed_price' ? `now ${v.toFixed(2)}` : r.kind === 'amount_off' ? `${v.toFixed(2)} off each`
    : `buy ${Number(r.min_qty)} pay ${Number(r.min_qty) - Number(r.free_qty)}`;
}

module.exports = { matches, rulePct, best, activeRules, describe };
