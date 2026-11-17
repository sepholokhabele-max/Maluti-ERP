// S-ERP server without a window: the "server edition".
//   • Windows server:  installed by "Install S-ERP Server" (runs as a background task that starts with Windows, no one needs to sign in)
//   • Linux / cloud:   `npm run server`, or Docker (see docker-compose.yml)
//
// Configuration (environment variables win over the config file):
//   MALUTI_CONFIG   config file (default: %ProgramData%\Maluti ERP\server.json on Windows, ./config.json elsewhere)
//   DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME   use this MySQL / MariaDB server
//   PORT            port (default 8069, or the https port)
//   MALUTI_TLS_CERT + MALUTI_TLS_KEY (PEM files) or MALUTI_TLS_PFX (+ MALUTI_TLS_PASSPHRASE)   serve HTTPS directly
//   MALUTI_HTTP_REDIRECT_PORT   with HTTPS, also answer on this port (usually 80) and redirect to https
//   MALUTI_SETUP_KEY            protects the first-run set-up
// The config file may hold the same: { "port": 443, "tls": { "cert_file": "…", "key_file": "…" }, "http_redirect_port": 80, "db": {…}, "data_dir": "…" }
// With no database configured on Windows, the MySQL that ships with S-ERP is used and backed up every day.
const fs = require('fs');
const path = require('path');
const { start } = require('./app');

const winData = process.platform === 'win32' ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'Maluti ERP') : null;
const cfgFile = process.env.MALUTI_CONFIG || (winData ? path.join(winData, 'server.json') : path.join(__dirname, '..', 'config.json'));
fs.mkdirSync(path.dirname(cfgFile), { recursive: true });
const store = {
  load() { try { return JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch (_) { return {}; } },
  save(c) { fs.writeFileSync(cfgFile, JSON.stringify({ ...this.load(), ...c }, null, 2)); }
};
const saved = store.load();
const dataDir = saved.data_dir || path.dirname(cfgFile);

// log to a file next to the configuration (a background task has no console)
if (process.env.MALUTI_LOG !== 'console' && winData) {
  const log = fs.createWriteStream(path.join(dataDir, 'server.log'), { flags: 'a' });
  for (const lvl of ['log', 'error', 'warn']) { const o = console[lvl]; console[lvl] = (...a) => { o(...a); log.write(`[${new Date().toISOString()}] ${lvl}: ${a.map(String).join(' ')}\n`); }; }
}

function readTls() {
  const t = saved.tls || {};
  const f = (envKey, cfgKey) => process.env[envKey] || t[cfgKey];
  try {
    if (f('MALUTI_TLS_PFX', 'pfx_file')) return { pfx: fs.readFileSync(f('MALUTI_TLS_PFX', 'pfx_file')), passphrase: f('MALUTI_TLS_PASSPHRASE', 'passphrase') || undefined };
    if (f('MALUTI_TLS_CERT', 'cert_file') && f('MALUTI_TLS_KEY', 'key_file')) return { cert: fs.readFileSync(f('MALUTI_TLS_CERT', 'cert_file')), key: fs.readFileSync(f('MALUTI_TLS_KEY', 'key_file')) };
  } catch (e) { console.error('[https] could not read the certificate:', e.message, '– starting without HTTPS'); }
  return null;
}

// the MySQL that ships with S-ERP (Windows installs): resources\mysql next to the program
function embeddedDb() {
  const base = process.env.MALUTI_MYSQL_DIR || path.join(path.dirname(process.execPath), 'resources', 'mysql');
  if (process.env.DB_HOST || !fs.existsSync(base)) return null;
  let EmbeddedMySQL; try { ({ EmbeddedMySQL } = require('../electron/embedded-mysql')); } catch (_) { return null; }
  const emb = new EmbeddedMySQL({ baseDir: base, dataDir: path.join(dataDir, 'mysql-data'), store, log: (...a) => console.log(...a) });
  if (!emb.available()) return null;
  const backupDir = path.join(dataDir, 'backups');
  const backupNow = async () => {
    fs.mkdirSync(backupDir, { recursive: true });
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const file = path.join(backupDir, `maluti-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.sql`);
    await emb.backup(file);
    for (const f of fs.readdirSync(backupDir).filter(x => /^maluti-.*\.sql$/.test(x)).sort().reverse().slice(30)) { try { fs.unlinkSync(path.join(backupDir, f)); } catch (_) {} }
    console.log('[backup] saved', file); return file;
  };
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return; scheduled = true;
    const last = () => { try { return Math.max(0, ...fs.readdirSync(backupDir).filter(f => f.endsWith('.sql')).map(f => fs.statSync(path.join(backupDir, f)).mtimeMs)); } catch (_) { return 0; } };
    const tick = () => { if (Date.now() - last() > 20 * 3600e3) backupNow().catch(e => console.error('[backup]', e.message)); };
    setTimeout(tick, 5 * 60e3); setInterval(tick, 3600e3);
  };
  return { emb, api: { start: async () => { const c = await emb.start(); schedule(); return c; }, backup: backupNow, running: () => !!(store.load().db || {}).embedded }, schedule };
}

(async () => {
  let dbConfig = process.env.DB_HOST ? {
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'maluti_erp'
  } : saved.db;
  const E = embeddedDb();
  if (E && dbConfig && dbConfig.embedded) { dbConfig = await E.api.start(); store.save({ db: dbConfig }); }
  const tls = readTls();
  const port = Number(process.env.PORT || saved.port || (tls ? 443 : 8069));
  const mode = process.env.MALUTI_MODE || (process.env.DB_HOST && fs.existsSync('/.dockerenv') ? 'docker' : 'server');
  const { port: p } = await start({ port, host: saved.host || '0.0.0.0', dbConfig, configStore: store, embeddedDb: E ? E.api : null, mode, tls,
    httpRedirectPort: tls ? Number(process.env.MALUTI_HTTP_REDIRECT_PORT || saved.http_redirect_port || 0) || null : null,
    pluginDirs: [path.join(__dirname, '..', 'plugins'), process.env.PLUGIN_DIR, winData ? path.join(dataDir, 'plugins') : null].filter(Boolean) });
  console.log(`S-ERP server edition running on ${tls ? 'https' : 'http'}://localhost:${p}  (configuration: ${cfgFile})`);
  const stop = () => { const done = () => process.exit(0); if (E && E.emb.proc) E.emb.stop().catch(() => {}).finally(done); else done(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
})().catch(e => { console.error(e); process.exit(1); });
