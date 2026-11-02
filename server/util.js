// Shared helpers
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = msg => new HttpError(400, msg);
const notFound = (what = 'Record') => new HttpError(404, `${what} not found`);

/** wrap async express handler */
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Compute line amounts. price may include or exclude tax.
 * Returns { net, tax, total } rounded to cents.
 */
function lineAmounts({ qty, unit_price, discount_pct = 0, tax_rate = 0, price_includes_tax = 1 }) {
  const gross = Number(qty) * Number(unit_price) * (1 - Number(discount_pct || 0) / 100);
  const r = Number(tax_rate || 0) / 100;
  let net, tax, total;
  if (Number(price_includes_tax)) {
    total = round2(gross);
    net = round2(total / (1 + r));
    tax = round2(total - net);
  } else {
    net = round2(gross);
    tax = round2(net * r);
    total = round2(net + tax);
  }
  return { net, tax, total };
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function pad(n, w = 6) { return String(n).padStart(w, '0'); }

function pick(obj, keys) {
  const o = {};
  for (const k of keys) if (obj[k] !== undefined) o[k] = obj[k];
  return o;
}

module.exports = { round2, HttpError, bad, notFound, ah, lineAmounts, today, pad, pick };
