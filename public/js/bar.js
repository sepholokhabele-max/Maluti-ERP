// Bar: spirits & wine by measure, bottle stock counts by weight, pour checks with a scale
import { GET, POST, PUT, DEL, esc, $, $$, toast, err, can, money, qty as fq, modal, confirmBox, tableHtml, badge, page, d, today, query } from './core.js';
import { attachScale, scaleSupported, readWeight } from './scale.js';

const TABS = [['bottles', 'Bottles & measures'], ['count', 'Stock count (weigh bottles)'], ['pour', 'Pour check'], ['pours', 'Poured / sold']];
const ml = n => `${Math.round(Number(n) * 10) / 10} ml`;
let scaleCfg = null;
const scaleOn = r => { if (scaleCfg && scaleSupported()) attachScale(r, scaleCfg, { force: true, onError: m => err(new Error(m)) }); };

/** same maths as the server: ml left = (weight − empty bottle) ÷ density, capped at the bottle size */
function mlLeft(b, grams) {
  if (!(Number(grams) > 0) || !(Number(b.bottle_empty_g) > 0)) return 0;
  return Math.round(Math.max(0, Math.min(b.bottle_ml, (Number(grams) - b.bottle_empty_g) / b.density)) * 10) / 10;
}
const gauge = (b, mlv) => `<div class="bottle-gauge" title="${ml(mlv)} of ${b.bottle_ml} ml"><div style="height:${Math.min(100, mlv / b.bottle_ml * 100)}%"></div></div>`;

export async function bar(view) {
  const tab = query().tab || 'bottles';
  view.innerHTML = page('Bar stock', '', `<div class="tabs">${TABS.map(([k, l]) => `<a href="#/bar?tab=${k}" class="${tab === k ? 'active' : ''}">${l}</a>`).join('')}</div><div id="barb"></div>`);
  scaleCfg = await GET('/bar/scale').catch(() => null);
  return ({ bottles: bottlesTab, count: countTab, pour: pourTab, pours: poursTab }[tab] || bottlesTab)($('#barb'));
}

async function bottlesTab(root) {
  const bs = await GET('/bar/bottles');
  root.innerHTML = `<p class="muted" style="margin-bottom:10px">Bottles are stocked in whole bottles; tots, doubles and glasses of wine are sold as <b>measures</b> that take their millilitres off the bottle.
    To set up: Products → edit the bottle → <i>Bar</i>: bottle size, empty weight (with pourer) and full weight. Then make a product for each measure, choose the bottle it pours from and its ml.</p>
    ${bs.length ? bs.map(b => `<div class="card" style="margin-bottom:10px"><div class="row" style="align-items:flex-start;gap:16px">${gauge(b, b.bottle_ml)}
      <div style="flex:1"><h3 style="margin:0">${esc(b.name)}</h3><div class="muted">${b.category_name ? esc(b.category_name) + ' · ' : ''}${b.bottle_ml} ml · empty ${b.bottle_empty_g ? b.bottle_empty_g + ' g' : '<b style="color:var(--bad)">not set</b>'} · full ${b.bottle_full_g ? b.bottle_full_g + ' g' : '—'} · density ${b.density} g/ml</div>
        <div style="margin:6px 0"><b>${fq(b.stock_qty)}</b> bottles in stock = <b>${ml(b.stock_ml)}</b> · cost ${money(b.cost)} / bottle (${money(b.cost / b.bottle_ml * 1000)} / litre)</div>
        ${b.measures.length ? tableHtml([{ key: 'name', label: 'Measure' }, { key: 'pour_ml', label: 'Size', right: 1, fmt: ml }, { key: 'per_bottle', label: 'Per bottle', right: 1 },
          { key: 'price', label: 'Price', right: 1, fmt: money }, { key: 'cost', label: 'Cost', right: 1, fmt: money }, { key: 'gp_pct', label: 'GP', right: 1, html: 1, fmt: v => v == null ? '' : `<b style="color:${v < 60 ? 'var(--warn)' : 'var(--ok)'}">${v}%</b>` }], b.measures)
          : '<span class="muted">No measures yet – sold by the bottle only.</span>'}</div></div></div>`).join('')
      : '<div class="empty">No bottle products yet. Edit a spirit or wine in Products and fill in the <b>Bar</b> section (bottle size, empty and full weight).</div>'}`;
}

// ---------------------------------------------------------------- stock count by weight
async function countTab(root) {
  const rows = await GET('/bar/counts');
  root.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="muted">Count full bottles and put each open bottle on the scale – the system works out the millilitres left and compares them with what the tills say should be there.</span>
      <span class="spacer"></span><button class="btn btn-primary" id="nbc">＋ New bar count</button></div>
    ${tableHtml([{ key: 'number', label: 'Number' }, { key: 'count_date', label: 'Date', fmt: d }, { key: 'line_count', label: 'Bottles counted', right: 1 },
      { key: 'status', label: 'Status', html: 1, fmt: v => badge(v, v === 'posted' ? 'paid' : 'draft') },
      { key: 'variance_value', label: 'Variance (at cost)', right: 1, html: 1, fmt: v => `<b style="color:${v < 0 ? 'var(--bad)' : 'inherit'}">${money(v)}</b>` }, { key: 'user_name', label: 'By' }],
      rows, { rowAttr: r => `data-bc="${r.id}"`, empty: 'No counts yet.' })}`;
  $('#nbc').onclick = () => editCount(null, () => countTab(root));
  $$('[data-bc]', root).forEach(tr => tr.onclick = () => editCount(Number(tr.dataset.bc), () => countTab(root)));
}

async function editCount(id, done) {
  const [bs, k] = await Promise.all([GET('/bar/bottles'), id ? GET('/bar/counts/' + id) : null]);
  const posted = k && k.status === 'posted';
  const S = new Map(bs.map(b => [b.id, { full: '', weights: [''], touched: false }]));
  if (k) for (const l of k.lines) S.set(l.product_id, { full: Number(l.full_bottles), weights: [...String(l.open_weights || '').split(/[\s,;]+/).filter(Boolean), ''], touched: true });
  const lineOf = b => {
    const s = S.get(b.id);
    const openMl = s.weights.reduce((t, g) => t + mlLeft(b, g), 0);
    const counted = Number(s.full || 0) + openMl / b.bottle_ml;
    const v = counted - b.stock_qty;
    return { openMl, counted, v, vml: v * b.bottle_ml, val: v * b.cost };
  };
  const body = () => {
    if (posted) return `<p>Posted ${d(k.posted_at)} by ${esc(k.user_name || '')}.</p>` + tableHtml([{ key: 'name', label: 'Bottle' }, { key: 'full_bottles', label: 'Full', right: 1, fmt: fq }, { key: 'open_weights', label: 'Open bottles (g)' },
      { key: 'open_ml', label: 'Open ml', right: 1, fmt: ml }, { key: 'counted_qty', label: 'Counted', right: 1, fmt: fq }, { key: 'system_qty', label: 'System', right: 1, fmt: fq },
      { key: 'variance_ml', label: 'Variance', right: 1, html: 1, fmt: v => `<b style="color:${v < 0 ? 'var(--bad)' : 'inherit'}">${v > 0 ? '+' : ''}${ml(v)}</b>` }, { key: 'variance_value', label: 'Value', right: 1, fmt: money }], k.lines);
    return `<div class="row" style="margin-bottom:8px"><label class="row">Date <input type="date" id="bcd" value="${k ? d(k.count_date) : today()}"></label><input id="bcf" placeholder="Filter bottles…" style="max-width:220px"><input id="bcn" placeholder="Notes" value="${esc(k ? k.notes || '' : '')}" style="flex:1"></div>
      <table class="grid lines"><thead><tr><th>Bottle</th><th class="r">System</th><th style="width:90px">Full bottles</th><th>Open bottles – weight (g)</th><th class="r">Counted</th><th class="r">Variance</th></tr></thead><tbody>
      ${bs.map(b => { const s = S.get(b.id), c = lineOf(b);
        return `<tr data-row="${b.id}" data-name="${esc(b.name.toLowerCase())}"><td><b>${esc(b.name)}</b><div class="muted" style="font-size:11px">${b.bottle_ml} ml · empty ${b.bottle_empty_g || '?'} g</div></td>
          <td class="r">${fq(b.stock_qty)}<div class="muted" style="font-size:11px">${ml(b.stock_ml)}</div></td>
          <td><input type="number" step="1" min="0" data-full="${b.id}" value="${s.full}"></td>
          <td><div class="row wrap" style="gap:6px">${s.weights.map((g, i) => `<span class="row" style="gap:3px"><input type="number" step="1" data-w="${b.id}:${i}" value="${g}" data-scale="g" style="width:90px" placeholder="g"><span class="muted" data-wm="${b.id}:${i}" style="font-size:11px;min-width:56px">${g ? ml(mlLeft(b, g)) : ''}</span></span>`).join('')}
            <button class="btn btn-sm" data-wadd="${b.id}">＋</button></div></td>
          <td class="r" data-cnt="${b.id}">${s.touched ? `${fq(Math.round(c.counted * 10000) / 10000)}<div class="muted" style="font-size:11px">${ml(c.counted * b.bottle_ml)}</div>` : '<span class="muted">not counted</span>'}</td>
          <td class="r" data-var="${b.id}">${s.touched ? `<b style="color:${c.vml < -0.05 ? 'var(--bad)' : 'inherit'}">${c.vml > 0 ? '+' : ''}${ml(c.vml)}</b><div style="font-size:11px">${money(c.val)}</div>` : ''}</td></tr>`; }).join('')}
      </tbody><tfoot><tr><td colspan="5">Total variance at cost (counted bottles only)</td><td class="r" id="bctot"></td></tr></tfoot></table>
      <p class="muted" style="font-size:12px">Variance compares the count with the system stock now. When you post, stock is adjusted to the count: shortages go to 5150 Stock Losses, surpluses to 4950 Stock Count Gains.</p>`;
  };
  const payload = r => ({ count_date: r.querySelector('#bcd').value, notes: r.querySelector('#bcn').value,
    lines: bs.filter(b => S.get(b.id).touched).map(b => ({ product_id: b.id, full_bottles: Number(S.get(b.id).full || 0), open_weights: S.get(b.id).weights.filter(g => Number(g) > 0).map(Number) })) });
  const save = async r => { const p = payload(r); if (!p.lines.length) throw new Error('Count at least one bottle'); return id ? (await PUT('/bar/counts/' + id, p)).id : (id = (await POST('/bar/counts', p)).id); };
  const acts = posted ? [{ label: 'Close' }] : [{ label: 'Cancel' },
    ...(id ? [{ label: 'Delete', cls: 'btn-danger', onClick: async c => { if (await confirmBox('Delete this draft count?', { danger: true })) { await DEL('/bar/counts/' + id); c(); done(); } } }] : []),
    { label: 'Save draft', onClick: async (c, r) => { await save(r); c(); toast('Count saved'); done(); } },
    { label: 'Post count', cls: 'btn-primary', onClick: async (c, r) => {
      await save(r);
      if (!(await confirmBox('Post this count? Stock will be adjusted to what you counted.', { okLabel: 'Post' }))) return;
      const res = await POST(`/bar/counts/${id}/post`); c(); toast(`Count posted: ${money(res.net)}`); done();
    } }];
  modal({ title: posted ? `Bar count ${k.number}` : (k ? `Bar count ${k.number} (draft)` : 'New bar count'), wide: true, body: '<div id="bcb"></div>', actions: acts, onOpen: r => {
    const draw = () => {
      const keep = r.querySelector('#bcf') ? { f: r.querySelector('#bcf').value, d: r.querySelector('#bcd').value, n: r.querySelector('#bcn').value } : null;
      r.querySelector('#bcb').innerHTML = body();
      if (posted) return;
      if (keep) { r.querySelector('#bcf').value = keep.f; r.querySelector('#bcd').value = keep.d; r.querySelector('#bcn').value = keep.n; }
      scaleOn(r);
      const refresh = bid => {
        const b = bs.find(x => x.id === bid), s = S.get(bid), c = lineOf(b);
        s.weights.forEach((g, i) => { const e = r.querySelector(`[data-wm="${bid}:${i}"]`); if (e) e.textContent = g ? ml(mlLeft(b, g)) : ''; });
        r.querySelector(`[data-cnt="${bid}"]`).innerHTML = `${fq(Math.round(c.counted * 10000) / 10000)}<div class="muted" style="font-size:11px">${ml(c.counted * b.bottle_ml)}</div>`;
        r.querySelector(`[data-var="${bid}"]`).innerHTML = `<b style="color:${c.vml < -0.05 ? 'var(--bad)' : 'inherit'}">${c.vml > 0 ? '+' : ''}${ml(c.vml)}</b><div style="font-size:11px">${money(c.val)}</div>`;
        total();
      };
      const total = () => { r.querySelector('#bctot').innerHTML = `<b>${money(bs.filter(b => S.get(b.id).touched).reduce((t, b) => t + lineOf(b).val, 0))}</b>`; };
      $$('[data-full]', r).forEach(i => i.oninput = () => { const bid = Number(i.dataset.full); const s = S.get(bid); s.full = i.value; s.touched = true; refresh(bid); });
      $$('[data-w]', r).forEach(i => i.oninput = () => { const [bid, k2] = i.dataset.w.split(':').map(Number); const s = S.get(bid); s.weights[k2] = i.value; s.touched = true; refresh(bid); });
      $$('[data-wadd]', r).forEach(bt => bt.onclick = () => { const bid = Number(bt.dataset.wadd); S.get(bid).weights.push(''); draw(); const ins = r.querySelectorAll(`[data-w^="${bid}:"]`); ins[ins.length - 1].focus(); });
      r.querySelector('#bcf').oninput = e => { const q = e.target.value.toLowerCase(); $$('[data-row]', r).forEach(tr => { tr.style.display = tr.dataset.name.includes(q) ? '' : 'none'; }); };
      total();
    };
    draw();
  } });
}

// ---------------------------------------------------------------- pour check
async function pourTab(root) {
  const bs = (await GET('/bar/bottles')).filter(b => b.bottle_empty_g);
  if (!bs.length) { root.innerHTML = '<div class="empty">Set up at least one bottle with its empty weight (Products → Bar section) to check pours.</div>'; return; }
  root.innerHTML = `<div class="cols cols-2"><div class="card"><h3>Check a pour with the scale</h3>
      <p class="muted" style="font-size:13px">Weigh the bottle, pour the measure, weigh the bottle again. The difference in grams is turned into millilitres using the drink's density and compared with the measure.</p>
      <div class="form-grid"><label class="field"><span>Bottle</span><select id="pb">${bs.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Measure</span><select id="pm"></select></label>
        <label class="field"><span>Bottle weight before (g)</span><input id="pw1" type="number" step="0.1" data-scale="g"></label>
        <label class="field"><span>Bottle weight after (g)</span><input id="pw2" type="number" step="0.1" data-scale="g"></label></div>
      <div id="pres" style="margin-top:14px"></div></div>
    <div class="card"><h3>Open bottle → millilitres</h3><p class="muted" style="font-size:13px">Put any open bottle on the scale to see how much is left.</p>
      <div class="form-grid"><label class="field"><span>Bottle</span><select id="ob">${bs.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Weight (g)</span><input id="ow" type="number" step="0.1" data-scale="g"></label></div>
      <div class="row" style="margin-top:12px;gap:16px" id="ores"></div></div></div>`;
  scaleOn(root);
  const B = () => bs.find(b => b.id === Number($('#pb').value));
  const fillMeasures = () => { const b = B(); $('#pm').innerHTML = (b.measures.length ? b.measures : [{ id: 0, name: 'Single tot (25 ml)', pour_ml: 25 }]).map(m => `<option value="${m.pour_ml}">${esc(m.name)} – ${m.pour_ml} ml</option>`).join(''); calc(); };
  const calc = () => {
    const b = B(), w1 = Number($('#pw1').value), w2 = Number($('#pw2').value), target = Number($('#pm').value);
    if (!(w1 > 0 && w2 > 0)) { $('#pres').innerHTML = ''; return; }
    const poured = Math.round((w1 - w2) / b.density * 10) / 10, diff = Math.round((poured - target) * 10) / 10, p = target ? diff / target * 100 : 0;
    const col = Math.abs(p) <= 5 ? 'var(--ok)' : p > 0 ? 'var(--bad)' : 'var(--warn)';
    $('#pres').innerHTML = `<div class="kpi"><div class="label">Poured</div><div class="value" style="color:${col}">${ml(poured)}</div>
      <div class="hint">${Math.abs(p) <= 5 ? '✓ within 5% of the measure' : p > 0 ? `over-pour by ${ml(diff)} (${p.toFixed(0)}%) – ${money(diff * b.cost / b.bottle_ml)} lost per drink` : `short by ${ml(-diff)} (${(-p).toFixed(0)}%)`}</div></div>`;
  };
  const ocalc = () => { const b = bs.find(x => x.id === Number($('#ob').value)), g = Number($('#ow').value); const m = mlLeft(b, g);
    $('#ores').innerHTML = g ? `${gauge(b, m)}<div><div style="font-size:24px;font-weight:700">${ml(m)}</div><div class="muted">${(m / b.bottle_ml * 100).toFixed(0)}% of ${b.bottle_ml} ml · ${(m / b.bottle_ml).toFixed(3)} bottle${b.measures[0] ? ` · ≈ ${Math.floor(m / b.measures[0].pour_ml)} × ${esc(b.measures[0].name)}` : ''}</div></div>` : ''; };
  $('#pb').onchange = fillMeasures; $('#pm').onchange = calc; $('#pw1').oninput = calc; $('#pw2').oninput = calc;
  $('#ob').onchange = ocalc; $('#ow').oninput = ocalc;
  fillMeasures();
}

async function poursTab(root) {
  const q = query(); const from = q.from || today(), to = q.to || today();
  const rows = await GET(`/bar/pours?from=${from}&to=${to}`);
  root.innerHTML = `<div class="row" style="margin-bottom:10px"><label class="row">From <input type="date" id="pf" value="${from}"></label><label class="row">To <input type="date" id="pt" value="${to}"></label></div>
    ${tableHtml([{ key: 'name', label: 'Bottle' }, { key: 'ml', label: 'Poured / sold', right: 1, fmt: ml }, { key: 'bottles', label: 'Bottles', right: 1, fmt: fq }, { key: 'cost', label: 'Cost', right: 1, fmt: money }], rows, { empty: 'Nothing poured in this period.' })}`;
  const go = () => location.hash = `#/bar?tab=pours&from=${$('#pf').value}&to=${$('#pt').value}`;
  $('#pf').onchange = go; $('#pt').onchange = go;
}
