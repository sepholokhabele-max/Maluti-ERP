// Animal types (beef, pork, lamb, goat, chicken, game…): starter cutting templates and reports by animal.
const db = require('../db');
const { round2, bad } = require('../util');

const r3 = n => Math.round(Number(n) * 1000) / 1000;

const SPECIES = [
  { key: 'beef', name: 'Beef', icon: '🐄', color: '#b91c1c' },
  { key: 'pork', name: 'Pork', icon: '🐖', color: '#db2777' },
  { key: 'lamb', name: 'Lamb / mutton', icon: '🐑', color: '#7c3aed' },
  { key: 'goat', name: 'Goat', icon: '🐐', color: '#a16207' },
  { key: 'chicken', name: 'Chicken / poultry', icon: '🐔', color: '#ea580c' },
  { key: 'game', name: 'Game', icon: '🦌', color: '#15803d' },
  { key: 'other', name: 'Other', icon: '🥩', color: '#475569' }
];
const KEYS = SPECIES.map(s => s.key);

// Typical retail cutting yields (% of carcass weight). Starting points only – edit them to match your butchers.
// [cut name, yield %, shelf life days] ; waste lines: [name, %, null, true]
const STARTERS = {
  beef: { carcass: 'Beef carcass (side)', template: 'Beef side – starter', shelf: 10, plu: 1101, life: 5, cuts: [
    ['Beef rump steak', 4], ['Beef sirloin / T-bone', 6], ['Beef fillet', 2], ['Beef topside & silverside', 10], ['Beef chuck', 9], ['Beef brisket', 5],
    ['Beef short rib', 6], ['Beef shin', 4], ['Stewing beef', 10], ['Beef mince', 14, 2], ['Beef soup bones', 12, 3], ['Fat & trim', 12, null, true]] },
  pork: { carcass: 'Pork carcass', template: 'Pork carcass – starter', shelf: 7, plu: 2101, life: 4, cuts: [
    ['Pork leg / gammon', 18], ['Pork loin chops', 14], ['Pork belly', 12], ['Pork shoulder', 16], ['Pork spare ribs', 5], ['Pork trotters & hocks', 5],
    ['Pork mince', 8, 2], ['Pork bones', 6, 3], ['Skin & fat', 10, null, true]] },
  lamb: { carcass: 'Lamb / mutton carcass', template: 'Lamb carcass – starter', shelf: 10, plu: 3101, life: 5, cuts: [
    ['Lamb leg', 24], ['Lamb loin chops', 12], ['Lamb shoulder', 18], ['Lamb rib / rack', 8], ['Lamb neck', 5], ['Lamb breast / riblets', 8], ['Lamb shanks', 4],
    ['Lamb stew & mince', 6, 2], ['Lamb bones', 7, 3], ['Fat & trim', 4, null, true]] },
  goat: { carcass: 'Goat carcass', template: 'Goat carcass – starter', shelf: 10, plu: 4101, life: 5, cuts: [
    ['Goat leg', 26], ['Goat shoulder', 20], ['Goat loin chops', 10], ['Goat rib & neck', 12], ['Goat curry / stew pieces', 14, 3], ['Goat bones', 10, 3], ['Fat & trim', 4, null, true]] },
  chicken: { carcass: 'Whole chicken', template: 'Whole chicken – starter', shelf: 5, plu: 5101, life: 3, cuts: [
    ['Chicken breasts', 28], ['Chicken thighs', 16], ['Chicken drumsticks', 14], ['Chicken wings', 10], ['Chicken frames / backs', 20, 2], ['Skin & trim', 6, null, true]] },
  game: { carcass: 'Game carcass (venison)', template: 'Game carcass – starter', shelf: 10, plu: 6101, life: 5, cuts: [
    ['Venison haunch', 28], ['Venison loin / backstrap', 8], ['Venison fillet', 2], ['Venison shoulder', 16], ['Venison neck', 6], ['Venison stew & mince', 14, 2],
    ['Venison bones', 16, 3], ['Trim', 6, null, true]] }
};

function starters() {
  return Object.entries(STARTERS).map(([k, s]) => ({ species: k, ...SPECIES.find(x => x.key === k), carcass: s.carcass, template: s.template,
    cuts: s.cuts.map(([name, pct, , waste]) => ({ name, yield_pct: pct, is_waste: !!waste })),
    saleable_pct: s.cuts.filter(c => !c[3]).reduce((t, c) => t + c[1], 0) }));
}

/** Create carcass + cut products (if missing), a category per animal and a cutting template. Prices are left at 0 to fill in. */
async function installStarters(keys) {
  keys = (keys || []).filter(k => STARTERS[k]);
  if (!keys.length) throw bad('Choose at least one animal');
  return db.tx(async c => {
    const tax = await c.one('SELECT id FROM taxes WHERE active = 1 ORDER BY id LIMIT 1');
    const out = [];
    for (const k of keys) {
      const S = STARTERS[k], sp = SPECIES.find(x => x.key === k);
      let made = 0;
      let cat = await c.one('SELECT id FROM categories WHERE name = ?', [sp.name]);
      if (!cat) cat = { id: (await c.query('INSERT INTO categories (name, color) VALUES (?, ?)', [sp.name, sp.color])).insertId };
      const ensure = async (name, extra) => {
        const ex = await c.one('SELECT id FROM products WHERE name = ?', [name]);
        if (ex) { await c.query('UPDATE products SET species = COALESCE(species, ?) WHERE id = ?', [k, ex.id]); return ex.id; }
        made++;
        return (await c.query('INSERT INTO products SET ?', [{ name, type: 'stock', uom: 'kg', price: 0, cost: 0, tax_id: tax ? tax.id : null, category_id: cat.id, species: k, track_batches: 1, active: 1, ...extra }])).insertId;
      };
      let plu = S.plu;
      const nextPlu = async () => { while (await c.one('SELECT id FROM products WHERE plu = ?', [String(plu)])) plu++; return String(plu++); };
      const carcassId = await ensure(S.carcass, { is_carcass: 1, sold_by_weight: 0, pos_visible: 0, shelf_life_days: S.shelf });
      const lines = [];
      for (const [name, pct, life, waste] of S.cuts) {
        if (waste) { lines.push({ product_id: null, name, yield_pct: pct, is_waste: 1 }); continue; }
        const exists = await c.one('SELECT id FROM products WHERE name = ?', [name]);
        const id = exists ? await ensure(name) : await ensure(name, { sold_by_weight: 1, pos_visible: 1, shelf_life_days: life || S.life, plu: await nextPlu() });
        lines.push({ product_id: id, name, yield_pct: pct, is_waste: 0 });
      }
      let tpl = await c.one('SELECT id FROM cut_templates WHERE name = ? AND active = 1', [S.template]);
      if (!tpl) {
        tpl = { id: (await c.query('INSERT INTO cut_templates (name, source_product_id, notes) VALUES (?, ?, ?)', [S.template, carcassId, 'Starter yields – adjust to your own cutting results'])).insertId };
        for (const l of lines) await c.query('INSERT INTO cut_template_lines (template_id, product_id, name, yield_pct, is_waste) VALUES (?, ?, ?, ?, ?)', [tpl.id, l.product_id, l.name, l.yield_pct, l.is_waste]);
      }
      out.push({ species: k, name: sp.name, products_created: made, template_id: tpl.id, carcass_product_id: carcassId });
    }
    return out;
  });
}

/** Everything per animal for a period: carcasses received (live weight & dressing %), cutting yield, sales, waste */
async function report(from, to) {
  const range = [from + ' 00:00:00', to + ' 23:59:59'];
  const recv = await db.query(`SELECT COALESCE(p.species, 'other') species, COUNT(*) n, SUM(b.qty_in) kg, SUM(b.qty_in * b.unit_cost) cost,
      SUM(CASE WHEN b.live_weight > 0 THEN b.live_weight END) live, SUM(CASE WHEN b.live_weight > 0 THEN b.qty_in END) kg_with_live
    FROM stock_batches b JOIN products p ON p.id = b.product_id WHERE p.is_carcass = 1 AND b.source = 'purchase' AND b.received_date BETWEEN ? AND ? GROUP BY 1`, [from, to]);
  const cut = await db.query(`SELECT COALESCE(p.species, 'other') species, COUNT(*) n, SUM(b.source_qty) input, SUM(b.output_qty_total) cuts, SUM(b.waste_qty) loss
    FROM breakdowns b JOIN products p ON p.id = b.source_product_id WHERE b.breakdown_date BETWEEN ? AND ? GROUP BY 1`, [from, to]);
  const sales = await db.query(`SELECT p.species, SUM(CASE WHEN p.uom = 'kg' THEN l.qty ELSE 0 END) kg, SUM(l.net_amount) net, SUM(l.qty * l.unit_cost) cogs
    FROM order_lines l JOIN orders o ON o.id = l.order_id JOIN products p ON p.id = l.product_id
    WHERE o.status IN ('paid','refunded') AND o.paid_at BETWEEN ? AND ? AND p.species IS NOT NULL GROUP BY 1`, range);
  const inv = await db.query(`SELECT p.species, SUM(CASE WHEN p.uom = 'kg' THEN l.qty ELSE 0 END) kg, SUM(l.net_amount) net
    FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN products p ON p.id = l.product_id
    WHERE i.kind = 'customer_invoice' AND i.status IN ('posted','partial','paid') AND i.invoice_date BETWEEN ? AND ? AND p.species IS NOT NULL GROUP BY 1`, [from, to]).catch(() => []);
  const waste = await db.query(`SELECT p.species, SUM(-m.qty) kg, SUM(-m.qty * m.unit_cost) value FROM stock_moves m JOIN products p ON p.id = m.product_id
    WHERE m.move_type = 'waste' AND m.created_at BETWEEN ? AND ? AND p.species IS NOT NULL GROUP BY 1`, range);
  const g = (arr, k) => arr.find(x => x.species === k) || {};
  const rows = SPECIES.map(sp => {
    const R = g(recv, sp.key), C = g(cut, sp.key), S = g(sales, sp.key), I = g(inv, sp.key), W = g(waste, sp.key);
    const net = round2(Number(S.net || 0) + Number(I.net || 0));
    return { species: sp.key, name: sp.name, icon: sp.icon, color: sp.color,
      carcasses: Number(R.n || 0), carcass_kg: r3(R.kg || 0), carcass_cost: round2(R.cost || 0), live_kg: R.live ? r3(R.live) : null,
      dressing_pct: Number(R.live) > 0 ? Math.round(Number(R.kg_with_live) / Number(R.live) * 1000) / 10 : null,
      breakdowns: Number(C.n || 0), cut_input_kg: r3(C.input || 0), cuts_kg: r3(C.cuts || 0), cut_loss_kg: r3(C.loss || 0),
      yield_pct: Number(C.input) > 0 ? Math.round(Number(C.cuts) / Number(C.input) * 1000) / 10 : null,
      sold_kg: r3(Number(S.kg || 0) + Number(I.kg || 0)), sales_net: net, cogs: round2(S.cogs || 0), gross_margin: round2(Number(S.net || 0) - Number(S.cogs || 0)),
      margin_pct: Number(S.net) > 0 ? Math.round((Number(S.net) - Number(S.cogs || 0)) / Number(S.net) * 1000) / 10 : null,
      waste_kg: r3(W.kg || 0), waste_value: round2(W.value || 0) };
  }).filter(r => r.carcasses || r.breakdowns || r.sales_net || r.waste_kg);
  return { from, to, rows, species: SPECIES };
}

module.exports = { SPECIES, KEYS, STARTERS, starters, installStarters, report };
