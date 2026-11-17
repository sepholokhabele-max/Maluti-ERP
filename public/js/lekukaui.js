// RSL Lekuka e-invoicing: register this S-ERP as a device (demo, RSL test environment or live), what is sent and
// what is waiting, fiscal days (Z reports), taxes, and the options.
import { state, GET, POST, PUT, esc, $, $$, toast, err, can, money, modal, confirmBox, formHtml, readForm, tableHtml, badge, page, dt, query } from './core.js';

const MODE = { demo: ['Demo (practice – nothing goes to RSL)', 'draft'], test: ['RSL test environment', 'partial'], live: ['Live – reporting to RSL', 'ok'] };
const COLOR = { Valid: ['accepted', 'ok'], Yellow: ['accepted with warnings', 'partial'], Red: ['rejected by RSL', 'cancelled'], Grey: ['waiting for an earlier document', 'draft'] };
const DAY = { open: ['open', 'ok'], closing: ['closing', 'partial'], close_failed: ['close failed', 'cancelled'], closed: ['closed', 'posted'] };
const KIND = { pos_order: 'Till sale', pos_refund: 'Till refund', invoice: 'Invoice', invoice_cancel: 'Cancelled invoice' };
const docLink = r => r.doc_kind.startsWith('invoice') ? `#/invoice/${r.doc_id}` : '#/sales';

export async function lekukaPage(view) {
  const tab = query().tab || 'overview';
  const st = await GET('/lekuka/status');
  const s = st.settings, registered = !!s.device_id && s.has_key;
  const tabs = [['overview', 'Overview'], ['register', registered ? 'Device & registration' : 'Register'], ['documents', 'Documents'], ['days', 'Fiscal days'], ['options', 'Options & taxes']];
  view.innerHTML = page('Lekuka e-invoicing (RSL)', registered && s.enabled ? '<button class="btn" id="snd">Send now</button> <button class="btn" id="cls">Close fiscal day</button>' : '',
    `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/lekuka?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="lb"></div>`);
  const reload = () => lekukaPage(view);
  if ($('#snd')) $('#snd').onclick = async () => { try { const x = await POST('/lekuka/send'); toast(x.queued ? `${x.queued} document(s) still waiting${x.settings.last_error ? ': ' + x.settings.last_error : ''}` : 'Everything is sent', x.queued ? 'err' : 'ok', 6000); reload(); } catch (e) { err(e); } };
  if ($('#cls')) $('#cls').onclick = async () => { if (!(await confirmBox('Close the fiscal day now? The Z report (counters) is sent to Lekuka; the next sale opens a new fiscal day.'))) return; try { const d = await POST('/lekuka/close-day'); toast(d.status === 'closed' ? `Fiscal day ${d.day_no} closed` : `Fiscal day ${d.day_no}: ${d.status}${d.error ? ' – ' + d.error : ''}`, d.status === 'closed' ? 'ok' : 'err', 6000); reload(); } catch (e) { err(e); } };
  const T = { overview, register, documents, days, options };
  await (T[tab] || overview)($('#lb'), st, reload);
}

async function overview(lb, st, reload) {
  const s = st.settings, cfg = s.config || {};
  if (!s.device_id || !s.has_key) {
    lb.innerHTML = `<div class="card" style="max-width:860px"><h3>Report your sales to RSL automatically</h3>
      <p>Under the Value Added Tax (E-Invoicing) Regulations, 2026, every invoice, receipt, credit note and debit note must be reported to RSL's Lekuka system and carry its QR code. S-ERP does this for you: each sale is numbered, signed and sent, and the fiscal day is closed with its Z report.</p>
      <ol><li><b>Ask RSL for a device</b> on the RSL self-service portal (or through lekukasupport@rsl.org.ls). Give this device serial number: <code style="user-select:all">${esc(st.serial_no)}</code>, device model <b>${esc(st.model.name)}</b> version <b>${esc(st.model.version)}</b>.</li>
        <li>RSL gives you a <b>Device ID</b> and an 8-character <b>activation key</b>.</li><li>Enter them under <a href="#/lekuka?tab=register">Register</a>. S-ERP makes its own security key and gets its certificate from RSL.</li><li>Sell as usual – receipts and invoices now carry the Lekuka QR code and verification code.</li></ol>
      <p class="muted">Want to see how it works first? Register in <b>Demo</b> mode with any device ID and an 8-character key – nothing is sent to RSL.</p>
      <a class="btn btn-primary" href="#/lekuka?tab=register">Register this device</a></div>`;
    return;
  }
  const d = st.day;
  lb.innerHTML = `${s.last_error ? `<div class="card" style="border-left:4px solid var(--bad)"><b>Not everything could be sent</b> – ${esc(s.last_error)} <span class="muted">(${dt(s.last_error_at)})</span>. Documents keep their numbers and are sent in order as soon as Lekuka can be reached.</div>` : ''}
    ${st.day_warning ? `<div class="card" style="border-left:4px solid var(--warn)"><b>The fiscal day is about to reach its maximum length</b> (${cfg.taxPayerDayMaxHrs || 24} hours). Close it now; it is also closed automatically.</div>` : ''}
    ${!st.model.accredited && s.mode !== 'demo' ? `<div class="card" style="border-left:4px solid var(--warn)">S-ERP's accreditation with RSL is not yet confirmed, so only the <b>RSL test environment</b> can be used. Live reporting is switched on when Smartel Money receives the accreditation.</div>` : ''}
    <div class="cols cols-4" style="margin-bottom:12px">
      <div class="kpi"><div class="label">Mode</div><div class="value" style="font-size:18px">${badge(MODE[s.mode][0], MODE[s.mode][1])}</div><div class="hint">${s.enabled ? 'switched on' : '<b>switched off</b>'}</div></div>
      <div class="kpi"><div class="label">Fiscal day</div><div class="value">${d ? `${d.day_no} ${badge(DAY[d.status][0], DAY[d.status][1])}` : '–'}</div><div class="hint">${d ? `${d.receipt_counter} document(s) · opened ${esc(d.opened_at.replace('T', ' '))}${st.day_hours !== null ? ` (${st.day_hours} h)` : ''}` : 'opens with the next sale'}</div></div>
      <div class="kpi"><div class="label">Waiting to be sent</div><div class="value" style="color:${st.queued ? 'var(--warn)' : 'inherit'}">${st.queued}</div><div class="hint">${st.sent} sent in total</div></div>
      <div class="kpi"><div class="label">Need attention</div><div class="value" style="color:${st.red ? 'var(--bad)' : 'inherit'}">${st.red}</div><div class="hint">${st.yellow} with warnings</div></div></div>
    <div class="cols cols-2"><div class="card"><h3>Taxpayer (from RSL)</h3><p><b>${esc(cfg.taxPayerName || '')}</b><br>TIN ${esc(cfg.taxPayerTIN || '')}${cfg.vatNumber ? ` · VAT No ${esc(cfg.vatNumber)}` : ' · not a VAT payer'}<br>${esc(cfg.deviceBranchName || '')}${cfg.deviceBranchAddress ? `<br>${esc([cfg.deviceBranchAddress.houseNo, cfg.deviceBranchAddress.street, cfg.deviceBranchAddress.city, cfg.deviceBranchAddress.district].filter(Boolean).join(', '))}` : ''}</p>
      <p class="muted">Operating mode: ${esc(cfg.deviceOperatingMode || '')} · buyer details needed above ${money(cfg.thresholdForMandatoryBuyerData || 0)} · maximum fiscal day ${cfg.taxPayerDayMaxHrs || 24} h</p></div>
      <div class="card"><h3>Device</h3><p>Device ID <b>${s.device_id}</b> · serial No <b>${esc(s.serial_no || '')}</b><br>Model ${esc(st.model.name)} ${esc(st.model.version)}<br>Certificate valid until <b>${esc(s.cert_valid_till || '')}</b> (renewed automatically a month before)<br>Last contact: ${s.last_ping ? dt(s.last_ping) : '–'}</p></div></div>`;
}

async function register(lb, st, reload) {
  const s = st.settings, registered = !!s.device_id && s.has_key;
  const f = [{ key: 'mode', label: 'Where to report', type: 'select', options: Object.entries(MODE).map(([value, [label]]) => ({ value, label })) }, { key: 'device_id', label: 'Device ID (from RSL)', type: 'number', required: true },
    { key: 'activation_key', label: 'Activation key (8 characters, from RSL)', required: true }];
  lb.innerHTML = `${registered ? `<div class="card"><b>Registered</b>: device ${s.device_id} (${esc(MODE[s.mode][0])}) since ${dt(s.registered_at)}. Registering again replaces the device (for example to move from the test environment to live).</div>` : ''}
    <div class="card" style="max-width:780px"><h3>${registered ? 'Register again' : 'Register this S-ERP as a device'}</h3>
      <p>This device's serial number for RSL: <code style="user-select:all">${esc(st.serial_no)}</code> · model <b>${esc(st.model.name)}</b> version <b>${esc(st.model.version)}</b></p>
      ${formHtml(f, { mode: s.mode || 'demo', device_id: '' })}
      <div class="row" style="margin-top:10px;gap:8px"><button class="btn" id="chk">1. Check the taxpayer</button><button class="btn btn-primary" id="reg" disabled>2. Register the device</button></div><div id="tp" style="margin-top:12px"></div>
      <p class="muted" style="margin-top:10px">The activation key is used once. S-ERP makes its own private key (it never leaves this installation), sends a certificate request and keeps the certificate RSL issues; every document is signed with it.</p></div>`;
  $('#chk').onclick = async () => {
    try { const v = readForm(lb, f); const x = await POST('/lekuka/verify', v);
      $('#tp').innerHTML = `<div class="card" style="background:var(--bg)"><b>Is this your business?</b><br>${esc(x.taxPayerName)} · TIN ${esc(x.taxPayerTIN)}${x.vatNumber ? ` · VAT No ${esc(x.vatNumber)}` : ''}<br>${esc(x.deviceBranchName || '')}</div>`; $('#reg').disabled = false;
    } catch (e) { err(e); }
  };
  $('#reg').onclick = async () => {
    try { const v = readForm(lb, f); if (registered && !(await confirmBox('Replace the current device registration?'))) return; await POST('/lekuka/register', v); toast('Registered – sales are now reported to Lekuka'); location.hash = '#/lekuka?tab=overview'; }
    catch (e) { err(e); }
  };
}

async function documents(lb, st, reload) {
  const only = query().all ? '' : '?problems=1';
  const rows = await GET('/lekuka/receipts' + only);
  lb.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="muted">${only ? 'Documents waiting or with remarks from RSL.' : 'All documents (latest first).'}</span><span class="spacer"></span><a class="btn btn-sm" href="#/lekuka?tab=documents${only ? '&all=1' : ''}">${only ? 'Show all' : 'Show only those needing attention'}</a></div>
    <div class="card">${tableHtml([{ key: 'global_no', label: 'Global No', right: 1 }, { key: 'day_no', label: 'Day', right: 1 }, { key: 'receipt_counter', label: 'No in day', right: 1 }, { key: 'doc_kind', label: 'From', html: 1, fmt: (v, r) => `<a href="${docLink(r)}">${esc(KIND[v] || v)} ${esc(r.doc_number || '')}</a>` },
      { key: 'receipt_type', label: 'Lekuka type' }, { key: 'total', label: 'Total', right: 1, fmt: money },
      { key: 'status', label: 'Status', html: 1, fmt: (v, r) => v === 'sent' ? badge(...(COLOR[r.color] || ['sent', 'ok'])) : v === 'in_file' ? badge('in offline file', 'partial') : badge(v === 'failed' ? `not sent (${r.attempts} tries)` : 'waiting', v === 'failed' ? 'cancelled' : 'draft') },
      { key: 'validation_errors', label: 'RSL remarks', html: 1, fmt: (v, r) => { const e = typeof v === 'string' ? JSON.parse(v || '[]') : (v || []); return e.map(x => `<div><b>${esc(x.validationErrorCode)}</b> ${esc(x.validationErrorDescription)}</div>`).join('') + (r.last_error && r.status !== 'sent' ? `<div class="muted">${esc(r.last_error)}</div>` : ''); } },
      { key: 'verification_code', label: 'Verification code', html: 1, fmt: (v, r) => `<a href="${esc(r.qr_url)}" target="_blank" rel="noopener">${esc(v)}</a>` }], rows, { empty: only ? 'Nothing needs attention 👍' : 'No documents yet.' })}</div>`;
}

async function days(lb) {
  const rows = await GET('/lekuka/days');
  lb.innerHTML = `<div class="card">${tableHtml([{ key: 'day_no', label: 'Fiscal day', right: 1 }, { key: 'opened_at', label: 'Opened', fmt: v => String(v || '').replace('T', ' ') }, { key: 'closed_at', label: 'Closed', fmt: v => String(v || '').replace('T', ' ') },
    { key: 'receipt_counter', label: 'Documents', right: 1 }, { key: 'status', label: 'Status', html: 1, fmt: (v, r) => badge(...(DAY[v] || [v, ''])) + (r.error ? `<br><small class="neg">${esc(r.error)}</small>` : '') },
    { key: 'id', label: '', html: 1, fmt: v => `<a class="btn btn-sm" href="/api/lekuka/days/${v}/file" data-file="${v}">⬇ File</a>` }], rows, { empty: 'No fiscal days yet – the first sale opens one.' })}
    <p class="muted">The file holds the day's documents and Z report in RSL's format, for upload on the Lekuka self-service portal when the device works offline.</p></div>`;
  $$('[data-file]', lb).forEach(a => a.onclick = async e => { e.preventDefault(); try { const r = await fetch(a.getAttribute('href'), { headers: { Authorization: 'Bearer ' + state.token } }); if (!r.ok) throw new Error((await r.json()).error); const b = await r.blob(); const x = document.createElement('a'); x.href = URL.createObjectURL(b); x.download = `lekuka-day-${a.dataset.file}.json`; x.click(); } catch (z) { err(z); } });
}

async function options(lb, st, reload) {
  const s = st.settings;
  const f = [{ key: 'enabled', label: 'Report sales to Lekuka', type: 'checkbox' }, { key: 'include_pos', label: 'Till sales and refunds', type: 'checkbox' }, { key: 'include_invoices', label: 'Customer invoices and cancellations', type: 'checkbox' },
    { key: 'zero_rated_as', label: 'Items with 0% VAT are', type: 'select', options: [{ value: 'vat0', label: 'Zero-rated (VAT 0%)' }, { value: 'exempt', label: 'Exempt from VAT' }] },
    { key: 'auto_close_time', label: 'Close the fiscal day automatically at (blank = only at the maximum length)', placeholder: '23:50' },
    ...(s.mode === 'demo' ? [{ key: 'simulate_offline', label: 'Practice: pretend there is no internet', type: 'checkbox' }] : [])];
  lb.innerHTML = `<div class="cols cols-2"><div class="card"><h3>Options</h3>${formHtml(f, s)}<button class="btn btn-primary" id="sv" style="margin-top:10px">Save</button>
      ${can('settings') && s.device_id ? '<button class="btn" id="cfg" style="margin:10px 0 0 8px">Reload taxes and settings from RSL</button>' : ''}</div>
    <div class="card"><h3>Taxes RSL allows for this taxpayer</h3>${tableHtml([{ key: 'taxID', label: 'ID', right: 1 }, { key: 'taxName', label: 'Tax' }, { key: 'taxType', label: 'Type' }, { key: 'taxRate', label: 'Rate', right: 1, fmt: v => v === undefined || v === null ? '–' : v + '%' }, { key: 'taxValidFrom', label: 'From' }], st.taxes, { empty: 'Register first.' })}
      <p class="muted">Each item's VAT rate in S-ERP is matched to these taxes. Levies (tobacco, alcohol, plastic) are not yet added to items automatically.</p></div></div>`;
  $('#sv').onclick = async () => { try { await PUT('/lekuka/options', readForm(lb, f)); toast('Saved'); reload(); } catch (e) { err(e); } };
  if ($('#cfg')) $('#cfg').onclick = async () => { try { await POST('/lekuka/config'); toast('Reloaded'); reload(); } catch (e) { err(e); } };
}
