// Fixed asset register: what the business owns, where it is, who looks after it, and what it is worth.
// Cost → monthly depreciation (straight line or reducing balance, from the month the asset is put into use) → disposal
// with gain or loss. Every money step posts to the books on the category's accounts:
//   acquisition  Dr asset account          Cr paid-from account / 2000 supplier / 3000 opening balance
//   depreciation Dr 6950 Depreciation       Cr accumulated depreciation
//   disposal     Dr accumulated dep. + proceeds account   Cr asset cost   ± gain (4250) / loss (6960)
const db = require('../db');
const accounting = require('./accounting');
const { round2, bad, notFound, pad, today } = require('../util');

const r2 = n => round2(Number(n) || 0);
const ym = d => String(d).slice(0, 7);
const nextMonth = p => { const [y, m] = p.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
const prevMonth = p => { const [y, m] = p.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const monthEnd = p => { const [y, m] = p.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const nbv = a => r2(Number(a.cost) - Number(a.accum_dep));

/* ---------------- categories ---------------- */
const categories = () => db.query(`SELECT c.*, (SELECT COUNT(*) FROM fixed_assets a WHERE a.category_id = c.id AND a.status = 'active') assets FROM asset_categories c ORDER BY c.name`);
async function saveCategory(b, id = null) {
  const v = { name: String(b.name || '').trim().slice(0, 80) };
  if (!v.name) throw bad('Name the category');
  for (const k of ['asset_code', 'accum_code', 'expense_code']) {
    v[k] = String(b[k] || (k === 'expense_code' ? '6950' : '')).trim();
    if (!await db.one('SELECT id FROM accounts WHERE code = ?', [v[k]])) throw bad(`Account ${v[k] || '(empty)'} is not in the chart of accounts`);
  }
  v.method = ['straight_line', 'reducing_balance', 'none'].includes(b.method) ? b.method : 'straight_line';
  v.life_months = Math.max(0, Math.round(Number(b.life_months) || 0)); v.rate_pct = Math.max(0, r2(b.rate_pct)); v.residual_pct = Math.min(100, Math.max(0, r2(b.residual_pct)));
  if (v.method === 'straight_line' && !(v.life_months > 0)) throw bad('Give the useful life in months (e.g. 60 for 5 years)');
  if (v.method === 'reducing_balance' && !(v.rate_pct > 0)) throw bad('Give the yearly depreciation rate %');
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  if (id) await db.query('UPDATE asset_categories SET ? WHERE id = ?', [v, id]); else id = (await db.query('INSERT INTO asset_categories SET ?', [v])).insertId;
  return id;
}

/* ---------------- depreciation for one month ---------------- */
function monthDep(a, period) {
  if (a.method === 'none' || a.status !== 'active') return 0;
  if (period < ym(a.in_service_date)) return 0;
  const left = r2(nbv(a) - Number(a.residual_value)); if (left <= 0) return 0;
  let amt;
  if (a.method === 'straight_line') {
    // what is left spread over the months of life left – the same each month, and a change of life or residual applies from now on
    const [y0, m0] = ym(a.in_service_date).split('-').map(Number), [y1, m1] = period.split('-').map(Number);
    const used = (y1 - y0) * 12 + (m1 - m0), remaining = Number(a.life_months) - used;
    amt = remaining <= 1 ? left : left / remaining;
  }
  else amt = nbv(a) * Number(a.rate_pct) / 100 / 12;
  return r2(Math.min(left, amt));
}
/** months still to depreciate for an asset up to and including `upto` */
function dueMonths(a, upto) {
  const out = []; let p = a.last_dep_period ? nextMonth(a.last_dep_period) : ym(a.in_service_date);
  while (p <= upto && out.length < 1200) { out.push(p); p = nextMonth(p); }
  return out;
}
/** depreciate every active asset up to a month (catches up missed months); one journal per category */
async function runDepreciation(user, upto, { assetId = null, c: conn = null } = {}) {
  if (!/^\d{4}-\d{2}$/.test(upto || '')) throw bad('Choose the month');
  if (upto > ym(today())) throw bad('Depreciation cannot run for a future month');
  const work = async c => {
    const list = await c.query(`SELECT a.*, k.accum_code, k.expense_code, k.name category FROM fixed_assets a JOIN asset_categories k ON k.id = a.category_id
      WHERE a.status = 'active' AND a.method <> 'none' AND (a.last_dep_period IS NULL OR a.last_dep_period < ?) ${assetId ? 'AND a.id = ?' : ''} FOR UPDATE`, assetId ? [upto, assetId] : [upto]);
    const run = (await c.query('INSERT INTO asset_dep_runs (upto_period, user_id) VALUES (?, ?)', [upto, user.id])).insertId;
    const byCat = new Map(); let n = 0, total = 0;
    for (const a of list) {
      let any = false;
      for (const p of dueMonths(a, upto)) {
        const amt = monthDep(a, p);
        a.last_dep_period = p;
        if (amt <= 0) continue;
        a.accum_dep = r2(Number(a.accum_dep) + amt); any = true;
        await c.query('INSERT INTO asset_depreciation (asset_id, period, amount, accum_after, run_id) VALUES (?, ?, ?, ?, ?)', [a.id, p, amt, a.accum_dep, run]);
        const k = `${a.expense_code}|${a.accum_code}|${p}`;
        byCat.set(k, r2((byCat.get(k) || 0) + amt)); total = r2(total + amt);
      }
      await c.query('UPDATE fixed_assets SET accum_dep = ?, last_dep_period = ? WHERE id = ?', [a.accum_dep, a.last_dep_period, a.id]);
      if (any) n++;
    }
    for (const [k, amt] of byCat) {
      const [exp, acc, p] = k.split('|');
      await accounting.post(c, { date: monthEnd(p), reference: `DEP ${p}`, memo: `Depreciation ${p}`, source_type: 'depreciation', source_id: run, user_id: user.id,
        lines: [{ code: exp, debit: amt }, { code: acc, credit: amt }] });
    }
    await c.query('UPDATE asset_dep_runs SET assets = ?, total = ? WHERE id = ?', [n, total, run]);
    return { run_id: run, assets: n, total };
  };
  return conn ? work(conn) : db.tx(work);
}

/* ---------------- register ---------------- */
const LIST_SQL = `SELECT a.*, k.name category, k.asset_code, k.accum_code, s.name supplier_name, v.reg_no, ROUND(a.cost - a.accum_dep, 2) nbv
  FROM fixed_assets a JOIN asset_categories k ON k.id = a.category_id LEFT JOIN partners s ON s.id = a.supplier_id LEFT JOIN vehicles v ON v.id = a.vehicle_id`;
async function list(q = {}) {
  const where = ['1=1'], args = [];
  if (q.status) { where.push('a.status = ?'); args.push(q.status); } else where.push(`a.status = 'active'`);
  if (q.category_id) { where.push('a.category_id = ?'); args.push(q.category_id); }
  if (q.location) { where.push('a.location = ?'); args.push(q.location); }
  if (q.q) { where.push('(a.name LIKE ? OR a.asset_no LIKE ? OR a.serial_no LIKE ? OR a.barcode = ? OR a.custodian LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`, q.q, `%${q.q}%`); }
  return db.query(`${LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY a.asset_no LIMIT 5000`, args);
}
async function get(id) {
  const a = await db.one(`${LIST_SQL} WHERE a.id = ?`, [id]); if (!a) throw notFound('Asset');
  a.depreciation = await db.query('SELECT period, amount, accum_after FROM asset_depreciation WHERE asset_id = ? ORDER BY period DESC LIMIT 120', [id]);
  a.moves = await db.query('SELECT m.*, u.name user_name FROM asset_moves m LEFT JOIN users u ON u.id = m.user_id WHERE m.asset_id = ? ORDER BY m.id DESC', [id]);
  a.counts = await db.query('SELECT l.*, c.name count_name FROM asset_count_lines l JOIN asset_counts c ON c.id = l.count_id WHERE l.asset_id = ? ORDER BY l.id DESC LIMIT 20', [id]);
  a.monthly = monthDep(a, a.last_dep_period ? nextMonth(a.last_dep_period) : ym(a.in_service_date)); // the next month's charge
  return a;
}
function clean(b, cat, cur) {
  const v = {};
  for (const [k, n] of [['name', 160], ['description', 255], ['serial_no', 80], ['make_model', 80], ['barcode', 80], ['location', 120], ['department', 80], ['custodian', 120], ['invoice_ref', 80], ['funding', 80], ['insurer', 80], ['notes', 255]])
    if (b[k] !== undefined || !cur) v[k] = b[k] ? String(b[k]).trim().slice(0, n) : null;
  if (!cur && !v.name) throw bad('Name the asset');
  for (const k of ['warranty_until', 'insurance_expiry', 'purchase_date']) if (b[k] !== undefined) v[k] = b[k] || null;
  for (const k of ['supplier_id', 'location_id', 'custodian_employee_id', 'vehicle_id', 'equipment_id']) if (b[k] !== undefined) v[k] = Number(b[k]) || null;
  if (b.insured_value !== undefined) v.insured_value = b.insured_value === '' || b.insured_value === null ? null : r2(b.insured_value);
  if (b.condition_now !== undefined) v.condition_now = ['new', 'good', 'fair', 'poor', 'broken'].includes(b.condition_now) ? b.condition_now : 'good';
  return v;
}
async function nextNo(c) {
  const r = await c.one(`SELECT MAX(CAST(SUBSTRING(asset_no, 4) AS UNSIGNED)) n FROM fixed_assets WHERE asset_no LIKE 'FA-%'`);
  return `FA-${pad((Number(r.n) || 0) + 1, 5)}`;
}
/**
 * add an asset. funding.source: 'paid' (method_id – paid now), 'supplier' (supplier_id – on the supplier's account),
 * 'bill' (already on a supplier bill posted to the asset account – no posting), 'opening' (owned before using S-ERP:
 * cost and depreciation to date come in against opening balances), 'donated' (Dr asset, Cr 4200 other income)
 */
async function create(user, b) {
  return db.tx(async c => {
    const cat = await c.one('SELECT * FROM asset_categories WHERE id = ?', [b.category_id]); if (!cat) throw bad('Choose the asset category');
    const v = clean(b, cat, null);
    v.category_id = cat.id;
    v.cost = r2(b.cost); if (!(v.cost > 0)) throw bad('Enter the cost (excl. VAT if you claim the VAT back)');
    v.in_service_date = String(b.in_service_date || b.purchase_date || today()).slice(0, 10);
    if (v.in_service_date > today()) throw bad('The date it was put into use cannot be in the future');
    v.method = ['straight_line', 'reducing_balance', 'none'].includes(b.method) ? b.method : cat.method;
    v.life_months = b.life_months !== undefined && b.life_months !== '' ? Math.max(0, Math.round(Number(b.life_months))) : cat.life_months;
    v.rate_pct = b.rate_pct !== undefined && b.rate_pct !== '' ? r2(b.rate_pct) : Number(cat.rate_pct);
    v.residual_value = b.residual_value !== undefined && b.residual_value !== '' ? r2(b.residual_value) : r2(v.cost * Number(cat.residual_pct) / 100);
    if (v.residual_value >= v.cost && v.method !== 'none') throw bad('The residual value must be less than the cost');
    if (v.method === 'straight_line' && !(v.life_months > 0)) throw bad('Give the useful life in months');
    v.asset_no = b.asset_no ? String(b.asset_no).trim().slice(0, 30) : await nextNo(c);
    if (await c.one('SELECT id FROM fixed_assets WHERE asset_no = ?', [v.asset_no])) throw bad(`Asset number ${v.asset_no} is already used`);
    v.user_id = user.id;
    const src = b.source || 'paid';
    let opening = 0;
    if (src === 'opening') {
      opening = r2(b.opening_accum_dep || 0);
      if (opening < 0 || opening > v.cost - v.residual_value) throw bad('Depreciation to date must be between 0 and cost less residual value');
      v.accum_dep = opening;
      v.last_dep_period = b.depreciated_upto && /^\d{4}-\d{2}$/.test(b.depreciated_upto) ? b.depreciated_upto : prevMonth(ym(today()));
    }
    const id = (await c.query('INSERT INTO fixed_assets SET ?', [v])).insertId;
    const lines = [{ code: cat.asset_code, debit: v.cost, description: `${v.asset_no} ${v.name}` }];
    if (src === 'paid') {
      const m = await c.one('SELECT * FROM payment_methods WHERE id = ?', [b.method_id]); if (!m || m.kind === 'account') throw bad('Choose how it was paid');
      const vat = r2(b.vat_amount || 0);
      if (vat > 0) lines.push({ code: '1400', debit: vat, description: `VAT on ${v.asset_no}` });
      lines.push({ code: m.account_code, credit: r2(v.cost + vat) });
      await c.query(`INSERT INTO payments (direction, partner_id, method_id, amount, reference, user_id) VALUES ('out', ?, ?, ?, ?, ?)`, [v.supplier_id || null, m.id, r2(v.cost + vat), v.asset_no, user.id]);
    } else if (src === 'supplier') {
      if (!v.supplier_id) throw bad('Choose the supplier');
      const vat = r2(b.vat_amount || 0);
      if (vat > 0) lines.push({ code: '1400', debit: vat });
      lines.push({ code: '2000', credit: r2(v.cost + vat), partner_id: v.supplier_id });
    } else if (src === 'opening') {
      if (opening > 0) lines.push({ code: cat.accum_code, credit: opening, description: 'Depreciation to date' });
      lines.push({ code: '3000', credit: r2(v.cost - opening), description: 'Opening balance' });
    } else if (src === 'donated') lines.push({ code: '4200', credit: v.cost, description: 'Donated asset' });
    else if (src !== 'bill') throw bad('Choose how the asset was acquired');
    if (src !== 'bill') await accounting.post(c, { date: src === 'opening' ? today() : (v.purchase_date || v.in_service_date), reference: v.asset_no, memo: `Asset ${src === 'opening' ? 'brought in' : 'acquired'}: ${v.name}`, source_type: 'asset', source_id: id, user_id: user.id, lines });
    await c.query(`INSERT INTO asset_moves (asset_id, move_date, kind, to_location, to_custodian, note, user_id) VALUES (?, ?, 'acquired', ?, ?, ?, ?)`, [id, v.in_service_date, v.location, v.custodian, src, user.id]);
    if (v.vehicle_id) await c.query('UPDATE vehicles SET asset_id = ? WHERE id = ?', [id, v.vehicle_id]);
    return id;
  });
}
async function update(user, id, b) {
  return db.tx(async c => {
    const a = await c.one('SELECT * FROM fixed_assets WHERE id = ? FOR UPDATE', [id]); if (!a) throw notFound('Asset');
    const v = clean(b, null, a);
    delete v.location; delete v.custodian; // moved with a transfer, so the history is kept
    if (b.method !== undefined || b.life_months !== undefined || b.rate_pct !== undefined || b.residual_value !== undefined) {
      // a change of estimate applies from now on (IAS 8): the remaining value is spread over the new remaining life
      if (b.method) v.method = ['straight_line', 'reducing_balance', 'none'].includes(b.method) ? b.method : a.method;
      if (b.life_months !== undefined && b.life_months !== '') v.life_months = Math.max(1, Math.round(Number(b.life_months)));
      if (b.rate_pct !== undefined && b.rate_pct !== '') v.rate_pct = r2(b.rate_pct);
      if (b.residual_value !== undefined && b.residual_value !== '') { v.residual_value = r2(b.residual_value); if (v.residual_value > nbv(a)) throw bad('The residual value cannot be more than the book value'); }
    }
    if (Object.keys(v).length) await c.query('UPDATE fixed_assets SET ? WHERE id = ?', [v, id]);
    if (v.vehicle_id) await c.query('UPDATE vehicles SET asset_id = ? WHERE id = ?', [id, v.vehicle_id]);
    return id;
  });
}
async function transfer(user, id, b) {
  return db.tx(async c => {
    const a = await c.one('SELECT * FROM fixed_assets WHERE id = ? FOR UPDATE', [id]); if (!a) throw notFound('Asset');
    if (a.status !== 'active') throw bad('Only an asset still in use can be moved');
    const to = b.location !== undefined ? (b.location || null) : a.location, cu = b.custodian !== undefined ? (b.custodian || null) : a.custodian;
    if (to === a.location && cu === a.custodian && (b.department === undefined || b.department === a.department)) throw bad('Nothing changes – choose the new place or the new person');
    await c.query(`INSERT INTO asset_moves (asset_id, move_date, kind, from_location, to_location, from_custodian, to_custodian, note, user_id) VALUES (?, ?, 'transfer', ?, ?, ?, ?, ?, ?)`,
      [id, b.date || today(), a.location, to, a.custodian, cu, b.note ? String(b.note).slice(0, 255) : null, user.id]);
    await c.query('UPDATE fixed_assets SET location = ?, custodian = ?, custodian_employee_id = ?, department = COALESCE(?, department) WHERE id = ?', [to, cu, Number(b.custodian_employee_id) || null, b.department || null, id]);
  });
}
async function dispose(user, id, b) {
  const kind = b.kind === 'written_off' ? 'written_off' : 'disposed';
  const date = String(b.date || today()).slice(0, 10);
  if (date > today()) throw bad('The disposal date cannot be in the future');
  return db.tx(async c => {
    const a0 = await c.one('SELECT * FROM fixed_assets WHERE id = ? FOR UPDATE', [id]); if (!a0) throw notFound('Asset');
    if (a0.status !== 'active') throw bad('Already disposed');
    // depreciation up to the month before disposal first
    const upto = prevMonth(ym(date));
    if (a0.method !== 'none' && (!a0.last_dep_period || a0.last_dep_period < upto) && upto >= ym(a0.in_service_date)) await runDepreciation(user, upto, { assetId: id, c });
    const a = await c.one('SELECT a.*, k.asset_code, k.accum_code FROM fixed_assets a JOIN asset_categories k ON k.id = a.category_id WHERE a.id = ?', [id]);
    const proceeds = kind === 'written_off' ? 0 : r2(b.proceeds || 0);
    const value = nbv(a), gain = r2(proceeds - value);
    const reason = String(b.note || '').trim(); if (!reason) throw bad(kind === 'written_off' ? 'Say why it is written off (lost, stolen, broken beyond repair…)' : 'Say who bought it or how it was disposed of');
    const lines = [];
    if (Number(a.accum_dep) > 0) lines.push({ code: a.accum_code, debit: r2(a.accum_dep) });
    if (proceeds > 0) { const m = await c.one('SELECT * FROM payment_methods WHERE id = ?', [b.method_id]); if (!m || m.kind === 'account') throw bad('Choose where the money for the sale went'); lines.push({ code: m.account_code, debit: proceeds }); }
    lines.push({ code: a.asset_code, credit: r2(a.cost) });
    if (gain > 0) lines.push({ code: '4250', credit: gain }); else if (gain < 0) lines.push({ code: '6960', debit: -gain });
    await accounting.post(c, { date, reference: a.asset_no, memo: `${kind === 'written_off' ? 'Written off' : 'Disposed of'}: ${a.name} – ${reason}`.slice(0, 250), source_type: 'asset_disposal', source_id: id, user_id: user.id, lines });
    await c.query('UPDATE fixed_assets SET status = ?, disposal_date = ?, disposal_proceeds = ?, disposal_gain = ?, disposal_note = ? WHERE id = ?', [kind, date, proceeds, gain, reason.slice(0, 255), id]);
    await c.query(`INSERT INTO asset_moves (asset_id, move_date, kind, from_location, from_custodian, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, date, kind, a.location, a.custodian, reason.slice(0, 255), user.id]);
    if (a.vehicle_id) await c.query(`UPDATE vehicles SET status = 'sold', active = 0 WHERE id = ?`, [a.vehicle_id]);
    return { book_value: value, proceeds, gain };
  });
}

/* ---------------- physical verification ---------------- */
async function startCount(user, b) {
  const name = String(b.name || '').trim() || `Asset count ${today()}`;
  return (await db.query('INSERT INTO asset_counts (name, location, user_id) VALUES (?, ?, ?)', [name.slice(0, 120), b.location || null, user.id])).insertId;
}
async function getCount(id) {
  const c = await db.one('SELECT * FROM asset_counts WHERE id = ?', [id]); if (!c) throw notFound('Count');
  c.assets = await db.query(`SELECT a.id, a.asset_no, a.name, a.location, a.custodian, a.serial_no, a.barcode, l.found, l.condition_now seen_condition, l.location_seen, l.note
    FROM fixed_assets a LEFT JOIN asset_count_lines l ON l.asset_id = a.id AND l.count_id = ? WHERE a.status = 'active' ${c.location ? 'AND a.location = ?' : ''} ORDER BY a.location, a.asset_no`, c.location ? [id, c.location] : [id]);
  c.seen = c.assets.filter(a => a.found === 1).length; c.missing = c.assets.filter(a => a.found === 0).length; c.unchecked = c.assets.filter(a => a.found === null).length;
  return c;
}
async function countAsset(user, id, b) {
  const c = await db.one('SELECT * FROM asset_counts WHERE id = ?', [id]); if (!c) throw notFound('Count'); if (c.status !== 'open') throw bad('This count is closed');
  const a = await db.one(`SELECT id FROM fixed_assets WHERE status = 'active' AND (id = ? OR asset_no = ? OR (barcode IS NOT NULL AND barcode = ?))`, [Number(b.asset_id) || 0, String(b.code || ''), String(b.code || '')]);
  if (!a) throw bad('No asset in use with that number or barcode');
  await db.query(`INSERT INTO asset_count_lines (count_id, asset_id, found, condition_now, location_seen, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE found = VALUES(found), condition_now = VALUES(condition_now), location_seen = VALUES(location_seen), note = VALUES(note), user_id = VALUES(user_id)`,
    [id, a.id, b.found === false || b.found === 0 ? 0 : 1, ['new', 'good', 'fair', 'poor', 'broken'].includes(b.condition_now) ? b.condition_now : null, b.location_seen || null, b.note || null, user.id]);
  return { asset_id: a.id };
}
async function closeCount(user, id) {
  return db.tx(async c => {
    const k = await c.one('SELECT * FROM asset_counts WHERE id = ? FOR UPDATE', [id]); if (!k || k.status !== 'open') throw bad('This count is not open');
    const lines = await c.query('SELECT * FROM asset_count_lines WHERE count_id = ?', [id]);
    for (const l of lines.filter(l => l.found)) await c.query('UPDATE fixed_assets SET last_verified = CURDATE(), condition_now = COALESCE(?, condition_now) WHERE id = ?', [l.condition_now, l.asset_id]);
    await c.query(`UPDATE asset_counts SET status = 'closed', closed_at = NOW() WHERE id = ?`, [id]);
    return { verified: lines.filter(l => l.found).length, missing: lines.filter(l => !l.found).length };
  });
}

/* ---------------- reports ---------------- */
/** IAS 16 roll-forward per category: cost and accumulated depreciation at the start, additions, disposals, depreciation, at the end */
async function movement(from, to) {
  from = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : today().slice(0, 4) + '-01-01'; to = /^\d{4}-\d{2}-\d{2}$/.test(to || '') ? to : today();
  const cats = await db.query('SELECT * FROM asset_categories ORDER BY name');
  const assets = await db.query('SELECT * FROM fixed_assets');
  const dep = await db.query('SELECT asset_id, period, amount FROM asset_depreciation');
  const depBy = (aid, cond) => r2(dep.filter(d => d.asset_id === aid && cond(d.period)).reduce((s, d) => s + Number(d.amount), 0));
  const fromP = ym(from), toP = ym(to);
  const rows = cats.map(k => {
    const as = assets.filter(a => a.category_id === k.id);
    const row = { category: k.name, cost_open: 0, additions: 0, disposals_cost: 0, cost_close: 0, dep_open: 0, dep_charge: 0, dep_disposals: 0, dep_close: 0 };
    for (const a of as) {
      const inDate = String(a.created_at).slice(0, 10) < String(a.in_service_date) ? String(a.created_at).slice(0, 10) : String(a.in_service_date);
      const acquired = String(a.in_service_date) < from ? 'before' : String(a.in_service_date) <= to ? 'during' : 'after';
      const gone = a.disposal_date ? (String(a.disposal_date) < from ? 'before' : String(a.disposal_date) <= to ? 'during' : 'after') : 'never';
      void inDate;
      if (acquired === 'after' || gone === 'before') continue;
      const openingAcc = r2(Number(a.accum_dep) - depBy(a.id, () => true)); // depreciation brought in with an opening balance
      const accBefore = r2(openingAcc + depBy(a.id, p => p < fromP)), charge = depBy(a.id, p => p >= fromP && p <= toP);
      if (acquired === 'before') { row.cost_open += Number(a.cost); row.dep_open += accBefore; } else { row.additions += Number(a.cost); row.dep_open += 0; row.dep_charge += openingAcc; }
      row.dep_charge += charge;
      if (gone === 'during') { row.disposals_cost += Number(a.cost); row.dep_disposals += r2((acquired === 'before' ? accBefore : openingAcc) + charge); }
    }
    for (const kx of Object.keys(row)) if (kx !== 'category') row[kx] = r2(row[kx]);
    row.cost_close = r2(row.cost_open + row.additions - row.disposals_cost); row.dep_close = r2(row.dep_open + row.dep_charge - row.dep_disposals);
    row.nbv_open = r2(row.cost_open - row.dep_open); row.nbv_close = r2(row.cost_close - row.dep_close);
    return row;
  }).filter(r => r.cost_open || r.additions || r.cost_close);
  const tot = rows.reduce((t, r) => { for (const k of Object.keys(r)) if (k !== 'category') t[k] = r2((t[k] || 0) + r[k]); return t; }, { category: 'Total' });
  return { from, to, rows, total: tot };
}
async function summary() {
  const s = await db.one(`SELECT COUNT(*) n, COALESCE(SUM(cost),0) cost, COALESCE(SUM(accum_dep),0) acc FROM fixed_assets WHERE status = 'active'`);
  const last = await db.one('SELECT MAX(last_dep_period) p, MIN(last_dep_period) pmin FROM fixed_assets WHERE status = \'active\' AND method <> \'none\'');
  const byLoc = await db.query(`SELECT COALESCE(location, 'Not recorded') location, COUNT(*) n, ROUND(SUM(cost - accum_dep), 2) nbv FROM fixed_assets WHERE status = 'active' GROUP BY location ORDER BY nbv DESC`);
  const byCat = await db.query(`SELECT k.name category, COUNT(a.id) n, ROUND(COALESCE(SUM(a.cost),0), 2) cost, ROUND(COALESCE(SUM(a.cost - a.accum_dep),0), 2) nbv FROM asset_categories k LEFT JOIN fixed_assets a ON a.category_id = k.id AND a.status = 'active' GROUP BY k.id HAVING n > 0 ORDER BY nbv DESC`);
  const soon = require('./stock').addDays(today(), 60);
  const expiring = await db.query(`SELECT id, asset_no, name, warranty_until, insurance_expiry FROM fixed_assets WHERE status = 'active' AND ((warranty_until BETWEEN CURDATE() AND ?) OR (insurance_expiry IS NOT NULL AND insurance_expiry <= ?)) ORDER BY LEAST(COALESCE(warranty_until, '9999-12-31'), COALESCE(insurance_expiry, '9999-12-31'))`, [soon, soon]);
  const notVerified = await db.one(`SELECT COUNT(*) n FROM fixed_assets WHERE status = 'active' AND (last_verified IS NULL OR last_verified < DATE_SUB(CURDATE(), INTERVAL 12 MONTH))`);
  return { assets: Number(s.n), cost: r2(s.cost), accum_dep: r2(s.acc), nbv: r2(Number(s.cost) - Number(s.acc)), depreciated_to: last.pmin, depreciated_latest: last.p,
    due_period: prevMonth(ym(today())), by_location: byLoc, by_category: byCat, expiring, not_verified: Number(notVerified.n) };
}

module.exports = { categories, saveCategory, list, get, create, update, transfer, dispose, runDepreciation, startCount, getCount, countAsset, closeCount, movement, summary, monthDep };
