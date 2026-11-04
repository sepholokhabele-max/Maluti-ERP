// Sales: quotations → sales orders → invoices, and promotions / price rules
import { hasMod } from './core.js';
import { state, GET, POST, PUT, DEL, esc, $, $$, toast, err, can, money, qty, modal, confirmBox, promptBox, formHtml, readForm, tableHtml, badge, page, d, today, plusDays, query, round2, printHtml } from './core.js';
import { best as bestRule, describeRule } from './pricing.js';

const STATUS = { quote: ['Quotation', 'draft'], sent: ['Sent', 'posted'], confirmed: ['Order – to invoice', 'partial'], invoiced: ['Invoiced', 'paid'], declined: ['Declined', 'cancelled'], cancelled: ['Cancelled', 'cancelled'] };
const st = (s, expired) => expired ? badge('expired', 'cancelled') : badge(STATUS[s] ? STATUS[s][0] : s, STATUS[s] ? STATUS[s][1] : '');

export async function quotes(view) {
  const stage = query().stage || 'quotes';
  const [rows, sm] = await Promise.all([GET('/sales?stage=' + stage), GET('/sales/summary')]);
  view.innerHTML = page('Quotations & sales orders', `<a class="btn" href="#/promotions">🏷 Promotions</a><a class="btn btn-primary" href="#/quote/new">＋ New quotation</a>`, `
    <div class="cols cols-4" style="margin-bottom:14px">
      <div class="kpi"><div class="label">Open quotations</div><div class="value">${sm.open_quotes}</div><div class="hint">${money(sm.open_quotes_value)}</div></div>
      <div class="kpi"><div class="label">Orders to invoice</div><div class="value">${sm.to_invoice}</div><div class="hint">${money(sm.to_invoice_value)}</div></div>
      <div class="kpi"><div class="label">Won (90 days)</div><div class="value" style="color:var(--ok)">${sm.won_90}</div></div>
      <div class="kpi"><div class="label">Lost (90 days)</div><div class="value">${sm.lost_90}</div><div class="hint">${Number(sm.won_90) + Number(sm.lost_90) ? Math.round(sm.won_90 / (Number(sm.won_90) + Number(sm.lost_90)) * 100) + '% win rate' : ''}</div></div></div>
    <div class="tabs"><a href="#/quotes?stage=quotes" class="${stage === 'quotes' ? 'active' : ''}">Quotations</a><a href="#/quotes?stage=orders" class="${stage === 'orders' ? 'active' : ''}">Sales orders</a><a href="#/quotes?stage=all" class="${stage === 'all' ? 'active' : ''}">All</a></div>
    ${tableHtml([{ key: 'quote_number', label: 'Number', fmt: (v, r) => r.number || v }, { key: 'partner_name', label: 'Customer' }, { key: 'order_date', label: 'Date', fmt: d },
      { key: 'valid_until', label: 'Valid until', fmt: d }, { key: 'status', label: 'Status', html: 1, fmt: (v, r) => st(v, Number(r.expired)) },
      { key: 'total', label: 'Total', right: 1, fmt: money }, { key: 'invoice_number', label: 'Invoice' }, { key: 'user_name', label: 'By' }],
      rows, { rowAttr: r => `data-href="#/quote/${r.id}"`, empty: stage === 'orders' ? 'No sales orders yet – confirm a quotation when the customer accepts it.' : 'No quotations yet. Click "New quotation".' })}`);
  $$('[data-href]').forEach(tr => tr.onclick = () => location.hash = tr.dataset.href);
}

function quoteDocHtml(o) {
  const c = state.company, title = o.number ? 'SALES ORDER' : 'QUOTATION';
  return `<html><head><meta charset="utf-8"><style>body{font-family:Segoe UI,Arial;font-size:13px;color:#111;margin:30px}table{width:100%;border-collapse:collapse}th,td{padding:7px;border-bottom:1px solid #ddd;text-align:left}.r{text-align:right}h1{margin:0;color:#3f3d9e}</style></head><body>
    <table style="border:0"><tr><td style="border:0">${state.logo ? `<img src="${state.logo}" alt="" style="max-height:70px;max-width:220px;margin-bottom:6px"><br>` : ''}<h2 style="margin:0">${esc(c.name || '')}</h2>${esc(c.address || '')}<br>${esc(c.phone || '')} ${esc(c.email || '')}<br>${c.tax_number ? 'VAT: ' + esc(c.tax_number) : ''}</td>
    <td style="border:0" class="r"><h1>${title}</h1><b>${esc(o.number || o.quote_number || 'DRAFT')}</b><br>Date: ${d(o.order_date)}${o.valid_until && !o.number ? '<br>Valid until: ' + d(o.valid_until) : ''}${o.delivery_date ? '<br>Delivery: ' + d(o.delivery_date) : ''}${o.customer_ref ? '<br>Your ref: ' + esc(o.customer_ref) : ''}</td></tr></table>
    <p><b>For:</b><br>${esc(o.partner_name)}<br>${esc(o.partner_address || '')}<br>${esc(o.partner_phone || '')} ${esc(o.partner_email || '')}${o.partner_tax ? '<br>VAT: ' + esc(o.partner_tax) : ''}</p>
    <table><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Discount</th><th class="r">VAT %</th><th class="r">Amount</th></tr>
    ${o.lines.map(l => `<tr><td>${esc(l.description)}${l.rule_name ? `<br><small style="color:#b45309">${esc(l.rule_name)}</small>` : ''}</td><td class="r">${qty(l.qty)}</td><td class="r">${money(l.unit_price)}</td><td class="r">${Number(l.discount_pct) ? Number(l.discount_pct) + '%' : ''}</td><td class="r">${qty(l.tax_rate)}</td><td class="r">${money(l.line_total)}</td></tr>`).join('')}
    ${Number(o.discount_total) ? `<tr><td colspan="5" class="r">You save</td><td class="r">${money(o.discount_total)}</td></tr>` : ''}
    <tr><td colspan="5" class="r">Subtotal (excl. VAT)</td><td class="r">${money(o.subtotal)}</td></tr><tr><td colspan="5" class="r">VAT</td><td class="r">${money(o.tax_total)}</td></tr>
    <tr><td colspan="5" class="r"><b>Total</b></td><td class="r"><b>${money(o.total)}</b></td></tr></table>
    ${o.terms ? `<h4 style="margin-bottom:4px">Terms</h4><p style="white-space:pre-wrap;margin-top:0">${esc(o.terms)}</p>` : ''}${o.notes ? `<p>${esc(o.notes)}</p>` : ''}
    ${!o.number ? '<p style="margin-top:30px">Accepted by: ____________________________ &nbsp; Date: ______________</p>' : ''}</body></html>`;
}

export async function quoteForm(view, [idq]) {
  const id = (idq || '').split('?')[0];
  const isNew = id === 'new';
  const [customers, products, rules] = await Promise.all([GET('/partners?is_customer=1'), GET('/products'), GET('/price-rules/active').catch(() => [])]);
  const settings = await GET('/settings').catch(() => ({ company: {} }));
  const o = isNew ? { partner_id: query().partner_id ? Number(query().partner_id) : (customers[0] || {}).id, order_date: today(), valid_until: plusDays(30), status: 'quote',
    terms: (settings.company && settings.company.quote_terms) || 'Prices valid for 30 days. 50% deposit on order, balance on delivery.', lines: [] } : await GET('/sales/' + id);
  const editable = ['quote', 'sent', 'confirmed'].includes(o.status) && can('sales');
  const lines = (o.lines || []).map(l => ({ ...l, qty: Number(l.qty), unit_price: Number(l.unit_price), discount_pct: Number(l.discount_pct), tax_rate: Number(l.tax_rate), manual: !l.rule_id && Number(l.discount_pct) > 0 }));
  const pmap = new Map(products.map(p => [p.id, p]));
  const vat = Number((state.company && state.company.default_vat) ?? 15);
  const title = isNew ? 'New quotation' : `${o.number || o.quote_number}`;
  const acts = [];
  if (!isNew) acts.push('<button class="btn" id="qPrint">🖨 Print / PDF</button>', '<button class="btn" id="qMail">✉ Email</button>');
  if (editable) acts.push('<button class="btn btn-primary" id="qSave">Save</button>');
  if (!isNew && ['quote', 'sent'].includes(o.status)) acts.push('<button class="btn btn-ok" id="qConfirm">✓ Customer accepted</button>', '<button class="btn" id="qDecline">Declined</button>');
  if (o.status === 'confirmed' && can('invoicing')) acts.push('<button class="btn btn-ok" id="qInvoice">Create invoice</button>');
  if (o.invoice_id) acts.push(`<a class="btn" href="#/invoice/${o.invoice_id}">Open invoice ${esc(o.invoice_number || '')}</a>`);
  if (['confirmed', 'invoiced'].includes(o.status) && can('inventory') && hasMod('manufacturing')) acts.push('<button class="btn" id="qMake">🏭 Make products</button>');
  if (!isNew && ['quote', 'sent', 'confirmed'].includes(o.status)) acts.push('<button class="btn btn-danger" id="qCancel">Cancel</button>');
  if (!isNew && ['declined', 'cancelled'].includes(o.status)) acts.push('<button class="btn" id="qReopen">Reopen</button>');
  if (!isNew) acts.push('<button class="btn" id="qCopy">Duplicate</button>');
  view.innerHTML = page(title, acts.join(''), `
    <div class="card"><div class="row" style="margin-bottom:10px">${isNew ? '' : st(o.status, o.expired)} <span class="muted">${o.number ? `from quotation ${esc(o.quote_number)}` : ''}</span></div>
      <div id="hdr">${formHtml([
        { key: 'partner_id', label: 'Customer', type: 'select', numeric: true, required: true, options: customers.map(c => ({ value: c.id, label: c.name })) },
        { key: 'customer_ref', label: 'Customer reference / their PO no.' },
        { key: 'order_date', label: 'Date', type: 'date' }, { key: 'valid_until', label: 'Valid until', type: 'date' },
        { key: 'delivery_date', label: 'Delivery / event date', type: 'date' }, { key: 'notes', label: 'Note on the document' },
        { key: 'terms', label: 'Terms & conditions', type: 'textarea', rows: 2, span: 2 }], { ...o, order_date: d(o.order_date), valid_until: d(o.valid_until), delivery_date: d(o.delivery_date) }, { ctx: 'quote' })}</div>
      <h3 style="margin:16px 0 8px">Lines <small class="muted" style="font-weight:400">prices excl. VAT · promotions apply automatically</small></h3><div id="ql"></div></div>`);
  if (!editable) $$('#hdr input, #hdr select, #hdr textarea').forEach(i => i.disabled = true);
  const partnerOf = () => { const pid = Number($('#hdr [name=partner_id]').value); const c = customers.find(x => x.id === pid); return c ? { id: c.id, tags: c.tags } : null; };
  const applyRules = () => {
    for (const l of lines) {
      if (!l.product_id || l.manual) continue;
      const p = pmap.get(l.product_id); if (!p) continue;
      const b = bestRule(rules, { product: p, price: Number(p.price), qty: l.qty, partner: partnerOf(), channel: 'invoice' }); // rule values are in shelf prices (incl. VAT)
      l.discount_pct = b.pct; l.rule_id = b.rule ? b.rule.id : null; l.rule_name = b.rule ? b.rule.name : null;
    }
  };
  const calc = l => { const net = round2(Number(l.qty || 0) * Number(l.unit_price || 0) * (1 - Number(l.discount_pct || 0) / 100)); return { net, total: round2(net * (1 + Number(l.tax_rate || 0) / 100)) }; };
  const draw = () => {
    if (editable) applyRules();
    const tot = lines.reduce((a, l) => { const c = calc(l); return { net: a.net + c.net, total: a.total + c.total }; }, { net: 0, total: 0 });
    $('#ql').innerHTML = `<div class="table-wrap"><table class="grid lines"><thead><tr><th style="width:24%">Product</th><th>Description</th><th class="r" style="width:80px">Qty</th><th class="r" style="width:110px">Unit price</th><th class="r" style="width:90px">Disc. %</th><th class="r" style="width:70px">VAT %</th><th class="r" style="width:110px">Total</th>${editable ? '<th style="width:32px"></th>' : ''}</tr></thead><tbody>
      ${lines.map((l, i) => editable ? `<tr data-row="${i}"><td><select data-i="${i}" data-k="product_id"><option value="">— service / free text —</option>${products.filter(p => p.active !== 0).map(p => `<option value="${p.id}" ${p.id === Number(l.product_id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></td>
          <td><input data-i="${i}" data-k="description" value="${esc(l.description || '')}"><small class="promo-tag" data-tag>${l.rule_name ? `🏷 ${esc(l.rule_name)}` : ''}</small></td>
          <td><input data-i="${i}" data-k="qty" type="number" step="any" class="r" value="${l.qty}"></td><td><input data-i="${i}" data-k="unit_price" type="number" step="0.0001" class="r" value="${l.unit_price}"></td>
          <td><input data-i="${i}" data-k="discount_pct" type="number" step="any" class="r" value="${Number(l.discount_pct) || ''}" placeholder="0"></td><td><input data-i="${i}" data-k="tax_rate" type="number" step="any" class="r" value="${l.tax_rate}"></td>
          <td class="r" data-tot>${money(calc(l).total)}</td><td><button class="icon-btn" data-del="${i}">✕</button></td></tr>`
        : `<tr><td>${esc((pmap.get(l.product_id) || {}).name || '')}</td><td>${esc(l.description)}${l.rule_name ? ` <small class="promo-tag">🏷 ${esc(l.rule_name)}</small>` : ''}</td><td class="r">${qty(l.qty)}</td><td class="r">${money(l.unit_price)}</td><td class="r">${Number(l.discount_pct) ? Number(l.discount_pct) + '%' : ''}</td><td class="r">${qty(l.tax_rate)}</td><td class="r">${money(l.line_total ?? calc(l).total)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="6" class="r">Excl. VAT</td><td class="r" id="qNet">${money(tot.net)}</td>${editable ? '<td></td>' : ''}</tr><tr><td colspan="6" class="r"><b>Total incl. VAT</b></td><td class="r"><b id="qTot">${money(tot.total)}</b></td>${editable ? '<td></td>' : ''}</tr></tfoot></table></div>
      ${editable ? '<button class="btn btn-sm" id="qAdd" style="margin-top:8px">＋ Add line</button>' : ''}`;
    if (!editable) return;
    // typing only updates the numbers in place (no redraw, so Tab keeps working); choosing a product redraws
    const refresh = () => {
      applyRules();
      lines.forEach((l, i) => {
        const tr = $(`[data-row="${i}"]`, $('#ql')); if (!tr) return;
        tr.querySelector('[data-tot]').textContent = money(calc(l).total);
        const dEl = tr.querySelector('[data-k="discount_pct"]'); if (!l.manual && document.activeElement !== dEl) dEl.value = Number(l.discount_pct) || '';
        tr.querySelector('[data-tag]').innerHTML = l.rule_name ? `🏷 ${esc(l.rule_name)}` : '';
      });
      const t = lines.reduce((a, l) => { const c = calc(l); return { net: a.net + c.net, total: a.total + c.total }; }, { net: 0, total: 0 });
      $('#qNet').textContent = money(t.net); $('#qTot').textContent = money(t.total);
    };
    $$('[data-k]', $('#ql')).forEach(el => {
      const k = el.dataset.k;
      if (k === 'product_id') { el.onchange = () => {
        const l = lines[Number(el.dataset.i)];
        l.product_id = el.value ? Number(el.value) : null;
        const p = pmap.get(l.product_id);
        if (p) { l.description = p.name; l.tax_rate = Number(p.tax_rate ?? vat); l.unit_price = round2(Number(p.price) / (1 + l.tax_rate / 100)); l.manual = false; }
        draw();
      }; return; }
      el.oninput = () => {
        const l = lines[Number(el.dataset.i)];
        if (k === 'description') l.description = el.value;
        else { l[k] = Number(el.value || 0); if (k === 'discount_pct') l.manual = el.value !== ''; }
        refresh();
      };
    });
    $$('[data-del]', $('#ql')).forEach(b => b.onclick = () => { lines.splice(Number(b.dataset.del), 1); draw(); });
    $('#qAdd').onclick = () => { lines.push({ product_id: null, description: '', qty: 1, unit_price: 0, discount_pct: 0, tax_rate: vat }); draw(); };
  };
  if (!lines.length && editable) lines.push({ product_id: null, description: '', qty: 1, unit_price: 0, discount_pct: 0, tax_rate: vat });
  draw();
  $('#hdr [name=partner_id]') && ($('#hdr [name=partner_id]').onchange = () => draw());
  const body = () => ({ ...readForm($('#hdr'), [{ key: 'partner_id', type: 'select', numeric: true }, { key: 'customer_ref' }, { key: 'order_date' }, { key: 'valid_until' }, { key: 'delivery_date' }, { key: 'notes' }, { key: 'terms' }]),
    lines: lines.map(l => ({ product_id: l.product_id || null, description: l.description, qty: l.qty, unit_price: l.unit_price, discount_pct: l.discount_pct || 0, tax_rate: l.tax_rate, rule_id: l.manual ? null : l.rule_id })) });
  const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = async () => { el.disabled = true; try { await fn(); } catch (e) { err(e); } el.disabled = false; }; };
  const reload = () => quoteForm(view, [String(o.id)]);
  on('#qSave', async () => { const r = isNew ? await POST('/sales', body()) : await PUT('/sales/' + id, body()); toast('Saved'); if (isNew) location.hash = '#/quote/' + r.id; else reload(); });
  on('#qConfirm', async () => { await PUT('/sales/' + id, body()); const ref = await promptBox('Customer accepted – their order / reference number (optional)', { value: o.customer_ref || '' }); if (ref === null) return; await POST(`/sales/${id}/confirm`, { customer_ref: ref || null }); toast('Quotation confirmed – it is now a sales order'); reload(); });
  on('#qDecline', async () => { if (await confirmBox('Mark this quotation as declined by the customer?')) { await POST(`/sales/${id}/decline`); reload(); } });
  on('#qCancel', async () => { if (await confirmBox('Cancel this document?', { danger: true })) { await POST(`/sales/${id}/cancel`); reload(); } });
  on('#qReopen', async () => { await POST(`/sales/${id}/reopen`); reload(); });
  on('#qInvoice', async () => { const r = await POST(`/sales/${id}/invoice`, {}); toast('Draft invoice created – check it and post it'); location.hash = '#/invoice/' + r.invoice_id; });
  on('#qPrint', async () => { printHtml(quoteDocHtml(o)); if (o.status === 'quote') { await POST(`/sales/${id}/sent`); reload(); } });
  on('#qMail', async () => {
    const to = await promptBox('Send to email address', { value: o.partner_email || '' }); if (!to) return;
    await POST(`/sales/${id}/email`, { to, html: quoteDocHtml(o) }); toast('Emailed to ' + to); reload();
  });
  on('#qMake', async () => {
    const wos = await GET(`/sales/${o.id}/work-orders`);
    modal({ title: `Make products for ${o.number}`, body: `${wos.length ? `<p>Already planned:</p>${tableHtml([{ key: 'number', label: 'Work order' }, { key: 'product_name', label: 'Product' }, { key: 'qty_planned', label: 'Qty', right: 1, fmt: qty }, { key: 'status', label: 'Status' }], wos)}` : ''}
      <p>Work orders are made for every product on this order that has a bill of materials.</p>
      <label class="row" style="gap:6px"><input type="checkbox" id="mAll"> Make the full quantity (do not use what is already in stock)</label>`,
      actions: [{ label: 'Cancel' }, { label: 'Make work orders', cls: 'btn-primary', onClick: async (c, r) => {
        const out = await POST(`/sales/${o.id}/manufacture`, { all: r.querySelector('#mAll').checked });
        c(); toast(out.work_orders.length ? `${out.work_orders.length} work order(s): ${out.work_orders.map(w => `${w.number} ${w.qty} × ${w.product}`).join(', ')}` : 'Nothing to make – stock covers the order or it is already planned', 'ok', 7000);
      } }] });
  });
  on('#qCopy', async () => { const r = await POST('/sales', { ...body(), order_date: today(), valid_until: plusDays(30), customer_ref: null }); toast('Copied to a new quotation'); location.hash = '#/quote/' + r.id; });
}

// ---------------------------------------------------------------- promotions / price rules
const KINDS = [['percent', '% off'], ['amount_off', 'Amount off each'], ['fixed_price', 'Special price (incl. VAT)'], ['multibuy', 'Multi-buy (e.g. 3 for 2)']];
const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];
export async function promotions(view) {
  const rows = await GET('/price-rules?all=1');
  const when = r => [r.days ? String(r.days).split(',').map(x => (DAYS.find(dd => dd[0] === Number(x)) || [])[1]).join(' ') : '', r.time_from ? `${String(r.time_from).slice(0, 5)}–${String(r.time_to).slice(0, 5)}` : '',
    r.date_from || r.date_to ? `${d(r.date_from) || '…'} → ${d(r.date_to) || '…'}` : ''].filter(Boolean).join(' · ') || 'always';
  view.innerHTML = page('Promotions & price rules', `<a class="btn" href="#/quotes">Quotations</a><button class="btn btn-primary" id="nr">＋ New promotion</button>`, `
    <p class="muted" style="margin-top:0">Promotions apply automatically at the till and on quotations: specials, happy hour, "3 for 2", and special prices for customer groups (tag customers e.g. <i>wholesale</i> in Contacts). If several apply, the customer gets the best one.</p>
    ${tableHtml([{ key: 'name', label: 'Promotion', html: 1, fmt: (v, r) => `<b>${esc(v)}</b>${Number(r.active) ? '' : ' ' + badge('off', 'cancelled')}` }, { key: 'kind', label: 'Deal', fmt: (v, r) => describeRule(r) },
      { key: 'applies_to', label: 'On', fmt: (v, r) => v === 'all' ? 'everything' : v === 'category' ? `category ${r.category_name || ''}` : r.product_name || '' },
      { key: 'customer_scope', label: 'Customers', fmt: (v, r) => v === 'all' ? 'everyone' : v === 'tag' ? `tag "${r.partner_tag}"` : r.partner_name || '' },
      { key: 'min_qty', label: 'Min qty', right: 1, fmt: (v, r) => r.kind === 'multibuy' ? '' : Number(v) ? qty(v) : '' }, { key: 'days', label: 'When', fmt: (v, r) => when(r) },
      { key: 'on_pos', label: 'Where', fmt: (v, r) => [Number(r.on_pos) ? 'till' : '', Number(r.on_invoice) ? 'quotes/invoices' : ''].filter(Boolean).join(', ') }],
      rows, { rowAttr: r => `data-r="${r.id}"`, empty: 'No promotions yet.' })}`);
  $('#nr').onclick = () => editRule(null, () => promotions(view));
  $$('[data-r]').forEach(tr => tr.onclick = () => editRule(rows.find(r => String(r.id) === tr.dataset.r), () => promotions(view)));
}

async function editRule(rule, done) {
  const [products, cats, customers] = await Promise.all([GET('/products'), GET('/categories'), GET('/partners?is_customer=1')]);
  const f = [
    { key: 'name', label: 'Name', required: true, span: 2 },
    { key: 'kind', label: 'Type of deal', type: 'select', options: KINDS.map(([v, l]) => ({ value: v, label: l })) },
    { key: 'value', label: 'Value', type: 'number', step: '0.01' },
    { key: 'min_qty', label: 'Minimum quantity / multi-buy "buy"', type: 'number', step: 'any' }, { key: 'free_qty', label: 'Multi-buy: how many free', type: 'number', step: 'any' },
    { key: 'applies_to', label: 'Applies to', type: 'select', options: [{ value: 'product', label: 'One product' }, { value: 'category', label: 'A category' }, { value: 'all', label: 'Everything' }] },
    { key: 'product_id', label: 'Product', type: 'select', numeric: true, options: [{ value: '', label: '—' }, ...products.map(p => ({ value: p.id, label: p.name }))] },
    { key: 'category_id', label: 'Category', type: 'select', numeric: true, options: [{ value: '', label: '—' }, ...cats.map(c => ({ value: c.id, label: c.name }))] },
    { key: 'customer_scope', label: 'For which customers', type: 'select', options: [{ value: 'all', label: 'Everyone' }, { value: 'tag', label: 'Customers with a tag' }, { value: 'partner', label: 'One customer' }] },
    { key: 'partner_tag', label: 'Customer tag', placeholder: 'e.g. wholesale' },
    { key: 'partner_id', label: 'Customer', type: 'select', numeric: true, options: [{ value: '', label: '—' }, ...customers.map(c => ({ value: c.id, label: c.name }))] },
    { key: 'time_from', label: 'From time (happy hour)', type: 'time' }, { key: 'time_to', label: 'To time', type: 'time' },
    { key: 'date_from', label: 'Starts on', type: 'date' }, { key: 'date_to', label: 'Ends on', type: 'date' },
    { key: 'on_pos', label: 'Apply at the till', type: 'checkbox', default: 1 }, { key: 'on_invoice', label: 'Apply on quotations & invoices', type: 'checkbox', default: 1 },
    { key: 'active', label: 'Active', type: 'checkbox', default: 1 }];
  const vals = rule ? { ...rule, time_from: rule.time_from ? String(rule.time_from).slice(0, 5) : '', time_to: rule.time_to ? String(rule.time_to).slice(0, 5) : '', date_from: d(rule.date_from), date_to: d(rule.date_to) }
    : { kind: 'percent', applies_to: 'product', customer_scope: 'all', on_pos: 1, on_invoice: 1, active: 1, min_qty: 0, free_qty: 0 };
  const dayBox = `<div class="field" style="margin-top:12px"><span>Days (none ticked = every day)</span><div class="row wrap">${DAYS.map(([n, l]) => `<label class="chip" style="cursor:pointer"><input type="checkbox" data-day="${n}" ${String(rule && rule.days || '').split(',').includes(String(n)) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
    <small class="help-note">Tick days for weekly deals, e.g. "Meat Monday" or Friday–Saturday happy hour.</small></div>`;
  const acts = [{ label: 'Cancel' }];
  if (rule) acts.push({ label: Number(rule.active) ? 'Switch off' : 'Switch on', onClick: async c => { await PUT('/price-rules/' + rule.id, { ...rule, active: Number(rule.active) ? 0 : 1 }); c(); done(); } });
  acts.push({ label: 'Save', cls: 'btn-primary', onClick: async (c, r) => {
    const v = readForm(r, f); v.days = $$('[data-day]', r).filter(x => x.checked).map(x => x.dataset.day).join(',');
    if (rule) await PUT('/price-rules/' + rule.id, v); else await POST('/price-rules', v);
    c(); toast('Promotion saved'); done();
  } });
  modal({ title: rule ? 'Edit promotion' : 'New promotion', wide: true, body: formHtml(f, vals, { ctx: 'rule' }) + dayBox, actions: acts, onOpen: r => {
    const vis = () => {
      const v = k => r.querySelector(`[name=${k}]`).value, show = (k, on) => { const el = r.querySelector(`[name=${k}]`).closest('.field'); el.style.display = on ? '' : 'none'; };
      show('product_id', v('applies_to') === 'product'); show('category_id', v('applies_to') === 'category');
      show('partner_tag', v('customer_scope') === 'tag'); show('partner_id', v('customer_scope') === 'partner'); show('free_qty', v('kind') === 'multibuy'); show('value', v('kind') !== 'multibuy');
    };
    ['applies_to', 'customer_scope', 'kind'].forEach(k => r.querySelector(`[name=${k}]`).addEventListener('change', vis)); vis();
  } });
}
