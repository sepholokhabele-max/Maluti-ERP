// EAN-13 helpers: check digits, scale-label parsing (price/weight embedded) and SVG rendering.
export function eanCheckDigit(d12) {
  const s = String(d12).split('').reduce((a, c, i) => a + Number(c) * (i % 2 ? 3 : 1), 0);
  return String((10 - (s % 10)) % 10);
}
export const isValidEan13 = code => /^\d{13}$/.test(code) && eanCheckDigit(code.slice(0, 12)) === code[12];

/**
 * Parse a scale label barcode. cfg: { barcode_prefixes:'20,21', barcode_item_digits:5, barcode_value_digits:5, barcode_value_type:'price'|'weight' }
 * Returns { plu, value, kind:'price'|'weight' } (price in currency units, weight in kg) or null.
 */
export function parseScaleBarcode(code, cfg) {
  code = String(code || '').trim();
  if (!cfg || !isValidEan13(code)) return null;
  const prefixes = String(cfg.barcode_prefixes || '').split(',').map(s => s.trim()).filter(Boolean);
  const pl = prefixes.length ? prefixes[0].length : 2;
  if (!prefixes.includes(code.slice(0, pl))) return null;
  const id = Number(cfg.barcode_item_digits || 5), vd = Number(cfg.barcode_value_digits || 5);
  const plu = code.slice(pl, pl + id);
  const raw = Number(code.slice(pl + id, pl + id + vd));
  const kind = cfg.barcode_value_type === 'weight' ? 'weight' : 'price';
  return { plu, kind, value: kind === 'weight' ? raw / 1000 : raw / 100 };
}

/** Build a scale-style barcode (prefix + PLU + price-in-cents or grams + check digit) */
export function buildScaleBarcode(prefix, plu, value, cfg) {
  const id = Number(cfg.barcode_item_digits || 5), vd = Number(cfg.barcode_value_digits || 5);
  const p = String(plu || '').replace(/\D/g, '');
  if (!p || p.length > id) return null;
  const v = Math.round(cfg.barcode_value_type === 'weight' ? value * 1000 : value * 100);
  if (v < 0 || String(v).length > vd) return null;
  const d12 = String(prefix) + p.padStart(id, '0') + String(v).padStart(vd, '0');
  return d12.length === 12 ? d12 + eanCheckDigit(d12) : null;
}

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** EAN-13 as an SVG string (scales to its container width) */
export function ean13Svg(code, { height = 60, text = true } = {}) {
  if (!isValidEan13(code)) return '';
  const d = code.split('').map(Number);
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (PARITY[d[0]][i - 1] === 'L' ? L : G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  bits += '101';
  const quiet = 9, w = bits.length + quiet * 2, th = text ? 10 : 0;
  let rects = '';
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') {
    const guard = i < 3 || (i >= 45 && i < 50) || i >= 92;
    rects += `<rect x="${i + quiet}" y="0" width="1" height="${height + (guard && text ? 5 : 0)}"/>`;
  }
  const t = text ? `<text x="3" y="${height + th}" font-size="9" font-family="monospace">${code[0]}</text><text x="${quiet + 6}" y="${height + th}" font-size="9" font-family="monospace" textLength="40">${code.slice(1, 7)}</text><text x="${quiet + 52}" y="${height + th}" font-size="9" font-family="monospace" textLength="40">${code.slice(7)}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${height + th + 2}" preserveAspectRatio="none" style="width:100%;height:auto" shape-rendering="crispEdges">${rects}${t}</svg>`;
}

/** Parse a scale's serial output into kg. Returns { kg, stable } or null. */
export function parseScaleOutput(text) {
  const lines = String(text || '').split(/[\r\n\x02\x03]+/).map(s => s.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const m = line.match(/([-+]?\s*\d+(?:[.,]\d+)?)\s*(kg|g|lb)?\b/i);
    if (!m) continue;
    let v = Number(m[1].replace(/\s/g, '').replace(',', '.'));
    if (!isFinite(v)) continue;
    const unit = (m[2] || 'kg').toLowerCase();
    if (unit === 'g') v = v / 1000;
    if (unit === 'lb') v = v * 0.45359237;
    const unstable = /\b(US|MO|motion)\b/i.test(line);
    const stable = /\b(ST|S\s?S)\b/i.test(line) || !unstable;
    return { kg: Math.round(v * 1000) / 1000, stable };
  }
  return null;
}
