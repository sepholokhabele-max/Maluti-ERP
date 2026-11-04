// Setup guide: an ordered checklist for the kinds of business chosen and the modules switched on.
// Most steps tick themselves by looking at the data; the rest are confirmed by the admin.
const db = require('../db');
const M = require('./modules');

const TYPES = M.TYPES;

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
    promos: await n('SELECT COUNT(*) FROM price_rules WHERE active = 1'),
    approvals: Number((((await db.getSetting('approvals', {})) || {}).po_limit) || 0),
    statements: await n('SELECT COUNT(*) FROM bank_statements'),
    clockins: await n('SELECT COUNT(*) FROM attendance'),
    business: !!((await db.getSetting('business', null)) || {}).modules,
    locations: await n(`SELECT COUNT(*) FROM locations WHERE active = 1 AND kind <> 'transit'`),
    tillsNoLoc: await n('SELECT COUNT(*) FROM pos_terminals WHERE active = 1 AND location_id IS NULL'),
    transfers: await n(`SELECT COUNT(*) FROM stock_transfers WHERE status IN ('sent','received')`),
    quotes: await n('SELECT COUNT(*) FROM sale_orders'),
    services: await n(`SELECT COUNT(*) FROM products WHERE active = 1 AND type = 'service' AND price > 0`),
    tagRules: await n(`SELECT COUNT(*) FROM price_rules WHERE active = 1 AND customer_scope = 'tag'`),
    creditCustomers: await n('SELECT COUNT(*) FROM partners WHERE active = 1 AND is_customer = 1 AND credit_limit > 0'),
    invoicesPosted: await n(`SELECT COUNT(*) FROM invoices WHERE kind = 'customer_invoice' AND status IN ('posted','paid','partial')`),
    employees: await n(`SELECT COUNT(*) FROM employees WHERE status = 'active'`),
    claims: await n('SELECT COUNT(*) FROM expense_claims'),
    boms: await n('SELECT COUNT(*) FROM boms WHERE active = 1'),
    machines: await n('SELECT COUNT(*) FROM equipment WHERE active = 1'),
    machinesScheduled: await n('SELECT COUNT(*) FROM equipment WHERE active = 1 AND interval_days IS NOT NULL'),
    projects: await n('SELECT COUNT(*) FROM projects'),
    timesheets: await n('SELECT COUNT(*) FROM timesheets'),
    projInvoiced: await n('SELECT COUNT(*) FROM invoices WHERE project_id IS NOT NULL'),
    tickets: await n('SELECT COUNT(*) FROM tickets'),
    techs: await n(`SELECT COUNT(*) FROM users WHERE active = 1 AND role IN ('technician','staff')`),
    hdSet: !!(await db.getSetting('helpdesk', null)),
    rfqs: await n('SELECT COUNT(*) FROM rfqs'),
    workOrders: await n(`SELECT COUNT(*) FROM work_orders WHERE status = 'done'`),
    batchTracked: await n('SELECT COUNT(*) FROM products WHERE active = 1 AND track_batches = 1'),
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
    { key: 'business', group: 'Business details', title: 'Type of business and modules', link: '#/settings?tab=business',
      why: 'Decides which apps appear on the home screen and which steps this guide asks for – a school does not need a till, a butchery does.',
      how: 'Settings → Business & modules: tick every kind of business you run (e.g. Lodge + Bar), check the modules that were switched on and turn off what you don\'t need.',
      done: F.business },
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
    { key: 'tills', mods: ['pos'], group: 'Tills & staff', title: 'Tills (one per counter)', link: '#/settings?tab=terminals',
      why: 'Each counter or computer that takes money is a till with its own cashier sessions and cash-up.',
      how: 'Rename the tills to match your counters (e.g. "Front counter", "Bar 1"). Retail and butchery counters use type Retail; restaurants Restaurant; bars Bar.',
      check: t => { const T = TYPES.find(x => x.key === t); return !T || !T.till || has(F.tills, T.till); } },
    { key: 'staff', group: 'Tills & staff', title: 'Staff users, roles and PINs', link: '#/settings?tab=users',
      why: 'Every sale, refund and cash-up is linked to a person. Cashiers log in at the till with a PIN.',
      how: 'Add each staff member with the right role (cashier, waiter, bartender, manager, accountant) and a unique 4–6 digit PIN. Don\'t let staff share the admin login.',
      done: F.staff > 0 && F.staffPins > 0 },
    { key: 'attendance', mods: ['attendance'], group: 'Tills & staff', title: 'Staff clock in and out', link: '#/attendance', optional: true,
      why: 'Shows who is at work, hours worked and overtime – and can add overtime to payroll.',
      how: 'Staff tap "🕐 Clock in / out" on the login screen (or 🕐 on the till) with their PIN at the start and end of each shift. Link each employee to their login under HR → employee.',
      done: F.clockins > 0 },
    { key: 'approvals', mods: ['purchasing'], group: 'Tills & staff', title: 'Approval limit for purchases', link: '#/approvals', optional: true,
      why: 'Stops large orders being placed without a manager seeing them.',
      how: 'Approvals → set the amount above which purchase orders need a manager. Expense claims always need approval.',
      done: F.approvals > 0 },
    // ---------- products & stock
    { key: 'categories', group: 'Products & stock', title: 'Product categories', link: '#/products',
      why: 'Categories are the buttons on the till and decide where kitchen/bar tickets print.',
      how: 'Products → Categories. Create groups like "Beef", "Pork", "Drinks", "Groceries", with a colour each. Restaurant food: station Kitchen; drinks in restaurants/bars: station Bar.',
      done: F.categories > 0 },
    { key: 'products', group: 'Products & stock', title: 'Products and selling prices', link: '#/products',
      why: 'Nothing can be sold until it exists with a price.',
      how: 'Add each item (or Import CSV) with its price including VAT, tax, unit and barcode. Stocked items are counted; meals and drinks made to order are "Made to order".',
      done: F.products > 0 && F.unpriced === 0, note: F.unpriced ? `${F.unpriced} item(s) on the till still have no price` : '' },
    { key: 'promotions', mods: ['promotions'], group: 'Products & stock', title: 'Promotions and customer prices', link: '#/promotions', optional: true,
      why: 'Specials, happy hour, "3 for 2" and wholesale prices apply automatically at the till and on quotations.',
      how: 'Promotions → New promotion. For wholesale prices tag those customers "wholesale" in Contacts and make a rule for that tag.',
      done: F.promos > 0 },
    { key: 'suppliers', group: 'Products & stock', title: 'Suppliers', link: '#/partners?type=supplier',
      why: 'Purchase orders and supplier bills need a supplier; costs and what you owe come from them.',
      how: 'Contacts → Suppliers: add abattoirs, farmers, wholesalers and distributors with phone and VAT number.',
      done: F.suppliers > 0 },
    { key: 'stock', mods: ['inventory'], group: 'Products & stock', title: 'Opening stock', link: '#/inventory',
      why: 'Stock levels, cost of sales and profit are only right once the system knows what is on the shelves.',
      how: 'Either count everything once (Inventory → stock count / adjustment) or receive your first delivery (Purchasing → New order → Confirm → Receive).',
      done: F.stockIn > 0 },
    // ---------- restaurant
    { key: 'floors', group: 'Restaurant', title: 'Floors and tables', link: '#/settings?tab=restaurant', mods: ['restaurant'],
      why: 'Waiters open orders on a table plan; bills and turnover per table come from it.',
      how: 'Settings → Restaurant floors: add areas (Inside, Patio) and their tables with seat counts.',
      done: F.floors > 0 && F.tables > 0 },
    { key: 'kitchen', group: 'Restaurant', title: 'Kitchen tickets / kitchen screen', link: '#/settings?tab=pos', mods: ['restaurant'],
      why: 'Orders must reach the kitchen as soon as the waiter sends them.',
      how: 'Give food categories station "Kitchen". Then either tick "Print a kitchen/bar ticket" (Settings → POS) or add a user with role "kitchen" and open Kitchen Display on a tablet.',
      done: has(F.catStation, 'kitchen') && (!!F.pos.print_kitchen_tickets || has(F.roles, 'kitchen')) },
    { key: 'waiters', group: 'Restaurant', title: 'Waiter logins', link: '#/settings?tab=users', mods: ['restaurant'],
      why: 'Each waiter\'s tables, sales and tips are tracked separately.',
      how: 'Add each waiter with role "waiter" and a PIN.',
      done: has(F.roles, 'waiter') },
    // ---------- bar
    { key: 'barstation', group: 'Bar', title: 'Drinks categories print to the bar', link: '#/products', mods: ['bar'],
      why: 'Drink orders from tables go to the bar printer / screen.',
      how: 'Products → Categories: set station "Bar" on Beers, Spirits, Wines, Soft drinks.',
      done: has(F.catStation, 'bar') },
    { key: 'bottles', group: 'Bar', title: 'Bottles: size and weights', link: '#/products', mods: ['bar'],
      why: 'Lets you sell tots/glasses from bottle stock and count open bottles by weighing them.',
      how: 'Edit each spirit/wine: Bar section → bottle size (ml), empty bottle weight and full bottle weight (weigh one of each on the scale).',
      done: F.bottles > 0 && F.bottlesWeighed === F.bottles },
    { key: 'measures', group: 'Bar', title: 'Tots and glasses (measures)', link: '#/products', mods: ['bar'],
      why: 'Selling a 25 ml tot takes exactly 25 ml off the bottle – the basis for catching over-pouring.',
      how: 'New product per measure (e.g. "Gin tot 25ml"): type Made to order, price, "poured from" the bottle, measure size in ml.',
      done: F.measures > 0 },
    { key: 'bartenders', group: 'Bar', title: 'Bartender logins', link: '#/settings?tab=users', mods: ['bar'],
      why: 'Tabs and cash-ups per bartender.',
      how: 'Add each bartender with role "bartender" and a PIN.',
      done: has(F.roles, 'bartender') },
    { key: 'barcount', group: 'Bar', title: 'First bar stock count', link: '#/bar?tab=count', mods: ['bar'],
      why: 'Sets the starting point; every later count shows exactly how many ml went missing.',
      how: 'Bar → Stock count: enter full bottles and weigh each open bottle, then post.',
      done: F.barCounts > 0 },
    // ---------- butchery
    { key: 'butchery_on', group: 'Butchery', title: 'Turn on butchery mode', link: '#/butchery?tab=settings', mods: ['butchery'],
      why: 'Switches on weighed sales, scale labels, carcass breakdown & tracing, waste and use-by dates.',
      how: 'Butchery → Settings → tick "Butchery mode on" and save.',
      done: !!F.butch.enabled },
    { key: 'scale', group: 'Butchery', title: 'Connect the scale', link: '#/butchery?tab=settings', mods: ['butchery'], manual: true,
      why: 'The till reads the weight straight from the scale – no typing mistakes.',
      how: 'Plug the scale into the till PC (USB/RS-232). Butchery → Settings: tick "A scale is connected", set baud rate etc. as in the scale\'s menu, click "Choose scale port" then "Test scale". Skip if you only sell pre-packed labels.' },
    { key: 'starter', group: 'Butchery', title: 'Cutting templates per animal', link: '#/butchery?tab=templates', mods: ['butchery'],
      why: 'Templates create your carcass and cut products and set the yields every breakdown is compared with.',
      how: 'Butchery → Cutting templates → "Starter templates": tick beef, pork, lamb, goat, chicken… Then adjust the yields to your own results.',
      done: F.templates > 0 && F.carcassProducts > 0 },
    { key: 'cutprices', group: 'Butchery', title: 'Prices per kg and scale PLUs', link: '#/products', mods: ['butchery'],
      why: 'Cuts are sold per kg. The PLU links the scale\'s label to the right product; prices also decide how carcass cost is shared between cuts.',
      how: 'Products: set the price per kg (incl. VAT) on every cut and check its PLU matches the PLU programmed in your label scale.',
      done: F.weighed > 0 && F.weighedNoPrice === 0 && F.weighedNoPlu === 0,
      note: [F.weighedNoPrice ? `${F.weighedNoPrice} weighed item(s) without a price` : '', F.weighedNoPlu ? `${F.weighedNoPlu} without a PLU` : ''].filter(Boolean).join(', ') },
    { key: 'labels', group: 'Butchery', title: 'Scale barcode layout', link: '#/butchery?tab=settings', mods: ['butchery'], manual: true,
      why: 'So the till understands the barcodes your label scale prints (price or weight inside).',
      how: 'Print a test label on your scale. In Butchery → Settings set the prefix (e.g. 21), PLU digits (5), price/weight digits (5) and whether it carries price or weight. Scan the label at the till to check.' },
    { key: 'firstcarcass', group: 'Butchery', title: 'Receive carcasses with tags & weights', link: '#/purchases', mods: ['butchery'],
      why: 'Each carcass becomes its own batch, traced kg by kg until it is all sold.',
      how: 'Purchasing → New order for the carcass product → Confirm → Receive: type each carcass tag, its carcass weight and (optional) live weight.',
      done: F.carcassesIn > 0 },
    { key: 'firstcut', group: 'Butchery', title: 'First carcass breakdown', link: '#/butchery', mods: ['butchery'],
      why: 'Moves the carcass into cut stock, shares the cost, and records bone/fat loss and yield.',
      how: 'Butchery → Carcass breakdown → New: choose the template and the carcass tag, weigh each cut (⚖ reads the scale) and post.',
      done: F.breakdowns > 0 },
    { key: 'recipes', group: 'Butchery', title: 'Sausage / processing recipes', link: '#/butchery?tab=production', mods: ['butchery'], optional: true,
      why: 'Boerewors, sausages, patties and biltong use meat, fat, casings, water and spices – recipes record meat content and cost.',
      how: 'Butchery → Sausage & processing → New recipe: list the ingredients per batch.',
      done: F.recipes > 0 },
    { key: 'species', group: 'Butchery', title: 'Animal on every meat product', link: '#/products', mods: ['butchery'], optional: true,
      why: 'Reports by animal (beef, pork, lamb…) need it.',
      how: 'Products: set "Animal" on carcasses and cuts (starter templates do this for you).',
      done: F.weighed > 0 && F.noSpecies === 0, note: F.noSpecies ? `${F.noSpecies} meat product(s) without an animal` : '' },
    // ---------- branches & warehouses
    { key: 'branches', mods: ['locations'], group: 'Branches & warehouses', title: 'Branches, warehouses and vans', link: '#/locations',
      why: 'Stock is kept per place, so each shop knows what it has and the owner sees profit per branch.',
      how: 'Branches & warehouses → New location for every shop, store room, warehouse or delivery van. Mark the main one as default. "In transit" is created for you.',
      done: F.locations > 1 },
    { key: 'tillbranch', mods: ['locations', 'pos'], group: 'Branches & warehouses', title: 'Link each till to its branch', link: '#/settings?tab=terminals',
      why: 'Sales on a till take stock from that branch and show in that branch\'s profit.',
      how: 'Settings → Tills: choose the branch for every till. Also set a home branch for each staff user (Settings → Users).',
      done: F.locations > 1 && F.tillsNoLoc === 0 },
    { key: 'firsttransfer', mods: ['locations'], group: 'Branches & warehouses', title: 'First stock transfer', link: '#/transfers', optional: true,
      why: 'Moving stock from the warehouse to a shop (or onto a van) without changing its value.',
      how: 'Transfers → New transfer: pick from / to, add products, Send. The receiving branch opens it and clicks Receive, entering what actually arrived.',
      done: F.transfers > 0 },
    // ---------- wholesale
    { key: 'pricegroups', types: ['wholesale'], group: 'Wholesale', title: 'Wholesale / trade price lists', link: '#/promotions',
      why: 'Trade customers pay less than walk-in customers – applied automatically on quotes and at the till.',
      how: 'Tag trade customers (e.g. "wholesale", "spaza") in Contacts, then Promotions → New → Customers: by tag, percent off or a fixed price per product.',
      done: F.tagRules > 0 },
    { key: 'credit', types: ['wholesale', 'services', 'manufacturing'], group: 'Customers', title: 'Customer accounts and credit limits', link: '#/partners?type=customer',
      why: 'Lets regular customers buy on account up to a limit; statements and what they owe come from here.',
      how: 'Contacts → Customers: add the company, VAT number, payment terms and a credit limit.',
      done: F.creditCustomers > 0 },
    { key: 'firstquote', mods: ['sales'], group: 'Customers', title: 'First quotation', link: '#/quotes',
      why: 'Quote → confirm as order → invoice keeps prices, discounts and delivery dates together.',
      how: 'Quotations → New quotation: pick the customer, add lines, Save and Print or Email. When the customer agrees, Confirm and then Create invoice.',
      done: F.quotes > 0 },
    // ---------- services
    { key: 'services', types: ['services', 'education', 'transport', 'rental', 'health'], group: 'What you sell', title: 'Services and fees you charge', link: '#/products',
      why: 'Invoices and quotes are made from these – e.g. "Call-out fee", "Labour per hour", "Term fees Grade 1", "Trip Maseru–Mafeteng", "Tent hire per day".',
      how: 'Products → New product, type "Service" (no stock is counted), with the price and VAT. Group them in categories.',
      done: F.services > 0 },
    { key: 'expenses', mods: ['expenses'], group: 'Money', title: 'Staff expense claims', link: '#/claims', optional: true,
      why: 'Fuel, materials and travel paid by staff are approved and booked with the slip attached.',
      how: 'Staff open Expense claims → New claim and take a photo of the slip. A manager approves under Approvals; pay it back from Expense claims → Reimburse.',
      done: F.claims > 0 },
    { key: 'employees', mods: ['hrm'], group: 'People', title: 'Employees and payroll', link: '#/hrm',
      why: 'Payslips with Lesotho PAYE, leave and loans, and the payroll journal in the books.',
      how: 'HR & Payroll → New employee with ID number, start date and basic salary. Run the first payroll as a draft and check the payslips.',
      done: F.employees > 0 },
    // ---------- maintenance
    { key: 'machines', mods: ['maintenance'], group: 'Machines', title: 'Machine register', link: '#/maintenance?tab=machines',
      why: 'Every oven, mixer, press, generator or vehicle gets its breakdown history, downtime and repair cost.',
      how: 'Maintenance → Machines → New machine: name, where it stands, serial number and supplier. Staff can then report breakdowns from Maintenance → Report a problem.',
      done: F.machines > 0 },
    { key: 'pm', mods: ['maintenance'], group: 'Machines', title: 'Service intervals', link: '#/maintenance?tab=machines', optional: true,
      why: 'Servicing on time is cheaper than repairing a breakdown in the middle of production.',
      how: 'Edit each machine and enter "service every … days" (e.g. 90). Maintenance → "Plan due services" then creates the service jobs a week before they are due.',
      done: F.machinesScheduled > 0 },
    // ---------- buying
    { key: 'rfq', mods: ['purchasing'], types: ['wholesale', 'manufacturing', 'services', 'agriculture'], group: 'Buying', title: 'Compare supplier prices (RFQ)', link: '#/rfqs', optional: true,
      why: 'Asking two or three suppliers for the same items and buying from the cheapest saves money on big orders.',
      how: 'Purchasing → Requests for quotation → New: items and quantities, tick the suppliers, Send (by email or print). Type in their prices as they reply; "Order from best prices" makes the purchase orders.',
      done: F.rfqs > 0 },
    // ---------- projects
    { key: 'projects', mods: ['projects'], group: 'Projects', title: 'First project', link: '#/projects',
      why: 'Keeps tasks, hours, costs and invoices for each job together and shows if it makes money.',
      how: 'Projects → New project: customer, billing (by the hour, fixed price or not billed), hourly rate, budget hours. Add tasks and assign them to staff.',
      done: F.projects > 0 },
    { key: 'timesheets', mods: ['projects'], group: 'Projects', title: 'Staff log their hours', link: '#/timesheets',
      why: 'Hours are what you invoice (hourly jobs) and what the job costs you (all jobs).',
      how: 'Each person opens Timesheets (or the task) and logs hours per day. Link each employee to their login in HR so their cost per hour is known.',
      done: F.timesheets > 0 },
    { key: 'projinvoice', mods: ['projects'], group: 'Projects', title: 'Invoice a project', link: '#/projects', optional: true,
      why: 'Turns logged hours (or a % of a fixed price) into a customer invoice in one click.',
      how: 'Open the project → Invoice: hourly projects take all billable hours not yet invoiced; fixed-price projects ask for the amount or % of the contract.',
      done: F.projInvoiced > 0 },
    // ---------- helpdesk
    { key: 'hdsettings', mods: ['helpdesk'], group: 'Helpdesk', title: 'Response times and labour rate', link: '#/helpdesk?tab=settings',
      why: 'Every ticket gets a deadline from its priority, and repair labour is charged at your rate.',
      how: 'Helpdesk → Settings: hours to respond for urgent / high / normal / low tickets, and the hourly labour rate for repairs.',
      done: F.hdSet },
    { key: 'techs', mods: ['helpdesk'], group: 'Helpdesk', title: 'Technician logins', link: '#/settings?tab=users', optional: true,
      why: 'Technicians see the tickets and job cards assigned to them and log their time – without access to money or reports.',
      how: 'Settings → Users → New user with role "technician" (helpdesk + maintenance) or "staff" (helpdesk only).',
      done: F.techs > 0 },
    { key: 'firstticket', mods: ['helpdesk'], group: 'Helpdesk', title: 'First ticket or job card', link: '#/helpdesk',
      why: 'Proves the chain: customer problem → technician → parts & hours → invoice.',
      how: 'Helpdesk → New ticket. For repairs choose "Repair" and fill in the item and serial number, then add parts and hours and click Invoice.',
      done: F.tickets > 0 },
    // ---------- sector specific (until each sector module is released)
    { key: 'mfg', mods: ['manufacturing'], group: 'Production', title: 'Raw materials and finished goods', link: '#/products',
      why: 'You buy raw materials, make products and sell them; both need to exist as stocked products with a cost.',
      how: 'Create raw materials (flour, cement, timber, fabric…) with their purchase cost, and finished products with a selling price – both as Stocked. Raw materials that are never sold: untick "show on till".',
      done: F.products > 0 && F.stockIn > 0 },
    { key: 'boms', mods: ['manufacturing'], group: 'Production', title: 'Bills of materials (recipes)', link: '#/mrp?tab=boms',
      why: 'Says what goes into one batch of each product – the system then works out the cost per unit and what to buy.',
      how: 'Manufacturing → Bills of materials → New: choose the finished product, how much one batch makes, each component with its quantity and expected waste %, and labour and overhead per batch.',
      done: F.boms > 0 },
    { key: 'firstwo', mods: ['manufacturing'], group: 'Production', title: 'First work order', link: '#/mrp',
      why: 'Proves the chain: materials out of stock → finished goods in at the right cost → sold at a profit.',
      how: 'Manufacturing → New work order: pick the BOM and quantity, Start, then Finish with the quantity actually made, what was used, any rejects and the quality check.',
      done: F.workOrders > 0 },
    { key: 'lodge', types: ['hospitality'], group: 'Accommodation', title: 'Rooms as services', link: '#/products', manual: true,
      why: 'Until Rooms & bookings is released, room nights are sold like any other item and can be put on a guest\'s tab.',
      how: 'Create a service product per room type ("Double room per night") and a category "Rooms". Use a table per room on the restaurant till to run guest tabs.' },
    { key: 'school', types: ['education'], group: 'Learners', title: 'Learners as customers', link: '#/partners?type=customer', manual: true,
      why: 'Fee statements and what each family owes come from the customer ledger.',
      how: 'Add each learner (or parent) as a customer with tag = class (e.g. "grade1"). Invoice term fees from Invoicing; payments by M-Pesa or bank are matched in Bank recon.' },
    { key: 'pharmacy', types: ['health'], group: 'Medicines', title: 'Batch and expiry tracking', link: '#/products',
      why: 'Medicines must be sold first-expiry-first-out and expired stock removed.',
      how: 'Products → edit each medicine → tick "Track batches / expiry". Enter batch numbers and expiry dates when receiving purchases.',
      done: F.batchTracked > 0 },
    { key: 'fleet', types: ['transport'], group: 'Vehicles', title: 'Vehicle costs', link: '#/accounting', manual: true,
      why: 'Fuel, tyres, licences and repairs per vehicle show what each vehicle earns.',
      how: 'Until Fleet is released, record vehicle costs as expenses or claims with the registration number in the description, and trips as service invoices.' },
    { key: 'farm', types: ['agriculture'], group: 'Farm', title: 'Farm stores, inputs and produce', link: '#/products',
      why: 'Seed, feed, fertiliser and medicines in, eggs, milk, wool or crops out – each with a cost.',
      how: 'Create inputs and produce as stocked products. Add a location per store or farm if you have more than one (Branches & warehouses).',
      done: F.products > 0 && F.stockIn > 0 },
    { key: 'firstinvoice', types: ['services', 'education', 'transport', 'rental', 'manufacturing', 'agriculture'], group: 'Go live', title: 'First customer invoice', link: '#/invoices?kind=customer_invoice',
      why: 'Proves the chain: invoice → customer owes → payment → books.',
      how: 'Invoicing → New invoice (or Create invoice from a confirmed quote) → Post. Record the payment when it comes in.',
      done: F.invoicesPosted > 0 },
    // ---------- go live
    { key: 'email', group: 'Go live', title: 'End-of-day report by email', link: '#/settings?tab=email', optional: true,
      why: 'The owner gets sales, payments, cash-ups and waste every evening without logging in.',
      how: 'Settings → Email: enter your email provider\'s SMTP details, the recipients and the time; tick "send automatically", then "Send test".',
      done: !!(F.email.smtp_host && F.email.recipients && (F.email.recipients.length || 0) > 0 && F.email.eod_enabled) },
    { key: 'printer', mods: ['pos'], group: 'Go live', title: 'Test the receipt printer', link: '#/pos', manual: true,
      why: 'Check the logo, VAT number, footer and QR code print correctly before customers see them.',
      how: 'Set the receipt printer as the Windows default printer, open the till, make a small test sale and print the receipt (refund it afterwards).' },
    { key: 'firstsale', mods: ['pos'], group: 'Go live', title: 'First real sale and cash-up', link: '#/pos',
      why: 'Proves the whole chain: till → stock → books → end-of-day report.',
      how: 'Open a cashier session with the float, sell, then close the session and count the cash. The next day, do the Sales Recon.',
      done: F.sales > 0 && F.closedSessions > 0 },
    { key: 'bankrecon', mods: ['bank'], group: 'Go live', title: 'Reconcile the bank and M-Pesa statements', link: '#/bank', optional: true,
      why: 'Proves that every sale paid by card or mobile money really arrived, and books bank charges.',
      how: 'Monthly (or weekly): download the statement as CSV from internet banking or the M-Pesa merchant portal and import it under Bank & M-Pesa recon.',
      done: F.statements > 0 },
    { key: 'backup', group: 'Go live', title: 'Backups and updates', link: '#/settings?tab=updates', manual: true,
      why: 'Protects your data and keeps the system up to date.',
      how: 'Settings → Updates & backup: click "Back up now" once and copy the file to a flash drive or cloud folder weekly; enter the GitHub repository for online updates.' }
  ];
}

async function guide() {
  const s = { types: [], done: [], dismissed: false, ...((await db.getSetting('setup_guide', {})) || {}) };
  const types = s.types.length ? s.types : ['retail'];
  const F = await facts();
  const mods = (await M.get()).modules;
  const list = steps(F).filter(st => (!st.types || st.types.some(t => types.includes(t))) && (!st.mods || st.mods.every(m => mods.includes(m)))).map(st => {
    let done = st.manual ? s.done.includes(st.key) : st.check ? types.every(t => st.check(t)) : !!st.done;
    if (st.key === 'staff' && !mods.includes('pos')) done = F.staff > 0; // PINs only matter on a till
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
  // ticking a business type here only ever ADDS that type's modules; it never switches modules off
  // (that is done on purpose in Settings → Business & modules)
  if (Array.isArray(patch.types)) {
    const cur = await M.get();
    await M.save({ types: s.types, modules: [...new Set([...cur.modules, ...M.defaultsFor(s.types)])] });
  }
  return guide();
}

module.exports = { TYPES, guide, save };
