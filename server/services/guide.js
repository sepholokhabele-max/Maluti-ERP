// Store setup guide: an ordered checklist per type of business (retail, restaurant, bar, butchery).
// Most steps tick themselves by looking at the data; the rest are confirmed by the admin.
const db = require('../db');

const TYPES = [
  { key: 'retail', name: 'Retail shop', icon: '🛍️' },
  { key: 'restaurant', name: 'Restaurant / café', icon: '🍽️' },
  { key: 'bar', name: 'Bar / tavern', icon: '🍺' },
  { key: 'butchery', name: 'Butchery', icon: '🥩' }
];

const n = async (sql, args = []) => { try { const r = await db.one(sql, args); return Number(r ? Object.values(r)[0] : 0) || 0; } catch (_) { return 0; } };

async function facts() {
  const company = (await db.getSetting('company', {})) || {};
  const email = (await db.getSetting('email', {})) || {};
  const pos = (await db.getSetting('pos', {})) || {};
  const butch = (await db.getSetting('butchery', {})) || {};
  const logo = await db.getSetting('company_logo', null);
  return {
    company, email, pos, butch, logo: !!(logo && logo.data_url),
    taxes: await n('SELECT COUNT(*) FROM taxes WHERE active = 1'),
    paymethods: await n('SELECT COUNT(*) FROM payment_methods WHERE active = 1'),
    mobileRef: await n(`SELECT COUNT(*) FROM payment_methods WHERE active = 1 AND kind IN ('card','mobile_money') AND requires_reference = 1`),
    tills: Object.fromEntries((await db.query('SELECT mode, COUNT(*) c FROM pos_terminals WHERE active = 1 GROUP BY mode').catch(() => [])).map(r => [r.mode, Number(r.c)])),
    staff: await n(`SELECT COUNT(*) FROM users WHERE active = 1 AND role <> 'admin'`),
    staffPins: await n(`SELECT COUNT(*) FROM users WHERE active = 1 AND role IN ('cashier','waiter','bartender','manager') AND pin_hash IS NOT NULL`),
    roles: Object.fromEntries((await db.query('SELECT role, COUNT(*) c FROM users WHERE active = 1 GROUP BY role').catch(() => [])).map(r => [r.role, Number(r.c)])),
    categories: await n('SELECT COUNT(*) FROM categories'),
    catStation: Object.fromEntries((await db.query('SELECT station, COUNT(*) c FROM categories GROUP BY station').catch(() => [])).map(r => [r.station, Number(r.c)])),
    products: await n('SELECT COUNT(*) FROM products WHERE active = 1 AND price > 0'),
    unpriced: await n(`SELECT COUNT(*) FROM products WHERE active = 1 AND pos_visible = 1 AND price = 0`),
    stockIn: await n(`SELECT COUNT(*) FROM stock_moves WHERE move_type IN ('opening','purchase','adjustment')`),
    suppliers: await n('SELECT COUNT(*) FROM partners WHERE is_supplier = 1 AND active = 1'),
    sales: await n(`SELECT COUNT(*) FROM orders WHERE status IN ('paid','refunded')`),
    closedSessions: await n(`SELECT COUNT(*) FROM pos_sessions WHERE status = 'closed'`),
    floors: await n('SELECT COUNT(*) FROM floors'),
    tables: await n('SELECT COUNT(*) FROM restaurant_tables WHERE active = 1'),
    bottles: await n('SELECT COUNT(*) FROM products WHERE active = 1 AND bottle_ml > 0'),
    bottlesWeighed: await n('SELECT COUNT(*) FROM products WHERE active = 1 AND bottle_ml > 0 AND bottle_empty_g > 0'),
    measures: await n('SELECT COUNT(*) FROM products WHERE active = 1 AND pour_from_id IS NOT NULL'),
    barCounts: await n(`SELECT COUNT(*) FROM bar_counts WHERE status = 'posted'`),
    templates: await n('SELECT COUNT(*) FROM cut_templates WHERE active = 1'),
    weighed: await n('SELECT COUNT(*) FROM products WHERE active = 1 AND sold_by_weight = 1'),
    weighedNoPlu: await n(`SELECT COUNT(*) FROM products WHERE active = 1 AND sold_by_weight = 1 AND (plu IS NULL OR plu = '')`),
    weighedNoPrice: await n('SELECT COUNT(*) FROM products WHERE active = 1 AND sold_by_weight = 1 AND price = 0'),
    carcassProducts: await n('SELECT COUNT(*) FROM products WHERE active = 1 AND is_carcass = 1'),
    carcassesIn: await n(`SELECT COUNT(*) FROM stock_batches b JOIN products p ON p.id = b.product_id WHERE p.is_carcass = 1 AND b.source = 'purchase'`),
    breakdowns: await n('SELECT COUNT(*) FROM breakdowns'),
    recipes: await n('SELECT COUNT(*) FROM recipes WHERE active = 1'),
    noSpecies: await n('SELECT COUNT(*) FROM products WHERE active = 1 AND (is_carcass = 1 OR sold_by_weight = 1) AND species IS NULL')
  };
}

/**
 * Each step: key, title, why (what it is for), how (what to enter), link (screen), done (auto) or manual: true.
 * `types` limits a step to some kinds of business; no types = every business.
 */
function steps(F) {
  const has = (o, k) => Number((o || {})[k] || 0) > 0;
  return [
    // ---------- foundation (all businesses)
    { key: 'company', group: 'Business details', title: 'Company details', link: '#/settings?tab=company',
      why: 'Printed on every receipt, invoice and report – and required on tax invoices.',
      how: 'Enter the trading name, address, phone, email and VAT/TIN number. Check the currency (M / LSL).',
      done: !!(F.company.name && F.company.address && F.company.phone) },
    { key: 'logo', group: 'Business details', title: 'Upload your logo', link: '#/settings?tab=company', optional: true,
      why: 'Makes receipts, invoices and the login screen look like your shop.',
      how: 'Settings → Company → Upload logo. A PNG on a white background works best; keep "black & white" on for thermal printers.',
      done: F.logo },
    { key: 'taxes', group: 'Business details', title: 'Check VAT rates', link: '#/settings?tab=taxes', manual: true,
      why: 'Every product uses a tax rate; wrong rates mean wrong VAT returns.',
      how: 'Standard VAT 15% is created for you. Add "Zero-rated 0%" for basic foods if your accountant says so. Leave "prices include tax" ticked for shops.' },
    { key: 'payments', group: 'Business details', title: 'Payment methods', link: '#/settings?tab=payments',
      why: 'Decides the buttons on the till (cash, card, M-Pesa, EcoCash, account) and how each is reconciled.',
      how: 'Keep the ones you accept, untick the rest. Tick "require reference" for card and mobile money. Optionally paste your M-Pesa/EcoCash merchant QR text for pay-by-QR.',
      done: F.paymethods > 0 && F.mobileRef > 0 },
    { key: 'tills', group: 'Tills & staff', title: 'Tills (one per counter)', link: '#/settings?tab=terminals',
      why: 'Each counter or computer that takes money is a till with its own cashier sessions and cash-up.',
      how: 'Rename the tills to match your counters (e.g. "Front counter", "Bar 1"). Retail and butchery counters use type Retail; restaurants Restaurant; bars Bar.',
      check: t => (t === 'restaurant' ? has(F.tills, 'restaurant') : t === 'bar' ? has(F.tills, 'bar') : has(F.tills, 'retail')) },
    { key: 'staff', group: 'Tills & staff', title: 'Staff users, roles and PINs', link: '#/settings?tab=users',
      why: 'Every sale, refund and cash-up is linked to a person. Cashiers log in at the till with a PIN.',
      how: 'Add each staff member with the right role (cashier, waiter, bartender, manager, accountant) and a unique 4–6 digit PIN. Don\'t let staff share the admin login.',
      done: F.staff > 0 && F.staffPins > 0 },
    // ---------- products & stock
    { key: 'categories', group: 'Products & stock', title: 'Product categories', link: '#/products',
      why: 'Categories are the buttons on the till and decide where kitchen/bar tickets print.',
      how: 'Products → Categories. Create groups like "Beef", "Pork", "Drinks", "Groceries", with a colour each. Restaurant food: station Kitchen; drinks in restaurants/bars: station Bar.',
      done: F.categories > 0 },
    { key: 'products', group: 'Products & stock', title: 'Products and selling prices', link: '#/products',
      why: 'Nothing can be sold until it exists with a price.',
      how: 'Add each item (or Import CSV) with its price including VAT, tax, unit and barcode. Stocked items are counted; meals and drinks made to order are "Made to order".',
      done: F.products > 0 && F.unpriced === 0, note: F.unpriced ? `${F.unpriced} item(s) on the till still have no price` : '' },
    { key: 'suppliers', group: 'Products & stock', title: 'Suppliers', link: '#/partners?type=supplier',
      why: 'Purchase orders and supplier bills need a supplier; costs and what you owe come from them.',
      how: 'Contacts → Suppliers: add abattoirs, farmers, wholesalers and distributors with phone and VAT number.',
      done: F.suppliers > 0 },
    { key: 'stock', group: 'Products & stock', title: 'Opening stock', link: '#/inventory',
      why: 'Stock levels, cost of sales and profit are only right once the system knows what is on the shelves.',
      how: 'Either count everything once (Inventory → stock count / adjustment) or receive your first delivery (Purchasing → New order → Confirm → Receive).',
      done: F.stockIn > 0 },
    // ---------- restaurant
    { key: 'floors', group: 'Restaurant', title: 'Floors and tables', link: '#/settings?tab=restaurant', types: ['restaurant'],
      why: 'Waiters open orders on a table plan; bills and turnover per table come from it.',
      how: 'Settings → Restaurant floors: add areas (Inside, Patio) and their tables with seat counts.',
      done: F.floors > 0 && F.tables > 0 },
    { key: 'kitchen', group: 'Restaurant', title: 'Kitchen tickets / kitchen screen', link: '#/settings?tab=pos', types: ['restaurant'],
      why: 'Orders must reach the kitchen as soon as the waiter sends them.',
      how: 'Give food categories station "Kitchen". Then either tick "Print a kitchen/bar ticket" (Settings → POS) or add a user with role "kitchen" and open Kitchen Display on a tablet.',
      done: has(F.catStation, 'kitchen') && (!!F.pos.print_kitchen_tickets || has(F.roles, 'kitchen')) },
    { key: 'waiters', group: 'Restaurant', title: 'Waiter logins', link: '#/settings?tab=users', types: ['restaurant'],
      why: 'Each waiter\'s tables, sales and tips are tracked separately.',
      how: 'Add each waiter with role "waiter" and a PIN.',
      done: has(F.roles, 'waiter') },
    // ---------- bar
    { key: 'barstation', group: 'Bar', title: 'Drinks categories print to the bar', link: '#/products', types: ['bar'],
      why: 'Drink orders from tables go to the bar printer / screen.',
      how: 'Products → Categories: set station "Bar" on Beers, Spirits, Wines, Soft drinks.',
      done: has(F.catStation, 'bar') },
    { key: 'bottles', group: 'Bar', title: 'Bottles: size and weights', link: '#/products', types: ['bar'],
      why: 'Lets you sell tots/glasses from bottle stock and count open bottles by weighing them.',
      how: 'Edit each spirit/wine: Bar section → bottle size (ml), empty bottle weight and full bottle weight (weigh one of each on the scale).',
      done: F.bottles > 0 && F.bottlesWeighed === F.bottles },
    { key: 'measures', group: 'Bar', title: 'Tots and glasses (measures)', link: '#/products', types: ['bar'],
      why: 'Selling a 25 ml tot takes exactly 25 ml off the bottle – the basis for catching over-pouring.',
      how: 'New product per measure (e.g. "Gin tot 25ml"): type Made to order, price, "poured from" the bottle, measure size in ml.',
      done: F.measures > 0 },
    { key: 'bartenders', group: 'Bar', title: 'Bartender logins', link: '#/settings?tab=users', types: ['bar'],
      why: 'Tabs and cash-ups per bartender.',
      how: 'Add each bartender with role "bartender" and a PIN.',
      done: has(F.roles, 'bartender') },
    { key: 'barcount', group: 'Bar', title: 'First bar stock count', link: '#/bar?tab=count', types: ['bar'],
      why: 'Sets the starting point; every later count shows exactly how many ml went missing.',
      how: 'Bar → Stock count: enter full bottles and weigh each open bottle, then post.',
      done: F.barCounts > 0 },
    // ---------- butchery
    { key: 'butchery_on', group: 'Butchery', title: 'Turn on butchery mode', link: '#/butchery?tab=settings', types: ['butchery'],
      why: 'Switches on weighed sales, scale labels, carcass breakdown & tracing, waste and use-by dates.',
      how: 'Butchery → Settings → tick "Butchery mode on" and save.',
      done: !!F.butch.enabled },
    { key: 'scale', group: 'Butchery', title: 'Connect the scale', link: '#/butchery?tab=settings', types: ['butchery'], manual: true,
      why: 'The till reads the weight straight from the scale – no typing mistakes.',
      how: 'Plug the scale into the till PC (USB/RS-232). Butchery → Settings: tick "A scale is connected", set baud rate etc. as in the scale\'s menu, click "Choose scale port" then "Test scale". Skip if you only sell pre-packed labels.' },
    { key: 'starter', group: 'Butchery', title: 'Cutting templates per animal', link: '#/butchery?tab=templates', types: ['butchery'],
      why: 'Templates create your carcass and cut products and set the yields every breakdown is compared with.',
      how: 'Butchery → Cutting templates → "Starter templates": tick beef, pork, lamb, goat, chicken… Then adjust the yields to your own results.',
      done: F.templates > 0 && F.carcassProducts > 0 },
    { key: 'cutprices', group: 'Butchery', title: 'Prices per kg and scale PLUs', link: '#/products', types: ['butchery'],
      why: 'Cuts are sold per kg. The PLU links the scale\'s label to the right product; prices also decide how carcass cost is shared between cuts.',
      how: 'Products: set the price per kg (incl. VAT) on every cut and check its PLU matches the PLU programmed in your label scale.',
      done: F.weighed > 0 && F.weighedNoPrice === 0 && F.weighedNoPlu === 0,
      note: [F.weighedNoPrice ? `${F.weighedNoPrice} weighed item(s) without a price` : '', F.weighedNoPlu ? `${F.weighedNoPlu} without a PLU` : ''].filter(Boolean).join(', ') },
    { key: 'labels', group: 'Butchery', title: 'Scale barcode layout', link: '#/butchery?tab=settings', types: ['butchery'], manual: true,
      why: 'So the till understands the barcodes your label scale prints (price or weight inside).',
      how: 'Print a test label on your scale. In Butchery → Settings set the prefix (e.g. 21), PLU digits (5), price/weight digits (5) and whether it carries price or weight. Scan the label at the till to check.' },
    { key: 'firstcarcass', group: 'Butchery', title: 'Receive carcasses with tags & weights', link: '#/purchases', types: ['butchery'],
      why: 'Each carcass becomes its own batch, traced kg by kg until it is all sold.',
      how: 'Purchasing → New order for the carcass product → Confirm → Receive: type each carcass tag, its carcass weight and (optional) live weight.',
      done: F.carcassesIn > 0 },
    { key: 'firstcut', group: 'Butchery', title: 'First carcass breakdown', link: '#/butchery', types: ['butchery'],
      why: 'Moves the carcass into cut stock, shares the cost, and records bone/fat loss and yield.',
      how: 'Butchery → Carcass breakdown → New: choose the template and the carcass tag, weigh each cut (⚖ reads the scale) and post.',
      done: F.breakdowns > 0 },
    { key: 'recipes', group: 'Butchery', title: 'Sausage / processing recipes', link: '#/butchery?tab=production', types: ['butchery'], optional: true,
      why: 'Boerewors, sausages, patties and biltong use meat, fat, casings, water and spices – recipes record meat content and cost.',
      how: 'Butchery → Sausage & processing → New recipe: list the ingredients per batch.',
      done: F.recipes > 0 },
    { key: 'species', group: 'Butchery', title: 'Animal on every meat product', link: '#/products', types: ['butchery'], optional: true,
      why: 'Reports by animal (beef, pork, lamb…) need it.',
      how: 'Products: set "Animal" on carcasses and cuts (starter templates do this for you).',
      done: F.weighed > 0 && F.noSpecies === 0, note: F.noSpecies ? `${F.noSpecies} meat product(s) without an animal` : '' },
    // ---------- go live
    { key: 'email', group: 'Go live', title: 'End-of-day report by email', link: '#/settings?tab=email', optional: true,
      why: 'The owner gets sales, payments, cash-ups and waste every evening without logging in.',
      how: 'Settings → Email: enter your email provider\'s SMTP details, the recipients and the time; tick "send automatically", then "Send test".',
      done: !!(F.email.smtp_host && F.email.recipients && (F.email.recipients.length || 0) > 0 && F.email.eod_enabled) },
    { key: 'printer', group: 'Go live', title: 'Test the receipt printer', link: '#/pos', manual: true,
      why: 'Check the logo, VAT number, footer and QR code print correctly before customers see them.',
      how: 'Set the receipt printer as the Windows default printer, open the till, make a small test sale and print the receipt (refund it afterwards).' },
    { key: 'firstsale', group: 'Go live', title: 'First real sale and cash-up', link: '#/pos',
      why: 'Proves the whole chain: till → stock → books → end-of-day report.',
      how: 'Open a cashier session with the float, sell, then close the session and count the cash. The next day, do the Sales Recon.',
      done: F.sales > 0 && F.closedSessions > 0 },
    { key: 'backup', group: 'Go live', title: 'Backups and updates', link: '#/settings?tab=updates', manual: true,
      why: 'Protects your data and keeps the system up to date.',
      how: 'Settings → Updates & backup: click "Back up now" once and copy the file to a flash drive or cloud folder weekly; enter the GitHub repository for online updates.' }
  ];
}

async function guide() {
  const s = { types: [], done: [], dismissed: false, ...((await db.getSetting('setup_guide', {})) || {}) };
  const types = s.types.length ? s.types : ['retail'];
  const F = await facts();
  const list = steps(F).filter(st => !st.types || st.types.some(t => types.includes(t))).map(st => {
    let done = st.manual ? s.done.includes(st.key) : st.check ? types.every(t => st.check(t)) : !!st.done;
    if (!st.manual && s.done.includes(st.key)) done = true; // admin may also tick an automatic step
    return { key: st.key, group: st.group, title: st.title, why: st.why, how: st.how, link: st.link, manual: !!st.manual, optional: !!st.optional, done, note: st.note || '' };
  });
  const required = list.filter(x => !x.optional);
  return { types, all_types: TYPES, dismissed: !!s.dismissed, steps: list,
    done: required.filter(x => x.done).length, total: required.length, complete: required.every(x => x.done) };
}

async function save(patch) {
  const s = { types: [], done: [], dismissed: false, ...((await db.getSetting('setup_guide', {})) || {}) };
  if (Array.isArray(patch.types)) s.types = patch.types.filter(t => TYPES.some(x => x.key === t));
  if (patch.mark) { s.done = [...new Set([...s.done, patch.mark])]; }
  if (patch.unmark) s.done = s.done.filter(k => k !== patch.unmark);
  if (patch.dismissed !== undefined) s.dismissed = !!patch.dismissed;
  await db.setSetting('setup_guide', s);
  return guide();
}

module.exports = { TYPES, guide, save };
