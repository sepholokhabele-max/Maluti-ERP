// Equipment & party hire: orders, items, availability, hand-over, returns, settling with the deposit, hire agreement
import { state, GET, POST, PUT, esc, $, $$, toast, err, can, money, qty, modal, formHtml, readForm, tableHtml, badge, page, d, today, plusDays, query, printHtml } from './core.js';

const OS = { reserved: ['reserved', 'draft'], out: ['out', 'partial'], returned: ['back – to settle', 'posted'], settled: ['settled', 'paid'], cancelled: ['cancelled', 'cancelled'] };
const osBadge = (s, o) => (o && o.late ? badge(`late ${o.days_late || ''}d`.trim(), 'cancelled') + ' ' : '') + badge((OS[s] || [s])[0], (OS[s] || [s, ''])[1]);
const methods = async () => (await GET('/payment-methods')).filter(m => m.active && m.kind !== 'account');
const mOpts = ms => ms.map(m => ({ value: m.id, label: m.name }));

export async function hire(view) {
  const q = query(); const tab = q.tab || 'orders';
  const tabs = [['orders', 'Hires'], ['items', 'Items'], ['available', 'What is free'], ['report', 'Utilisation & income']];
  view.innerHTML = page('Equipment & party hire', '<button class="btn btn-primary" id="nh">＋ New hire</button>',
    `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/hire?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="hb"></div>`);
  $('#nh').onclick = () => orderDialog(null, o => { location.hash = '#/hireorder/' + o.id; });
  const hb = $('#hb');
  if (tab === 'orders') {
    const v = q.view || 'open';
    const [st, rows] = await Promise.all([GET('/hire/stats'), GET(`/hire/orders?view=${v}${q.q ? '&q=' + encodeURIComponent(q.q) : ''}`)]);
    hb.innerHTML = `<div class="cols cols-4" style="margin-bottom:14px"><div class="kpi"><div class="label">Out now</div><div class="value">${st.out_now}</div><div class="hint">deposits held ${money(st.deposits)}</div></div>
      <div class="kpi"><div class="label">Late</div><div class="value" style="color:${st.late ? 'var(--bad)' : 'inherit'}">${st.late}</div><div class="hint">${st.due_today} due back today</div></div>
      <div class="kpi"><div class="label">To hand over</div><div class="value">${st.to_hand_over}</div><div class="hint">reserved from today or earlier</div></div>
      <div class="kpi"><div class="label">Back – to settle</div><div class="value">${st.to_settle}</div></div></div>
      <div class="row wrap" style="margin-bottom:8px">${[['open', 'Open'], ['late', 'Late'], ['reserved', 'Reserved'], ['out', 'Out'], ['returned', 'To settle'], ['settled', 'Settled'], ['all', 'All']].map(([k, l]) => `<a class="btn btn-sm ${k === v ? 'btn-primary' : ''}" href="#/hire?view=${k}">${l}</a>`).join('')}
      <span class="spacer"></span><input id="hq" placeholder="Customer, phone or number" value="${esc(q.q || '')}" style="max-width:240px"></div>
      <div class="card">${tableHtml([{ key: 'number', label: 'Hire' }, { key: 'customer', label: 'Customer' }, { key: 'customer_phone', label: 'Phone' }, { key: 'items', label: 'Items' },
        { key: 'start_date', label: 'From', fmt: d }, { key: 'end_date', label: 'Back on', fmt: d }, { key: 'deposit_held', label: 'Deposit held', right: 1, fmt: money }, { key: 'status', label: 'Status', html: 1, fmt: (s, o) => osBadge(s, o) }],
        rows, { rowAttr: o => `data-o="${o.id}"`, empty: 'No hires here.' })}</div>`;
    $$('[data-o]', hb).forEach(tr => tr.onclick = () => { location.hash = '#/hireorder/' + tr.dataset.o; });
    let t; $('#hq').oninput = e => { clearTimeout(t); t = setTimeout(() => { location.hash = `#/hire?view=all&q=${encodeURIComponent(e.target.value)}`; }, 500); };
  }
  if (tab === 'items') {
    const items = await GET('/hire/items?all=1');
    hb.innerHTML = `<div class="card"><div class="row" style="margin-bottom:8px"><h3 style="flex:1">Items for hire</h3>${can('settings') ? '<button class="btn btn-sm" id="ht">Hire terms</button>' : ''}<button class="btn btn-sm btn-primary" id="ni">＋ Item</button></div>
      ${tableHtml([{ key: 'name', label: 'Item' }, { key: 'category', label: 'Category' }, { key: 'qty_owned', label: 'Owned', right: 1, fmt: qty }, { key: 'qty_out', label: 'Out', right: 1, fmt: qty },
        { key: 'qty_out_of_service', label: 'Broken', right: 1, html: 1, fmt: (x, i) => Number(x) ? `<a href="#" data-fix="${i.id}" title="Mark repaired">${qty(x)} – fixed?</a>` : '' }, { key: 'qty_in', label: 'In the yard', right: 1, fmt: qty },
        { key: 'rate_day', label: 'Per day', right: 1, fmt: money }, { key: 'rate_week', label: 'Per week', right: 1, fmt: v => v ? money(v) : '' }, { key: 'rate_month', label: 'Per month', right: 1, fmt: v => v ? money(v) : '' },
        { key: 'deposit', label: 'Deposit', right: 1, fmt: money }, { key: 'replacement_cost', label: 'Replace at', right: 1, fmt: money }, { key: 'active', label: 'In use', fmt: v => v ? '✓' : '' }],
        items, { rowAttr: i => `data-i="${i.id}"`, empty: 'No items yet – add tents, chairs, tables, scaffolding, mixers…' })}</div>`;
    const dlg = it => {
      const f = [{ key: 'name', label: 'Item', required: true }, { key: 'code', label: 'Code' }, { key: 'category', label: 'Category' }, { key: 'qty_owned', label: 'How many you own', type: 'number' },
        { key: 'rate_day', label: 'Price per day incl. VAT (M)', type: 'number', required: true }, { key: 'rate_week', label: 'Price per week (optional)', type: 'number' }, { key: 'rate_month', label: 'Price per month (optional)', type: 'number' },
        { key: 'deposit', label: 'Deposit per unit (M)', type: 'number' }, { key: 'replacement_cost', label: 'Replacement cost per unit (M)', type: 'number' },
        ...(it ? [{ key: 'qty_out_of_service', label: 'Broken / in repair', type: 'number' }, { key: 'active', label: 'In use', type: 'checkbox' }] : [{ key: 'track_maintenance', label: 'Machine – service it through Maintenance', type: 'checkbox' }, { key: 'service_days', label: 'Service every … days', type: 'number' }]),
        { key: 'notes', label: 'Notes', span: 2 }];
      modal({ title: it ? it.name : 'New hire item', size: 'lg', body: formHtml(f, it || { qty_owned: 1 }, { ctx: 'hireitem' }),
        actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); if (it) await PUT('/hire/items/' + it.id, v); else await POST('/hire/items', v); c(); toast('Saved'); hire(view); } }] });
    };
    $('#ni').onclick = () => dlg(null);
    $$('[data-i]', hb).forEach(tr => tr.onclick = () => dlg(items.find(i => String(i.id) === tr.dataset.i)));
    $$('[data-fix]', hb).forEach(a => a.onclick = async e => { e.preventDefault(); e.stopPropagation(); const it = items.find(i => String(i.id) === a.dataset.fix);
      modal({ title: `${it.name} repaired`, body: `<label class="field"><span>How many are fixed and back in the yard</span><input id="fx" type="number" value="${Number(it.qty_out_of_service)}"></label>`,
        actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/hire/items/${it.id}/repaired`, { qty: r.querySelector('#fx').value }); c(); hire(view); } }] }); });
    if ($('#ht')) $('#ht').onclick = async () => { const s = await GET('/hire/settings');
      modal({ title: 'Hire terms', size: 'lg', body: `<label class="field"><span>Printed on every hire agreement the customer signs</span><textarea id="tt" rows="8">${esc(s.terms)}</textarea><small class="help-note">Late returns, damage, cleaning, who pays transport, what happens to the deposit. Keep it short and clear.</small></label>`,
        actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await PUT('/hire/settings', { terms: r.querySelector('#tt').value }); c(); toast('Saved'); } }] }); };
  }
  if (tab === 'available') {
    const from = q.from || today(), to = q.to || from;
    const rows = await GET(`/hire/available?from=${from}&to=${to}`);
    hb.innerHTML = `<div class="card"><div class="row wrap" style="margin-bottom:8px"><label>From <input type="date" id="af" value="${from}"></label><label>To <input type="date" id="at" value="${to}"></label><button class="btn btn-sm" id="ag">Check</button><span class="spacer"></span><small class="muted">Anything promised or out on any of these days counts as taken</small></div>
      ${tableHtml([{ key: 'name', label: 'Item' }, { key: 'category', label: 'Category' }, { key: 'qty_owned', label: 'Owned', right: 1, fmt: qty }, { key: 'qty_out_of_service', label: 'Broken', right: 1, fmt: v => Number(v) ? qty(v) : '' },
        { key: 'booked', label: 'Booked / out', right: 1, fmt: qty }, { key: 'free', label: 'Free', right: 1, html: 1, fmt: v => `<b style="color:${v > 0 ? 'var(--ok)' : 'var(--bad)'}">${qty(Math.max(0, v))}</b>` }], rows, { empty: 'No items yet.' })}</div>`;
    $('#ag').onclick = () => { location.hash = `#/hire?tab=available&from=${$('#af').value}&to=${$('#at').value}`; };
  }
  if (tab === 'report') {
    const to = q.to || today(), from = q.from || `${to.slice(0, 8)}01`;
    const rep = await GET(`/hire/report?from=${from}&to=${to}`);
    hb.innerHTML = `<div class="card"><div class="row" style="margin-bottom:8px"><label>From <input type="date" id="rf" value="${from}"></label><label>To <input type="date" id="rt" value="${to}"></label><button class="btn btn-sm" id="rg">Show</button></div>
      ${tableHtml([{ key: 'name', label: 'Item' }, { key: 'category', label: 'Category' }, { key: 'qty_owned', label: 'Owned', right: 1, fmt: qty }, { key: 'unit_days', label: 'Unit-days hired', right: 1, fmt: qty },
        { key: 'utilisation', label: 'Utilisation', right: 1, html: 1, fmt: v => `<b style="color:${v < 20 ? 'var(--bad)' : v > 60 ? 'var(--ok)' : 'inherit'}">${v}%</b>` }, { key: 'hire_income', label: 'Hire income', right: 1, fmt: money },
        { key: 'damage_income', label: 'Damage & losses charged', right: 1, fmt: money }, { key: 'per_unit', label: 'Income per unit owned', right: 1, fmt: money }], rep.rows, { empty: 'No items yet.' })}
      <p class="muted" style="margin-top:8px">Utilisation = days items were out ÷ days you owned them in the period. Low utilisation means stock that could be sold; high utilisation means you are turning customers away and could buy more.</p></div>`;
    $('#rg').onclick = () => { location.hash = `#/hire?tab=report&from=${$('#rf').value}&to=${$('#rt').value}`; };
  }
}

async function orderDialog(o, done) {
  const custs = await GET('/partners?is_customer=1');
  const f = [{ key: 'start_date', label: 'Hire from', type: 'date', required: true }, { key: 'end_date', label: 'Back on', type: 'date', required: true },
    ...(o ? [] : [{ key: 'partner_id', label: 'Customer', type: 'select', numeric: true, options: [{ value: '', label: '— new customer (fill in below) —' }, ...custs.map(p => ({ value: p.id, label: `${p.name}${p.phone ? ' · ' + p.phone : ''}` }))] },
      { key: 'customer_name', label: 'New customer: name' }, { key: 'customer_phone', label: 'New customer: phone' }]),
    { key: 'id_number', label: 'ID / passport number' }, { key: 'delivery_address', label: 'Deliver to (blank = collects)' }, { key: 'delivery_fee', label: 'Delivery & collection fee incl. VAT (M)', type: 'number' },
    { key: 'deposit_required', label: 'Deposit required (blank = from the items)', type: 'number', nullable: true }, { key: 'notes', label: 'Notes', span: 2 }];
  const vals = o ? { ...o, start_date: d(o.start_date), end_date: d(o.end_date) } : { start_date: today(), end_date: plusDays(1), delivery_fee: 0 };
  let lines = o ? o.lines.map(l => ({ item_id: l.item_id, qty: Number(l.qty), rate_day: Number(l.rate_day) })) : [{ item_id: '', qty: 1, rate_day: '' }];
  let avail = [];
  modal({ title: o ? `Change ${o.number}` : 'New hire', size: 'lg', body: formHtml(f, vals, { ctx: 'hireorder' }) + `<h4 style="margin:14px 0 6px">Items</h4><div id="hl"></div><button class="btn btn-sm" id="hadd" style="margin-top:6px">＋ Add item</button>
      <div id="hsum" class="muted" style="margin-top:8px"></div>`,
    onOpen: async r => {
      const draw = () => {
        r.querySelector('#hl').innerHTML = `<table class="grid"><thead><tr><th>Item</th><th class="r">Free</th><th class="r">Qty</th><th class="r">Price / day</th><th></th></tr></thead><tbody>${lines.map((l, i) => {
          const a = avail.find(x => x.id === Number(l.item_id));
          return `<tr><td><select data-k="item_id" data-i="${i}"><option value="">— choose —</option>${avail.map(x => `<option value="${x.id}" ${x.id === Number(l.item_id) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></td>
            <td class="r">${a ? `<b style="color:${a.free >= l.qty ? 'var(--ok)' : 'var(--bad)'}">${qty(Math.max(0, a.free))}</b>` : ''}</td>
            <td class="r"><input data-k="qty" data-i="${i}" type="number" value="${l.qty}" style="width:80px"></td><td class="r"><input data-k="rate_day" data-i="${i}" type="number" value="${l.rate_day}" style="width:100px"></td>
            <td><button class="btn btn-sm" data-del="${i}">✕</button></td></tr>`; }).join('')}</tbody></table>`;
        const s = r.querySelector('[name=start_date]').value, e = r.querySelector('[name=end_date]').value;
        const n = Math.max(1, Math.round((new Date(e + 'T12:00:00') - new Date(s + 'T12:00:00')) / 86400000));
        const dep = lines.reduce((t, l) => { const a = avail.find(x => x.id === Number(l.item_id)); return t + (a ? Number(a.deposit) * Number(l.qty || 0) : 0); }, 0);
        const day = lines.reduce((t, l) => t + Number(l.rate_day || 0) * Number(l.qty || 0), 0);
        r.querySelector('#hsum').innerHTML = `${n} day(s) · about ${money(day * n)} at day rates (week and month prices are applied if cheaper) · deposit from the items ${money(dep)}`;
        $$('[data-k]', r).forEach(el => el.onchange = () => { const l = lines[el.dataset.i]; l[el.dataset.k] = el.value;
          if (el.dataset.k === 'item_id') { const a = avail.find(x => x.id === Number(el.value)); if (a) l.rate_day = Number(a.rate_day); } setTimeout(draw); });
        $$('[data-del]', r).forEach(b => b.onclick = () => { lines.splice(Number(b.dataset.del), 1); if (!lines.length) lines.push({ item_id: '', qty: 1, rate_day: '' }); draw(); });
      };
      const load = async () => { const s = r.querySelector('[name=start_date]').value, e = r.querySelector('[name=end_date]').value || s;
        avail = await GET(`/hire/available?from=${s}&to=${e}${o ? '&exclude=' + o.id : ''}`).catch(() => []); draw(); };
      r.querySelector('[name=start_date]').onchange = load; r.querySelector('[name=end_date]').onchange = load;
      r.querySelector('#hadd').onclick = () => { lines.push({ item_id: '', qty: 1, rate_day: '' }); draw(); };
      if (o && o.status === 'out') { r.querySelector('[name=start_date]').disabled = true; r.querySelector('#hadd').style.display = 'none'; }
      await load();
    },
    actions: [{ label: 'Cancel' }, { label: o ? 'Save' : 'Book', cls: 'btn-primary', onClick: async (c, r) => {
      const v = readForm(r, f); if (v.deposit_required === null) delete v.deposit_required;
      if (!(o && o.status === 'out')) v.lines = lines.filter(l => l.item_id).map(l => ({ item_id: Number(l.item_id), qty: Number(l.qty), rate_day: l.rate_day === '' ? undefined : Number(l.rate_day) }));
      else delete v.start_date;
      const out = o ? await PUT('/hire/orders/' + o.id, v) : await POST('/hire/orders', v); c(); toast(`${out.number} saved`); done(out); } }] });
}

export async function hireOrder(view, [idq]) {
  const id = (idq || '').split('?')[0];
  const o = await GET('/hire/orders/' + id);
  const bl = o.bill;
  const acts = [];
  if (o.status === 'reserved') acts.push('<button class="btn btn-ok" id="ho">✓ Hand over</button>', '<button class="btn" id="hd">Deposit</button>', '<button class="btn" id="he">Change</button>', '<button class="btn btn-danger" id="hc">Cancel</button>');
  if (o.status === 'out') acts.push('<button class="btn btn-primary" id="hr">↩ Items back</button>', '<button class="btn" id="he">Extend</button>', '<button class="btn" id="hd">Deposit</button>');
  if (o.status === 'returned') acts.push('<button class="btn btn-primary" id="hs">Settle</button>');
  acts.push('<button class="btn" id="hp">🖨 Agreement</button>');
  view.innerHTML = page(`${o.number} · ${o.customer}`, acts.join(''), `<div class="cols cols-4" style="margin-bottom:14px">
      <div class="kpi"><div class="label">Status</div><div class="value" style="font-size:18px">${osBadge(o.status, o)}</div><div class="hint">${esc(o.customer_phone || '')}</div></div>
      <div class="kpi"><div class="label">Hire period</div><div class="value" style="font-size:18px">${esc(d(o.start_date))} → ${esc(d(o.end_date))}</div><div class="hint">${o.delivery_address ? 'deliver to ' + esc(o.delivery_address) : 'customer collects'}</div></div>
      <div class="kpi"><div class="label">Deposit held</div><div class="value">${money(o.deposit_held)}</div><div class="hint">required ${money(o.deposit_required)}</div></div>
      <div class="kpi"><div class="label">${bl ? (bl.to_pay >= 0 ? 'Still to pay' : 'Deposit to refund') : 'Invoice'}</div><div class="value">${bl ? money(Math.abs(bl.to_pay)) : o.invoice_number ? `<a href="#/invoice/${o.invoice_id}">${esc(o.invoice_number)}</a>` : '–'}</div>${bl && o.status !== 'returned' ? '<div class="hint">so far – up to today or the return date</div>' : ''}</div></div>
    <div class="cols cols-2" style="align-items:start"><div class="card"><h3>Items</h3>${tableHtml([{ key: 'name', label: 'Item' }, { key: 'qty', label: 'Hired', right: 1, fmt: qty }, { key: 'qty_back', label: 'Back', right: 1, fmt: qty },
      { key: 'qty', label: 'Still out', right: 1, html: 1, fmt: (x, l) => { const n = Number(x) - Number(l.qty_back); return n > 0 ? `<b>${qty(n)}</b>` : '✓'; } }, { key: 'rate_day', label: 'Per day', right: 1, fmt: money }, { key: 'rate_week', label: 'Week', right: 1, fmt: v => v ? money(v) : '' }], o.lines)}
      ${o.returns.length ? `<h4 style="margin-top:12px">Returns</h4>${tableHtml([{ key: 'return_date', label: 'Date', fmt: d }, { key: 'name', label: 'Item' }, { key: 'qty', label: 'Back', right: 1, fmt: qty }, { key: 'damaged', label: 'Damaged', right: 1, fmt: v => Number(v) ? qty(v) : '' },
        { key: 'lost', label: 'Lost', right: 1, fmt: v => Number(v) ? qty(v) : '' }, { key: 'days', label: 'Days', right: 1 }, { key: 'hire_charge', label: 'Hire', right: 1, fmt: money }, { key: 'damage_charge', label: 'Damage / loss', right: 1, fmt: v => Number(v) ? money(v) : '' }, { key: 'note', label: 'Note' }], o.returns)}` : ''}</div>
    ${bl ? `<div class="card"><h3>Bill${o.status === 'returned' ? '' : ' so far'}</h3><table class="grid report-table"><tr><td>Hire of items back</td><td class="r">${money(bl.returned_hire)}</td></tr>
      ${bl.still_out.map(x => `<tr><td>${esc(x.name)} × ${qty(x.qty)} – ${x.days} day(s) ${o.status === 'reserved' ? '(as booked)' : '(still out)'}</td><td class="r">${money(x.charge)}</td></tr>`).join('')}
      ${bl.damage ? `<tr><td>Damage & losses</td><td class="r">${money(bl.damage)}</td></tr>` : ''}${bl.delivery_fee ? `<tr><td>Delivery & collection</td><td class="r">${money(bl.delivery_fee)}</td></tr>` : ''}
      <tr class="tot"><td>Total</td><td class="r">${money(bl.total)}</td></tr><tr><td>Less deposit</td><td class="r">−${money(bl.deposit)}</td></tr>
      <tr class="tot"><td><b>${bl.to_pay >= 0 ? 'To pay' : 'Deposit to refund'}</b></td><td class="r"><b>${money(Math.abs(bl.to_pay))}</b></td></tr></table>
      ${o.notes ? `<p class="muted">${esc(o.notes)}</p>` : ''}</div>` : `<div class="card"><h3>Done</h3><p>${o.invoice_number ? `Invoiced on <a href="#/invoice/${o.invoice_id}">${esc(o.invoice_number)}</a>.` : 'Nothing to invoice.'}</p>${o.notes ? `<p class="muted">${esc(o.notes)}</p>` : ''}</div>`}</div>`, { back: '#/hire' });
  const reload = () => hireOrder(view, [id]);
  const ms = await methods();
  if ($('#ho')) $('#ho').onclick = () => { const f = [{ key: 'date', label: 'Collected / delivered on', type: 'date' }, { key: 'deposit', label: 'Deposit received now (M)', type: 'number' }, { key: 'method_id', label: 'Paid by', type: 'select', numeric: true, options: mOpts(ms) }, { key: 'reference', label: 'Reference' },
    { key: 'no_deposit_ok', label: 'Hand over without the full deposit (trusted customer)', type: 'checkbox', span: 2 }];
    modal({ title: 'Hand over', body: formHtml(f, { date: today(), deposit: Math.max(0, Number(o.deposit_required) - Number(o.deposit_held)) }, { ctx: 'hirepay' }),
      actions: [{ label: 'Cancel' }, { label: 'Hand over', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/hire/orders/${o.id}/handover`, readForm(r, f)); c(); toast('Handed over'); reload(); } }] }); };
  if ($('#hd')) $('#hd').onclick = () => { const f = [{ key: 'amount', label: 'Deposit received (M)', type: 'number', required: true }, { key: 'method_id', label: 'Paid by', type: 'select', numeric: true, options: mOpts(ms) }, { key: 'reference', label: 'Reference' }];
    modal({ title: 'Deposit', body: formHtml(f, {}, { ctx: 'hirepay' }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/hire/orders/${o.id}/deposit`, readForm(r, f)); c(); reload(); } }] }); };
  if ($('#he')) $('#he').onclick = () => {
    if (o.status === 'reserved') return orderDialog(o, reload);
    const f = [{ key: 'end_date', label: 'New return date', type: 'date', required: true }, { key: 'notes', label: 'Notes' }];
    modal({ title: 'Extend the hire', body: formHtml(f, { end_date: d(o.end_date), notes: o.notes }, { ctx: 'hireorder' }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await PUT('/hire/orders/' + o.id, readForm(r, f)); c(); reload(); } }] });
  };
  if ($('#hc')) $('#hc').onclick = () => modal({ title: 'Cancel this hire', body: `<div class="form-grid"><label class="field"><span>Reason</span><input id="cr"></label>${Number(o.deposit_held) ? `<label class="field"><span>Cancellation fee kept from the deposit (M)</span><input id="cf" type="number" value="0"></label>
      <label class="field"><span>Refund the rest by</span><select id="cm">${ms.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></label>` : ''}</div>`,
    actions: [{ label: 'Back' }, { label: 'Cancel hire', cls: 'btn-danger', onClick: async (c, r) => { await POST(`/hire/orders/${o.id}/cancel`, { reason: r.querySelector('#cr').value, fee: r.querySelector('#cf') ? r.querySelector('#cf').value : 0, refund_method_id: r.querySelector('#cm') ? r.querySelector('#cm').value : null }); c(); reload(); } }] });
  if ($('#hr')) $('#hr').onclick = () => {
    const open = o.lines.filter(l => Number(l.qty) > Number(l.qty_back));
    modal({ title: 'Items back', size: 'lg', body: `<label class="field" style="max-width:220px"><span>Returned on</span><input type="date" id="rd" value="${today()}"></label>
      <table class="grid" style="margin-top:10px"><thead><tr><th>Item</th><th class="r">Out</th><th class="r">Back</th><th class="r">of which damaged</th><th class="r">Lost</th><th class="r">Damage / loss charge</th><th>Note</th></tr></thead><tbody>
      ${open.map(l => `<tr data-l="${l.id}" data-rc="${l.replacement_cost}"><td>${esc(l.name)}</td><td class="r">${qty(Number(l.qty) - Number(l.qty_back))}</td><td class="r"><input data-f="qty" type="number" value="${Number(l.qty) - Number(l.qty_back)}" style="width:70px"></td>
        <td class="r"><input data-f="damaged" type="number" value="0" style="width:70px"></td><td class="r"><input data-f="lost" type="number" value="0" style="width:70px"></td><td class="r"><input data-f="damage_charge" type="number" placeholder="replacement" style="width:100px"></td><td><input data-f="note" style="width:140px"></td></tr>`).join('')}</tbody></table>
      <small class="help-note">Count everything as it comes off the truck. Damaged items go out of the hire pool until marked repaired; lost items are charged at the replacement cost unless you type another charge. Leave items that are still with the customer in "Out".</small>`,
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => {
        const lines = $$('[data-l]', r).map(tr => { const g = k => tr.querySelector(`[data-f=${k}]`).value; return { line_id: Number(tr.dataset.l), qty: g('qty'), damaged: g('damaged'), lost: g('lost'), damage_charge: g('damage_charge'), note: g('note') }; });
        await POST(`/hire/orders/${o.id}/return`, { date: r.querySelector('#rd').value, lines }); c(); toast('Return saved'); reload(); } }] });
  };
  if ($('#hs')) $('#hs').onclick = () => {
    const refund = bl.to_pay < 0;
    const f = refund ? [{ key: 'refund_method_id', label: `Refund ${money(-bl.to_pay)} by`, type: 'select', numeric: true, options: mOpts(ms) }, { key: 'keep_credit', label: 'Keep it on the customer\'s account instead', type: 'checkbox' }]
      : [{ key: 'amount', label: 'Amount paid now (M)', type: 'number' }, { key: 'method_id', label: 'Paid by', type: 'select', numeric: true, options: mOpts(ms) }, { key: 'reference', label: 'Reference' }, { key: 'due_date', label: 'Pay by (if not paid now)', type: 'date' }];
    modal({ title: `Settle ${o.number}`, body: `<p>Bill ${money(bl.total)} less deposit ${money(bl.deposit)}.</p>` + formHtml(f, { amount: Math.max(0, bl.to_pay), due_date: plusDays(7) }, { ctx: 'hirepay' }),
      actions: [{ label: 'Cancel' }, { label: 'Settle', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); if (v.keep_credit) delete v.refund_method_id; const x = await POST(`/hire/orders/${o.id}/settle`, v); c(); toast(x.number ? `Invoiced – ${x.number}` : 'Settled'); reload(); } }] });
  };
  $('#hp').onclick = async () => {
    const s = await GET('/hire/settings'); const co = state.company || {};
    printHtml(`<div style="font-family:Arial;font-size:13px;max-width:720px;margin:auto"><h2 style="margin:0">${esc(co.name || '')}</h2><div>${esc(co.address || '')} · ${esc(co.phone || '')}</div>
      <h1 style="font-size:20px">Hire agreement ${esc(o.number)}</h1>
      <p><b>Customer:</b> ${esc(o.customer)} ${o.customer_phone ? '· ' + esc(o.customer_phone) : ''}${o.id_number ? ' · ID ' + esc(o.id_number) : ''}<br><b>Hire:</b> ${esc(d(o.start_date))} to ${esc(d(o.end_date))}<br><b>${o.delivery_address ? 'Deliver to' : 'Collected by customer'}</b> ${esc(o.delivery_address || '')}</p>
      <table border="1" cellpadding="5" style="border-collapse:collapse;width:100%"><tr><th align="left">Item</th><th>Qty</th><th>Per day</th><th>Per week</th><th>Replacement each</th><th>Out ✓</th><th>Back ✓</th></tr>
      ${o.lines.map(l => `<tr><td>${esc(l.name)}</td><td align="center">${qty(l.qty)}</td><td align="right">${money(l.rate_day)}</td><td align="right">${l.rate_week ? money(l.rate_week) : ''}</td><td align="right">${money(l.replacement_cost)}</td><td></td><td></td></tr>`).join('')}</table>
      <p>Deposit required ${money(o.deposit_required)} · received ${money(o.deposit_held)}${Number(o.delivery_fee) ? ` · delivery ${money(o.delivery_fee)}` : ''}${bl ? ` · estimated hire ${money(bl.total)}` : ''}</p>
      <p style="font-size:11.5px">${esc(s.terms)}</p>
      <table style="width:100%;margin-top:30px"><tr><td>Customer signature: ______________________</td><td>For ${esc(co.name || 'the company')}: ______________________</td></tr></table></div>`);
  };
}
