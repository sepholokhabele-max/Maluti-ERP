const db = require('../db');
const { DEFAULT_ACCOUNTS, clearCache } = require('./accounting');
const { hash } = require('../auth');

async function isInitialised() {
  const r = await db.one('SELECT COUNT(*) n FROM users');
  return r.n > 0;
}

async function initialise({ company, admin, demo }) {
  if (await isInitialised()) throw Object.assign(new Error('System already initialised'), { status: 400 });
  await db.tx(async c => {
    await c.query(`INSERT INTO settings (k, v) VALUES ('company', ?)`, [JSON.stringify({
      name: company.name || 'My Business', address: company.address || '', phone: company.phone || '',
      email: company.email || '', tax_number: company.tax_number || '',
      currency_code: company.currency_code || 'LSL', currency_symbol: company.currency_symbol || 'M',
      receipt_footer: company.receipt_footer || 'Thank you for your business!',
      default_vat: Number(company.vat_rate ?? 15)
    })]);

    for (const [code, name, type] of DEFAULT_ACCOUNTS)
      await c.query('INSERT IGNORE INTO accounts (code, name, type) VALUES (?, ?, ?)', [code, name, type]);

    const vat = Number(company.vat_rate ?? 15);
    const t1 = await c.query('INSERT INTO taxes (name, rate, price_includes_tax) VALUES (?, ?, 1)', [`VAT ${vat}%`, vat]);
    await c.query(`INSERT INTO taxes (name, rate, price_includes_tax) VALUES ('Zero rated', 0, 1), ('Exempt', 0, 1)`);

    await c.query(`INSERT INTO payment_methods (name, kind, account_code, requires_reference, plugin_id, sort_order) VALUES
      ('Cash', 'cash', '1000', 0, NULL, 1),
      ('Card', 'card', '1010', 0, NULL, 2),
      ('M-Pesa', 'mobile_money', '1020', 1, NULL, 3),
      ('EcoCash', 'mobile_money', '1020', 1, NULL, 4),
      ('Customer Account', 'account', '1100', 0, NULL, 5)`);

    await c.query(`INSERT INTO pos_terminals (name, mode) VALUES ('Retail Till', 'retail'), ('Restaurant', 'restaurant'), ('Bar', 'bar')`);
    const f1 = await c.query(`INSERT INTO floors (name, sort_order) VALUES ('Main Hall', 1)`);
    const f2 = await c.query(`INSERT INTO floors (name, sort_order) VALUES ('Patio', 2)`);
    for (let i = 1; i <= 8; i++) await c.query('INSERT INTO restaurant_tables (floor_id, name, seats) VALUES (?, ?, ?)', [f1.insertId, `T${i}`, i <= 4 ? 4 : 6]);
    for (let i = 1; i <= 4; i++) await c.query('INSERT INTO restaurant_tables (floor_id, name, seats) VALUES (?, ?, 2)', [f2.insertId, `P${i}`]);

    await c.query(
      `INSERT INTO users (name, username, email, password_hash, pin_hash, role) VALUES (?, ?, ?, ?, ?, 'admin')`,
      [admin.name || 'Administrator', admin.username, admin.email || null, hash(admin.password), admin.pin ? hash(admin.pin) : null]);

    if (demo) await seedDemo(c, t1.insertId);
  });
  clearCache();
}

async function seedDemo(c, vatId) {
  const cats = [
    ['Food', '#ea580c', 'kitchen'], ['Drinks', '#0284c7', 'bar'], ['Beer & Cider', '#ca8a04', 'bar'],
    ['Groceries', '#16a34a', 'none'], ['Household', '#7c3aed', 'none']
  ];
  const ids = {};
  for (const [i, [n, col, st]] of cats.entries()) {
    const r = await c.query('INSERT INTO categories (name, color, station, sort_order) VALUES (?, ?, ?, ?)', [n, col, st, i]);
    ids[n] = r.insertId;
  }
  const prods = [
    ['FD001', null, 'Beef Burger & Chips', 'Food', 'consumable', 95, 38],
    ['FD002', null, 'Chicken Wings (8)', 'Food', 'consumable', 80, 30],
    ['FD003', null, 'Papa & Moroho', 'Food', 'consumable', 45, 15],
    ['FD004', null, 'Grilled Fish', 'Food', 'consumable', 120, 55],
    ['DR001', '6001234000013', 'Coca-Cola 330ml', 'Drinks', 'stock', 15, 8.5],
    ['DR002', '6001234000020', 'Still Water 500ml', 'Drinks', 'stock', 12, 5],
    ['DR003', null, 'Cappuccino', 'Drinks', 'consumable', 30, 9],
    ['BR001', '6001234000037', 'Maluti Lager 340ml', 'Beer & Cider', 'stock', 22, 13],
    ['BR002', '6001234000044', 'Savanna Dry 330ml', 'Beer & Cider', 'stock', 30, 18],
    ['GR001', '6001234000051', 'White Bread 700g', 'Groceries', 'stock', 18, 13],
    ['GR002', '6001234000068', 'Maize Meal 5kg', 'Groceries', 'stock', 75, 58],
    ['GR003', '6001234000075', 'Full Cream Milk 1L', 'Groceries', 'stock', 21, 15],
    ['HH001', '6001234000082', 'Dishwashing Liquid 750ml', 'Household', 'stock', 35, 22]
  ];
  for (const [sku, bc, name, cat, type, price, cost] of prods) {
    const r = await c.query(
      `INSERT INTO products (sku, barcode, name, category_id, type, price, cost, tax_id, stock_qty, reorder_level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sku, bc, name, ids[cat], type, price, cost, vatId, type === 'stock' ? 48 : 0, type === 'stock' ? 12 : 0]);
    if (type === 'stock') await c.query(`INSERT INTO stock_moves (product_id, qty, unit_cost, move_type, reference) VALUES (?, 48, ?, 'opening', 'Opening stock')`, [r.insertId, cost]);
  }
  await require('./stock').syncLocations(c);
  // Opening balances so books balance: inventory & cash funded by equity
  const inv = await c.one(`SELECT COALESCE(SUM(stock_qty*cost),0) v FROM products WHERE type='stock'`);
  const je = await c.query(`INSERT INTO journal_entries (entry_date, reference, memo, source_type) VALUES (CURDATE(), 'OPENING', 'Opening balances (demo)', 'opening')`);
  const acc = async code => (await c.one('SELECT id FROM accounts WHERE code = ?', [code])).id;
  await c.query('INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES (?, ?, ?, 0), (?, ?, 5000, 0), (?, ?, 0, ?)',
    [je.insertId, await acc('1200'), inv.v, je.insertId, await acc('1300'), je.insertId, await acc('3000'), Number(inv.v) + 5000]);
  await c.query(`INSERT INTO partners (name, is_customer, is_supplier, phone, email) VALUES
    ('Walk-in Customer', 1, 0, NULL, NULL),
    ('Thabo Mokoena', 1, 0, '+266 5800 1234', 'thabo@example.com'),
    ('Maseru Wholesale Distributors', 0, 1, '+266 2231 0000', 'orders@maseruwholesale.example'),
    ('Highlands Beverages', 0, 1, '+266 2232 1111', 'sales@highlandsbev.example')`);
}

module.exports = { isInitialised, initialise };
