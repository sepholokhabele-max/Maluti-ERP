// Full Sesotho screens: when Sesotho is chosen, every English screen text that has a Sesotho version is swapped on the fly
// (labels, buttons, table headings, menus, placeholders, tooltips). Texts written with L() are already in Sesotho.
// Corrections made in Settings → Translations override the built-in words. Texts still missing are collected (counts only)
// so a native speaker can translate them in the review screen.
import { ST_UI } from './sesotho_ui.js';
import { lang } from './i18n.js';

let dict = ST_UI, overrides = {}, observer = null, pending = false;
const stValues = new Set(Object.values(ST_UI)); // already Sesotho – never reported as missing
const missing = new Map();
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'IFRAME', 'SVG', 'svg']);
const ATTRS = ['placeholder', 'title', 'aria-label'];
const LEAD = /^([^A-Za-z]*?)([A-Za-z].*?)([\s*:.…]*)$/s; // keep icons / symbols around the words

function lookup(core) { return overrides[core] || dict[core] || null; }
function trCore(t) {
  const whole = lookup(t);
  if (whole) return whole;
  const m = LEAD.exec(t);
  if (m) { const core = lookup(m[2].trim()); if (core) return `${m[1]}${core}${m[3]}`; }
  // words followed by an amount or count, e.g. "Pay M 95.00", "Session #3"
  const num = /^(.*?[A-Za-z][^\d#]*?)(\s*[#(]?\s*(?:M|R)?\s?[\d][\d\s.,:/%-]*\)?)$/.exec(t);
  if (num) { const head = trCore(num[1].trim()); if (head) return `${head}${num[1].endsWith(' ') ? ' ' : ''}${num[2]}`; }
  // "Welcome, Admin": words, then a name
  const comma = /^([A-Za-z][A-Za-z ]+),\s+(.+)$/.exec(t);
  if (comma) { const h = lookup(comma[1] + ',') || lookup(comma[1]); if (h) return `${h.replace(/,$/, '')}, ${comma[2]}`; }
  // parts joined with " · " or " – "
  for (const sep of [' · ', ' – ', ' | ']) if (t.includes(sep)) {
    const parts = t.split(sep); let any = false;
    const outp = parts.map(x => { const v = trCore(x.trim()); if (v) { any = true; return v; } return x; });
    if (any) return outp.join(sep);
  }
  return null;
}
function tr(text, record) {
  if (!text || !/[A-Za-z]/.test(text)) return null;
  const t = text.replace(/\s+/g, ' ').trim();
  const v = trCore(t);
  if (v) return text.replace(text.trim(), v);
  if (record && !stValues.has(t) && !/^[A-Z0-9/_-]{3,}$/.test(t) && !/@/.test(t) && t.length >= 2 && t.length <= 90 && !/^[\d\s.,:/%M()+−-]+$/.test(t) && /^[\x20-\x7E–—…’‘“”·→←▶＋✓✕]+$/.test(t))
    missing.set(t, (missing.get(t) || 0) + 1);
  return null;
}
function skipEl(el) {
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    if (SKIP.has(e.tagName) || e.isContentEditable || (e.classList && (e.classList.contains('no-tr') || e.classList.contains('mono')))) return true;
  }
  return false;
}
function walk(root) {
  if (!root || lang() !== 'st') return;
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = []; for (let n = tw.nextNode(); n; n = tw.nextNode()) nodes.push(n);
  for (const n of nodes) {
    if (n.__st === n.nodeValue || !n.parentElement || skipEl(n.parentElement)) continue;
    const v = tr(n.nodeValue, true);
    if (v !== null && v !== n.nodeValue) n.nodeValue = v;
    n.__st = n.nodeValue;
  }
  const els = root.querySelectorAll ? root.querySelectorAll('[placeholder],[title],[aria-label],input[type=button],input[type=submit]') : [];
  for (const el of els) {
    if (skipEl(el)) continue;
    for (const a of ATTRS) { const cur = el.getAttribute(a); if (cur && el['__st_' + a] !== cur) { const v = tr(cur, false); if (v) el.setAttribute(a, v); el['__st_' + a] = el.getAttribute(a); } }
    if ((el.type === 'button' || el.type === 'submit') && el.value) { const v = tr(el.value, false); if (v) el.value = v; }
  }
}
function schedule() { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; walk(document.body); }); }

export async function startTranslator() {
  try { const r = await fetch('api/i18n'); if (r.ok) overrides = (await r.json()).overrides || {}; } catch (_) { /* built-in words only */ }
  if (observer) observer.disconnect();
  observer = new MutationObserver(() => { if (lang() === 'st') schedule(); });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  schedule();
  // send the texts still missing a Sesotho version, a few at a time (only the words, never any figures or names typed in fields)
  setInterval(() => {
    if (!missing.size || lang() !== 'st') return;
    const token = (() => { try { return localStorage.getItem('maluti_token'); } catch (_) { return null; } })();
    if (!token) return;
    const strings = [...missing.entries()].slice(0, 200).map(([t, n]) => ({ t, n }));
    missing.clear();
    fetch('api/i18n/missing', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ strings }) }).catch(() => {});
  }, 30000);
}
export function setOverrides(o) { overrides = o || {}; document.querySelectorAll('*').forEach(e => { e.__st = undefined; }); schedule(); }
export const builtIn = () => dict;
// for the review tooling and tests: the texts seen without Sesotho on this screen so far
window.__malutiMissing = () => [...missing.keys()];
