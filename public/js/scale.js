// Read weight from a serial (RS-232/USB) scale using Web Serial – works in the S-ERP desktop app and in Chrome/Edge.
import { parseScaleOutput } from './barcode.js';

let port = null, opening = null;

export const scaleSupported = () => typeof navigator !== 'undefined' && !!navigator.serial;

async function getPort(cfg, { choose = false } = {}) {
  if (!scaleSupported()) throw new Error('Scale reading needs the S-ERP desktop app (or Chrome/Edge).');
  if (port && !choose) return port;
  const granted = await navigator.serial.getPorts();
  port = (!choose && granted[0]) || await navigator.serial.requestPort();
  return port;
}

async function ensureOpen(cfg) {
  const p = await getPort(cfg);
  if (p.readable) return p;
  if (!opening) opening = p.open({ baudRate: Number(cfg.baud_rate || 9600), dataBits: Number(cfg.data_bits || 8), stopBits: Number(cfg.stop_bits || 1), parity: cfg.parity || 'none' })
    .finally(() => { opening = null; });
  await opening;
  return p;
}

/** Choose/replace the scale port (shows the port picker) */
export async function chooseScalePort(cfg) { if (port && port.readable) { try { await port.close(); } catch (_) {} } port = null; await getPort(cfg, { choose: true }); return true; }

/** Read one weight. Resolves { kg, stable, raw } */
export async function readWeight(cfg, { timeout = 2500, wantStable = true } = {}) {
  const p = await ensureOpen(cfg);
  if (cfg.request_cmd) {
    const cmd = String(cfg.request_cmd).replace(/\\r/g, '\r').replace(/\\n/g, '\n');
    const w = p.writable.getWriter(); try { await w.write(new TextEncoder().encode(cmd)); } finally { w.releaseLock(); }
  }
  const reader = p.readable.getReader();
  const dec = new TextDecoder();
  let buf = '', last = null;
  const timer = setTimeout(() => reader.cancel().catch(() => {}), timeout);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      if (/[\r\n\x03]/.test(buf)) {
        const r = parseScaleOutput(buf);
        if (r) { last = r; if (r.stable || !wantStable) break; }
        buf = buf.slice(-200);
      }
    }
  } finally { clearTimeout(timer); try { reader.releaseLock(); } catch (_) {} }
  if (!last) throw new Error('No weight received from the scale – check the cable, port and baud rate.');
  if (wantStable && !last.stable) throw new Error(`Scale not stable (${last.kg} kg). Wait for the reading to settle.`);
  return { ...last, raw: buf };
}

/**
 * Put a ⚖ button next to every input matching `selector` (default [data-scale]) that reads the scale into it.
 * data-scale="g" fills grams instead of kg. Buttons only appear when a scale is enabled (or opts.force).
 */
export function attachScale(root, cfg, { selector = '[data-scale]', force = false, onError } = {}) {
  if (!root || !cfg || (!cfg.scale_enabled && !force)) return;
  for (const input of root.querySelectorAll(selector)) {
    if (input.dataset.scaleOn) continue;
    input.dataset.scaleOn = '1';
    const wrap = document.createElement('span');
    wrap.className = 'scale-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'scale-btn'; b.title = 'Read the weight from the scale'; b.textContent = '⚖';
    b.onclick = async e => {
      e.preventDefault(); e.stopPropagation();
      b.disabled = true;
      try {
        const w = await readWeight(cfg);
        input.value = input.dataset.scale === 'g' ? String(Math.round(w.kg * 10000) / 10) : String(w.kg);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (x) { (onError || (m => alert(m)))(x.message || String(x)); }
      finally { b.disabled = false; }
    };
    wrap.appendChild(b);
  }
}
