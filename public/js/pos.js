// Point of Sale: retail (barcode), restaurant (floor plan, kitchen tickets) and bar (tabs).
import { receiptLogoHtml, ensureLogo } from './core.js';
import { parseScaleBarcode } from './barcode.js';
import { best as bestRule } from './pricing.js';
import { readWeight, scaleSupported, chooseScalePort } from './scale.js';
import { agentDialog, requestPayment, isSmartelMethod, servicesHtml } from './smartelui.js';
import { state, GET, POST, PUT, esc, $, $$, toast, err, can, money, qty as fq, round2, modal, confirmBox, promptBox, printHtml, dt, timeAgo, badge, setToken, debounce, today } from './core.js';

let S = null;

function lineCalc(l) {
  const gross = Number(l.qty) * Number(l.unit_price) * (1 - Number(l.discount_pct || 0) / 100);
  const r = Number(l.tax_rate || 0) / 100;
  const total = l.label_total ? round2(l.label_total) : round2(gross); const net = round2(total / (1 + r));
  return { total, net, tax: round2(total - net) };
}
const weighedIds = () => new Set(((S && S.catalog && S.catalog.products) || []).filter(p => p.sold_by_weight).map(p => p.id));
const isWeighed = l => !!l.label_total || weighedIds().has(l.product_id);
function orderTotals() {
  let total = 0, tax = 0, disc = 0;
  for (const l of S.order.lines) { const c = lineCalc(l); total += c.total; tax += c.tax; disc += Number(l.qty) * Number(l.unit_price) * Number(l.discount_pct || 0) / 100; }
  return { total: round2(total), tax: round2(tax), net: round2(total - tax), discount: round2(disc), items: S.order.lines.reduce((s, l) => s + (isWeighed(l) ? 1 : Number(l.qty)), 0) };
}
const smartelOn = () => !!(S && S.catalog && S.catalog.smartel && S.catalog.smartel.enabled && S.catalog.smartel.till_linked);
const emptyOrder = (extra = {}) => ({ id: null, lines: [], partner_id: null, partner_name: null, table_id: null, table_name: null, tab_name: null, guests: 0, ...extra });

export async function start(terminalId) {
  document.onkeydown = null;
  if (!terminalId) return pickTerminal();
  const [terms, catalog] = await Promise.all([GET('/pos/terminals'), GET('/pos/catalog?terminal_id=' + encodeURIComponent(terminalId))]);
  const terminal = terms.find(t => String(t.id) === String(terminalId));
  if (!terminal) { location.hash = '#/pos'; return; }
  state.company = catalog.company || state.company;
  await ensureLogo();
  S = { terminal, catalog, session: null, cat: null, search: '', view: terminal.mode === 'restaurant' ? 'floor' : terminal.mode === 'bar' ? 'tabs' : 'order',
    order: emptyOrder(), sel: -1, floorIdx: 0, dirty: false };
  if (terminal.open_session_id) S.session = await GET('/pos/sessions/' + terminal.open_session_id);
  render();
  if (!S.session) openSessionDialog();
  // barcode scanners type fast and end with Enter: keep focus on the search box in order view
  document.onkeydown = e => {
    if ($('.modal-backdrop')) return;
    const si = $('#psearch');
    if (si && document.activeElement !== si && e.key.length === 1 && !e.ctrlKey && !e.altKey && /[\w\-]/.test(e.key)) si.focus();
  };
}

async function pickTerminal() {
  const terms = await GET('/pos/terminals');
  if (terms.length === 1) { location.hash = '#/pos/' + terms[0].id; return; }
  const ico = { retail: '🛍️', restaurant: '🍽️', bar: '🍺' };
  $('#app').innerHTML = `<div class="auth"><div class="auth-card wide">
    <div class="row"><h1 style="flex:1">Choose a till</h1>${can('dashboard') ? '<a class="btn" href="#/">Back office</a>' : ''}<button class="btn" id="lock">Log out</button></div>
    <div class="sub">Each till runs its own cashier session.</div>
    <div class="tiles" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">${terms.map(t => `
      <a class="tile card" href="#/pos/${t.id}" style="padding:20px"><div class="ico" style="background:${t.mode === 'restaurant' ? '#ea580c' : t.mode === 'bar' ? '#ca8a04' : '#0891b2'}">${ico[t.mode]}</div>
      <span><b>${esc(t.name)}</b><br><small class="muted">${t.mode} · ${t.open_session_id ? 'session open' : 'closed'}</small></span></a>`).join('')}</div>
  </div></div>`;
  $('#lock').onclick = lock;
}

function lock() { setToken(null); state.user = null; location.hash = '#/login'; }

// ---------------------------------------------------------------- rendering
function render() {
  const t = S.terminal, sess = S.session;
  const modeBtns = [];
  if (t.mode === 'restaurant') modeBtns.push(`<button class="btn ${S.view === 'floor' ? 'on' : ''}" data-v="floor">🍽️ Tables</button>`);
  if (t.mode !== 'retail') modeBtns.push(`<button class="btn ${S.view === 'tabs' ? 'on' : ''}" data-v="tabs">📋 ${t.mode === 'bar' ? 'Tabs' : 'Open orders'}</button>`);
  modeBtns.push(`<button class="btn ${S.view === 'order' ? 'on' : ''}" data-v="order">🧾 ${S.order.id ? 'Order' : 'New sale'}</button>`);
  $('#app').innerHTML = `<div class="pos">
    <div class="pos-top">
      <span class="title">${esc(t.name)}</span>${modeBtns.join('')}
      ${S.catalog.vas.length && can('vas') ? '<button class="btn" id="vasBtn">⚡ Airtime / Power</button>' : ''}
      ${smartelOn() && can('vas') ? '<button class="btn" id="agentBtn">💸 Agent services</button>' : ''}
      ${S.catalog.smartel && S.catalog.smartel.quarantined ? '<span class="badge badge-overdue" title="Smartel is holding this till – call Smartel support">Till held by Smartel</span>' : ''}
      <span class="spacer"></span>
      <span class="info">${sess ? `Session #${sess.id} · ${esc(state.user.name)}` : 'No session'}</span>
      <button class="btn" id="histBtn">History</button><button class="btn" id="clkBtn" title="Clock in / out for your shift">🕐</button>
      ${sess ? '<button class="btn" id="closeBtn">Close session</button>' : '<button class="btn" id="openBtn">Open session</button>'}
      <button class="btn" id="lockBtn" title="Lock / switch user">🔒</button>
      ${can('dashboard') ? '<a class="btn" href="#/">✕</a>' : '<a class="btn" href="#/pos">✕</a>'}
    </div>
    <div id="posBody" style="flex:1;min-height:0;display:flex;flex-direction:column"></div>
  </div>`;
  $$('[data-v]').forEach(b => b.onclick = () => switchView(b.dataset.v));
  $('#histBtn').onclick = historyDialog;
  const clk = $('#clkBtn');
  if (clk) {
    GET('/attendance/me').then(x => { clk.textContent = x.clocked_in ? '🕐 On shift' : '🕐 Clock in'; }).catch(() => {});
    clk.onclick = async () => { try { const x = await POST('/attendance/me'); toast(x.status === 'in' ? `Clocked in at ${String(x.at).slice(11, 16)}` : `Clocked out – ${x.hours} h`); clk.textContent = x.status === 'in' ? '🕐 On shift' : '🕐 Clock in'; if (x.warning) toast(x.warning, 'err', 8000); } catch (e) { err(e); } };
  }
  $('#lockBtn').onclick = lock;
  if ($('#closeBtn')) $('#closeBtn').onclick = closeSessionDialog;
  if ($('#openBtn')) $('#openBtn').onclick = openSessionDialog;
  if ($('#vasBtn')) $('#vasBtn').onclick = vasDialog;
  if ($('#agentBtn')) $('#agentBtn').onclick = () => agentDialog(S, () => { if ($('#lines')) renderLines(); });
  if (S.view === 'floor') renderFloor();
  else if (S.view === 'tabs') renderTabs();
  else renderOrder();
}

async function switchView(v) {
  if (S.dirty && S.order.lines.length && (S.order.id || S.order.table_id || S.order.tab_name)) {
    if (!(await confirmBox('Discard unsaved changes to this order?', { okLabel: 'Discard' }))) return;
  }
  if (v === 'order' && S.view !== 'order') { /* keep current order */ }
  if (v !== 'order') { S.order = emptyOrder(); S.dirty = false; }
  S.view = v; render();
}

async function renderFloor() {
  const body = $('#posBody');
  const floors = await GET('/pos/floors');
  if (!floors.length) { body.innerHTML = '<div class="floor"><div class="empty">No floors configured. Add them in Settings → Restaurant.</div></div>'; return; }
  const f = floors[S.floorIdx] || floors[0];
  body.innerHTML = `<div class="floor">
    <div class="floor-tabs">${floors.map((x, i) => `<button class="btn ${x.id === f.id ? 'btn-primary' : ''}" data-f="${i}">${esc(x.name)}</button>`).join('')}
      <span class="spacer"></span><button class="btn" id="takeaway">🥡 Takeaway / quick sale</button></div>
    <div class="tables">${f.tables.map(t => `<div class="rtable ${t.order_id ? 'busy' : ''}" data-t="${t.id}">
      ${t.ready_items ? `<span class="ready">${t.ready_items} ready</span>` : ''}
      <div class="tn">${esc(t.name)}</div><div class="seats">${t.order_id ? `${t.guests || '-'} guests · ${timeAgo(t.order_opened)}` : `${t.seats} seats · free`}</div>
      ${t.order_id ? `<div class="who">${esc(t.waiter || '')}</div><div class="amt">${money(t.order_total)}</div>` : ''}
    </div>`).join('')}</div></div>`;
  $$('[data-f]').forEach(b => b.onclick = () => { S.floorIdx = Number(b.dataset.f); renderFloor(); });
  $('#takeaway').onclick = () => { S.order = emptyOrder(); S.view = 'order'; render(); };
  $$('[data-t]').forEach(el => el.onclick = async () => {
    const t = f.tables.find(x => String(x.id) === el.dataset.t);
    if (!S.session) return openSessionDialog();
    if (t.order_id) await loadOrder(t.order_id);
    else {
      const g = await promptBox(`Table ${t.name} — number of guests`, { label: 'Guests', value: String(Math.min(2, t.seats)), type: 'number' });
      if (g === null) return;
      S.order = emptyOrder({ table_id: t.id, table_name: t.name, guests: Number(g) || 0 });
      S.view = 'order'; render();
    }
  });
  clearTimeout(S.floorTimer);
  S.floorTimer = setTimeout(() => { if (S.view === 'floor' && !$('.modal-backdrop') && location.hash.startsWith('#/pos/')) renderFloor(); }, 15000);
}

async function renderTabs() {
  const body = $('#posBody');
  const orders = (await GET(`/pos/orders?status=open&mode=${S.terminal.mode}`));
  body.innerHTML = `<div class="floor">
    <div class="floor-tabs"><button class="btn btn-primary" id="newTab">＋ New tab</button><button class="btn" id="quick">⚡ Quick sale (pay now)</button>
      <input id="tabSearch" placeholder="Search tabs…" style="max-width:260px"></div>
    <div class="tabs-list">${orders.map(o => `<div class="rtable busy" data-o="${o.id}">
      <div class="tn" style="font-size:18px">${esc(o.table_name ? 'Table ' + o.table_name : o.tab_name || 'Order #' + o.id)}</div>
      <div class="seats">${esc(o.user_name || '')} · ${timeAgo(o.created_at)}${o.partner_name ? ' · ' + esc(o.partner_name) : ''}</div>
      <div class="amt">${money(o.total)}</div></div>`).join('') || '<div class="empty" style="grid-column:1/-1">No open tabs.</div>'}</div></div>`;
  $('#newTab').onclick = async () => {
    if (!S.session) return openSessionDialog();
    const name = await promptBox('Open a new tab', { label: 'Customer name or tab label' });
    if (!name) return;
    S.order = emptyOrder({ tab_name: name }); S.view = 'order'; render();
  };
  $('#quick').onclick = () => { S.order = emptyOrder(); S.view = 'order'; render(); };
  $('#tabSearch').oninput = e => { const q = e.target.value.toLowerCase(); $$('[data-o]').forEach(el => el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none'); };
  $$('[data-o]').forEach(el => el.onclick = () => loadOrder(Number(el.dataset.o)));
}

async function loadOrder(id) {
  const o = await GET('/pos/orders/' + id);
  S.order = { id: o.id, lines: o.lines.map(l => ({ ...l })), partner_id: o.partner_id, partner_name: o.partner_name, table_id: o.table_id, table_name: o.table_name,
    tab_name: o.tab_name, guests: o.guests, number: o.number };
  S.sel = -1; S.dirty = false; S.view = 'order'; render();
}

function contextLabel() {
  const o = S.order;
  if (o.table_id) return `Table ${esc(o.table_name)} <small>${o.guests ? o.guests + ' guests' : ''}${o.id ? ' · #' + o.id : ''}</small>`;
  if (o.tab_name) return `Tab: ${esc(o.tab_name)} <small>${o.id ? '#' + o.id : 'new'}</small>`;
  return S.terminal.mode === 'restaurant' ? 'Takeaway' : 'New sale';
}

function renderOrder() {
  const body = $('#posBody');
  const mode = S.terminal.mode;
  const kitchenish = mode !== 'retail' && (S.order.id || S.order.table_id || S.order.tab_name);
  body.innerHTML = `<div class="pos-main" style="flex:1;min-height:0">
    <div class="cart">
      <div class="cart-head"><div class="ctx" style="flex:1">${contextLabel()}</div>
        <button class="btn btn-sm" id="custBtn">👤 ${esc(S.order.partner_name || 'Customer')}</button></div>
      <div class="cart-lines" id="lines"></div>
      <div class="cart-totals" id="totals"></div>
      <div class="cart-tools">
        <button class="btn" data-t="qty">Qty</button><button class="btn" data-t="disc">Disc %</button>
        <button class="btn" data-t="price">Price</button><button class="btn" data-t="note">Note</button>
        <button class="btn" data-t="del">Remove</button>
        ${S.order.id ? '<button class="btn" data-t="split">Split</button>' : '<button class="btn" data-t="misc">Misc item</button>'}
        ${S.order.id && mode === 'restaurant' ? '<button class="btn" data-t="move">Move table</button>' : '<button class="btn" data-t="clear">Clear</button>'}
        ${S.order.id ? '<button class="btn" data-t="void">Void</button>' : '<button class="btn" data-t="hold">Hold</button>'}
      </div>
      <div class="cart-actions">
        ${kitchenish ? `<button class="btn btn-lg" id="saveBtn">💾 Save</button><button class="btn btn-lg" id="sendBtn">🔔 Send order</button>` : ''}
        ${S.order.id ? `<button class="btn" id="billBtn" style="grid-column:1/-1">🧾 Print bill with pay-by-QR</button>` : ''}
        <button class="btn btn-ok pay" id="payBtn">Pay</button>
      </div>
    </div>
    <div class="catalog">
      <div class="catalog-bar"><input id="psearch" placeholder="Scan barcode or search products…  (Enter to add)" autocomplete="off" value="${esc(S.search)}"></div>
      <div class="chips"><button class="chip ${!S.cat ? 'on' : ''}" data-c="" style="--c:#3f3d9e">All</button>${S.catalog.categories.map(c => `<button class="chip ${S.cat === c.id ? 'on' : ''}" data-c="${c.id}" style="--c:${esc(c.color)}">${esc(c.name)}</button>`).join('')}</div>
      <div class="products" id="prods"></div>
    </div>
  </div>`;
  renderLines(); renderProducts();
  $$('[data-c]').forEach(b => b.onclick = () => { S.cat = b.dataset.c ? Number(b.dataset.c) : null; $$('[data-c]').forEach(x => x.classList.toggle('on', x === b)); renderProducts(); });
  const si = $('#psearch');
  si.oninput = debounce(() => { if (!si.isConnected) return; S.search = si.value; renderProducts(); }, 120);
  si.onkeydown = e => {
    if (e.key !== 'Enter') return;
    const q = si.value.trim(); if (!q) return;
    const exact = S.catalog.products.find(p => p.barcode === q || (p.sku && p.sku.toLowerCase() === q.toLowerCase()));
    const list = filtered();
    const p = exact || (list.length === 1 ? list[0] : null);
    if (p) { addProduct(p); si.value = ''; S.search = ''; renderProducts(); return; }
    const bc = S.catalog.butchery && S.catalog.butchery.enabled ? parseScaleBarcode(q, S.catalog.butchery) : null;
    if (bc) {
      const sp = S.catalog.products.find(x => x.plu && Number(x.plu) === Number(bc.plu));
      if (!sp) return toast(`Scale label for PLU ${bc.plu}: no product has that PLU`, 'err');
      if (bc.kind === 'weight') addProduct(sp, { qty: bc.value });
      else { if (!(Number(sp.price) > 0)) return toast(`${sp.name} has no price per kg`, 'err'); addProduct(sp, { qty: Math.round(bc.value / Number(sp.price) * 1000) / 1000, label_total: bc.value }); }
      si.value = ''; S.search = ''; renderProducts(); return;
    }
    toast(`No product matches "${q}"`, 'err');
  };
  if (mode === 'retail') setTimeout(() => si.focus(), 50);
  $('#custBtn').onclick = customerDialog;
  $$('[data-t]').forEach(b => b.onclick = () => tool(b.dataset.t));
  $('#payBtn').onclick = payDialog;
  if ($('#saveBtn')) $('#saveBtn').onclick = () => saveOrder(false);
  if ($('#billBtn')) $('#billBtn').onclick = billDialog;
  if ($('#sendBtn')) $('#sendBtn').onclick = () => saveOrder(true);
}

function filtered() {
  const q = S.search.trim().toLowerCase();
  return S.catalog.products.filter(p => (!S.cat || p.category_id === S.cat) &&
    (!q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q) || (p.barcode || '') === q));
}

function renderProducts() {
  const cats = new Map(S.catalog.categories.map(c => [c.id, c]));
  const list = filtered().slice(0, 300);
  $('#prods').innerHTML = list.map(p => `<div class="prod" data-p="${p.id}" style="--c:${esc((cats.get(p.category_id) || {}).color || '#c7c9d9')}">
    <div class="nm">${p.sold_by_weight ? '⚖️ ' : ''}${esc(p.name)}</div><div class="pr">${money(p.price)}${p.sold_by_weight ? `<small style="font-weight:600">/${esc(p.uom || 'kg')}</small>` : ''}</div>
    ${p.type === 'stock' ? `<div class="st ${Number(p.stock_qty) <= 0 ? 'low' : ''}">${fq(p.stock_qty)} in stock</div>` : ''}</div>`).join('')
    || '<div class="empty" style="grid-column:1/-1">No products found.</div>';
  $$('[data-p]', $('#prods')).forEach(el => el.onclick = () => addProduct(S.catalog.products.find(p => p.id === Number(el.dataset.p))));
}

/** promotions: give every line without a manual discount its best price rule */
function applyRules() {
  const rules = (S.catalog && S.catalog.price_rules) || [];
  const partner = S.order.partner_id ? { id: S.order.partner_id, tags: S.order.partner_tags || '' } : null;
  const when = new Date();
  for (const l of S.order.lines) {
    const manual = l.manual_disc || (Number(l.discount_pct) > 0 && !l.rule_id && !l.auto);
    if (!l.product_id || l.label_total || manual || (l.kitchen_status && l.kitchen_status !== 'pending' && l.id)) continue;
    const p = S.catalog.products.find(x => x.id === l.product_id);
    const b = rules.length && p ? bestRule(rules, { product: p, price: l.unit_price, qty: l.qty, partner, when, channel: 'pos' }) : { pct: 0 };
    l.discount_pct = b.pct; l.auto = b.pct > 0; l.rule_id = b.rule ? b.rule.id : null; l.rule_name = b.rule ? b.rule.name : null;
  }
}
function renderLines() {
  applyRules();
  const L = S.order.lines;
  $('#lines').innerHTML = L.length ? L.map((l, i) => {
    const c = lineCalc(l);
    return `<div class="cart-line ${S.sel === i ? 'sel' : ''}" data-i="${i}">
      <div class="nm">${esc(l.name)}${l.kitchen_status && l.kitchen_status !== 'pending' ? `<span class="ks">${badge(l.kitchen_status)}</span>` : ''}</div>
      <div class="amt">${money(c.total)}</div>
      <div class="meta">${fq(l.qty)}${l.uom && l.uom !== 'Unit' ? ' ' + esc(l.uom) : ''} × ${money(l.unit_price)}${l.label_total ? ' · scale label' : ''}${Number(l.discount_pct) ? ` · −${l.discount_pct}%${l.rule_name ? ` <span class="promo-tag">🏷 ${esc(l.rule_name)}</span>` : ''}` : ''}</div>
      <div class="row" style="justify-content:flex-end;gap:4px">${isWeighed(l) ? `<button class="btn btn-sm" data-rw="${i}" title="Weigh again">⚖️</button>` : `<button class="btn btn-sm" data-m="${i}">−</button><button class="btn btn-sm" data-pl="${i}">＋</button>`}</div>
      ${l.note ? `<div class="note">✎ ${esc(l.note)}</div>` : ''}
    </div>`;
  }).join('') : (S.smartel && S.smartel.view && S.smartel.view.ops.length ? '' : `<div class="cart-empty">🛒<br><br>Tap products or scan a barcode to start.</div>`);
  const sv = S.smartel && S.smartel.view;
  if (sv && sv.ops.length) $('#lines').insertAdjacentHTML('beforeend', `<div class="cart-svc" id="svcBox"><div class="row"><b style="flex:1">💸 Payment services</b><button class="btn btn-sm" id="svcOpen">Open</button></div>
    ${sv.ops.map(o => `<div class="row" style="gap:6px"><span style="flex:1">${o.line_no}. ${esc(o.name || o.op)}${o.mw_ref ? ` <small class="muted">${esc(o.mw_ref)}</small>` : ''}</span>${badge(o.state, o.state === 'completed' ? 'paid' : o.state === 'failed' ? 'cancelled' : 'partial')}<span class="r" style="min-width:70px;text-align:right">${o.state === 'completed' ? money(o.cash) : ''}</span></div>`).join('')}
    <div class="row"><span class="muted" style="flex:1">Cash for services</span><b>${money(sv.services_cash)}</b></div>
    ${!L.length ? `<button class="btn btn-primary" id="svcFin" ${sv.blocked ? 'disabled title="A service is still waiting for MyWallet"' : ''}>🧾 Finish customer (services only)</button>` : ''}</div>`);
  if ($('#svcOpen')) $('#svcOpen').onclick = () => agentDialog(S, () => renderLines());
  if ($('#svcFin')) $('#svcFin').onclick = () => agentDialog(S, () => renderLines());
  $$('[data-i]', $('#lines')).forEach(el => el.onclick = e => { if (e.target.closest('button')) return; S.sel = Number(el.dataset.i); renderLines(); });
  $$('[data-m]').forEach(b => b.onclick = () => changeQty(Number(b.dataset.m), -1));
  $$('[data-pl]').forEach(b => b.onclick = () => changeQty(Number(b.dataset.pl), +1));
  $$('[data-rw]').forEach(b => b.onclick = () => { const i = Number(b.dataset.rw); const l = S.order.lines[i]; const p = S.catalog.products.find(x => x.id === l.product_id);
    if (!p) return; if (l.kitchen_status && l.kitchen_status !== 'pending') return toast('Already sent – void it instead', 'err'); S.order.lines.splice(i, 1); S.sel = -1; renderLines(); weighDialog(p); });
  const t = orderTotals();
  $('#totals').innerHTML = `<div class="t"><span>Items</span><span>${fq(t.items)}</span></div>
    ${t.discount ? `<div class="t"><span>Discounts</span><span>−${money(t.discount)}</span></div>` : ''}
    <div class="t"><span>Excl. VAT</span><span>${money(t.net)}</span></div><div class="t"><span>VAT</span><span>${money(t.tax)}</span></div>
    <div class="t big"><span>Total</span><span>${money(t.total)}</span></div>
    ${S.smartel && S.smartel.view && S.smartel.view.ops.length ? `<div class="t"><span>Net cash (goods in cash + services)</span><span>${money(round2(t.total + S.smartel.view.services_cash))}</span></div>` : ''}`;
  const pb = $('#payBtn'); if (pb) pb.textContent = `Pay ${money(t.total)}`;
  const sel = $('.cart-line.sel'); if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function addProduct(p, opts = {}) {
  if (!p) return;
  const blk = S.catalog.smartel && S.catalog.smartel.blocked && S.catalog.smartel.blocked[p.id];
  if (blk) {
    POST('/smartel/flags', { terminal_id: S.terminal.id, kind: blk.kind, gtin: p.barcode, raw: p.barcode || p.name }).catch(() => {});
    if (!blk.warn_only) return toast(`⛔ ${p.name}: ${blk.reason}. Put it aside – it cannot be sold.`, 'err', 7000);
    toast(`⚠ ${p.name}: ${blk.reason}`, 'err', 5000);
  }
  const L = S.order.lines;
  if (p.sold_by_weight) {
    if (!opts.qty) return weighDialog(p);
    L.push({ product_id: p.id, name: p.name, qty: opts.qty, unit_price: Number(p.price), tax_rate: Number(p.tax_rate || 0), discount_pct: 0, note: null, kitchen_status: 'pending', uom: p.uom, label_total: opts.label_total || null });
    S.sel = L.length - 1; S.dirty = true; renderLines(); return;
  }
  const i = L.findIndex(l => l.product_id === p.id && !l.note && (!l.kitchen_status || l.kitchen_status === 'pending') && !l.manual_disc && Number(l.unit_price) === Number(p.price));
  if (i >= 0) { L[i].qty = Number(L[i].qty) + 1; S.sel = i; }
  else { L.push({ product_id: p.id, name: p.name, qty: 1, unit_price: Number(p.price), tax_rate: Number(p.tax_rate || 0), discount_pct: 0, note: null, kitchen_status: 'pending' }); S.sel = L.length - 1; }
  if (Number(p.price) === 0) setTimeout(() => tool('price'), 10);
  S.dirty = true; renderLines();
}

function changeQty(i, d) {
  const l = S.order.lines[i]; if (!l) return;
  l.qty = round2(Number(l.qty) + d);
  if (l.qty <= 0) { S.order.lines.splice(i, 1); S.sel = Math.min(S.sel, S.order.lines.length - 1); }
  S.dirty = true; renderLines();
}

async function tool(t) {
  const L = S.order.lines; const l = L[S.sel];
  const needLine = ['qty', 'disc', 'price', 'note', 'del'];
  if (needLine.includes(t) && !l) return toast('Select a line first', 'info');
  if (t === 'qty') { const v = await promptBox('Quantity', { value: l.qty, type: 'number' }); if (v !== null && Number(v) > 0) { l.qty = Number(v); S.dirty = true; } }
  if (t === 'disc') {
    if (!can('pos.discount')) return toast('Discounts need a manager', 'err');
    const v = await promptBox('Discount %', { value: l.discount_pct || 0, type: 'number' }); if (v !== null) { l.discount_pct = Math.max(0, Math.min(100, Number(v))); l.manual_disc = true; l.auto = false; l.rule_id = null; l.rule_name = null; S.dirty = true; }
  }
  if (t === 'price') {
    const p = S.catalog.products.find(x => x.id === l.product_id);
    if (p && Number(p.price) !== 0 && !can('pos.discount')) return toast('Price changes need a manager', 'err');
    const v = await promptBox('Unit price', { value: l.unit_price, type: 'number' }); if (v !== null) { l.unit_price = Number(v); S.dirty = true; }
  }
  if (t === 'note') { const v = await promptBox('Note for kitchen / receipt', { value: l.note || '' }); if (v !== null) { l.note = v || null; S.dirty = true; } }
  if (t === 'del') { L.splice(S.sel, 1); S.sel = -1; S.dirty = true; }
  if (t === 'clear') { if (L.length && await confirmBox('Clear all items?')) { S.order.lines = []; S.sel = -1; S.dirty = true; } }
  if (t === 'misc') {
    if (!can('pos.discount')) return toast('Custom items need a manager', 'err');
    const name = await promptBox('Misc item description', { value: 'Misc item' }); if (!name) return;
    const price = await promptBox('Price (incl. VAT)', { type: 'number' }); if (price === null) return;
    L.push({ product_id: null, name, qty: 1, unit_price: Number(price), tax_rate: Number(state.company.default_vat ?? 15), discount_pct: 0 }); S.sel = L.length - 1; S.dirty = true;
  }
  if (t === 'hold') {
    if (!L.length) return;
    const name = await promptBox('Hold this sale as a tab', { label: 'Name / label', value: S.order.partner_name || '' }); if (!name) return;
    S.order.tab_name = name; await saveOrder(false); return;
  }
  if (t === 'void') {
    if (!can('pos.void')) return toast('Only a manager can void orders', 'err');
    const reason = await promptBox('Void the whole order — reason', {}); if (reason === null) return;
    try { await POST(`/pos/orders/${S.order.id}/void`, { reason }); toast('Order voided'); backToStart(); } catch (e) { err(e); }
    return;
  }
  if (t === 'split') return splitDialog();
  if (t === 'move') return moveTableDialog();
  renderLines();
}

function payloadLines() {
  return S.order.lines.map(l => ({ id: l.id || undefined, product_id: l.product_id, name: l.name, qty: l.qty, unit_price: l.unit_price, discount_pct: l.discount_pct, note: l.note, tax_rate: l.tax_rate, label_total: l.label_total || undefined }));
}

async function persist(send) {
  const o = S.order;
  const body = { session_id: S.session && S.session.id, mode: S.terminal.mode, table_id: o.table_id, tab_name: o.tab_name, partner_id: o.partner_id, guests: o.guests, lines: payloadLines(), send_to_kitchen: !!send };
  const saved = o.id ? await PUT('/pos/orders/' + o.id, body) : await POST('/pos/orders', body);
  S.order.id = saved.id; S.order.lines = saved.lines; S.dirty = false;
  return saved;
}

async function saveOrder(send) {
  if (!S.session) return openSessionDialog();
  if (!S.order.lines.length && !S.order.id) return toast('Add items first', 'info');
  try {
    const before = S.order.lines.filter(l => !l.id || l.kitchen_status === 'pending');
    const saved = await persist(send);
    if (send) {
      toast(`Sent to kitchen/bar`);
      if (S.catalog.pos && S.catalog.pos.print_kitchen_tickets) printKitchenTicket(saved, before);
    } else toast('Order saved');
    backToStart();
  } catch (e) { err(e); }
}

function backToStart() {
  S.order = emptyOrder(); S.sel = -1; S.dirty = false;
  S.view = S.terminal.mode === 'restaurant' ? 'floor' : S.terminal.mode === 'bar' ? 'tabs' : 'order';
  render();
}

// ---------------------------------------------------------------- customer
function customerDialog() {
  const close = modal({ title: 'Customer', size: 'lg', body: `<div class="row" style="margin-bottom:10px"><input id="cq" placeholder="Search name or phone…"><button class="btn" id="cnew">＋ New</button>${S.order.partner_id ? '<button class="btn" id="cnone">Remove</button>' : ''}</div><div id="clist"></div>`,
    onOpen: r => {
      const load = async () => {
        const rows = await GET('/partners?is_customer=1&q=' + encodeURIComponent(r.querySelector('#cq').value));
        r.querySelector('#clist').innerHTML = `<ul class="list-plain">${rows.map(p => `<li data-p="${p.id}" style="cursor:pointer"><span><b>${esc(p.name)}</b> <span class="muted">${esc(p.phone || '')}</span></span><span class="muted">${esc(p.email || '')}</span></li>`).join('') || '<li class="muted">No customers</li>'}</ul>`;
        $$('[data-p]', r).forEach(li => li.onclick = () => { const p = rows.find(x => x.id === Number(li.dataset.p)); S.order.partner_id = p.id; S.order.partner_name = p.name; S.order.partner_tags = p.tags || ''; S.dirty = true; close(); renderOrder(); });
      };
      r.querySelector('#cq').oninput = debounce(load, 200); load();
      r.querySelector('#cnew').onclick = async () => {
        const name = await promptBox('New customer name'); if (!name) return;
        const phone = await promptBox('Phone (optional)');
        try { const p = await POST('/partners', { name, phone, is_customer: 1 }); S.order.partner_id = p.id; S.order.partner_name = p.name; close(); renderOrder(); } catch (e) { err(e); }
      };
      const cn = r.querySelector('#cnone'); if (cn) cn.onclick = () => { S.order.partner_id = null; S.order.partner_name = null; S.order.partner_tags = ''; close(); renderOrder(); };
    } });
}

// ---------------------------------------------------------------- payment
function methodsAllowed() {
  // on a Smartel till goods are paid by Cash, Card, MyWallet or Switch only (BR-05)
  if (smartelOn()) return S.catalog.methods.filter(m => m.kind === 'cash' || isSmartelMethod(m));
  return S.catalog.methods.filter(m => m.kind !== 'account' || S.order.partner_id);
}

async function payDialog() {
  if (!S.session) return openSessionDialog();
  if (!S.order.lines.length) return toast('Nothing to pay', 'info');
  const total = orderTotals().total;
  const pays = [];
  let active = -1, fresh = true;
  const paid = () => round2(pays.reduce((s, p) => s + Number(p.amount || 0), 0));
  const close = modal({ title: `Payment — ${contextLabel().replace(/<[^>]+>/g, ' ')}`, wide: true, body: `<div class="payscreen">
      <div><div class="paydue"><small>Amount due</small>${money(total)}</div>
        <div class="methods">${methodsAllowed().map(m => `<button class="method kind-${m.kind}" data-mm="${m.id}">${esc(m.name)}<span class="k">${m.kind.replace('_', ' ')}</span></button>`).join('')}</div>
        <div class="paylines" id="pl"></div>
        <div class="quick" id="quick"></div></div>
      <div><div class="card" style="margin-bottom:10px"><div class="row"><span class="muted">Paid</span><span class="spacer"></span><b id="paid"></b></div>
        <div class="row"><span class="muted" id="remLbl">Remaining</span><span class="spacer"></span><span class="change" id="rem"></span></div></div>
        <div class="numpad">${['7', '8', '9', '⌫', '4', '5', '6', 'C', '1', '2', '3', '+10', '0', '00', '.', '+50'].map(k => `<button data-k="${k}" class="${/\D/.test(k) && k !== '.' ? 'op' : ''}">${k}</button>`).join('')}</div>
        <button class="btn btn-ok btn-lg btn-block" id="done" style="margin-top:10px">Validate</button></div></div>`,
    onOpen: r => {
      const draw = () => {
        r.querySelector('#pl').innerHTML = pays.map((p, i) => `<div class="pl ${i === active ? 'active' : ''}" data-pi="${i}">
          <b>${esc(p.m.name)}</b><input data-amt="${i}" type="number" step="0.01" value="${p.amount}"><button class="icon-btn" data-rm="${i}">✕</button>
          ${isSmartelMethod(p.m) ? `<div class="extra">${p.approved ? `<span class="badge badge-paid">✓ approved ${esc(p.reference || '')}</span>` : `<button class="btn btn-sm btn-primary" data-ask="${i}">📲 Ask customer to pay</button><small class="muted">Must cover the whole bill on its own</small>`}</div>`
          : p.m.kind === 'mobile_money' || p.m.requires_reference || p.m.kind === 'card' ? `<div class="extra">
            ${p.m.kind === 'mobile_money' ? `<input data-ph="${i}" placeholder="Customer phone" value="${esc(p.phone || '')}">` : ''}
            <input data-ref="${i}" placeholder="${p.m.requires_reference ? 'Transaction reference *' : 'Reference / approval code'}" value="${esc(p.reference || '')}">
            ${p.m.plugin_id ? `<button class="btn btn-sm" data-push="${i}">📲 Request on phone</button>` : ''}</div>` : ''}
        </div>`).join('') || '<div class="muted">Choose a payment method. You can split across several.</div>';
        const pd = paid(), rem = round2(total - pd);
        r.querySelector('#paid').textContent = money(pd);
        r.querySelector('#remLbl').textContent = rem > 0 ? 'Remaining' : 'Change';
        const re = r.querySelector('#rem'); re.textContent = money(Math.abs(rem)); re.style.color = rem > 0 ? 'var(--bad)' : 'var(--ok)';
        const ap = pays[active];
        r.querySelector('#quick').innerHTML = ap && ap.m.kind === 'cash' ? [Math.max(rem, 0) + Number(ap.amount), 20, 50, 100, 200, 500].filter((v, i, a) => v > 0 && a.indexOf(v) === i)
          .map((v, i) => `<button class="btn" data-q="${v}">${i === 0 ? 'Exact ' : ''}${money(v)}</button>`).join('') : '';
        $$('[data-pi]', r).forEach(el => el.onclick = e => { if (e.target.closest('input,button')) return; active = Number(el.dataset.pi); fresh = true; draw(); });
        $$('[data-amt]', r).forEach(el => { el.oninput = () => { const p = pays[Number(el.dataset.amt)]; p.amount = Number(el.value); if (p.approved) { p.approved = false; p.intent_id = null; p.reference = ''; } updateOnly(); }; el.onfocus = () => { active = Number(el.dataset.amt); }; });
        $$('[data-ref]', r).forEach(el => el.oninput = () => { pays[Number(el.dataset.ref)].reference = el.value; });
        $$('[data-ph]', r).forEach(el => el.oninput = () => { pays[Number(el.dataset.ph)].phone = el.value; });
        $$('[data-rm]', r).forEach(el => el.onclick = () => { pays.splice(Number(el.dataset.rm), 1); active = pays.length - 1; draw(); });
        $$('[data-q]', r).forEach(el => el.onclick = () => { pays[active].amount = Number(el.dataset.q); fresh = true; draw(); });
        $$('[data-push]', r).forEach(el => el.onclick = () => pushPayment(pays[Number(el.dataset.push)], el, draw));
        $$('[data-ask]', r).forEach(el => el.onclick = () => { const p = pays[Number(el.dataset.ask)]; if (!(Number(p.amount) > 0)) return toast('Enter the amount first', 'err'); requestPayment(S, p, el, draw); });
      };
      const updateOnly = () => {
        const pd = paid(), rem = round2(total - pd);
        r.querySelector('#paid').textContent = money(pd);
        r.querySelector('#remLbl').textContent = rem > 0 ? 'Remaining' : 'Change';
        const re = r.querySelector('#rem'); re.textContent = money(Math.abs(rem)); re.style.color = rem > 0 ? 'var(--bad)' : 'var(--ok)';
      };
      $$('[data-mm]', r).forEach(b => b.onclick = () => {
        const m = S.catalog.methods.find(x => x.id === Number(b.dataset.mm));
        // card / MyWallet / Switch on a Smartel till must cover the whole bill alone
        if (isSmartelMethod(m) || pays.some(x => isSmartelMethod(x.m))) pays.length = 0;
        const rem = Math.max(round2(total - paid()), 0);
        pays.push({ m, method_id: m.id, amount: rem, reference: '', phone: '' }); active = pays.length - 1; fresh = true; draw();
      });
      $$('[data-k]', r).forEach(b => b.onclick = () => {
        const p = pays[active]; if (!p) return toast('Choose a payment method first', 'info');
        const k = b.dataset.k; let s = fresh ? '' : String(p.amount ?? '');
        if (k === '⌫') s = String(p.amount).slice(0, -1); else if (k === 'C') s = '';
        else if (k.startsWith('+')) s = String(round2(Number(p.amount || 0) + Number(k.slice(1))));
        else s += k;
        fresh = false; p.amount = s === '' || s === '.' ? 0 : Number(s);
        draw();
        const inp = r.querySelector(`[data-amt="${active}"]`); if (inp && s.endsWith('.')) inp.value = s;
      });
      // default: cash for exact amount
      const cash = methodsAllowed().find(m => m.kind === 'cash');
      if (cash) { pays.push({ m: cash, method_id: cash.id, amount: total }); active = 0; }
      draw();
      r.querySelector('#done').onclick = async () => {
        const btn = r.querySelector('#done');
        if (paid() + 0.001 < total) return toast('Payment is short', 'err');
        if (pays.some(p => isSmartelMethod(p.m) && !p.approved)) return toast('Ask the customer to pay first and wait until it shows approved', 'err');
        btn.disabled = true; btn.textContent = 'Processing…';
        try {
          const payments = pays.map(p => ({ method_id: p.method_id, amount: p.amount, reference: p.reference, phone: p.phone, intent_id: p.intent_id || undefined }));
          const smartel_session = S.smartel && S.smartel.session_uuid || undefined;
          let res;
          if (S.order.id || S.order.table_id || S.order.tab_name) {
            if (S.dirty || !S.order.id) await persist(false);
            res = await POST(`/pos/orders/${S.order.id}/pay`, { payments, partner_id: S.order.partner_id, smartel_session });
            S.smartel = null;
          } else {
            res = await POST('/pos/checkout', { session_id: S.session.id, mode: S.terminal.mode, partner_id: S.order.partner_id, lines: payloadLines(), payments, smartel_session });
          S.smartel = null;
          }
          close();
          receiptDialog(res.order, res.change);
          refreshStock(res.order);
          backToStart();
        } catch (e) { err(e); btn.disabled = false; btn.textContent = 'Validate'; }
      };
    } });
}

async function pushPayment(p, btn, redraw) {
  if (!p.phone) return toast('Enter the customer phone number', 'err');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const r = await POST('/vas/payments/request', { method_id: p.method_id, phone: p.phone, amount: p.amount });
    if (r.status === 'failed') throw new Error(r.message || 'Request failed');
    toast(r.message || 'Request sent', 'info', 5000);
    for (let i = 0; i < 40; i++) {
      await new Promise(res => setTimeout(res, 3000));
      const s = await POST('/vas/payments/status', { method_id: p.method_id, provider_ref: r.provider_ref });
      btn.textContent = `Waiting… ${s.message || ''}`.slice(0, 40);
      if (s.status === 'success') { p.reference = s.provider_ref || r.provider_ref; toast('Customer approved the payment'); redraw(); return; }
      if (s.status === 'failed') throw new Error(s.message || 'Customer declined');
    }
    throw new Error('Timed out waiting for the customer');
  } catch (e) { err(e); btn.disabled = false; btn.textContent = '📲 Request on phone'; }
}

function refreshStock(order) {
  for (const l of order.lines) { const p = S.catalog.products.find(x => x.id === l.product_id); if (p && p.type === 'stock') p.stock_qty = Number(p.stock_qty) - Number(l.qty); }
}

// ---------------------------------------------------------------- receipts
export function receiptHtml(o, company = state.company) {
  const m = n => money(n);
  const vasTokens = (o.vas || []).filter(v => v.token).map(v => `<div style="border:1px dashed #000;padding:6px;margin:6px 0;text-align:center"><div>${esc(v.service.toUpperCase())} TOKEN</div><div style="font-size:16px;font-weight:bold;letter-spacing:1px">${esc(v.token)}</div><div>Meter/No: ${esc(v.recipient)}</div>${v.message ? `<div>${esc(v.message)}</div>` : ''}</div>`).join('');
  const vasOther = (o.vas || []).filter(v => !v.token).map(v => `<div>Ref: ${esc(v.provider_ref || '')} · ${esc(v.message || '')}</div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: 80mm auto; margin: 3mm } body { font-family: 'Courier New', monospace; font-size: 12px; width: 72mm; margin: 0 auto; color: #000 }
    .c { text-align: center } .r { text-align: right; white-space: nowrap } table { width: 100%; border-collapse: collapse } td { vertical-align: top; padding: 1px 0 }
    hr { border: 0; border-top: 1px dashed #000; margin: 6px 0 } .b { font-weight: bold } .big { font-size: 15px; font-weight: bold }
  </style></head><body>
  ${receiptLogoHtml(company)}
  <div class="c big">${esc(company.name || '')}</div>
  <div class="c">${esc(company.address || '')}${company.phone ? '<br>Tel ' + esc(company.phone) : ''}${company.tax_number ? '<br>VAT No: ' + esc(company.tax_number) : ''}</div>
  <hr><div>${o.refund_of ? '<b>REFUND</b> ' : ''}${esc(o.number || 'Order #' + o.id)}<br>${dt(o.paid_at || o.created_at)}<br>Served by: ${esc(o.user_name || state.user.name)}${o.table_name ? '<br>Table: ' + esc(o.table_name) : ''}${o.tab_name ? '<br>Tab: ' + esc(o.tab_name) : ''}${o.partner_name ? '<br>Customer: ' + esc(o.partner_name) : ''}</div><hr>
  <table>${o.lines.map(l => `<tr><td colspan="2">${esc(l.name)}</td></tr><tr><td>&nbsp;${fq(l.qty)} x ${m(l.unit_price)}${Number(l.discount_pct) ? ` -${l.discount_pct}%${l.rule_name ? ' ' + esc(l.rule_name) : ''}` : ''}</td><td class="r">${m(l.line_total)}</td></tr>`).join('')}</table>
  <hr><table><tr><td>Excl. VAT</td><td class="r">${m(o.subtotal)}</td></tr><tr><td>VAT</td><td class="r">${m(o.tax_total)}</td></tr>
  ${Number(o.discount_total) ? `<tr><td>Discount</td><td class="r">${m(o.discount_total)}</td></tr>` : ''}
  <tr class="big"><td>TOTAL</td><td class="r">${m(o.total)}</td></tr></table><hr>
  <table>${(o.payments || []).map(p => `<tr><td>${esc(p.method_name)}${p.reference ? ' ' + esc(p.reference) : ''}</td><td class="r">${m(p.direction === 'out' ? -p.amount : p.amount)}</td></tr>`).join('')}
  ${Number(o.change_given) ? `<tr class="b"><td>Change</td><td class="r">${m(o.change_given)}</td></tr>` : ''}</table>
  ${vasTokens}${vasOther}${servicesHtml(o)}
  ${o.receipt_qr_svg ? `<hr><div class="c"><div style="width:30mm;margin:0 auto">${o.receipt_qr_svg}</div><div style="font-size:10.5px">${esc(o.receipt_qr_text || 'Scan for your digital receipt')}</div></div>` : ''}
  <hr><div class="c">${esc(company.receipt_footer || 'Thank you!')}</div><div class="c" style="font-size:10px;margin-top:6px">Powered by S-ERP</div>
  </body></html>`;
}

function receiptDialog(order, change) {
  const html = receiptHtml(order);
  const tokens = (order.vas || []).filter(v => v.token);
  const lockAfter = S.catalog.pos && Number(S.catalog.pos.require_pin_between_sales);
  modal({ title: 'Sale complete', size: 'lg', onClose: () => { if (lockAfter) lock(); }, body: `
    ${change > 0 ? `<div class="card" style="text-align:center;margin-bottom:12px"><div class="muted">Change due</div><div class="paydue" style="color:var(--ok)">${money(change)}</div></div>` : ''}
    ${tokens.map(t => `<div class="token-box">${esc(t.token)}</div>`).join('')}
    <iframe id="rcpt" style="width:100%;height:420px;border:1px solid var(--line);border-radius:8px;background:#fff"></iframe>`,
    onOpen: r => { const f = r.querySelector('#rcpt'); f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close(); },
    actions: [
      { label: '🖨 Print', onClick: () => printHtml(html) },
      { label: 'Next customer ▶', cls: 'btn-primary' }
    ] });
}

function printKitchenTicket(order, newLines) {
  const names = new Set(newLines.map(l => l.name));
  let ls = order.lines.filter(l => l.station && l.station !== 'none' && (!newLines.length || names.has(l.name)));
  if (!ls.length) ls = order.lines;
  printHtml(`<html><body style="font-family:monospace;width:72mm"><h2 style="margin:0">${esc(order.table_name ? 'TABLE ' + order.table_name : order.tab_name || 'ORDER ' + order.id)}</h2>
    <div>${new Date().toLocaleTimeString()} · ${esc(state.user.name)}</div><hr>${ls.map(l => `<div style="font-size:16px"><b>${fq(l.qty)} x</b> ${esc(l.name)}${l.note ? `<br>&nbsp;&nbsp;<i>** ${esc(l.note)}</i>` : ''}</div>`).join('')}</body></html>`);
}

// ---------------------------------------------------------------- split / move
function splitDialog() {
  const L = S.order.lines.filter(l => l.id);
  if (S.dirty) return toast('Save the order first', 'info');
  modal({ title: 'Split bill — select items to move to a separate bill', body: `<ul class="list-plain">${L.map(l => `<li><label class="row"><input type="checkbox" value="${l.id}"> ${fq(l.qty)} × ${esc(l.name)}</label><span>${money(l.line_total)}</span></li>`).join('')}</ul>`,
    actions: [{ label: 'Cancel' }, { label: 'Split', cls: 'btn-primary', onClick: async (c, r) => {
      const ids = $$('input:checked', r).map(i => Number(i.value));
      if (!ids.length) return toast('Select items', 'info');
      const n = await POST(`/pos/orders/${S.order.id}/split`, { line_ids: ids });
      c(); toast('Bill split — now showing the new bill'); await loadOrder(n.id);
    } }] });
}

async function moveTableDialog() {
  const floors = await GET('/pos/floors');
  const free = floors.flatMap(f => f.tables.filter(t => !t.order_id).map(t => ({ ...t, floor: f.name })));
  modal({ title: 'Move to table', body: `<div class="tables">${free.map(t => `<div class="rtable" data-t="${t.id}"><div class="tn">${esc(t.name)}</div><div class="seats">${esc(t.floor)}</div></div>`).join('') || '<div class="empty">No free tables</div>'}</div>`,
    onOpen: (r, c) => $$('[data-t]', r).forEach(el => el.onclick = async () => {
      const t = free.find(x => x.id === Number(el.dataset.t));
      S.order.table_id = t.id; S.order.table_name = t.name;
      try { await persist(false); c(); toast(`Moved to ${t.name}`); renderOrder(); } catch (e) { err(e); }
    }) });
}

// ---------------------------------------------------------------- sessions
function openSessionDialog() {
  modal({ title: `Open session — ${S.terminal.name}`, size: 'sm', body: `<p class="muted">Count the cash float in the drawer.</p><label class="field"><span>Opening cash</span><input id="oc" type="number" step="0.01" value="0"></label>`,
    actions: [{ label: 'Cancel' }, { label: 'Open session', cls: 'btn-primary', onClick: async (c, r) => {
      S.session = await POST('/pos/sessions/open', { terminal_id: S.terminal.id, opening_cash: Number(r.querySelector('#oc').value) });
      S.session = await GET('/pos/sessions/' + S.session.id);
      c(); toast('Session opened'); render();
    } }] });
}

async function closeSessionDialog() {
  const s = await GET('/pos/sessions/' + S.session.id);
  const open = (await GET('/pos/orders?status=open')).filter(o => o.session_id === s.id);
  modal({ title: `Close session #${s.id}`, size: 'lg', body: `
    ${open.length ? `<div class="card" style="background:var(--warn-soft);margin-bottom:12px">⚠ ${open.length} order(s) are still open on this session. They can be paid in the next session.</div>` : ''}
    <div class="cols cols-2"><div class="kpi"><div class="label">Sales</div><div class="value">${money(s.sales.total)}</div><div class="hint">${s.sales.orders} orders</div></div>
    <div class="kpi"><div class="label">Expected cash in drawer</div><div class="value">${money(s.expected_cash_now)}</div><div class="hint">Opening ${money(s.opening_cash)}</div></div></div>
    <h4 style="margin:14px 0 6px">By payment method</h4>
    <ul class="list-plain">${s.payments.map(p => `<li><span>${esc(p.name)} (${p.count})</span><b>${money(p.amount)}</b></li>`).join('') || '<li class="muted">No payments</li>'}</ul>
    <div class="form-grid" style="margin-top:14px"><label class="field"><span>Counted cash</span><input id="cc" type="number" step="0.01" value="${s.expected_cash_now}"></label>
    <label class="field"><span>Notes</span><input id="cn"></label></div><div id="diff" class="muted" style="margin-top:6px"></div>`,
    onOpen: r => { const u = () => { const d = round2(Number(r.querySelector('#cc').value) - s.expected_cash_now); r.querySelector('#diff').innerHTML = d ? `Difference: <b style="color:${d < 0 ? 'var(--bad)' : 'var(--ok)'}">${money(d)}</b> (${d < 0 ? 'short' : 'over'})` : 'Drawer balances ✓'; }; r.querySelector('#cc').oninput = u; u(); },
    actions: [{ label: 'Cancel' }, { label: 'Print Z-report', onClick: () => printHtml(zReport(s)) }, { label: 'Close session', cls: 'btn-danger', onClick: async (c, r) => {
      const res = await POST(`/pos/sessions/${s.id}/close`, { counted_cash: Number(r.querySelector('#cc').value), notes: r.querySelector('#cn').value });
      c(); toast(`Session closed${res.email === 'sent' ? ' · report emailed' : ''}`);
      printHtml(zReport({ ...s, counted_cash: res.counted_cash, difference: res.difference }));
      S.session = null; render(); openSessionDialog();
    } }] });
}

function zReport(s) {
  return `<html><body style="font-family:monospace;width:72mm;font-size:12px">${receiptLogoHtml()}<h3 style="text-align:center;margin:0">${esc(state.company.name || '')}</h3><div style="text-align:center">Z-REPORT · Session #${s.id}</div><hr>
  Till: ${esc(s.terminal_name)}<br>Cashier: ${esc(s.user_name)}<br>Opened: ${dt(s.opened_at)}<br>Printed: ${new Date().toLocaleString()}<hr>
  Orders: ${s.sales.orders}<br>Sales: ${money(s.sales.total)}<hr>${s.payments.map(p => `${esc(p.name)}: ${money(p.amount)}<br>`).join('')}<hr>
  Opening cash: ${money(s.opening_cash)}<br>Expected cash: ${money(s.expected_cash_now)}<br>${s.counted_cash != null ? `Counted: ${money(s.counted_cash)}<br>Difference: ${money(s.difference)}<br>` : ''}</body></html>`;
}

// ---------------------------------------------------------------- history & refunds
async function historyDialog() {
  const close = modal({ title: 'Order history', wide: true, body: `<div class="row" style="margin-bottom:10px"><input id="hq" placeholder="Search order number…"><input id="hd" type="date" value="${today()}" style="max-width:180px"></div><div id="hl"></div>`,
    onOpen: r => {
      const load = async () => {
        const rows = await GET(`/pos/orders?date=${r.querySelector('#hd').value}&q=${encodeURIComponent(r.querySelector('#hq').value)}&limit=300`);
        r.querySelector('#hl').innerHTML = `<div class="table-wrap" style="max-height:60vh"><table class="grid"><thead><tr><th>Number</th><th>Time</th><th>Where</th><th>Staff</th><th>Status</th><th class="r">Total</th></tr></thead><tbody>
          ${rows.map(o => `<tr data-id="${o.id}"><td>${esc(o.number || '#' + o.id)}</td><td>${dt(o.paid_at || o.created_at)}</td><td>${esc(o.table_name ? 'Table ' + o.table_name : o.tab_name || o.mode)}</td><td>${esc(o.user_name || '')}</td><td>${badge(o.status)}</td><td class="r">${money(o.total)}</td></tr>`).join('')}</tbody></table></div>`;
        $$('[data-id]', r).forEach(tr => tr.onclick = () => orderDetail(Number(tr.dataset.id), () => { close(); }));
      };
      r.querySelector('#hq').oninput = debounce(load, 250); r.querySelector('#hd').onchange = load; load();
    } });
}

async function orderDetail(id, closeParent) {
  const o = await GET('/pos/orders/' + id);
  const acts = [{ label: '🖨 Reprint', onClick: () => printHtml(receiptHtml(o)) }];
  if (o.status === 'open') acts.push({ label: 'Open order', cls: 'btn-primary', onClick: async c => { c(); closeParent(); await loadOrder(o.id); } });
  if (o.status === 'paid' && !o.refund_of && can('pos.refund')) acts.push({ label: 'Refund…', cls: 'btn-danger', onClick: c => { c(); refundDialog(o); } });
  modal({ title: o.number || `Order #${o.id}`, size: 'lg', body: `<iframe id="rc" style="width:100%;height:440px;border:1px solid var(--line);border-radius:8px"></iframe>`,
    onOpen: r => { const f = r.querySelector('#rc'); f.contentDocument.open(); f.contentDocument.write(receiptHtml(o)); f.contentDocument.close(); }, actions: acts });
}

function refundDialog(o) {
  const lines = o.lines.filter(l => !l.vas_transaction_id);
  modal({ title: `Refund ${o.number}`, size: 'lg', body: `<p class="muted">Enter quantities to return. Stock goes back on the shelf.</p>
    <table class="grid">${lines.map(l => { const avail = Number(l.qty) - Number(l.refunded_qty || 0); return `<tr><td>${esc(l.name)}</td><td class="r">${fq(l.qty)} sold${l.refunded_qty ? ` · ${fq(l.refunded_qty)} already refunded` : ''}</td><td style="width:110px"><input type="number" min="0" max="${avail}" step="any" data-l="${l.id}" value="0" ${avail <= 0 ? 'disabled' : ''}></td></tr>`; }).join('')}</table>
    <div class="form-grid" style="margin-top:12px"><label class="field"><span>Refund via</span><select id="rm">${S.catalog.methods.filter(m => m.kind !== 'account' || o.partner_id).map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></label>
    <label class="field"><span>Reason</span><input id="rr"></label></div>`,
    actions: [{ label: 'Cancel' }, { label: 'Refund all', onClick: (c, r) => { $$('[data-l]', r).forEach(i => i.value = i.max); } },
      { label: 'Process refund', cls: 'btn-danger', onClick: async (c, r) => {
        const ls = $$('[data-l]', r).map(i => ({ line_id: Number(i.dataset.l), qty: Number(i.value) })).filter(l => l.qty > 0);
        const res = await POST(`/pos/orders/${o.id}/refund`, { lines: ls, method_id: Number(r.querySelector('#rm').value), reason: r.querySelector('#rr').value, session_id: S.session && S.session.id });
        c(); toast(`Refunded ${money(res.amount)}`);
        const ro = await GET('/pos/orders/' + res.refund_id); printHtml(receiptHtml(ro));
      } }] });
}

// ---------------------------------------------------------------- VAS (airtime, electricity…)
function vasDialog() {
  if (!S.session) return openSessionDialog();
  const services = S.catalog.vas.flatMap(p => (p.services || []).map(s => ({ ...s, plugin_id: p.plugin_id, plugin_name: p.plugin_name })));
  const icons = { airtime: '📱', data: '📶', electricity: '💡', water: '🚰', tv: '📺', bill: '🧾' };
  let svc = null, prov = null, verified = null;
  const close = modal({ title: 'Value Added Services', wide: true, body: `<div id="vb"></div>` , onOpen: r => draw(r) });
  function draw(r) {
    const b = r.querySelector('#vb');
    if (!svc) {
      b.innerHTML = `<div class="methods" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">${services.map((s, i) => `<button class="method" data-s="${i}" style="padding:22px 10px"><div style="font-size:30px">${icons[s.code] || '⚡'}</div>${esc(s.name)}<span class="k">${esc(s.plugin_name)}</span></button>`).join('')}</div>
        ${S.catalog.vas.filter(v => v.error).map(v => `<div class="muted">⚠ ${esc(v.plugin_name)}: ${esc(v.error)}</div>`).join('')}`;
      $$('[data-s]', b).forEach(x => x.onclick = () => { svc = services[Number(x.dataset.s)]; prov = (svc.providers || [])[0] || null; draw(r); });
      return;
    }
    const cashM = S.catalog.methods.filter(m => m.kind !== 'account');
    b.innerHTML = `<div class="row" style="margin-bottom:12px"><button class="btn btn-sm" id="vback">← Services</button><h3>${icons[svc.code] || '⚡'} ${esc(svc.name)}</h3></div>
      <div class="form-grid">
        ${(svc.providers || []).length > 1 ? `<label class="field" style="grid-column:span 2"><span>Network / provider</span><div class="row wrap">${svc.providers.map(p => `<button class="btn ${prov && prov.code === p.code ? 'btn-primary' : ''}" data-pv="${esc(p.code)}">${esc(p.name)}</button>`).join('')}</div></label>` : ''}
        <label class="field"><span>${esc(svc.recipientLabel || 'Phone / account number')}</span><div class="row"><input id="vr" inputmode="numeric" autocomplete="off">${svc.needsLookup ? '<button class="btn" id="vl">Verify</button>' : ''}</div><small id="vlr"></small></label>
        <label class="field"><span>Amount</span><input id="va" type="number" step="0.01" min="${svc.minAmount || 0}" ${svc.maxAmount ? `max="${svc.maxAmount}"` : ''}></label>
        ${svc.fixedAmounts ? `<div class="quick" style="grid-column:span 2">${svc.fixedAmounts.map(a => `<button class="btn" data-fa="${a}">${money(a)}</button>`).join('')}</div>` : ''}
        <label class="field"><span>Customer pays with</span><select id="vm">${cashM.map(m => `<option value="${m.id}" data-k="${m.kind}" data-ref="${m.requires_reference}">${esc(m.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Amount tendered</span><input id="vt" type="number" step="0.01"></label>
        <label class="field" id="vrefw" style="display:none;grid-column:span 2"><span>Payment reference</span><input id="vref"></label>
      </div>
      <div class="row" style="margin-top:16px"><span class="muted" id="vchg"></span><span class="spacer"></span><button class="btn btn-ok btn-lg" id="vsell">Sell</button></div>
      <div id="vres"></div>`;
    b.querySelector('#vback').onclick = () => { svc = null; verified = null; draw(r); };
    $$('[data-pv]', b).forEach(x => x.onclick = () => { prov = svc.providers.find(p => p.code === x.dataset.pv); draw(r); });
    const amt = b.querySelector('#va'), ten = b.querySelector('#vt'), vm = b.querySelector('#vm');
    const upd = () => {
      const o = vm.selectedOptions[0]; b.querySelector('#vrefw').style.display = o.dataset.k !== 'cash' ? '' : 'none';
      if (o.dataset.k !== 'cash') ten.value = amt.value;
      const ch = round2(Number(ten.value || 0) - Number(amt.value || 0)); b.querySelector('#vchg').textContent = ch > 0 ? `Change: ${money(ch)}` : '';
    };
    amt.oninput = () => { ten.value = amt.value; upd(); }; ten.oninput = upd; vm.onchange = upd;
    $$('[data-fa]', b).forEach(x => x.onclick = () => { amt.value = x.dataset.fa; ten.value = x.dataset.fa; upd(); });
    const vl = b.querySelector('#vl');
    if (vl) vl.onclick = async () => {
      vl.disabled = true;
      try { const res = await POST('/vas/lookup', { plugin_id: svc.plugin_id, service: svc.code, provider: prov && prov.code, recipient: b.querySelector('#vr').value });
        verified = res.ok; b.querySelector('#vlr').innerHTML = res.ok ? `<b style="color:var(--ok)">✓ ${esc(res.name || res.message || 'Verified')}</b>` : `<b style="color:var(--bad)">✕ ${esc(res.message || 'Not found')}</b>`;
      } catch (e) { err(e); } finally { vl.disabled = false; }
    };
    b.querySelector('#vsell').onclick = async () => {
      const btn = b.querySelector('#vsell');
      const recipient = b.querySelector('#vr').value.trim(), amount = Number(amt.value);
      if (!recipient || !(amount > 0)) return toast('Enter recipient and amount', 'err');
      if (svc.needsLookup && verified === false) return toast('Recipient could not be verified', 'err');
      if (svc.minAmount && amount < svc.minAmount) return toast(`Minimum is ${money(svc.minAmount)}`, 'err');
      if (svc.maxAmount && amount > svc.maxAmount) return toast(`Maximum is ${money(svc.maxAmount)}`, 'err');
      if (!(await confirmBox(`Sell ${svc.name} ${prov ? '(' + prov.name + ') ' : ''}${money(amount)} to ${recipient}?`, { okLabel: 'Sell now' }))) return;
      btn.disabled = true; btn.textContent = 'Contacting provider…';
      try {
        const res = await POST('/vas/purchase', { plugin_id: svc.plugin_id, service: svc.code, provider: prov && prov.code, recipient, amount, session_id: S.session.id,
          payments: [{ method_id: Number(vm.value), amount: Number(ten.value || amount), reference: b.querySelector('#vref').value }] });
        close();
        toast(res.status === 'pending' ? 'Sale recorded — provider is still processing' : 'Success!', res.status === 'pending' ? 'info' : 'ok');
        receiptDialog(res.order, res.order.change_given);
      } catch (e) { err(e); btn.disabled = false; btn.textContent = 'Sell'; }
    };
    upd();
  }
}

// ---------------------------------------------------------------- pro-forma bill with pay-by-QR
export function billHtml(o, qrs, company = state.company) {
  const m = n => money(n);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: 80mm auto; margin: 3mm } body { font-family: 'Courier New', monospace; font-size: 12px; width: 72mm; margin: 0 auto; color: #000 }
    .c { text-align: center } .r { text-align: right } table { width: 100% ; border-collapse: collapse } td { vertical-align: top; padding: 1px 0 }
    hr { border: 0; border-top: 1px dashed #000; margin: 6px 0 } .big { font-size: 15px; font-weight: bold } .qr { width: 34mm; margin: 4px auto 0 }
  </style></head><body>
  ${receiptLogoHtml(company)}<div class="c big">${esc(company.name || '')}</div>
  <div class="c">${esc(company.address || '')}${company.phone ? '<br>Tel ' + esc(company.phone) : ''}</div>
  <hr><div class="c big">BILL – NOT A TAX RECEIPT</div>
  <div>${o.table_name ? 'Table ' + esc(o.table_name) : o.tab_name ? 'Tab: ' + esc(o.tab_name) : 'Order #' + o.id}<br>${new Date().toLocaleString()}${o.guests ? '<br>Guests: ' + o.guests : ''}</div><hr>
  <table>${o.lines.map(l => `<tr><td>${fq(l.qty)} ${esc(l.name)}</td><td class="r">${m(l.line_total)}</td></tr>`).join('')}</table>
  <hr><table><tr><td>VAT incl.</td><td class="r">${m(o.tax_total)}</td></tr><tr class="big"><td>TO PAY</td><td class="r">${m(o.total)}</td></tr></table>
  ${qrs.length ? `<hr><div class="c"><b>Pay from your phone</b></div>${qrs.map(q => `<div class="c" style="margin-top:8px"><div class="qr">${q.svg}</div><div>${esc(q.label)}</div><div style="font-size:10px">Ref: BILL${o.id}</div></div>`).join('')}` : ''}
  <hr><div class="c">Please ask for your receipt after paying.</div></body></html>`;
}

async function billDialog() {
  if (!S.order.id) return;
  try {
    if (S.dirty) await persist(false);
    const { order, qrs } = await GET(`/pos/orders/${S.order.id}/bill`);
    const html = billHtml(order, qrs);
    modal({ title: `Bill — ${contextLabel().replace(/<[^>]+>/g, ' ')}`, size: 'lg', body: `${qrs.length ? '' : '<div class="card notice">No pay-by-QR codes configured. Add a QR payload to M-Pesa / EcoCash under Settings → Payment methods.</div>'}<iframe id="bl" style="width:100%;height:480px;border:1px solid var(--line);border-radius:8px;background:#fff"></iframe>`,
      onOpen: r => { const f = r.querySelector('#bl'); f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close(); },
      actions: [{ label: 'Close' }, { label: '🖨 Print bill', cls: 'btn-primary', onClick: () => printHtml(html) }] });
  } catch (e) { err(e); }
}

// ---------------------------------------------------------------- weighing (butchery / deli / produce)
function weighDialog(p) {
  const cfg = S.catalog.butchery || {};
  const useScale = cfg.enabled && cfg.scale_enabled;
  let val = '';
  const close = modal({ title: `Weigh — ${p.name}`, size: 'lg', body: `
    <div class="weigh">
      <div class="weigh-display"><span id="wv">0.000</span> <small>${esc(p.uom || 'kg')}</small><div class="muted" id="wst">${useScale ? (scaleSupported() ? 'Place the item on the scale' : 'Scale reading needs the desktop app') : 'Type the weight'}</div></div>
      <div class="weigh-total"><span class="muted">${money(p.price)} / ${esc(p.uom || 'kg')}</span><b id="wt">${money(0)}</b></div>
      <div class="numpad" style="grid-template-columns:repeat(3,1fr)">${['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'].map(k => `<button data-wk="${k}">${k}</button>`).join('')}</div>
      <div class="row" style="margin-top:10px">${useScale ? '<button class="btn btn-lg" id="wread">⚖️ Read scale</button><button class="btn btn-sm" id="wport" title="Choose scale port">Port…</button>' : ''}<span class="spacer"></span><button class="btn btn-lg" id="wclr">Clear</button></div>
    </div>`,
    onOpen: r => {
      const show = () => {
        const kg = Number(val || 0);
        r.querySelector('#wv').textContent = (val === '' ? '0.000' : val);
        r.querySelector('#wt').textContent = money(round2(kg * Number(p.price)));
      };
      $$('[data-wk]', r).forEach(b => b.onclick = () => {
        const k = b.dataset.wk;
        if (k === '⌫') val = val.slice(0, -1); else if (k === '.' && val.includes('.')) return; else if (val.split('.')[1] && val.split('.')[1].length >= 3) return; else val += k;
        show();
      });
      r.querySelector('#wclr').onclick = () => { val = ''; show(); };
      const read = async () => {
        const st = r.querySelector('#wst'); st.textContent = 'Reading scale…';
        try { const w = await readWeight(cfg); val = String(w.kg.toFixed(3)); st.textContent = '✓ Stable reading from scale'; show(); }
        catch (e) { st.textContent = e.message; }
      };
      const rb = r.querySelector('#wread'); if (rb) rb.onclick = read;
      const pb = r.querySelector('#wport'); if (pb) pb.onclick = async () => { try { await chooseScalePort(cfg); read(); } catch (e) { err(e); } };
      r.addEventListener('keydown', e => {
        if (/^[0-9.]$/.test(e.key)) { const b = r.querySelector(`[data-wk="${e.key}"]`); if (b) b.click(); }
        else if (e.key === 'Backspace') r.querySelector('[data-wk="⌫"]').click();
        else if (e.key === 'Enter') r.querySelector('.modal-foot .btn-primary').click();
      });
      r.tabIndex = -1; setTimeout(() => r.focus(), 30);
      if (useScale && cfg.auto_read && scaleSupported()) navigator.serial.getPorts().then(ps => { if (ps.length) read(); });
    },
    actions: [{ label: 'Cancel' }, { label: 'Add to sale', cls: 'btn-primary', onClick: c => {
      const kg = Math.round(Number(val) * 1000) / 1000;
      if (!(kg > 0)) throw new Error('Enter or read a weight first');
      c(); addProduct(p, { qty: kg });
    } }] });
}
