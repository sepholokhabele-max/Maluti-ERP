// Payment partners: M-Pesa, EcoCash, banks, agents and shops that collect for us through the collections API.
import { GET, POST, PUT, esc, $, $$, toast, err, money, modal, confirmBox, formHtml, readForm, tableHtml, badge, page, d, dt, today, query } from './core.js';

const KIND = { mobile_money: 'Mobile money', bank: 'Bank', agent: 'Agent network', retail: 'Shop / retailer', other: 'Other' };
const SCOPE = { water_bill: 'Water bills (postpaid)', water_token: 'Prepaid water tokens', invoice: 'Any customer invoice (by invoice number)' };
const ST = { completed: ['paid', 'ok'], test: ['test', 'draft'], failed: ['failed', 'cancelled'], pending: ['processing', 'partial'] };
const base = () => `${location.origin}/api/collect/v1`;

export async function paypartners(view) {
  const tab = query().tab || 'partners';
  const tabs = [['partners', 'Partners'], ['txns', 'Payments'], ['settle', 'Settlements'], ['log', 'API calls'], ['guide', 'API guide for partners']];
  view.innerHTML = page('Payment partners', '<button class="btn btn-primary" id="pn">＋ Payment partner</button>',
    `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/paypartners?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="pb"></div>`);
  const reload = () => paypartners(view);
  $('#pn').onclick = () => partnerDialog(null, reload);
  const T = { partners, txns, settle, log, guide };
  await (T[tab] || partners)($('#pb'), reload);
}

async function partners(pb, reload) {
  const rows = await GET('/paypartners');
  pb.innerHTML = `<div class="help-note" style="margin-bottom:10px">Payment partners take payments from your customers on their own platforms (M-Pesa menu, EcoCash, bank app, agent till, supermarket counter) and tell S-ERP straight away through the collections API, so bills are marked paid and prepaid water tokens are sent back to the customer. What they collect is owed to you until they pay it over – record that under <b>Settlements</b>.</div>
    <div class="card">${tableHtml([{ key: 'name', label: 'Partner' }, { key: 'kind', label: 'Type', fmt: v => KIND[v] || v },
      { key: 'mode', label: 'Mode', html: 1, fmt: (v, p) => p.status === 'suspended' ? badge('suspended', 'cancelled') : v === 'live' ? badge('live', 'ok') : badge('test', 'draft') },
      { key: 'key_prefix', label: 'Key', html: 1, fmt: v => v ? `<code>${esc(v)}…</code>` : '' }, { key: 'scopes', label: 'May take', fmt: v => v.split(',').map(x => (SCOPE[x] || x).split(' (')[0]).join(', ') },
      { key: 'commission_pct', label: 'Commission', right: 1, fmt: (v, p) => [Number(v) ? `${Number(v)}%` : '', Number(p.commission_fixed) ? money(p.commission_fixed) : ''].filter(Boolean).join(' + ') || '—' },
      { key: 'today_amount', label: 'Today', right: 1, fmt: (v, p) => `${money(v)} (${p.today_count})` }, { key: 'unsettled', label: 'Owed to us', right: 1, html: 1, fmt: v => Number(v) ? `<b>${money(v)}</b>` : money(0) },
      { key: 'last_used_at', label: 'Last call', fmt: dt }], rows, { rowAttr: p => `data-p="${p.id}"`, empty: 'No payment partners yet. Add M-Pesa, EcoCash or your bank with ＋ Payment partner.' })}</div>`;
  $$('[data-p]', pb).forEach(tr => tr.onclick = () => partnerView(rows.find(p => p.id === Number(tr.dataset.p)), reload));
}

const FIELDS = [{ key: 'name', label: 'Name', required: true, help: 'e.g. M-Pesa (Vodacom Lesotho), EcoCash, Standard Lesotho Bank, Pick n Pay counters' },
  { key: 'kind', label: 'Type', type: 'select', options: Object.entries(KIND).map(([value, label]) => ({ value, label })) },
  { type: 'heading', label: 'What they may collect' }, ...Object.entries(SCOPE).map(([k, l]) => ({ key: 'sc_' + k, label: l, type: 'checkbox' })),
  { key: 'min_amount', label: 'Smallest payment', type: 'number' }, { key: 'max_amount', label: 'Largest single payment', type: 'number' },
  { type: 'heading', label: 'Commission and security' }, { key: 'commission_pct', label: 'Commission, % of each payment', type: 'number' }, { key: 'commission_fixed', label: '… plus a fixed amount per payment', type: 'number' },
  { key: 'ip_allow', label: 'Only accept calls from these IP addresses (comma separated; empty = any)', span: 2, help: 'Ask the partner for the addresses of their servers. Strongly advised for live keys.' },
  { type: 'heading', label: 'Contact' }, { key: 'contact_name', label: 'Contact person' }, { key: 'contact_phone', label: 'Phone' }, { key: 'contact_email', label: 'Email' }, { key: 'notes', label: 'Notes', span: 2 }];
function partnerDialog(p, done) {
  const vals = p ? { ...p, ...Object.fromEntries(Object.keys(SCOPE).map(k => ['sc_' + k, p.scopes.split(',').includes(k)])) }
    : { kind: 'mobile_money', min_amount: 5, max_amount: 10000, sc_water_bill: true, sc_water_token: true, sc_invoice: true };
  modal({ title: p ? `Edit ${p.name}` : 'New payment partner', size: 'lg', body: formHtml(FIELDS, vals), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => {
    const v = readForm(r, FIELDS); v.scopes = Object.keys(SCOPE).filter(k => v['sc_' + k]); Object.keys(SCOPE).forEach(k => delete v['sc_' + k]);
    if (p) { await PUT('/paypartners/' + p.id, v); toast('Saved'); c(); done(); return; }
    const x = await POST('/paypartners', v); c(); showKey(v.name, x.key, x.mode, done);
  } }] });
}
function showKey(name, key, mode, done) {
  modal({ title: `API key for ${name}`, body: `<p>Send this <b>${mode}</b> key to ${esc(name)} securely (not by plain email or WhatsApp if you can avoid it). <b>It is shown only now</b> – S-ERP keeps only a fingerprint of it. If it is lost, make a new key.</p>
      <div class="row"><input id="kk" readonly value="${esc(key)}" style="flex:1;font-family:monospace"><button class="btn" id="kc">Copy</button></div>
      ${mode === 'test' ? '<p class="help-note">A test key checks accounts and payments but records no money and gives TEST tokens. When the partner has finished testing, use "Go live" to give them a live key.</p>' : '<p class="help-note">This key moves real money. The old key no longer works.</p>'}
      <p class="muted">Their developers will need the API guide (tab "API guide for partners") and this address: <code>${esc(base())}</code></p>`,
    onOpen: r => { r.querySelector('#kc').onclick = () => { r.querySelector('#kk').select(); navigator.clipboard && navigator.clipboard.writeText(key).catch(() => {}); toast('Copied'); }; },
    actions: [{ label: 'I have saved the key', cls: 'btn-primary', onClick: c => { c(); done && done(); } }] });
}
async function partnerView(p, reload) {
  const ms = (await GET('/payment-methods')).filter(m => m.active && m.kind !== 'account' && m.id !== p.method_id && m.account_code !== '1180').sort((a, b) => (a.kind === 'cash') - (b.kind === 'cash')); // a bank / card account first, cash last
  const rows = await GET(`/paypartners/txns?partner_id=${p.id}&unsettled=1`);
  modal({ title: p.name, size: 'lg', body: `<div class="cols cols-3" style="margin-bottom:10px"><div class="kpi"><div class="label">Mode</div><div class="value">${p.mode === 'live' ? badge('live', 'ok') : badge('test', 'draft')} ${p.status === 'suspended' ? badge('suspended', 'cancelled') : ''}</div><div class="hint">key <code>${esc(p.key_prefix || '')}…</code></div></div>
      <div class="kpi"><div class="label">Owed to us (not settled)</div><div class="value">${money(p.unsettled)}</div><div class="hint">${rows.length} payments · commission ${money(p.unsettled_commission)}</div></div>
      <div class="kpi"><div class="label">Booked to</div><div class="value" style="font-size:15px">${esc(p.method_name || '')}</div><div class="hint">account 1180 until settled</div></div></div>
      <h4>Record a settlement</h4><p class="muted">When ${esc(p.name)} pays over the money it collected, record it here: the bank goes up, their commission is booked as an expense and the amount they owed is cleared.</p>
      <div class="form-grid"><label class="field"><span>Payments up to</span><input type="date" id="su" value="${today()}"></label><label class="field"><span>Money came into</span><select id="sm">${ms.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Amount received (empty = collected less commission)</span><input type="number" step="0.01" id="sr"></label><label class="field"><span>Bank reference</span><input id="sref"></label></div>`,
    actions: [{ label: 'Close' }, { label: 'Edit', onClick: c => { c(); partnerDialog(p, reload); } },
      { label: p.status === 'suspended' ? 'Allow again' : 'Suspend', cls: p.status === 'suspended' ? '' : 'btn-danger', onClick: async c => { await PUT('/paypartners/' + p.id, { status: p.status === 'suspended' ? 'active' : 'suspended' }); c(); reload(); } },
      { label: 'New test key', onClick: async c => { if (!(await confirmBox('Make a new TEST key? The current key stops working at once.'))) return; const x = await POST(`/paypartners/${p.id}/key`, { mode: 'test' }); c(); showKey(p.name, x.key, x.mode, reload); } },
      { label: p.mode === 'live' ? 'New live key' : '🚀 Go live', onClick: async c => { if (!(await confirmBox(`Give ${p.name} a LIVE key? Payments they send will be recorded as real money and tokens will be real. The current key stops working.`, { okLabel: 'Make live key', danger: true }))) return; const x = await POST(`/paypartners/${p.id}/key`, { mode: 'live' }); c(); showKey(p.name, x.key, x.mode, reload); } },
      { label: 'Record settlement', cls: 'btn-primary', onClick: async (c, r) => {
        const x = await POST(`/paypartners/${p.id}/settle`, { upto_date: r.querySelector('#su').value, method_id: Number(r.querySelector('#sm').value), received: r.querySelector('#sr').value, reference: r.querySelector('#sref').value });
        toast(`Settled ${x.txns} payments: ${money(x.received)} received, commission ${money(x.commission)}`, 'ok', 7000); c(); reload();
      } }] });
}

async function txns(pb) {
  const q = query(), from = q.from || today(), to = q.to || today();
  const [rows, ps] = await Promise.all([GET(`/paypartners/txns?from=${from}&to=${to}${q.partner_id ? '&partner_id=' + q.partner_id : ''}${q.status ? '&status=' + q.status : ''}`), GET('/paypartners')]);
  const ok = rows.filter(t => t.status === 'completed');
  pb.innerHTML = `<div class="row wrap" style="margin-bottom:10px"><label>From <input type="date" id="tf" value="${from}"></label><label>To <input type="date" id="tt" value="${to}"></label>
      <select id="tp"><option value="">All partners</option>${ps.map(p => `<option value="${p.id}" ${String(p.id) === q.partner_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <select id="ts"><option value="">Any status</option>${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${q.status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select><button class="btn" id="tg">Show</button>
      <span class="spacer"></span><b>${ok.length} paid · ${money(ok.reduce((s, t) => s + Number(t.amount), 0))}</b></div>
    <div class="card">${tableHtml([{ key: 'created_at', label: 'When', fmt: dt }, { key: 'partner_name', label: 'Partner' }, { key: 'reference', label: 'Their reference' }, { key: 'account_ref', label: 'Account' },
      { key: 'customer_name', label: 'Customer' }, { key: 'kind', label: 'For', fmt: v => (SCOPE[v] || v || '').split(' (')[0] }, { key: 'amount', label: 'Amount', right: 1, fmt: money },
      { key: 'commission', label: 'Commission', right: 1, fmt: v => Number(v) ? money(v) : '' }, { key: 'status', label: 'Status', html: 1, fmt: s => badge(ST[s][0], ST[s][1]) },
      { key: 'settlement_id', label: 'Settled', fmt: v => v ? '✓' : '' }, { key: 'error', label: 'Why it failed' }], rows, { rowAttr: t => `data-t="${t.id}"`, empty: 'No partner payments in these dates.' })}</div>`;
  $('#tg').onclick = () => { location.hash = `#/paypartners?tab=txns&from=${$('#tf').value}&to=${$('#tt').value}&partner_id=${$('#tp').value}&status=${$('#ts').value}`; };
  $$('[data-t]', pb).forEach(tr => tr.onclick = () => { const t = rows.find(x => x.id === Number(tr.dataset.t)); const res = typeof t.result === 'string' ? JSON.parse(t.result) : t.result;
    modal({ title: `${t.partner_name} – ${t.reference}`, body: `<pre style="white-space:pre-wrap;font-size:12px">${esc(JSON.stringify({ account: t.account_ref, amount: Number(t.amount), status: t.status, payer_phone: t.payer_phone, paid_at: t.paid_at, ...(res || {}), error: t.error || undefined }, null, 2))}</pre>`, actions: [{ label: 'Close' }] }); });
}
async function settle(pb) {
  const rows = await GET('/paypartners/settlements');
  pb.innerHTML = `<div class="card"><p class="muted">Open a partner on the Partners tab to record a new settlement.</p>${tableHtml([{ key: 'settle_date', label: 'Date', fmt: d }, { key: 'partner_name', label: 'Partner' }, { key: 'upto_date', label: 'Payments up to', fmt: d },
    { key: 'txns', label: 'Payments', right: 1 }, { key: 'collected', label: 'Collected', right: 1, fmt: money }, { key: 'commission', label: 'Commission', right: 1, fmt: money }, { key: 'received', label: 'Received', right: 1, fmt: money },
    { key: 'reference', label: 'Reference' }, { key: 'user_name', label: 'By' }], rows, { empty: 'No settlements yet.' })}</div>`;
}
async function log(pb) {
  const rows = await GET('/paypartners/log');
  pb.innerHTML = `<div class="card"><p class="muted">The last 300 calls to the collections API – useful when a partner says "we sent it". Calls with a wrong key show no partner.</p>${tableHtml([{ key: 'created_at', label: 'When', fmt: dt }, { key: 'partner_name', label: 'Partner', fmt: v => v || '— (wrong key)' },
    { key: 'ip', label: 'From IP' }, { key: 'method', label: '' }, { key: 'path', label: 'Call' }, { key: 'status', label: 'Answer', html: 1, fmt: v => v < 300 ? badge(String(v), 'ok') : badge(String(v), 'cancelled') }, { key: 'error', label: 'Note' }], rows, { empty: 'No calls yet.' })}</div>`;
}
function guide(pb) {
  const B = base();
  const code = s => `<pre style="background:var(--bg2,#f4f5fa);padding:10px;border-radius:8px;white-space:pre-wrap;font-size:12px">${esc(s)}</pre>`;
  pb.innerHTML = `<div class="card" id="apiguide"><h3>Collections API – for payment partners' developers</h3>
    <p>Base address: <code>${esc(B)}</code> (HTTPS only in production). Every call sends the partner's key: <code>Authorization: Bearer sk_live_…</code>. Test keys (<code>sk_test_…</code>) check everything but record no money and return TEST tokens. Answers are JSON; errors look like <code>{"error":{"code":"ACCOUNT_NOT_FOUND","message":"…"}}</code>.</p>
    <h4>1. Check the account before taking the customer's money</h4>${code(`GET ${B}/accounts/W000123\n\n200 {"account":"W000123","type":"water_token","customer":"Palesa M.","currency":"LSL","amount_due":80.00,\n     "min_amount":5,"max_amount":5000,"can_pay":true,"meter":"PP-2001","message":"Part of each purchase pays the old debt on this account"}`)}
    <p>The account can be a water account number, a meter number, or a customer invoice number (INV/2026/00042 – encode the slashes as %2F). <code>type</code> is <code>water_bill</code> (postpaid), <code>water_token</code> (prepaid – the answer to the payment contains the token) or <code>invoice</code>. Show <code>customer</code> to the payer so they can confirm.</p>
    <h4>2. Send the payment</h4>${code(`POST ${B}/payments\nContent-Type: application/json\n\n{"reference":"MP2611131200ABC","account":"W000123","amount":100.00,"payer_phone":"+26658123456","paid_at":"2026-11-13T12:00:05+02:00"}\n\n200 {"reference":"MP2611131200ABC","status":"completed","account":"W000123","type":"water_token","amount":100,\n     "receipt":"WV/2026/000045","token":"1234-5678-9012-3456-7890","units_m3":8.813,"debt_recovered":25,"standing_charge":0}`)}
    <p><b>reference</b> is your own unique transaction id. Sending the same reference again never pays twice – you get the first answer back with <code>"duplicate":true</code>. If you get no answer (time-out), ask with step 3 or simply send the same request again. Bill payments answer with <code>paid_invoices</code>, <code>credit</code> and <code>balance_after</code>.</p>
    <h4>3. Ask about a payment</h4>${code(`GET ${B}/payments/MP2611131200ABC`)}
    <h4>4. Daily reconciliation</h4>${code(`GET ${B}/transactions?from=2026-11-13&to=2026-11-13\n\n200 {"from":"2026-11-13","to":"2026-11-13","count":152,"total":18450.00,"commission":184.50,"transactions":[…]}`)}
    <h4>Errors</h4><table class="grid"><tr><th>HTTP</th><th>code</th><th>meaning</th></tr>
      ${[[401, 'UNAUTHORIZED', 'missing or wrong key'], [403, 'SUSPENDED / IP_NOT_ALLOWED / NOT_ALLOWED', 'partner suspended, call from an unknown address, or this kind of payment is not allowed'], [404, 'ACCOUNT_NOT_FOUND', 'no such account, meter or invoice'],
        [409, 'IN_PROGRESS / REFERENCE_REUSED', 'the reference is being processed, or was used for another account/amount'], [422, 'AMOUNT_INVALID / AMOUNT_OUT_OF_RANGE / CANNOT_PAY / PAYMENT_FAILED', 'nothing was recorded – fix and retry with the same reference'],
        [429, 'RATE_LIMITED', 'more than 1 200 calls a minute'], [500, 'SERVER_ERROR', 'retry with the same reference']].map(r => `<tr><td>${r[0]}</td><td><code>${r[1]}</code></td><td>${r[2]}</td></tr>`).join('')}</table>
    <p class="muted">A quick test: <code>curl -H "Authorization: Bearer sk_test_…" ${esc(B)}/ping</code></p>
    <button class="btn" id="gprint">🖨 Print / save as PDF for the partner</button></div>`;
  $('#gprint').onclick = () => { const w = window.open('', '_blank'); if (!w) return; w.document.write(`<html><head><title>Collections API</title></head><body style="font-family:Arial;max-width:800px;margin:auto">${$('#apiguide').innerHTML.replace(/<button[\s\S]*?<\/button>/, '')}</body></html>`); w.document.close(); w.print(); };
}
