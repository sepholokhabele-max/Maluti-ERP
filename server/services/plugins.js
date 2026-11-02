/**
 * Plugin loader.
 *
 * A plugin is a folder containing:
 *   plugin.json  – manifest { id, name, version, type: "vas" | "payment", description, author, config: [fields] }
 *   index.js     – module.exports = (ctx) => ({ ...hooks })
 *
 * VAS hooks (type "vas"):
 *   listServices(config)                     -> [{ code, name, providers:[{code,name}], fixedAmounts?, minAmount?, maxAmount?, needsLookup? }]
 *   lookup(config, { service, provider, recipient })  -> { ok, name, message }          (optional, e.g. meter validation)
 *   purchase(config, { service, provider, recipient, amount, reference }) -> { status: 'success'|'pending'|'failed', provider_ref, token, message, commission }
 *   checkStatus(config, { provider_ref, reference }) -> same shape as purchase            (optional)
 *   balance(config) -> { balance, currency }                                               (optional)
 *
 * Payment hooks (type "payment", e.g. mobile-money push):
 *   requestPayment(config, { phone, amount, reference }) -> { status: 'success'|'pending'|'failed', provider_ref, message }
 *   checkStatus(config, { provider_ref, reference })    -> { status, message }
 *
 * Plugins are loaded from the bundled plugins folder and the user plugins folder (drop-in).
 */
const fs = require('fs');
const path = require('path');
const db = require('../db');

const registry = new Map(); // id -> { manifest, impl, dir }
let pluginDirs = [];

function makeCtx(manifest) {
  return {
    log: (...a) => console.log(`[plugin:${manifest.id}]`, ...a),
    /** fetch JSON helper with timeout */
    async http(url, { method = 'GET', headers = {}, body, timeout = 30000 } = {}) {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeout);
      try {
        const res = await fetch(url, {
          method, signal: ac.signal,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
          body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
        });
        const text = await res.text();
        let data; try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
        return { ok: res.ok, status: res.status, data };
      } finally { clearTimeout(t); }
    }
  };
}

function loadAll(dirs) {
  pluginDirs = dirs.filter(d => d && fs.existsSync(d));
  registry.clear();
  for (const base of pluginDirs) {
    for (const name of fs.readdirSync(base)) {
      const dir = path.join(base, name);
      const mf = path.join(dir, 'plugin.json');
      if (!fs.existsSync(mf)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
        const entry = path.join(dir, manifest.main || 'index.js');
        delete require.cache[require.resolve(entry)];
        const impl = require(entry)(makeCtx(manifest));
        registry.set(manifest.id, { manifest, impl, dir });
        console.log(`[plugins] loaded ${manifest.id} v${manifest.version} from ${dir}`);
      } catch (e) {
        console.error(`[plugins] failed to load ${dir}:`, e.message);
      }
    }
  }
  return list();
}

function list() {
  return [...registry.values()].map(p => ({ ...p.manifest, dir: p.dir }));
}

async function getState(id) {
  const row = await db.one('SELECT enabled, config FROM plugins WHERE id = ?', [id]);
  const cfg = row && row.config ? (typeof row.config === 'string' ? JSON.parse(row.config) : row.config) : {};
  return { enabled: !!(row && row.enabled), config: cfg };
}

/** Return plugin with merged config (defaults + saved). Throws if missing/disabled. */
async function get(id, { requireEnabled = true } = {}) {
  const p = registry.get(id);
  if (!p) throw Object.assign(new Error(`Plugin ${id} is not installed`), { status: 404 });
  const st = await getState(id);
  if (requireEnabled && !st.enabled) throw Object.assign(new Error(`Plugin ${id} is disabled`), { status: 400 });
  const defaults = {};
  for (const f of p.manifest.config || []) if (f.default !== undefined) defaults[f.key] = f.default;
  return { ...p, config: { ...defaults, ...st.config }, enabled: st.enabled };
}

async function call(id, hook, args) {
  const p = await get(id);
  if (typeof p.impl[hook] !== 'function') throw Object.assign(new Error(`Plugin ${id} does not support ${hook}`), { status: 400 });
  return p.impl[hook](p.config, args || {});
}

module.exports = { loadAll, list, get, getState, call, dirs: () => pluginDirs };
