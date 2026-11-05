// Import data from another system (Excel .xlsx or CSV): every module has a template; columns are matched by name
// (English or Sesotho headings, common names used by other programs), rows are checked before anything is saved, and
// each row is created through the normal screens' API so all the usual rules apply. Rows that already exist are skipped,
// failed rows can be downloaded with the reason, fixed and imported again.
import { state, GET, POST, PUT, esc, $, $$, toast, err, can, hasMod, money, modal, tableHtml, badge, page, query, today } from './core.js';
import { workbook, download } from './xlsx.js';
import { L } from './i18n.js';

/* ---------------------------------------------------------------- reading files */
async function inflate(bytes, method) {
  if (method === 0) return bytes;
  const ds = new DecompressionStream('deflate-raw');
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
}
async function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This is not an Excel (.xlsx) file. In Excel use "Save as" → Excel Workbook (.xlsx) or CSV.');
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const files = {}; const dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    files[name] = { method, size, off };
    p += 46 + nl + el + cl;
  }
  return { names: Object.keys(files), read: async name => { const f = files[name]; if (!f) return null;
    const lnl = dv.getUint16(f.off + 26, true), lel = dv.getUint16(f.off + 28, true), start = f.off + 30 + lnl + lel;
    return dec.decode(await inflate(u8.subarray(start, start + f.size), f.method)); } };
}
const colIndex = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
async function readXlsx(buf) {
  const z = await unzip(buf); const xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const wb = xml(await z.read('xl/workbook.xml'));
  const rels = xml(await z.read('xl/_rels/workbook.xml.rels') || '<x/>');
  const sheets = [...wb.getElementsByTagName('sheet')].map(s => {
    const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const rel = [...rels.getElementsByTagName('Relationship')].find(x => x.getAttribute('Id') === rid);
    let target = rel ? rel.getAttribute('Target') : 'worksheets/sheet1.xml'; target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
    return { name: s.getAttribute('name'), path: 'xl/' + target, hidden: s.getAttribute('state') === 'hidden' };
  }).filter(s => !s.hidden);
  const ssx = await z.read('xl/sharedStrings.xml');
  const shared = ssx ? [...xml(ssx).getElementsByTagName('si')].map(si => [...si.getElementsByTagName('t')].map(t => t.textContent).join('')) : [];
  const out = [];
  for (const sh of sheets) {
    const doc = xml(await z.read(sh.path) || '<x/>'); const rows = [];
    for (const row of doc.getElementsByTagName('row')) {
      const arr = [];
      for (const c of row.getElementsByTagName('c')) {
        const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0];
        let val = '';
        if (t === 's') val = shared[Number(v && v.textContent)] ?? '';
        else if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map(x => x.textContent).join('');
        else if (t === 'b') val = v && v.textContent === '1' ? 'TRUE' : 'FALSE';
        else if (v) val = t === 'str' || t === 'e' ? v.textContent : (isFinite(Number(v.textContent)) ? Number(v.textContent) : v.textContent);
        arr[colIndex(c.getAttribute('r') || '')] = val;
      }
      rows[Number(row.getAttribute('r')) - 1] = arr;
    }
    out.push({ name: sh.name, rows: [...rows].map(r => (r || []).map(x => x ?? '')) });
  }
  return out;
}
function readCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split('\n')[0];
  const sep = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur.replace(/\r$/, '')); rows.push(row); }
  return [{ name: 'CSV', rows }];
}
export async function readFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xls')) throw new Error('Old .xls files cannot be read – open it in Excel and "Save as" Excel Workbook (.xlsx) or CSV.');
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return readXlsx(await file.arrayBuffer());
  return readCsv(await file.text());
}

/* ---------------------------------------------------------------- cleaning values */
const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
export function toNum(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim(); if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /-$/.test(s); s = s.replace(/[()]/g, '').replace(/-$/, '');
  s = s.replace(/^(m|r|lsl|zar|m\s|r\s)/i, '').replace(/[\s ']/g, '');
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s); if (!isFinite(n)) return NaN;
  return neg ? -n : n;
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const SESOTHO_MONTHS = ['phe', 'hlak', 'tlhak', 'mmes', 'mots', 'phupjan', 'phupu', 'phat', 'loet', 'mphal', 'pulun', 'tsits'];
const iso = (y, m, d) => { if (y < 100) y += y > 50 ? 1900 : 2000; const dt = new Date(Date.UTC(y, m - 1, d)); if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return NaN; return dt.toISOString().slice(0, 10); };
export function toDate(v, mdy = false) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') { if (v < 1 || v > 80000) return NaN; return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10); }
  const s = String(v).trim(); if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) return mdy ? iso(+m[3], +m[1], +m[2]) : iso(+m[3], +m[2], +m[1]);
  if ((m = s.match(/^(\d{1,2})[\s-]+([a-z]+)\.?[\s-,]+(\d{2,4})/i))) { const k = m[2].toLowerCase(); let mo = MONTHS.findIndex(x => k.startsWith(x)); if (mo < 0) mo = SESOTHO_MONTHS.findIndex(x => k.startsWith(x)); if (mo >= 0) return iso(+m[3], mo + 1, +m[1]); }
  if ((m = s.match(/^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/i))) { const mo = MONTHS.findIndex(x => m[1].toLowerCase().startsWith(x)); if (mo >= 0) return iso(+m[3], mo + 1, +m[2]); }
  if (/^\d{5}(\.\d+)?$/.test(s)) return toDate(Number(s));
  return NaN;
}
const toBool = v => /^(y|yes|true|1|x|✓|ee|e|on)$/i.test(String(v ?? '').trim());
function convert(f, raw, opt) {
  const blank = raw === null || raw === undefined || String(raw).trim() === '';
  if (blank) { if (f.req) throw L('is required', 'ea hlokahala'); return f.t === 'bool' ? undefined : null; }
  if (f.t === 'num' || f.t === 'int') { const n = toNum(raw); if (!isFinite(n)) throw L(`"${raw}" is not a number`, `"${raw}" hase palo`); return f.t === 'int' ? Math.round(n) : n; }
  if (f.t === 'date') { const d = toDate(raw, opt.mdy); if (!d || Number.isNaN(d)) throw L(`"${raw}" is not a date`, `"${raw}" hase letsatsi`); return d; }
  if (f.t === 'bool') return toBool(raw);
  if (f.t === 'enum') {
    const k = norm(raw); const hit = f.values.find(([v, ...names]) => [v, ...names].some(x => norm(x) === k));
    if (!hit) throw L(`"${raw}" – use one of: ${f.values.map(x => x[0]).join(', ')}`, `"${raw}" – sebelisa e 'ngoe ho: ${f.values.map(x => x[0]).join(', ')}`);
    return hit[0];
  }
  return String(raw).trim();
}

/* ---------------------------------------------------------------- shared lookups during an import */
function makeCtx() {
  const cache = {};
  const ctx = {
    async list(w) { if (!cache[w]) Object.assign(cache, await GET('/import/index?what=' + w)); return cache[w]; },
    async partner(name, extra = {}) {
      const ps = await ctx.list('partners'); const k = norm(name);
      const hit = ps.find(p => norm(p.name) === k && (!extra.phone || !p.phone || norm(p.phone) === norm(extra.phone))) || ps.find(p => norm(p.name) === k);
      if (hit) {
        const upd = {}; if (extra.is_customer && !hit.is_customer) upd.is_customer = 1; if (extra.is_supplier && !hit.is_supplier) upd.is_supplier = 1;
        if (Object.keys(upd).length) { await PUT('/partners/' + hit.id, upd); Object.assign(hit, upd); }
        return hit.id;
      }
      const o = await POST('/partners', { name, ...extra }); ps.push({ id: o.id, name, phone: extra.phone, is_customer: extra.is_customer, is_supplier: extra.is_supplier }); return o.id;
    },
    async named(w, name, create) {
      const xs = await ctx.list(w); const k = norm(name);
      const hit = xs.find(x => norm(x.name) === k || (x.code && norm(x.code) === k)); if (hit) return hit.id;
      if (!create) throw L(`"${name}" not found`, `"${name}" ha e fumanehe`);
      const o = await create(); xs.push({ id: o.id, name }); return o.id;
    }
  };
  return ctx;
}
const nm = (a, b) => `${a || ''} ${b || ''}`.trim();
const nextDue = day => { const t = new Date(); let d = new Date(t.getFullYear(), t.getMonth(), day); if (d <= t) d = new Date(t.getFullYear(), t.getMonth() + 1, day); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/* ---------------------------------------------------------------- what can be imported */
// field: key, label, t (text|num|int|date|bool|enum), req, aka (other column names), values for enums [value, ...other names]
const F = (key, label, t = 'text', o = {}) => ({ key, label, t, ...o });
const SEX = [['F', 'female', 'f', 'mosali', 'woman', 'girl'], ['M', 'male', 'm', 'monna', 'man', 'boy']];
export const KINDS = [
  { key: 'products', group: 'Stock', perm: 'catalog', title: ['Products & opening stock', 'Lihlahisoa le setoko sa ho qala'],
    desc: ['Items you sell or use, with prices, and the stock you have now.', 'Lintho tseo u li rekisang, litheko le setoko seo u nang le sona hona joale.'],
    note: ['Opening stock is valued at the cost price and booked to Opening balances. Batch number and expiry are used for medicines and food.', 'Setoko sa ho qala se baloa ka theko eo u rekileng ka eona.'],
    fields: [F('name', 'Name', 'text', { req: 1, aka: ['product', 'item', 'description', 'product name', 'item name', 'lebitso', 'sehlahisoa'] }), F('sku', 'Code / SKU', 'text', { aka: ['code', 'item code', 'product code', 'stock code', 'khoutu'] }),
      F('barcode', 'Barcode', 'text', { aka: ['ean', 'upc', 'bar code'] }), F('category', 'Category', 'text', { aka: ['group', 'department', 'mofuta'] }),
      F('type', 'Type', 'enum', { values: [['stock', 'inventory', 'stocked', 'product', 'goods'], ['service', 'non-inventory', 'labour', 'tšebeletso'], ['consumable', 'non-stock']] }),
      F('uom', 'Unit', 'text', { aka: ['uom', 'unit of measure', 'units'] }), F('price', 'Selling price incl. VAT', 'num', { req: 1, aka: ['price', 'selling price', 'sell price', 'retail price', 'theko', 'unit price'] }),
      F('cost', 'Cost price', 'num', { aka: ['cost', 'average cost', 'purchase price', 'buying price', 'unit cost', 'litšenyehelo'] }), F('vat', 'VAT %', 'num', { aka: ['tax', 'vat rate', 'tax rate'] }),
      F('qty', 'Quantity in stock', 'num', { aka: ['qty', 'quantity', 'on hand', 'stock', 'qty on hand', 'soh', 'palo'] }), F('reorder_level', 'Re-order level', 'num', { aka: ['reorder', 'min', 'minimum', 'reorder point'] }),
      F('track_batches', 'Track batches & expiry (yes/no)', 'bool'), F('batch_no', 'Batch number', 'text', { aka: ['batch', 'lot', 'lot number'] }), F('expiry_date', 'Expiry date', 'date', { aka: ['expiry', 'expires', 'best before', 'exp date'] })],
    exists: async (r, ctx) => (await ctx.list('products')).find(p => (r.sku && norm(p.sku) === norm(r.sku)) || (r.barcode && p.barcode === r.barcode) || (!r.sku && !r.barcode && norm(p.name) === norm(r.name))),
    async run(r, ctx) {
      const cats = await ctx.list('categories'); const taxes = await ctx.list('taxes');
      let category_id = null;
      if (r.category) { const k = norm(r.category); let c = cats.find(x => norm(x.name) === k); if (!c) { const o = await POST('/categories', { name: r.category }); c = { id: o.id, name: r.category }; cats.push(c); } category_id = c.id; }
      const tax = r.vat !== null && r.vat !== undefined ? taxes.find(t => Math.abs(Number(t.rate) - r.vat) < 0.01) : taxes.find(t => Number(t.rate) > 0) || taxes[0];
      if (r.vat !== null && r.vat !== undefined && !tax) throw L(`no VAT rate of ${r.vat}% – add it under Settings → Taxes`, `ha ho VAT ea ${r.vat}%`);
      const batch = r.track_batches || r.batch_no || r.expiry_date;
      const o = await POST('/products', { name: r.name, sku: r.sku, barcode: r.barcode, category_id, type: r.type || 'stock', uom: r.uom || 'Unit', price: r.price, cost: r.cost || 0, tax_id: tax ? tax.id : null,
        reorder_level: r.reorder_level || 0, track_batches: batch ? 1 : 0, opening_qty: r.qty || 0, opening_batch_no: r.batch_no, opening_expiry: r.expiry_date });
      (await ctx.list('products')).push({ id: o.id, name: r.name, sku: r.sku, barcode: r.barcode, stock_qty: r.qty || 0 });
    } },
  { key: 'stock', group: 'Stock', perm: 'inventory', title: ['Stock on hand (existing products)', 'Setoko se teng'],
    desc: ['Add the quantities you have now to products that are already set up – one row per batch if you track expiry.', 'Kenya palo ea setoko ho lihlahisoa tse seng li le teng.'],
    note: ['Each row adds to the stock; it does not replace it. Valued at the cost given (or the product\'s cost) and booked to Opening balances.', 'Mola o mong le o mong o eketsa setoko.'],
    fields: [F('product', 'Product code, barcode or name', 'text', { req: 1, aka: ['sku', 'code', 'item code', 'barcode', 'name', 'product', 'item'] }), F('qty', 'Quantity', 'num', { req: 1, aka: ['qty', 'quantity', 'on hand', 'stock', 'palo'] }),
      F('cost', 'Cost price', 'num', { aka: ['cost', 'unit cost', 'average cost'] }), F('batch_no', 'Batch number', 'text', { aka: ['batch', 'lot'] }), F('expiry_date', 'Expiry date', 'date', { aka: ['expiry', 'expires'] }), F('location', 'Branch / warehouse', 'text', { aka: ['location', 'store', 'warehouse', 'branch'] })],
    async run(r, ctx) {
      const ps = await ctx.list('products'); const k = norm(r.product);
      const p = ps.find(x => (x.sku && norm(x.sku) === k) || (x.barcode && norm(x.barcode) === k)) || ps.find(x => norm(x.name) === k);
      if (!p) throw L(`product "${r.product}" not found – import products first`, `sehlahisoa "${r.product}" ha se fumanehe`);
      if (p.type && p.type !== 'stock') throw L(`${p.name} is not a stock item`, `${p.name} hase sehlahisoa sa setoko`);
      let location_id;
      if (r.location) { const ls = await ctx.list('locations'); const l = ls.find(x => norm(x.name) === norm(r.location) || norm(x.code) === norm(r.location)); if (!l) throw L(`branch "${r.location}" not found`, `lekala "${r.location}" ha le fumanehe`); location_id = l.id; }
      await POST('/inventory/adjust', { opening: 1, reason: 'Opening stock (import)', location_id, lines: [{ product_id: p.id, add_qty: r.qty, unit_cost: r.cost, batch_no: r.batch_no, expiry_date: r.expiry_date }] });
      p.stock_qty = Number(p.stock_qty || 0) + r.qty;
    } },
  { key: 'customers', group: 'Contacts', perm: 'partners', title: ['Customers', 'Bareki'], desc: ['Names, phone numbers, email and addresses of your customers.', 'Mabitso, linomoro tsa mohala le liaterese tsa bareki.'],
    fields: [F('name', 'Name', 'text', { req: 1, aka: ['customer', 'customer name', 'client', 'company', 'account name', 'lebitso', 'moreki'] }), F('phone', 'Phone', 'text', { aka: ['mobile', 'cell', 'tel', 'telephone', 'contact number', 'mohala'] }),
      F('email', 'Email', 'text', { aka: ['e-mail', 'email address'] }), F('address', 'Address', 'text', { aka: ['physical address', 'postal address', 'aterese'] }), F('tax_number', 'Tax / VAT number', 'text', { aka: ['vat number', 'tin', 'tax number', 'vat no'] }),
      F('contact_person', 'Contact person', 'text', { aka: ['contact', 'attention'] }), F('credit_limit', 'Credit limit', 'num'), F('birthday', 'Birthday', 'date'), F('tags', 'Tags', 'text'), F('notes', 'Notes', 'text', { aka: ['comments', 'memo'] })],
    exists: async (r, ctx) => (await ctx.list('partners')).find(p => norm(p.name) === norm(r.name) && p.is_customer),
    async run(r, ctx) { const id = await ctx.partner(r.name, { is_customer: 1, phone: r.phone });
      const upd = only({ phone: r.phone, email: r.email, address: r.address, tax_number: r.tax_number, contact_person: r.contact_person, credit_limit: r.credit_limit, birthday: r.birthday, tags: r.tags, notes: r.notes }); if (Object.keys(upd).length) await PUT('/partners/' + id, upd); } },
  { key: 'suppliers', group: 'Contacts', perm: 'partners', title: ['Suppliers', 'Barekisi'], desc: ['Companies you buy from.', 'Likhamphani tseo u rekang ho tsona.'],
    fields: [F('name', 'Name', 'text', { req: 1, aka: ['supplier', 'supplier name', 'vendor', 'creditor', 'company', 'lebitso'] }), F('phone', 'Phone', 'text', { aka: ['mobile', 'cell', 'tel', 'telephone', 'mohala'] }), F('email', 'Email', 'text'),
      F('address', 'Address', 'text'), F('tax_number', 'Tax / VAT number', 'text', { aka: ['vat number', 'tin'] }), F('contact_person', 'Contact person', 'text', { aka: ['contact', 'rep'] }), F('notes', 'Notes', 'text')],
    exists: async (r, ctx) => (await ctx.list('partners')).find(p => norm(p.name) === norm(r.name) && p.is_supplier),
    async run(r, ctx) { const id = await ctx.partner(r.name, { is_supplier: 1, phone: r.phone });
      const upd = only({ phone: r.phone, email: r.email, address: r.address, tax_number: r.tax_number, contact_person: r.contact_person, notes: r.notes }); if (Object.keys(upd).length) await PUT('/partners/' + id, upd); } },
  { key: 'customer_balances', group: 'Opening balances', perm: 'invoicing', title: ['What customers owe (unpaid invoices)', 'Seo bareki ba se kolotang'],
    desc: ['One row per unpaid invoice (or one total per customer) from the old system, so statements, ageing and reminders are right from day one.', 'Mola o le mong bakeng sa invoice e ’ngoe le e ’ngoe e sa lefuoang.'],
    note: ['Booked against Opening balances (account 3000) – leave debtors out of the trial balance import. Customers are created if missing. Import a file only once.', 'Leha u kenya likoloto, u se ke ua kenya debtors ho trial balance.'],
    fields: [F('customer', 'Customer', 'text', { req: 1, aka: ['customer name', 'name', 'account', 'client', 'debtor', 'tenant', 'parent', 'moreki'] }), F('phone', 'Phone', 'text', { aka: ['mobile', 'cell', 'mohala'] }),
      F('reference', 'Old invoice number', 'text', { aka: ['invoice', 'invoice no', 'invoice number', 'ref', 'document', 'doc no'] }), F('date', 'Invoice date', 'date', { req: 1, aka: ['invoice date', 'doc date', 'letsatsi'] }),
      F('due_date', 'Due date', 'date', { aka: ['due'] }), F('amount', 'Amount still owed', 'num', { req: 1, aka: ['balance', 'outstanding', 'amount due', 'open amount', 'owing', 'amount', 'chelete'] })],
    async run(r, ctx) {
      if (r.amount <= 0) throw L('amount must be more than 0 (enter credits as payments after the import)', 'chelete e tlameha ho feta 0');
      const pid = await ctx.partner(r.customer, { is_customer: 1, phone: r.phone });
      const desc = `Opening balance${r.reference ? ' – old invoice ' + r.reference : ''}`;
      const inv = await POST('/invoices', { kind: 'customer_invoice', partner_id: pid, invoice_date: r.date, due_date: r.due_date || r.date, notes: desc, lines: [{ description: desc, qty: 1, unit_price: r.amount, tax_rate: 0, account_code: '3000' }] });
      await POST(`/invoices/${inv.id}/post`);
    } },
  { key: 'supplier_balances', group: 'Opening balances', perm: 'invoicing', title: ['What you owe suppliers (unpaid bills)', 'Seo u se kolotang barekisi'],
    desc: ['One row per unpaid supplier invoice from the old system.', 'Mola o le mong bakeng sa bili e ’ngoe le e ’ngoe e sa lefuoang.'],
    note: ['Booked against Opening balances (3000) – leave creditors out of the trial balance import.', 'U se ke ua kenya creditors ho trial balance.'],
    fields: [F('supplier', 'Supplier', 'text', { req: 1, aka: ['supplier name', 'name', 'vendor', 'creditor', 'account'] }), F('reference', 'Their invoice number', 'text', { aka: ['invoice', 'invoice no', 'ref', 'document'] }),
      F('date', 'Invoice date', 'date', { req: 1, aka: ['invoice date', 'doc date'] }), F('due_date', 'Due date', 'date', { aka: ['due'] }), F('amount', 'Amount still owed', 'num', { req: 1, aka: ['balance', 'outstanding', 'amount due', 'amount'] })],
    async run(r, ctx) {
      if (r.amount <= 0) throw L('amount must be more than 0', 'chelete e tlameha ho feta 0');
      const pid = await ctx.partner(r.supplier, { is_supplier: 1 });
      const desc = `Opening balance${r.reference ? ' – invoice ' + r.reference : ''}`;
      const inv = await POST('/invoices', { kind: 'supplier_bill', partner_id: pid, invoice_date: r.date, due_date: r.due_date || r.date, notes: desc, lines: [{ description: desc, qty: 1, unit_price: r.amount, tax_rate: 0, account_code: '3000' }] });
      await POST(`/invoices/${inv.id}/post`);
    } },
  { key: 'trial_balance', group: 'Opening balances', perm: 'accounting', title: ['Trial balance (opening balances)', 'Trial balance ea ho qala'],
    desc: ['Account balances on the day you start: bank, cash, loans, assets, capital…', 'Libalance tsa liakhaonte letsatsing leo u qalang ka lona.'],
    note: ['All rows become one opening journal. Leave out debtors (1100), creditors (2000) and stock (1200) if you import those separately – any difference goes to Opening balances (3000). New account codes are created when a name and type are given.', 'Mela eohle e etsa journal e le ’ngoe.'],
    fields: [F('code', 'Account code', 'text', { req: 1, aka: ['account', 'account code', 'gl code', 'acc', 'account number', 'khoutu'] }), F('name', 'Account name', 'text', { aka: ['account name', 'description'] }),
      F('type', 'Account type', 'enum', { values: [['asset', 'assets', 'current asset', 'fixed asset', 'bank'], ['liability', 'liabilities', 'current liability'], ['equity', 'capital'], ['income', 'revenue', 'sales'], ['expense', 'expenses', 'cost of sales']] }),
      F('debit', 'Debit', 'num', { aka: ['dr', 'debit balance'] }), F('credit', 'Credit', 'num', { aka: ['cr', 'credit balance'] }), F('balance', 'Balance (+ debit / − credit)', 'num', { aka: ['amount', 'closing balance'] }), F('date', 'Opening date', 'date', { aka: ['as at', 'date'] })],
    async run(r, ctx) {
      const accs = await ctx.list('accounts'); let a = accs.find(x => norm(x.code) === norm(r.code));
      if (!a) { if (!r.name || !r.type) throw L(`account ${r.code} does not exist – give its name and type to create it`, `akhaonte ${r.code} ha e eo`); await POST('/accounts', { code: r.code, name: r.name, type: r.type }); a = { code: r.code }; accs.push(a); }
      const amt = (r.debit || 0) - (r.credit || 0) + (r.balance || 0);
      if (Math.abs(amt) < 0.005) return 'skip';
      (ctx.tb = ctx.tb || []).push({ code: a.code, amt }); if (r.date) ctx.tbDate = r.date;
    },
    async finish(ctx) {
      if (!ctx.tb || !ctx.tb.length) return '';
      const lines = ctx.tb.map(x => x.amt > 0 ? { code: x.code, debit: Math.round(x.amt * 100) / 100 } : { code: x.code, credit: Math.round(-x.amt * 100) / 100 });
      const diff = Math.round(ctx.tb.reduce((t, x) => t + x.amt, 0) * 100) / 100;
      if (diff) lines.push(diff > 0 ? { code: '3000', credit: diff } : { code: '3000', debit: -diff });
      await POST('/journal', { date: ctx.tbDate || today(), reference: 'OPENING', memo: 'Opening balances (import)', lines });
      return diff ? L(`Opening journal posted; the difference of ${money(diff)} went to Opening balances (3000).`, `Journal e kentsoe; phapang ea ${money(diff)} e ile ho 3000.`) : L('Opening journal posted and balanced.', 'Journal e kentsoe ’me e leka-lekane.');
    } },
  { key: 'employees', group: 'People', perm: 'hrm', mod: 'hrm', title: ['Employees', 'Basebetsi'], desc: ['Staff with ID, job, salary and bank or mobile-money details for payroll.', 'Basebetsi ba nang le ID, mosebetsi, moputso le lintlha tsa banka.'],
    fields: [F('first_name', 'First name', 'text', { req: 1, aka: ['first name', 'name', 'firstname', 'forename', 'lebitso'] }), F('last_name', 'Surname', 'text', { req: 1, aka: ['surname', 'last name', 'lastname', 'family name', 'fane'] }),
      F('code', 'Employee number', 'text', { aka: ['employee no', 'emp no', 'staff no', 'employee code', 'payroll number'] }), F('id_number', 'ID / passport number', 'text', { aka: ['id', 'id number', 'passport', 'national id'] }),
      F('tin', 'TIN', 'text', { aka: ['tax number', 'tin number'] }), F('gender', 'Gender', 'enum', { values: [['female', 'f', 'woman', 'mosali'], ['male', 'm', 'man', 'monna'], ['other']] }), F('birth_date', 'Date of birth', 'date', { aka: ['dob', 'birth date', 'born', 'letsatsi la tsoalo'] }),
      F('phone', 'Phone', 'text', { aka: ['mobile', 'cell', 'mohala'] }), F('email', 'Email', 'text'), F('address', 'Address', 'text'), F('job_title', 'Job title', 'text', { aka: ['position', 'title', 'designation', 'job', 'mosebetsi'] }),
      F('hire_date', 'Start date', 'date', { req: 1, aka: ['start date', 'date engaged', 'engagement date', 'hire date', 'employed'] }), F('basic_salary', 'Monthly basic salary', 'num', { req: 1, aka: ['salary', 'basic', 'basic salary', 'monthly salary', 'rate', 'moputso'] }),
      F('employment_type', 'Employment type', 'enum', { values: [['permanent', 'perm', 'full time'], ['fixed_term', 'contract', 'fixed term'], ['casual', 'temporary', 'temp'], ['intern', 'internship']] }),
      F('pay_method', 'Paid by', 'enum', { values: [['bank', 'eft', 'bank transfer'], ['cash'], ['mobile_money', 'mpesa', 'm-pesa', 'ecocash', 'mobile money']] }), F('bank_name', 'Bank', 'text', { aka: ['bank name'] }), F('bank_account', 'Bank account number', 'text', { aka: ['account number', 'account no', 'bank account'] }),
      F('mobile_money_number', 'M-Pesa / EcoCash number', 'text', { aka: ['mpesa', 'ecocash', 'mobile money number'] }), F('emergency_contact', 'Emergency contact', 'text', { aka: ['next of kin'] })],
    exists: async (r, ctx) => (await ctx.list('employees')).find(e => (r.code && norm(e.code) === norm(r.code)) || (r.id_number && norm(e.id_number) === norm(r.id_number)) || (norm(e.first_name) === norm(r.first_name) && norm(e.last_name) === norm(r.last_name))),
    async run(r) { await POST('/hrm/employees', { ...r, employment_type: r.employment_type || 'permanent', pay_method: r.pay_method || 'bank', status: 'active', paye_applies: 1 }); } },
  { key: 'patients', group: 'Sector', perm: 'patients', mod: 'patients', title: ['Patients', 'Bakuli'], desc: ['Patient files with allergies, chronic conditions and medical aid.', 'Lifaele tsa bakuli tse nang le li-allergy le medical aid.'],
    fields: [F('first_name', 'First name', 'text', { req: 1, aka: ['first name', 'name', 'lebitso'] }), F('last_name', 'Surname', 'text', { aka: ['surname', 'last name', 'fane'] }), F('file_no', 'File number', 'text', { aka: ['file', 'file no', 'patient no', 'patient number', 'folder'] }),
      F('dob', 'Date of birth', 'date', { aka: ['dob', 'birth date', 'born', 'letsatsi la tsoalo'] }), F('sex', 'Sex', 'enum', { values: SEX }), F('id_number', 'ID number', 'text', { aka: ['id', 'passport'] }), F('phone', 'Phone', 'text', { aka: ['mobile', 'cell', 'mohala'] }),
      F('address', 'Address / village', 'text', { aka: ['village', 'address', 'motse'] }), F('allergies', 'Allergies', 'text', { aka: ['allergy', 'allergic to'] }), F('chronic', 'Chronic conditions', 'text', { aka: ['chronic', 'conditions', 'medical history'] }),
      F('medical_aid', 'Medical aid', 'text', { aka: ['scheme', 'medical scheme', 'insurer'] }), F('medical_aid_no', 'Membership number', 'text', { aka: ['member no', 'membership no', 'member number'] }), F('main_member', 'Main member', 'text'),
      F('next_of_kin', 'Next of kin', 'text'), F('next_of_kin_phone', 'Next of kin phone', 'text'), F('blood_group', 'Blood group', 'text')],
    exists: async (r, ctx) => (await ctx.list('patients')).find(p => (r.file_no && norm(p.file_no) === norm(r.file_no)) || (r.id_number && norm(p.id_number) === norm(r.id_number))),
    async run(r, ctx) {
      let medical_aid_id = null;
      if (r.medical_aid) medical_aid_id = await ctx.named('medical_aids', r.medical_aid, () => POST('/medical-aids', { name: r.medical_aid }));
      if (medical_aid_id && !r.medical_aid_no) throw L('membership number missing', 'nomoro ea setho ha e eo');
      await POST('/patients', { ...r, medical_aid_id });
    } },
  { key: 'learners', group: 'Sector', perm: 'school', mod: 'school', title: ['Learners', 'Baithuti'], desc: ['Learners with their class and the parent or guardian who pays.', 'Baithuti le sehlopha le motsoali ea lefang.'],
    note: ['Classes are created if missing. Fees owed from last year: import "What customers owe" with the parent\'s name.', 'Lihlopha li etsoa haeba li le sieo.'],
    fields: [F('first_name', 'First name', 'text', { req: 1, aka: ['first name', 'name', 'lebitso'] }), F('last_name', 'Surname', 'text', { req: 1, aka: ['surname', 'last name', 'fane'] }), F('admission_no', 'Admission number', 'text', { aka: ['admission', 'adm no', 'student number', 'learner number'] }),
      F('class', 'Class', 'text', { req: 1, aka: ['class', 'grade', 'form', 'standard', 'sehlopha', 'tlelase'] }), F('gender', 'Gender', 'enum', { values: SEX }), F('birth_date', 'Date of birth', 'date', { aka: ['dob', 'birth date', 'letsatsi la tsoalo'] }),
      F('guardian_name', 'Parent / guardian', 'text', { req: 1, aka: ['parent', 'guardian', 'parent name', 'guardian name', 'motsoali'] }), F('guardian_phone', 'Parent phone', 'text', { req: 1, aka: ['parent phone', 'guardian phone', 'phone', 'mobile', 'cell'] }),
      F('guardian_email', 'Parent email', 'text'), F('bursary_pct', 'Bursary %', 'num', { aka: ['bursary', 'discount'] }), F('enrolled_on', 'Enrolled on', 'date', { aka: ['admission date', 'enrolled'] }), F('medical', 'Medical notes', 'text')],
    exists: async (r, ctx) => (await ctx.list('learners')).find(l => (r.admission_no && norm(l.admission_no) === norm(r.admission_no)) || (!r.admission_no && norm(l.first_name) === norm(r.first_name) && norm(l.last_name) === norm(r.last_name))),
    async run(r, ctx) { const class_id = await ctx.named('classes', r.class, () => POST('/school/classes', { name: r.class, grade: r.class })); await POST('/learners', { ...r, class_id }); } },
  { key: 'units', group: 'Sector', perm: 'property', mod: 'property', title: ['Buildings & units', 'Meaho le likamore'], desc: ['Flats, houses, rooms, shops and offices you let.', 'Lifolete, matlo, likamore, mabenkele le liofisi tseo u li hirisang.'],
    fields: [F('building', 'Building', 'text', { req: 1, aka: ['property', 'building name', 'estate', 'complex', 'moaho'] }), F('address', 'Building address', 'text'), F('unit', 'Unit', 'text', { req: 1, aka: ['unit', 'flat', 'room', 'shop', 'door', 'unit no'] }),
      F('kind', 'Kind', 'enum', { values: [['flat', 'apartment'], ['house'], ['room'], ['shop', 'retail'], ['office'], ['warehouse', 'store'], ['site', 'stand'], ['other']] }), F('bedrooms', 'Bedrooms', 'int'), F('size_m2', 'Size m²', 'num', { aka: ['size', 'm2'] }),
      F('market_rent', 'Rent asked', 'num', { aka: ['rent', 'market rent', 'asking rent'] }), F('meter_no', 'Electricity meter', 'text', { aka: ['meter', 'meter number'] })],
    exists: async (r, ctx) => (await ctx.list('units')).find(u => norm(u.name) === norm(r.unit) && norm(u.property_name) === norm(r.building)),
    async run(r, ctx) { await unitFor(r, ctx); } },
  { key: 'leases', group: 'Sector', perm: 'property', mod: 'property', title: ['Tenants & leases', 'Bahiri le likonteraka'], desc: ['Who rents which unit, for how much, and the deposit you hold.', 'Mohiri ea hirileng kamore efe, ka bokae, le depositi.'],
    note: ['Rent is invoiced here from the next rent date (old months are not billed again). Unpaid rent from the old system: import "What customers owe" with the tenant\'s name. Units and buildings are created if missing.', 'Rente e qala ho bilioa letsatsing le latelang la rente.'],
    fields: [F('building', 'Building', 'text', { req: 1, aka: ['property', 'building name', 'moaho'] }), F('unit', 'Unit', 'text', { req: 1, aka: ['unit', 'flat', 'room', 'shop', 'door'] }),
      F('tenant', 'Tenant', 'text', { req: 1, aka: ['tenant name', 'name', 'lessee', 'mohiri'] }), F('phone', 'Tenant phone', 'text', { aka: ['phone', 'mobile', 'cell', 'tenant phone', 'mohala'] }), F('email', 'Tenant email', 'text'),
      F('start_date', 'Lease start', 'date', { req: 1, aka: ['start', 'start date', 'lease start', 'from', 'occupation date'] }), F('end_date', 'Lease end', 'date', { aka: ['end', 'end date', 'to', 'expiry'] }),
      F('rent', 'Monthly rent', 'num', { req: 1, aka: ['rent', 'monthly rent', 'rental', 'rente'] }), F('tax_rate', 'VAT % on rent', 'num', { aka: ['vat'] }), F('due_day', 'Rent due day', 'int', { aka: ['due day', 'payment day'] }),
      F('deposit', 'Deposit agreed', 'num', { aka: ['deposit'] }), F('deposit_held', 'Deposit held now', 'num', { aka: ['deposit held', 'deposit paid', 'deposit received'] }), F('escalation_pct', 'Yearly increase %', 'num', { aka: ['escalation', 'increase'] }),
      F('next_rent_date', 'Next rent invoice date', 'date', { aka: ['next invoice', 'bill from'] })],
    async run(r, ctx) {
      const unit_id = await unitFor(r, ctx);
      const u = (await ctx.list('units')).find(x => x.id === unit_id); if (u && u.let) throw L(`${r.unit} already has a running lease`, `${r.unit} e se e hirisitsoe`);
      const tenant_id = await ctx.partner(r.tenant, { is_customer: 1, phone: r.phone, email: r.email, tags: 'tenant' });
      const day = Math.max(1, Math.min(28, r.due_day || 1));
      const l = await POST('/leases', { unit_id, tenant_id, start_date: r.start_date, end_date: r.end_date, rent: r.rent, tax_rate: r.tax_rate || 0, due_day: day, deposit: r.deposit || r.deposit_held || 0, escalation_pct: r.escalation_pct || 0 });
      await POST(`/leases/${l.id}/activate`, { bill_from: r.next_rent_date || nextDue(day), opening_deposit: r.deposit_held || 0 });
      if (u) u.let = 1;
    } },
  { key: 'hire_items', group: 'Sector', perm: 'hire', mod: 'hire', title: ['Hire items', 'Lintho tse hirisoang'], desc: ['Tents, chairs, tables, scaffolding, machines you hire out.', 'Litente, litulo, litafole, lisebelisoa tse hirisoang.'],
    fields: [F('name', 'Item', 'text', { req: 1, aka: ['item', 'name', 'description'] }), F('code', 'Code', 'text'), F('category', 'Category', 'text'), F('qty_owned', 'Quantity owned', 'num', { aka: ['qty', 'quantity', 'owned'] }),
      F('rate_day', 'Price per day', 'num', { req: 1, aka: ['day rate', 'per day', 'daily rate', 'price'] }), F('rate_week', 'Price per week', 'num', { aka: ['week rate', 'weekly'] }), F('rate_month', 'Price per month', 'num', { aka: ['month rate', 'monthly'] }),
      F('deposit', 'Deposit', 'num'), F('replacement_cost', 'Replacement cost', 'num', { aka: ['replacement', 'value'] })],
    exists: async (r, ctx) => (await ctx.list('hire_items')).find(x => norm(x.name) === norm(r.name)),
    async run(r) { await POST('/hire/items', r); } },
  { key: 'vehicles', group: 'Sector', perm: 'fleet', mod: 'fleet', title: ['Vehicles', 'Likoloi'], desc: ['Trucks, buses, taxis and cars with their papers\' expiry dates.', 'Literaka, libese, litekesi le likoloi.'],
    fields: [F('reg_no', 'Registration', 'text', { req: 1, aka: ['reg', 'registration', 'reg no', 'number plate', 'plate'] }), F('name', 'Nickname', 'text'),
      F('kind', 'Type', 'enum', { values: [['car', 'sedan'], ['bakkie', 'ldv', 'pickup', 'pick-up'], ['truck', 'lorry'], ['bus'], ['taxi', 'quantum', 'minibus'], ['motorbike', 'motorcycle'], ['trailer'], ['other']] }),
      F('make', 'Make', 'text'), F('model', 'Model', 'text'), F('year', 'Year', 'int'), F('fuel', 'Fuel', 'enum', { values: [['diesel'], ['petrol', 'gasoline', 'unleaded'], ['other']] }), F('seats', 'Seats', 'int'), F('capacity_tons', 'Load tons', 'num'),
      F('odometer', 'Odometer km', 'int', { aka: ['km', 'mileage', 'odo'] }), F('driver', 'Driver', 'text'), F('licence_expiry', 'Licence disc expires', 'date', { aka: ['licence', 'disc expiry', 'license expiry'] }), F('insurance_expiry', 'Insurance expires', 'date'),
      F('fitness_expiry', 'Fitness expires', 'date', { aka: ['roadworthy'] }), F('permit_expiry', 'Permit expires', 'date')],
    exists: async (r, ctx) => (await ctx.list('vehicles')).find(v => norm(v.reg_no) === norm(r.reg_no)),
    async run(r, ctx) {
      let driver_id = null;
      if (r.driver) { const d = (await ctx.list('fleet_staff')).find(e => norm(nm(e.first_name, e.last_name)) === norm(r.driver) || norm(e.first_name) === norm(r.driver)); if (!d) throw L(`driver "${r.driver}" is not an employee`, `mokhanni "${r.driver}" hase mosebetsi`); driver_id = d.id; }
      await POST('/vehicles', { ...r, driver_id });
    } },
  { key: 'rooms', group: 'Sector', perm: 'rooms', mod: 'rooms', title: ['Rooms', 'Likamore'], desc: ['Guest rooms with their type and rate.', 'Likamore tsa baeti le litheko.'],
    fields: [F('name', 'Room', 'text', { req: 1, aka: ['room', 'room no', 'room number', 'kamore'] }), F('room_type', 'Room type', 'text', { req: 1, aka: ['type', 'category'] }), F('rate', 'Rate per night incl. VAT', 'num', { aka: ['rate', 'price'] }),
      F('capacity', 'Sleeps', 'int', { aka: ['capacity', 'pax', 'beds'] }), F('floor', 'Floor / block', 'text', { aka: ['floor', 'block', 'wing'] })],
    exists: async (r, ctx) => (await ctx.list('rooms')).find(x => norm(x.name) === norm(r.name)),
    async run(r, ctx) {
      const room_type_id = await ctx.named('room_types', r.room_type, () => { if (!r.rate) throw L(`new room type "${r.room_type}" needs a rate`, `mofuta o mocha o hloka theko`); return POST('/room-types', { name: r.room_type, rate: r.rate, capacity: r.capacity || 2 }); });
      await POST('/rooms', { name: r.name, room_type_id, floor: r.floor, housekeeping: 'clean' });
    } },
  { key: 'equipment', group: 'Operations', perm: 'maintenance', mod: 'maintenance', title: ['Machines & equipment', 'Mechini le lisebelisoa'], desc: ['Machines with serial numbers, service intervals and warranty.', 'Mechini le linomoro tsa tsona, nako ea tlhokomelo.'],
    fields: [F('name', 'Machine', 'text', { req: 1, aka: ['name', 'asset', 'description', 'equipment'] }), F('code', 'Asset code', 'text', { aka: ['code', 'asset no', 'tag'] }), F('category', 'Category', 'text'), F('serial_no', 'Serial number', 'text', { aka: ['serial', 's/n'] }),
      F('purchase_date', 'Bought on', 'date', { aka: ['purchase date', 'acquired'] }), F('cost', 'Cost', 'num'), F('warranty_until', 'Warranty until', 'date', { aka: ['warranty'] }), F('interval_days', 'Service every … days', 'int', { aka: ['service interval', 'interval'] }),
      F('last_service', 'Last service', 'date'), F('notes', 'Notes', 'text')],
    exists: async (r, ctx) => (await ctx.list('equipment')).find(x => (r.serial_no && norm(x.serial_no) === norm(r.serial_no)) || (r.code && norm(x.code) === norm(r.code)) || (!r.serial_no && !r.code && norm(x.name) === norm(r.name))),
    async run(r) { await POST('/equipment', r); } },
  { key: 'sites', group: 'Sector', perm: 'sites', mod: 'sites', title: ['Client sites', 'Libaka tsa bareki'], desc: ['Sites you guard or clean, with staff needed and billing.', 'Libaka tseo u li lebelang kapa u li hloekisang.'],
    fields: [F('client', 'Client', 'text', { req: 1, aka: ['customer', 'client name', 'moreki'] }), F('name', 'Site', 'text', { req: 1, aka: ['site', 'site name', 'location', 'post'] }),
      F('kind', 'Service', 'enum', { values: [['security', 'guarding', 'tšireletso'], ['cleaning', 'hygiene', 'ho hloekisa'], ['both']] }), F('address', 'Address', 'text'), F('contact_name', 'Site contact', 'text', { aka: ['contact'] }), F('contact_phone', 'Contact phone', 'text', { aka: ['phone'] }),
      F('staff_day', 'Staff by day', 'int', { aka: ['day staff', 'day guards'] }), F('staff_night', 'Staff at night', 'int', { aka: ['night staff', 'night guards'] }),
      F('billing', 'Billing', 'enum', { values: [['contract', 'monthly', 'fixed'], ['per_shift', 'shift'], ['per_hour', 'hourly', 'hour']] }), F('rate', 'Rate per shift / hour', 'num')],
    exists: async (r, ctx) => (await ctx.list('sites')).find(x => norm(x.name) === norm(r.name)),
    async run(r, ctx) { const partner_id = await ctx.partner(r.client, { is_customer: 1 }); await POST('/sites', { ...r, partner_id }); } },
  { key: 'farm_animals', group: 'Sector', perm: 'farm', mod: 'farm', title: ['Farm animals', 'Liphoofolo tsa polasi'], desc: ['Your stock register: tagged cattle, sheep, goats and pigs with breed, sex, birth date and herd.', 'Rejistara ea liphoofolo: likhomo, linku, lipoli le likolobe tse nang le li-tag.'],
    note: ['Herds / flocks are created if missing. Mothers are linked when the mother\'s tag is already in the system (import mothers first).', 'Mehlape e etsoa haeba e le sieo.'],
    fields: [F('tag', 'Tag', 'text', { req: 1, aka: ['ear tag', 'tag no', 'brand', 'id', 'animal id', 'nomoro'] }), F('species', 'Species', 'text', { req: 1, aka: ['type', 'animal', 'kind', 'mofuta'] }), F('breed', 'Breed', 'text', { aka: ['morabe'] }),
      F('sex', 'Sex', 'enum', { values: [['F', 'female', 'f', 'cow', 'ewe', 'doe', 'sow', 'heifer', 'e tšehali'], ['M', 'male', 'm', 'bull', 'ram', 'buck', 'boar', 'ox', 'steer', 'e tona']] }), F('birth_date', 'Born', 'date', { aka: ['dob', 'birth date', 'date of birth', 'letsatsi la tsoalo'] }),
      F('group', 'Herd / flock', 'text', { aka: ['herd', 'flock', 'camp', 'group', 'mohlape'] }), F('mother', 'Mother\'s tag', 'text', { aka: ['dam', 'mother', 'mother tag'] }), F('weight', 'Weight kg', 'num', { aka: ['weight', 'mass'] }),
      F('cost', 'Bought for', 'num', { aka: ['cost', 'price', 'purchase price'] }), F('name', 'Name', 'text'), F('notes', 'Notes', 'text')],
    exists: async (r, ctx) => (await ctx.list('farm_animals')).find(a => norm(a.tag) === norm(r.tag)),
    async run(r, ctx) {
      let group_id = null;
      if (r.group) group_id = await ctx.named('farm_groups', r.group, () => POST('/farm/groups', { name: r.group, kind: /chick|hen|poultry|layer|broiler|kgoho|likhoho/i.test(r.species) ? 'poultry' : 'livestock', species: r.species.toLowerCase() }));
      const as = await ctx.list('farm_animals');
      const m = r.mother ? as.find(a => norm(a.tag) === norm(r.mother)) : null;
      const o = await POST('/farm/animals', { ...r, species: r.species.toLowerCase(), group_id, mother_id: m ? m.id : null, acquired: m ? 'born' : 'bought' });
      as.push({ id: o.id, tag: r.tag });
    } },
  { key: 'farm_fields', group: 'Sector', perm: 'farm', mod: 'farm', title: ['Fields', 'Masimo'], desc: ['Your fields with their size.', 'Masimo a hau le boholo ba ona.'],
    fields: [F('name', 'Field', 'text', { req: 1, aka: ['field', 'name', 'tšimo', 'land'] }), F('size_ha', 'Hectares', 'num', { aka: ['ha', 'size', 'hectares', 'area'] }), F('place', 'Where', 'text', { aka: ['village', 'location'] }), F('irrigated', 'Irrigated (yes/no)', 'bool'), F('notes', 'Notes', 'text')],
    exists: async (r, ctx) => (await ctx.list('farm_fields')).find(x => norm(x.name) === norm(r.name)),
    async run(r) { await POST('/farm/fields', r); } },
  { key: 'leads', group: 'Contacts', perm: 'crm', mod: 'crm', title: ['Sales leads', 'Bareki ba ka bang teng'], desc: ['Open enquiries and deals from your old CRM or spreadsheet.', 'Lipotso le litumellano tse bulehileng.'],
    fields: [F('title', 'Opportunity', 'text', { req: 1, aka: ['title', 'deal', 'opportunity', 'lead', 'subject'] }), F('company', 'Company', 'text', { aka: ['organisation', 'organization', 'customer'] }), F('contact_name', 'Contact', 'text', { aka: ['contact', 'name'] }),
      F('phone', 'Phone', 'text', { aka: ['mobile', 'mohala'] }), F('email', 'Email', 'text'), F('expected_value', 'Value', 'num', { aka: ['value', 'amount', 'deal value'] }), F('probability', 'Chance %', 'num', { aka: ['probability'] }),
      F('expected_close', 'Decision date', 'date', { aka: ['close date', 'expected close'] }), F('source', 'Source', 'enum', { values: [['walk_in', 'walk in'], ['phone', 'call'], ['whatsapp'], ['facebook', 'social'], ['referral'], ['website', 'web'], ['tender'], ['other']] }), F('notes', 'Notes', 'text')],
    exists: async (r, ctx) => (await ctx.list('leads')).find(x => norm(x.title) === norm(r.title)),
    async run(r) { await POST('/leads', r); } }
];
const only = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ''));
async function unitFor(r, ctx) {
  const units = await ctx.list('units');
  const hit = units.find(u => norm(u.name) === norm(r.unit) && norm(u.property_name) === norm(r.building)); if (hit) return hit.id;
  const property_id = await ctx.named('properties', r.building, () => POST('/properties', { name: r.building, address: r.address }));
  const o = await POST('/units', { property_id, name: r.unit, kind: r.kind || 'flat', bedrooms: r.bedrooms, size_m2: r.size_m2, market_rent: r.market_rent || r.rent, meter_no: r.meter_no });
  units.push({ id: o.id, name: r.unit, property_id, property_name: r.building, let: 0 }); return o.id;
}
const GROUP_ST = { Stock: 'Setoko', Contacts: 'Bareki le barekisi', 'Opening balances': 'Libalance tsa ho qala', People: 'Batho', Sector: 'Mesebetsi e ikhethileng', Operations: 'Ts\'ebetso' };
const kindsFor = () => KINDS.filter(k => can(k.perm) && (!k.mod || hasMod(k.mod)));
// which import a screen offers (for the "⬆ Import" button on each module)
export const ROUTE_KINDS = { '#/products': 'products', '#/inventory': 'stock', '#/partners': 'customers', '#/crm': 'customers', '#/purchases': 'suppliers', '#/invoices': 'customer_balances', '#/accounting': 'trial_balance',
  '#/hrm': 'employees', '#/clinic': 'patients', '#/school': 'learners', '#/property': 'leases', '#/hire': 'hire_items', '#/fleet': 'vehicles', '#/rooms': 'rooms', '#/maintenance': 'equipment', '#/sites': 'sites', '#/pipeline': 'leads', '#/farm': 'farm_animals' };

/* ---------------------------------------------------------------- templates */
export function template(k) {
  const head = k.fields.map(f => f.label + (f.req ? ' *' : ''));
  const ex = { name: 'Example', first_name: 'Palesa', last_name: 'Mokoena', phone: '58123456', date: today(), price: 25, qty: 10, amount: 1500, rent: 3500, building: 'Mokhele Flats', unit: 'Flat 1', class: 'Grade 1A', customer: 'Thabo Mokoena', tenant: 'Thabo Mokoena', supplier: 'Maseru Wholesalers', code: '1000', debit: 5000, start_date: '2025-02-01', hire_date: '2024-03-01', basic_salary: 4500, reg_no: 'A 123 BCD', rate_day: 50, room_type: 'Double', title: 'Office cleaning contract', client: 'LNDC', guardian_name: 'Mme Mokoena', guardian_phone: '58123456' };
  const row = k.fields.map(f => ex[f.key] !== undefined ? ex[f.key] : f.t === 'enum' ? f.values[0][0] : '');
  const help = k.fields.map(f => f.t === 'enum' ? f.values.map(v => v[0]).join(' / ') : f.t === 'date' ? 'yyyy-mm-dd or dd/mm/yyyy' : f.t === 'bool' ? 'yes / no' : f.t === 'num' ? 'number' : '');
  download(workbook([{ name: k.title[0].slice(0, 28).replace(/[\\/?*[\]:]/g, ''), rows: [head, row, help.map(h => h ? `(${h})` : '')] }]), `S-ERP import – ${k.title[0].replace(/[\\/:*?"<>|]+/g, '-')}.xlsx`);
}

/* ---------------------------------------------------------------- the screen */
export async function importer(view) {
  const q = query(); const avail = kindsFor();
  const k = avail.find(x => x.key === q.kind);
  if (!k) {
    const groups = [...new Set(avail.map(x => x.group))];
    view.innerHTML = page(L('Import data', 'Kenya lintlha'), '', `<div class="card" style="margin-bottom:12px"><p style="margin:0">${L('Moving from another program or from Excel? Download the template, paste your data in (or use the export from your old system as it is – columns are matched by name), and import. Nothing is saved until the check is clean.',
      'U tsoa lenaneong le leng kapa Excel? Jarolla template, kenya lintlha tsa hao (kapa u sebelise faele ea lenaneo la khale), ebe u kenya. Ha ho letho le bolokoang pele ho hlahlojoa.')}</p>
      <p class="muted" style="margin:8px 0 0">${L('Suggested order: 1) trial balance, 2) customers and suppliers, 3) products & stock, 4) what customers owe / what you owe suppliers, 5) the rest.', 'Tatelano e khothalletsoang: 1) trial balance, 2) bareki le barekisi, 3) lihlahisoa le setoko, 4) likoloto, 5) tse ling.')}</p></div>
      ${groups.map(g => `<h3 style="margin:14px 0 8px">${esc(L(g, GROUP_ST[g]))}</h3><div class="cols cols-3" style="align-items:stretch">${avail.filter(x => x.group === g).map(x => `<div class="card" style="margin:0"><b>${esc(L(...x.title))}</b><p class="muted" style="min-height:36px">${esc(L(...x.desc))}</p>
        <div class="row" style="gap:6px"><button class="btn btn-sm" data-tpl="${x.key}">⬇ ${L('Template', 'Template')}</button><a class="btn btn-sm btn-primary" href="#/import?kind=${x.key}">⬆ ${L('Import', 'Kenya')}</a></div></div>`).join('')}</div>`).join('')}`);
    $$('[data-tpl]').forEach(b => b.onclick = () => template(KINDS.find(x => x.key === b.dataset.tpl)));
    return;
  }
  view.innerHTML = page(`${L('Import', 'Kenya')}: ${esc(L(...k.title))}`, `<button class="btn" id="tpl">⬇ ${L('Template', 'Template')}</button>`,
    `<div class="card" style="margin-bottom:12px"><p style="margin-top:0">${esc(L(...k.desc))}</p>${k.note ? `<small class="help-note">${esc(L(...k.note))}</small>` : ''}
      <div class="row wrap" style="gap:14px;margin-top:10px"><label class="field"><span>${L('Excel (.xlsx) or CSV file', 'Faele ea Excel (.xlsx) kapa CSV')}</span><input type="file" id="ff" accept=".xlsx,.xlsm,.csv,.txt,text/csv"></label>
      <label class="field"><span>${L('Dates in the file are written', 'Matsatsi a ngotsoe')}</span><select id="mdy"><option value="">${L('day/month/year (31/01/2026)', 'letsatsi/khoeli/selemo (31/01/2026)')}</option><option value="1">${L('month/day/year (01/31/2026)', 'khoeli/letsatsi/selemo')}</option></select></label>
      ${k.exists ? `<label class="check" style="align-self:end"><input type="checkbox" id="skip" checked> <span>${L('Skip rows that are already in the system', 'Tlola mela e seng e le teng')}</span></label>` : ''}</div></div><div id="ib"></div>`, { back: '#/import' });
  $('#tpl').onclick = () => template(k);
  let sheets = null, sheet = null, headRow = 0, map = {};
  const ib = $('#ib');
  const opt = () => ({ mdy: !!$('#mdy').value });
  const records = () => { const rows = sheet.rows.slice(headRow + 1).filter(r => r.some(x => String(x ?? '').trim() !== ''));
    return rows.map(raw => { const out = {}, errs = [];
      for (const f of k.fields) { const ci = map[f.key]; try { const v = convert(f, ci === undefined || ci === '' ? '' : raw[ci], opt()); if (v !== undefined) out[f.key] = v; } catch (e) { errs.push(`${f.label}: ${e.message || e}`); } }
      return { raw, rec: out, errs, line: sheet.rows.indexOf(raw) + 1 }; }); };
  const autoMap = () => {
    const head = (sheet.rows[headRow] || []).map(h => norm(String(h).replace(/\*$/, '')));
    map = {};
    const used = () => Object.values(map);
    // exact names first for every field, then close matches for what is left
    for (const f of k.fields) { const names = [f.key, f.label, ...(f.aka || [])].map(norm); const ci = head.findIndex((h, i) => names.includes(h) && !used().includes(i)); if (ci >= 0) map[f.key] = ci; }
    for (const f of k.fields) { if (map[f.key] !== undefined) continue; const names = [f.key, f.label, ...(f.aka || [])].map(norm);
      const ci = head.findIndex((h, i) => h && !used().includes(i) && names.some(n => n.length > 3 && (h.startsWith(n) || n.startsWith(h)))); if (ci >= 0) map[f.key] = ci; }
  };
  const findHeader = () => { // the first row that matches several field names (exports often have titles above the table)
    let best = 0, score = -1;
    sheet.rows.slice(0, 15).forEach((r, i) => { const s = (r || []).filter(h => h !== '' && k.fields.some(f => [f.key, f.label, ...(f.aka || [])].map(norm).includes(norm(String(h).replace(/\*$/, ''))))).length; if (s > score) { score = s; best = i; } });
    headRow = best;
  };
  const draw = () => {
    const head = sheet.rows[headRow] || []; const recs = records(); const bad = recs.filter(r => r.errs.length);
    const missing = k.fields.filter(f => f.req && (map[f.key] === undefined || map[f.key] === ''));
    ib.innerHTML = `<div class="card" style="margin-bottom:12px"><div class="row wrap" style="gap:14px">${sheets.length > 1 ? `<label class="field"><span>${L('Sheet', 'Leqephe')}</span><select id="sh">${sheets.map((s, i) => `<option value="${i}" ${s === sheet ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>` : ''}
      <label class="field"><span>${L('Headings are on row', 'Lihlooho li moleng')}</span><input type="number" id="hr" min="1" value="${headRow + 1}" style="width:90px"></label><div style="align-self:end"><b>${recs.length}</b> ${L('rows', 'mela')} · ${bad.length ? `<span style="color:var(--bad)">${bad.length} ${L('with problems', 'tse nang le mathata')}</span>` : `<span style="color:var(--ok)">${L('all rows look right', 'mela eohle e shebahala hantle')}</span>`}</div></div>
      <h4 style="margin:12px 0 6px">${L('Match the columns', 'Hokahanya likholomo')}</h4><div class="form-grid" style="grid-template-columns:repeat(3,1fr)">${k.fields.map(f => `<label class="field"><span>${esc(f.label)}${f.req ? ' *' : ''}</span><select data-map="${f.key}"><option value="">— ${L('not in the file', 'ha e eo faeleng')} —</option>${head.map((h, i) => `<option value="${i}" ${map[f.key] === i ? 'selected' : ''}>${esc(h || `(${L('column', 'kholomo')} ${i + 1})`)}</option>`).join('')}</select></label>`).join('')}</div>
      ${missing.length ? `<p style="color:var(--bad)">${L('Required columns not matched', 'Likholomo tse hlokahalang ha li hokahanngoe')}: ${missing.map(f => esc(f.label)).join(', ')}</p>` : ''}</div>
      <div class="card" style="margin-bottom:12px"><h4 style="margin:0 0 6px">${L('Check', 'Hlahloba')} (${L('first 15 rows, problems first', 'mela e 15 ea pele, mathata pele')})</h4>
      <div class="table-wrap"><table class="grid"><thead><tr><th>${L('Row', 'Mola')}</th>${k.fields.filter(f => map[f.key] !== undefined && map[f.key] !== '').map(f => `<th>${esc(f.label)}</th>`).join('')}<th>${L('Problem', 'Bothata')}</th></tr></thead><tbody>
      ${[...bad, ...recs.filter(r => !r.errs.length)].slice(0, 15).map(r => `<tr><td>${r.line}</td>${k.fields.filter(f => map[f.key] !== undefined && map[f.key] !== '').map(f => `<td>${esc(r.rec[f.key] === true ? '✓' : r.rec[f.key] === false ? '' : r.rec[f.key] ?? '')}</td>`).join('')}<td style="color:var(--bad)">${esc(r.errs.join('; '))}</td></tr>`).join('')}</tbody></table></div>
      <div class="row" style="margin-top:10px"><span class="spacer"></span><button class="btn btn-primary" id="go" ${missing.length || !recs.length ? 'disabled' : ''}>${L(`Import ${recs.length - bad.length} rows`, `Kenya mela e ${recs.length - bad.length}`)}${bad.length ? L(` (skip ${bad.length} with problems)`, ` (tlola e ${bad.length} e nang le mathata)`) : ''}</button></div></div><div id="res"></div>`;
    if ($('#sh')) $('#sh').onchange = () => { sheet = sheets[Number($('#sh').value)]; findHeader(); autoMap(); draw(); };
    $('#hr').onchange = () => { headRow = Math.max(0, Number($('#hr').value) - 1); autoMap(); draw(); };
    $$('[data-map]').forEach(s => s.onchange = () => { const v = s.value; if (v === '') delete map[s.dataset.map]; else map[s.dataset.map] = Number(v); draw(); });
    $('#go').onclick = () => run(recs);
  };
  const run = async recs => {
    const ctx = makeCtx(); const skip = $('#skip') && $('#skip').checked;
    const res = $('#res'); const todo = recs.filter(r => !r.errs.length); const failed = recs.filter(r => r.errs.length).map(r => ({ ...r, error: r.errs.join('; ') }));
    let done = 0, skipped = 0; $('#go').disabled = true;
    res.innerHTML = `<div class="card"><b id="pg">0 / ${todo.length}</b><div style="height:8px;background:var(--line);border-radius:4px;margin-top:6px"><div id="bar" style="height:8px;width:0;background:var(--ok);border-radius:4px"></div></div></div>`;
    for (let i = 0; i < todo.length; i++) {
      const r = todo[i];
      try {
        if (skip && k.exists && await k.exists(r.rec, ctx)) skipped++;
        else { const o = await k.run(r.rec, ctx); if (o === 'skip') skipped++; else done++; }
      } catch (e) { failed.push({ ...r, error: e.message || String(e) }); }
      if (i % 3 === 0 || i === todo.length - 1) { $('#pg').textContent = `${i + 1} / ${todo.length}`; $('#bar').style.width = `${Math.round((i + 1) / todo.length * 100)}%`; }
    }
    let fin = '';
    if (k.finish) { try { fin = await k.finish(ctx); } catch (e) { fin = `<span style="color:var(--bad)">${esc(e.message)}</span>`; } }
    res.innerHTML = `<div class="card"><h3 style="margin-top:0">${L('Import finished', 'Ho kenya ho phethehile')}</h3><p><b style="color:var(--ok)">${done}</b> ${L('imported', 'li kentsoe')} · <b>${skipped}</b> ${L('skipped (already there)', 'li tlotsoe (li se li le teng)')} · <b style="color:${failed.length ? 'var(--bad)' : 'inherit'}">${failed.length}</b> ${L('not imported', 'ha lia kenngoa')}</p>${fin ? `<p>${fin}</p>` : ''}
      ${failed.length ? `${tableHtml([{ key: 'line', label: L('Row', 'Mola'), right: 1 }, { key: 'error', label: L('Why', 'Hobaneng') }], failed.slice(0, 50))}<button class="btn" id="dl" style="margin-top:8px">⬇ ${L('Download the rows that were not imported', 'Jarolla mela e sa kenngoang')}</button>
        <small class="help-note">${L('Fix them in the downloaded file and import that file again – the rows that worked are not in it.', 'Lokisa faeleng e jarollotsoeng ebe u e kenya hape.')}</small>` : ''}</div>`;
    if ($('#dl')) $('#dl').onclick = () => download(workbook([{ name: 'Not imported', rows: [[...(sheet.rows[headRow] || []), 'Error'], ...failed.sort((a, b) => a.line - b.line).map(r => [...r.raw, r.error])] }]), `Not imported – ${k.title[0]}.xlsx`);
    toast(L(`${done} imported`, `${done} li kentsoe`), failed.length ? 'err' : 'ok');
  };
  $('#ff').onchange = async () => {
    const f = $('#ff').files[0]; if (!f) return;
    try { sheets = (await readFile(f)).filter(s => s.rows.length); if (!sheets.length) throw new Error(L('The file is empty', 'Faele ha e na letho'));
      sheet = sheets[0]; findHeader(); autoMap(); draw(); } catch (e) { err(e); }
  };
  $('#mdy').onchange = () => { if (sheet) draw(); };
}
