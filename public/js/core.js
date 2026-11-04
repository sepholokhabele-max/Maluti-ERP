// Core helpers: API client, state, formatting, modal, toast, routing.
export const state = {
  token: localStorage.getItem('maluti_token') || null,
  user: null,
  company: {},
  status: null
};

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export async function api(method, url, body) {
  const res = await fetch('/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (res.status === 401 && state.token && !url.startsWith('/login') && !url.startsWith('/pin-login')) {
    setToken(null); location.hash = '#/login';
  }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}
export const GET = u => api('GET', u), POST = (u, b) => api('POST', u, b ?? {}), PUT = (u, b) => api('PUT', u, b), DEL = u => api('DELETE', u);

export function setToken(t) {
  state.token = t;
  if (t) localStorage.setItem('maluti_token', t); else localStorage.removeItem('maluti_token');
}

// ---------- company logo ----------
/** Loads the company logo (as a data URL) into state.logo when the company's logo_version changes. */
export async function ensureLogo() {
  const v = state.company && state.company.logo_version;
  if (!v) { state.logo = null; state.logoVersion = null; return null; }
  if (state.logo && state.logoVersion === v) return state.logo;
  try {
    const r = await fetch('/api/company/logo?v=' + v);
    if (!r.ok) throw new Error('no logo');
    const blob = await r.blob();
    state.logo = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
    state.logoVersion = v;
  } catch (_) { state.logo = null; state.logoVersion = null; }
  return state.logo;
}

/** Read an image file and resize it in the browser to a PNG data URL (keeps transparency). SVG/WebP/GIF are converted too. */
export function imageFileToDataUrl(file, { maxW = 600, maxH = 300 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('Choose an image file (PNG, JPG, SVG, WebP or GIF)'));
    if (file.size > 10 * 1024 * 1024) return reject(new Error('Image is larger than 10 MB'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w0 = img.naturalWidth || img.width || maxW, h0 = img.naturalHeight || img.height || maxH;
      const k = Math.min(1, maxW / w0, maxH / h0);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, c.width, c.height);
      let out = c.toDataURL('image/png');
      if (out.length > 1.9e6) { // very detailed photo: fall back to JPEG on white
        const j = document.createElement('canvas'); j.width = c.width; j.height = c.height;
        const jx = j.getContext('2d'); jx.fillStyle = '#fff'; jx.fillRect(0, 0, j.width, j.height); jx.drawImage(c, 0, 0);
        out = j.toDataURL('image/jpeg', 0.88);
      }
      resolve({ dataUrl: out, width: c.width, height: c.height });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
    img.src = url;
  });
}

/** <img> tag for the receipt / documents logo, honouring the company's receipt-logo settings */
export function receiptLogoHtml(company = state.company, { maxWidthMm = 72 } = {}) {
  if (!state.logo || company.show_logo_receipt === 0 || company.show_logo_receipt === false) return '';
  const w = Math.min(maxWidthMm, Math.max(15, Number(company.logo_width_mm) || 40));
  const bw = company.logo_bw === undefined ? 1 : Number(company.logo_bw);
  return `<div style="text-align:center;margin-bottom:4px"><img src="${state.logo}" alt="" style="width:${w}mm;max-width:100%;max-height:30mm;object-fit:contain;${bw ? 'filter:grayscale(1) contrast(1.35);' : ''}"></div>`;
}

/** module switched on for this business (Settings → Business & modules); `k` may be a list = any of them */
export const hasMod = k => { const b = state.biz; if (!b || !Array.isArray(b.modules)) return true; return (Array.isArray(k) ? k : [k]).some(x => b.modules.includes(x)); };
/** active stock locations (branches, warehouses, vans, in transit), cached per screen */
export async function getLocations() { if (!state.locations) state.locations = await GET('/locations').catch(() => []); return state.locations; }
/** <select> options of real (non-transit) locations; blank first when `blank` is a label */
export async function locationOptions(blank) {
  const l = (await getLocations()).filter(x => x.kind !== 'transit');
  return [...(blank ? [{ value: '', label: blank }] : []), ...l.map(x => ({ value: x.id, label: x.name + (x.is_default ? ' (default)' : '') }))];
}
/** branches are only worth showing once the module is on and there is more than one place */
export async function multiLocation() { return hasMod('locations') && (await getLocations()).filter(x => x.kind !== 'transit').length > 1; }
export const can = perm => !!state.user && (state.user.permissions.includes('*') || state.user.permissions.includes(perm));

export function money(n, sym = true) {
  const v = Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return sym ? `${state.company.currency_symbol || 'M'} ${v}` : v;
}
export const qty = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
export const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const plusDays = n => { const d = new Date(); d.setDate(d.getDate() + Number(n || 0)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const dt = s => s ? new Date(String(s).replace(' ', 'T')).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
export const d = s => s ? String(s).slice(0, 10) : '';
export const timeAgo = s => {
  const m = Math.floor((Date.now() - new Date(String(s).replace(' ', 'T'))) / 60000);
  return m < 1 ? 'now' : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

// ---------- toasts ----------
export function toast(msg, type = 'ok', ms = 3200) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('hide'), ms);
  setTimeout(() => el.remove(), ms + 400);
}
export const err = e => toast(e.message || String(e), 'err', 5000);

import { HELP } from './help.js';
import { HELP_ST } from './help_st.js';
import { pick } from './i18n.js';
// ---------- modal ----------
/**
 * modal({ title, body (html), wide, actions:[{label, cls, onClick(close, root) }], onOpen(root, close) })
 * returns close()
 */
const openModals = new Set();
/** close every dismissable dialog (used when the user navigates to another page) */
export function closeModals() { for (const c of [...openModals]) c(); }
export function modal({ title, body, wide, size, actions = [], onOpen, onClose, dismissable = true }) {
  const root = $('#modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${wide ? 'modal-wide' : ''} ${size ? 'modal-' + size : ''}" role="dialog">
    <div class="modal-head"><h3>${esc(title || '')}</h3>${dismissable ? '<button class="icon-btn" data-x aria-label="Close">✕</button>' : ''}</div>
    <div class="modal-body">${body || ''}</div>
    ${actions.length ? `<div class="modal-foot">${actions.map((a, i) => `<button class="btn ${a.cls || ''}" data-a="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}
  </div>`;
  root.appendChild(wrap);
  const close = () => { openModals.delete(close); wrap.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); };
  if (dismissable) openModals.add(close);
  const onKey = e => { if (e.key === 'Escape' && dismissable && wrap === root.lastElementChild) close(); };
  document.addEventListener('keydown', onKey);
  if (dismissable) {
    wrap.querySelector('[data-x]').onclick = close;
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  }
  actions.forEach((a, i) => {
    const b = wrap.querySelector(`[data-a="${i}"]`);
    b.onclick = async () => {
      if (!a.onClick) return close();
      b.disabled = true;
      try { await a.onClick(close, wrap); } catch (e) { err(e); } finally { b.disabled = false; }
    };
  });
  onOpen && onOpen(wrap, close);
  const first = wrap.querySelector('input:not([type=hidden]):not([readonly]), select, textarea');
  if (first) setTimeout(() => { if (!wrap.contains(document.activeElement)) first.focus(); }, 30);
  return close;
}

export function confirmBox(message, { okLabel = 'Confirm', danger } = {}) {
  return new Promise(resolve => {
    modal({ title: 'Please confirm', body: `<p>${esc(message)}</p>`, onClose: () => resolve(false),
      actions: [{ label: 'Cancel', onClick: c => { resolve(false); c(); } }, { label: okLabel, cls: danger ? 'btn-danger' : 'btn-primary', onClick: c => { resolve(true); c(); } }] });
  });
}

export function promptBox(title, { label = '', value = '', type = 'text' } = {}) {
  return new Promise(resolve => {
    let done = false;
    modal({ title, body: `<label class="field"><span>${esc(label)}</span><input id="pb" type="${type}" value="${esc(value)}"></label>`,
      onOpen: r => r.querySelector('#pb').addEventListener('keydown', e => { if (e.key === 'Enter') r.querySelector('[data-a="1"]').click(); }),
      onClose: () => { if (!done) resolve(null); },
      actions: [{ label: 'Cancel' }, { label: 'OK', cls: 'btn-primary', onClick: (c, r) => { done = true; resolve(r.querySelector('#pb').value); c(); } }] });
  });
}

// ---------- forms ----------
/**
 * fields: [{ key, label, type: text|number|email|select|checkbox|textarea|date|color|password, options:[{value,label}], required, step, help, span }]
 */
export function formHtml(fields, values = {}, { ctx } = {}) {
  const H = ctx ? HELP[ctx] || {} : {}, HS = ctx ? HELP_ST[ctx] || {} : {};
  return `<div class="form-grid">${fields.map(f => {
    const v = values[f.key] ?? f.default ?? '';
    const help = f.help ?? H[f.key];
    const hp = help ? pick(help, f.help ? f.help_st : HS[f.key]) : null;
    const note = hp ? `<small class="help-note">${esc(hp.text)}${hp.alt ? `<span class="help-alt">${esc(hp.alt)}</span>` : ''}</small>` : '';
    const id = `f_${f.key}`;
    const req = f.required ? 'required' : '';
    const span = f.span ? `style="grid-column: span ${f.span}"` : '';
    if (f.type === 'heading') return `<div class="form-heading" style="grid-column:1/-1"><b>${esc(f.label)}</b>${f.help ? ` <span class="muted">${esc(f.help)}</span>` : ''}</div>`;
    if (f.type === 'checkbox') return `<div class="field" ${span}><label class="check"><input type="checkbox" id="${id}" name="${f.key}" ${Number(v) || v === true ? 'checked' : ''}> <span>${esc(f.label)}</span></label>${note}</div>`;
    let input;
    if (f.type === 'select') input = `<select id="${id}" name="${f.key}" ${req}>${(f.options || []).map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    else if (f.type === 'textarea' || f.type === 'json') input = `<textarea id="${id}" name="${f.key}" rows="${f.rows || 3}" ${req}>${esc(typeof v === 'object' ? JSON.stringify(v, null, 2) : v)}</textarea>`;
    else input = `<input id="${id}" name="${f.key}" type="${f.type || 'text'}" value="${esc(v)}" ${f.step ? `step="${f.step}"` : f.type === 'number' ? 'step="any"' : ''} ${req} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}>`;
    return `<label class="field" ${span}><span>${esc(f.label)}${f.required ? ' *' : ''}</span>${input}${note}</label>`;
  }).join('')}</div>`;
}
export function readForm(root, fields) {
  const out = {};
  for (const f of fields) {
    if (f.type === 'heading') continue;
    const el = root.querySelector(`[name="${f.key}"]`);
    if (!el) continue;
    if (f.type === 'checkbox') out[f.key] = el.checked ? 1 : 0;
    else if (f.type === 'number') out[f.key] = el.value === '' ? (f.nullable ? null : 0) : Number(el.value);
    else if (f.type === 'select' && f.numeric) out[f.key] = el.value === '' ? null : Number(el.value);
    else out[f.key] = el.value;
    if (f.required && (out[f.key] === '' || out[f.key] == null)) throw new Error(`${f.label} is required`);
  }
  return out;
}

// ---------- tables ----------
/** columns: [{ key, label, fmt(v,row), right, html }] */
export function tableHtml(columns, rows, { rowAttr, empty = 'Nothing here yet.' } = {}) {
  if (!rows.length) return `<div class="empty">${esc(empty)}</div>`;
  return `<div class="table-wrap"><table class="grid"><thead><tr>${columns.map(c => `<th class="${c.right ? 'r' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((r, i) => `<tr ${rowAttr ? rowAttr(r, i) : ''}>${columns.map(c => {
    const v = c.fmt ? c.fmt(r[c.key], r) : r[c.key];
    return `<td class="${c.right ? 'r' : ''}">${c.html ? v : esc(v)}</td>`;
  }).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export const badge = (text, kind = '') => `<span class="badge badge-${esc(kind || String(text).toLowerCase())}">${esc(text)}</span>`;

// ---------- page shell ----------
export function page(title, actionsHtml = '', bodyHtml = '', { back } = {}) {
  return `<div class="page">
    <div class="page-head">
      <div class="page-title">${back ? `<a class="back" href="${back}">←</a>` : ''}<h2>${esc(title)}</h2></div>
      <div class="page-actions">${actionsHtml}</div>
    </div>
    <div class="page-body">${bodyHtml}</div>
  </div>`;
}

export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ---------- printing ----------
export function printHtml(html, { silent } = {}) {
  if (silent && window.maluti && window.maluti.printSilent) return window.maluti.printSilent(html);
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 1500); }, 250);
}

export function query() {
  const q = location.hash.split('?')[1] || '';
  return Object.fromEntries(new URLSearchParams(q));
}

// ---------- file attachments on any record ----------
const fmtSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
/** renders a small "Files" box into `el` for a record; entity e.g. 'invoice', 'project', 'ticket' */
export async function attachPanel(el, entity, id, { title = 'Files' } = {}) {
  if (!el || !id) return;
  const load = async () => {
    const files = await GET(`/attachments?entity=${entity}&entity_id=${id}`).catch(() => []);
    el.innerHTML = `<div class="row" style="margin-bottom:6px"><h3 style="flex:1;margin:0">${esc(title)} <small class="muted" style="font-weight:400">${files.length || ''}</small></h3>
      <label class="btn btn-sm" style="cursor:pointer">📎 Attach<input type="file" hidden multiple data-att></label></div>
      ${files.length ? `<div class="att-list">${files.map(f => `<div class="att"><a href="#" data-open="${f.id}" title="${esc(f.mime)}">${/^image\//.test(f.mime) ? '🖼' : /pdf/.test(f.mime) ? '📄' : '📎'} ${esc(f.filename)}</a>
        <small class="muted">${fmtSize(f.size)} · ${esc(f.user_name || '')} · ${esc(String(f.created_at).slice(0, 10))}</small><button class="icon-btn" data-rm="${f.id}" title="Remove">✕</button></div>`).join('')}</div>`
        : '<div class="muted" style="font-size:13px">No files yet – attach signed delivery notes, quotes, photos, contracts or ID copies (max 8 MB each).</div>'}`;
    el.querySelector('[data-att]').onchange = async e => {
      for (const file of e.target.files) {
        if (file.size > 8 * 1048576) { toast(`${file.name} is larger than 8 MB`, 'err'); continue; }
        const data_url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
        try { await POST('/attachments', { entity, entity_id: id, filename: file.name, data_url }); toast(`${file.name} attached`); } catch (x) { err(x); }
      }
      load();
    };
    el.querySelectorAll('[data-open]').forEach(a => a.onclick = async ev => {
      ev.preventDefault();
      const f = files.find(x => String(x.id) === a.dataset.open);
      const r = await fetch(`/api/attachments/${f.id}/file`, { headers: { Authorization: 'Bearer ' + state.token } });
      if (!r.ok) return toast('Could not open the file', 'err');
      const blob = await r.blob(); const url = URL.createObjectURL(blob);
      if (/^image\/|pdf|^text\//.test(f.mime)) window.open(url, '_blank');
      else { const l = document.createElement('a'); l.href = url; l.download = f.filename; document.body.appendChild(l); l.click(); l.remove(); }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
    el.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { if (await confirmBox('Remove this file?', { danger: true, okLabel: 'Remove' })) { try { await DEL('/attachments/' + b.dataset.rm); load(); } catch (x) { err(x); } } });
  };
  await load();
}
/** adds a "Files" card at the bottom of the current screen */
export function filesCard(entity, id, title) {
  const body = document.querySelector('#app .page-body'); if (!body || !id) return;
  body.insertAdjacentHTML('beforeend', '<div class="card files-card" style="margin-top:14px"></div>');
  attachPanel(body.lastElementChild, entity, id, title ? { title } : {});
}
