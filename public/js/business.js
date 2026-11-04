// Purchasing, invoicing, accounting and reports
import { attachScale } from './scale.js';
import { multiLocation, locationOptions } from './core.js';
import { state, GET, POST, PUT, esc, $, $$, toast, err, can, money, qty, modal, confirmBox, promptBox, formHtml, readForm, tableHtml, badge, page, dt, d, today, plusDays, query, round2, printHtml } from './core.js';

// ---------------------------------------------------------------- shared line editor
function lineEditor(root, { products, lines, priceKey, defaultTax, readOnly, onChange }) {
  const pmap = new Map(products.map(p => [p.id, p]));
  const draw = () => {
    root.innerHTML = `<div class="table-wrap"><table class="grid lines"><thead><tr><th style="width:28%">Product</th><th>Description</th><th style="width:90px" class="r">Qty</th>
      <th style="width:120px" class="r">Unit ${priceKey === 'unit_cost' ? 'cost' : 'price'} (excl.)</th><th style="width:80px" class="r">VAT %</th><th style="width:120px" class="r">Total</th>${readOnly ? '' : '<th style="width:36px"></th>'}</tr></thead><tbody>
      ${lines.map((l, i) => {
        const t = round2(Number(l.qty || 0) * Number(l[priceKey] || 0) * (1 + Number(l.tax_rate || 0) / 100));
        if (readOnly) return `<tr><td>${esc((pmap.get(l.product_id) || {}).name || '')}</td><td>${esc(l.description || '')}</td><td class="r">${qty(l.qty)}${l.qty_received != null ? `<br><small class="muted">rcvd ${qty(l.qty_received)}</small>` : ''}</td><td class="r">${money(l[priceKey])}</td><td class="r">${qty(l.tax_rate)}</td><td class="r">${money(l.line_total ?? t)}</td></tr>`;
        return `<tr><td><select data-i="${i}" data-k="product_id"><option value="">— free text —</option>${products.map(p => `<option value="${p.id}" ${p.id === Number(l.product_id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></td>
          <td><input data-i="${i}" data-k="description" value="${esc(l.description || '')}"></td>
          <td><input data-i="${i}" data-k="qty" type="number" step="any" class="r" value="${l.qty}"></td>
          <td><input data-i="${i}" data-k="${priceKey}" type="number" step="0.0001" class="r" value="${l[priceKey]}"></td>
          <td><input data-i="${i}" data-k="tax_rate" type="number" step="any" class="r" value="${l.tax_rate}"></td>
          <td class="r" data-tot="${i}">${money(t)}</td><td><button class="icon-btn" data-del="${i}">✕</button></td></tr>`;
      }).join('')}</tbody>
      <tfoot><tr><td colspan="${readOnly ? 5 : 5}" class="r">Total</td><td class="r" id="gt"></td>${readOnly ? '' : '<td></td>'}</tr></tfoot></table></div>
      ${readOnly ? '' : '<button class="btn btn-sm" id="addl" style="margin-top:8px">＋ Add line</button>'}`;
    const gt = () => { const s = lines.reduce((a, l) => a + Number(l.qty || 0) * Number(l[priceKey] || 0) * (1 + Number(l.tax_rate || 0) / 100), 0); root.querySelector('#gt').textContent = money(s); onChange && onChange(s); };
    gt();
    if (readOnly) return;
    $$('[data-k]', root).forEach(el => el.oninput = el.onchange = () => {
      const l = lines[Number(el.dataset.i)], k = el.dataset.k;
      l[k] = ['qty', priceKey, 'tax_rate'].includes(k) ? Number(el.value) : k === 'product_id' ? (el.value ? Number(el.value) : null) : el.value;
      if (k === 'product_id' && l.product_id) {
        const p = pmap.get(l.product_id);
        l.description = p.name; l[priceKey] = priceKey === 'unit_cost' ? Number(p.cost) : round2(Number(p.price) / (1 + Number(p.tax_rate || 0) / 100));
        l.tax_rate = Number(p.tax_rate ?? defaultTax); draw(); return;
      }
      root.querySelector(`[data-tot="${el.dataset.i}"]`).textContent = money(Number(l.qty || 0) * Number(l[priceKey] || 0) * (1 + Number(l.tax_rate || 0) / 100));
      gt();
    });
    $$('[data-del]', root).forEach(b => b.onclick = () => { lines.splice(Number(b.dataset.del), 1); draw(); });
    root.querySelector('#addl').onclick = () => { lines.push({ product_id: null, description: '', qty: 1, [priceKey]: 0, tax_rate: defaultTax }); draw(); };
  };
  draw();
}

// ---------------------------------------------------------------- purchasing
export async function purchases(view) {
  const rows = await GET('/purchases');
  view.innerHTML = page('Purchase orders', `<a class="btn" href="#/rfqs">📨 Price requests (RFQ)</a><a class="btn" href="#/partners?type=supplier">Suppliers</a><a class="btn" href="#/invoices?kind=supplier_bill">Supplier bills</a><a class="btn btn-primary" href="#/purchase/new">＋ New purchase order</a>`,
    tableHtml([{ key: 'number', label: 'Number' }, { key: 'supplier_name', label: 'Supplier' }, { key: 'order_date', label: 'Date', fmt: d }, { key: 'expected_date', label: 'Expected', fmt: d },
      { key: 'status', label: 'Status', html: 1, fmt: v => badge(v) }, { key: 'billed', label: 'Billed', fmt: v => v ? 'Yes' : '' }, { key: 'total', label: 'Total', right: 1, fmt: money }], rows,
      { rowAttr: r => `data-href="#/purchase/${r.id}"`, empty: 'No purchase orders yet.' }));
  $$('[data-href]').forEach(tr => tr.onclick = () => location.hash = tr.dataset.href);
}

export async function purchaseForm(view, [id]) {
  const [suppliers, products] = await Promise.all([GET('/partners?is_supplier=1'), GET('/products')]);
  const isNew = id === 'new';
  const po = isNew ? { supplier_id: suppliers[0] && suppliers[0].id, order_date: today(), status: 'draft', lines: [], location_id: state.user.location_id || '' } : await GET('/purchases/' + id);
  const locF = await multiLocation() ? [{ key: 'location_id', label: 'Deliver to (branch / warehouse)', type: 'select', numeric: true, options: await locationOptions('Default location'),
    help: 'Where the goods will be received. Stock goes up at this location when you click Receive goods.' }] : [];
  const dv = Number(state.company.default_vat ?? 15);
  const lines = po.lines.map(l => ({ ...l }));
  if (isNew) lines.push({ product_id: null, description: '', qty: 1, unit_cost: 0, tax_rate: dv });
  const draft = po.status === 'draft';
  const acts = [];
  if (draft) acts.push('<button class="btn btn-primary" id="save">Save</button>');
  if (!isNew && draft) acts.push('<button class="btn btn-ok" id="confirm">Confirm order</button>');
  if (['confirmed', 'partial'].includes(po.status)) acts.push('<button class="btn btn-ok" id="receive">Receive goods</button>');
  if (!isNew && !po.billed && ['confirmed', 'partial', 'received'].includes(po.status)) acts.push('<button class="btn" id="bill">Create bill</button>');
  if (po.status === 'to_approve' && can('purchase.approve')) acts.push('<button class="btn btn-ok" id="approve">✓ Approve</button><button class="btn" id="sendback">Send back</button>');
  if (!isNew && ['draft', 'to_approve', 'confirmed'].includes(po.status)) acts.push('<button class="btn btn-danger" id="cancel">Cancel</button>');
  if (!isNew) acts.push('<button class="btn" id="print">Print</button>');
  view.innerHTML = page(isNew ? 'New purchase order' : `${po.number}`, acts.join(''), `
    <div class="card"><div class="row" style="margin-bottom:12px">${!isNew ? (po.status === 'to_approve' ? badge('waiting for approval', 'draft') : badge(po.status)) : ''}${po.bills && po.bills.length ? po.bills.map(b => `<a href="#/invoice/${b.id}" class="btn btn-sm">🧾 ${esc(b.number || 'Draft bill')} ${badge(b.status)}</a>`).join('') : ''}</div>
      <div id="hdr">${formHtml([
        { key: 'supplier_id', label: 'Supplier', type: 'select', options: suppliers.map(s => ({ value: s.id, label: s.name })) },
        { key: 'order_date', label: 'Order date', type: 'date' }, { key: 'expected_date', label: 'Expected delivery', type: 'date' }, { key: 'notes', label: 'Notes' }, ...locF
      ], { ...po, order_date: d(po.order_date), expected_date: d(po.expected_date) })}</div>
      <h3 style="margin:16px 0 8px">Lines</h3><div id="le"></div></div>`, { back: '#/purchases' });
  if (!draft) $$('#hdr input, #hdr select').forEach(i => i.disabled = true);
  lineEditor($('#le'), { products, lines, priceKey: 'unit_cost', defaultTax: dv, readOnly: !draft });
  const body = () => ({ ...readForm($('#hdr'), [{ key: 'supplier_id', type: 'select', numeric: true }, { key: 'order_date' }, { key: 'expected_date' }, { key: 'notes' }, ...locF]), lines });
  const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = async () => { el.disabled = true; try { await fn(); } catch (e) { err(e); } el.disabled = false; }; };
  on('#save', async () => { const r = isNew ? await POST('/purchases', body()) : await PUT('/purchases/' + id, body()); toast('Saved'); location.hash = '#/purchase/' + r.id; if (!isNew) purchaseForm(view, [id]); });
  on('#confirm', async () => { await PUT('/purchases/' + id, body()); const x = await POST(`/purchases/${id}/confirm`); toast(x.message || 'Order confirmed', x.status === 'to_approve' ? 'err' : 'ok', 6000); purchaseForm(view, [id]); });
  on('#approve', async () => { await POST(`/purchases/${id}/approve`); toast('Approved – the order can now be received'); purchaseForm(view, [id]); });
  on('#sendback', async () => { const why = await promptBox('Why is it sent back?'); if (why === null) return; await POST(`/purchases/${id}/reject`, { reason: why }); purchaseForm(view, [id]); });
  on('#cancel', async () => { if (await confirmBox('Cancel this order?', { danger: true })) { await POST(`/purchases/${id}/cancel`); purchaseForm(view, [id]); } });
  on('#bill', async () => { const r = await POST(`/purchases/${id}/bill`); toast('Draft bill created'); location.hash = '#/invoice/' + r.id; });
  on('#print', async () => printHtml(docHtml('PURCHASE ORDER', po.number, { name: po.supplier_name, address: po.supplier_address, email: po.supplier_email, phone: po.supplier_phone }, po.order_date, po.lines.map(l => ({ ...l, unit_price: l.unit_cost })), po)));
  on('#receive', async () => {
    const anyBatch = po.lines.some(l => l.track_batches);
    const carcassLines = po.lines.filter(l => l.is_carcass && Number(l.qty) - Number(l.qty_received) > 0);
    const pieces = {}; // line id -> [{ batch_no, qty }]
    for (const l of carcassLines) pieces[l.id] = [{ batch_no: '', qty: '', live: '' }];
    const piecesHtml = l => `<tr class="pieces-row"><td colspan="${anyBatch ? 6 : 4}" style="background:var(--bg)"><div class="muted" style="font-size:12px;margin-bottom:4px">Weigh each ${esc(l.description)} and give it its tag (tag · carcass kg · live kg) – every carcass is traced separately. Live weight is optional – it gives the dressing % (carcass ÷ live). Leave empty to receive as one batch.</div>
      <div class="row wrap" data-pcs="${l.id}">${pieces[l.id].map((p, i) => `<span class="row" style="gap:4px"><input placeholder="tag / no." data-pt="${l.id}:${i}" value="${esc(p.batch_no)}" style="width:110px"><input type="number" step="0.001" placeholder="carcass kg" data-pq="${l.id}:${i}" value="${p.qty}" data-scale style="width:110px"><input type="number" step="0.1" placeholder="live kg" data-pl="${l.id}:${i}" value="${p.live}" style="width:90px"><span class="muted" data-pd="${l.id}:${i}" style="font-size:11px;min-width:44px">${Number(p.live) > 0 && Number(p.qty) > 0 ? (p.qty / p.live * 100).toFixed(1) + '%' : ''}</span></span>`).join('')}
      <button class="btn btn-sm" data-padd="${l.id}">＋ carcass</button><span class="muted" data-psum="${l.id}"></span></div></td></tr>`;
    modal({ title: 'Receive goods', wide: anyBatch, size: anyBatch ? undefined : 'lg', body: `<table class="grid lines"><thead><tr><th>Item</th><th class="r">Ordered</th><th class="r">Received</th><th style="width:120px">Receive now</th>${anyBatch ? '<th>Batch / lot no.</th><th>Use-by date</th>' : ''}</tr></thead><tbody>
      ${po.lines.map(l => `<tr><td>${esc(l.description)}</td><td class="r">${qty(l.qty)}</td><td class="r">${qty(l.qty_received)}</td><td><input type="number" step="any" data-l="${l.id}" value="${Number(l.qty) - Number(l.qty_received)}"></td>
        ${anyBatch ? (l.track_batches ? `<td><input data-bn="${l.id}" placeholder="auto"></td><td><input type="date" data-ex="${l.id}" value="${l.shelf_life_days ? plusDays(l.shelf_life_days) : ''}"></td>` : '<td></td><td></td>') : ''}</tr>
        ${pieces[l.id] ? piecesHtml(l) : ''}`).join('')}</tbody></table>
      ${anyBatch ? '<p class="muted" style="font-size:12px">Batch-tracked items get a batch with this use-by date; sales take stock from the batch that expires first.</p>' : ''}`,
      onOpen: r => {
        const wire = () => {
          if (state.butchery) attachScale(r, state.butchery, { onError: m => err(new Error(m)) });
          $$('[data-pt]', r).forEach(i => i.oninput = () => { const [lid, k] = i.dataset.pt.split(':'); pieces[lid][k].batch_no = i.value; });
          const dress = (lid, k) => { const p = pieces[lid][k], e = r.querySelector(`[data-pd="${lid}:${k}"]`); if (e) e.textContent = Number(p.live) > 0 && Number(p.qty) > 0 ? (p.qty / p.live * 100).toFixed(1) + '%' : ''; };
          $$('[data-pl]', r).forEach(i => i.oninput = () => { const [lid, k] = i.dataset.pl.split(':'); pieces[lid][k].live = i.value; dress(lid, k); });
          $$('[data-pq]', r).forEach(i => i.oninput = () => {
            const [lid, k] = i.dataset.pq.split(':'); pieces[lid][k].qty = i.value; dress(lid, k);
            const sum = Math.round(pieces[lid].reduce((s, p) => s + Number(p.qty || 0), 0) * 1000) / 1000;
            const q = r.querySelector(`[data-l="${lid}"]`); if (sum > 0) q.value = sum;
            r.querySelector(`[data-psum="${lid}"]`).textContent = sum > 0 ? `${pieces[lid].filter(p => Number(p.qty) > 0).length} carcasses · ${sum} kg` : '';
          });
          $$('[data-padd]', r).forEach(b => b.onclick = () => {
            const lid = b.dataset.padd; pieces[lid].push({ batch_no: '', qty: '', live: '' });
            const l = po.lines.find(x => String(x.id) === lid);
            const tr = b.closest('tr'); tr.outerHTML = piecesHtml(l); wire();
            const last = r.querySelector(`[data-pt="${lid}:${pieces[lid].length - 1}"]`); if (last) last.focus();
          });
        };
        wire();
      },
      actions: [{ label: 'Cancel' }, { label: 'Receive', cls: 'btn-ok', onClick: async (c, r) => {
        const res = await POST(`/purchases/${id}/receive`, { lines: $$('[data-l]', r).map(i => { const lid = i.dataset.l; const bn = r.querySelector(`[data-bn="${lid}"]`), ex = r.querySelector(`[data-ex="${lid}"]`);
          const pcs = (pieces[lid] || []).filter(p => Number(p.qty) > 0).map(p => ({ batch_no: p.batch_no || null, qty: Number(p.qty), live_weight: Number(p.live) || null }));
          return { line_id: Number(lid), qty: Number(i.value), batch_no: bn && bn.value || null, expiry_date: ex && ex.value || null, ...(pcs.length ? { pieces: pcs } : {}) }; }) });
        c(); toast(`Stock received (${money(res.value)})`); purchaseForm(view, [id]);
      } }] });
  });
}

function docHtml(title, number, partner, date, lines, doc) {
  const c = state.company;
  return `<html><head><style>body{font-family:Segoe UI,Arial;font-size:13px;color:#111;margin:30px}table{width:100%;border-collapse:collapse}th,td{padding:7px;border-bottom:1px solid #ddd;text-align:left}.r{text-align:right}h1{margin:0;color:#3f3d9e}</style></head><body>
    <table style="border:0"><tr><td style="border:0">${state.logo ? `<img src="${state.logo}" alt="" style="max-height:70px;max-width:220px;margin-bottom:6px"><br>` : ''}<h2 style="margin:0">${esc(c.name || '')}</h2>${esc(c.address || '')}<br>${esc(c.phone || '')} ${esc(c.email || '')}<br>${c.tax_number ? 'VAT: ' + esc(c.tax_number) : ''}</td>
    <td style="border:0" class="r"><h1>${title}</h1><b>${esc(number || 'DRAFT')}</b><br>Date: ${d(date)}${doc.due_date ? '<br>Due: ' + d(doc.due_date) : ''}</td></tr></table>
    <p><b>${title.includes('PURCHASE') ? 'Supplier' : 'Bill to'}:</b><br>${esc(partner.name)}<br>${esc(partner.address || '')}<br>${esc(partner.phone || '')} ${esc(partner.email || '')}${partner.tax ? '<br>VAT: ' + esc(partner.tax) : ''}</p>
    <table><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">VAT %</th><th class="r">Amount</th></tr>
    ${lines.map(l => `<tr><td>${esc(l.description)}</td><td class="r">${qty(l.qty)}</td><td class="r">${money(l.unit_price)}</td><td class="r">${qty(l.tax_rate)}</td><td class="r">${money(l.line_total)}</td></tr>`).join('')}
    <tr><td colspan="4" class="r">Subtotal</td><td class="r">${money(doc.subtotal)}</td></tr><tr><td colspan="4" class="r">VAT</td><td class="r">${money(doc.tax_total)}</td></tr>
    <tr><td colspan="4" class="r"><b>Total</b></td><td class="r"><b>${money(doc.total)}</b></td></tr>
    ${doc.amount_paid != null ? `<tr><td colspan="4" class="r">Paid</td><td class="r">${money(doc.amount_paid)}</td></tr><tr><td colspan="4" class="r"><b>Balance due</b></td><td class="r"><b>${money(doc.total - doc.amount_paid)}</b></td></tr>` : ''}</table>
    ${doc.notes ? `<p>${esc(doc.notes)}</p>` : ''}</body></html>`;
}

// ---------------------------------------------------------------- invoices & bills
export async function invoices(view) {
  const kind = query().kind || 'customer_invoice';
  const rows = await GET('/invoices?kind=' + kind);
  const cust = kind === 'customer_invoice';
  view.innerHTML = page(cust ? 'Customer invoices' : 'Supplier bills', `<a class="btn btn-primary" href="#/invoice/new?kind=${kind}">＋ New ${cust ? 'invoice' : 'bill'}</a>`, `
    <div class="tabs"><a href="#/invoices?kind=customer_invoice" class="${cust ? 'active' : ''}">Customer invoices</a><a href="#/invoices?kind=supplier_bill" class="${!cust ? 'active' : ''}">Supplier bills</a></div>
    ${tableHtml([{ key: 'number', label: 'Number', fmt: v => v || 'Draft' }, { key: 'partner_name', label: cust ? 'Customer' : 'Supplier' }, { key: 'invoice_date', label: 'Date', fmt: d }, { key: 'due_date', label: 'Due', fmt: d },
      { key: 'status', label: 'Status', html: 1, fmt: (v, r) => badge(v) + (['posted', 'partial'].includes(v) && r.days_overdue > 0 ? ` <small style="color:var(--bad)">${r.days_overdue}d overdue</small>` : '') },
      { key: 'total', label: 'Total', right: 1, fmt: money }, { key: 'amount_paid', label: 'Due', right: 1, fmt: (v, r) => money(r.total - v) }], rows, { rowAttr: r => `data-href="#/invoice/${r.id}"`, empty: 'Nothing yet.' })}`);
  $$('[data-href]').forEach(tr => tr.onclick = () => location.hash = tr.dataset.href);
}

export async function invoiceForm(view, [idq]) {
  const id = (idq || '').split('?')[0];
  const isNew = id === 'new';
  const inv = isNew ? { kind: query().kind || 'customer_invoice', partner_id: query().partner_id ? Number(query().partner_id) : undefined, invoice_date: today(), status: 'draft', lines: [] } : await GET('/invoices/' + id);
  const cust = inv.kind === 'customer_invoice';
  const [partners, products, methods] = await Promise.all([GET(cust ? '/partners?is_customer=1' : '/partners?is_supplier=1'), GET('/products'), GET('/payment-methods')]);
  const dv = Number(state.company.default_vat ?? 15);
  const lines = inv.lines.map(l => ({ ...l }));
  if (isNew) lines.push({ product_id: null, description: '', qty: 1, unit_price: 0, tax_rate: dv });
  const draft = inv.status === 'draft';
  const acts = [];
  if (draft) acts.push('<button class="btn btn-primary" id="save">Save draft</button>');
  if (!isNew && draft) acts.push('<button class="btn btn-ok" id="post">Post / validate</button>');
  if (['posted', 'partial'].includes(inv.status)) acts.push('<button class="btn btn-ok" id="pay">Register payment</button>');
  if (!isNew && inv.status !== 'cancelled' && !Number(inv.amount_paid)) acts.push('<button class="btn btn-danger" id="cancel">Cancel</button>');
  if (!isNew) acts.push('<button class="btn" id="print">Print / PDF</button>');
  const title = isNew ? `New ${cust ? 'invoice' : 'bill'}` : `${inv.number || 'Draft ' + (cust ? 'invoice' : 'bill')}`;
  const locF = await multiLocation() ? [{ key: 'location_id', label: 'Branch', type: 'select', numeric: true, options: await locationOptions('Default location'),
    help: cust ? 'Stock on this invoice leaves this branch, and the sale counts towards its profit.' : 'The branch this bill belongs to (and where stock arrives when there is no purchase order).' }] : [];
  view.innerHTML = page(title, acts.join(''), `<div class="card">
    <div class="row" style="margin-bottom:12px">${!isNew ? badge(inv.status) : ''}${!isNew && !draft ? `<span class="muted">Paid ${money(inv.amount_paid)} of ${money(inv.total)}</span>` : ''}</div>
    <div id="hdr">${formHtml([
      { key: 'partner_id', label: cust ? 'Customer' : 'Supplier', type: 'select', options: partners.map(p => ({ value: p.id, label: p.name })) },
      { key: 'invoice_date', label: 'Date', type: 'date' }, { key: 'due_date', label: 'Due date', type: 'date' }, { key: 'notes', label: 'Notes' }, ...locF
    ], { ...inv, invoice_date: d(inv.invoice_date), due_date: d(inv.due_date), location_id: inv.location_id ?? (isNew ? state.user.location_id || '' : '') })}</div>
    <h3 style="margin:16px 0 8px">Lines</h3><div id="le"></div>
    ${inv.payments && inv.payments.length ? `<h3 style="margin:16px 0 8px">Payments</h3>${tableHtml([{ key: 'created_at', label: 'Date', fmt: dt }, { key: 'method_name', label: 'Method' }, { key: 'reference', label: 'Reference' }, { key: 'amount', label: 'Amount', right: 1, fmt: money }], inv.payments)}` : ''}
    </div>`, { back: `#/invoices?kind=${inv.kind}` });
  if (!draft) $$('#hdr input, #hdr select').forEach(i => i.disabled = true);
  lineEditor($('#le'), { products, lines, priceKey: 'unit_price', defaultTax: dv, readOnly: !draft });
  const body = () => ({ kind: inv.kind, ...readForm($('#hdr'), [{ key: 'partner_id', type: 'select', numeric: true }, { key: 'invoice_date' }, { key: 'due_date' }, { key: 'notes' }, ...locF]), lines });
  const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = async () => { el.disabled = true; try { await fn(); } catch (e) { err(e); } el.disabled = false; }; };
  on('#save', async () => { const r = isNew ? await POST('/invoices', body()) : await PUT('/invoices/' + id, body()); toast('Saved'); if (isNew) location.hash = '#/invoice/' + r.id; else invoiceForm(view, [id]); });
  on('#post', async () => { await PUT('/invoices/' + id, body()); const r = await POST(`/invoices/${id}/post`); toast('Posted ' + r.number); invoiceForm(view, [id]); });
  on('#cancel', async () => { if (await confirmBox('Cancel this document? Posted entries will be reversed.', { danger: true })) { await POST(`/invoices/${id}/cancel`); invoiceForm(view, [id]); } });
  on('#print', async () => {
    const qrs = cust ? await GET(`/invoices/${id}/pay-qr`).catch(() => []) : [];
    let html = docHtml(cust ? 'TAX INVOICE' : 'SUPPLIER BILL', inv.number, { name: inv.partner_name, address: inv.partner_address, email: inv.partner_email, phone: inv.partner_phone, tax: inv.partner_tax }, inv.invoice_date, inv.lines, inv);
    if (qrs.length) html = html.replace('</body>', `<div style="margin-top:24px;border-top:1px solid #ddd;padding-top:12px"><b>Pay from your phone</b> – reference ${esc(inv.number)}<div style="display:flex;gap:24px;flex-wrap:wrap;margin-top:8px">${qrs.map(q => `<div style="text-align:center;width:130px"><div style="width:120px;margin:auto">${q.svg}</div><div style="font-size:12px">${esc(q.label)}</div></div>`).join('')}</div></div></body>`);
    printHtml(html);
  });
  on('#pay', async () => {
    const ms = methods.filter(m => m.kind !== 'account');
    modal({ title: 'Register payment', size: 'sm', body: formHtml([{ key: 'amount', label: 'Amount', type: 'number', default: round2(inv.total - inv.amount_paid) }, { key: 'method_id', label: 'Method', type: 'select', options: ms.map(m => ({ value: m.id, label: m.name })) }, { key: 'reference', label: 'Reference' }, { key: 'date', label: 'Date', type: 'date', default: today() }]),
      actions: [{ label: 'Cancel' }, { label: 'Record payment', cls: 'btn-ok', onClick: async (c, r) => { await POST(`/invoices/${id}/payments`, readForm(r, [{ key: 'amount', type: 'number' }, { key: 'method_id', type: 'select', numeric: true }, { key: 'reference' }, { key: 'date' }])); c(); toast('Payment recorded'); invoiceForm(view, [id]); } }] });
  });
}

// ---------------------------------------------------------------- accounting
export async function accounting(view) {
  const tab = query().tab || 'accounts';
  view.innerHTML = page('Accounting', `<a class="btn" href="#/bank">🏦 Bank &amp; M-Pesa recon</a><a class="btn" href="#/claims">🧾 Expense claims</a><button class="btn" id="exp">＋ Record expense</button><button class="btn btn-primary" id="je">＋ Journal entry</button>`, `
    <div class="tabs"><a href="#/accounting?tab=accounts" class="${tab === 'accounts' ? 'active' : ''}">Chart of accounts</a><a href="#/accounting?tab=journal" class="${tab === 'journal' ? 'active' : ''}">Journal</a></div><div id="ab"></div>`);
  const ab = $('#ab');
  const accounts = await GET('/accounts');
  if (tab === 'accounts') {
    ab.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="spacer"></span><button class="btn btn-sm" id="na">＋ Account</button></div>` +
      tableHtml([{ key: 'code', label: 'Code' }, { key: 'name', label: 'Account' }, { key: 'type', label: 'Type', html: 1, fmt: v => badge(v, 'posted') }, { key: 'debit', label: 'Debits', right: 1, fmt: money }, { key: 'credit', label: 'Credits', right: 1, fmt: money }, { key: 'balance', label: 'Balance', right: 1, fmt: money }], accounts);
    $('#na').onclick = () => modal({ title: 'New account', size: 'sm', body: formHtml([{ key: 'code', label: 'Code', required: true }, { key: 'name', label: 'Name', required: true }, { key: 'type', label: 'Type', type: 'select', options: ['asset', 'liability', 'equity', 'income', 'expense'].map(v => ({ value: v, label: v })) }]),
      actions: [{ label: 'Cancel' }, { label: 'Create', cls: 'btn-primary', onClick: async (c, r) => { await POST('/accounts', readForm(r, [{ key: 'code', label: 'Code', required: true }, { key: 'name', label: 'Name', required: true }, { key: 'type' }])); c(); accounting(view); } }] });
  } else {
    const rows = await GET('/journal');
    ab.innerHTML = tableHtml([{ key: 'id', label: '#' }, { key: 'entry_date', label: 'Date', fmt: d }, { key: 'reference', label: 'Reference' }, { key: 'memo', label: 'Memo' }, { key: 'source_type', label: 'Source' }, { key: 'user_name', label: 'By' }, { key: 'amount', label: 'Amount', right: 1, fmt: money }], rows, { rowAttr: r => `data-id="${r.id}"` });
    $$('[data-id]', ab).forEach(tr => tr.onclick = async () => {
      const e = await GET('/journal/' + tr.dataset.id);
      modal({ title: `Journal entry #${e.id} — ${e.reference || ''}`, wide: true, body: `<p class="muted">${esc(e.memo || '')} · ${d(e.entry_date)}</p>` + tableHtml([{ key: 'code', label: 'Code' }, { key: 'account_name', label: 'Account' }, { key: 'partner_name', label: 'Partner' }, { key: 'description', label: 'Description' }, { key: 'debit', label: 'Debit', right: 1, fmt: v => Number(v) ? money(v) : '' }, { key: 'credit', label: 'Credit', right: 1, fmt: v => Number(v) ? money(v) : '' }], e.lines) });
    });
  }
  const accOpts = accounts.map(a => ({ value: a.code, label: `${a.code} ${a.name}` }));
  $('#je').onclick = () => {
    const lines = [{ code: '6000', debit: 0, credit: 0 }, { code: '1000', debit: 0, credit: 0 }];
    modal({ title: 'Manual journal entry', wide: true, body: `${formHtml([{ key: 'date', label: 'Date', type: 'date', default: today() }, { key: 'reference', label: 'Reference' }, { key: 'memo', label: 'Memo', span: 2 }])}<div id="jl" style="margin-top:12px"></div>`,
      onOpen: r => {
        const draw = () => {
          const td = round2(lines.reduce((s, l) => s + Number(l.debit || 0), 0)), tc = round2(lines.reduce((s, l) => s + Number(l.credit || 0), 0));
          r.querySelector('#jl').innerHTML = `<table class="grid lines"><thead><tr><th>Account</th><th style="width:140px">Debit</th><th style="width:140px">Credit</th><th></th></tr></thead><tbody>
            ${lines.map((l, i) => `<tr><td><select data-i="${i}" data-k="code">${accOpts.map(o => `<option value="${o.value}" ${o.value === l.code ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></td>
            <td><input type="number" step="0.01" data-i="${i}" data-k="debit" value="${l.debit}"></td><td><input type="number" step="0.01" data-i="${i}" data-k="credit" value="${l.credit}"></td><td><button class="icon-btn" data-del="${i}">✕</button></td></tr>`).join('')}</tbody>
            <tfoot><tr><td>${td === tc ? '<span style="color:var(--ok)">Balanced ✓</span>' : `<span style="color:var(--bad)">Out of balance by ${money(td - tc)}</span>`}</td><td>${money(td)}</td><td>${money(tc)}</td><td></td></tr></tfoot></table><button class="btn btn-sm" id="al" style="margin-top:6px">＋ Line</button>`;
          $$('[data-k]', r).forEach(el => el.onchange = () => { lines[Number(el.dataset.i)][el.dataset.k] = el.dataset.k === 'code' ? el.value : Number(el.value); draw(); });
          $$('[data-del]', r).forEach(b => b.onclick = () => { lines.splice(Number(b.dataset.del), 1); draw(); });
          r.querySelector('#al').onclick = () => { lines.push({ code: '6000', debit: 0, credit: 0 }); draw(); };
        };
        draw();
      },
      actions: [{ label: 'Cancel' }, { label: 'Post entry', cls: 'btn-primary', onClick: async (c, r) => { await POST('/journal', { ...readForm(r, [{ key: 'date' }, { key: 'reference' }, { key: 'memo' }]), lines }); c(); toast('Entry posted'); accounting(view); } }] });
  };
  $('#exp').onclick = async () => {
    const methods = (await GET('/payment-methods')).filter(m => m.kind !== 'account');
    const suppliers = await GET('/partners?is_supplier=1');
    const f = [{ key: 'date', label: 'Date', type: 'date', default: today() }, { key: 'amount', label: 'Amount paid (incl. VAT)', type: 'number', required: true },
      { key: 'account_code', label: 'Expense account', type: 'select', options: accounts.filter(a => a.type === 'expense').map(a => ({ value: a.code, label: `${a.code} ${a.name}` })) },
      { key: 'tax_rate', label: 'VAT % included', type: 'number', default: 0 }, { key: 'method_id', label: 'Paid with', type: 'select', numeric: true, options: methods.map(m => ({ value: m.id, label: m.name })) },
      { key: 'partner_id', label: 'Supplier (optional)', type: 'select', numeric: true, options: [{ value: '', label: '—' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))] }, { key: 'description', label: 'Description', span: 2 }];
    modal({ title: 'Record expense', size: 'lg', body: formHtml(f), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await POST('/expenses', readForm(r, f)); c(); toast('Expense recorded'); accounting(view); } }] });
  };
}

// ---------------------------------------------------------------- reports
export async function reports(view) {
  const q = query(); const tab = q.tab || 'sales';
  const from = q.from || today(), to = q.to || today();
  const tabs = [['sales', 'Sales summary'], ['eod', 'End of day'], ['pl', 'Profit & loss'], ['bs', 'Balance sheet'], ['tb', 'Trial balance'], ['vat', 'VAT'], ['aged', 'Aged receivables'], ['agedp', 'Aged payables']];
  view.innerHTML = page('Reports', `<label class="row">From <input type="date" id="rf" value="${from}"></label><label class="row">To <input type="date" id="rt" value="${to}"></label>
    <button class="btn" data-pr="today">Today</button><button class="btn" data-pr="month">This month</button><button class="btn" data-pr="year">This year</button><button class="btn" onclick="window.print()">🖨 Print</button>`,
    `<div class="tabs">${tabs.map(([k, l]) => `<a data-tab="${k}" class="${tab === k ? 'active' : ''}">${l}</a>`).join('')}</div><div id="rb" class="card"></div>`);
  const go = (t = tab, f = $('#rf').value, tt = $('#rt').value) => location.hash = `#/reports?tab=${t}&from=${f}&to=${tt}`;
  $$('[data-tab]').forEach(a => a.onclick = () => go(a.dataset.tab));
  $('#rf').onchange = () => go(); $('#rt').onchange = () => go();
  $$('[data-pr]').forEach(b => b.onclick = () => { const n = new Date(); const y = n.getFullYear(), m = String(n.getMonth() + 1).padStart(2, '0'); go(tab, b.dataset.pr === 'today' ? today() : b.dataset.pr === 'month' ? `${y}-${m}-01` : `${y}-01-01`, today()); });
  const rb = $('#rb');
  const rt = (rows, tot) => `<table class="grid report-table">${rows.map(r => `<tr><td>${esc(r[0])}</td><td class="r">${r[1]}</td></tr>`).join('')}${tot ? `<tr class="tot"><td>${esc(tot[0])}</td><td class="r">${tot[1]}</td></tr>` : ''}</table>`;
  if (tab === 'sales') {
    const s = await GET(`/reports/sales?from=${from}&to=${to}`);
    rb.innerHTML = `<div class="cols cols-4" style="margin-bottom:16px">
      <div class="kpi"><div class="label">Gross sales</div><div class="value">${money(s.sales.total)}</div><div class="hint">${s.sales.orders} orders</div></div>
      <div class="kpi"><div class="label">Net (excl. VAT)</div><div class="value">${money(s.sales.net)}</div></div>
      <div class="kpi"><div class="label">Gross profit</div><div class="value">${money(s.sales.gross_profit)}</div><div class="hint">${s.sales.net ? Math.round(s.sales.gross_profit / s.sales.net * 100) : 0}% margin</div></div>
      <div class="kpi"><div class="label">Refunds</div><div class="value">${money(s.refunds.total)}</div><div class="hint">${s.refunds.count} refunds</div></div></div>
      <div class="cols cols-2"><div><h3>By payment method</h3>${tableHtml([{ key: 'method', label: 'Method' }, { key: 'count', label: '#', right: 1 }, { key: 'amount', label: 'Amount', right: 1, fmt: money }], s.payments)}
        <h3 style="margin-top:14px">By business type</h3>${tableHtml([{ key: 'mode', label: 'Type' }, { key: 'orders', label: 'Orders', right: 1 }, { key: 'total', label: 'Total', right: 1, fmt: money }], s.byMode)}
        <h3 style="margin-top:14px">By staff</h3>${tableHtml([{ key: 'user', label: 'Staff' }, { key: 'orders', label: 'Orders', right: 1 }, { key: 'total', label: 'Total', right: 1, fmt: money }], s.byUser)}</div>
      <div><h3>By category</h3>${tableHtml([{ key: 'category', label: 'Category' }, { key: 'qty', label: 'Qty', right: 1, fmt: qty }, { key: 'total', label: 'Total', right: 1, fmt: money }], s.byCategory)}
        <h3 style="margin-top:14px">Top products</h3>${tableHtml([{ key: 'name', label: 'Product' }, { key: 'qty', label: 'Qty', right: 1, fmt: qty }, { key: 'total', label: 'Total', right: 1, fmt: money }], s.topProducts)}
        <h3 style="margin-top:14px">VAS</h3>${tableHtml([{ key: 'service', label: 'Service' }, { key: 'status', label: 'Status' }, { key: 'count', label: '#', right: 1 }, { key: 'amount', label: 'Amount', right: 1, fmt: money }, { key: 'commission', label: 'Commission', right: 1, fmt: money }], s.vas)}</div></div>`;
  } else if (tab === 'eod') {
    rb.innerHTML = `<div class="row no-print" style="margin-bottom:10px"><span class="muted">Report for ${esc(from)}</span><span class="spacer"></span><input id="eodTo" placeholder="Extra recipients (optional, comma separated)" style="max-width:340px"><button class="btn btn-primary" id="send">✉ Email report</button></div><iframe id="eodf" style="width:100%;height:75vh;border:1px solid var(--line);border-radius:8px"></iframe>`;
    const html = await fetch(`/api/reports/eod?date=${from}`, { headers: { Authorization: 'Bearer ' + state.token } }).then(r => r.text());
    const f = $('#eodf'); f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
    $('#send').onclick = async () => { try { const extra = $('#eodTo').value.split(/[,;\s]+/).filter(Boolean); const r = await POST('/email/eod', { date: from, recipients: extra.length ? extra : undefined }); toast('Sent to ' + r.recipients.join(', ')); } catch (e) { err(e); } };
  } else if (tab === 'pl') {
    const loc = q.location_id || '';
    const p = await GET(`/reports/pl?from=${from}&to=${to}${loc ? '&location_id=' + loc : ''}`);
    const lopts = await multiLocation() ? await locationOptions('All branches') : null;
    rb.innerHTML = `${lopts ? `<div class="row no-print" style="margin-bottom:8px"><label>Branch <select id="plLoc">${lopts.map(o => `<option value="${o.value}" ${String(o.value) === String(loc) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>
      <a class="btn btn-sm" href="#/locations?tab=profit&from=${from}&to=${to}">Compare branches</a></div>` : ''}
      <h3>Profit & loss${loc && lopts ? ' · ' + esc((lopts.find(o => String(o.value) === String(loc)) || {}).label || '') : ''} · ${from} → ${to}</h3><h4 style="margin:12px 0 4px">Income</h4>${rt(p.income.map(a => [`${a.code} ${a.name}`, money(a.amount)]), ['Total income', money(p.total_income)])}
      <h4 style="margin:16px 0 4px">Expenses</h4>${rt(p.expense.map(a => [`${a.code} ${a.name}`, money(a.amount)]), ['Total expenses', money(p.total_expense)])}
      <div class="kpi" style="margin-top:16px;max-width:320px"><div class="label">Net profit</div><div class="value" style="color:${p.net_profit < 0 ? 'var(--bad)' : 'var(--ok)'}">${money(p.net_profit)}</div></div>`;
    if ($('#plLoc')) $('#plLoc').onchange = () => { location.hash = `#/reports?tab=pl&from=${from}&to=${to}${$('#plLoc').value ? '&location_id=' + $('#plLoc').value : ''}`; };
  } else if (tab === 'bs') {
    const b = await GET(`/reports/bs?to=${to}`);
    rb.innerHTML = `<h3>Balance sheet as of ${to}</h3><div class="cols cols-2"><div><h4 style="margin:12px 0 4px">Assets</h4>${rt(b.assets.map(a => [`${a.code} ${a.name}`, money(a.amount)]), ['Total assets', money(b.total_assets)])}</div>
      <div><h4 style="margin:12px 0 4px">Liabilities</h4>${rt(b.liabilities.map(a => [`${a.code} ${a.name}`, money(a.amount)]), ['Total liabilities', money(b.total_liabilities)])}
      <h4 style="margin:16px 0 4px">Equity</h4>${rt(b.equity.map(a => [`${a.code} ${a.name}`, money(a.amount)]), ['Total equity', money(b.total_equity)])}
      <p class="muted">Liabilities + equity = ${money(b.total_liabilities + b.total_equity)}</p></div></div>`;
  } else if (tab === 'tb') {
    const t = await GET(`/reports/tb?from=${from}&to=${to}`);
    rb.innerHTML = `<h3>Trial balance · ${from} → ${to}</h3>` + tableHtml([{ key: 'code', label: 'Code' }, { key: 'name', label: 'Account' }, { key: 'debit', label: 'Debit', right: 1, fmt: money }, { key: 'credit', label: 'Credit', right: 1, fmt: money }], t.rows) + `<div class="r" style="margin-top:8px"><b>Debits ${money(t.debit)} · Credits ${money(t.credit)}</b></div>`;
  } else if (tab === 'vat') {
    const v = await GET(`/reports/vat?from=${from}&to=${to}`);
    rb.innerHTML = `<h3>VAT return · ${from} → ${to}</h3>${rt([['Output VAT (on sales)', money(v.output_vat)], ['Input VAT (on purchases & expenses)', money(v.input_vat)]], [v.net_payable >= 0 ? 'VAT payable to revenue authority' : 'VAT refundable', money(Math.abs(v.net_payable))])}`;
  } else {
    const rows = await GET('/reports/aged?kind=' + (tab === 'aged' ? 'customer_invoice' : 'supplier_bill'));
    rb.innerHTML = `<h3>${tab === 'aged' ? 'Aged receivables' : 'Aged payables'} (today)</h3>` + tableHtml([{ key: 'name', label: 'Partner' }, { key: 'current_due', label: 'Not due', right: 1, fmt: money }, { key: 'd30', label: '1–30', right: 1, fmt: money }, { key: 'd60', label: '31–60', right: 1, fmt: money }, { key: 'd90', label: '60+', right: 1, fmt: money }, { key: 'total', label: 'Total', right: 1, fmt: money }], rows, { empty: 'Nothing outstanding' });
  }
}
