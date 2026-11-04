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
import { LANGS, lang, setLang } from './i18n.js';
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
  { href: '#/reminders', label: 'Payment reminders', ico: '📱', color: '#b91c1c', perm: 'reminders', mod: 'reminders' },
  { href: '#/pipeline', label: 'Sales pipeline', ico: '🎯', color: '#be185d', perm: 'crm', mod: 'crm' },
  { href: '#/contracts', label: 'Contracts & repeat invoices', ico: '🔁', color: '#0369a1', perm: 'invoicing', mod: 'contracts' },
  { href: '#/projects', label: 'Projects', ico: '📋', color: '#0f766e', perm: 'projects', mod: 'projects' },
  { href: '#/timesheets', label: 'My tasks & hours', ico: '🕒', color: '#4338ca', mod: 'projects' },
  { href: '#/helpdesk', label: 'Helpdesk & repairs', ico: '🛠️', color: '#c2410c', perm: 'helpdesk', mod: 'helpdesk' },
  { href: '#/rfqs', label: 'Supplier price requests', ico: '📨', color: '#6d28d9', perm: 'purchasing', mod: 'purchasing' },
  { href: '#/locations', label: 'Branches & warehouses', ico: '🏬', color: '#0369a1', perm: 'inventory', mod: 'locations' },
  { href: '#/transfers', label: 'Stock transfers', ico: '🔁', color: '#0891b2', perm: 'inventory', mod: 'locations' },
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
        <button class="btn btn-primary btn-block btn-lg" style="margin-top:16px">Sign in</button></form>`}
      ${users.length ? '<button class="btn btn-block" id="clockBtn" style="margin-top:16px">🕐 Clock in / out (start or end your shift)</button>' : ''}
    </div></div>`;
    const cb = $('#clockBtn'); if (cb) cb.onclick = () => { document.onkeydown = null; att.clockDialog(users); };
    $$('[data-m]').forEach(a => a.onclick = () => { mode = a.dataset.m; render(); });
    $$('[data-u]').forEach(a => a.onclick = () => { sel = Number(a.dataset.u); pin = ''; render(); });
    $$('[data-k]').forEach(b => b.onclick = () => keyPress(b.dataset.k));
    const lf = $('#lf');
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

async function dbScreen() {
  const info = window.maluti ? await window.maluti.info() : null;
  const emb = state.status && state.status.embedded_available;
  $('#app').innerHTML = `<div class="auth"><div class="auth-card">
    <div class="logo">M</div><h1>Choose your database</h1>
    ${emb ? `<div class="sub">Maluti ERP comes with its own MySQL 8 database – nothing else to install. It runs on this computer and is backed up daily.</div>
      <button class="btn btn-primary btn-block btn-lg" id="useEmb">Use the built-in database (recommended)</button>
      <details style="margin-top:16px"><summary class="muted" style="cursor:pointer">Or connect to an existing MySQL / MariaDB server…</summary><div style="margin-top:10px">` : `<div class="sub">Maluti ERP stores all data in a MySQL (or MariaDB) server. Enter its details — the database will be created if it doesn't exist.</div>`}
    <form id="dbf">${formHtml([
      { key: 'host', label: 'Server host', default: 'localhost', required: true }, { key: 'port', label: 'Port', type: 'number', default: 3306 },
      { key: 'user', label: 'MySQL user', default: 'root', required: true }, { key: 'password', label: 'Password', type: 'password' },
      { key: 'database', label: 'Database name', default: 'maluti_erp', required: true, span: 2 }
    ], {}, { ctx: 'db' })}
    <button class="btn ${emb ? '' : 'btn-primary'} btn-block btn-lg" style="margin-top:16px">Connect & continue</button></form>
    ${emb ? '</div></details>' : ''}
    ${info && info.desktop ? `<hr style="border:0;border-top:1px solid var(--line);margin:20px 0">
      <div class="muted" style="margin-bottom:8px">Adding another till? Point this PC at the main Maluti ERP computer instead:</div>
      <div class="row"><input id="remote" placeholder="http://192.168.1.10:8069"><button class="btn" id="useRemote">Use server</button></div>` : ''}
  </div></div>`;
  const ue = $('#useEmb');
  if (ue) ue.onclick = async () => {
    ue.disabled = true; ue.textContent = 'Starting the built-in database… (first time takes up to a minute)';
    try { await POST('/db-embedded', {}); toast('Built-in database ready'); route(); }
    catch (e2) { err(e2); ue.disabled = false; ue.textContent = 'Use the built-in database (recommended)'; }
  };
  const f = $('#dbf');
  f.onsubmit = async e => {
    e.preventDefault();
    const b = f.querySelector('button'); b.disabled = true; b.textContent = 'Connecting…';
    try { await POST('/db-config', readForm(f, [{ key: 'host' }, { key: 'port', type: 'number' }, { key: 'user' }, { key: 'password' }, { key: 'database' }])); toast('Connected to MySQL'); route(); }
    catch (e2) { err(e2); b.disabled = false; b.textContent = 'Connect & continue'; }
  };
  const ur = $('#useRemote');
  if (ur) ur.onclick = () => { const v = $('#remote').value.trim(); if (!/^https?:\/\//.test(v)) return err(new Error('Enter a URL like http://192.168.1.10:8069')); window.maluti.setRemote(v); };
}

async function setupScreen() {
  const types = await fetch('/api/business-types').then(r => r.json()).catch(() => [{ key: 'retail', name: 'Retail shop', icon: '🛍️', desc: '' }]);
  $('#app').innerHTML = `<div class="auth"><div class="auth-card wide">
    <div class="logo">M</div><h1>Set up your business</h1><div class="sub">This runs once. You can change everything later in Settings. The yellow notes under each box explain what to enter.</div>
    <form id="sf">
      <h4 style="margin:6px 0 6px">What kind of business is this?</h4>
      <div class="biz-types">${types.map(t => `<label class="biz-type"><input type="checkbox" name="bt_${t.key}" ${t.key === 'retail' ? 'checked' : ''}><span class="bi">${t.icon}</span><span><b>${esc(t.name)}</b><small>${esc(t.desc)}</small></span></label>`).join('')}</div>
      <small class="help-note" style="margin-bottom:14px">Tick everything you do – e.g. Butchery + Retail, Lodge + Bar, or Wholesale with branches. Only the apps these need are switched on (change them later under Settings → Business & modules). A step-by-step setup guide for exactly these will open after this page.</small>
      <h4 style="margin:6px 0 10px">Company</h4>
      ${formHtml([
        { key: 'name', label: 'Business name', required: true }, { key: 'phone', label: 'Phone' },
        { key: 'address', label: 'Address', span: 2 }, { key: 'email', label: 'Email' }, { key: 'tax_number', label: 'VAT / TIN number' },
        { key: 'currency_code', label: 'Currency code', default: 'LSL' }, { key: 'currency_symbol', label: 'Currency symbol', default: 'M' },
        { key: 'vat_rate', label: 'Standard VAT %', type: 'number', default: 15 }, { key: 'receipt_footer', label: 'Receipt footer', default: 'Thank you for your business!' }
      ], {}, { ctx: 'setup' })}
      <label class="field" style="margin-top:12px"><span>Company logo (optional — printed on receipts & invoices)</span>
        <div class="row"><input type="file" id="setupLogo" accept="image/*"><img id="setupLogoPrev" style="max-height:48px;display:none"></div>
        <small class="help-note">PNG or JPG, ideally on a white or transparent background. It is resized automatically and printed in black & white on receipt printers. You can add or change it later in Settings → Company.</small></label>
      <h4 style="margin:18px 0 10px">Administrator account</h4>
      ${formHtml([
        { key: 'a_name', label: 'Full name', required: true, default: 'Administrator' }, { key: 'a_username', label: 'Username', required: true, default: 'admin' },
        { key: 'a_password', label: 'Password (min 6)', type: 'password', required: true }, { key: 'a_pin', label: 'POS PIN (4–6 digits)', type: 'password' },
        { key: 'demo', label: 'Load demo products, customers & suppliers', type: 'checkbox', default: 1, span: 2 }
      ], {}, { ctx: 'setup' })}
      <button class="btn btn-primary btn-block btn-lg" style="margin-top:18px">Create my company</button>
    </form></div></div>`;
  const f = $('#sf');
  let logoData = null;
  $('#setupLogo').onchange = async e => {
    try { logoData = (await imageFileToDataUrl(e.target.files[0])).dataUrl; const p = $('#setupLogoPrev'); p.src = logoData; p.style.display = ''; }
    catch (x) { logoData = null; err(x); e.target.value = ''; }
  };
  f.onsubmit = async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    delete v.setupLogo;
    try {
      const r = await POST('/setup', {
        company: { name: v.name, phone: v.phone, address: v.address, email: v.email, tax_number: v.tax_number, currency_code: v.currency_code, currency_symbol: v.currency_symbol, vat_rate: Number(v.vat_rate), receipt_footer: v.receipt_footer },
        admin: { name: v.a_name, username: v.a_username, password: v.a_password, pin: v.a_pin || undefined }, demo: f.demo.checked,
        business_types: types.map(t => t.key).filter(k => f['bt_' + k] && f['bt_' + k].checked)
      });
      setToken(r.token);
      if (logoData) await PUT('/settings-logo', { data_url: logoData }).catch(err);
      state.company = await GET('/company'); await ensureLogo();
      toast('Welcome to Maluti ERP! Follow the setup guide step by step.'); setToken(r.token); state.user = r.user; location.hash = '#/guide';
    } catch (e2) { err(e2); }
  };
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
  '#/farm': farmui.farm,
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
  if (!state.status.connected) return dbScreen();
  if (!state.status.initialised) return setupScreen();
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
route();
