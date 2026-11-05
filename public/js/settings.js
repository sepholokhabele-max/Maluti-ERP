import { ensureLogo, imageFileToDataUrl, receiptLogoHtml, DEL, confirmBox } from './core.js';
import { state, GET, POST, PUT, esc, $, $$, toast, err, can, money, modal, formHtml, readForm, tableHtml, badge, page, dt, query } from './core.js';
import { crudSection } from './backoffice.js';
import { PLUGIN_HELP } from './help.js';
import { businessTab } from './locations.js';
import { hasMod, locationOptions } from './core.js';

export async function settings(view) {
  const tab = query().tab || 'company';
  const tabs = [['company', 'Company'], ['business', 'Business & modules'], ['pos', 'POS'], ['payments', 'Payment methods'], ['taxes', 'Taxes'], ['terminals', 'Tills'], ['restaurant', 'Restaurant floors'],
    ['users', 'Users'], ['email', 'Email & EOD reports'], ['plugins', 'Plugins (VAS / payments)'], ['portal', 'Customer portal'], ['hrm', 'HR & Payroll'], ['updates', 'Updates & backup'], ['logs', 'Logs']];
  view.innerHTML = page('Settings', '', `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/settings?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="sb"></div>`);
  const sb = $('#sb');
  if (tab === 'hrm') { location.hash = '#/hrm?tab=settings'; return; }
  if (tab === 'business') return businessTab(sb);
  if (tab === 'portal') return (await import('./portalui.js')).portalSettingsTab(sb);
  const s = await GET('/settings');

  if (tab === 'company') {
    const f = [{ key: 'name', label: 'Business name', required: true }, { key: 'phone', label: 'Phone' }, { key: 'address', label: 'Address', span: 2 }, { key: 'email', label: 'Email' },
      { key: 'tax_number', label: 'VAT / TIN number' }, { key: 'currency_code', label: 'Currency code' }, { key: 'currency_symbol', label: 'Currency symbol' },
      { key: 'default_vat', label: 'Default VAT % (new lines)', type: 'number' }, { key: 'receipt_footer', label: 'Receipt footer', span: 2 },
      { key: 'show_logo_receipt', label: 'Print logo on receipts & Z-reports', type: 'checkbox', default: 1 },
      { key: 'logo_bw', label: 'Print logo in black & white (thermal printers)', type: 'checkbox', default: 1 },
      { key: 'logo_width_mm', label: 'Logo width on receipt (mm, 15–72)', type: 'number', default: 40 }];
    await ensureLogo();
    sb.innerHTML = `<div class="cols logo-layout"><div class="card">${formHtml(f, s.company, { ctx: 'company' })}<div class="row" style="margin-top:14px"><span class="spacer"></span><button class="btn btn-primary" id="save">Save</button></div></div>
      <div><div class="card"><h3>Company logo</h3>
        <div class="logo-drop" id="drop">${state.logo ? `<img src="${state.logo}" alt="Company logo">` : '<div class="muted">No logo yet.<br>Drop an image here or choose a file.</div>'}</div>
        <div class="row wrap" style="margin-top:10px"><label class="btn btn-primary" style="cursor:pointer">⬆ ${state.logo ? 'Replace' : 'Upload'} logo<input type="file" id="logoFile" accept="image/*" hidden></label>
          ${state.logo ? '<button class="btn btn-danger" id="logoDel">Remove</button>' : ''}</div>
        <p class="muted" style="font-size:12px;margin-bottom:0">PNG with a transparent or white background works best. Images are resized automatically (max 600×300 px). Used on receipts, Z-reports, invoices, purchase orders, the login screen and the end-of-day email.</p></div>
      <div class="card"><h3>Receipt preview</h3><div class="receipt" id="rprev"></div></div></div></div>`;
    const preview = () => {
      let v = {}; try { v = readForm(sb, f); } catch (_) {}
      const c = { ...s.company, ...v };
      $('#rprev').innerHTML = `${receiptLogoHtml(c)}<div style="text-align:center;font-weight:bold;font-size:15px">${esc(c.name || '')}</div>
        <div style="text-align:center">${esc(c.address || '')}${c.phone ? '<br>Tel ' + esc(c.phone) : ''}${c.tax_number ? '<br>VAT No: ' + esc(c.tax_number) : ''}</div>
        <hr style="border:0;border-top:1px dashed #000">POS/2026/000123<br>1 x Sample item <span style="float:right">${money(25)}</span><hr style="border:0;border-top:1px dashed #000">
        <div style="text-align:center">${esc(c.receipt_footer || '')}</div>`;
    };
    $$('input', sb.querySelector('.form-grid')).forEach(i => i.addEventListener('input', preview));
    $$('input[type=checkbox]', sb).forEach(i => i.addEventListener('change', preview));
    preview();
    const refreshBrand = () => {
      const br = document.querySelector('.topbar .brand');
      if (br) br.innerHTML = `${state.logo ? `<span class="brand-logo"><img src="${state.logo}" alt=""></span>` : '<span class="home-ico">▦</span>'} ${esc(state.company.name || 'Maluti ERP')}`;
    };
    const upload = async file => {
      try {
        const { dataUrl, width, height } = await imageFileToDataUrl(file);
        const r = await PUT('/settings-logo', { data_url: dataUrl });
        state.company = { ...state.company, logo_version: r.version }; s.company.logo_version = r.version;
        state.logo = null; await ensureLogo();
        refreshBrand(); toast(`Logo saved (${width}×${height})`); settings(view);
      } catch (e) { err(e); }
    };
    $('#logoFile').onchange = e => e.target.files[0] && upload(e.target.files[0]);
    const drop = $('#drop');
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); const file = e.dataTransfer.files[0]; if (file) upload(file); };
    const ld = $('#logoDel');
    if (ld) ld.onclick = async () => { if (!(await confirmBox('Remove the company logo?', { danger: true, okLabel: 'Remove' }))) return; await DEL('/settings-logo'); state.company.logo_version = null; await ensureLogo(); refreshBrand(); toast('Logo removed'); settings(view); };
    $('#save').onclick = async () => { try { const v = readForm(sb, f); v.logo_width_mm = Math.min(72, Math.max(15, Number(v.logo_width_mm) || 40)); await PUT('/settings/company', { ...s.company, ...v }); state.company = { ...state.company, ...v }; toast('Saved'); } catch (e) { err(e); } };
  }
  if (tab === 'pos') {
    const f = [{ key: 'print_kitchen_tickets', label: 'Print a kitchen/bar ticket when an order is sent', type: 'checkbox', span: 2 },
      { key: 'require_pin_between_sales', label: 'Lock the till after every sale (shared tills)', type: 'checkbox', span: 2 }];
    sb.innerHTML = `<div class="card" style="max-width:820px">${formHtml(f, s.pos, { ctx: 'pos' })}<p class="muted">Kitchen display screens: open <b>Kitchen / Bar Display</b> on a tablet or second screen and log in as a user with the <i>kitchen</i> role.</p><div class="row"><span class="spacer"></span><button class="btn btn-primary" id="save">Save</button></div></div>`;
    $('#save').onclick = async () => { await PUT('/settings/pos', readForm(sb, f)); toast('Saved'); };
    const q = await GET('/settings-qr');
    const qf = [{ key: 'receipt_qr', label: 'Print a QR code on receipts (digital receipt + Add to Samsung / Google Wallet)', type: 'checkbox', span: 2 },
      { key: 'receipt_qr_text', label: 'Text under the receipt QR', span: 2 },
      { key: 'base_url', label: 'Public address of this server (blank = automatic)', placeholder: q.lan_urls[0] || 'https://receipts.yourshop.co.ls', span: 2,
        help: 'Phones on your Wi-Fi can use the automatic local address. For customers to open receipts anywhere (and for Samsung/Google Wallet), publish the server on the internet, e.g. with a Cloudflare Tunnel, and enter that https address.' },
      { key: 'pay_qr', label: 'Show pay-by-QR codes on bills and invoices', type: 'checkbox', span: 2 }];
    sb.insertAdjacentHTML('beforeend', `<div class="card" style="max-width:820px;margin-top:14px" id="qrc"><h3>QR codes</h3>${formHtml(qf, q.settings, { ctx: 'qr' })}
      <p class="muted" style="font-size:12px">Receipt QR links currently point to <b class="mono">${esc(q.effective_base_url)}</b>${q.lan_urls.length ? ` · local addresses: ${q.lan_urls.map(esc).join(', ')}` : ''}.
      Pay-by-QR codes come from each payment method (Settings → Payment methods → QR payload). Wallet buttons come from the Google Wallet / Samsung Wallet plugins (Settings → Plugins).</p>
      <div class="row"><span class="spacer"></span><button class="btn btn-primary" id="qsave">Save QR settings</button></div></div>`);
    $('#qsave').onclick = async () => { try { await PUT('/settings-qr', readForm($('#qrc'), qf)); toast('QR settings saved'); settings(view); } catch (e) { err(e); } };
  }
  if (tab === 'payments') {
    const plugins = (await GET('/vas/plugins')).plugins.filter(p => p.type === 'payment');
    sb.innerHTML = '<div class="card"><div id="c"></div><p class="muted" style="margin-top:10px">Each method posts to its ledger account (1000 cash, 1010 card clearing, 1020 mobile money, 1050 bank, 1100 customer account). Attach a payment plugin to a mobile money method to send push requests to the customer\'s phone.</p></div>';
    crudSection($('#c'), { help: 'paymethod', endpoint: '/payment-methods', title: 'Payment method', newLabel: 'New payment method', listQuery: 'active=all',
      columns: [{ key: 'name', label: 'Name' }, { key: 'kind', label: 'Kind' }, { key: 'account_code', label: 'Account' }, { key: 'requires_reference', label: 'Needs ref', fmt: v => v ? 'Yes' : '' }, { key: 'plugin_id', label: 'Plugin' }, { key: 'active', label: 'Active', html: 1, fmt: v => v ? badge('active', 'ok') : badge('off', 'closed') }],
      fields: [{ key: 'name', label: 'Name', required: true }, { key: 'kind', label: 'Kind', type: 'select', options: ['cash', 'card', 'mobile_money', 'account', 'other'].map(v => ({ value: v, label: v.replace('_', ' ') })) },
        { key: 'account_code', label: 'Ledger account', type: 'select', options: [['1000', 'Cash on hand'], ['1010', 'Card clearing'], ['1020', 'Mobile money wallet'], ['1050', 'Bank'], ['1100', 'Accounts receivable']].map(([v, l]) => ({ value: v, label: `${v} ${l}` })) },
        { key: 'plugin_id', label: 'Payment plugin (optional)', type: 'select', options: [{ value: '', label: '—' }, ...plugins.map(p => ({ value: p.id, label: p.name }))] },
        { key: 'qr_label', label: 'Pay-by-QR caption (e.g. "Scan to pay with M-Pesa – till 123456")', span: 2 },
        { key: 'qr_payload', label: 'Pay-by-QR payload', type: 'textarea', rows: 2, span: 2, help: 'The text your provider puts in its merchant QR (scan your M-Pesa / EcoCash merchant QR sticker with any QR app and paste the text), or a payment link. {amount} and {reference} are filled in per bill.' },
        { key: 'sort_order', label: 'Sort order', type: 'number' }, { key: 'requires_reference', label: 'Require transaction reference', type: 'checkbox' }, { key: 'active', label: 'Active', type: 'checkbox', default: 1 }],
      transform: v => ({ ...v, plugin_id: v.plugin_id || null, qr_payload: v.qr_payload || null, qr_label: v.qr_label || null }), canDelete: true });
  }
  if (tab === 'taxes') {
    sb.innerHTML = '<div class="card"><div id="c"></div></div>';
    crudSection($('#c'), { help: 'tax', endpoint: '/taxes', title: 'Tax', newLabel: 'New tax', columns: [{ key: 'name', label: 'Name' }, { key: 'rate', label: 'Rate %', right: 1 }, { key: 'price_includes_tax', label: 'Prices include tax', fmt: v => v ? 'Yes' : 'No' }],
      fields: [{ key: 'name', label: 'Name', required: true }, { key: 'rate', label: 'Rate %', type: 'number' }, { key: 'price_includes_tax', label: 'POS prices include this tax', type: 'checkbox', default: 1 }] });
  }
  if (tab === 'terminals') {
    sb.innerHTML = '<div class="card"><div id="c"></div><p class="muted" style="margin-top:10px">Retail = barcode scanning & quick checkout. Restaurant = floor plan, tables, kitchen tickets. Bar = named tabs with bar tickets. Any till can also sell airtime/electricity when a VAS plugin is enabled.</p></div>';
    const lo = hasMod('locations') ? await locationOptions('Default location') : null;
    crudSection($('#c'), { help: 'till', endpoint: '/terminals', title: 'Till', newLabel: 'New till', columns: [{ key: 'name', label: 'Name' }, { key: 'mode', label: 'Business type' },
        ...(lo ? [{ key: 'location_id', label: 'Branch', fmt: v => (lo.find(o => o.value === v) || lo[0]).label }] : [])],
      fields: [{ key: 'name', label: 'Name', required: true }, { key: 'mode', label: 'Business type', type: 'select', options: [{ value: 'retail', label: 'Retail store' }, { value: 'restaurant', label: 'Restaurant' }, { value: 'bar', label: 'Bar' }] },
        ...(lo ? [{ key: 'location_id', label: 'Branch', type: 'select', numeric: true, options: lo }] : [])] });
  }
  if (tab === 'restaurant') {
    const floors = await GET('/floors');
    sb.innerHTML = `<div class="cols cols-2"><div class="card"><div id="fl"></div></div><div class="card"><div id="tb"></div></div></div>`;
    crudSection($('#fl'), { help: 'floor', endpoint: '/floors', title: 'Floors / areas', newLabel: 'New floor', columns: [{ key: 'name', label: 'Name' }, { key: 'sort_order', label: 'Order' }],
      fields: [{ key: 'name', label: 'Name', required: true }, { key: 'sort_order', label: 'Sort order', type: 'number' }] });
    crudSection($('#tb'), { help: 'table', endpoint: '/tables', title: 'Tables', newLabel: 'New table', columns: [{ key: 'name', label: 'Table' }, { key: 'floor_id', label: 'Floor', fmt: v => (floors.find(f => f.id === v) || {}).name || '' }, { key: 'seats', label: 'Seats', right: 1 }],
      fields: [{ key: 'name', label: 'Table name', required: true }, { key: 'floor_id', label: 'Floor', type: 'select', numeric: true, options: floors.map(f => ({ value: f.id, label: f.name })) }, { key: 'seats', label: 'Seats', type: 'number', default: 4 }] });
  }
  if (tab === 'users') {
    const roles = ['admin', 'manager', 'accountant', 'cashier', 'waiter', 'bartender', 'kitchen', 'technician', 'staff', 'supervisor', 'receptionist', 'clinician', 'farmworker'];
    const lo = hasMod('locations') ? await locationOptions('Default location') : null;
    const load = async () => {
      const users = await GET('/users');
      sb.innerHTML = `<div class="card"><div class="row" style="margin-bottom:10px"><h3 style="flex:1">Users</h3><button class="btn btn-primary" id="nu">＋ New user</button></div>
        ${tableHtml([{ key: 'name', label: 'Name' }, { key: 'username', label: 'Username' }, { key: 'role', label: 'Role', html: 1, fmt: v => badge(v, 'posted') }, { key: 'has_pin', label: 'PIN', fmt: v => v ? '✓' : '' }, { key: 'active', label: 'Status', html: 1, fmt: v => v ? badge('active', 'ok') : badge('disabled', 'closed') }], users, { rowAttr: u => `data-id="${u.id}"` })}
        <p class="muted" style="margin-top:10px"><b>Roles:</b> admin = everything · manager = all operations incl. refunds, discounts, voids · accountant = invoicing, purchasing, accounting, reports · cashier = POS & VAS · waiter = POS orders · bartender = POS & VAS · kitchen = kitchen display only · technician = helpdesk, repairs & maintenance · staff = helpdesk, own tasks & hours · supervisor = sites, rosters, duty board, occurrence book & incidents · receptionist = front desk, bookings, guest bills, patient arrivals & POS · clinician = doctors, nurses and pharmacists: queue, patient files, notes, prescribing & dispensing · farmworker = farm diary (feeding, production, health) and clocking in.</p></div>`;
      const edit = u => {
        const f = [{ key: 'name', label: 'Full name', required: true }, { key: 'username', label: 'Username', required: true }, { key: 'email', label: 'Email' },
          { key: 'role', label: 'Role', type: 'select', options: roles.map(r => ({ value: r, label: r })) }, { key: 'password', label: u ? 'New password (leave blank to keep)' : 'Password', type: 'password', required: !u },
          { key: 'pin', label: u ? 'New POS PIN (4–6 digits, blank = keep)' : 'POS PIN (4–6 digits)', type: 'password' },
          ...(lo ? [{ key: 'location_id', label: 'Home branch', type: 'select', numeric: true, options: lo }] : []), ...(u ? [{ key: 'active', label: 'Active', type: 'checkbox' }] : [])];
        modal({ title: u ? u.name : 'New user', size: 'lg', body: formHtml(f, u ? { ...u, password: '' } : { role: 'cashier' }, { ctx: 'user' }), actions: [{ label: 'Cancel' },
          { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); if (!v.password) delete v.password; if (!v.pin) delete v.pin; if (u) await PUT('/users/' + u.id, v); else await POST('/users', v); c(); toast('Saved'); load(); } }] });
      };
      $('#nu').onclick = () => edit(null);
      $$('[data-id]', sb).forEach(tr => tr.onclick = () => edit(users.find(u => String(u.id) === tr.dataset.id)));
    };
    load();
  }
  if (tab === 'email') {
    const e = s.email;
    const f = [{ key: 'smtp_host', label: 'SMTP server', placeholder: 'smtp.gmail.com' }, { key: 'smtp_port', label: 'Port', type: 'number' },
      { key: 'smtp_user', label: 'SMTP username' }, { key: 'smtp_pass', label: 'SMTP password / app password', type: 'password' },
      { key: 'smtp_secure', label: 'Use SSL/TLS (port 465)', type: 'checkbox' }, { key: 'from_address', label: 'From address' },
      { key: 'recipients', label: 'EOD report recipients (comma separated)', span: 2 },
      { key: 'eod_enabled', label: 'Send the end-of-day report automatically every day', type: 'checkbox', span: 2 },
      { key: 'eod_time', label: 'Send at (24h)', type: 'time' }, { key: 'attach_csv', label: 'Attach CSV', type: 'checkbox' },
      { key: 'send_on_session_close', label: 'Also send when a cashier closes a session', type: 'checkbox', span: 2 }];
    sb.innerHTML = `<div class="card" style="max-width:860px">${formHtml(f, { ...e, recipients: (e.recipients || []).join(', ') }, { ctx: 'email' })}
      <p class="muted">Gmail: use smtp.gmail.com, port 465 with SSL, and an <i>App password</i>. Office 365: smtp.office365.com, port 587. The app must be running at the scheduled time; if several PCs share the database only one sends the report.</p>
      <div class="row wrap" style="margin-top:14px"><input id="testTo" placeholder="test@example.com" style="max-width:260px"><button class="btn" id="test">Send test email</button><button class="btn" id="now">Send today's EOD now</button><span class="spacer"></span><button class="btn btn-primary" id="save">Save</button></div></div>`;
    const save = async () => { await PUT('/settings/email', readForm(sb, f)); };
    $('#save').onclick = async () => { try { await save(); toast('Saved — schedule updated'); } catch (x) { err(x); } };
    $('#test').onclick = async () => { try { await save(); await POST('/email/test', { to: $('#testTo').value }); toast('Test email sent'); } catch (x) { err(x); } };
    $('#now').onclick = async () => { try { await save(); const r = await POST('/email/eod', {}); toast('EOD sent to ' + r.recipients.join(', ')); } catch (x) { err(x); } };
  }
  if (tab === 'plugins') {
    const { plugins, dirs } = await GET('/vas/plugins');
    sb.innerHTML = `<div class="card" style="margin-bottom:14px"><div class="row"><div style="flex:1"><b>Install a plugin:</b> copy its folder (containing <code>plugin.json</code> and <code>index.js</code>) into the plugins folder, then click Reload.
      <div class="muted mono" style="font-size:12px;margin-top:4px">${dirs.map(esc).join('<br>')}</div></div><button class="btn" id="reload">⟳ Reload plugins</button></div></div>
      ${plugins.map(p => `<div class="card plugin-card"><div class="pico">${p.type === 'vas' ? '⚡' : p.type === 'wallet' ? '💳' : '📲'}</div><div style="flex:1"><div class="row"><h3 style="margin:0;flex:1">${esc(p.name)} <small class="muted">v${esc(p.version)}</small></h3>${p.enabled ? badge('enabled', 'ok') : badge('disabled', 'draft')}</div>
        <p class="muted" style="margin:6px 0">${esc(p.description || '')}</p><div class="row"><button class="btn btn-sm btn-primary" data-cfg="${esc(p.id)}">Configure</button>${p.type === 'vas' ? `<button class="btn btn-sm" data-test="${esc(p.id)}">Test connection</button>` : ''}</div></div></div>`).join('') || '<div class="empty">No plugins found.</div>'}`;
    $('#reload').onclick = async () => { await POST('/vas/plugins/reload'); toast('Plugins reloaded'); settings(view); };
    $$('[data-test]').forEach(b => b.onclick = async () => { try { const r = await POST(`/vas/plugins/${b.dataset.test}/test`); modal({ title: 'Connection test', body: `<pre style="white-space:pre-wrap;font-size:12px">${esc(JSON.stringify(r, null, 2))}</pre>` }); } catch (x) { err(x); } });
    $$('[data-cfg]').forEach(b => b.onclick = () => {
      const p = plugins.find(x => x.id === b.dataset.cfg);
      const f = [{ key: '__enabled', label: 'Enabled', type: 'checkbox', span: 2, help: 'Turn the plugin on. Fill in the details your provider gave you, then use Test connection.' }, ...(p.config || []).map(c => ({
        key: c.key, label: c.label, type: c.type === 'select' ? 'select' : c.type === 'json' ? 'json' : c.secret ? 'password' : c.type === 'number' ? 'number' : c.type === 'boolean' ? 'checkbox' : 'text',
        options: (c.options || []).map(o => ({ value: o, label: o })), span: c.type === 'json' || c.key.endsWith('url') ? 2 : 1, rows: 5, help: c.help || PLUGIN_HELP[c.key]
      }))];
      const vals = { __enabled: p.enabled ? 1 : 0 };
      for (const c of p.config || []) vals[c.key] = p.values[c.key] ?? c.default ?? '';
      modal({ title: p.name, wide: true, body: formHtml(f, vals), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => {
        const v = readForm(r, f); const enabled = !!v.__enabled; delete v.__enabled;
        for (const fc of p.config || []) if (fc.type === 'json' && v[fc.key]) { try { JSON.parse(v[fc.key]); } catch (_) { throw new Error(`${fc.label} is not valid JSON`); } }
        await PUT('/vas/plugins/' + p.id, { enabled, values: v }); c(); toast('Plugin saved'); settings(view);
      } }] });
    });
  }
  if (tab === 'updates') return updatesTab(sb);

  if (tab === 'logs') {
    const [mails, audit] = await Promise.all([GET('/email/log'), GET('/audit')]);
    sb.innerHTML = `<div class="cols cols-2"><div class="card"><h3>Email log</h3>${tableHtml([{ key: 'created_at', label: 'When', fmt: dt }, { key: 'kind', label: 'Kind' }, { key: 'recipients', label: 'To' }, { key: 'status', label: 'Status', html: 1, fmt: v => badge(v === 'sent' ? 'sent' : 'failed') }, { key: 'error', label: 'Error' }], mails)}</div>
      <div class="card"><h3>Audit log</h3>${tableHtml([{ key: 'created_at', label: 'When', fmt: dt }, { key: 'user_name', label: 'User' }, { key: 'action', label: 'Action' }, { key: 'entity', label: 'Record', fmt: (v, r) => `${v || ''} #${r.entity_id || ''}` }], audit)}</div></div>`;
  }
}

// ---------------------------------------------------------------- updates & backup
async function updatesTab(sb) {
  const M = window.maluti;
  const info = M ? await M.info() : null;
  if (!M || !M.updateSettings) {
    sb.innerHTML = `<div class="card" style="max-width:760px"><h3>Updates</h3><p class="muted">Updates are installed from the Maluti ERP desktop app on each computer (File → Check for updates). Tills that use this computer as their server get the new version automatically once this computer is updated.</p></div>`;
    return;
  }
  const us = await M.updateSettings();
  const st = us.state || {};
  const md = t => esc(t || '').replace(/^### (.*)$/gm, '<b>$1</b>').replace(/^## (.*)$/gm, '<b>$1</b>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
  const statusHtml = s => ({
    idle: '<span class="muted">Not checked yet.</span>', checking: 'Checking…',
    'up-to-date': `✅ You have the latest version (${esc(s.version || us.current)}).`,
    available: `<b style="color:var(--ok)">Version ${esc(s.version)} is available</b>${s.size ? ` <span class="muted">(${(s.size / 1048576).toFixed(1)} MB${s.mode === 'installer' ? ', full installer' : ''})</span>` : ''}
      <div style="margin-top:8px"><button class="btn btn-primary" id="upApply">⬇ Download & restart</button></div>${s.notes ? `<div class="card" style="margin-top:10px;font-size:13px;max-height:220px;overflow:auto">${md(s.notes)}</div>` : ''}`,
    'no-asset': `Version ${esc(s.version)} exists but has no update file for this computer (${esc(us.arch)}). <a href="${esc(s.url || '#')}" target="_blank">Open the release page</a>.`,
    downloading: `Downloading… <b id="upPct">${s.progress || 0}%</b>`, restarting: 'Restarting into the new version…', 'installer-started': 'The installer has started.',
    error: `<span style="color:var(--bad)">${esc(s.error || 'Error')}</span>`
  }[s.status] || esc(s.status));
  sb.innerHTML = `<div class="cols cols-2"><div class="card"><h3>Online updates (GitHub)</h3>
      <p class="muted" style="font-size:13px">This computer runs <b>Maluti ERP ${esc(us.current)}</b> (${us.arch === 'ia32' ? '32-bit' : '64-bit'}). New versions are published as GitHub releases; the app downloads only the changed program file (a few MB) and restarts. Your data is not touched – database changes are applied automatically on restart.</p>
      <div class="form-grid"><label class="field" style="grid-column:span 2"><span>GitHub repository (owner/name)</span><input id="upRepo" value="${esc(us.repo)}" placeholder="e.g. sepholo/maluti-erp"><small class="help-note">The GitHub repository where new Maluti ERP versions are published as releases – the part after github.com/, e.g. sepholo/maluti-erp.</small></label>
        <label class="field check"><input type="checkbox" id="upAuto" ${us.auto_check ? 'checked' : ''}> <span>Check automatically when the app starts</span></label>
        <label class="field"><span>Access token (only for a private repository)</span><input id="upTok" type="password" placeholder="${us.has_token ? '•••••• saved – leave blank to keep' : 'not needed for a public repository'}"><small class="help-note">Only needed if the repository is private: a GitHub fine-grained token with read-only "Contents" access to that repository.</small></label></div>
      <div class="row" style="margin-top:12px"><button class="btn" id="upSave">Save</button><button class="btn btn-primary" id="upCheck">Check for updates</button></div>
      <div id="upStatus" style="margin-top:14px">${statusHtml(st)}</div></div>
    <div class="card"><h3>Database backup</h3>
      ${info && info.embedded_db ? `<p class="muted" style="font-size:13px">The built-in database is backed up automatically once a day (the last 14 are kept). You can also back up now – copy the backup file to a flash drive or cloud folder regularly.</p>
        <button class="btn btn-primary" id="bkNow">💾 Back up now</button><div id="bkRes" class="muted" style="margin-top:10px;font-size:13px;word-break:break-all"></div>`
      : '<p class="muted" style="font-size:13px">This computer uses your own MySQL server. Back it up with MySQL Workbench (Server → Data Export) or mysqldump.</p>'}</div></div>`;
  const wireApply = () => { const b = $('#upApply'); if (b) b.onclick = async () => {
    if (!(await confirmBox('Download the update and restart Maluti ERP now? Make sure no sale is in progress on this computer.', { okLabel: 'Update & restart' }))) return;
    $('#upStatus').innerHTML = statusHtml({ status: 'downloading', progress: 0 });
    M.onUpdateProgress(p => { const e = $('#upPct'); if (e) e.textContent = (p == null ? '…' : p + '%'); });
    const r = await M.updateApply();
    $('#upStatus').innerHTML = r.error ? statusHtml({ status: 'error', error: r.error }) : statusHtml({ status: r.installer ? 'installer-started' : 'restarting' });
  }; };
  wireApply();
  const save = async () => { const t = $('#upTok').value; return M.updateSettings({ repo: $('#upRepo').value, auto_check: $('#upAuto').checked, ...(t ? { token: t } : {}) }); };
  $('#upSave').onclick = async () => { try { const r = await save(); if (r && r.error) throw new Error(r.error); toast('Saved'); } catch (e) { err(e); } };
  $('#upCheck').onclick = async () => {
    try { await save(); } catch (e) { return err(e); }
    $('#upStatus').innerHTML = statusHtml({ status: 'checking' });
    const r = await M.updateCheck(); $('#upStatus').innerHTML = statusHtml(r); wireApply();
  };
  const bk = $('#bkNow');
  if (bk) bk.onclick = async () => { bk.disabled = true; try { const r = await POST('/backup', {}); $('#bkRes').textContent = 'Saved: ' + r.file; toast('Backup saved'); } catch (e) { err(e); } bk.disabled = false; };
}
