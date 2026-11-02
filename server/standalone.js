// Headless server: `npm run server`
// Configure with environment variables or a config.json next to this file.
const fs = require('fs');
const path = require('path');
const { start } = require('./app');

const cfgFile = process.env.MALUTI_CONFIG || path.join(__dirname, '..', 'config.json');
const store = {
  load() { try { return JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch (_) { return {}; } },
  save(c) { fs.writeFileSync(cfgFile, JSON.stringify({ ...this.load(), ...c }, null, 2)); }
};
const saved = store.load();
const dbConfig = process.env.DB_HOST ? {
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'maluti_erp'
} : saved.db;

start({
  port: Number(process.env.PORT || saved.port || 8069),
  dbConfig, configStore: store,
  pluginDirs: [path.join(__dirname, '..', 'plugins'), process.env.PLUGIN_DIR].filter(Boolean)
}).then(({ port }) => console.log(`Maluti ERP running on http://localhost:${port}`))
  .catch(e => { console.error(e); process.exit(1); });
