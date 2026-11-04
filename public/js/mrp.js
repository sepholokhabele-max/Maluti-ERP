// Manufacturing: work orders, bills of materials (with cost roll-up) and material shortages
import { state, GET, POST, PUT, DEL, esc, $, $$, toast, err, can, money, qty, modal, confirmBox, formHtml, readForm, tableHtml, badge, page, d, dt, today, query, printHtml, multiLocation, locationOptions } from './core.js';

const WS = { draft: ['Draft', 'draft'], confirmed: ['Planned', 'posted'], in_progress: ['In production', 'partial'], done: ['Done', 'paid'], cancelled: ['Cancelled', 'cancelled'] };
const wsBadge = s => badge((WS[s] || [s])[0], (WS[s] || [s, ''])[1]);
const QC = { passed: ['QC passed', 'ok'], failed: ['QC failed', 'cancelled'], none: ['', ''] };

export async function mrp(view) {
  const tab = query().tab || 'orders';
  const tabs = [['orders', 'Work orders'], ['boms', 'Bills of materials'], ['short', 'Materials to buy']];
  view.innerHTML = page('Manufacturing', `${can('inventory') ? '<a class="btn" href="#/bom/new">＋ New BOM</a><button class="btn btn-primary" id="nwo">＋ New work order</button>' : ''}`,
    `<div id="kp"></div><div class="tabs">${tabs.map(([k, l]) => `<a href="#/mrp?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="mb"></div>`);
  const mb = $('#mb');
  if ($('#nwo')) $('#nwo').onclick = () => newWorkOrder();
  GET('/mrp/summary').then(s => { $('#kp').innerHTML = `<div class="cols cols-4" style="margin-bottom:14px">
    <div class="kpi"><div class="label">In production</div><div class="value">${s.in_progress}</div></div>
    <div class="kpi"><div class="label">Planned / draft</div><div class="value">${s.confirmed + s.draft}</div></div>
    <div class="kpi"><div class="label">Finished (30 days)</div><div class="value">${s.done_30}</div><div class="hint">${qty(s.good_30)} good units</div></div>
    <div class="kpi"><div class="label">Reject rate (30 days)</div><div class="value" style="color:${s.reject_rate > 5 ? 'var(--bad)' : 'var(--ok)'}">${s.reject_rate}%</div><div class="hint">${qty(s.rejected_30)} rejected</div></div></div>`; }).catch(() => {});
  if (tab === 'orders') {
    const st = query().status || 'open';
    const rows = await GET('/mrp/work-orders?status=' + st);
    mb.innerHTML = `<div class="row" style="margin-bottom:8px">${[['open', 'Open'], ['done', 'Done'], ['all', 'All']].map(([k, l]) => `<a class="btn btn-sm ${k === st ? 'btn-primary' : ''}" href="#/mrp?tab=orders&status=${k}">${l}</a>`).join('')}</div>
      <div class="card">${tableHtml([{ key: 'number', label: 'Number' }, { key: 'product_name', label: 'Product' }, { key: 'qty_planned', label: 'To make', right: 1, fmt: (v, r) => `${qty(v)} ${r.uom || ''}` },
        { key: 'qty_produced', label: 'Made', right: 1, fmt: (v, r) => v == null ? '' : `${qty(v)}${Number(r.qty_rejected) ? ` (+${qty(r.qty_rejected)} rej.)` : ''}` },
        { key: 'planned_date', label: 'Planned', fmt: d }, { key: 'status', label: 'Status', html: 1, fmt: (v, r) => wsBadge(v) + (r.qc_status !== 'none' ? ' ' + badge(QC[r.qc_status][0], QC[r.qc_status][1]) : '') },
        { key: 'unit_cost', label: 'Cost / unit', right: 1, fmt: v => v == null ? '' : money(v) }, { key: 'batch_no', label: 'Batch' }, { key: 'location_name', label: 'Where' }], rows,
        { rowAttr: r => `data-id="${r.id}"`, empty: 'No work orders. Make a bill of materials first, then “New work order”.' })}</div>`;
    $$('[data-id]', mb).forEach(tr => tr.onclick = () => { location.hash = '#/wo/' + tr.dataset.id; });
  }
  if (tab === 'boms') {
    const rows = await GET('/mrp/boms');
    mb.innerHTML = `<div class="card">${tableHtml([{ key: 'product_name', label: 'Makes' }, { key: 'name', label: 'Bill of materials' }, { key: 'output_qty', label: 'Batch size', right: 1, fmt: (v, r) => `${qty(v)} ${r.uom || ''}` },
      { key: 'line_count', label: 'Components', right: 1 }, { key: 'cost', label: 'Cost / unit', right: 1, fmt: v => money(v.unit) },
      { key: 'product_price', label: 'Selling price', right: 1, fmt: money },
      { key: 'id', label: 'Margin', right: 1, html: 1, fmt: (v, r) => { if (!Number(r.product_price)) return ''; const m = Math.round((1 - r.cost.unit * 1.15 / Number(r.product_price)) * 1000) / 10; return `<span class="${m < 15 ? 'neg' : ''}">${m}%</span>`; } }], rows,
      { rowAttr: r => `data-id="${r.id}"`, empty: 'No bills of materials yet.' })}
      <p class="muted" style="margin-top:10px">Cost per unit = components (at today's average cost, plus expected waste) + labour + overhead, divided by the batch size. Margin compares it with the selling price (incl. VAT).</p></div>`;
    $$('[data-id]', mb).forEach(tr => tr.onclick = () => { location.hash = '#/bom/' + tr.dataset.id; });
  }
  if (tab === 'short') {
    const rows = await GET('/mrp/shortages');
    mb.innerHTML = `<div class="card">${tableHtml([{ key: 'name', label: 'Material' }, { key: 'need', label: 'Needed for open work orders', right: 1, fmt: (v, r) => `${qty(v)} ${r.uom || ''}` },
      { key: 'available', label: 'In stock', right: 1, fmt: qty }, { key: 'on_order', label: 'On order', right: 1, fmt: qty }, { key: 'missing', label: 'To buy', right: 1, html: 1, fmt: v => `<b class="neg">${qty(v)}</b>` },
      { key: 'cost', label: 'Est. cost', right: 1, fmt: (v, r) => money(v * r.missing) }], rows, { empty: 'Nothing to buy – all open work orders have their materials (in stock or on order).' })}
      ${rows.length && can('purchasing') ? '<div class="row" style="margin-top:10px"><span class="spacer"></span><button class="btn btn-primary" id="mkpo">🚚 Create purchase order</button></div>' : ''}</div>`;
    if ($('#mkpo')) $('#mkpo').onclick = async () => {
      const sup = await GET('/partners?is_supplier=1');
      const f = [{ key: 'supplier_id', label: 'Supplier', type: 'select', numeric: true, required: true, options: sup.map(s => ({ value: s.id, label: s.name })) }];
      modal({ title: 'Purchase order for missing materials', body: formHtml(f, {}, { ctx: 'po' }) + '<small class="help-note">A draft order is made for every material in the list at its last cost. Check prices and quantities before confirming it.</small>',
        actions: [{ label: 'Cancel' }, { label: 'Create draft order', cls: 'btn-primary', onClick: async (c, r) => { const res = await POST('/mrp/shortages/purchase', readForm(r, f)); c(); toast(`Draft purchase order with ${res.lines} line(s)`); location.hash = '#/purchase/' + res.id; } }] });
    };
  }
}

async function newWorkOrder(preset = {}) {
  const boms = await GET('/mrp/boms');
  if (!boms.length) { toast('Make a bill of materials first', 'err'); location.hash = '#/bom/new'; return; }
  const lo = await multiLocation() ? await locationOptions('Default location') : null;
  const f = [{ key: 'bom_id', label: 'What to make (bill of materials)', type: 'select', numeric: true, required: true, options: boms.map(b => ({ value: b.id, label: `${b.product_name} – ${b.name}` })) },
    { key: 'qty', label: 'Quantity to make', type: 'number', required: true }, { key: 'planned_date', label: 'Planned date', type: 'date' },
    ...(lo ? [{ key: 'location_id', label: 'Made at', type: 'select', numeric: true, options: lo }] : []), { key: 'notes', label: 'Notes', span: 2 }];
  const b0 = boms.find(b => b.id === preset.bom_id) || boms[0];
  modal({ title: 'New work order', size: 'lg', body: formHtml(f, { bom_id: b0.id, qty: Number(b0.output_qty), planned_date: today(), location_id: state.user.location_id || '', ...preset }, { ctx: 'wo' }),
    actions: [{ label: 'Cancel' }, { label: 'Create', cls: 'btn-primary', onClick: async (c, r) => { const w = await POST('/mrp/work-orders', readForm(r, f)); c(); toast(`${w.number} created`); location.hash = '#/wo/' + w.id; } }] });
}

// ---------------------------------------------------------------- BOM form
export async function bomForm(view, [idq]) {
  const id = (idq || '').split('?')[0];
  const isNew = id === 'new';
  const products = (await GET('/products')).filter(p => p.type !== 'service');
  const stockP = products.filter(p => p.type === 'stock');
  const b = isNew ? { output_qty: 1, labour_cost: 0, overhead_cost: 0, lines: [] } : await GET('/mrp/boms/' + id);
  const pmap = new Map(products.map(p => [p.id, p]));
  const lines = (b.lines || []).map(l => ({ product_id: l.product_id, qty: Number(l.qty), scrap_pct: Number(l.scrap_pct), notes: l.notes || '' }));
  if (!lines.length) lines.push({ product_id: null, qty: 1, scrap_pct: 0 });
  const f = [{ key: 'product_id', label: 'Finished product', type: 'select', numeric: true, required: true, options: [{ value: '', label: '— choose —' }, ...stockP.map(p => ({ value: p.id, label: p.name }))] },
    { key: 'name', label: 'Name of this recipe / version' }, { key: 'output_qty', label: 'One batch makes (quantity)', type: 'number', required: true }, { key: 'code', label: 'Reference / code' },
    { key: 'labour_cost', label: 'Labour per batch (M)', type: 'number' }, { key: 'overhead_cost', label: 'Overhead per batch (M)', type: 'number' },
    { key: 'minutes', label: 'Time per batch (minutes)', type: 'number' }, { key: 'shelf_life_days', label: 'Shelf life (days)', type: 'number' },
    { key: 'instructions', label: 'Method / work instructions', type: 'textarea', rows: 3, span: 2 }];
  view.innerHTML = page(isNew ? 'New bill of materials' : `${b.product_name} – ${b.name}`, `${!isNew ? '<button class="btn" id="bWo">＋ Work order</button><button class="btn btn-danger" id="bDel">Archive</button>' : ''}<button class="btn btn-primary" id="bSave">Save</button>`,
    `<div class="cols" style="grid-template-columns:2fr 1fr;align-items:start"><div class="card"><div id="bh">${formHtml(f, b, { ctx: 'bom' })}</div>
      <h3 style="margin:16px 0 8px">Components <small class="muted" style="font-weight:400">for one batch</small></h3><div id="bl"></div></div>
      <div class="card"><h3>Cost of one batch</h3><div id="bc"></div></div></div>`, { back: '#/mrp?tab=boms' });
  const calc = () => {
    let v = {}; try { v = readForm($('#bh'), f); } catch (_) { v = b; }
    let mat = 0; for (const l of lines) { const p = pmap.get(Number(l.product_id)); if (p) mat += Number(l.qty || 0) * (1 + Number(l.scrap_pct || 0) / 100) * Number(p.cost || 0); }
    const tot = mat + Number(v.labour_cost || 0) + Number(v.overhead_cost || 0); const out = Number(v.output_qty) || 1; const unit = tot / out;
    const fp = pmap.get(Number(v.product_id)); const price = fp ? Number(fp.price) : 0;
    const m = price ? Math.round((1 - unit * 1.15 / price) * 1000) / 10 : null;
    $('#bc').innerHTML = `<table class="grid report-table"><tr><td>Materials</td><td class="r">${money(mat)}</td></tr><tr><td>Labour</td><td class="r">${money(v.labour_cost || 0)}</td></tr>
      <tr><td>Overhead</td><td class="r">${money(v.overhead_cost || 0)}</td></tr><tr class="tot"><td>Batch total</td><td class="r">${money(tot)}</td></tr>
      <tr class="tot"><td>Cost per unit (÷ ${qty(out)})</td><td class="r">${money(unit)}</td></tr>${price ? `<tr><td>Selling price (incl. VAT)</td><td class="r">${money(price)}</td></tr><tr><td>Margin after VAT</td><td class="r ${m < 15 ? 'neg' : ''}"><b>${m}%</b></td></tr>` : ''}</table>
      <small class="help-note">Uses each component's current average cost. Waste % adds to the quantity used.</small>`;
  };
  const draw = () => {
    $('#bl').innerHTML = `<div class="table-wrap"><table class="grid lines"><thead><tr><th style="width:42%">Component (raw material / part)</th><th class="r" style="width:110px">Qty</th><th>Unit</th><th class="r" style="width:90px">Waste %</th><th class="r">Cost</th><th style="width:32px"></th></tr></thead><tbody>
      ${lines.map((l, i) => { const p = pmap.get(Number(l.product_id)) || {}; return `<tr><td><select data-i="${i}" data-k="product_id"><option value="">— choose —</option>${products.map(x => `<option value="${x.id}" ${x.id === Number(l.product_id) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></td>
        <td><input data-i="${i}" data-k="qty" type="number" step="any" class="r" value="${l.qty}"></td><td>${esc(p.uom || '')}</td>
        <td><input data-i="${i}" data-k="scrap_pct" type="number" step="any" class="r" value="${l.scrap_pct || ''}" placeholder="0"></td>
        <td class="r" data-c="${i}">${money(Number(l.qty || 0) * (1 + Number(l.scrap_pct || 0) / 100) * Number(p.cost || 0))}</td><td><button class="icon-btn" data-del="${i}">✕</button></td></tr>`; }).join('')}
      </tbody></table></div><button class="btn btn-sm" id="bAdd" style="margin-top:8px">＋ Add component</button>`;
    $$('[data-k]', $('#bl')).forEach(inp => inp.oninput = inp.onchange = () => {
      const l = lines[Number(inp.dataset.i)]; l[inp.dataset.k] = inp.dataset.k === 'product_id' ? Number(inp.value) || null : Number(inp.value);
      if (inp.dataset.k === 'product_id') draw(); else { const p = pmap.get(Number(l.product_id)) || {}; $(`[data-c="${inp.dataset.i}"]`).textContent = money(Number(l.qty || 0) * (1 + Number(l.scrap_pct || 0) / 100) * Number(p.cost || 0)); calc(); }
    });
    $$('[data-del]', $('#bl')).forEach(x => x.onclick = () => { lines.splice(Number(x.dataset.del), 1); draw(); });
    $('#bAdd').onclick = () => { lines.push({ product_id: null, qty: 1, scrap_pct: 0 }); draw(); };
    calc();
  };
  draw();
  $$('#bh input, #bh select').forEach(i => i.addEventListener('input', calc));
  $('#bSave').onclick = async () => {
    try {
      const v = readForm($('#bh'), f);
      const r = isNew ? await POST('/mrp/boms', { ...v, lines }) : await PUT('/mrp/boms/' + id, { ...v, lines });
      toast(`Saved – ${money(r.cost.unit)} per unit`); if (isNew) location.hash = '#/bom/' + r.id; else bomForm(view, [id]);
    } catch (e) { err(e); }
  };
  if ($('#bWo')) $('#bWo').onclick = () => newWorkOrder({ bom_id: b.id });
  if ($('#bDel')) $('#bDel').onclick = async () => { if (await confirmBox('Archive this bill of materials? Existing work orders keep their figures.', { danger: true, okLabel: 'Archive' })) { await DEL('/mrp/boms/' + id); location.hash = '#/mrp?tab=boms'; } };
}

// ---------------------------------------------------------------- work order
export async function woForm(view, [idq]) {
  const id = (idq || '').split('?')[0];
  const w = await GET('/mrp/work-orders/' + id);
  const open = ['draft', 'confirmed', 'in_progress'].includes(w.status) && can('inventory');
  const acts = ['<button class="btn" id="wPrint">🖨 Job card</button>'];
  if (w.status === 'draft' && can('inventory')) acts.push('<button class="btn" id="wConfirm">Plan (confirm)</button>');
  if (['draft', 'confirmed'].includes(w.status) && can('inventory')) acts.push('<button class="btn btn-primary" id="wStart">▶ Start</button>');
  if (open) acts.push('<button class="btn btn-ok" id="wFinish">✓ Finish</button>', '<button class="btn btn-danger" id="wCancel">Cancel</button>');
  view.innerHTML = page(`${w.number} · ${w.product_name}`, acts.join(''), `
    <div class="card"><div class="row wrap" style="margin-bottom:10px">${wsBadge(w.status)}${w.qc_status !== 'none' ? badge(QC[w.qc_status][0], QC[w.qc_status][1]) : ''}
      <span class="muted">${esc(w.bom_name || '')}${w.location_name ? ' · ' + esc(w.location_name) : ''}${w.started_at ? ' · started ' + esc(dt(w.started_at)) : ''}${w.finished_at ? ' · finished ' + esc(dt(w.finished_at)) : ''}</span></div>
      <div class="cols cols-4">
        <div class="kpi"><div class="label">To make</div><div class="value">${qty(w.qty_planned)} <small>${esc(w.uom || '')}</small></div><div class="hint">planned ${esc(d(w.planned_date))}</div></div>
        <div class="kpi"><div class="label">Made</div><div class="value">${w.qty_produced == null ? '–' : qty(w.qty_produced)}</div><div class="hint">${Number(w.qty_rejected) ? qty(w.qty_rejected) + ' rejected' : ''}</div></div>
        <div class="kpi"><div class="label">${w.status === 'done' ? 'Cost per unit' : 'Estimated cost'}</div><div class="value">${w.status === 'done' ? money(w.unit_cost) : money(w.est_material + Number(w.labour_cost) + Number(w.overhead_cost))}</div>
          <div class="hint">${w.status === 'done' ? `materials ${money(w.material_cost)} · labour ${money(w.labour_cost)} · overhead ${money(w.overhead_cost)}` : `materials ${money(w.est_material)} + labour ${money(w.labour_cost)} + overhead ${money(w.overhead_cost)}`}</div></div>
        <div class="kpi"><div class="label">Batch</div><div class="value" style="font-size:18px">${esc(w.batch_no || '–')}</div><div class="hint">${w.expiry_date ? 'best before ' + esc(d(w.expiry_date)) : ''}${w.qc_notes ? esc(w.qc_notes) : ''}</div></div></div>
      ${w.short.length ? `<div class="help-note" style="display:block;margin:12px 0;background:var(--bad-soft);border-color:var(--bad)">Not enough material at ${esc(w.location_name || 'the default location')}: ${w.short.map(s => `${esc(s.product_name)} (short ${qty(s.missing)})`).join(', ')}. <a href="#/mrp?tab=short">Buy materials</a></div>` : ''}
      <h3 style="margin:16px 0 8px">Materials</h3>
      ${tableHtml([{ key: 'product_name', label: 'Component' }, { key: 'qty_planned', label: 'Planned', right: 1, fmt: (v, r) => `${qty(v)} ${r.uom || ''}` },
        ...(w.status === 'done' ? [{ key: 'qty_used', label: 'Used', right: 1, fmt: qty }, { key: 'unit_cost', label: 'Unit cost', right: 1, fmt: money }, { key: 'cost_total', label: 'Cost', right: 1, fmt: money }, { key: 'batches', label: 'Batches used' }]
          : [{ key: 'available', label: 'Available', right: 1, html: 1, fmt: (v, r) => `<span class="${Number(v) < Number(r.qty_planned) ? 'neg' : ''}">${qty(v)}</span>` }, { key: 'product_cost', label: 'Est. cost', right: 1, fmt: (v, r) => money(v * r.qty_planned) }])], w.lines)}
      ${w.notes ? `<p class="muted">${esc(w.notes)}</p>` : ''}</div>`, { back: '#/mrp' });
  const act = async (path, msg) => { try { await POST(`/mrp/work-orders/${w.id}/${path}`); toast(msg); woForm(view, [id]); } catch (e) { err(e); } };
  if ($('#wConfirm')) $('#wConfirm').onclick = () => act('confirm', 'Planned');
  if ($('#wStart')) $('#wStart').onclick = () => act('start', 'Production started');
  if ($('#wCancel')) $('#wCancel').onclick = async () => { if (await confirmBox('Cancel this work order? Nothing has been taken from stock yet.', { danger: true, okLabel: 'Cancel work order' })) act('cancel', 'Cancelled'); };
  if ($('#wFinish')) $('#wFinish').onclick = () => finishDialog(w, () => woForm(view, [id]));
  $('#wPrint').onclick = () => printHtml(jobCardHtml(w));
}

function finishDialog(w, done) {
  const f = [{ key: 'qty_produced', label: `Good quantity made (${w.uom || 'units'})`, type: 'number', required: true }, { key: 'qty_rejected', label: 'Rejected / spoilt', type: 'number' },
    { key: 'batch_no', label: 'Batch / lot number' }, { key: 'expiry_date', label: 'Best before / expiry', type: 'date' },
    { key: 'qc_status', label: 'Quality check', type: 'select', options: [{ value: 'passed', label: 'Passed' }, { value: 'none', label: 'Not checked' }, { value: 'failed', label: 'Failed (all rejected)' }] },
    { key: 'qc_notes', label: 'Quality notes' }, { key: 'labour_cost', label: 'Labour (M)', type: 'number' }, { key: 'overhead_cost', label: 'Overhead (M)', type: 'number' }];
  modal({ title: `Finish ${w.number}`, size: 'lg', body: `${formHtml(f, { qty_produced: Number(w.qty_planned), qty_rejected: 0, qc_status: 'passed', labour_cost: Number(w.labour_cost), overhead_cost: Number(w.overhead_cost) }, { ctx: 'wo' })}
    <h4 style="margin:12px 0 6px">Materials actually used</h4><table class="grid lines"><thead><tr><th>Component</th><th class="r">Planned</th><th class="r" style="width:130px">Used</th></tr></thead><tbody>
    ${w.lines.map(l => `<tr><td>${esc(l.product_name)}</td><td class="r">${qty(l.qty_planned)} ${esc(l.uom || '')}</td><td><input type="number" step="any" class="r" data-l="${l.id}" value="${Number(l.qty_planned)}"></td></tr>`).join('')}</tbody></table>
    <label class="row" style="gap:6px;margin-top:8px"><input type="checkbox" id="fNeg"> Allow negative stock for materials</label>
    <small class="help-note">The materials used come out of stock now; the good quantity goes into stock as a new batch at material + labour + overhead cost. Rejects are written off.</small>`,
    actions: [{ label: 'Cancel' }, { label: 'Finish & book', cls: 'btn-ok', onClick: async (c, r) => {
      const v = readForm(r, f);
      const res = await POST(`/mrp/work-orders/${w.id}/finish`, { ...v, expiry_date: v.expiry_date || null, allow_negative: r.querySelector('#fNeg').checked, lines: $$('[data-l]', r).map(i => ({ line_id: Number(i.dataset.l), qty_used: Number(i.value) })) });
      c(); toast(`Finished – ${res.unit_cost != null ? money(res.unit_cost) + ' per unit' : 'all rejected'}${res.reject_value ? ` · rejects ${money(res.reject_value)} written off` : ''}`); done();
    } }] });
}

function jobCardHtml(w) {
  const c = state.company || {};
  return `<div style="font-family:Arial,sans-serif;font-size:12px;max-width:760px;margin:auto"><h2 style="margin:0">${esc(c.name || '')}</h2>
    <h1 style="font-size:20px;margin:14px 0 4px">Job card ${esc(w.number)}</h1>
    <p><b>Make:</b> ${qty(w.qty_planned)} ${esc(w.uom || '')} × ${esc(w.product_name)}<br><b>Recipe:</b> ${esc(w.bom_name || '')}<br><b>Planned:</b> ${esc(d(w.planned_date))}${w.location_name ? ' · <b>At:</b> ' + esc(w.location_name) : ''}</p>
    <table style="width:100%;border-collapse:collapse" border="1" cellpadding="5"><thead><tr><th align="left">Material</th><th align="right">Planned</th><th align="right">Issued</th><th align="right">Returned</th></tr></thead><tbody>
    ${w.lines.map(l => `<tr><td>${esc(l.product_name)}</td><td align="right">${qty(l.qty_planned)} ${esc(l.uom || '')}</td><td></td><td></td></tr>`).join('')}</tbody></table>
    <p style="margin-top:18px">Good quantity made: ____________ &nbsp; Rejected: ____________ &nbsp; Batch no: ____________</p>
    <p>Quality check: ☐ passed ☐ failed &nbsp; Notes: ______________________________________</p>
    <table style="width:100%;margin-top:30px"><tr><td>Started by: __________________</td><td>Finished by: __________________</td><td>Checked by: __________________</td></tr></table></div>`;
}
