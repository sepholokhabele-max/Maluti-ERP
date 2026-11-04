// Kinds of business and the modules (apps) each one uses.
// The admin picks one or more business types; that switches on a sensible set of modules, which can then be fine-tuned.
const db = require('../db');

/** Modules that can be switched on/off. `coming` = planned, shown greyed out. Core apps (products, contacts, invoicing,
 *  accounting, reports, settings) are always on and are not listed here. */
const MODULES = [
  { key: 'pos', name: 'Point of sale (tills)', icon: '🛒', group: 'Selling', desc: 'Till screen, cashier sessions, cash-ups, receipts and the daily sales recon.' },
  { key: 'restaurant', name: 'Tables & kitchen', icon: '🍽️', group: 'Selling', desc: 'Floors and tables, open tabs, kitchen/bar tickets and the kitchen screen.' },
  { key: 'bar', name: 'Bar stock', icon: '🍸', group: 'Selling', desc: 'Tots and glasses from bottles, bottle weighing and bar stock counts.' },
  { key: 'butchery', name: 'Butchery', icon: '🥩', group: 'Selling', desc: 'Scales, carcass breakdown, cutting yields, sausage recipes and animal reports.' },
  { key: 'sales', name: 'Quotations & sales orders', icon: '📝', group: 'Selling', desc: 'Quotes that become orders and invoices – for wholesale, services and projects.' },
  { key: 'promotions', name: 'Promotions & price lists', icon: '🏷️', group: 'Selling', desc: 'Specials, happy hour, multibuy and customer-group (wholesale) prices.' },
  { key: 'crm', name: 'CRM', icon: '🤝', group: 'Selling', desc: 'Customer history, follow-ups, loyalty and customer accounts.' },
  { key: 'vas', name: 'Airtime & electricity (VAS)', icon: '⚡', group: 'Selling', desc: 'Sell airtime, data and prepaid electricity tokens at the till.' },
  { key: 'purchasing', name: 'Purchasing', icon: '🚚', group: 'Stock', desc: 'Purchase orders, approvals, receiving goods and supplier bills.' },
  { key: 'inventory', name: 'Inventory', icon: '🏷️', group: 'Stock', desc: 'Stock levels, counts, batches and expiry dates, stock valuation.' },
  { key: 'locations', name: 'Branches & warehouses', icon: '🏬', group: 'Stock', desc: 'Stock per shop, branch, warehouse or van; transfers between them; branch profit.' },
  { key: 'expenses', name: 'Expense claims', icon: '🧾', group: 'Money', desc: 'Staff claim expenses with a photo of the slip; managers approve and reimburse.' },
  { key: 'bank', name: 'Bank & M-Pesa recon', icon: '🏦', group: 'Money', desc: 'Import bank and mobile-money statements and match them to the books.' },
  { key: 'hrm', name: 'HR & payroll', icon: '🧑‍💼', group: 'People', desc: 'Employees, leave, payslips with Lesotho PAYE, loans and payroll journals.' },
  { key: 'attendance', name: 'Attendance', icon: '🕐', group: 'People', desc: 'Clock in/out with a PIN, hours worked and overtime to payroll.' },
  // planned – shown so the admin knows they are on the way
  { key: 'manufacturing', name: 'Manufacturing (BOM & work orders)', icon: '🏭', group: 'Operations', desc: 'Bills of materials with costing, work orders, quality check, batches and material shortages.' },
  { key: 'projects', name: 'Projects & timesheets', icon: '📋', group: 'Operations', coming: true, desc: 'Projects, tasks, hours worked and billing by the hour or by milestone.' },
  { key: 'helpdesk', name: 'Helpdesk & repairs', icon: '🛠️', group: 'Operations', coming: true, desc: 'Customer tickets, job cards and repairs with parts and labour.' },
  { key: 'rooms', name: 'Rooms & bookings', icon: '🛏️', group: 'Sector', coming: true, desc: 'Lodges and guest houses: rooms, bookings, check-in and room charges.' },
  { key: 'school', name: 'School fees', icon: '🎓', group: 'Sector', coming: true, desc: 'Learners, classes, fee plans, statements and payments.' },
  { key: 'patients', name: 'Patients & dispensing', icon: '🩺', group: 'Sector', coming: true, desc: 'Clinics and pharmacies: patients, visits and dispensing from batches.' },
  { key: 'fleet', name: 'Fleet & trips', icon: '🚛', group: 'Sector', coming: true, desc: 'Vehicles, trips, fuel, maintenance and costs per vehicle.' },
  { key: 'rental', name: 'Rentals', icon: '🔑', group: 'Sector', coming: true, desc: 'Equipment and property rentals, deposits and recurring invoices.' },
  { key: 'farm', name: 'Farm', icon: '🌾', group: 'Sector', coming: true, desc: 'Fields, livestock, inputs and harvests.' }
];

const TYPES = [
  { key: 'retail', name: 'Retail shop', icon: '🛍️', desc: 'Supermarket, café shop, spaza, hardware, clothing, pharmacy counter',
    modules: ['pos', 'inventory', 'purchasing', 'promotions', 'crm', 'vas'], till: 'retail' },
  { key: 'butchery', name: 'Butchery', icon: '🥩', desc: 'Butcher shop, meat processing, abattoir shop',
    modules: ['pos', 'butchery', 'inventory', 'purchasing', 'promotions', 'crm'], till: 'retail' },
  { key: 'restaurant', name: 'Restaurant / café', icon: '🍽️', desc: 'Restaurant, take-away, fast food, café',
    modules: ['pos', 'restaurant', 'inventory', 'purchasing', 'attendance'], till: 'restaurant' },
  { key: 'bar', name: 'Bar / tavern', icon: '🍺', desc: 'Bar, pub, shebeen, liquor store, club',
    modules: ['pos', 'bar', 'inventory', 'purchasing', 'promotions', 'vas'], till: 'bar' },
  { key: 'wholesale', name: 'Wholesale & distribution', icon: '📦', desc: 'Cash & carry, distributor, depot with branches or delivery vans',
    modules: ['pos', 'sales', 'promotions', 'crm', 'purchasing', 'inventory', 'locations', 'bank'], till: 'retail' },
  { key: 'manufacturing', name: 'Manufacturing & production', icon: '🏭', desc: 'Bakery, brick yard, furniture, textiles, food processing, printing',
    modules: ['sales', 'purchasing', 'inventory', 'locations', 'manufacturing', 'hrm', 'attendance'] },
  { key: 'services', name: 'Services & projects', icon: '🧰', desc: 'Consulting, construction, IT, cleaning, security, garage / repairs',
    modules: ['sales', 'crm', 'expenses', 'attendance', 'projects', 'helpdesk', 'bank'] },
  { key: 'hospitality', name: 'Lodge / guest house / hotel', icon: '🏨', desc: 'Accommodation with a restaurant or bar',
    modules: ['pos', 'restaurant', 'bar', 'inventory', 'purchasing', 'attendance', 'rooms'], till: 'restaurant' },
  { key: 'education', name: 'School / training centre', icon: '🎓', desc: 'Private school, crèche, college, driving school',
    modules: ['sales', 'crm', 'hrm', 'expenses', 'school', 'bank'] },
  { key: 'health', name: 'Clinic / pharmacy', icon: '🩺', desc: 'Pharmacy, surgery, dental, optometrist, vet',
    modules: ['pos', 'inventory', 'purchasing', 'crm', 'patients'], till: 'retail' },
  { key: 'transport', name: 'Transport & logistics', icon: '🚛', desc: 'Taxis, buses, trucking, courier, car hire',
    modules: ['sales', 'expenses', 'crm', 'attendance', 'fleet'] },
  { key: 'rental', name: 'Rental & property', icon: '🔑', desc: 'Equipment hire, tents & chairs, flats and shops to let',
    modules: ['sales', 'crm', 'bank', 'rental'] },
  { key: 'agriculture', name: 'Agriculture', icon: '🌾', desc: 'Crop farm, poultry, piggery, dairy, wool & mohair',
    modules: ['sales', 'purchasing', 'inventory', 'locations', 'farm', 'hrm'] }
];

const KEYS = new Set(MODULES.map(m => m.key));
const ALL_ACTIVE = MODULES.filter(m => !m.coming).map(m => m.key);

function defaultsFor(types) {
  const set = new Set();
  for (const t of types) { const T = TYPES.find(x => x.key === t); if (T) T.modules.forEach(m => set.add(m)); }
  return [...set];
}

/** { types, modules: [enabled keys], configured } — an existing install that never chose keeps every module on */
async function get() {
  const s = (await db.getSetting('business', null)) || null;
  let types = s && Array.isArray(s.types) ? s.types : null;
  if (!types) types = (((await db.getSetting('setup_guide', {})) || {}).types) || [];
  const configured = !!(s && Array.isArray(s.modules));
  const modules = configured ? s.modules.filter(k => KEYS.has(k)) : ALL_ACTIVE.slice();
  return { types, modules, configured };
}

async function catalog() {
  const cur = await get();
  return { ...cur, all_types: TYPES, all_modules: MODULES };
}

/**
 * patch: { types?, modules?, apply_defaults? }. Choosing types without modules switches on that type's modules
 * (added to what is already on). Also keeps the older per-module flags (HR, butchery) and the setup guide in step.
 */
async function save(patch) {
  const cur = await get();
  let types = Array.isArray(patch.types) ? patch.types.filter(t => TYPES.some(x => x.key === t)) : cur.types;
  let modules;
  if (Array.isArray(patch.modules)) modules = patch.modules.filter(k => KEYS.has(k));
  else if (Array.isArray(patch.types)) modules = [...new Set([...(cur.configured ? cur.modules : []), ...defaultsFor(types)])];
  else modules = cur.modules;
  await db.setSetting('business', { types, modules });
  // keep the setup guide's list of business types the same
  const g = (await db.getSetting('setup_guide', {})) || {};
  await db.setSetting('setup_guide', { types: [], done: [], dismissed: false, ...g, types });
  // older on/off switches
  const B = require('./butchery');
  const bs = await B.settings();
  if (!!bs.enabled !== modules.includes('butchery')) await db.setSetting('butchery', { ...bs, enabled: modules.includes('butchery') });
  if (modules.includes('hrm')) {
    const h = await require('./payroll').settings();
    if (!h.enabled) await db.setSetting('hrm', { ...h, enabled: true });
  }
  return catalog();
}

async function enabled(key) { return (await get()).modules.includes(key); }

module.exports = { MODULES, TYPES, get, catalog, save, enabled, defaultsFor };
