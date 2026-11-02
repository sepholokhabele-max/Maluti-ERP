// Kitchen / bar display screen. Tap an item to advance it: sent → preparing → ready.
import { state, GET, POST, esc, $, $$, err, can, timeAgo, setToken, qty } from './core.js';

let station = localStorage.getItem('maluti_station') || 'kitchen';
let timer = null;

export async function start() {
  clearInterval(timer);
  draw();
  timer = setInterval(() => { if (location.hash.startsWith('#/kitchen')) load(); else clearInterval(timer); }, 6000);
}

function draw() {
  $('#app').innerHTML = `<div class="kds">
    <div class="kds-top"><h2>${station === 'kitchen' ? '👨‍🍳 Kitchen' : '🍸 Bar'} display</h2>
      <button class="btn ${station === 'kitchen' ? 'on' : ''}" data-s="kitchen">Kitchen</button><button class="btn ${station === 'bar' ? 'on' : ''}" data-s="bar">Bar</button>
      <span id="clock" style="opacity:.7;margin:0 10px"></span>
      ${can('dashboard') ? '<a class="btn" href="#/">Exit</a>' : '<button class="btn" id="out">Log out</button>'}</div>
    <div class="kds-grid" id="kg"></div></div>`;
  $$('[data-s]').forEach(b => b.onclick = () => { station = b.dataset.s; localStorage.setItem('maluti_station', station); draw(); });
  const o = $('#out'); if (o) o.onclick = () => { setToken(null); state.user = null; location.hash = '#/login'; };
  load();
}

let lastIds = new Set();
async function load() {
  let tickets;
  try { tickets = await GET('/pos/kitchen?station=' + station); } catch (e) { return err(e); }
  const kg = $('#kg'); if (!kg) return;
  const ids = new Set(tickets.flatMap(t => t.lines.map(l => l.id)));
  if ([...ids].some(id => !lastIds.has(id)) && lastIds.size) beep();
  lastIds = ids;
  $('#clock').textContent = new Date().toLocaleTimeString();
  kg.innerHTML = tickets.map(t => {
    const mins = (Date.now() - new Date(String(t.sent_at).replace(' ', 'T'))) / 60000;
    const allReady = t.lines.every(l => l.kitchen_status === 'ready');
    return `<div class="ticket ${allReady ? 'allready' : mins > 20 ? 'late' : ''}">
      <div class="ticket-h"><b>${esc(t.label)}</b><span>${timeAgo(t.sent_at)}</span></div>
      <div style="padding:4px 12px;font-size:12px;opacity:.7">${esc(t.waiter || '')} · #${t.order_id}</div>
      ${t.lines.map(l => `<div class="ticket-l ${l.kitchen_status}" data-l="${l.id}" data-st="${l.kitchen_status}"><span class="q">${qty(l.qty)}×</span>
        <span class="n">${esc(l.name)}${l.note ? `<div class="nt">⚑ ${esc(l.note)}</div>` : ''}</span><span style="font-size:11px;opacity:.7">${l.kitchen_status}</span></div>`).join('')}
      <div class="ticket-f"><button class="btn" data-o="${t.order_id}" data-to="preparing">Start all</button><button class="btn" data-o="${t.order_id}" data-to="ready">All ready</button>
        <button class="btn" data-o="${t.order_id}" data-to="served">Bump ✓</button></div></div>`;
  }).join('') || `<div style="grid-column:1/-1;text-align:center;opacity:.5;padding:80px;font-size:18px">No open tickets 🎉</div>`;
  $$('[data-l]').forEach(el => el.onclick = async () => {
    const next = { sent: 'preparing', preparing: 'ready', ready: 'served' }[el.dataset.st];
    try { await POST(`/pos/kitchen/lines/${el.dataset.l}`, { status: next }); load(); } catch (e) { err(e); }
  });
  $$('[data-o]').forEach(b => b.onclick = async () => {
    try { await POST(`/pos/kitchen/orders/${b.dataset.o}`, { status: b.dataset.to, station }); load(); } catch (e) { err(e); }
  });
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.value = 0.15;
    o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 250);
  } catch (_) {}
}
