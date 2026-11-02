// Butchery mode: carcass breakdown, cutting templates, waste, batches & expiry, pre-pack labels, scale settings
import { state, GET, POST, PUT, DEL, esc, $, $$, toast, err, can, money, qty as fq, modal, confirmBox, formHtml, readForm, tableHtml, badge, page, d, dt, today, plusDays, query, printHtml, round2, receiptLogoHtml } from './core.js';
import { buildScaleBarcode, ean13Svg } from './barcode.js';
import { readWeight, scaleSupported, chooseScalePort, attachScale } from './scale.js';

const TABS = [['breakdown', 'Carcass breakdown'], ['carcasses', 'Carcass trace'], ['animals', 'By animal'], ['production', 'Sausage & processing'], ['templates', 'Cutting templates'], ['waste', 'Waste'], ['batches', 'Batches & expiry'], ['labels', 'Pre-pack labels'], ['settings', 'Settings']];
const r3 = n => Math.round(Number(n) * 1000) / 1000;
const kg = n => `${fq(n)} kg`;
const scaleErr = m => err(new Error(m));
let SPECIES = null;
const species = async () => SPECIES || (SPECIES = await GET('/butchery/species').catch(() => []));
const spName = k => { const x = (SPECIES || []).find(s => s.key === k); return x ? `${x.icon} ${x.name}` : ''; };
const scaleOn = (r, st) => attachScale(r, st, { onError: scaleErr });

export async function butchery(view) {
  const st = await GET('/butchery/status');
  const tab = query().tab || 'breakdown';
  if (!st.enabled && tab !== 'settings') {
    view.innerHTML = page('Butchery', '', `<div class="empty" style="padding:50px"><div style="font-size:40px">🥩</div><h3 style="margin:10px 0">Butchery mode is turned off</h3>
      <p class="muted">Turn it on for weighed sales, scale labels, carcass breakdown, waste tracking and sell-by dates.</p>
      ${can('settings') ? '<a class="btn btn-primary" href="#/butchery?tab=settings">Open butchery settings</a>' : '<p class="muted">Ask an administrator to turn it on.</p>'}</div>`);
    return;
  }
  view.innerHTML = page('Butchery', '', `<div class="tabs">${TABS.map(([k, l]) => `<a href="#/butchery?tab=${k}" class="${tab === k ? 'active' : ''}">${l}</a>`).join('')}</div><div id="bb"></div>`);
  const bb = $('#bb');
  const fn = { breakdown: breakdownTab, carcasses: carcassesTab, animals: animalsTab, production: productionTab, templates: templatesTab, waste: wasteTab, batches: batchesTab, labels: labelsTab, settings: settingsTab }[tab] || breakdownTab;
  return fn(bb, st, view);
}

const stockProducts = () => GET('/products').then(ps => ps.filter(p => p.type === 'stock'));

// ---------------------------------------------------------------- breakdown
async function breakdownTab(root, st) {
  const rows = await GET('/butchery/breakdowns');
  root.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="muted">Cut a carcass or primal into retail cuts. Its cost is shared between the cuts by their selling value, and bone/fat loss is recorded as yield loss.</span>
    <span class="spacer"></span><button class="btn btn-primary" id="nb">＋ New breakdown</button></div>
    ${tableHtml([{ key: 'number', label: 'Number' }, { key: 'breakdown_date', label: 'Date', fmt: d }, { key: 'source_name', label: 'Carcass / primal' },
      { key: 'source_qty', label: 'Input', right: 1, fmt: kg }, { key: 'output_qty_total', label: 'Cuts', right: 1, fmt: kg },
      { key: 'yield_pct', label: 'Yield', right: 1, html: 1, fmt: v => `<b style="color:${v < 70 ? 'var(--bad)' : 'inherit'}">${v}%</b>` }, { key: 'waste_qty', label: 'Bone/fat loss', right: 1, fmt: kg },
      { key: 'source_cost_total', label: 'Cost', right: 1, fmt: money }, { key: 'sale_value_total', label: 'Sale value (ex VAT)', right: 1, fmt: money },
      { key: 'margin', label: 'Gross margin', right: 1, html: 1, fmt: v => `<b style="color:${v < 0 ? 'var(--bad)' : 'var(--ok)'}">${money(v)}</b>` }, { key: 'user_name', label: 'By' }],
      rows, { rowAttr: r => `data-id="${r.id}"`, empty: 'No breakdowns yet.' })}`;
  $$('[data-id]', root).forEach(tr => tr.onclick = () => showBreakdown(tr.dataset.id));
  $('#nb').onclick = () => newBreakdown(st, () => breakdownTab(root, st));
}

async function newBreakdown(st, done) {
  const [templates, products] = await Promise.all([GET('/butchery/templates'), stockProducts()]);
  const S = { template: templates[0] || null, source_id: templates[0] ? templates[0].source_product_id : (products[0] || {}).id, qty: '', batches: [], lines: [] };
  const fromTemplate = () => { S.lines = S.template ? S.template.lines.map(l => ({ product_id: l.product_id, name: l.product_name || l.name, is_waste: l.is_waste, yield_pct: Number(l.yield_pct), actual_qty: '' })) : []; };
  fromTemplate();
  const close = modal({ title: 'New carcass breakdown', wide: true, body: '<div id="bk"></div>', onOpen: r => draw(r),
    actions: [{ label: 'Cancel' }, { label: 'Post breakdown', cls: 'btn-primary', onClick: async (c, r) => {
      const q = Number(S.qty);
      if (!(q > 0)) throw new Error('Enter the input weight');
      const body = { template_id: S.template && S.template.id, source_product_id: Number(S.source_id), source_qty: q, source_batch_id: Number(r.querySelector('#bsb') && r.querySelector('#bsb').value) || null,
        breakdown_date: r.querySelector('#bdt').value, notes: r.querySelector('#bnt').value, allow_negative: r.querySelector('#ban').checked,
        lines: S.lines.map(l => ({ product_id: l.product_id, name: l.name, is_waste: l.is_waste, expected_qty: r3(q * l.yield_pct / 100), actual_qty: Number(l.actual_qty || 0) })) };
      const res = await POST('/butchery/breakdowns', body); c(); toast(`Breakdown ${res.number} posted`); if (res.warning) toast(res.warning, 'err', 9000); done(); showBreakdown(res.id);
    } }] });
  async function draw(r) {
    const src = products.find(p => p.id === Number(S.source_id));
    S.batches = src && src.track_batches ? await GET(`/butchery/batches?product_id=${src.id}`) : [];
    const q = Number(S.qty || 0);
    const outQ = S.lines.filter(l => !l.is_waste).reduce((s, l) => s + Number(l.actual_qty || 0), 0);
    r.querySelector('#bk').innerHTML = `<div class="form-grid">
        <label class="field"><span>Cutting template</span><select id="btp"><option value="">— none (enter cuts manually) —</option>${templates.map(t => `<option value="${t.id}" ${S.template && S.template.id === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Carcass / primal</span><select id="bsp">${products.map(p => `<option value="${p.id}" ${p.id === Number(S.source_id) ? 'selected' : ''}>${esc(p.name)} (${fq(p.stock_qty)} ${esc(p.uom)} in stock)</option>`).join('')}</select></label>
        <label class="field"><span>Input weight (kg)</span><input id="bq" type="number" step="0.001" value="${S.qty}" data-scale></label>
        ${S.batches.length ? `<label class="field"><span>From batch</span><select id="bsb">${S.batches.map(b => `<option value="${b.id}">${esc(b.batch_no)} · ${fq(b.qty_remaining)} kg${b.expiry_date ? ' · use by ' + d(b.expiry_date) : ''}</option>`).join('')}</select></label>` : '<div></div>'}
        <label class="field"><span>Date</span><input id="bdt" type="date" value="${today()}"></label>
        <label class="field"><span>Notes</span><input id="bnt" placeholder="e.g. side 2 of 4, butcher Thabo"></label>
      </div>
      <table class="grid lines" style="margin-top:12px"><thead><tr><th>Cut</th><th class="r">Expected %</th><th class="r">Expected kg</th><th style="width:150px">Actual kg</th><th class="r">Actual %</th></tr></thead><tbody>
      ${S.lines.map((l, i) => `<tr><td>${l.is_waste ? '🗑 ' : ''}${l.product_id || l.is_waste ? esc(l.name) : ''}${!l.product_id && !l.is_waste ? `<select data-lp="${i}"><option value="">— product —</option>${products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>` : ''}</td>
        <td class="r">${l.yield_pct ? l.yield_pct + '%' : ''}</td><td class="r">${q && l.yield_pct ? fq(r3(q * l.yield_pct / 100)) : ''}</td>
        <td><input type="number" step="0.001" data-la="${i}" value="${l.actual_qty}" data-scale></td><td class="r" data-lpct="${i}">${q && l.actual_qty ? (Number(l.actual_qty) / q * 100).toFixed(1) + '%' : ''}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="3">Cuts total <span class="muted">· loss = input − cuts</span></td><td id="bout">${kg(r3(outQ))}</td><td id="bloss">${q ? `${(outQ / q * 100).toFixed(1)}% yield · ${kg(r3(q - outQ))} loss` : ''}</td></tr></tfoot></table>
      <div class="row" style="margin-top:8px"><button class="btn btn-sm" id="baddc">＋ Add cut</button><button class="btn btn-sm" id="baddw">＋ Add waste line</button><span class="spacer"></span>
        <label class="row" style="gap:6px"><input type="checkbox" id="ban"> allow negative stock</label></div>`;
    const totals = () => {
      const q2 = Number(S.qty || 0); const o = S.lines.filter(l => !l.is_waste).reduce((s, l) => s + Number(l.actual_qty || 0), 0);
      r.querySelector('#bout').textContent = kg(r3(o));
      r.querySelector('#bloss').textContent = q2 ? `${(o / q2 * 100).toFixed(1)}% yield · ${kg(r3(q2 - o))} loss` : '';
      S.lines.forEach((l, i) => { const c = r.querySelector(`[data-lpct="${i}"]`); if (c) c.textContent = q2 && l.actual_qty ? (Number(l.actual_qty) / q2 * 100).toFixed(1) + '%' : ''; });
    };
    scaleOn(r, st);
    r.querySelector('#btp').onchange = e => { S.template = templates.find(t => t.id === Number(e.target.value)) || null; if (S.template) S.source_id = S.template.source_product_id; fromTemplate(); draw(r); };
    r.querySelector('#bsp').onchange = e => { S.source_id = Number(e.target.value); draw(r); };
    r.querySelector('#bq').onchange = e => { S.qty = e.target.value; draw(r); };
    $$('[data-la]', r).forEach(i => i.oninput = () => { S.lines[Number(i.dataset.la)].actual_qty = i.value; totals(); });
    $$('[data-lp]', r).forEach(sel => sel.onchange = () => { const l = S.lines[Number(sel.dataset.lp)]; l.product_id = Number(sel.value) || null; l.name = (products.find(p => p.id === l.product_id) || {}).name; draw(r); });
    r.querySelector('#baddc').onclick = () => { S.lines.push({ product_id: null, name: '', is_waste: 0, yield_pct: 0, actual_qty: '' }); draw(r); };
    r.querySelector('#baddw').onclick = () => { S.lines.push({ product_id: null, name: 'Fat / bone / trim', is_waste: 1, yield_pct: 0, actual_qty: '' }); draw(r); };
  }
}

async function showBreakdown(id) {
  const b = await GET('/butchery/breakdowns/' + id);
  const html = `<div class="cols cols-4" style="margin-bottom:12px">
      <div class="kpi"><div class="label">Input</div><div class="value">${kg(b.source_qty)}</div><div class="hint">${esc(b.source_name)}${b.source_batch_no ? ' · batch ' + esc(b.source_batch_no) : ''}</div></div>
      <div class="kpi"><div class="label">Yield</div><div class="value">${(b.output_qty_total / b.source_qty * 100).toFixed(1)}%</div><div class="hint">${kg(b.output_qty_total)} saleable · ${kg(b.waste_qty)} loss</div></div>
      <div class="kpi"><div class="label">Cost</div><div class="value">${money(b.source_cost_total)}</div><div class="hint">${money(b.source_cost_total / b.source_qty)} / kg input</div></div>
      <div class="kpi"><div class="label">Margin if all sold</div><div class="value" style="color:${b.sale_value_total - b.source_cost_total < 0 ? 'var(--bad)' : 'var(--ok)'}">${money(b.sale_value_total - b.source_cost_total)}</div><div class="hint">sale value ex VAT ${money(b.sale_value_total)}</div></div></div>
    ${tableHtml([{ key: 'name', label: 'Cut', fmt: (v, l) => (l.is_waste ? '🗑 ' : '') + v }, { key: 'expected_qty', label: 'Expected', right: 1, fmt: kg }, { key: 'actual_qty', label: 'Actual', right: 1, fmt: kg },
      { key: 'actual_qty', label: 'Variance', right: 1, html: 1, fmt: (v, l) => { const x = r3(v - l.expected_qty); return Number(l.expected_qty) ? `<span style="color:${x < 0 && !l.is_waste ? 'var(--bad)' : 'inherit'}">${x > 0 ? '+' : ''}${fq(x)} kg</span>` : ''; } },
      { key: 'unit_cost', label: 'Cost / kg', right: 1, fmt: (v, l) => l.is_waste ? '' : money(v) }, { key: 'cost_total', label: 'Cost', right: 1, fmt: (v, l) => l.is_waste ? '' : money(v) },
      { key: 'sale_value', label: 'Sale value', right: 1, fmt: (v, l) => l.is_waste ? '' : money(v) }, { key: 'batch_no', label: 'Batch', fmt: (v, l) => v ? `${v}${l.expiry_date ? ' · use by ' + d(l.expiry_date) : ''}` : '' }], b.lines)}`;
  modal({ title: `${b.number} — ${d(b.breakdown_date)}`, wide: true, body: html + (b.notes ? `<p class="muted">${esc(b.notes)}</p>` : '') });
}

// ---------------------------------------------------------------- templates
async function templatesTab(root) {
  const ts = await GET('/butchery/templates');
  root.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="muted">Expected yields per carcass or primal. Breakdowns are compared against them so you can see which butcher or supplier gives the best yield.</span><span class="spacer"></span><button class="btn" id="stt">🐄🐖🐑 Starter templates</button><button class="btn btn-primary" id="nt">＋ New template</button></div>
    <div class="cols cols-2">${ts.map(t => {
      const sum = t.lines.filter(l => !l.is_waste).reduce((s, l) => s + Number(l.yield_pct), 0);
      return `<div class="card" data-t="${t.id}" style="cursor:pointer"><h3>${esc(t.name)}</h3><div class="muted" style="margin-bottom:8px">${esc(t.source_name)} → ${t.lines.filter(l => !l.is_waste).length} cuts · expected saleable yield ${sum.toFixed(1)}%</div>
        <div class="yield-bar"><div style="width:${Math.min(100, sum)}%"></div></div>
        <ul class="list-plain">${t.lines.map(l => `<li><span>${l.is_waste ? '🗑 ' : ''}${esc(l.product_name || l.name)}</span><span>${Number(l.yield_pct)}%</span></li>`).join('')}</ul></div>`;
    }).join('') || '<div class="empty">No templates yet. Example: Beef side → rump 8%, sirloin 7%, mince 25%, stewing 20%, bones 15%, fat & trim 10%.</div>'}</div>`;
  $('#nt').onclick = () => editTemplate(null, () => templatesTab(root));
  $('#stt').onclick = () => starterDialog(() => templatesTab(root));
  $$('[data-t]', root).forEach(c => c.onclick = () => editTemplate(ts.find(t => t.id === Number(c.dataset.t)), () => templatesTab(root)));
}

async function editTemplate(t, done) {
  const products = await stockProducts();
  const lines = t ? t.lines.map(l => ({ product_id: l.product_id, name: l.product_name || l.name, yield_pct: Number(l.yield_pct), is_waste: l.is_waste })) : [{ product_id: null, name: '', yield_pct: 0, is_waste: 0 }];
  const opts = sel => `<option value="">— product —</option>${products.map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`;
  const acts = [{ label: 'Cancel' }];
  if (t) acts.push({ label: 'Delete', cls: 'btn-danger', onClick: async c => { if (await confirmBox('Delete this template?', { danger: true })) { await DEL('/butchery/templates/' + t.id); c(); done(); } } });
  acts.push({ label: 'Save', cls: 'btn-primary', onClick: async (c, r) => {
    const body = { name: r.querySelector('#tn').value, source_product_id: Number(r.querySelector('#ts').value), notes: r.querySelector('#to').value, lines };
    if (t) await PUT('/butchery/templates/' + t.id, body); else await POST('/butchery/templates', body);
    c(); toast('Template saved'); done();
  } });
  modal({ title: t ? 'Edit cutting template' : 'New cutting template', wide: true, actions: acts, body: '<div id="te"></div>', onOpen: r => {
    const draw = () => {
      const sum = lines.reduce((s, l) => s + Number(l.yield_pct || 0), 0);
      r.querySelector('#te').innerHTML = `<div class="form-grid"><label class="field"><span>Name</span><input id="tn" value="${esc(t ? t.name : '')}" placeholder="e.g. Beef side – standard"></label>
        <label class="field"><span>Carcass / primal (input)</span><select id="ts">${opts(t ? t.source_product_id : null)}</select></label><label class="field" style="grid-column:span 2"><span>Notes</span><input id="to" value="${esc(t ? t.notes || '' : '')}"></label></div>
        <table class="grid lines" style="margin-top:12px"><thead><tr><th>Cut (product)</th><th style="width:130px">Yield %</th><th style="width:110px">Waste?</th><th></th></tr></thead><tbody>
        ${lines.map((l, i) => `<tr><td>${l.is_waste ? `<input data-n="${i}" value="${esc(l.name || '')}">` : `<select data-p="${i}">${opts(l.product_id)}</select>`}</td>
          <td><input type="number" step="0.1" data-y="${i}" value="${l.yield_pct}"></td><td><input type="checkbox" data-w="${i}" ${l.is_waste ? 'checked' : ''}></td><td><button class="icon-btn" data-x="${i}">✕</button></td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td colspan="3" style="color:${sum > 100 ? 'var(--bad)' : 'inherit'}">${sum.toFixed(1)}% ${sum < 100 ? `(${(100 - sum).toFixed(1)}% unaccounted loss)` : sum > 100 ? '– over 100%!' : ''}</td></tr></tfoot></table>
        <button class="btn btn-sm" id="tad" style="margin-top:8px">＋ Line</button>`;
      // keep header values while redrawing
      $$('[data-p]', r).forEach(s => s.onchange = () => { const l = lines[Number(s.dataset.p)]; l.product_id = Number(s.value) || null; l.name = (products.find(p => p.id === l.product_id) || {}).name; });
      $$('[data-n]', r).forEach(s => s.oninput = () => { lines[Number(s.dataset.n)].name = s.value; });
      $$('[data-y]', r).forEach(s => s.onchange = () => { lines[Number(s.dataset.y)].yield_pct = Number(s.value); keep(draw); });
      $$('[data-w]', r).forEach(s => s.onchange = () => { const l = lines[Number(s.dataset.w)]; l.is_waste = s.checked ? 1 : 0; if (l.is_waste && !l.name) l.name = 'Fat & trim'; keep(draw); });
      $$('[data-x]', r).forEach(b => b.onclick = () => { lines.splice(Number(b.dataset.x), 1); keep(draw); });
      r.querySelector('#tad').onclick = () => { lines.push({ product_id: null, name: '', yield_pct: 0, is_waste: 0 }); keep(draw); };
    };
    const keep = fn => { const n = r.querySelector('#tn').value, s = r.querySelector('#ts').value, o = r.querySelector('#to').value; fn(); r.querySelector('#tn').value = n; r.querySelector('#ts').value = s; r.querySelector('#to').value = o; };
    draw();
  } });
}

// ---------------------------------------------------------------- waste
async function wasteTab(root, st) {
  const q = query(); const from = q.from || today(), to = q.to || today();
  const [rep, products] = await Promise.all([GET(`/butchery/waste-report?from=${from}&to=${to}`), stockProducts()]);
  root.innerHTML = `<div class="row wrap" style="margin-bottom:12px"><label class="row">From <input type="date" id="wf" value="${from}"></label><label class="row">To <input type="date" id="wt" value="${to}"></label>
      <span class="spacer"></span><button class="btn btn-primary" id="ww">＋ Record waste</button></div>
    <div class="cols cols-4" style="margin-bottom:14px">
      <div class="kpi"><div class="label">Written off (at cost)</div><div class="value" style="color:var(--bad)">${money(rep.total_value)}</div><div class="hint">${rep.rows.length} entries</div></div>
      <div class="kpi"><div class="label">Shrinkage vs cost of sales</div><div class="value">${rep.pct_of_cogs == null ? '—' : rep.pct_of_cogs + '%'}</div></div>
      <div class="kpi"><div class="label">Bone / fat loss in breakdowns</div><div class="value">${kg(rep.breakdown_loss_kg)}</div><div class="hint">${rep.breakdowns} breakdowns</div></div>
      <div class="kpi"><div class="label">Top reason</div><div class="value" style="font-size:18px">${rep.by_reason[0] ? esc(rep.by_reason[0].reason) : '—'}</div><div class="hint">${rep.by_reason[0] ? money(rep.by_reason[0].value) : ''}</div></div></div>
    <div class="cols cols-2"><div class="card"><h3>By reason</h3>${tableHtml([{ key: 'reason', label: 'Reason' }, { key: 'count', label: 'Entries', right: 1 }, { key: 'qty', label: 'Qty', right: 1, fmt: fq }, { key: 'value', label: 'Value', right: 1, fmt: money }], rep.by_reason, { empty: 'No waste recorded' })}</div>
      <div class="card"><h3>By product</h3>${tableHtml([{ key: 'product', label: 'Product' }, { key: 'qty', label: 'Qty', right: 1, fmt: fq }, { key: 'value', label: 'Value', right: 1, fmt: money }], rep.by_product, { empty: 'No waste recorded' })}</div></div>
    <div class="card" style="margin-top:14px"><h3>Entries</h3>${tableHtml([{ key: 'created_at', label: 'When', fmt: dt }, { key: 'product', label: 'Product' }, { key: 'qty', label: 'Qty', right: 1, fmt: (v, r) => `${fq(v)} ${r.uom}` },
      { key: 'reason', label: 'Reason', html: 1, fmt: v => badge(v, 'draft') }, { key: 'value', label: 'Value', right: 1, fmt: money }, { key: 'reference', label: 'Note' }, { key: 'user_name', label: 'By' }], rep.rows, { empty: 'Nothing in this period' })}</div>`;
  const go = () => location.hash = `#/butchery?tab=waste&from=${$('#wf').value}&to=${$('#wt').value}`;
  $('#wf').onchange = go; $('#wt').onchange = go;
  $('#ww').onclick = () => wasteDialog(products, st, () => wasteTab(root, st));
}

function wasteDialog(products, st, done) {
  const lines = [{ product_id: '', qty: '', reason: st.waste_reasons[0], note: '' }];
  modal({ title: 'Record waste / shrinkage', wide: true, body: '<div id="wl"></div>', onOpen: r => {
    const draw = () => {
      r.querySelector('#wl').innerHTML = `<table class="grid lines"><thead><tr><th>Product</th><th style="width:120px">Qty</th><th style="width:180px">Reason</th><th>Note</th><th></th></tr></thead><tbody>
        ${lines.map((l, i) => `<tr><td><select data-k="product_id" data-i="${i}"><option value="">— choose —</option>${products.map(p => `<option value="${p.id}" ${String(p.id) === String(l.product_id) ? 'selected' : ''}>${esc(p.name)} (${fq(p.stock_qty)} ${esc(p.uom)})</option>`).join('')}</select></td>
          <td><input type="number" step="0.001" data-k="qty" data-i="${i}" value="${l.qty}" data-scale></td>
          <td><select data-k="reason" data-i="${i}">${st.waste_reasons.map(x => `<option ${x === l.reason ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></td>
          <td><input data-k="note" data-i="${i}" value="${esc(l.note)}" placeholder="optional"></td><td><button class="icon-btn" data-rm="${i}">✕</button></td></tr>`).join('')}</tbody></table>
        <button class="btn btn-sm" id="wad" style="margin-top:8px">＋ Line</button><p class="muted" style="font-size:12px">Stock is reduced at average cost and posted to 5150 Stock Losses & Wastage. Batch-tracked items come out of the batch that expires first.</p>`;
      $$('[data-k]', r).forEach(el => el.onchange = el.oninput = () => { lines[Number(el.dataset.i)][el.dataset.k] = el.value; });
      scaleOn(r, st);
      $$('[data-rm]', r).forEach(b => b.onclick = () => { lines.splice(Number(b.dataset.rm), 1); draw(); });
      r.querySelector('#wad').onclick = () => { lines.push({ product_id: '', qty: '', reason: lines[lines.length - 1] ? lines[lines.length - 1].reason : st.waste_reasons[0], note: '' }); draw(); };
    };
    draw();
  }, actions: [{ label: 'Cancel' }, { label: 'Write off', cls: 'btn-danger', onClick: async c => {
    const ls = lines.filter(l => l.product_id && Number(l.qty) > 0).map(l => ({ ...l, product_id: Number(l.product_id), qty: Number(l.qty) }));
    if (!ls.length) throw new Error('Choose a product and quantity');
    const res = await POST('/butchery/waste', { lines: ls }); c(); toast(`Written off ${money(res.value)}`); done();
  } }] });
}

// ---------------------------------------------------------------- batches
async function batchesTab(root, st) {
  const status = query().status || 'open';
  const rows = await GET('/butchery/batches?status=' + status);
  root.innerHTML = `<div class="row wrap" style="margin-bottom:10px">${[['open', 'In stock'], ['expiring', `Expiring ≤ ${st.expiry_warning_days} days`], ['expired', 'Past use-by'], ['all', 'All incl. empty']].map(([k, l]) => `<a class="btn ${k === status ? 'btn-primary' : ''}" href="#/butchery?tab=batches&status=${k}">${l}</a>`).join('')}
    <span class="spacer"></span><span class="muted">Value in view: ${money(rows.reduce((s, r) => s + Number(r.value), 0))}</span></div>
    ${tableHtml([{ key: 'batch_no', label: 'Batch' }, { key: 'product', label: 'Product' }, { key: 'source', label: 'From', fmt: (v, r) => `${v}${r.supplier ? ' · ' + r.supplier : ''}` },
      { key: 'received_date', label: 'Received', fmt: d }, { key: 'expiry_date', label: 'Use by', fmt: d },
      { key: 'days_left', label: 'Days left', right: 1, html: 1, fmt: v => v == null ? '' : `<b style="color:${v < 0 ? 'var(--bad)' : v <= st.expiry_warning_days ? 'var(--warn)' : 'inherit'}">${v < 0 ? `${-v} overdue` : v}</b>` },
      { key: 'qty_in', label: 'In', right: 1, fmt: fq }, { key: 'qty_remaining', label: 'Left', right: 1, fmt: (v, r) => `${fq(v)} ${r.uom}` }, { key: 'value', label: 'Value', right: 1, fmt: money },
      { key: 'id', label: '', html: 1, fmt: (v, r) => Number(r.qty_remaining) > 0 && can('inventory') ? `<button class="btn btn-sm btn-danger" data-wo="${v}">Write off</button>` : '' }],
      rows, { rowAttr: r => `data-b="${r.id}"`, empty: status === 'expired' ? 'Nothing past its use-by date 👍' : 'No batches.' })}`;
  $$('[data-wo]', root).forEach(b => b.onclick = async e => {
    e.stopPropagation();
    const row = rows.find(x => String(x.id) === b.dataset.wo);
    if (!(await confirmBox(`Write off ${fq(row.qty_remaining)} ${row.uom} of ${row.product} (batch ${row.batch_no}) as expired?`, { danger: true, okLabel: 'Write off' }))) return;
    try { const r = await POST(`/butchery/batches/${row.id}/write-off`, { reason: 'Expired' }); toast(`Written off ${money(r.value)}`); batchesTab(root, st); } catch (x) { err(x); }
  });
  $$('[data-b]', root).forEach(tr => tr.onclick = async () => {
    const [b, org] = await Promise.all([GET('/butchery/batches/' + tr.dataset.b), GET(`/butchery/batches/${tr.dataset.b}/origins`)]);
    const f = [{ key: 'batch_no', label: 'Batch / lot no.' }, { key: 'expiry_date', label: 'Use-by date', type: 'date' },
      ...(b.source === 'purchase' ? [{ key: 'live_weight', label: `Live weight (kg)${Number(b.live_weight) > 0 ? ` – dressing ${(b.qty_in / b.live_weight * 100).toFixed(1)}%` : ''}`, type: 'number', nullable: true }] : []),
      { key: 'notes', label: 'Notes', span: 2 }];
    modal({ title: `Batch ${b.batch_no} — ${b.product}`, wide: true, body: formHtml(f, { ...b, expiry_date: d(b.expiry_date) }) +
      (org.length ? `<h4 style="margin:14px 0 6px">Made from</h4>${originsHtml(org, b.uom)}` : '') +
      `<h4 style="margin:14px 0 6px">Movements</h4>` +
      tableHtml([{ key: 'created_at', label: 'When', fmt: dt }, { key: 'move_type', label: 'Movement' }, { key: 'reference', label: 'Document' }, { key: 'qty', label: 'Qty', right: 1, fmt: v => `${Number(v) > 0 ? '+' : ''}${fq(v)} ${b.uom}` }], b.moves),
      actions: [{ label: 'Close' }, { label: '🔎 Where did it go?', onClick: c => { c(); showLedger(b.id); } },
        ...(can('inventory') ? [{ label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await PUT('/butchery/batches/' + b.id, readForm(r, f)); c(); toast('Saved'); batchesTab(root, st); } }] : [])] });
  });
}

// ---------------------------------------------------------------- pre-pack labels
async function labelsTab(root, st) {
  const products = (await GET('/products')).filter(p => p.sold_by_weight);
  if (!products.length) { root.innerHTML = '<div class="empty">No products are set as "sold by weight". Edit a product (Products) and tick it, and give it a PLU code.</div>'; return; }
  let P = products[0], weight = '', batches = [];
  root.innerHTML = `<div class="cols cols-2"><div class="card"><h3>Weigh & label</h3>
      <label class="field"><span>Product</span><select id="lp">${products.map(p => `<option value="${p.id}">${esc(p.name)} – ${money(p.price)}/${esc(p.uom)}${p.plu ? '' : ' (no PLU!)'}</option>`).join('')}</select></label>
      <div class="form-grid" style="margin-top:10px"><label class="field"><span>Weight (kg)</span><input id="lw" type="number" step="0.001"></label>
        <label class="field"><span>Batch</span><select id="lb"></select></label>
        <label class="field"><span>Packed on</span><input id="lpd" type="date" value="${today()}"></label><label class="field"><span>Use by</span><input id="lub" type="date"></label>
        <label class="field"><span>Copies</span><input id="lc" type="number" value="1" min="1"></label></div>
      <div class="row" style="margin-top:12px">${st.scale_enabled ? '<button class="btn" id="lrs">⚖️ Read scale</button>' : ''}<span class="spacer"></span><button class="btn btn-primary btn-lg" id="lpr">🖨 Print label</button></div>
      <p class="muted" style="font-size:12px">The barcode carries the ${st.barcode_value_type === 'weight' ? 'weight' : 'price'} so the till charges exactly what's on the pack. Label size ${st.label_width_mm}×${st.label_height_mm} mm (Settings).</p></div>
    <div class="card"><h3>Preview</h3><div id="lprev"></div></div></div>`;
  const label = () => {
    const w = Number(weight || 0), total = round2(w * Number(P.price));
    const useBy = $('#lub').value;
    const code = P.plu ? buildScaleBarcode(st.label_barcode_prefix, P.plu, st.barcode_value_type === 'weight' ? w : total, st) : null;
    const bt = batches.find(b => String(b.id) === $('#lb').value);
    return { w, total, code, html: `<div class="lbl" style="width:${st.label_width_mm}mm;height:${st.label_height_mm}mm">
      <div class="lh"><b>${esc(state.company.name || '')}</b></div><div class="ln">${esc(P.name)}</div>
      <div class="lr"><span>${fq(w)} kg</span><span>${money(P.price)}/kg</span></div><div class="lt">${money(total)}</div>
      <div class="ld">Packed ${d($('#lpd').value)}${useBy ? ` · <b>Use by ${d(useBy)}</b>` : ''}${bt ? ` · ${esc(bt.batch_no)}` : ''}</div>
      <div class="lbc">${code ? ean13Svg(code, { height: 34 }) : '<i>Set a PLU on this product to print a barcode</i>'}</div></div>` };
  };
  const css = `.lbl{box-sizing:border-box;padding:1.5mm 2mm;font-family:Arial,sans-serif;color:#000;overflow:hidden;display:flex;flex-direction:column}
    .lh{font-size:7pt}.ln{font-size:10pt;font-weight:bold;line-height:1.1}.lr{display:flex;justify-content:space-between;font-size:8pt}.lt{font-size:15pt;font-weight:bold;text-align:right;line-height:1.1}
    .ld{font-size:6.5pt}.lbc{margin-top:auto;width:70%;align-self:center}`;
  const refresh = () => { const l = label(); $('#lprev').innerHTML = `<style>${css}</style><div class="label-preview" style="width:${st.label_width_mm}mm">${l.html}</div>`; };
  const loadProduct = async () => {
    P = products.find(p => p.id === Number($('#lp').value));
    batches = P.track_batches ? await GET(`/butchery/batches?product_id=${P.id}`) : [];
    $('#lb').innerHTML = batches.length ? batches.map(b => `<option value="${b.id}" data-ex="${b.expiry_date || ''}">${esc(b.batch_no)} · ${fq(b.qty_remaining)} kg${b.expiry_date ? ' · use by ' + d(b.expiry_date) : ''}</option>`).join('') : '<option value="">— not batch-tracked —</option>';
    const first = batches[0];
    $('#lub').value = first && first.expiry_date ? d(first.expiry_date) : (P.shelf_life_days ? plusDays(P.shelf_life_days) : '');
    refresh();
  };
  $('#lp').onchange = loadProduct;
  $('#lw').oninput = e => { weight = e.target.value; refresh(); };
  $('#lb').onchange = e => { const ex = e.target.selectedOptions[0] && e.target.selectedOptions[0].dataset.ex; if (ex) $('#lub').value = d(ex); refresh(); };
  ['#lpd', '#lub'].forEach(s => $(s).onchange = refresh);
  const rs = $('#lrs');
  if (rs) rs.onclick = async () => { try { if (!scaleSupported()) throw new Error('Scale reading needs the desktop app'); const w = await readWeight(st); weight = String(w.kg); $('#lw').value = weight; refresh(); } catch (e) { err(e); } };
  $('#lpr').onclick = () => {
    const l = label();
    if (!(l.w > 0)) return toast('Enter or read a weight first', 'err');
    const copies = Math.max(1, Math.min(50, Number($('#lc').value) || 1));
    printHtml(`<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${st.label_width_mm}mm ${st.label_height_mm}mm;margin:0}body{margin:0}${css}.lbl{page-break-after:always}</style></head><body>${Array(copies).fill(l.html).join('')}</body></html>`);
    weight = ''; $('#lw').value = ''; $('#lw').focus(); refresh();
  };
  await loadProduct();
}

// ---------------------------------------------------------------- settings
async function settingsTab(root, st) {
  const s = await GET('/butchery/settings').catch(() => st);
  const admin = can('settings');
  const f = [
    { key: 'enabled', label: 'Butchery mode on (weighed items, scale labels, breakdown, waste, batches)', type: 'checkbox', span: 2 },
    { key: 'scale_enabled', label: 'A scale is connected to this till (RS-232 / USB serial)', type: 'checkbox' }, { key: 'auto_read', label: 'Read the scale automatically when weighing', type: 'checkbox' },
    { key: 'baud_rate', label: 'Baud rate', type: 'select', options: [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].map(v => ({ value: v, label: v })) },
    { key: 'data_bits', label: 'Data bits', type: 'select', options: [7, 8].map(v => ({ value: v, label: v })) },
    { key: 'parity', label: 'Parity', type: 'select', options: ['none', 'even', 'odd'].map(v => ({ value: v, label: v })) },
    { key: 'stop_bits', label: 'Stop bits', type: 'select', options: [1, 2].map(v => ({ value: v, label: v })) },
    { key: 'request_cmd', label: 'Weight request command (blank if the scale sends continuously)', placeholder: 'e.g. W\\r or P', span: 2 },
    { key: 'barcode_prefixes', label: 'Scale-label barcode prefixes', help: 'EAN-13 labels starting with these digits are treated as scale labels' },
    { key: 'barcode_value_type', label: 'Label barcode contains', type: 'select', options: [{ value: 'price', label: 'Price (cents)' }, { value: 'weight', label: 'Weight (grams)' }] },
    { key: 'barcode_item_digits', label: 'PLU / item code digits', type: 'number' }, { key: 'barcode_value_digits', label: 'Price / weight digits', type: 'number' },
    { key: 'label_barcode_prefix', label: 'Prefix for labels printed here' }, { key: 'expiry_warning_days', label: 'Warn this many days before use-by', type: 'number' },
    { key: 'label_width_mm', label: 'Label width (mm)', type: 'number' }, { key: 'label_height_mm', label: 'Label height (mm)', type: 'number' },
    { key: 'waste_reasons', label: 'Waste reasons (one per line)', type: 'textarea', rows: 4, span: 2 }];
  root.innerHTML = `<div class="card" style="max-width:900px">${formHtml(f, { ...s, waste_reasons: (s.waste_reasons || []).join('\n') }, { ctx: 'butchery' })}
    <p class="muted" style="font-size:12px">Common layout: <b>2 + 1 prefix digit, 5-digit PLU, 5-digit price in cents, check digit</b> (e.g. 21 01001 19760 C = PLU 1001, M197.60). Set the same layout on your label scale.
    Scale reading works in the Maluti ERP desktop app (Windows) via Web Serial; most butchery scales with an RS-232/USB output that send lines like <code>ST,GS,+ 1.235kg</code> are supported.</p>
    <div class="row wrap">${admin ? '<button class="btn btn-primary" id="bsv">Save</button>' : '<span class="muted">Only an administrator can change these.</span>'}<button class="btn" id="bts">⚖️ Test scale</button><button class="btn" id="bpt">Choose scale port…</button><span class="muted" id="btr"></span></div></div>`;
  if (admin) $('#bsv').onclick = async () => {
    try { await PUT('/butchery/settings', readForm(root, f)); toast('Saved'); setTimeout(() => location.reload(), 400); } catch (e) { err(e); }
  };
  const cfg = () => { try { return { ...s, ...readForm(root, f) }; } catch (_) { return s; } };
  $('#bts').onclick = async () => { $('#btr').textContent = 'Reading…'; try { const w = await readWeight(cfg(), { wantStable: false }); $('#btr').innerHTML = `<b>${w.kg} kg</b> ${w.stable ? '(stable)' : '(moving)'} · raw: <code>${esc(w.raw.slice(-60))}</code>`; } catch (e) { $('#btr').textContent = e.message; } };
  $('#bpt').onclick = async () => { try { await chooseScalePort(cfg()); toast('Scale port selected'); } catch (e) { err(e); } };
}

// ---------------------------------------------------------------- traceability
const ACC = [['sold', 'Sold', 'var(--ok)'], ['waste', 'Written off', 'var(--bad)'], ['loss', 'Bone / fat / drip loss', '#9ca3af'], ['adjusted', 'Stock adjustments', 'var(--warn)'], ['in_stock', 'Still in stock', 'var(--brand-2)']];
const pct = (v, q) => q ? Math.max(0, Number(v) / q * 100) : 0;

function accBar(t, q, { legend = true } = {}) {
  const un = Math.max(0, q - ACC.reduce((s, [k]) => s + Number(t[k] || 0), 0));
  return `<div class="acc-bar" title="${ACC.map(([k, l]) => `${l}: ${fq(t[k] || 0)} kg`).join(' · ')}">${ACC.map(([k, , c]) => `<div style="width:${pct(t[k], q)}%;background:${c}"></div>`).join('')}${un > 0.0005 ? `<div style="width:${pct(un, q)}%;background:repeating-linear-gradient(45deg,#fca5a5 0 4px,#fff 4px 8px)"></div>` : ''}</div>
    ${legend ? `<div class="acc-legend">${ACC.filter(([k]) => k !== 'adjusted' || Math.abs(t[k] || 0) > 0.0005).map(([k, l, c]) => `<span><i style="background:${c}"></i>${l} <b>${fq(t[k] || 0)} kg</b> (${pct(t[k], q).toFixed(1)}%)</span>`).join('')}${un > 0.0005 ? `<span><i style="background:#fca5a5"></i>Unaccounted <b>${fq(un)} kg</b></span>` : ''}</div>` : ''}`;
}

function originsHtml(org, uom) {
  return tableHtml([{ key: 'depth', label: '', fmt: v => '↑'.repeat(v) }, { key: 'product', label: 'Ingredient / source', html: 1, fmt: (v, o) => `${o.is_carcass ? '🐄 ' : ''}${esc(v)}` },
    { key: 'batch_no', label: 'Batch / tag', html: 1, fmt: (v, o) => `<a href="javascript:void 0" data-ol="${o.batch_id}">${esc(v)}</a>` }, { key: 'supplier', label: 'Supplier' }, { key: 'received_date', label: 'Received', fmt: d },
    { key: 'via', label: 'Via', fmt: (v, o) => `${v} ${o.reference || ''}` }, { key: 'kg_per_unit', label: `Per ${uom || 'kg'} of this batch`, right: 1, fmt: v => `${fq(Math.round(v * 1000))} g` }], org);
}
document.addEventListener('click', e => { const a = e.target.closest && e.target.closest('[data-ol]'); if (a) { e.preventDefault(); showLedger(a.dataset.ol); } });

export async function showLedger(batchId) {
  const [L] = await Promise.all([GET('/butchery/trace/' + batchId), species()]);
  const b = L.batch, q = L.qty, t = L.totals;
  const node = n => `<li><div class="trace-node"><div class="tn-h"><b>${esc(n.product)}</b><span class="muted">batch ${esc(n.batch_no)}</span>
      ${n.via ? `<span class="badge">${n.via === 'production' ? '🌭' : '✂'} ${esc(n.reference)}</span>` : ''}
      <span class="spacer"></span><span><b>${fq(n.root_kg)} kg</b> of ${esc(b.batch_no)}${n.share < 0.9999 && n.share > 0 ? ` <span class="muted">(${(n.share * 100).toFixed(1)}% of ${fq(n.qty_in)} ${esc(n.uom)})</span>` : ''}</span></div>
    <div class="tn-k">${n.sold ? `<span>sold <b>${fq(n.sold)} kg</b>${n.revenue ? ` · ${money(n.revenue)}` : ''}</span>` : ''}${n.waste ? `<span>written off <b>${fq(n.waste)} kg</b></span>` : ''}
      ${n.adjusted ? `<span>adjusted <b>${fq(n.adjusted)} kg</b></span>` : ''}${n.processed ? `<span>processed <b>${fq(n.processed)} kg</b></span>` : ''}${n.in_stock ? `<span>in stock <b>${fq(n.in_stock)} kg</b></span>` : ''}</div></div>
    ${n.processes.map(p => `<div class="trace-proc">${p.via === 'production' ? '🌭' : '✂'} ${esc(p.reference)}: ${fq(p.root_kg)} kg ${p.via === 'production' ? 'went into production' : 'cut'}${p.loss_kg ? ` · loss ${fq(p.loss_kg)} kg${p.loss_detail ? ' (' + p.loss_detail.map(x => `${esc(x.name)} ${fq(x.kg)}`).join(', ') + ')' : ''}` : ''}${p.run ? ` · ${fq(p.run.input_qty)} kg of ingredients → ${fq(p.run.output_qty)} kg` : ''}</div>`).join('')}
    ${n.children.length ? `<ul>${n.children.map(node).join('')}</ul>` : ''}</li>`;
  const ev = L.events.map(e => ({ ...e, label: { sold: '💰 Sold', waste: '🗑 Written off', adjusted: '± Adjusted', breakdown: '✂ Cut', production: '🌭 Production' }[e.type] || e.type }));
  const html = `<div class="cols cols-4" style="margin-bottom:12px">
      <div class="kpi"><div class="label">${b.is_carcass ? 'Carcass weight' : 'Batch in'}</div><div class="value">${fq(q)} ${esc(L.uom)}</div><div class="hint">${b.species ? spName(b.species) + ' · ' : ''}${esc(b.product)}${b.supplier ? ' · ' + esc(b.supplier) : ''} · ${d(b.received_date)}${Number(b.live_weight) > 0 ? `<br>live ${fq(b.live_weight)} kg · dressing <b>${(q / b.live_weight * 100).toFixed(1)}%</b>` : ''}</div></div>
      <div class="kpi"><div class="label">Accounted for</div><div class="value" style="color:${Math.abs(L.unaccounted) > 0.01 ? 'var(--bad)' : 'var(--ok)'}">${L.accounted_pct}%</div><div class="hint">${Math.abs(L.unaccounted) > 0.01 ? `${fq(L.unaccounted)} kg unaccounted` : 'every kg traced'} · ${L.closed_pct}% sold/used up</div></div>
      <div class="kpi"><div class="label">Sales so far (ex VAT)</div><div class="value">${money(t.revenue)}</div><div class="hint">from ${fq(t.sold)} kg of this ${b.is_carcass ? 'carcass' : 'batch'}</div></div>
      <div class="kpi"><div class="label">Cost</div><div class="value">${money(t.cost)}</div><div class="hint" style="color:${L.margin < 0 ? 'var(--bad)' : 'var(--ok)'}">margin so far ${money(L.margin)}</div></div></div>
    ${accBar(t, q)}
    <h4 style="margin:16px 0 6px">Where every kg went</h4><ul class="trace-tree">${node(L.tree)}</ul>
    <h4 style="margin:16px 0 6px">Timeline</h4>${tableHtml([{ key: 'when', label: 'When', fmt: dt }, { key: 'label', label: 'What' }, { key: 'reference', label: 'Document' }, { key: 'product', label: 'Product' },
      { key: 'qty', label: 'Qty', right: 1, fmt: fq }, { key: 'root_kg', label: `kg of ${b.batch_no}`, right: 1, fmt: fq }, { key: 'value', label: 'Sales', right: 1, fmt: v => v ? money(v) : '' }], ev, { empty: 'Nothing has happened to this batch yet.' })}
    <p class="muted" style="font-size:12px">Sausage and other mixed products carry the carcass meat that went into them; their sales are credited to the carcass by weight. Bone, fat and trim recorded at breakdown, and any weight difference, count as loss.</p>`;
  modal({ title: `${b.is_carcass ? '🐄 Carcass' : 'Batch'} ${b.batch_no} — where every kg went`, wide: true, body: html,
    actions: [{ label: 'Close' }, { label: '🖨 Print', onClick: () => printHtml(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${location.origin}/css/app.css"><style>body{padding:16px;background:#fff}</style></head><body>${receiptLogoHtml ? receiptLogoHtml() : ''}<h2>${esc(b.product)} ${esc(b.batch_no)}</h2>${html}</body></html>`) }] });
}

async function carcassesTab(root) {
  const q = query(), status = q.status || 'open', sp = q.species || '';
  const [rows, sps] = await Promise.all([GET(`/butchery/carcasses?status=${status}${sp ? '&species=' + sp : ''}`), species()]);
  const link = (st, s2) => `#/butchery?tab=carcasses&status=${st}${s2 ? '&species=' + s2 : ''}`;
  root.innerHTML = `<div class="row wrap" style="margin-bottom:8px">${[['open', 'Still in stock'], ['closed', 'Fully accounted'], ['all', 'All']].map(([k, l]) => `<a class="btn ${k === status ? 'btn-primary' : ''}" href="${link(k, sp)}">${l}</a>`).join('')}
      <span class="spacer"></span><span class="muted">Each carcass is followed kg by kg: cuts → sausage & processing → sales, waste and loss, until 100% is accounted for.</span></div>
    <div class="chips" style="margin-bottom:10px"><a class="chip ${!sp ? 'on' : ''}" href="${link(status, '')}" style="--c:#3f3d9e">All animals</a>${sps.map(x => `<a class="chip ${sp === x.key ? 'on' : ''}" href="${link(status, x.key)}" style="--c:${x.color}">${x.icon} ${esc(x.name)}</a>`).join('')}</div>
    ${tableHtml([{ key: 'batch_no', label: 'Tag / batch', html: 1, fmt: v => `<b>${esc(v)}</b>` }, { key: 'product', label: 'Carcass', html: 1, fmt: (v, r) => `${r.species ? (sps.find(x => x.key === r.species) || {}).icon || '' : ''} ${esc(v)}` },
      { key: 'supplier', label: 'Supplier' }, { key: 'received_date', label: 'Received', fmt: d },
      { key: 'live_weight', label: 'Live', right: 1, fmt: v => v ? kg(v) : '—' }, { key: 'qty_in', label: 'Carcass', right: 1, fmt: kg }, { key: 'dressing_pct', label: 'Dressing', right: 1, fmt: v => v ? v + '%' : '—' },
      { key: 'uncut', label: 'Not yet cut', right: 1, fmt: v => v ? kg(v) : '—' },
      { key: 'id', label: 'Where it went', html: 1, fmt: (v, r) => `<div style="min-width:180px">${accBar(r, r.qty_in, { legend: false })}</div>` },
      { key: 'closed_pct', label: 'Used up', right: 1, fmt: v => v + '%' }, { key: 'revenue', label: 'Sales', right: 1, fmt: money }, { key: 'cost', label: 'Cost', right: 1, fmt: money },
      { key: 'margin', label: 'Margin', right: 1, html: 1, fmt: v => `<b style="color:${v < 0 ? 'var(--bad)' : 'var(--ok)'}">${money(v)}</b>` }],
      rows, { rowAttr: r => `data-c="${r.id}"`, empty: 'No carcasses yet. Tick "Carcass / primal" on the product (or install a starter template), then receive each carcass with its own tag and weight (Purchasing → Receive).' })}`;
  $$('[data-c]', root).forEach(tr => tr.onclick = () => showLedger(tr.dataset.c));
}

// ---------------------------------------------------------------- by animal
async function animalsTab(root) {
  const q = query(); const to = q.to || today(); const from = q.from || to.slice(0, 8) + '01';
  const rep = await GET(`/butchery/species-report?from=${from}&to=${to}`);
  const pctCell = (v, good, warn) => v == null ? '—' : `<b style="color:${v >= good ? 'var(--ok)' : v >= warn ? 'var(--warn)' : 'var(--bad)'}">${v}%</b>`;
  root.innerHTML = `<div class="row wrap" style="margin-bottom:12px"><label class="row">From <input type="date" id="af" value="${from}"></label><label class="row">To <input type="date" id="at" value="${to}"></label>
      <span class="spacer"></span><span class="muted">Products count towards an animal through their <b>Animal</b> field (Products). Cuts take it from the carcass automatically when cut.</span></div>
    ${rep.rows.length ? `<div class="cols cols-3" style="margin-bottom:14px">${rep.rows.map(r => `<div class="card" style="border-top:4px solid ${r.color}"><h3>${r.icon} ${esc(r.name)}</h3>
      <div class="cols cols-2" style="gap:8px">
        <div><div class="muted" style="font-size:12px">Carcasses in</div><b>${r.carcasses}</b> · ${kg(r.carcass_kg)}</div>
        <div><div class="muted" style="font-size:12px">Dressing %</div>${pctCell(r.dressing_pct, 55, 45)}${r.live_kg ? ` <span class="muted" style="font-size:12px">of ${kg(r.live_kg)} live</span>` : ''}</div>
        <div><div class="muted" style="font-size:12px">Cutting yield</div>${pctCell(r.yield_pct, 75, 65)} <span class="muted" style="font-size:12px">${r.breakdowns} cut</span></div>
        <div><div class="muted" style="font-size:12px">Bone / fat loss</div><b>${kg(r.cut_loss_kg)}</b></div>
        <div><div class="muted" style="font-size:12px">Sales (ex VAT)</div><b>${money(r.sales_net)}</b> <span class="muted" style="font-size:12px">${kg(r.sold_kg)}</span></div>
        <div><div class="muted" style="font-size:12px">Gross margin</div><b style="color:${r.gross_margin < 0 ? 'var(--bad)' : 'var(--ok)'}">${money(r.gross_margin)}</b>${r.margin_pct != null ? ` <span class="muted" style="font-size:12px">${r.margin_pct}%</span>` : ''}</div>
        <div><div class="muted" style="font-size:12px">Written off</div><b style="color:${r.waste_value ? 'var(--bad)' : 'inherit'}">${money(r.waste_value)}</b> <span class="muted" style="font-size:12px">${kg(r.waste_kg)}</span></div>
        <div><div class="muted" style="font-size:12px">Carcass cost</div><b>${money(r.carcass_cost)}</b></div></div>
      <a class="btn btn-sm" style="margin-top:10px" href="#/butchery?tab=carcasses&status=all&species=${r.species}">View carcasses →</a></div>`).join('')}</div>` : '<div class="empty">Nothing in this period yet.</div>'}`;
  const go = () => location.hash = `#/butchery?tab=animals&from=${$('#af').value}&to=${$('#at').value}`;
  $('#af').onchange = go; $('#at').onchange = go;
}

async function starterDialog(done) {
  const list = await GET('/butchery/starters');
  modal({ title: 'Starter cutting templates', wide: true, body: `<p class="muted">Creates the carcass product, a product for each cut (sold by weight, batch-tracked, with a scale PLU and shelf life), a category and a cutting template with typical yields.
      Products that already exist are reused. <b>Selling prices start at 0 – set them in Products</b>, and adjust the yields to your own cutting results.</p>
    <div class="cols cols-3">${list.map(s => `<label class="card" style="cursor:pointer;border-top:4px solid ${s.color}"><div class="row"><input type="checkbox" data-sp="${s.species}"><h3 style="margin:0">${s.icon} ${esc(s.name)}</h3></div>
      <div class="muted" style="font-size:12px;margin:4px 0 6px">${esc(s.carcass)} · saleable ${s.saleable_pct}%</div>
      <ul class="list-plain" style="font-size:12px">${s.cuts.map(c => `<li><span>${c.is_waste ? '🗑 ' : ''}${esc(c.name)}</span><span>${c.yield_pct}%</span></li>`).join('')}</ul></label>`).join('')}</div>`,
    actions: [{ label: 'Cancel' }, { label: 'Create', cls: 'btn-primary', onClick: async (c, r) => {
      const sp = $$('[data-sp]', r).filter(i => i.checked).map(i => i.dataset.sp);
      if (!sp.length) throw new Error('Tick at least one animal');
      const res = await POST('/butchery/starters', { species: sp });
      c(); toast(`Created: ${res.map(x => `${x.name} (${x.products_created} new products)`).join(', ')}. Now set the selling prices in Products.`, 'ok', 8000); done();
    } }] });
}

// ---------------------------------------------------------------- production (sausage, patties, biltong…)
const KINDS = [['meat', 'Meat', '#b91c1c'], ['fat', 'Fat', '#f59e0b'], ['casing', 'Casing', '#7c3aed'], ['water', 'Water / ice', '#0ea5e9'], ['binder', 'Binder / soy / rusk', '#a16207'], ['spice', 'Spices & salt', '#15803d'], ['other', 'Other', '#6b7280']];
const kindName = k => (KINDS.find(x => x[0] === k) || KINDS[6])[1];
function compBar(parts, total) {
  return `<div class="comp-bar">${KINDS.map(([k, l, c]) => { const q = parts.filter(p => p.kind === k).reduce((s, p) => s + Number(p.qty || 0), 0); const w = total ? q / total * 100 : 0;
    return w > 0 ? `<div style="width:${w}%;background:${c}" title="${l} ${fq(q)} kg (${w.toFixed(1)}%)">${w > 8 ? `${l} ${w.toFixed(0)}%` : ''}</div>` : ''; }).join('')}</div>`;
}

async function productionTab(root, st) {
  const [runs, recipes] = await Promise.all([GET('/butchery/production'), GET('/butchery/recipes')]);
  root.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="muted">Make sausage, boerewors, patties or biltong from weighed meat, fat, casings, water, soy and spices. Each ingredient batch is linked to the product so every gram can be traced back to its carcass.</span>
      <span class="spacer"></span><button class="btn" id="nrc">＋ New recipe</button><button class="btn btn-primary" id="npr">＋ New production run</button></div>
    <div class="cols cols-3" style="margin-bottom:14px">${recipes.map(r => { const tot = r.lines.reduce((s, l) => s + Number(l.qty), 0);
      return `<div class="card" data-rc="${r.id}" style="cursor:pointer"><h3>${esc(r.name)}</h3><div class="muted" style="margin-bottom:8px">${fq(tot)} kg ingredients → ${fq(r.output_qty)} kg ${esc(r.output_name)}</div>${compBar(r.lines.map(l => ({ kind: l.kind, qty: l.qty })), tot)}</div>`; }).join('') || '<div class="empty">No recipes yet. A recipe lists the ingredients for one batch, e.g. boerewors: beef 7 kg, pork fat 1.5 kg, water 1.1 kg, spice 0.3 kg, casings 0.2 kg → 10 kg.</div>'}</div>
    <div class="card"><h3>Production runs</h3>${tableHtml([{ key: 'number', label: 'Number' }, { key: 'run_date', label: 'Date', fmt: d }, { key: 'output_name', label: 'Product' }, { key: 'batch_no', label: 'Batch' },
      { key: 'input_qty_total', label: 'Ingredients', right: 1, fmt: kg }, { key: 'output_qty', label: 'Made', right: 1, fmt: kg }, { key: 'yield_pct', label: 'Yield', right: 1, fmt: v => v + '%' },
      { key: 'meat_pct', label: 'Meat content', right: 1, fmt: v => v + '%' }, { key: 'cost_per_kg', label: 'Cost / kg', right: 1, fmt: money }, { key: 'user_name', label: 'By' }], runs, { rowAttr: r => `data-run="${r.id}"`, empty: 'No production yet.' })}</div>`;
  $('#nrc').onclick = () => editRecipe(null, () => productionTab(root, st));
  $$('[data-rc]', root).forEach(c => c.onclick = () => editRecipe(recipes.find(r => r.id === Number(c.dataset.rc)), () => productionTab(root, st)));
  $('#npr').onclick = () => newRun(st, recipes, () => productionTab(root, st));
  $$('[data-run]', root).forEach(tr => tr.onclick = () => showRun(tr.dataset.run));
}

async function editRecipe(rc, done) {
  const products = await stockProducts();
  const all = await GET('/products');
  const lines = rc ? rc.lines.map(l => ({ product_id: l.product_id, name: l.product_id ? '' : l.name, kind: l.kind, qty: Number(l.qty) })) : [{ product_id: null, name: '', kind: 'meat', qty: '' }];
  const acts = [{ label: 'Cancel' }];
  if (rc) acts.push({ label: 'Delete', cls: 'btn-danger', onClick: async c => { if (await confirmBox('Delete this recipe?', { danger: true })) { await DEL('/butchery/recipes/' + rc.id); c(); done(); } } });
  acts.push({ label: 'Save', cls: 'btn-primary', onClick: async (c, r) => {
    const body = { name: r.querySelector('#rn').value, output_product_id: Number(r.querySelector('#ro').value), output_qty: Number(r.querySelector('#rq').value), notes: r.querySelector('#rnt').value, lines };
    if (rc) await PUT('/butchery/recipes/' + rc.id, body); else await POST('/butchery/recipes', body);
    c(); toast('Recipe saved'); done();
  } });
  modal({ title: rc ? 'Edit recipe' : 'New recipe', wide: true, actions: acts, body: `<div class="form-grid">
      <label class="field"><span>Name</span><input id="rn" value="${esc(rc ? rc.name : '')}" placeholder="e.g. Traditional boerewors"></label>
      <label class="field"><span>Makes (product)</span><select id="ro">${products.map(p => `<option value="${p.id}" ${rc && rc.output_product_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Batch size – kg of finished product</span><input id="rq" type="number" step="0.001" value="${rc ? Number(rc.output_qty) : 10}"></label>
      <label class="field"><span>Notes</span><input id="rnt" value="${esc(rc ? rc.notes || '' : '')}"></label></div><div id="rl"></div>`, onOpen: r => {
    const draw = () => {
      const tot = lines.reduce((s, l) => s + Number(l.qty || 0), 0);
      r.querySelector('#rl').innerHTML = `<table class="grid lines" style="margin-top:12px"><thead><tr><th>Ingredient (product, or a name for e.g. water)</th><th style="width:170px">Type</th><th style="width:120px">kg per batch</th><th class="r" style="width:70px">%</th><th></th></tr></thead><tbody>
        ${lines.map((l, i) => `<tr><td><div class="row" style="gap:6px"><select data-ip="${i}" style="flex:1"><option value="">— no stock item —</option>${all.filter(p => p.type !== 'service').map(p => `<option value="${p.id}" ${p.id === l.product_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
          ${l.product_id ? '' : `<input data-in="${i}" value="${esc(l.name || '')}" placeholder="name e.g. Water" style="flex:1">`}</div></td>
          <td><select data-ik="${i}">${KINDS.map(([k, n]) => `<option value="${k}" ${k === l.kind ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
          <td><input type="number" step="0.001" data-iq="${i}" value="${l.qty}"></td><td class="r">${tot ? (Number(l.qty || 0) / tot * 100).toFixed(1) : ''}</td><td><button class="icon-btn" data-ix="${i}">✕</button></td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="2">Total ingredients</td><td>${kg(Math.round(tot * 1000) / 1000)}</td><td colspan="2"></td></tr></tfoot></table>
        <div style="margin-top:8px">${compBar(lines, tot)}</div><button class="btn btn-sm" id="ria" style="margin-top:8px">＋ Ingredient</button>`;
      $$('[data-ip]', r).forEach(s => s.onchange = () => { const l = lines[Number(s.dataset.ip)]; l.product_id = Number(s.value) || null; draw(); });
      $$('[data-in]', r).forEach(s => s.oninput = () => { lines[Number(s.dataset.in)].name = s.value; });
      $$('[data-ik]', r).forEach(s => s.onchange = () => { lines[Number(s.dataset.ik)].kind = s.value; draw(); });
      $$('[data-iq]', r).forEach(s => s.onchange = () => { lines[Number(s.dataset.iq)].qty = s.value; draw(); });
      $$('[data-ix]', r).forEach(b => b.onclick = () => { lines.splice(Number(b.dataset.ix), 1); draw(); });
      r.querySelector('#ria').onclick = () => { lines.push({ product_id: null, name: '', kind: 'spice', qty: '' }); draw(); };
    };
    draw();
  } });
}

async function newRun(st, recipes, done) {
  const [products, all] = await Promise.all([stockProducts(), GET('/products')]);
  const S = { recipe: recipes[0] || null, target: recipes[0] ? Number(recipes[0].output_qty) : 10, lines: [], out_id: recipes[0] ? recipes[0].output_product_id : (products[0] || {}).id, output: '' };
  const batchCache = {};
  const fromRecipe = () => {
    const f = S.recipe ? S.target / Number(S.recipe.output_qty) : 1;
    S.lines = S.recipe ? S.recipe.lines.map(l => ({ product_id: l.product_id, fixed: 1, name: l.product_name || l.name, kind: l.kind, planned_qty: Math.round(Number(l.qty) * f * 1000) / 1000, actual_qty: '', batch_id: '' })) : [];
  };
  fromRecipe();
  modal({ title: 'New production run', wide: true, body: '<div id="pr"></div>', onOpen: r => draw(r),
    actions: [{ label: 'Cancel' }, { label: 'Post production', cls: 'btn-primary', onClick: async (c, r) => {
      const body = { recipe_id: S.recipe && S.recipe.id, output_product_id: Number(S.out_id), output_qty: Number(S.output), run_date: r.querySelector('#prd').value,
        batch_no: r.querySelector('#prb').value || null, expiry_date: r.querySelector('#pre').value || null, notes: r.querySelector('#prn').value, allow_negative: r.querySelector('#pan').checked,
        lines: S.lines.map(l => ({ product_id: l.product_id || null, name: l.name, kind: l.kind, planned_qty: Number(l.planned_qty || 0), actual_qty: Number(l.actual_qty || 0), batch_id: Number(l.batch_id) || null })) };
      if (!(body.output_qty > 0)) throw new Error('Weigh the finished product');
      const res = await POST('/butchery/production', body); c(); toast(`Production ${res.number} posted`); done(); showRun(res.id);
    } }] });
  async function draw(r) {
    for (const l of S.lines) {
      const p = all.find(x => x.id === l.product_id);
      if (p && p.track_batches && !batchCache[p.id]) batchCache[p.id] = await GET(`/butchery/batches?product_id=${p.id}`);
    }
    const outP = all.find(p => p.id === Number(S.out_id));
    const live = () => {
      const inQ = S.lines.reduce((s, l) => s + Number(l.actual_qty || 0), 0), meat = S.lines.filter(l => l.kind === 'meat').reduce((s, l) => s + Number(l.actual_qty || 0), 0);
      const out = Number(S.output || 0);
      return `Ingredients <b>${kg(Math.round(inQ * 1000) / 1000)}</b>${out ? ` · made <b>${kg(out)}</b> · yield <b>${inQ ? (out / inQ * 100).toFixed(1) : 0}%</b> · meat content <b>${(meat / out * 100).toFixed(1)}%</b>` : ''}`;
    };
    r.querySelector('#pr').innerHTML = `<div class="form-grid">
        <label class="field"><span>Recipe</span><select id="prr"><option value="">— none —</option>${recipes.map(x => `<option value="${x.id}" ${S.recipe && S.recipe.id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Planned output (kg) – scales the recipe</span><input id="prt" type="number" step="0.001" value="${S.target}"></label>
        <label class="field"><span>Product made</span><select id="pro">${products.map(p => `<option value="${p.id}" ${p.id === Number(S.out_id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Date</span><input id="prd" type="date" value="${today()}"></label></div>
      <table class="grid lines" style="margin-top:12px"><thead><tr><th>Ingredient</th><th>Type</th><th class="r">Planned kg</th><th style="width:150px">Weighed kg</th><th>From batch</th><th class="r">In stock</th><th></th></tr></thead><tbody>
      ${S.lines.map((l, i) => { const p = all.find(x => x.id === l.product_id); const bs = p ? batchCache[p.id] || [] : [];
        return `<tr><td>${l.product_id || l.fixed ? esc(l.name) : `<div class="row" style="gap:4px"><select data-np="${i}"><option value="">— not a stock item —</option>${all.filter(x => x.type !== 'service').map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select><input data-nn="${i}" value="${esc(l.name || '')}" placeholder="name, e.g. Ice" style="width:110px"></div>`}</td>
          <td><select data-nk="${i}">${KINDS.map(([k, n]) => `<option value="${k}" ${k === l.kind ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
          <td class="r">${l.planned_qty ? fq(l.planned_qty) : ''}</td><td><input type="number" step="0.001" data-na="${i}" value="${l.actual_qty}" data-scale></td>
          <td>${bs.length ? `<select data-nb="${i}"><option value="">first to expire</option>${bs.map(b => `<option value="${b.id}" ${String(b.id) === String(l.batch_id) ? 'selected' : ''}>${esc(b.batch_no)} · ${fq(b.qty_remaining)} kg${b.expiry_date ? ' · ' + d(b.expiry_date) : ''}</option>`).join('')}</select>` : '<span class="muted">—</span>'}</td>
          <td class="r">${p && p.type === 'stock' ? `${fq(p.stock_qty)} ${esc(p.uom)}` : '<span class="muted">not stocked</span>'}</td><td><button class="icon-btn" data-nx="${i}">✕</button></td></tr>`; }).join('')}
      </tbody></table><button class="btn btn-sm" id="pad" style="margin-top:8px">＋ Ingredient</button>
      <div class="form-grid" style="margin-top:14px">
        <label class="field"><span><b>Finished product weighed (kg)</b></span><input id="pou" type="number" step="0.001" value="${S.output}" data-scale></label>
        <label class="field"><span>Batch no. (blank = automatic)</span><input id="prb"></label>
        <label class="field"><span>Use-by</span><input id="pre" type="date" value="${outP && outP.shelf_life_days ? plusDays(outP.shelf_life_days) : ''}"></label>
        <label class="field"><span>Notes</span><input id="prn" placeholder="e.g. made by Palesa"></label></div>
      <div class="row" style="margin-top:10px"><span id="plv">${live()}</span><span class="spacer"></span><label class="row" style="gap:6px"><input type="checkbox" id="pan"> allow negative stock</label></div>`;
    scaleOn(r, st);
    const upd = () => { r.querySelector('#plv').innerHTML = live(); };
    r.querySelector('#prr').onchange = e => { S.recipe = recipes.find(x => x.id === Number(e.target.value)) || null; if (S.recipe) { S.out_id = S.recipe.output_product_id; S.target = Number(S.recipe.output_qty); } fromRecipe(); draw(r); };
    r.querySelector('#prt').onchange = e => { S.target = Number(e.target.value) || 0; const keep = S.lines.map(l => l.actual_qty); fromRecipe(); S.lines.forEach((l, i) => { l.actual_qty = keep[i] || ''; }); draw(r); };
    r.querySelector('#pro').onchange = e => { S.out_id = Number(e.target.value); draw(r); };
    r.querySelector('#pou').oninput = e => { S.output = e.target.value; upd(); };
    $$('[data-na]', r).forEach(i => i.oninput = () => { S.lines[Number(i.dataset.na)].actual_qty = i.value; upd(); });
    $$('[data-nb]', r).forEach(s => s.onchange = () => { S.lines[Number(s.dataset.nb)].batch_id = s.value; });
    $$('[data-nk]', r).forEach(s => s.onchange = () => { S.lines[Number(s.dataset.nk)].kind = s.value; upd(); });
    $$('[data-np]', r).forEach(s => s.onchange = () => { const l = S.lines[Number(s.dataset.np)]; l.product_id = Number(s.value) || null; if (l.product_id) l.name = all.find(x => x.id === l.product_id).name; draw(r); });
    $$('[data-nn]', r).forEach(i => i.oninput = () => { S.lines[Number(i.dataset.nn)].name = i.value; });
    $$('[data-nx]', r).forEach(b => b.onclick = () => { S.lines.splice(Number(b.dataset.nx), 1); draw(r); });
    r.querySelector('#pad').onclick = () => { S.lines.push({ product_id: null, name: '', kind: 'spice', planned_qty: 0, actual_qty: '', batch_id: '' }); draw(r); };
  }
}

async function showRun(id) {
  const r = await GET('/butchery/production/' + id);
  const org = r.output_batch_id ? await GET(`/butchery/batches/${r.output_batch_id}/origins`) : [];
  const html = `<div class="cols cols-4" style="margin-bottom:12px">
      <div class="kpi"><div class="label">Made</div><div class="value">${kg(r.output_qty)}</div><div class="hint">${esc(r.output_name)}${r.batch_no ? ' · batch ' + esc(r.batch_no) : ''}</div></div>
      <div class="kpi"><div class="label">Meat content</div><div class="value">${r.meat_pct}%</div><div class="hint">${kg(r.meat_qty)} meat in ${kg(r.output_qty)}</div></div>
      <div class="kpi"><div class="label">Yield</div><div class="value">${r.yield_pct}%</div><div class="hint">${kg(r.input_qty_total)} ingredients</div></div>
      <div class="kpi"><div class="label">Cost</div><div class="value">${money(r.cost_total)}</div><div class="hint">${money(r.cost_total / r.output_qty)} / kg · sells at ${money(r.price)}</div></div></div>
    ${compBar(r.lines.map(l => ({ kind: l.kind, qty: l.actual_qty })), Number(r.input_qty_total))}
    <div class="acc-legend">${r.by_kind.map(k => `<span><i style="background:${(KINDS.find(x => x[0] === k.kind) || KINDS[6])[2]}"></i>${kindName(k.kind)} <b>${fq(k.qty)} kg</b> (${k.pct}% of product)</span>`).join('')}</div>
    <div style="margin-top:12px">${tableHtml([{ key: 'name', label: 'Ingredient' }, { key: 'kind', label: 'Type', fmt: kindName }, { key: 'planned_qty', label: 'Planned', right: 1, fmt: v => Number(v) ? kg(v) : '' },
      { key: 'actual_qty', label: 'Used', right: 1, fmt: kg }, { key: 'pct_of_output', label: '% of product', right: 1, fmt: v => v + '%' }, { key: 'batches', label: 'Batches used' },
      { key: 'cost_total', label: 'Cost', right: 1, fmt: money }], r.lines)}</div>
    ${org.length ? `<h4 style="margin:14px 0 6px">Traced back to</h4>${originsHtml(org, r.uom)}` : ''}`;
  modal({ title: `${r.number} — ${esc(r.output_name)} ${d(r.run_date)}`, wide: true, body: html + (r.notes ? `<p class="muted">${esc(r.notes)}</p>` : ''),
    actions: [{ label: 'Close' }, ...(r.output_batch_id ? [{ label: '🔎 Where did it go?', onClick: c => { c(); showLedger(r.output_batch_id); } }] : [])] });
}
