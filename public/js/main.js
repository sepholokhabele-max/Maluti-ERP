import { state, api, GET, POST, PUT, setToken, esc, $, $$, toast, err, can, hasMod, formHtml, readForm, ensureLogo, imageFileToDataUrl, closeModals } from './core.js';
import * as pos from './pos.js';
import * as kitchen from './kitchen.js';
import * as bo from './backoffice.js';
import * as biz from './business.js';
import * as settings from './settings.js';
import * as recon from './recon.js';
import * as crm from './crm.js';
import * as hr from './hrm.js';
import * as bu from './butchery.js';
import * as barm from './bar.js';
import * as guide from './guide.js';
import * as salesm from './sales.js';
import * as fin from './finance.js';
import * as att from './attendance.js';
import * as locm from './locations.js';
import * as mrpm from './mrp.js';
import * as ops from './ops.js';
import * as svc from './svc.js';
import * as grow from './growth.js';
import * as rent from './rent.js';
import * as schoolui from './schoolui.js';
import * as sitesui from './sitesui.js';
import * as remindui from './remindui.js';
import * as roomsui from './roomsui.js';
import * as fleetui from './fleetui.js';
import * as hireui from './hireui.js';
import * as clinicui from './clinicui.js';
import * as importer from './importer.js';
import * as farmui from './farmui.js';
import * as campaignui from './campaignui.js';
import * as recruitui from './recruitui.js';
import * as welcome from './welcome.js';
import * as actui from './activationui.js';
import * as smui from './smartelui.js';
import * as taxui from './taxui.js';
import { LANGS, lang, setLang } from './i18n.js';
import { startTranslator } from './i18n_dom.js';
import * as trui from './translateui.js';
import { workbook, tablesToSheets, download } from './xlsx.js';

const APPS = [
  { href: '#/pos', label: 'Point of Sale', ico: '🛒', color: '#ea580c', perm: 'pos', mod: 'pos' },
  { href: '#/kitchen', label: 'Kitchen / Bar Display', ico: '👨‍🍳', color: '#dc2626', perm: 'kitchen', mod: 'restaurant' },
  { href: '#/dashboard', label: 'Dashboard', ico: '📊', color: '#4f46e5', perm: 'dashboard' },
  { href: '#/products', label: 'Products', ico: '📦', color: '#0891b2', perm: 'catalog' },
  { href: '#/inventory', label: 'Inventory', ico: '🏷️', color: '#0d9488', perm: 'inventory', mod: 'inventory' },
  { href: '#/crm', label: 'CRM', ico: '🤝', color: '#2563eb', perm: 'crm', mod: 'crm' },
  { href: '#/partners?type=supplier', label: 'Contacts', ico: '👥', color: '#0369a1', perm: 'partners' },
  { href: '#/purchases', label: 'Purchasing', ico: '🚚', color: '#7c3aed', perm: 'purchasing', mod: 'purchasing' },
  { href: '#/invoices?kind=customer_invoice', label: 'Invoicing', ico: '🧾', color: '#c026d3', perm: 'invoicing' },
  { href: '#/accounting', label: 'Accounting', ico: '📒', color: '#16a34a', perm: 'accounting' },
  { href: '#/reports', label: 'Reports', ico: '📈', color: '#ca8a04', perm: 'reports' },
  { href: '#/sales', label: 'Sales & Sessions', ico: '💳', color: '#db2777', perm: 'reports', mod: 'pos' },
  { href: '#/recon', label: 'Sales Recon', ico: '⚖️', color: '#0f766e', perm: 'recon', mod: 'pos' },
  { href: '#/hrm', label: 'HR & Payroll', ico: '🧑‍💼', color: '#9333ea', perm: 'hrm', hrm: 1, mod: 'hrm' },
  { href: '#/butchery', label: 'Butchery', ico: '🥩', color: '#b91c1c', perm: 'inventory', butchery: 1, mod: 'butchery' },
  { href: '#/bar', label: 'Bar stock', ico: '🍸', color: '#a16207', perm: 'inventory', mod: 'bar' },
  { href: '#/vas', label: 'VAS (Airtime / Power)', ico: '⚡', color: '#f59e0b', perm: 'vas', mod: 'vas' },
  { href: '#/quotes', label: 'Quotations & orders', ico: '📝', color: '#2563eb', perm: 'sales', mod: 'sales' },
  { href: '#/promotions', label: 'Promotions', ico: '🏷️', color: '#d97706', perm: 'catalog', mod: 'promotions' },
  { href: '#/bank', label: 'Bank & M-Pesa recon', ico: '🏦', color: '#0e7490', perm: 'accounting', mod: 'bank' },
  { href: '#/claims', label: 'Expense claims', ico: '🧾', color: '#be123c', perm: 'dashboard', mod: 'expenses' },
  { href: '#/approvals', label: 'Approvals', ico: '✅', color: '#15803d', perm: 'dashboard', mod: ['purchasing', 'expenses'] },
  { href: '#/attendance', label: 'Attendance', ico: '🕐', color: '#7c3aed', perm: 'attendance', mod: 'attendance' },
  { href: '#/mrp', label: 'Manufacturing', ico: '🏭', color: '#b45309', perm: 'inventory', mod: 'manufacturing' },
  { href: '#/maintenance', label: 'Maintenance', ico: '⚙️', color: '#57534e', mod: 'maintenance' },
  { href: '#/property', label: 'Property & rent', ico: '🏢', color: '#0f766e', perm: 'property', mod: 'property' },
  { href: '#/school', label: 'School fees', ico: '🎓', color: '#1d4ed8', perm: 'school', mod: 'school' },
  { href: '#/sites', label: 'Sites & shifts', ico: '🛡️', color: '#334155', perm: 'sites', mod: 'sites' },
  { href: '#/rooms', label: 'Rooms & bookings', ico: '🛏️', color: '#9d174d', perm: 'rooms', mod: 'rooms' },
  { href: '#/farm', label: 'Farm', ico: '🌾', color: '#4d7c0f', perm: 'farm', mod: 'farm' },
  { href: '#/clinic', label: 'Patients & dispensing', ico: '🩺', color: '#0e7490', perm: 'patients', mod: 'patients' },
  { href: '#/hire', label: 'Equipment & party hire', ico: '⛺', color: '#a16207', perm: 'hire', mod: 'hire' },
  { href: '#/fleet', label: 'Fleet & trips', ico: '🚚', color: '#365314', perm: 'fleet', mod: 'fleet' },
  { href: '#/campaigns', label: 'SMS & email campaigns', ico: '📣', color: '#c026d3', perm: 'campaigns', mod: 'campaigns' },
  { href: '#/recruitment', label: 'Recruitment & appraisals', ico: '🧑‍🎓', color: '#7e22ce', perm: 'hrm', mod: 'recruitment' },
  { href: '#/reminders', label: 'Payment reminders', ico: '📱', color: '#b91c1c', perm: 'reminders', mod: 'reminders' },
  { href: '#/pipeline', label: 'Sales pipeline', ico: '🎯', color: '#be185d', perm: 'crm', mod: 'crm' },
  { href: '#/contracts', label: 'Contracts & repeat invoices', ico: '🔁', color: '#0369a1', perm: 'invoicing', mod: 'contracts' },
  { href: '#/projects', label: 'Projects', ico: '📋', color: '#0f766e', perm: 'projects', mod: 'projects' },
  { href: '#/timesheets', label: 'My tasks & hours', ico: '🕒', color: '#4338ca', mod: 'projects' },
  { href: '#/helpdesk', label: 'Helpdesk & repairs', ico: '🛠️', color: '#c2410c', perm: 'helpdesk', mod: 'helpdesk' },
  { href: '#/rfqs', label: 'Supplier price requests', ico: '📨', color: '#6d28d9', perm: 'purchasing', mod: 'purchasing' },
  { href: '#/locations', label: 'Branches & warehouses', ico: '🏬', color: '#0369a1', perm: 'inventory', mod: 'locations' },
  { href: '#/transfers', label: 'Stock transfers', ico: '🔁', color: '#0891b2', perm: 'inventory', mod: 'locations' },
  { href: '#/activation', label: 'Activation & KYC', ico: '🪪', color: '#0e7490', perm: 'settings' },
  { href: '#/tax', label: 'Tax centre (VAT, PAYE, income tax – RSL)', ico: '🧾', color: '#9a3412', perm: 'accounting' },
  { href: '#/smartel', label: 'Smartel connection (MyWallet services)', ico: '🔗', color: '#047857', perm: 'settings' },
  { href: '#/translations', label: 'Translations (Sesotho)', ico: '🗣️', color: '#15803d', perm: 'settings' },
  { href: '#/import', label: 'Import data', ico: '⬆️', color: '#0f766e', perm: 'settings' },
  { href: '#/guide', label: 'Setup guide', ico: '🧭', color: '#0d9488', perm: 'settings' },
  { href: '#/settings', label: 'Settings', ico: '⚙️', color: '#475569', perm: 'settings' }
];

const NAV = [
  ['#/dashboard', 'Dashboard', 'dashboard'], ['#/pos', 'POS', 'pos', 'pos'], ['#/products', 'Products', 'catalog'], ['#/inventory', 'Inventory', 'inventory', 'inventory'],
  ['#/locations', 'Branches', 'inventory', 'locations'], ['#/mrp', 'Manufacturing', 'inventory', 'manufacturing'], ['#/property', 'Property', 'property', 'property'], ['#/school', 'School', 'school', 'school'], ['#/sites', 'Sites', 'sites', 'sites'], ['#/rooms', 'Rooms', 'rooms', 'rooms'], ['#/fleet', 'Fleet', 'fleet', 'fleet'], ['#/hire', 'Hire', 'hire', 'hire'], ['#/clinic', 'Patients', 'patients', 'patients'], ['#/farm', 'Farm', 'farm', 'farm'], ['#/projects', 'Projects', 'projects', 'projects'], ['#/helpdesk', 'Helpdesk', 'helpdesk', 'helpdesk'], ['#/maintenance', 'Maintenance', 'maintenance', 'maintenance'],
  ['#/crm', 'CRM', 'crm', 'crm'], ['#/partners?type=customer', 'Contacts', 'partners'], ['#/purchases', 'Purchasing', 'purchasing', 'purchasing'], ['#/quotes', 'Sales', 'sales', 'sales'], ['#/invoices?kind=customer_invoice', 'Invoicing', 'invoicing'],
  ['#/accounting', 'Accounting', 'accounting'], ['#/recon', 'Recon', 'recon', 'pos'], ['#/hrm', 'HR', 'hrm', 'hrm'], ['#/butchery', 'Butchery', 'inventory', 'butchery'], ['#/bar', 'Bar', 'inventory', 'bar'], ['#/reports', 'Reports', 'reports'], ['#/settings', 'Settings', 'settings']
];

function shell(html) {
  const h = location.hash.split('?')[0];
  const initials = (state.user.name || '?').split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();
  $('#app').innerHTML = `
  <div class="topbar">
    <a class="brand" href="#/">${state.logo ? `<span class="brand-logo"><img src="${state.logo}" alt=""></span>` : '<span class="home-ico">▦</span>'} ${esc(state.company.name || 'Maluti ERP')}</a>
    <nav>${NAV.filter(n => can(n[2]) && (!n[3] || hasMod(n[3])) && (n[2] !== 'hrm' || (state.hrm && state.hrm.enabled)) && (n[0] !== '#/butchery' || (state.butchery && state.butchery.enabled))).map(n => `<a href="${n[0]}" class="${h === n[0].split('?')[0] ? 'active' : ''}">${n[1]}</a>`).join('')}</nav>
    <div class="user"><select id="lang" class="lang-sel" title="Language of the help notes / Puo ea litaelo">${LANGS.map(([k, l]) => `<option value="${k}" ${lang() === k ? 'selected' : ''}>${k === 'both' ? 'EN + ST' : k.toUpperCase()}</option>`).join('')}</select><span>${esc(state.user.name)}</span><div class="avatar" title="${esc(state.user.role)}">${initials}</div>
      <button class="icon-btn" style="color:#fff" id="logout" title="Log out">⏻</button></div>
  </div>
  ${actui.banner(state.activation, can('settings'))}
  <div id="view">${html || ''}</div>`;
  $('#logout').onclick = logout;
  $('#lang').onchange = e => { setLang(e.target.value); route(); };
  return $('#view');
}

async function logout() {
  try { await POST('/logout'); } catch (_) {}
  setToken(null); state.user = null; location.hash = '#/login';
}

function home(view) {
  const apps = APPS.filter(a => (!a.perm || can(a.perm)) && (!a.mod || hasMod(a.mod)) && (!a.hrm || (state.hrm && state.hrm.enabled) || can('settings')) && (!a.butchery || (state.butchery && state.butchery.enabled) || can('settings')));
  view.innerHTML = `<div class="home"><h1>Welcome, ${esc(state.user.name.split(' ')[0])}</h1>
    <div class="sub">${esc(state.company.name || '')} · ${new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
    <div id="guideBanner"></div>
    <div class="tiles">${apps.map(a => `<a class="tile" href="${a.href}"><div class="ico" style="background:${a.color}">${a.ico}</div><span>${a.label}</span></a>`).join('')}</div></div>`;
  if (can('settings')) GET('/setup-guide').then(g => {
    const el = $('#guideBanner'); if (!el || g.dismissed || g.complete) return;
    const next = g.steps.find(x => !x.done && !x.optional);
    el.innerHTML = `<a class="guide-banner" href="#/guide"><span class="gb-ico">🧭</span><span style="flex:1"><b>Finish setting up your business – ${g.done} of ${g.total} steps done</b><br>
      <small>Next: ${esc(next ? next.title : '')}</small></span><span class="gb-bar"><span style="width:${Math.round(g.done / g.total * 100)}%"></span></span><span class="btn btn-primary btn-sm">Continue →</span></a>`;
  }).catch(() => {});
  setTimeout(() => { if (location.hash === '' || location.hash === '#/') welcome.tour(); }, 900);
}

// ---------------- auth screens ----------------
async function loginScreen() {
  const users = await GET('/pin-users').catch(() => []);
  let mode = users.length ? 'pin' : 'pwd', sel = null, pin = '';
  const render = () => {
    $('#app').innerHTML = `<div class="auth"><div class="auth-card">
      ${state.logo ? `<img class="auth-logo" src="${state.logo}" alt="">` : '<div class="logo">M</div>'}<h1>${esc(state.company.name || 'Maluti ERP')}</h1><div class="sub">Sign in to continue</div>
      <div class="tabs"><a data-m="pin" class="${mode === 'pin' ? 'active' : ''}">Staff PIN</a><a data-m="pwd" class="${mode === 'pwd' ? 'active' : ''}">Username & password</a></div>
      ${mode === 'pin' ? `
        ${users.length ? `<div class="pin-users">${users.map(u => `<div class="pin-user ${sel === u.id ? 'sel' : ''}" data-u="${u.id}"><b>${esc(u.name)}</b><small>${esc(u.role)}</small></div>`).join('')}</div>` : '<p class="muted">No staff have a PIN yet. Use username & password.</p>'}
        ${sel ? `<input id="pin" type="password" readonly value="${'•'.repeat(pin.length)}" style="text-align:center;font-size:22px;letter-spacing:6px;margin-bottom:10px">
        <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 'C', 0, '→'].map(k => `<button data-k="${k}">${k}</button>`).join('')}</div>` : ''}
      ` : `
        <form id="lf"><label class="field"><span>Username</span><input name="username" autocomplete="username" required></label>
        <label class="field" style="margin-top:10px"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>
        <div class="wz-err" id="caps" style="display:none;margin-top:6px">⇪ Caps Lock is on</div>
        <button class="btn btn-primary btn-block btn-lg" style="margin-top:16px">Sign in</button>
        <details style="margin-top:12px"><summary class="muted" style="cursor:pointer">Forgot your password? / U lebetse phasewete?</summary><p class="muted" style="font-size:13px">Staff: ask the owner or manager to set a new one under Settings → Users. Owner: another administrator can reset it; if you are the only administrator, contact your Maluti ERP / My Wallet support.</p></details></form>`}
      ${users.length ? '<button class="btn btn-block" id="clockBtn" style="margin-top:16px">🕐 Clock in / out (start or end your shift)</button>' : ''}
    </div></div>`;
    const cb = $('#clockBtn'); if (cb) cb.onclick = () => { document.onkeydown = null; att.clockDialog(users); };
    $$('[data-m]').forEach(a => a.onclick = () => { mode = a.dataset.m; render(); });
    $$('[data-u]').forEach(a => a.onclick = () => { sel = Number(a.dataset.u); pin = ''; render(); });
    $$('[data-k]').forEach(b => b.onclick = () => keyPress(b.dataset.k));
    const lf = $('#lf');
    if (lf) lf.password.addEventListener('keyup', e => { const c = e.getModifierState && e.getModifierState('CapsLock'); $('#caps').style.display = c ? 'block' : 'none'; });
    if (lf) lf.onsubmit = async e => {
      e.preventDefault();
      try { const r = await POST('/login', { username: lf.username.value, password: lf.password.value }); afterLogin(r); } catch (e2) { err(e2); }
    };
  };
  const keyPress = async k => {
    if (k === 'C') pin = ''; else if (k === '→') { try { afterLogin(await POST('/pin-login', { user_id: sel, pin })); } catch (e) { err(e); pin = ''; } }
    else if (pin.length < 6) pin += k;
    const el = $('#pin'); if (el) el.value = '•'.repeat(pin.length);
  };
  document.onkeydown = e => { if (mode === 'pin' && sel && /^[0-9]$/.test(e.key)) keyPress(e.key); else if (mode === 'pin' && sel && e.key === 'Enter') keyPress('→'); else if (mode === 'pin' && sel && e.key === 'Backspace') { pin = pin.slice(0, -1); const el = $('#pin'); if (el) el.value = '•'.repeat(pin.length); } };
  render();
}

function afterLogin(r) {
  document.onkeydown = null;
  setToken(r.token); state.user = r.user;
  const role = r.user.role;
  const target = role === 'kitchen' ? '#/kitchen' : ['cashier', 'waiter', 'bartender'].includes(role) ? '#/pos' : '#/';
  if (location.hash === target) route(); else location.hash = target; // hashchange triggers route()
}



// ---------------- router ----------------
const ROUTES = {
  '#/': v => home(v),
  '#/dashboard': bo.dashboard,
  '#/products': bo.products,
  '#/inventory': bo.inventory,
  '#/partners': bo.partners,
  '#/purchases': biz.purchases,
  '#/purchase': biz.purchaseForm,
  '#/invoices': biz.invoices,
  '#/invoice': biz.invoiceForm,
  '#/accounting': biz.accounting,
  '#/reports': biz.reports,
  '#/sales': bo.sales,
  '#/vas': bo.vas,
  '#/settings': settings.settings,
  '#/recon': (v, a) => a[0] ? recon.reconDetail(v, a) : recon.reconList(v),
  '#/crm': crm.crm,
  '#/customer': crm.customer360,
  '#/hrm': hr.hrm,
  '#/employee': hr.employee,
  '#/payrun': hr.payrun,
  '#/butchery': bu.butchery,
  '#/guide': guide.guidePage,
  '#/quotes': salesm.quotes,
  '#/quote': salesm.quoteForm,
  '#/promotions': salesm.promotions,
  '#/bank': fin.bank,
  '#/claims': fin.claims,
  '#/approvals': fin.approvals,
  '#/attendance': att.attendance,
  '#/locations': locm.locations,
  '#/transfers': locm.transfers,
  '#/transfer': locm.transferForm,
  '#/mrp': mrpm.mrp,
  '#/bom': mrpm.bomForm,
  '#/wo': mrpm.woForm,
  '#/maintenance': ops.maintenance,
  '#/mr': ops.mrForm,
  '#/rfqs': ops.rfqs,
  '#/rfq': ops.rfqForm,
  '#/projects': svc.projects,
  '#/project': svc.projectForm,
  '#/timesheets': svc.timesheets,
  '#/helpdesk': svc.helpdesk,
  '#/ticket': svc.ticketForm,
  '#/property': rent.property,
  '#/building': rent.building,
  '#/lease': rent.leaseForm,
  '#/school': schoolui.school,
  '#/learner': schoolui.learner,
  '#/sites': sitesui.sites,
  '#/site': sitesui.siteForm,
  '#/reminders': remindui.reminders,
  '#/rooms': roomsui.rooms,
  '#/booking': roomsui.booking,
  '#/fleet': fleetui.fleet,
  '#/vehicle': fleetui.vehicle,
  '#/hire': hireui.hire,
  '#/import': importer.importer,
  '#/activation': actui.activationPage,
  '#/smartel': smui.smartelPage,
  '#/tax': taxui.taxPage,
  '#/translations': trui.translationsPage,
  '#/taxreturn': taxui.taxReturn,
  '#/farm': farmui.farm,
  '#/campaigns': campaignui.campaigns,
  '#/campaign': campaignui.campaign,
  '#/recruitment': recruitui.recruitment,
  '#/opening': recruitui.opening,
  '#/applicant': recruitui.applicant,
  '#/appraisal': recruitui.appraisal,
  '#/farmgroup': farmui.farmGroup,
  '#/animal': farmui.animal,
  '#/season': farmui.season,
  '#/clinic': clinicui.clinic,
  '#/patient': clinicui.patient,
  '#/visit': clinicui.visit,
  '#/hireorder': hireui.hireOrder,
  '#/pipeline': grow.pipeline,
  '#/lead': grow.leadForm,
  '#/contracts': grow.contracts,
  '#/contract': grow.contractForm,
  '#/bar': barm.bar
};

let routeSeq = 0;
export async function route() {
  const seq = ++routeSeq;
  document.onkeydown = null;
  try {
    state.status = await fetch('/api/status').then(r => r.json());
  } catch (e) { $('#app').innerHTML = `<div class="auth"><div class="auth-card"><h1>Server not reachable</h1><p class="muted">${esc(e.message)}</p><button class="btn btn-primary" onclick="location.reload()">Retry</button></div></div>`; return; }
  if (!state.status.connected || !state.status.initialised) return welcome.firstRun();
  state.company = await GET('/company').catch(() => ({}));
  await ensureLogo();
  document.title = (state.company.name || 'Maluti') + ' · ERP';
  if (!state.token) return loginScreen();
  if (!state.user) {
    try { state.user = await GET('/me'); } catch (_) { setToken(null); return loginScreen(); }
  }
  state.hrm = can('hrm') ? await GET('/hrm/status').catch(() => null) : null;
  state.butchery = await GET('/butchery/status').catch(() => null);
  state.biz = await GET('/business').catch(() => null);
  state.locations = null;
  state.activation = await GET('/activation').catch(() => null);
  if (seq !== routeSeq) return; // a newer navigation started while we were loading
  const [path] = location.hash.split('?');
  if (path === '#/login') { location.hash = '#/'; return; }
  if (path === '#/pos' || path.startsWith('#/pos/')) return pos.start(path.split('/')[2]);
  if (path === '#/kitchen') return kitchen.start();
  if (state.user.role === 'kitchen') { location.hash = '#/kitchen'; return; }
  const fn = ROUTES[path] || ROUTES['#/' + path.split('/')[1]] || ROUTES['#/'];
  const view = shell('<div class="page"><div class="muted">Loading…</div></div>');
  try { await fn(view, path.split('/').slice(2)); } catch (e) { view.innerHTML = `<div class="page"><div class="empty">${esc(e.message)}</div></div>`; }
}

// "⬇ Excel" on every screen that shows a table: each visible table becomes a sheet
function ensureExcel() {
  const pg = document.querySelector('#app .page'); if (!pg) return;
  const acts = pg.querySelector('.page-actions'); if (!acts || acts.querySelector('[data-xlsx]')) return;
  if (![...pg.querySelectorAll('table')].some(t => t.rows.length > 1)) return;
  const b = document.createElement('button'); b.className = 'btn'; b.dataset.xlsx = '1'; b.title = 'Download the tables on this screen as an Excel file'; b.textContent = '⬇ Excel';
  b.onclick = () => {
    const title = (pg.querySelector('.page-title h2') || {}).textContent || 'Maluti ERP';
    const sheets = tablesToSheets(pg, title.slice(0, 28));
    if (!sheets.length) return toast('Nothing to export on this screen', 'err');
    const tab = (pg.querySelector('.tabs a.active') || {}).textContent;
    download(workbook(sheets), `${(title + (tab ? ' - ' + tab : '')).replace(/[\\/:*?"<>|]+/g, '-').trim()} ${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  acts.prepend(b);
}
// "⬆ Import" on each module's main screen, opening the importer for what that screen holds
function ensureImport() {
  const pg = document.querySelector('#app .page'); if (!pg) return;
  const acts = pg.querySelector('.page-actions'); if (!acts || acts.querySelector('[data-imp]')) return;
  const k = importer.ROUTE_KINDS[location.hash.split('?')[0]]; if (!k) return;
  const kind = importer.KINDS.find(x => x.key === k); if (!kind || !can(kind.perm) || (kind.mod && !hasMod(kind.mod))) return;
  const a = document.createElement('a'); a.className = 'btn'; a.dataset.imp = '1'; a.href = '#/import?kind=' + k; a.textContent = '⬆ Import'; a.title = 'Bring in data from another program or Excel';
  acts.prepend(a);
}
let xlTimer; new MutationObserver(() => { clearTimeout(xlTimer); xlTimer = setTimeout(() => { ensureExcel(); ensureImport(); }, 150); }).observe(document.getElementById('app'), { childList: true, subtree: true });

window.addEventListener('hashchange', () => { closeModals(); route(); guide.guideReturnPill(); });
if (window.maluti && window.maluti.onUpdateAvailable) window.maluti.onUpdateAvailable(s => {
  if (state.user && can('settings')) toast(`Maluti ERP ${s.version} is available – Settings → Updates & backup`, 'ok', 10000);
});
// any action that fails without its own error handling still tells the user in plain words (never a silent button)
window.addEventListener('unhandledrejection', e => { const m = e.reason && (e.reason.message || String(e.reason)); if (m && !/AbortError|ResizeObserver/.test(m)) { err({ message: m }); e.preventDefault(); } });
startTranslator();
route();
