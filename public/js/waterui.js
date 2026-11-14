// Water utility: overview, connections (prepaid / postpaid), meter reading routes, billing runs, prepaid tokens,
// field jobs, disconnections, tariffs, zones and water losses, meters and settings. The till uses waterTillDialog().
import { state, GET, POST, PUT, DEL, esc, $, $$, toast, err, can, money, qty, modal, confirmBox, formHtml, readForm, tableHtml, badge, page, d, dt, today, query, printHtml, receiptLogoHtml } from './core.js';
import { remindOne } from './remindui.js';
import { docButton } from './legalui.js';

const ST = { pending: ['waiting for connection', 'draft'], active: ['connected', 'ok'], disconnected: ['disconnected', 'cancelled'], closed: ['closed', 'closed'] };
const stBadge = s => badge((ST[s] || [s])[0], (ST[s] || [s, ''])[1]);
const billBadge = b => badge(b === 'prepaid' ? 'prepaid' : 'postpaid', b === 'prepaid' ? 'partial' : 'posted');
const FLAG = { high: ['very high use', 'cancelled'], zero: ['no use', 'draft'], rollover: ['meter went round', 'partial'] };
const flagBadge = f => f ? badge((FLAG[f] || [f])[0], (FLAG[f] || [f, ''])[1]) : '';
const JOB_ST = { open: ['open', 'draft'], assigned: ['assigned', 'partial'], done: ['done', 'ok'], cancelled: ['cancelled', 'cancelled'] };
const thisMonth = () => today().slice(0, 7);
const methods = async () => (await GET('/payment-methods')).filter(m => m.active && m.kind !== 'account');
const m3 = v => v === null || v === undefined || v === '' ? '' : `${qty(v)} m³`;
let KINDS = null;
const jobKinds = async () => KINDS || (KINDS = (await GET('/water/settings')).job_kinds);

/* ===================== main page ===================== */
export async function water(view) {
  const office = can('water');
  const tab = query().tab || (office ? 'overview' : 'readings');
  const tabs = office ? [['overview', 'Overview'], ['accounts', 'Connections'], ['readings', 'Meter readings'], ['billing', 'Billing'], ['prepaid', 'Prepaid sales'], ['jobs', 'Field jobs'],
    ['cutoff', 'Disconnections'], ['tariffs', 'Tariffs'], ['zones', 'Zones & water loss'], ['meters', 'Meters'], ['settings', 'Settings']]
    : [['readings', 'Meter readings'], ['jobs', 'My jobs']];
  view.innerHTML = page('Water utility', office ? `<button class="btn" id="wv">💧 Sell prepaid / take payment</button><button class="btn btn-primary" id="wn">＋ New connection</button>` : '',
    `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/water?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="wb"></div>`);
  if ($('#wn')) $('#wn').onclick = () => accountDialog(null, id => { location.hash = '#/wateraccount/' + id; });
  if ($('#wv')) $('#wv').onclick = () => waterTillDialog(null);
  const wb = $('#wb'), reload = () => water(view);
  const T = { overview, accounts, readings, billing, prepaid, jobs, cutoff, tariffs, zones, meters, settings };
  await (T[tab] || overview)(wb, reload);
}

async function overview(wb) {
  const p = query().period || thisMonth();
  const x = await GET('/water/dashboard?period=' + p);
  const cnt = (b, s) => x.accounts.filter(a => (!b || a.billing === b) && (!s || a.status === s)).reduce((t, a) => t + Number(a.n), 0);
  wb.innerHTML = `<div class="row" style="margin-bottom:10px"><label>Month <input type="month" id="op" value="${p}"></label></div>
    <div class="cols cols-4" style="margin-bottom:14px">
      <div class="kpi"><div class="label">Connections</div><div class="value">${cnt(null, 'active')}</div><div class="hint">${cnt('postpaid', 'active')} postpaid · ${cnt('prepaid', 'active')} prepaid · ${cnt(null, 'disconnected')} cut off · ${cnt(null, 'pending')} waiting</div></div>
      <div class="kpi"><div class="label">Billed (postpaid)</div><div class="value">${money(x.billed.amount)}</div><div class="hint">${x.billed.bills} bills · ${m3(x.billed.m3)}${x.billed.estimated ? ` · ${x.billed.estimated} estimated` : ''}</div></div>
      <div class="kpi"><div class="label">Prepaid sold</div><div class="value">${money(x.prepaid.amount)}</div><div class="hint">${x.prepaid.sales} tokens · ${m3(x.prepaid.m3)}</div></div>
      <div class="kpi"><div class="label">Collected on bills</div><div class="value">${money(x.collected)}</div><div class="hint">${x.collection_rate === null ? '' : x.collection_rate + '% of this month\'s bills'}</div></div></div>
    <div class="cols cols-2">
      <div class="card"><h3>Money owed on water bills</h3>${tableHtml([{ key: 'k', label: '' }, { key: 'v', label: 'Owed', right: 1, fmt: money }],
        [{ k: 'Not yet due', v: x.arrears.current }, { k: '1–30 days late', v: x.arrears.d30 }, { k: '31–60 days late', v: x.arrears.d60 }, { k: 'More than 60 days late', v: x.arrears.d90 }, { k: 'Total', v: x.arrears.total }])}
        <div class="row" style="margin-top:8px"><a class="btn btn-sm" href="#/water?tab=cutoff">✂ ${x.disconnect_candidates} to disconnect</a><a class="btn btn-sm" href="#/reminders">📱 Payment reminders</a></div></div>
      <div class="card"><h3>To do this month</h3>
        <p>${x.to_read ? `<a href="#/water?tab=readings">📋 <b>${x.to_read}</b> postpaid meters not read yet</a>` : '✅ Every postpaid meter has a reading this month'}</p>
        <p>${x.open_jobs.length ? `<a href="#/water?tab=jobs">🛠 Open jobs: ${x.open_jobs.map(j => `${j.n} ${esc((KINDS || {})[j.kind] || j.kind.replace('_', ' '))}`).join(', ')}</a>` : 'No open field jobs'}</p>
        <h4>Readings to check</h4>${tableHtml([{ key: 'account_no', label: 'Account' }, { key: 'customer_name', label: 'Customer' }, { key: 'reading_date', label: 'Date', fmt: d },
          { key: 'consumption', label: 'Used', right: 1, fmt: m3 }, { key: 'flag', label: '', html: 1, fmt: flagBadge }], x.flags, { rowAttr: r => `data-a="${r.account_id}"`, empty: 'Nothing unusual.' })}</div></div>`;
  $('#op').onchange = e => { location.hash = '#/water?tab=overview&period=' + e.target.value; };
  $$('[data-a]', wb).forEach(tr => tr.onclick = () => { location.hash = '#/wateraccount/' + tr.dataset.a; });
}

async function accounts(wb) {
  const q = query(), [zs, rows] = await Promise.all([GET('/water/zones'), GET(`/water/accounts?q=${encodeURIComponent(q.q || '')}${q.zone_id ? '&zone_id=' + q.zone_id : ''}${q.billing ? '&billing=' + q.billing : ''}${q.status ? '&status=' + q.status : ''}${q.owing ? '&owing=1' : ''}`)]);
  wb.innerHTML = `<div class="row wrap" style="margin-bottom:10px"><input id="aq" placeholder="Account, name, phone, meter or address" value="${esc(q.q || '')}" style="min-width:260px">
    <select id="az"><option value="">All zones</option>${zs.map(z => `<option value="${z.id}" ${String(z.id) === q.zone_id ? 'selected' : ''}>${esc(z.name)}</option>`).join('')}</select>
    <select id="ab"><option value="">Prepaid and postpaid</option><option value="postpaid" ${q.billing === 'postpaid' ? 'selected' : ''}>Postpaid</option><option value="prepaid" ${q.billing === 'prepaid' ? 'selected' : ''}>Prepaid</option></select>
    <select id="as"><option value="">Open (not closed)</option>${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${q.status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select>
    <label class="check"><input type="checkbox" id="ao" ${q.owing ? 'checked' : ''}> owing</label><button class="btn" id="ag">Search</button><span class="spacer"></span><span class="muted">${rows.length} connections</span></div>
    <div class="card">${tableHtml([{ key: 'account_no', label: 'Account' }, { key: 'customer_name', label: 'Customer' }, { key: 'phone', label: 'Phone' }, { key: 'address', label: 'Address' },
      { key: 'zone_name', label: 'Zone' }, { key: 'billing', label: 'Billing', html: 1, fmt: billBadge }, { key: 'tariff_name', label: 'Tariff' }, { key: 'meter_serial', label: 'Meter' },
      { key: 'last_reading', label: 'Last reading', right: 1, fmt: (v, a) => v === null ? '' : `${qty(v)} (${d(a.last_reading_date)})` }, { key: 'arrears', label: 'Owes', right: 1, html: 1, fmt: v => v > 0 ? `<b class="neg">${money(v)}</b>` : '' },
      { key: 'status', label: 'Status', html: 1, fmt: stBadge }], rows, { rowAttr: a => `data-id="${a.id}"`, empty: 'No connections yet. Add tariffs and zones, then ＋ New connection (or ⬆ Import from your old system).' })}</div>`;
  const go = () => { location.hash = `#/water?tab=accounts&q=${encodeURIComponent($('#aq').value)}&zone_id=${$('#az').value}&billing=${$('#ab').value}&status=${$('#as').value}${$('#ao').checked ? '&owing=1' : ''}`; };
  $('#ag').onclick = go; $('#aq').onkeydown = e => { if (e.key === 'Enter') go(); };
  $$('[data-id]', wb).forEach(tr => tr.onclick = () => { location.hash = '#/wateraccount/' + tr.dataset.id; });
}

/* ---- meter readings: a route sheet that works on a phone ---- */
async function readings(wb) {
  const q = query(), period = q.period || thisMonth();
  const zs = await GET('/water/zones');
  const zone = q.zone_id || (zs.find(z => z.reader_id === state.user.id) || {}).id || '';
  const r = await GET(`/water/route?period=${period}${zone ? '&zone_id=' + zone : ''}`);
  wb.innerHTML = `<div class="row wrap" style="margin-bottom:10px"><label>Month <input type="month" id="rp" value="${period}"></label>
    <select id="rz"><option value="">All zones</option>${zs.filter(z => z.active).map(z => `<option value="${z.id}" ${String(z.id) === String(zone) ? 'selected' : ''}>${esc(z.name)}</option>`).join('')}</select>
    <label>Read on <input type="date" id="rd" value="${today()}"></label><span class="spacer"></span><b>${r.read} of ${r.rows.length} read</b>
    <button class="btn" id="rprint">🖨 Reading sheet</button></div>
    <div class="card"><p class="muted">Walk the route in this order. Type the number on each meter (all the black digits) and press Save. Readings that look wrong are marked so the office can check them before billing.</p>
    ${r.rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>#</th><th>Account</th><th>Customer / address</th><th>Meter</th><th class="r">Last reading</th><th class="r">This month</th><th></th></tr></thead><tbody>
      ${r.rows.map(x => `<tr data-acc="${x.id}"><td>${x.route_seq || ''}</td><td><a href="#/wateraccount/${x.id}">${esc(x.account_no)}</a></td><td>${esc(x.customer_name)}<br><small class="muted">${esc(x.address || '')}${x.plot_no ? ' · plot ' + esc(x.plot_no) : ''}</small></td>
        <td>${esc(x.meter_serial || '')}</td><td class="r">${x.prev_reading === null ? '' : qty(x.prev_reading)}<br><small class="muted">${d(x.prev_date)}</small></td>
        <td class="r">${x.this_month ? `<b>${qty(x.this_month.reading)}</b><br><small>${m3(x.this_month.consumption)}</small> ${flagBadge(x.this_month.flag)}` : `<input type="number" step="any" min="0" inputmode="decimal" data-rd="${x.id}" style="width:120px">`}</td>
        <td>${x.this_month ? '✅' : ''}</td></tr>`).join('')}</tbody></table></div>
      <div class="row" style="margin-top:10px"><span class="spacer"></span><button class="btn btn-primary" id="rsave">Save readings</button></div>` : '<div class="empty">No postpaid meters to read in this zone.</div>'}</div>`;
  const go = () => { location.hash = `#/water?tab=readings&period=${$('#rp').value}&zone_id=${$('#rz').value}`; };
  $('#rp').onchange = go; $('#rz').onchange = go;
  $('#rprint').onclick = () => printHtml(`<div style="font-family:Arial;font-size:12px"><h2>${esc(state.company.name || '')} – meter reading sheet ${period}</h2>
    <table border="1" cellspacing="0" cellpadding="5" style="width:100%;border-collapse:collapse"><tr><th>#</th><th>Account</th><th>Customer / address</th><th>Meter</th><th>Last reading</th><th style="width:120px">Reading</th><th>Note</th></tr>
    ${r.rows.map(x => `<tr><td>${x.route_seq || ''}</td><td>${esc(x.account_no)}</td><td>${esc(x.customer_name)}<br>${esc(x.address || '')}</td><td>${esc(x.meter_serial || '')}</td><td>${x.prev_reading === null ? '' : qty(x.prev_reading)}</td><td>${x.this_month ? qty(x.this_month.reading) : ''}</td><td></td></tr>`).join('')}</table></div>`);
  if ($('#rsave')) $('#rsave').onclick = async () => {
    const list = $$('[data-rd]', wb).filter(i => i.value !== '').map(i => ({ account_id: Number(i.dataset.rd), reading: Number(i.value) }));
    if (!list.length) return toast('Type at least one reading', 'err');
    try {
      const res = await POST('/water/readings/batch', { reading_date: $('#rd').value, readings: list });
      const bad = res.results.filter(x => !x.ok);
      toast(`${res.saved} reading${res.saved === 1 ? '' : 's'} saved${bad.length ? ` – ${bad.length} not saved` : ''}`, bad.length ? 'err' : 'ok', 6000);
      if (bad.length) modal({ title: 'Readings not saved', body: tableHtml([{ key: 'account_id', label: 'Account', fmt: v => (r.rows.find(x => x.id === v) || {}).account_no }, { key: 'error', label: 'Why' }], bad), actions: [{ label: 'OK' }] });
      go(); if (location.hash.includes('tab=readings')) readings(wb);
    } catch (e) { err(e); }
  };
}

/* ---- billing runs ---- */
async function billing(wb) {
  const period = query().period || thisMonth();
  const [pv, runs] = await Promise.all([GET('/water/billing/preview?period=' + period), GET('/water/billing/runs')]);
  wb.innerHTML = `<div class="card"><div class="row wrap"><label>Bill for <input type="month" id="bp" value="${period}"></label><label>Bill date <input type="date" id="bd" value="${today()}"></label>
      <span class="spacer"></span><b>${pv.bills.length} bills · ${m3(pv.m3)} · ${money(pv.total)}</b>${pv.bills.length ? '<button class="btn btn-primary" id="brun">Make the bills</button>' : ''}</div>
    ${pv.estimated ? `<p class="help-note">${pv.estimated} connections have no reading this month and will get an <b>estimated</b> bill (average of their last months). Take the readings first if you can.</p>` : ''}
    ${tableHtml([{ key: 'account_no', label: 'Account' }, { key: 'customer_name', label: 'Customer' }, { key: 'prev_reading', label: 'Previous', right: 1, fmt: qty }, { key: 'curr_reading', label: 'Current', right: 1, fmt: qty },
      { key: 'consumption', label: 'Used', right: 1, html: 1, fmt: (v, b) => `${m3(v)}${b.estimated ? ' ' + badge('estimated', 'draft') : ''}` }, { key: 'water_amount', label: 'Water', right: 1, fmt: money },
      { key: 'service_amount', label: 'Service', right: 1, fmt: money }, { key: 'sewer_amount', label: 'Sewer', right: 1, fmt: money }, { key: 'total', label: 'Bill incl. VAT', right: 1, fmt: money }],
      pv.bills, { empty: 'Every active postpaid connection already has a bill for this month.' })}</div>
    <div class="card"><h3>Billing runs</h3>${tableHtml([{ key: 'period', label: 'Month' }, { key: 'run_date', label: 'Billed on', fmt: d }, { key: 'due_date', label: 'Due', fmt: d }, { key: 'bills', label: 'Bills', right: 1 },
      { key: 'm3', label: 'Water', right: 1, fmt: m3 }, { key: 'total', label: 'Total', right: 1, fmt: money }, { key: 'user_name', label: 'By' }], runs, { rowAttr: x => `data-run="${x.id}"`, empty: 'No bills made yet.' })}</div>`;
  $('#bp').onchange = e => { location.hash = '#/water?tab=billing&period=' + e.target.value; };
  if ($('#brun')) $('#brun').onclick = async () => {
    if (!(await confirmBox(`Make ${pv.bills.length} water bills for ${period} (${money(pv.total)})? Each becomes a customer invoice.`, { okLabel: 'Make the bills' }))) return;
    try { const r = await POST('/water/billing/run', { period, run_date: $('#bd').value }); toast(`${r.bills} bills made – ${money(r.total)}`); runBills(r.run_id); billing(wb); } catch (e) { err(e); }
  };
  $$('[data-run]', wb).forEach(tr => tr.onclick = () => runBills(Number(tr.dataset.run)));
}
async function runBills(id) {
  const run = await GET('/water/billing/runs/' + id);
  modal({ title: `Water bills ${run.period}`, size: 'lg', body: tableHtml([{ key: 'account_no', label: 'Account' }, { key: 'customer_name', label: 'Customer' }, { key: 'consumption', label: 'Used', right: 1, fmt: m3 },
    { key: 'total', label: 'Total', right: 1, fmt: money }, { key: 'invoice_number', label: 'Invoice', html: 1, fmt: (v, b) => v ? `<a href="#/invoice/${b.invoice_id}">${esc(v)}</a>` : '' }], run.bills),
    actions: [{ label: '🖨 Print all bills', cls: 'btn-primary', onClick: async () => printBills(run) }, { label: 'Close' }] });
}
async function printBills(run) {
  const co = state.company || {};
  const pages = [];
  for (const b of run.bills) {
    const a = await GET('/water/accounts/' + b.account_id);
    const hist = a.bills.slice(0, 6).reverse();
    const max = Math.max(1, ...hist.map(h => Number(h.consumption)));
    pages.push(`<div style="page-break-after:always;font-family:Arial;font-size:13px;max-width:720px;margin:auto">${receiptLogoHtml(co, { maxWidthMm: 40 })}
      <h2 style="margin:4px 0">${esc(co.name || '')}</h2><div>${esc(co.address || '')} ${co.phone ? '· ' + esc(co.phone) : ''}</div><hr>
      <h1 style="font-size:20px">Water bill – ${esc(run.period)}</h1>
      <table style="width:100%"><tr><td><b>${esc(a.customer_name)}</b><br>${esc(a.address || '')}<br>Account <b>${esc(a.account_no)}</b> · Meter ${esc(a.meter_serial || '')}<br>Tariff: ${esc(a.tariff_name)}</td>
        <td style="text-align:right">Invoice ${esc(b.invoice_number || '')}<br>Due ${d(b.due_date)}</td></tr></table>
      <table border="1" cellspacing="0" cellpadding="6" style="width:100%;border-collapse:collapse;margin-top:10px">
        <tr><th>Previous reading</th><th>Current reading</th><th>Used</th><th>Water</th><th>Service</th><th>Sewer</th><th>Total incl. VAT</th></tr>
        <tr><td>${qty(b.prev_reading)}</td><td>${qty(b.curr_reading)}${Number(b.estimated) ? ' (estimated)' : ''}</td><td>${m3(b.consumption)}</td><td>${money(b.water_amount)}</td><td>${money(b.service_amount)}</td><td>${money(b.sewer_amount)}</td><td><b>${money(b.total)}</b></td></tr></table>
      <p><b>Total now owed on this account: ${money(a.arrears)}</b></p>
      <div style="display:flex;gap:8px;align-items:flex-end;height:90px;margin:10px 0">${hist.map(h => `<div style="text-align:center;font-size:10px"><div style="background:#0e7490;width:40px;height:${Math.round(Number(h.consumption) / max * 70)}px"></div>${esc(h.period)}<br>${qty(h.consumption)} m³</div>`).join('')}</div>
      <p style="font-size:11px">Pay at our office, at any till that sells our water, by bank transfer quoting account ${esc(a.account_no)}, or from your customer link. Unpaid bills can lead to disconnection and a reconnection fee.</p></div>`);
  }
  printHtml(pages.join(''));
}

/* ---- prepaid sales ---- */
async function prepaid(wb) {
  const q = query(), from = q.from || today().slice(0, 8) + '01', to = q.to || today();
  const rows = await GET(`/water/vends?from=${from}&to=${to}`);
  const sum = k => rows.filter(r => r.status === 'completed').reduce((t, r) => t + Number(r[k]), 0);
  wb.innerHTML = `<div class="row wrap" style="margin-bottom:10px"><label>From <input type="date" id="vf" value="${from}"></label><label>To <input type="date" id="vt" value="${to}"></label><button class="btn" id="vg">Show</button>
    <span class="spacer"></span><button class="btn btn-primary" id="vnew">💧 Sell water</button></div>
    <div class="cols cols-4" style="margin-bottom:12px"><div class="kpi"><div class="label">Tokens sold</div><div class="value">${rows.length}</div></div><div class="kpi"><div class="label">Money taken</div><div class="value">${money(sum('amount'))}</div></div>
      <div class="kpi"><div class="label">Water sold</div><div class="value">${m3(sum('units_m3'))}</div></div><div class="kpi"><div class="label">Old debt recovered</div><div class="value">${money(sum('debt_recovered'))}</div></div></div>
    <div class="card">${tableHtml([{ key: 'created_at', label: 'When', fmt: dt }, { key: 'number', label: 'Number' }, { key: 'account_no', label: 'Account' }, { key: 'customer_name', label: 'Customer' },
      { key: 'amount', label: 'Paid', right: 1, fmt: money }, { key: 'units_m3', label: 'Water', right: 1, fmt: m3 }, { key: 'debt_recovered', label: 'Debt', right: 1, fmt: v => Number(v) ? money(v) : '' },
      { key: 'token', label: 'Token' }, { key: 'method_name', label: 'Paid by' }, { key: 'user_name', label: 'Cashier' }], rows, { rowAttr: v => `data-v="${v.id}"`, empty: 'No prepaid water sold in these dates.' })}</div>`;
  $('#vg').onclick = () => { location.hash = `#/water?tab=prepaid&from=${$('#vf').value}&to=${$('#vt').value}`; };
  $('#vnew').onclick = () => waterTillDialog(null, () => prepaid(wb));
  $$('[data-v]', wb).forEach(tr => tr.onclick = async () => printToken(await GET('/water/vends/' + tr.dataset.v)));
}

/* ---- field jobs ---- */
async function jobs(wb, reload) {
  const st = query().status || 'open';
  const [rows, kinds] = await Promise.all([GET('/water/jobs?status=' + st), jobKinds()]);
  wb.innerHTML = `<div class="row wrap" style="margin-bottom:10px">${[['open', 'Open'], ['done', 'Done'], ['cancelled', 'Cancelled'], ['all', 'All']].map(([k, l]) => `<a class="btn btn-sm ${k === st ? 'btn-primary' : ''}" href="#/water?tab=jobs&status=${k}">${l}</a>`).join('')}
    <span class="spacer"></span>${can('water') ? '<button class="btn btn-primary" id="jn">＋ Job</button>' : ''}</div>
    <div class="card">${tableHtml([{ key: 'number', label: 'Job' }, { key: 'kind', label: 'What', fmt: v => kinds[v] || v }, { key: 'priority', label: 'Priority', html: 1, fmt: v => v === 'urgent' || v === 'high' ? badge(v, 'cancelled') : esc(v) },
      { key: 'account_no', label: 'Account' }, { key: 'customer_name', label: 'Customer' }, { key: 'location', label: 'Where' }, { key: 'assigned_name', label: 'Assigned to' },
      { key: 'fee', label: 'Fee', right: 1, html: 1, fmt: (v, j) => Number(v) ? `${money(v)} ${j.invoice_status === 'paid' ? badge('paid', 'paid') : badge('unpaid', 'draft')}` : '' },
      { key: 'created_at', label: 'Opened', fmt: d }, { key: 'status', label: 'Status', html: 1, fmt: s => badge(JOB_ST[s][0], JOB_ST[s][1]) }], rows, { rowAttr: j => `data-j="${j.id}"`, empty: 'No jobs here.' })}</div>`;
  if ($('#jn')) $('#jn').onclick = () => jobDialog({}, reload);
  $$('[data-j]', wb).forEach(tr => tr.onclick = () => jobView(rows.find(j => j.id === Number(tr.dataset.j)), reload));
}
export async function jobDialog(pre, done) {
  const [kinds, users, accs] = await Promise.all([jobKinds(), GET('/users').catch(() => []), pre.account_id ? Promise.resolve([]) : GET('/water/accounts')]);
  const f = [{ key: 'kind', label: 'Job', type: 'select', options: Object.entries(kinds).map(([k, l]) => ({ value: k, label: l })), required: true },
    ...(pre.account_id ? [] : [{ key: 'account_id', label: 'Water account (if it is for one customer)', type: 'select', options: [{ value: '', label: '– none (e.g. a burst main) –' }, ...accs.map(a => ({ value: a.id, label: `${a.account_no} – ${a.customer_name}` }))] }]),
    { key: 'priority', label: 'Priority', type: 'select', options: ['normal', 'high', 'urgent', 'low'].map(v => ({ value: v, label: v })) },
    { key: 'assigned_to', label: 'Assign to', type: 'select', options: [{ value: '', label: '– not yet –' }, ...users.filter(u => u.active).map(u => ({ value: u.id, label: `${u.name} (${u.role})` }))] },
    { key: 'location', label: 'Where', span: 2 }, { key: 'description', label: 'What is wrong / what to do', type: 'textarea', span: 2 },
    { key: 'fee', label: 'Fee to charge the customer (empty = the standard fee)', type: 'number', nullable: true }, { key: 'due_date', label: 'Do by', type: 'date' }];
  modal({ title: 'New field job', body: formHtml(f, { kind: pre.kind || 'leak', priority: 'normal' }, { ctx: 'water_job' }), actions: [{ label: 'Cancel' }, { label: 'Open job', cls: 'btn-primary', onClick: async (c, r) => {
    const v = readForm(r, f); if (pre.account_id) v.account_id = pre.account_id; if (v.fee === null) delete v.fee;
    const res = await POST('/water/jobs', v); toast(`Job ${res.number} opened`); c(); done && done();
  } }] });
}
async function jobView(j, done) {
  const kinds = await jobKinds();
  const needsMeter = ['new_connection', 'meter_install', 'meter_replace'].includes(j.kind);
  const prods = (await GET('/products').catch(() => [])).filter(p => p.type === 'stock');
  const f = [...(j.kind === 'meter_replace' ? [{ key: 'old_reading', label: 'Last reading on the OLD meter', type: 'number', required: true }, { key: 'old_meter_faulty', label: 'Old meter is faulty (keep it apart)', type: 'checkbox' },
      { key: 'new_billing', label: 'New meter is', type: 'select', options: [{ value: '', label: 'the same kind as before' }, { value: 'prepaid', label: 'prepaid (customer will buy tokens)' }, { value: 'postpaid', label: 'postpaid (billed monthly)' }] }] : []),
    ...(needsMeter ? [{ key: 'meter_serial', label: 'Meter serial number installed', required: true }, { key: 'reading', label: 'Reading on that meter now', type: 'number' }, { key: 'make', label: 'Make' }, { key: 'size_mm', label: 'Size (mm)', type: 'number' }] : []),
    { key: 'result', label: 'What was done', type: 'textarea', span: 2 }];
  const canDo = !['done', 'cancelled'].includes(j.status);
  modal({ title: `${j.number} – ${kinds[j.kind] || j.kind}`, size: 'lg', body: `<p>${j.account_no ? `Account <a href="#/wateraccount/${j.account_id}">${esc(j.account_no)}</a> – ${esc(j.customer_name || '')} ${j.phone ? '· ' + esc(j.phone) : ''}<br>` : ''}${esc(j.location || '')}</p>
      <p>${esc(j.description || '')}</p>${j.result ? `<p><b>Done:</b> ${esc(j.result)}</p>` : ''}
      ${Number(j.fee) && j.invoice_status !== 'paid' && canDo ? `<p class="help-note">The ${money(j.fee)} fee (invoice ${esc(j.invoice_number || '')}) is not paid yet.</p>` : ''}
      ${canDo ? `${formHtml(f, {}, { ctx: 'water_job' })}<h4>Materials used from the store</h4><div id="mats"></div><button class="btn btn-sm" id="madd">＋ Material</button>` : ''}`,
    onOpen: r => {
      if (!canDo) return;
      const add = () => { const row = document.createElement('div'); row.className = 'row'; row.innerHTML = `<select data-mp><option value="">– choose –</option>${prods.map(p => `<option value="${p.id}">${esc(p.name)} (${qty(p.stock_qty)} ${esc(p.uom || '')})</option>`).join('')}</select><input type="number" step="any" min="0" data-mq placeholder="Qty" style="width:90px">`; r.querySelector('#mats').appendChild(row); };
      r.querySelector('#madd').onclick = add;
    },
    actions: canDo ? [{ label: 'Close' }, ...(can('water') ? [{ label: 'Cancel job', cls: 'btn-danger', onClick: async c => { if (!(await confirmBox('Cancel this job? An unpaid fee is cancelled too.', { danger: true }))) return; await PUT('/water/jobs/' + j.id, { status: 'cancelled' }); c(); done && done(); } }] : []),
      { label: '✔ Mark done', cls: 'btn-primary', onClick: async (c, r) => {
        const v = readForm(r, f);
        v.materials = $$('#mats .row', r).map(x => ({ product_id: Number(x.querySelector('[data-mp]').value), qty: Number(x.querySelector('[data-mq]').value) })).filter(x => x.product_id && x.qty > 0);
        await POST(`/water/jobs/${j.id}/done`, v); toast('Job done'); c(); done && done();
      } }] : [{ label: 'Close' }] });
}

/* ---- disconnections ---- */
async function cutoff(wb, reload) {
  const [x, users, s] = await Promise.all([GET('/water/disconnections'), GET('/users').catch(() => []), GET('/water/settings')]);
  wb.innerHTML = `<div class="card"><h3>Due for disconnection</h3><p class="muted">Postpaid connections owing at least ${money(s.settings.disconnect_min_amount)} on bills more than ${s.settings.disconnect_after_days} days late (change this in Settings). Send a reminder first; tick and make disconnection jobs for the rest.</p>
    ${x.due.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th><input type="checkbox" id="call"></th><th>Account</th><th>Customer</th><th>Phone</th><th>Zone</th><th class="r">Owes</th><th class="r">Days late</th><th></th></tr></thead><tbody>
      ${x.due.map(a => `<tr><td><input type="checkbox" data-c="${a.id}"></td><td><a href="#/wateraccount/${a.id}">${esc(a.account_no)}</a></td><td>${esc(a.customer_name)}</td><td>${esc(a.phone || '')}</td><td>${esc(a.zone_name || '')}</td>
        <td class="r"><b class="neg">${money(a.arrears)}</b></td><td class="r">${a.days_overdue}</td><td><button class="btn btn-sm" data-rem="${a.id}">📱 Remind</button></td></tr>`).join('')}</tbody></table></div>
      <div class="row" style="margin-top:10px"><select id="cto"><option value="">– assign to –</option>${users.filter(u => u.active).map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select><button class="btn btn-danger" id="cgo">✂ Make disconnection jobs</button></div>` : '<div class="empty">Nobody is due for disconnection. 🎉</div>'}</div>
    <div class="card"><h3>Paid up – ready to reconnect</h3>${tableHtml([{ key: 'account_no', label: 'Account' }, { key: 'customer_name', label: 'Customer' }, { key: 'phone', label: 'Phone' },
      { key: 'id', label: '', html: 1, fmt: v => `<button class="btn btn-sm btn-ok" data-rc="${v}">Reconnect</button>` }], x.ready_to_reconnect, { empty: 'Nobody waiting.' })}</div>`;
  if ($('#call')) $('#call').onchange = e => $$('[data-c]', wb).forEach(c => { c.checked = e.target.checked; });
  $$('[data-rem]', wb).forEach(b => b.onclick = async () => { const a = x.due.find(y => y.id === Number(b.dataset.rem)); remindOne(a.partner_id, 'water', a.phone); });
  if ($('#cgo')) $('#cgo').onclick = async () => {
    const ids = $$('[data-c]', wb).filter(c => c.checked).map(c => Number(c.dataset.c));
    if (!ids.length) return toast('Tick the accounts first', 'err');
    try { const r = await POST('/water/disconnections', { account_ids: ids, assigned_to: $('#cto').value }); toast(`${r.jobs.length} disconnection jobs made`); reload(); } catch (e) { err(e); }
  };
  $$('[data-rc]', wb).forEach(b => b.onclick = () => jobDialog({ kind: 'reconnection', account_id: Number(b.dataset.rc) }, reload));
}

/* ---- tariffs ---- */
const CAT_LABEL = { domestic: 'Domestic', commercial: 'Business / industry', industrial: 'Industrial', institutional: 'Institutional', government: 'Government', school: 'Schools', church: 'Churches', standpipe: 'Standpipes', other: 'Other' };
const SEWER_LABEL = { none: 'Not on the sewer', waterborne: 'Waterborne sewer', non_waterborne: 'Non-waterborne (conservancy / VIP)' };
/** the same charges as the server (water.js charges()): stepped water, standing charge free within the first band, sewerage */
function tariffCharges(t, sewerType, m) {
  let water = 0, lo = 0;
  for (const b of t.blocks) { const hi = b.upto === null ? Infinity : Number(b.upto); const take = Math.max(0, Math.min(m, hi) - lo); water += take * Number(b.price || 0); lo = hi; if (hi >= m) break; }
  const free = t.service_free_upto === null || t.service_free_upto === '' || t.service_free_upto === undefined ? null : Number(t.service_free_upto);
  const service = free !== null && m <= free ? 0 : Number(t.service_charge || 0);
  const share = sewerType === 'waterborne' ? Number(t.sewer_wb_pct || 0) : sewerType === 'non_waterborne' ? Number(t.sewer_nwb_pct || 0) : 0;
  const sewer = water * Number(t.sewer_pct || 0) / 100 + m * share / 100 * Number(t.sewer_rate || 0);
  const net = water + service + sewer, vat = net * Number(t.tax_rate || 0) / 100;
  return { water, service, sewer, net, vat, total: net + vat };
}
async function tariffs(wb, reload) {
  const rows = await GET('/water/tariffs');
  const blocksTxt = bl => bl.map((b, i) => `${i ? bl[i - 1].upto : 0}${b.upto === null ? '+' : '–' + b.upto} m³: ${money(b.price)}`).join(' · ');
  wb.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="muted">Prices are per m³ (= per kilolitre), excl. VAT.</span><span class="spacer"></span><button class="btn" id="twasco">⬇ Load WASCO tariffs</button><button class="btn btn-primary" id="tn">＋ Tariff</button></div>
    <div class="card">${tableHtml([{ key: 'name', label: 'Tariff' }, { key: 'category', label: 'For', fmt: v => CAT_LABEL[v] || v }, { key: 'blocks', label: 'Price per m³ (excl. VAT, per month)', fmt: blocksTxt },
      { key: 'service_charge', label: 'Standing charge / month', right: 1, fmt: (v, t) => `${money(v)}${t.service_free_upto !== null && t.service_free_upto !== undefined ? ` (free up to ${qty(t.service_free_upto)} m³)` : ''}` },
      { key: 'sewer_rate', label: 'Sewerage', right: 1, fmt: (v, t) => [Number(v) ? `${money(v)}/m³ on ${qty(t.sewer_wb_pct)}% / ${qty(t.sewer_nwb_pct)}%` : '', Number(t.sewer_pct) ? t.sewer_pct + '% of water' : ''].filter(Boolean).join(' + ') },
      { key: 'min_m3', label: 'Minimum', right: 1, fmt: v => Number(v) ? m3(v) : '' },
      { key: 'tax_rate', label: 'VAT', right: 1, fmt: v => v + '%' }, { key: 'accounts', label: 'Connections', right: 1 }, { key: 'active', label: '', html: 1, fmt: v => v ? '' : badge('off', 'closed') }], rows,
      { rowAttr: t => `data-t="${t.id}"`, empty: 'No tariffs yet – load the WASCO tariffs, or add one for each kind of customer (domestic, business, standpipe…).' })}</div>`;
  $('#tn').onclick = () => tariffDialog(null, reload);
  $('#twasco').onclick = () => {
    const f = [{ key: 'tax_rate', label: 'VAT % on water', type: 'number' }, { key: 'effective_from', label: 'Prices apply from', type: 'date' }];
    modal({ title: 'Load the WASCO tariffs', body: `<p>Adds six tariffs with the WASCO prices approved by LEWA (or updates their prices if you loaded them before):</p>
      <ul><li><b>Domestic</b>: Band A 0–5 kl M6.11 · B >5–10 kl M10.39 · C >10–15 kl M18.29 · D >15 kl M25.24; standing charge M49.82 (none while use stays in band A)</li>
      <li><b>Industry & business</b> (incl. hotels, construction): M16.64/kl + M479.17 standing</li><li><b>Government</b>: M16.64/kl + M331.73</li><li><b>Schools</b>: M16.49/kl + M331.73</li>
      <li><b>Churches</b>: M16.49/kl + M239.64</li><li><b>Standpipes</b>: M8.29/kl, no standing charge</li>
      <li><b>Sewerage</b> on every tariff: M9.85/kl on 85% of the water used (waterborne) or 65% (non-waterborne) – choose the sewer type on each connection.</li></ul>
      <p class="help-note">VAT: the standard rate in Lesotho is 15%. Confirm with RSL how your water sales are treated; you can change the VAT % on each tariff later. LEWA reviews these prices – check them each year.</p>${formHtml(f, { tax_rate: 15, effective_from: today() })}`,
      actions: [{ label: 'Cancel' }, { label: 'Load tariffs', cls: 'btn-primary', onClick: async (c, r) => { const x = await POST('/water/tariffs/preset/wasco', readForm(r, f)); toast(`${x.tariffs.length} WASCO tariffs loaded`); c(); reload(); } }] });
  };
  $$('[data-t]', wb).forEach(tr => tr.onclick = () => tariffDialog(rows.find(t => t.id === Number(tr.dataset.t)), reload));
}
function tariffDialog(t, done) {
  const f = [{ key: 'name', label: 'Name', required: true }, { key: 'category', label: 'For', type: 'select', options: Object.entries(CAT_LABEL).map(([value, label]) => ({ value, label })) },
    { type: 'heading', label: 'Standing charge' }, { key: 'service_charge', label: 'Standing (fixed) charge per month (excl. VAT)', type: 'number' },
    { key: 'service_free_upto', label: 'No standing charge while use stays at or below … m³ (empty = always charged)', type: 'number', nullable: true },
    { type: 'heading', label: 'Sewerage' }, { key: 'sewer_rate', label: 'Sewerage per m³ (excl. VAT)', type: 'number' },
    { key: 'sewer_wb_pct', label: 'Waterborne: % of water used that is charged', type: 'number' }, { key: 'sewer_nwb_pct', label: 'Non-waterborne: % of water used that is charged', type: 'number' },
    { key: 'sewer_pct', label: 'Or: sewerage as a % of the water charge', type: 'number' },
    { type: 'heading', label: 'Other' }, { key: 'min_m3', label: 'Minimum m³ billed per month (postpaid)', type: 'number' }, { key: 'tax_rate', label: 'VAT %', type: 'number' },
    { key: 'effective_from', label: 'Prices apply from', type: 'date' }, { key: 'notes', label: 'Notes', span: 2 }, { key: 'active', label: 'In use', type: 'checkbox' }];
  const bl = t ? t.blocks : [{ upto: 5, price: '' }, { upto: 10, price: '' }, { upto: 15, price: '' }, { upto: null, price: '' }];
  const row = b => `<div class="row" data-blk><label>up to <input type="number" step="any" data-up value="${b.upto === null ? '' : b.upto}" placeholder="and above" style="width:110px"> m³</label><label>price per m³ <input type="number" step="any" data-pr value="${b.price}" style="width:110px"></label></div>`;
  modal({ title: t ? t.name : 'New tariff', size: 'lg', body: `${formHtml(f, t || { category: 'domestic', tax_rate: 15, sewer_wb_pct: 85, sewer_nwb_pct: 65, service_free_upto: null, active: 1 }, { ctx: 'water_tariff' })}
      <h4>Price bands (stepped tariff, counted from the start of each month)</h4><p class="muted">The first band is usually the cheap "lifeline" water. Leave "up to" empty on the last band.</p>
      <div id="blks">${bl.map(row).join('')}</div><button class="btn btn-sm" id="badd">＋ Band</button>
      <div class="row wrap" style="margin-top:10px"><label>Try: <input type="number" id="tm" value="12" style="width:80px"> m³</label><select id="ts">${Object.entries(SEWER_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><span id="tcalc" class="muted"></span></div>`,
    onOpen: r => {
      r.querySelector('#badd').onclick = () => r.querySelector('#blks').insertAdjacentHTML('beforeend', row({ upto: null, price: '' }));
      const calc = () => {
        const blocks = $$('[data-blk]', r).map(x => ({ upto: x.querySelector('[data-up]').value === '' ? null : Number(x.querySelector('[data-up]').value), price: Number(x.querySelector('[data-pr]').value) || 0 }));
        const x = tariffCharges({ ...readForm(r, f), blocks }, r.querySelector('#ts').value, Number(r.querySelector('#tm').value) || 0);
        r.querySelector('#tcalc').textContent = `water ${money(x.water)} + standing ${money(x.service)} + sewer ${money(x.sewer)} + VAT ${money(x.vat)} = ${money(x.total)} incl. VAT`;
      };
      r.addEventListener('input', () => { try { calc(); } catch (_) {} }); r.addEventListener('change', () => { try { calc(); } catch (_) {} }); try { calc(); } catch (_) {}
    },
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => {
      const v = readForm(r, f);
      v.blocks = $$('[data-blk]', r).map(x => ({ upto: x.querySelector('[data-up]').value === '' ? null : Number(x.querySelector('[data-up]').value), price: x.querySelector('[data-pr]').value })).filter(b => b.price !== '');
      if (t) await PUT('/water/tariffs/' + t.id, v); else await POST('/water/tariffs', v);
      toast('Tariff saved'); c(); done && done();
    } }] });
}

/* ---- zones & non-revenue water ---- */
async function zones(wb, reload) {
  const period = query().period || thisMonth();
  const [zs, n, users] = await Promise.all([GET('/water/zones'), GET('/water/nrw?period=' + period), GET('/users').catch(() => [])]);
  wb.innerHTML = `<div class="row" style="margin-bottom:10px"><label>Month <input type="month" id="zp" value="${period}"></label><span class="spacer"></span><button class="btn btn-primary" id="zn">＋ Zone</button></div>
    <div class="card"><h3>Water loss (non-revenue water)</h3><p class="muted">Type what each zone's bulk meter supplied this month. The difference with what was billed and sold is water lost to leaks, illegal connections and meter errors.</p>
    ${tableHtml([{ key: 'zone', label: 'Zone' }, { key: 'bulk_meter_no', label: 'Bulk meter' }, { key: 'supplied', label: 'Supplied', right: 1, html: 1, fmt: (v, z) => `<input type="number" step="any" data-bulk="${z.zone_id}" value="${v === null ? '' : v}" style="width:110px"> m³` },
      { key: 'billed_m3', label: 'Billed', right: 1, fmt: m3 }, { key: 'prepaid_m3', label: 'Prepaid sold', right: 1, fmt: m3 }, { key: 'lost', label: 'Lost', right: 1, fmt: m3 },
      { key: 'loss_pct', label: 'Loss %', right: 1, html: 1, fmt: v => v === null ? '' : `<b class="${v > 25 ? 'neg' : ''}">${v}%</b>` }], n.zones, { empty: 'Add zones first.' })}
    ${n.zones.length ? '<div class="row" style="margin-top:8px"><span class="spacer"></span><button class="btn" id="zsave">Save bulk readings</button></div>' : ''}</div>
    <div class="card"><h3>Zones & reading routes</h3>${tableHtml([{ key: 'name', label: 'Zone' }, { key: 'code', label: 'Code' }, { key: 'bulk_meter_no', label: 'Bulk meter' }, { key: 'reader_name', label: 'Meter reader' },
      { key: 'accounts', label: 'Connections', right: 1 }, { key: 'active', label: '', html: 1, fmt: v => v ? '' : badge('off', 'closed') }], zs, { rowAttr: z => `data-z="${z.id}"`, empty: 'No zones yet.' })}</div>`;
  $('#zp').onchange = e => { location.hash = '#/water?tab=zones&period=' + e.target.value; };
  const dlg = z => {
    const f = [{ key: 'name', label: 'Zone / area', required: true }, { key: 'code', label: 'Code' }, { key: 'bulk_meter_no', label: 'Bulk (zone) meter number' },
      { key: 'reader_id', label: 'Meter reader', type: 'select', options: [{ value: '', label: '–' }, ...users.filter(u => u.active).map(u => ({ value: u.id, label: `${u.name} (${u.role})` }))] }, { key: 'notes', label: 'Notes', span: 2 }, { key: 'active', label: 'In use', type: 'checkbox' }];
    modal({ title: z ? z.name : 'New zone', body: formHtml(f, z || { active: 1 }, { ctx: 'water_zone' }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => {
      const v = readForm(r, f); if (z) await PUT('/water/zones/' + z.id, v); else await POST('/water/zones', v); c(); reload();
    } }] });
  };
  $('#zn').onclick = () => dlg(null);
  $$('[data-z]', wb).forEach(tr => tr.onclick = () => dlg(zs.find(z => z.id === Number(tr.dataset.z))));
  if ($('#zsave')) $('#zsave').onclick = async () => {
    try { for (const i of $$('[data-bulk]', wb)) if (i.value !== '') await PUT(`/water/zones/${i.dataset.bulk}/bulk`, { period, bulk_m3: Number(i.value) }); toast('Saved'); reload(); } catch (e) { err(e); }
  };
}

/* ---- meters in store ---- */
async function meters(wb, reload) {
  const st = query().status || '';
  const rows = await GET('/water/meters' + (st ? '?status=' + st : ''));
  wb.innerHTML = `<div class="row wrap" style="margin-bottom:10px">${[['', 'All'], ['in_store', 'In store'], ['installed', 'Installed'], ['faulty', 'Faulty'], ['removed', 'Removed']].map(([k, l]) => `<a class="btn btn-sm ${k === st ? 'btn-primary' : ''}" href="#/water?tab=meters&status=${k}">${l}</a>`).join('')}
    <span class="spacer"></span><button class="btn btn-primary" id="mn">＋ Meters into store</button></div>
    <div class="card">${tableHtml([{ key: 'serial', label: 'Serial' }, { key: 'kind', label: 'Type' }, { key: 'make', label: 'Make' }, { key: 'size_mm', label: 'Size', fmt: v => v ? v + ' mm' : '' },
      { key: 'status', label: 'Status', fmt: v => v.replace('_', ' ') }, { key: 'account_no', label: 'Account' }, { key: 'customer_name', label: 'Customer' }, { key: 'install_date', label: 'Installed', fmt: d }], rows, { empty: 'No meters.' })}</div>`;
  $('#mn').onclick = () => {
    const f = [{ key: 'serials', label: 'Serial numbers (one per line, or scan them)', type: 'textarea', rows: 6, span: 2, required: true }, { key: 'kind', label: 'Type', type: 'select', options: [{ value: 'postpaid', label: 'Postpaid (normal) meter' }, { value: 'prepaid', label: 'Prepaid (token) meter' }] },
      { key: 'make', label: 'Make' }, { key: 'size_mm', label: 'Size (mm)', type: 'number' }];
    modal({ title: 'Meters into store', body: formHtml(f, { kind: 'postpaid', size_mm: 15 }), actions: [{ label: 'Cancel' }, { label: 'Add', cls: 'btn-primary', onClick: async (c, r) => { const x = await POST('/water/meters', readForm(r, f)); toast(`${x.added} meters added${x.skipped ? `, ${x.skipped} already known` : ''}`); c(); reload(); } }] });
  };
}

/* ---- settings ---- */
async function settings(wb) {
  const s = await GET('/water/settings'), v = s.settings;
  const f = [{ type: 'heading', label: 'Postpaid billing' }, { key: 'due_days', label: 'Days to pay a bill', type: 'number' }, { key: 'estimate_months', label: 'Months averaged for an estimated bill', type: 'number' },
    { key: 'high_use_factor', label: 'Flag a reading as very high when it is more than … × the usual', type: 'number' },
    { type: 'heading', label: 'Prepaid tokens' }, { key: 'token_provider', label: 'Tokens come from', type: 'select', options: [{ value: 'sandbox', label: 'Sandbox – TEST tokens for training' }, { value: 'plugin', label: 'Our STS vending server (plugin)' }, { value: 'none', label: 'No token – credit is loaded from the meter supplier\'s system' }] },
    { key: 'token_plugin_id', label: 'Token plugin', type: 'select', options: [{ value: '', label: '–' }, ...s.token_plugins.map(p => ({ value: p.id, label: p.name }))] },
    { key: 'debt_recovery_pct', label: 'Old debt taken from each purchase (%)', type: 'number' }, { key: 'min_vend', label: 'Smallest purchase', type: 'number' }, { key: 'max_vend', label: 'Largest purchase', type: 'number' },
    { type: 'heading', label: 'Connections and fees' }, { key: 'account_prefix', label: 'Account number starts with' }, { key: 'connection_fee', label: 'New connection fee (incl. VAT)', type: 'number' },
    { key: 'reconnection_fee', label: 'Reconnection fee (incl. VAT)', type: 'number' }, { key: 'deposit_postpaid', label: 'Usual deposit for a postpaid connection', type: 'number' },
    { key: 'disconnect_after_days', label: 'Disconnect when a bill is this many days late', type: 'number' }, { key: 'disconnect_min_amount', label: '… and the customer owes at least', type: 'number' }];
  wb.innerHTML = `<div class="card">${formHtml(f, v, { ctx: 'water_settings' })}<div class="row" style="margin-top:10px"><span class="spacer"></span>${can('settings') ? '<button class="btn btn-primary" id="ssave">Save</button>' : '<span class="muted">Only an administrator can change these.</span>'}</div></div>`;
  if ($('#ssave')) $('#ssave').onclick = async () => { try { await PUT('/water/settings', readForm(wb, f)); toast('Saved'); } catch (e) { err(e); } };
}

/* ===================== one connection ===================== */
export async function waterAccount(view, [idq]) {
  const id = Number((idq || '').split('?')[0]);
  const a = await GET('/water/accounts/' + id);
  const office = can('water');
  view.innerHTML = page(`💧 ${a.account_no} – ${a.customer_name}`, `<a class="btn" href="#/water?tab=accounts">← Connections</a>
      ${office ? `${can('legal') ? docButton('water_connection', a.id) : ''}<button class="btn" id="aed">Edit</button><button class="btn" id="ajob">＋ Job</button>` : ''}${a.billing === 'prepaid' && a.status === 'active' && (can('water') || can('water.vend')) ? '<button class="btn btn-primary" id="avend">💧 Sell water</button>' : ''}
      ${a.billing === 'postpaid' && a.arrears > 0 && (can('water') || can('water.vend')) ? '<button class="btn btn-primary" id="apay">Take payment</button>' : ''}`,
    `<div class="cols cols-4" style="margin-bottom:12px">
      <div class="kpi"><div class="label">Status</div><div class="value">${stBadge(a.status)} ${billBadge(a.billing)}</div><div class="hint">${esc(a.tariff_name)} · ${esc(a.zone_name || 'no zone')} · ${esc((SEWER_LABEL[a.sewer_type] || '').toLowerCase())}</div></div>
      <div class="kpi"><div class="label">Meter</div><div class="value">${esc(a.meter_serial || '—')}</div><div class="hint">${a.last_reading !== null ? `last reading ${qty(a.last_reading)} on ${d(a.last_reading_date)}` : 'no reading yet'}</div></div>
      <div class="kpi"><div class="label">Owes on water bills</div><div class="value" style="color:${a.arrears > 0 ? 'var(--bad)' : 'var(--ok)'}">${money(a.arrears)}</div><div class="hint">deposit held ${money(a.deposit_held)}</div></div>
      <div class="kpi"><div class="label">${a.billing === 'prepaid' ? 'Bought this month' : 'Last bill'}</div><div class="value">${a.billing === 'prepaid' ? m3(a.month_m3) : a.bills[0] ? m3(a.bills[0].consumption) : '—'}</div><div class="hint">${a.billing === 'prepaid' ? '' : a.bills[0] ? `${esc(a.bills[0].period)} · ${money(a.bills[0].total)}` : ''}</div></div></div>
    <div class="cols cols-2">
      <div class="card"><h3>Customer & connection</h3><p><a href="#/customer/${a.partner_id}"><b>${esc(a.customer_name)}</b></a> ${a.phone ? '· ' + esc(a.phone) : ''} ${a.email ? '· ' + esc(a.email) : ''}<br>
        ${esc(a.address || '')}${a.plot_no ? ' · plot ' + esc(a.plot_no) : ''}${a.gps ? ` · <a href="https://maps.google.com/?q=${encodeURIComponent(a.gps)}" target="_blank">map</a>` : ''}<br>Connected ${d(a.connection_date) || '—'} · route #${a.route_seq || '—'}</p>
        ${a.status === 'pending' ? '<p class="help-note">Not connected yet. Open a "New connection" job; when the plumber finishes it with the meter number, the connection becomes active.</p>' : ''}
        ${office ? `<div class="row wrap">${a.status !== 'closed' ? '<button class="btn btn-sm" id="adep">Take deposit</button>' : ''}${a.status === 'active' ? '<button class="btn btn-sm" id="aread">Add reading</button>' : ''}
          ${a.status === 'active' ? '<button class="btn btn-sm btn-danger" id="acut">Disconnect</button>' : ''}${a.status === 'disconnected' ? '<button class="btn btn-sm btn-ok" id="arec">Reconnect</button>' : ''}
          ${a.status !== 'closed' ? '<button class="btn btn-sm" id="aclose">Close account</button>' : ''}<button class="btn btn-sm" id="arem">📱 Remind</button></div>` : a.status === 'active' ? '<button class="btn btn-sm" id="aread">Add reading</button>' : ''}</div>
      <div class="card"><h3>Use per month</h3><div id="chart"></div></div></div>
    ${a.billing === 'prepaid' ? `<div class="card"><h3>Prepaid purchases</h3>${tableHtml([{ key: 'created_at', label: 'When', fmt: dt }, { key: 'number', label: 'Number' }, { key: 'amount', label: 'Paid', right: 1, fmt: money },
      { key: 'debt_recovered', label: 'To old debt', right: 1, fmt: v => Number(v) ? money(v) : '' }, { key: 'service_recovered', label: 'Service charge', right: 1, fmt: v => Number(v) ? money(v) : '' },
      { key: 'units_m3', label: 'Water', right: 1, fmt: m3 }, { key: 'token', label: 'Token' }, { key: 'user_name', label: 'By' }], a.vends, { rowAttr: v => `data-v="${v.id}"`, empty: 'No purchases yet.' })}</div>` : ''}
    <div class="card"><h3>Bills and payments</h3>${tableHtml([{ key: 'number', label: 'Invoice', html: 1, fmt: (v, i) => `<a href="#/invoice/${i.id}">${esc(v)}</a>` }, { key: 'invoice_date', label: 'Date', fmt: d }, { key: 'due_date', label: 'Due', fmt: d },
      { key: 'notes', label: 'For' }, { key: 'total', label: 'Total', right: 1, fmt: money }, { key: 'open', label: 'Still owed', right: 1, fmt: money }, { key: 'days', label: 'Days late', right: 1, fmt: v => v > 0 ? v : '' }], a.balance.invoices, { empty: 'Nothing owed. 🎉' })}
      ${a.bills.length ? `<h4>Monthly bills</h4>${tableHtml([{ key: 'period', label: 'Month' }, { key: 'prev_reading', label: 'From', right: 1, fmt: qty }, { key: 'curr_reading', label: 'To', right: 1, fmt: qty },
        { key: 'consumption', label: 'Used', right: 1, html: 1, fmt: (v, b) => `${m3(v)}${Number(b.estimated) ? ' ' + badge('estimated', 'draft') : ''}` }, { key: 'total', label: 'Bill', right: 1, fmt: money }, { key: 'invoice_number', label: 'Invoice' }], a.bills)}` : ''}</div>
    <div class="cols cols-2"><div class="card"><h3>Meter readings</h3>${tableHtml([{ key: 'reading_date', label: 'Date', fmt: d }, { key: 'meter_serial', label: 'Meter' }, { key: 'reading', label: 'Reading', right: 1, fmt: qty },
      { key: 'consumption', label: 'Used', right: 1, fmt: m3 }, { key: 'kind', label: 'Kind' }, { key: 'flag', label: '', html: 1, fmt: flagBadge }, { key: 'user_name', label: 'By' }], a.readings, { empty: 'No readings.' })}</div>
    <div class="card"><h3>Field jobs</h3>${tableHtml([{ key: 'number', label: 'Job' }, { key: 'kind', label: 'What', fmt: v => (KINDS || {})[v] || v.replace('_', ' ') }, { key: 'status', label: 'Status', html: 1, fmt: s => badge(JOB_ST[s][0], JOB_ST[s][1]) },
      { key: 'assigned_name', label: 'Who' }, { key: 'created_at', label: 'Opened', fmt: d }], a.jobs, { rowAttr: j => `data-j="${j.id}"`, empty: 'No jobs.' })}</div></div>`);
  const reload = () => waterAccount(view, [String(id)]);
  // usage chart: postpaid bills or prepaid purchases per month
  const per = {};
  if (a.billing === 'prepaid') a.vends.filter(v => v.status === 'completed').forEach(v => { const k = String(v.created_at).slice(0, 7); per[k] = (per[k] || 0) + Number(v.units_m3); });
  else a.bills.forEach(b => { per[b.period] = Number(b.consumption); });
  const ks = Object.keys(per).sort().slice(-12), mx = Math.max(1, ...ks.map(k => per[k]));
  $('#chart').innerHTML = ks.length ? `<div style="display:flex;gap:6px;align-items:flex-end;height:140px">${ks.map(k => `<div style="flex:1;text-align:center;font-size:11px"><div title="${qty(per[k])} m³" style="background:var(--primary,#0e7490);height:${Math.max(2, Math.round(per[k] / mx * 110))}px;border-radius:4px 4px 0 0"></div>${k.slice(2)}<br><b>${qty(per[k])}</b></div>`).join('')}</div>` : '<div class="empty">No use recorded yet.</div>';
  if ($('#aed')) $('#aed').onclick = () => accountDialog(a, reload);
  if ($('#ajob')) $('#ajob').onclick = () => jobDialog({ account_id: a.id, kind: a.status === 'pending' ? 'new_connection' : 'leak' }, reload);
  if ($('#avend')) $('#avend').onclick = () => waterTillDialog(null, reload, a);
  if ($('#apay')) $('#apay').onclick = () => waterTillDialog(null, reload, a);
  if ($('#adep')) $('#adep').onclick = async () => {
    const ms = await methods(), s = (await GET('/water/settings')).settings;
    const f = [{ key: 'amount', label: 'Deposit', type: 'number', required: true }, { key: 'method_id', label: 'Paid by', type: 'select', options: ms.map(m => ({ value: m.id, label: m.name })) }, { key: 'reference', label: 'Reference' }];
    modal({ title: 'Take a deposit', body: formHtml(f, { amount: s.deposit_postpaid || '' }, { ctx: 'water_account' }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/water/accounts/${a.id}/deposit`, readForm(r, f)); toast('Deposit recorded'); c(); reload(); } }] });
  };
  if ($('#aread')) $('#aread').onclick = () => {
    const f = [{ key: 'reading', label: 'Reading on the meter', type: 'number', required: true }, { key: 'reading_date', label: 'Date', type: 'date' },
      { key: 'kind', label: 'Who read it', type: 'select', options: [{ value: 'actual', label: 'Our meter reader' }, { value: 'customer', label: 'The customer (photo / SMS)' }] }, { key: 'rollover', label: 'Only if the meter went round: its highest number (e.g. 99999)', type: 'number', nullable: true }, { key: 'notes', label: 'Notes', span: 2 }];
    modal({ title: 'Add a reading', body: formHtml(f, { reading_date: today() }, { ctx: 'water_reading' }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => {
      const res = await POST('/water/readings', { ...readForm(r, f), account_id: a.id }); toast(`Saved – ${m3(res.consumption)} used${res.flag ? ' (please check: ' + (FLAG[res.flag] || [res.flag])[0] + ')' : ''}`, res.flag ? 'err' : 'ok', 6000); c(); reload();
    } }] });
  };
  if ($('#acut')) $('#acut').onclick = () => jobDialog({ account_id: a.id, kind: 'disconnection' }, reload);
  if ($('#arec')) $('#arec').onclick = () => jobDialog({ account_id: a.id, kind: 'reconnection' }, reload);
  if ($('#arem')) $('#arem').onclick = () => remindOne(a.partner_id, 'water', a.phone);
  if ($('#aclose')) $('#aclose').onclick = async () => {
    const ms = await methods();
    const f = [...(a.billing === 'postpaid' && a.meter_id ? [{ key: 'final_reading', label: 'Final meter reading', type: 'number', required: true }] : []),
      ...(Number(a.deposit_held) > 0 ? [{ key: 'refund_method_id', label: 'Refund what is left of the deposit by', type: 'select', options: ms.map(m => ({ value: m.id, label: m.name })) }] : [])];
    modal({ title: `Close ${a.account_no}`, body: `<p>The final bill is made, the deposit (${money(a.deposit_held)}) pays what is owed and the rest is refunded, and the meter is marked removed.</p>${formHtml(f, {})}`,
      actions: [{ label: 'Cancel' }, { label: 'Close account', cls: 'btn-danger', onClick: async (c, r) => { const x = await POST(`/water/accounts/${a.id}/close`, readForm(r, f)); toast(`Closed – deposit used ${money(x.deposit_applied)}, refunded ${money(x.deposit_refunded)}`); c(); reload(); } }] });
  };
  $$('[data-v]').forEach(tr => tr.onclick = async () => printToken(await GET('/water/vends/' + tr.dataset.v)));
  $$('[data-j]').forEach(tr => tr.onclick = async () => { const list = await GET('/water/jobs?status=all'); const j = list.find(x => x.id === Number(tr.dataset.j)); if (j) jobView(j, reload); });
}

async function accountDialog(a, done) {
  const [ts, zs, cs, s] = await Promise.all([GET('/water/tariffs'), GET('/water/zones'), GET('/partners?is_customer=1'), GET('/water/settings')]);
  const f = [...(a ? [] : [{ type: 'heading', label: 'Customer' }, { key: 'partner_id', label: 'Existing customer', type: 'select', options: [{ value: '', label: '– a new customer –' }, ...cs.map(c => ({ value: c.id, label: `${c.name}${c.phone ? ' · ' + c.phone : ''}` }))] },
      { key: 'customer_name', label: 'or new customer name' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }]),
    { type: 'heading', label: 'Connection' }, { key: 'billing', label: 'Billing', type: 'select', options: [{ value: 'postpaid', label: 'Postpaid – meter read and billed monthly' }, { value: 'prepaid', label: 'Prepaid – customer buys tokens' }] },
    { key: 'tariff_id', label: 'Tariff', type: 'select', required: true, options: ts.filter(t => t.active).map(t => ({ value: t.id, label: `${t.name} (${CAT_LABEL[t.category] || t.category})` })) },
    { key: 'sewer_type', label: 'Sewer connection', type: 'select', options: Object.entries(SEWER_LABEL).map(([value, label]) => ({ value, label })) },
    { key: 'zone_id', label: 'Zone / reading route', type: 'select', options: [{ value: '', label: '–' }, ...zs.filter(z => z.active).map(z => ({ value: z.id, label: z.name }))] }, { key: 'route_seq', label: 'Order on the reading route', type: 'number' },
    { key: 'address', label: 'Address / village', span: 2 }, { key: 'plot_no', label: 'Plot / site number' }, { key: 'gps', label: 'GPS (lat,long)' },
    { key: 'debt_recovery_pct', label: 'Prepaid: % of each purchase that pays old debt (empty = standard)', type: 'number', nullable: true },
    ...(a ? [] : [{ type: 'heading', label: 'Meter already on site? (moving in from another system)' }, { key: 'account_no', label: 'Existing account number (empty = new number)' }, { key: 'meter_serial', label: 'Meter serial' },
      { key: 'initial_reading', label: 'Reading now', type: 'number' }, { key: 'connection_date', label: 'Connected on', type: 'date' }]),
    { key: 'notes', label: 'Notes', span: 2 }];
  if (!ts.filter(t => t.active).length) return toast('Add a tariff first (Water utility → Tariffs)', 'err', 6000);
  modal({ title: a ? `Edit ${a.account_no}` : 'New water connection', size: 'lg', body: formHtml(f, a || { billing: 'postpaid', sewer_type: 'none', debt_recovery_pct: null }, { ctx: 'water_account' }),
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => {
      const v = readForm(r, f);
      const res = a ? await PUT('/water/accounts/' + a.id, v) : await POST('/water/accounts', v);
      toast('Saved'); c();
      if (!a && !v.meter_serial && (await confirmBox('Open a "New connection" job for the plumber now?' + (Number(s.settings.connection_fee) ? ` The connection fee (${money(s.settings.connection_fee)}) will be invoiced.` : ''), { okLabel: 'Open the job' })))
        await POST('/water/jobs', { kind: 'new_connection', account_id: res.id }).then(j => toast(`Job ${j.number} opened`)).catch(err);
      done && done(res.id);
    } }] });
}

/* ===================== till / counter: sell prepaid water or take a bill payment ===================== */
export async function waterTillDialog(sessionId, done, preset) {
  const ms = await methods();
  const body = `<div class="row"><input id="wl" placeholder="Account number or meter serial" value="${esc(preset ? preset.account_no : '')}" style="flex:1"><button class="btn" id="wfind">Find</button></div>
    <div id="wacc" style="margin:10px 0"></div><div id="wform"></div>`;
  let acc = null;
  const close = modal({ title: '💧 Water', size: 'lg', body, onOpen: r => {
    const find = async () => {
      const lk = r.querySelector('#wl').value.trim(); if (!lk) return;
      try {
        const list = await GET('/water/accounts?q=' + encodeURIComponent(lk));
        const hit = list.find(x => x.account_no === lk || x.meter_serial === lk) || (list.length === 1 ? list[0] : null);
        if (!hit) { r.querySelector('#wacc').innerHTML = list.length ? `<div class="help-note">Several found – choose:</div>${list.slice(0, 8).map(x => `<button class="btn btn-sm" data-pick="${esc(x.account_no)}">${esc(x.account_no)} – ${esc(x.customer_name)}</button>`).join(' ')}` : '<div class="empty">Not found.</div>'; $$('[data-pick]', r).forEach(b => b.onclick = () => { r.querySelector('#wl').value = b.dataset.pick; find(); }); return; }
        acc = hit; show();
      } catch (e) { err(e); }
    };
    const show = () => {
      r.querySelector('#wacc').innerHTML = `<div class="card"><b>${esc(acc.customer_name)}</b> · ${esc(acc.account_no)} · ${billBadge(acc.billing)} ${stBadge(acc.status)}<br><small class="muted">${esc(acc.address || '')} · meter ${esc(acc.meter_serial || '—')} · ${esc(acc.tariff_name)}</small>
        ${acc.arrears > 0 ? `<br><b class="neg">Owes ${money(acc.arrears)} on bills</b>` : ''}</div>`;
      const mo = ms.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
      if (acc.billing === 'prepaid') {
        r.querySelector('#wform').innerHTML = acc.status !== 'active' ? '<div class="empty">This connection is not active – it cannot buy water.</div>' :
          `<div class="form-grid"><label class="field"><span>Amount the customer pays</span><input type="number" id="wa" min="0" step="any" inputmode="decimal"></label>
           <label class="field"><span>Paid by</span><select id="wm">${mo}</select></label><label class="field"><span>Reference (mobile money / card)</span><input id="wr"></label></div>
           <div id="wq" class="muted" style="margin:8px 0"></div><div class="row"><span class="spacer"></span><button class="btn btn-primary" id="wgo">Sell and print token</button></div>`;
        if (acc.status !== 'active') return;
        const q = async () => { const amt = Number(r.querySelector('#wa').value); if (!(amt > 0)) { r.querySelector('#wq').textContent = ''; return; }
          try { const x = await GET(`/water/vend/quote?account_id=${acc.id}&amount=${amt}`); r.querySelector('#wq').innerHTML = `<b>${m3(x.units_m3)}</b> of water${x.debt_recovered ? ` · ${money(x.debt_recovered)} goes to old debt` : ''}${x.service_recovered ? ` · ${money(x.service_recovered)} monthly service charge` : ''} · ${money(x.month_m3_before)} m³ bought this month already`.replace(money(x.month_m3_before) + ' m³', qty(x.month_m3_before) + ' m³'); } catch (e) { r.querySelector('#wq').textContent = e.message; } };
        r.querySelector('#wa').oninput = q;
        r.querySelector('#wgo').onclick = async () => {
          try { const v = await POST('/water/vend', { account_id: acc.id, amount: Number(r.querySelector('#wa').value), method_id: Number(r.querySelector('#wm').value), reference: r.querySelector('#wr').value, session_id: sessionId });
            toast(`Token sold: ${qty(v.units_m3)} m³`); close(); printToken({ ...v, created_at: new Date().toISOString() }); done && done(); } catch (e) { err(e); }
        };
      } else {
        r.querySelector('#wform').innerHTML = `<div class="form-grid"><label class="field"><span>Amount paid on the bill</span><input type="number" id="wa" min="0" step="any" value="${acc.arrears > 0 ? acc.arrears : ''}"></label>
          <label class="field"><span>Paid by</span><select id="wm">${mo}</select></label><label class="field"><span>Reference</span><input id="wr"></label></div>
          <div class="row"><span class="spacer"></span><button class="btn btn-primary" id="wgo">Take payment and print receipt</button></div>`;
        r.querySelector('#wgo').onclick = async () => {
          try { const x = await POST(`/water/accounts/${acc.id}/pay`, { amount: Number(r.querySelector('#wa').value), method_id: Number(r.querySelector('#wm').value), reference: r.querySelector('#wr').value, session_id: sessionId });
            toast(`Payment of ${money(x.amount)} taken`); close(); printPayment(acc, x, ms.find(m => m.id === Number(r.querySelector('#wm').value))); done && done(); } catch (e) { err(e); }
        };
      }
    };
    r.querySelector('#wfind').onclick = find; r.querySelector('#wl').onkeydown = e => { if (e.key === 'Enter') find(); };
    if (preset) find();
  }, actions: [{ label: 'Close' }] });
}
export function printToken(v) {
  const co = state.company || {};
  printHtml(`<div style="font-family:monospace;font-size:13px;width:72mm">${receiptLogoHtml(co)}<div style="text-align:center"><b>${esc(co.name || '')}</b><br>${esc(co.phone || '')}<br>PREPAID WATER</div><hr>
    ${esc(v.number || '')}<br>${dt(v.created_at)}<br>Account: ${esc(v.account_no)}<br>${esc(v.customer_name || '')}<br>Meter: ${esc(v.meter_serial || '')}<hr>
    Paid: ${money(v.amount)}<br>${Number(v.debt_recovered) ? `Old debt: ${money(v.debt_recovered)}<br>` : ''}${Number(v.service_recovered) ? `Service charge: ${money(v.service_recovered)}<br>` : ''}
    Water: <b>${qty(v.units_m3)} m³</b><br><hr><div style="text-align:center;font-size:16px"><b>${esc(v.token || 'Credit loaded – no token needed')}</b></div><hr>
    <div style="text-align:center;font-size:11px">Type the token on your meter keypad and press Enter.<br>Keep this slip.</div></div>`);
}
function printPayment(a, x, m) {
  const co = state.company || {};
  printHtml(`<div style="font-family:monospace;font-size:13px;width:72mm">${receiptLogoHtml(co)}<div style="text-align:center"><b>${esc(co.name || '')}</b><br>WATER BILL PAYMENT</div><hr>
    ${dt(new Date().toISOString())}<br>Account: ${esc(a.account_no)}<br>${esc(a.customer_name)}<hr>Paid: <b>${money(x.amount)}</b> (${esc(m ? m.name : '')})<br>
    ${x.paid.map(p => `${esc(p.number)}: ${money(p.amount)}`).join('<br>')}${x.credit_left > 0 ? `<br>In credit: ${money(x.credit_left)}` : ''}<hr><div style="text-align:center">Thank you</div></div>`);
}
