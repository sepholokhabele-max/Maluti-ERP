// Tax centre (Lesotho): VAT, PAYE, withholding tax, fringe benefit tax, income tax (provisional instalments + annual
// return) and other levies. Returns are prepared from the books, filed (closing journal), and paid to Revenue Services
// Lesotho – by bank / EFT / M-Pesa, or through MyWallet via the Smartel POS backend (biller op "rsl"), with the fee booked.
//
// Defaults follow RSL's published rates and dates (rsl.org.ls "Tax rates" and "Important dates", Nov 2026). Every rate
// and due day is a setting, because RSL changes them in the budget.
const db = require('../db');
const accounting = require('./accounting');
const { round2, bad } = require('../util');

const DEFAULTS = {
  vat_registered: null, // null = decide from company settings (VAT number / VAT rate)
  vat_rate: 15, vat_due_day: 20, paye_due_day: 15, wht_due_day: 15,
  entity: 'company', // company | individual (sole trader: personal income tax on the same dates)
  cit_rate: 25, // 10% for manufacturing and commercial farming income
  year_end_month: 3, // tax year April–March
  fbt_enabled: false, fbt_rate: 30,
  wht_rates: { resident_contractor: 5, nonresident_contractor: 10, rsa_technical: 7.5, interest: 10, international: 25 },
  tin: '', rsl_phone: '', pay_method: 'bank', start_month: null,
  // service fee for paying RSL through MyWallet (borne by the business, booked as a fee) – used when pos-api does not quote one
  rsl_fee_fixed: 0, rsl_fee_pct: 0, rsl_fee_max: null
};
const WHT_KINDS = {
  resident_contractor: 'Payment to a resident contractor', nonresident_contractor: 'Payment to a non-resident contractor',
  rsa_technical: 'Technical services – South African resident', interest: 'Interest paid to a resident', international: 'International transaction (other)'
};
const TAXES = {
  vat: { name: 'VAT', st: 'VAT', account: '2110' },
  paye: { name: 'PAYE', st: 'PAYE', account: '2200' },
  wht: { name: 'Withholding tax', st: 'Lekhetho le tšoaroang', account: '2220' },
  fbt: { name: 'Fringe benefit tax', st: 'Lekhetho la melemo', account: '2240' },
  cit_1: { name: 'Income tax – 1st instalment', st: 'Lekhetho la lekeno – karolo ea 1', account: '2230' },
  cit_2: { name: 'Income tax – 2nd instalment', st: 'Lekhetho la lekeno – karolo ea 2', account: '2230' },
  cit_3: { name: 'Income tax – 3rd instalment', st: 'Lekhetho la lekeno – karolo ea 3', account: '2230' },
  cit_final: { name: 'Income tax – annual return', st: 'Lekhetho la lekeno – selemo', account: '2230' },
  levy: { name: 'Other levy', st: 'Lekhetho le leng', account: '2260' }
};

const ymd = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
const monthEnd = (y, m) => ymd(new Date(Date.UTC(y, m, 0))); // m 1-12
const dayOf = (y, m, d) => { const last = Number(monthEnd(y, m).slice(8)); return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`; };
const addMonths = (y, m, n) => { const t = y * 12 + (m - 1) + n; return [Math.floor(t / 12), (t % 12) + 1]; };
const today = () => ymd(new Date());

async function settings() {
  const s = { ...DEFAULTS, ...((await db.getSetting('tax', {})) || {}) };
  s.wht_rates = { ...DEFAULTS.wht_rates, ...(s.wht_rates || {}) };
  if (s.vat_registered === null || s.vat_registered === undefined) {
    const c = (await db.getSetting('company', {})) || {};
    s.vat_registered = !!(c.tax_number || Number(c.default_vat ?? 15) > 0);
  }
  return s;
}
async function saveSettings(p) {
  const cur = await settings();
  const n = { ...cur };
  for (const k of Object.keys(DEFAULTS)) if (p[k] !== undefined) n[k] = p[k];
  for (const k of ['rsl_fee_fixed', 'rsl_fee_pct']) { n[k] = Number(n[k] || 0); if (!(n[k] >= 0 && n[k] <= 1000)) throw bad('The fee must be 0 or more'); }
  n.rsl_fee_max = n.rsl_fee_max === '' || n.rsl_fee_max === null || n.rsl_fee_max === undefined ? null : Number(n.rsl_fee_max);
  for (const k of ['vat_rate', 'cit_rate', 'fbt_rate']) { n[k] = Number(n[k]); if (!(n[k] >= 0 && n[k] <= 60)) throw bad(`${k.replace('_', ' ')} must be between 0 and 60 %`); }
  for (const k of ['vat_due_day', 'paye_due_day', 'wht_due_day']) { n[k] = Math.round(Number(n[k])); if (!(n[k] >= 1 && n[k] <= 28)) throw bad('A due day must be 1–28'); }
  n.year_end_month = Math.round(Number(n.year_end_month)); if (!(n.year_end_month >= 1 && n.year_end_month <= 12)) throw bad('Year-end month must be 1–12');
  for (const [k, v] of Object.entries(n.wht_rates || {})) { const r = Number(v); if (!(r >= 0 && r <= 60)) throw bad(`Withholding rate for ${k} must be 0–60 %`); n.wht_rates[k] = r; }
  if (!['company', 'individual'].includes(n.entity)) n.entity = 'company';
  if (n.tin && !/^[\w\-/ ]{3,30}$/.test(n.tin)) throw bad('The TIN may only have letters, digits, - and /');
  n.vat_registered = !!Number(n.vat_registered) || n.vat_registered === true;
  n.fbt_enabled = !!Number(n.fbt_enabled) || n.fbt_enabled === true;
  await db.setSetting('tax', n);
  return settings();
}

/** the tax year that contains a date: [from, to, label] */
function taxYear(dateStr, endMonth) {
  const y = Number(dateStr.slice(0, 4)), m = Number(dateStr.slice(5, 7));
  const endY = m > endMonth ? y + 1 : y;
  const [sy, sm] = addMonths(endY, endMonth, -11);
  return { from: `${sy}-${String(sm).padStart(2, '0')}-01`, to: monthEnd(endY, endMonth), label: endMonth === 12 ? String(endY) : `${sy}/${String(endY).slice(2)}` };
}

/** every return due between two dates (the tax calendar) */
async function schedule(from, to) {
  const s = await settings();
  const out = [];
  const [fy, fm] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  const payroll = await db.one('SELECT COUNT(*) n FROM payroll_runs').then(r => Number(r.n)).catch(() => 0);
  const wht = await db.one(`SELECT COUNT(*) n FROM tax_withholding WHERE direction = 'deducted'`).then(r => Number(r.n)).catch(() => 0);
  for (let i = -2; i < 16; i++) {
    const [y, m] = addMonths(fy, fm, i);
    const pf = `${y}-${String(m).padStart(2, '0')}-01`, pt = monthEnd(y, m);
    const [ny, nm] = addMonths(y, m, 1);
    const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    if (s.vat_registered) out.push({ tax: 'vat', period_from: pf, period_to: pt, period_label: label, due_date: dayOf(ny, nm, s.vat_due_day) });
    if (payroll) out.push({ tax: 'paye', period_from: pf, period_to: pt, period_label: label, due_date: dayOf(ny, nm, s.paye_due_day) });
    if (wht) out.push({ tax: 'wht', period_from: pf, period_to: pt, period_label: label, due_date: dayOf(ny, nm, s.wht_due_day) });
    const E = s.year_end_month;
    const monthsAfterYE = ((m - E) % 12 + 12) % 12; // 0 = year-end month
    if (s.fbt_enabled && monthsAfterYE % 3 === 0) { // quarter ends
      const [qy, qm] = addMonths(y, m, -2);
      out.push({ tax: 'fbt', period_from: `${qy}-${String(qm).padStart(2, '0')}-01`, period_to: pt, period_label: `Quarter to ${label}`, due_date: pt });
    }
    const ty = taxYear(pt, E);
    if (monthsAfterYE === 6) out.push({ tax: 'cit_1', period_from: ty.from, period_to: ty.to, period_label: `Tax year ${ty.label}`, due_date: pt });
    if (monthsAfterYE === 9) out.push({ tax: 'cit_2', period_from: ty.from, period_to: ty.to, period_label: `Tax year ${ty.label}`, due_date: pt });
    if (monthsAfterYE === 0) out.push({ tax: 'cit_3', period_from: ty.from, period_to: ty.to, period_label: `Tax year ${ty.label}`, due_date: pt });
    if (monthsAfterYE === 3) { const prev = taxYear(dayOf(...addMonths(y, m, -3), 1), E); out.push({ tax: 'cit_final', period_from: prev.from, period_to: prev.to, period_label: `Tax year ${prev.label}`, due_date: pt }); }
  }
  // nothing is due from before the business started using S-ERP (setting, or the first day in the books / trial start)
  let start = s.start_month ? `${String(s.start_month).slice(0, 7)}-01` : null;
  if (!start) {
    const first = await db.one(`SELECT MIN(entry_date) d FROM journal_entries WHERE source_type IS NULL OR source_type <> 'opening'`).catch(() => null);
    const act = (await db.getSetting('activation', {})) || {};
    start = [first && first.d ? String(first.d).slice(0, 7) + '-01' : null, act.trial_start ? String(act.trial_start).slice(0, 7) + '-01' : null].filter(Boolean).sort()[0] || null;
  }
  if (start) for (let i = out.length - 1; i >= 0; i--) if (out[i].period_to < start || (out[i].tax.startsWith('cit_') && out[i].tax !== 'cit_final' && out[i].due_date < start)) out.splice(i, 1);
  const rows = await db.query('SELECT * FROM tax_returns');
  const key = r => `${r.tax}|${String(r.period_from).slice(0, 10)}|${String(r.period_to).slice(0, 10)}`;
  const have = new Map(rows.map(r => [key({ ...r, period_from: ymd(new Date(r.period_from)), period_to: ymd(new Date(r.period_to)) }), r]));
  const t = today();
  const list = out.filter(x => x.due_date >= from && x.due_date <= to).map(x => {
    const r = have.get(key(x));
    const status = r ? r.status : 'not_started';
    return { ...x, name: TAXES[x.tax].name, name_st: TAXES[x.tax].st, return_id: r ? r.id : null, status, amount_due: r ? Number(r.amount_due) : null, amount_paid: r ? Number(r.amount_paid) : 0,
      overdue: x.due_date < t && status !== 'paid' && !(r && r.status === 'filed' && Number(r.amount_due) <= 0), days_left: Math.round((new Date(x.due_date) - new Date(t)) / 86400000) };
  });
  // returns made for other periods (e.g. a levy) are listed too
  for (const r of rows) if (!list.some(x => x.return_id === r.id) && ymd(new Date(r.due_date)) >= from && ymd(new Date(r.due_date)) <= to)
    list.push({ tax: r.tax, name: TAXES[r.tax] ? TAXES[r.tax].name : r.tax, period_from: ymd(new Date(r.period_from)), period_to: ymd(new Date(r.period_to)), period_label: r.period_label, due_date: ymd(new Date(r.due_date)), return_id: r.id, status: r.status, amount_due: Number(r.amount_due), amount_paid: Number(r.amount_paid), overdue: ymd(new Date(r.due_date)) < t && r.status !== 'paid' });
  return list.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.tax.localeCompare(b.tax));
}

/** the fee for paying RSL through MyWallet: MyWallet's own quote when pos-api gives one, otherwise the tariff in Settings */
async function rslFee(amount, quoted) {
  if (quoted !== null && quoted !== undefined && Number(quoted) > 0) return round2(quoted);
  const s = await settings();
  let f = round2(Number(s.rsl_fee_fixed || 0) + Number(amount) * Number(s.rsl_fee_pct || 0) / 100);
  if (s.rsl_fee_max !== null && s.rsl_fee_max !== undefined && f > Number(s.rsl_fee_max)) f = round2(s.rsl_fee_max);
  return f;
}

/**
 * VAT rule checks run before a return is filed (P11 step 2): VAT that does not match its line, broken or refused receipt
 * chains, unusual voids and refunds, prices far from the list price, and input VAT claimed from suppliers with no VAT number.
 */
async function vatChecks(from, to) {
  const out = [];
  const mism = await db.query(`SELECT 'till' src, o.number doc, l.name item, l.net_amount net, l.tax_amount tax, l.tax_rate rate FROM order_lines l JOIN orders o ON o.id = l.order_id
      WHERE o.status IN ('paid','refunded') AND DATE(o.paid_at) BETWEEN ? AND ? AND ABS(l.tax_amount - ROUND(l.net_amount * l.tax_rate / 100, 2)) > 0.02
    UNION ALL SELECT 'invoice', i.number, l.description, l.net_amount, l.tax_amount, l.tax_rate FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
      WHERE i.status IN ('posted','partial','paid') AND i.invoice_date BETWEEN ? AND ? AND ABS(l.tax_amount - ROUND(l.net_amount * l.tax_rate / 100, 2)) > 0.02 LIMIT 50`, [from, to, from, to]);
  if (mism.length) out.push({ level: 'warn', code: 'VAT_MISMATCH', text: `${mism.length} line(s) where the VAT does not match the rate (worked out again)`, items: mism.map(m => `${m.doc}: ${m.item} – net ${m.net}, VAT ${m.tax} at ${m.rate}%`) });
  const env = await db.one(`SELECT SUM(status = 'rejected') rej, SUM(status IN ('pending','held')) waiting FROM smartel_outbox WHERE type = 'sale' AND DATE(created_at) BETWEEN ? AND ?`, [from, to]).catch(() => null);
  if (env && Number(env.rej)) out.push({ level: 'bad', code: 'RECEIPTS_REFUSED', text: `${env.rej} sealed receipt(s) in this period were refused by Smartel – see Smartel connection → Receipts sent` });
  if (env && Number(env.waiting)) out.push({ level: 'warn', code: 'RECEIPTS_WAITING', text: `${env.waiting} sealed receipt(s) have not reached Smartel yet – connect the till to the internet before filing` });
  const held = await db.query(`SELECT t.name FROM smartel_terminals st JOIN pos_terminals t ON t.id = st.pos_terminal_id WHERE st.quarantined = 1`).catch(() => []);
  if (held.length) out.push({ level: 'bad', code: 'CHAIN_BROKEN', text: `Receipt chain held by Smartel on: ${held.map(h => h.name).join(', ')}` });
  const v = await db.one(`SELECT SUM(status = 'voided') voided, SUM(status IN ('paid','refunded') AND refund_of IS NULL) sold, SUM(refund_of IS NOT NULL) refunds FROM orders WHERE DATE(COALESCE(paid_at, created_at)) BETWEEN ? AND ?`, [from, to]);
  const sold = Number(v.sold || 0);
  if (sold >= 20 && Number(v.voided) / sold > 0.05) out.push({ level: 'warn', code: 'MANY_VOIDS', text: `${v.voided} voided orders against ${sold} sales (${Math.round(Number(v.voided) / sold * 100)}%) – more than usual` });
  if (sold >= 20 && Number(v.refunds) / sold > 0.05) out.push({ level: 'warn', code: 'MANY_REFUNDS', text: `${v.refunds} refunds against ${sold} sales – more than usual` });
  const price = await db.query(`SELECT o.number, l.name, l.unit_price, p.price FROM order_lines l JOIN orders o ON o.id = l.order_id JOIN products p ON p.id = l.product_id
    WHERE o.status IN ('paid','refunded') AND DATE(o.paid_at) BETWEEN ? AND ? AND p.price > 0 AND (l.unit_price < p.price * 0.5 OR l.unit_price > p.price * 2) LIMIT 30`, [from, to]);
  if (price.length) out.push({ level: 'warn', code: 'PRICE_OUTLIER', text: `${price.length} till line(s) sold at less than half or more than double the list price`, items: price.map(x => `${x.number}: ${x.name} at ${x.unit_price} (list ${x.price})`) });
  const noVat = await db.query(`SELECT i.number, p.name, i.tax_total FROM invoices i JOIN partners p ON p.id = i.partner_id WHERE i.kind = 'supplier_bill' AND i.status IN ('posted','partial','paid')
    AND i.invoice_date BETWEEN ? AND ? AND i.tax_total > 0 AND COALESCE(p.tax_number, '') = '' LIMIT 30`, [from, to]);
  if (noVat.length) out.push({ level: 'warn', code: 'INPUT_VAT_NO_VATNO', text: `Input VAT claimed on ${noVat.length} bill(s) from suppliers with no VAT number on their contact – RSL only allows input VAT from VAT-registered suppliers`, items: noVat.map(x => `${x.number} ${x.name}: VAT ${x.tax_total}`) });
  if (!out.length) out.push({ level: 'ok', code: 'OK', text: 'No problems found in the checks' });
  return out;
}

// ---------------------------------------------------------------- figures from the books
const NOT_CLOSING = `e.source_type IS NULL OR e.source_type NOT IN ('tax_close','tax_payment')`;
async function accountMove(code, from, to) {
  const r = await db.one(`SELECT COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
    WHERE a.code = ? AND e.entry_date BETWEEN ? AND ? AND (${NOT_CLOSING})`, [code, from, to]);
  return { debit: round2(r.d), credit: round2(r.c) };
}
async function profitBeforeTax(from, to) {
  const r = await db.one(`SELECT COALESCE(SUM(CASE WHEN a.type = 'income' THEN l.credit - l.debit ELSE 0 END),0) inc, COALESCE(SUM(CASE WHEN a.type = 'expense' THEN l.debit - l.credit ELSE 0 END),0) exp
    FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id WHERE e.entry_date BETWEEN ? AND ? AND a.code NOT IN ('7100') AND a.type IN ('income','expense')`, [from, to]);
  return { income: round2(r.inc), expenses: round2(r.exp), profit: round2(r.inc - r.exp) };
}

async function vatFigures(from, to) {
  const out = await accountMove('2100', from, to), inp = await accountMove('1400', from, to);
  const output = round2(out.credit - out.debit), input = round2(inp.debit - inp.credit);
  // supplies by class: standard (rate > 0), zero-rated, exempt (a 0% tax named "exempt" on the product)
  const sales = await db.query(`SELECT tax_rate, cls, SUM(net) net, SUM(tax) tax FROM (
      SELECT l.tax_rate, IF(l.tax_rate > 0, 'standard', IF(tx.name LIKE '%xempt%', 'exempt', 'zero')) cls, l.net_amount net, l.tax_amount tax FROM order_lines l JOIN orders o ON o.id = l.order_id
        LEFT JOIN products p ON p.id = l.product_id LEFT JOIN taxes tx ON tx.id = p.tax_id WHERE o.status IN ('paid','refunded') AND DATE(o.paid_at) BETWEEN ? AND ? AND l.vas_transaction_id IS NULL
      UNION ALL SELECT l.tax_rate, IF(l.tax_rate > 0, 'standard', IF(tx.name LIKE '%xempt%', 'exempt', 'zero')), l.net_amount, l.tax_amount FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
        LEFT JOIN products p ON p.id = l.product_id LEFT JOIN taxes tx ON tx.id = p.tax_id WHERE i.kind = 'customer_invoice' AND i.status IN ('posted','partial','paid') AND i.invoice_date BETWEEN ? AND ?) x
    GROUP BY tax_rate, cls ORDER BY tax_rate DESC, cls`, [from, to, from, to]);
  const purchases = await db.query(`SELECT l.tax_rate, SUM(l.net_amount) net, SUM(l.tax_amount) tax FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
    WHERE i.kind = 'supplier_bill' AND i.status IN ('posted','partial','paid') AND i.invoice_date BETWEEN ? AND ? GROUP BY l.tax_rate ORDER BY l.tax_rate DESC`, [from, to]);
  const r2 = rows => rows.map(r => ({ rate: Number(r.tax_rate), ...(r.cls ? { class: r.cls } : {}), net: round2(r.net), tax: round2(r.tax) }));
  const byClass = k => round2(sales.filter(r => r.cls === k).reduce((a, r) => a + Number(r.net), 0));
  return { output_vat: output, input_vat: input, net: round2(output - input), sales: r2(sales), purchases: r2(purchases),
    supplies: { standard: byClass('standard'), zero_rated: byClass('zero'), exempt: byClass('exempt') }, checks: await vatChecks(from, to),
    note: 'Output and input VAT are taken from the VAT accounts (2100 / 1400); the supplies by rate are for the return boxes.' };
}

async function prepareFigures(tax, from, to, inputs = {}) {
  const s = await settings();
  if (tax === 'vat') { const f = await vatFigures(from, to); return { figures: f, amount_due: f.net }; }
  if (tax === 'paye') {
    const run = await db.one('SELECT * FROM payroll_runs WHERE period = ?', [from.slice(0, 7)]);
    if (!run) return { figures: { employees: 0, gross: 0, paye: 0, note: 'No payroll run for this month.' }, amount_due: 0 };
    return { figures: { employees: run.employees, gross: Number(run.gross_total), paye: Number(run.paye_total), run_status: run.status, run_id: run.id }, amount_due: round2(run.paye_total) };
  }
  if (tax === 'wht') {
    const rows = await db.query(`SELECT w.*, p.name partner_name FROM tax_withholding w JOIN partners p ON p.id = w.partner_id WHERE w.direction = 'deducted' AND w.tx_date BETWEEN ? AND ? ORDER BY w.tx_date`, [from, to]);
    return { figures: { lines: rows.map(r => ({ date: ymd(new Date(r.tx_date)), payee: r.partner_name, kind: r.kind, gross: Number(r.gross), rate: Number(r.rate), tax: Number(r.amount), certificate_no: r.certificate_no })) }, amount_due: round2(rows.reduce((a, r) => a + Number(r.amount), 0)) };
  }
  if (tax === 'fbt') {
    const value = round2(inputs.benefits_value || 0);
    return { figures: { benefits_value: value, rate: s.fbt_rate, details: String(inputs.details || '').slice(0, 250) }, amount_due: round2(value * s.fbt_rate / 100) };
  }
  if (tax === 'levy') {
    const amt = round2(inputs.amount || 0);
    if (!inputs.levy_name) throw bad('Name the levy, e.g. Plastic levy');
    return { figures: { levy_name: String(inputs.levy_name).slice(0, 60), basis: String(inputs.basis || '').slice(0, 120), amount: amt }, amount_due: amt };
  }
  if (tax.startsWith('cit_')) {
    const rate = Number(inputs.rate ?? s.cit_rate);
    const paid = await db.one(`SELECT COALESCE(SUM(r.amount_paid),0) p FROM tax_returns r WHERE r.tax IN ('cit_1','cit_2','cit_3') AND r.period_from = ?`, [from]);
    if (tax === 'cit_final') {
      const p = await profitBeforeTax(from, to);
      const addBacks = round2(inputs.add_backs || 0), allowances = round2(inputs.allowances || 0), losses = round2(inputs.losses_brought_forward || 0);
      const chargeable = Math.max(0, round2(p.profit + addBacks - allowances - losses));
      const tax_ = round2(chargeable * rate / 100);
      const whtCredit = round2((await db.one(`SELECT COALESCE(SUM(amount),0) a FROM tax_withholding WHERE direction = 'suffered' AND tx_date BETWEEN ? AND ?`, [from, to])).a);
      return { figures: { ...p, add_backs: addBacks, allowances, losses_brought_forward: losses, chargeable_income: chargeable, rate, tax: tax_, provisional_paid: round2(paid.p), wht_credits: whtCredit, balance: round2(tax_ - paid.p - whtCredit) },
        amount_due: round2(tax_ - paid.p - whtCredit) };
    }
    // provisional instalment: a third of the estimated tax each time, less what was paid already
    const n = Number(tax.slice(4));
    let estimate = inputs.estimated_income !== undefined && inputs.estimated_income !== null && inputs.estimated_income !== '' ? round2(inputs.estimated_income) : null;
    let basis = 'your estimate';
    if (estimate === null) {
      const [py] = [Number(from.slice(0, 4)) - 1];
      const prevFrom = `${py}${from.slice(4)}`, prevTo = `${Number(to.slice(0, 4)) - 1}${to.slice(4)}`;
      const prev = await profitBeforeTax(prevFrom, prevTo);
      if (prev.income > 0) { estimate = Math.max(0, prev.profit); basis = 'last tax year\'s profit'; }
      else { const ytd = await profitBeforeTax(from, today() < to ? today() : to); const months = Math.max(1, Math.min(12, Math.round((new Date(today() < to ? today() : to) - new Date(from)) / (30.44 * 86400000)))); estimate = Math.max(0, round2(ytd.profit * 12 / months)); basis = `this year's profit so far, for 12 months (${months} months booked)`; }
    }
    const est_tax = round2(estimate * rate / 100);
    const due = Math.max(0, round2(est_tax * n / 3 - paid.p));
    return { figures: { instalment: n, estimated_income: estimate, basis, rate, estimated_tax: est_tax, paid_so_far: round2(paid.p) }, amount_due: due };
  }
  throw bad('Unknown tax');
}

async function getReturn(id) {
  const r = await db.one('SELECT * FROM tax_returns WHERE id = ?', [id]);
  if (!r) throw bad('Return not found');
  r.figures = typeof r.figures === 'string' ? JSON.parse(r.figures) : r.figures;
  for (const k of ['period_from', 'period_to', 'due_date']) r[k] = ymd(new Date(r[k]));
  r.name = TAXES[r.tax] ? TAXES[r.tax].name : r.tax; r.name_st = TAXES[r.tax] ? TAXES[r.tax].st : r.tax;
  r.payments = await db.query('SELECT p.*, u.name user_name FROM tax_payments p LEFT JOIN users u ON u.id = p.user_id WHERE p.return_id = ? ORDER BY p.id', [id]);
  r.balance = round2(Number(r.amount_due) - Number(r.amount_paid));
  return r;
}

/** create or refresh a draft return from the books */
async function prepare(user, { tax, period_from, period_to, due_date, period_label, inputs }) {
  if (!TAXES[tax]) throw bad('Choose the tax');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period_from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(period_to || '') || period_to < period_from) throw bad('Give the period (from – to)');
  const ex = await db.one('SELECT * FROM tax_returns WHERE tax = ? AND period_from = ? AND period_to = ?', [tax, period_from, period_to]);
  if (ex && ex.status !== 'draft') throw bad('This return is already filed. Reopen it first if it must change.');
  const prevInputs = ex && ex.figures ? ((typeof ex.figures === 'string' ? JSON.parse(ex.figures) : ex.figures).inputs || {}) : {};
  const inp = { ...prevInputs, ...(inputs || {}) };
  const { figures, amount_due } = await prepareFigures(tax, period_from, period_to, inp);
  figures.inputs = inp;
  const due = due_date || (ex && ymd(new Date(ex.due_date))) || period_to;
  if (ex) {
    await db.query('UPDATE tax_returns SET figures = ?, amount_due = ?, due_date = ?, period_label = COALESCE(?, period_label) WHERE id = ?', [JSON.stringify(figures), amount_due, due, period_label || null, ex.id]);
    return getReturn(ex.id);
  }
  const ins = await db.query('INSERT INTO tax_returns (tax, period_label, period_from, period_to, due_date, amount_due, figures, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [tax, period_label || `${period_from} – ${period_to}`, period_from, period_to, due, amount_due, JSON.stringify(figures), user.id]);
  return getReturn(ins.insertId);
}

/** mark the return as submitted to RSL and post its closing entry */
async function file(user, id, { filed_ref, accept_warnings } = {}) {
  const r = await getReturn(id);
  if (r.status !== 'draft') throw bad('Already filed');
  const f = r.figures || {};
  if (r.tax === 'vat' && (f.checks || []).some(c => c.level === 'bad') && !accept_warnings) throw bad('The VAT checks found serious problems (see the list). Fix them, or tick that you checked them, before filing.');
  const lines = [];
  if (r.tax === 'vat') {
    if (f.output_vat) lines.push({ code: '2100', debit: f.output_vat, description: 'Output VAT for the period' });
    if (f.input_vat) lines.push({ code: '1400', credit: f.input_vat, description: 'Input VAT for the period' });
    if (f.net > 0) lines.push({ code: '2110', credit: f.net, description: 'VAT payable to RSL' });
    else if (f.net < 0) lines.push({ code: '1410', debit: -f.net, description: 'VAT refund due from RSL' });
  } else if (r.tax === 'fbt' && Number(r.amount_due) > 0) lines.push({ code: '6470', debit: Number(r.amount_due) }, { code: '2240', credit: Number(r.amount_due) });
  else if (r.tax === 'levy' && Number(r.amount_due) > 0) lines.push({ code: '6480', debit: Number(r.amount_due), description: f.levy_name }, { code: '2260', credit: Number(r.amount_due), description: f.levy_name });
  else if (r.tax === 'cit_final') {
    if (f.tax > 0) lines.push({ code: '7100', debit: f.tax, description: 'Income tax for the year' }, { code: '2230', credit: f.tax });
    if (f.wht_credits > 0) lines.push({ code: '2230', debit: f.wht_credits, description: 'Withholding tax credits used' }, { code: '1420', credit: f.wht_credits });
  }
  await db.tx(async c => {
    const entry = lines.length ? await accounting.post(c, { date: r.period_to, reference: `${r.tax.toUpperCase()} ${r.period_label}`.slice(0, 60), memo: `${r.name} return ${r.period_label}`, source_type: 'tax_close', source_id: r.id, user_id: user.id, lines }) : null;
    const st = Number(r.amount_due) <= 0 ? 'paid' : 'filed';
    await c.query('UPDATE tax_returns SET status = ?, filed_at = NOW(), filed_ref = ?, journal_entry_id = ? WHERE id = ?', [st, filed_ref || null, entry, r.id]);
  });
  return getReturn(id);
}

async function reopen(user, id) {
  if (user.role !== 'admin') throw bad('Only an administrator can reopen a filed return');
  const r = await getReturn(id);
  if (r.status === 'draft') throw bad('Not filed');
  if (r.payments.some(p => p.status === 'paid')) throw bad('This return has payments. Record a correction on the next return instead.');
  await db.tx(async c => {
    if (r.journal_entry_id) {
      const lines = await c.query(`SELECT a.code, l.debit, l.credit, l.description FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ?`, [r.journal_entry_id]);
      await accounting.post(c, { date: r.period_to, reference: `${r.tax.toUpperCase()} ${r.period_label} REOPENED`.slice(0, 60), memo: 'Return reopened', source_type: 'tax_close', source_id: r.id, user_id: user.id,
        lines: lines.map(l => ({ code: l.code, debit: l.credit, credit: l.debit, description: l.description })) });
    }
    await c.query(`UPDATE tax_returns SET status = 'draft', filed_at = NULL, filed_ref = NULL, journal_entry_id = NULL WHERE id = ?`, [id]);
  });
  return getReturn(id);
}

// ---------------------------------------------------------------- paying RSL
const liability = tax => (TAXES[tax] || {}).account || '2260';
async function bookPayment(c, user, r, p) {
  const lines = [{ code: liability(r.tax), debit: Number(p.amount), description: `${r.name} ${r.period_label}` }, { code: p.account_code, credit: Number(p.amount), description: `Paid to RSL ${p.reference || ''}` }];
  if (Number(p.fee) > 0) lines.push({ code: '6450', debit: Number(p.fee), description: 'Tax payment fee' }, { code: p.fee_account || p.account_code, credit: Number(p.fee), description: 'Tax payment fee' });
  await accounting.post(c, { date: p.date || undefined, reference: `RSL ${r.tax.toUpperCase()} ${p.reference || ''}`.trim().slice(0, 60), memo: `${r.name} ${r.period_label} paid to RSL`, source_type: 'tax_payment', source_id: p.id, user_id: user.id, lines });
  await c.query(`UPDATE tax_payments SET status = 'paid', paid_at = NOW() WHERE id = ?`, [p.id]);
  await c.query(`UPDATE tax_returns SET amount_paid = amount_paid + ?, status = IF(amount_paid + 0.004 >= amount_due, 'paid', 'part_paid') WHERE id = ?`, [Number(p.amount), r.id]);
}

/** pay by bank / EFT / M-Pesa / cash at RSL – recorded straight away */
async function payManual(user, id, { amount, method, account_code, reference, fee, date }) {
  const r = await getReturn(id);
  if (r.status === 'draft') throw bad('File the return first, then pay it');
  const amt = round2(amount ?? r.balance);
  if (!(amt > 0)) throw bad('Nothing to pay');
  if (amt > r.balance + 0.004) throw bad(`That is more than the balance of ${r.balance.toFixed(2)}`);
  if (!reference) throw bad('Type the bank / RSL receipt reference');
  const acc = account_code || '1050';
  await db.tx(async c => {
    const ins = await c.query('INSERT INTO tax_payments (return_id, amount, fee, method, account_code, reference, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [r.id, amt, round2(fee || 0), method || 'bank', acc, String(reference).slice(0, 80), user.id]);
    await bookPayment(c, user, r, { id: ins.insertId, amount: amt, fee: round2(fee || 0), account_code: acc, reference, date });
  });
  return getReturn(id);
}

/**
 * Pay RSL through MyWallet: a "pay a bill" service (biller "rsl") on a till's open cashier session, through the Smartel
 * POS backend. Step 1 checks with MyWallet and shows the fee; step 2 confirms. The cash is handed in at that till.
 */
async function paySmartel(user, id, { amount, pos_session_id, account_code }) {
  const sm = require('./smartel');
  const s = await settings();
  const r = await getReturn(id);
  if (r.status === 'draft') throw bad('File the return first, then pay it');
  if (!s.tin) throw bad('Enter your TIN under Tax centre → Settings – RSL needs it to know who is paying');
  const amt = round2(amount ?? r.balance);
  if (!(amt > 0) || amt > r.balance + 0.004) throw bad(`Pay between 0 and ${r.balance.toFixed(2)}`);
  const company = (await db.getSetting('company', {})) || {};
  const cell = String(s.rsl_phone || company.phone || '').replace(/\D/g, '').replace(/^266/, '');
  const out = await sm.startOp(user, { pos_session_id, op: 'biller', fields: { biller: 'rsl', account: s.tin, cell: /^[56]\d{7}$/.test(cell) ? cell : undefined, amount: amt, reference: `${r.tax.toUpperCase()} ${r.period_label}` } });
  if (out.op.state === 'failed') throw bad(`MyWallet refused: ${out.op.result || out.op.failure_code}. If RSL is not yet a MyWallet biller, pay at the bank and record it here.`);
  const fee = await rslFee(amt, out.op.fee);
  const ins = await db.query('INSERT INTO tax_payments (return_id, amount, fee, method, account_code, smartel_op_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [r.id, amt, fee, 'smartel', account_code || '1050', out.op.id, user.id]);
  return { payment_id: ins.insertId, op: out.op, fee, total: round2(amt + fee), fee_from: out.op.fee ? 'MyWallet' : 'tariff', session_uuid: out.session_uuid, return: await getReturn(id) };
}
async function settleSmartel(user, paymentId, step = 'refresh', { otp, pin } = {}) {
  const sm = require('./smartel');
  const p = await db.one('SELECT * FROM tax_payments WHERE id = ?', [paymentId]);
  if (!p || p.method !== 'smartel') throw bad('Payment not found');
  if (p.status !== 'pending') return { payment: p, return: await getReturn(p.return_id) };
  const op = step === 'confirm' ? await sm.confirmOp(user, p.smartel_op_id, { otp, pin }) : await sm.refreshOp(p.smartel_op_id);
  if (op.state === 'completed') {
    const r = await getReturn(p.return_id);
    const fee = await rslFee(Number(p.amount), op.fee != null ? op.fee : p.fee);
    // MyWallet's quoted fee is taken from the float (agency clearing); a tariff fee is paid with the tax from the same money
    await db.tx(c => bookPayment(c, user, r, { id: p.id, amount: Number(p.amount), fee, fee_account: op.fee ? '2450' : p.account_code, account_code: p.account_code, reference: op.mw_ref }));
    await db.query('UPDATE tax_payments SET reference = ?, fee = ? WHERE id = ?', [op.mw_ref, fee, p.id]);
    // the RSL payment is a customer of its own at the till: close it with a services receipt
    await sm.finishServices(user, op.session_uuid).catch(() => {});
  } else if (op.state === 'failed') await db.query(`UPDATE tax_payments SET status = 'failed' WHERE id = ?`, [p.id]);
  return { op, payment: await db.one('SELECT * FROM tax_payments WHERE id = ?', [p.id]), return: await getReturn(p.return_id) };
}

// ---------------------------------------------------------------- withholding tax
async function recordWithholding(user, { direction = 'deducted', partner_id, kind, gross, rate, tx_date, reference }) {
  const s = await settings();
  if (!['deducted', 'suffered'].includes(direction)) throw bad('Choose deducted or suffered');
  const p = await db.one('SELECT id, name FROM partners WHERE id = ?', [partner_id]);
  if (!p) throw bad('Choose the supplier / customer');
  const g = round2(gross);
  if (!(g > 0)) throw bad('Enter the amount before VAT that the tax is worked on');
  const rt = rate !== undefined && rate !== null && rate !== '' ? Number(rate) : Number(s.wht_rates[kind]);
  if (!(rt >= 0 && rt <= 60)) throw bad('Choose what the payment was for');
  const amt = round2(g * rt / 100);
  const d = tx_date || today();
  return db.tx(async c => {
    const ins = await c.query('INSERT INTO tax_withholding (direction, partner_id, kind, tx_date, gross, rate, amount, reference, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [direction, p.id, kind || 'other', d, g, rt, amt, reference || null, user.id]);
    const cert = `WHT/${d.slice(0, 4)}/${String(ins.insertId).padStart(5, '0')}`;
    await c.query('UPDATE tax_withholding SET certificate_no = ? WHERE id = ?', [direction === 'deducted' ? cert : (reference || null), ins.insertId]);
    // deducted: we owe the supplier less and RSL more; suffered: a customer paid us less and gave a certificate we claim against income tax
    const lines = direction === 'deducted'
      ? [{ code: '2000', debit: amt, partner_id: p.id, description: `WHT withheld ${cert}` }, { code: '2220', credit: amt, description: `WHT ${p.name}` }]
      : [{ code: '1420', debit: amt, description: `WHT certificate ${reference || ''}` }, { code: '1100', credit: amt, partner_id: p.id, description: `WHT withheld by ${p.name}` }];
    await accounting.post(c, { date: d, reference: direction === 'deducted' ? cert : `WHT-IN ${reference || ins.insertId}`.slice(0, 60), memo: `Withholding tax ${direction} – ${p.name}`, source_type: 'withholding', source_id: ins.insertId, user_id: user.id, lines });
    return c.one('SELECT w.*, p.name partner_name FROM tax_withholding w JOIN partners p ON p.id = w.partner_id WHERE w.id = ?', [ins.insertId]);
  });
}

/** taxes paid and fees paid for paying them, per tax year */
async function paymentSummary(from, to) {
  const rows = await db.query(`SELECT r.tax, COUNT(p.id) n, COALESCE(SUM(p.amount),0) paid, COALESCE(SUM(p.fee),0) fees FROM tax_payments p JOIN tax_returns r ON r.id = p.return_id
    WHERE p.status = 'paid' AND DATE(p.paid_at) BETWEEN ? AND ? GROUP BY r.tax ORDER BY r.tax`, [from, to]);
  return { from, to, rows: rows.map(x => ({ tax: x.tax, name: (TAXES[x.tax] || {}).name || x.tax, payments: Number(x.n), paid: round2(x.paid), fees: round2(x.fees) })),
    total_paid: round2(rows.reduce((a, x) => a + Number(x.paid), 0)), total_fees: round2(rows.reduce((a, x) => a + Number(x.fees), 0)) };
}

/** what is owed to RSL right now, per tax (from the liability accounts) */
async function liabilities() {
  const rows = await db.query(`SELECT a.code, a.name, COALESCE(SUM(l.credit - l.debit),0) bal FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id
    WHERE a.code IN ('2100','1400','2110','1410','2200','2220','2230','2240','2260','1420') GROUP BY a.id ORDER BY a.code`);
  return rows.map(r => ({ code: r.code, name: r.name, balance: round2(r.bal) }));
}

module.exports = { rslFee, vatChecks, paymentSummary, DEFAULTS, TAXES, WHT_KINDS, settings, saveSettings, taxYear, schedule, prepare, file, reopen, getReturn, payManual, paySmartel, settleSmartel, recordWithholding, liabilities, vatFigures, profitBeforeTax };
