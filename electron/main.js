// Electron shell: starts the embedded server and opens the app window.
const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const userData = app.getPath('userData');
const cfgFile = path.join(userData, 'config.json');
const userPlugins = path.join(userData, 'plugins');
fs.mkdirSync(userPlugins, { recursive: true });

const store = {
  load() { try { return JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch (_) { return {}; } },
  save(c) { fs.writeFileSync(cfgFile, JSON.stringify({ ...this.load(), ...c }, null, 2)); }
};

// Log to a file so problems on customer PCs can be diagnosed
const logFile = path.join(userData, 'maluti.log');
const logStream = fs.createWriteStream(logFile, { flags: 'a' });
for (const lvl of ['log', 'error', 'warn']) {
  const orig = console[lvl];
  console[lvl] = (...a) => { orig(...a); logStream.write(`[${new Date().toISOString()}] ${lvl}: ${a.map(String).join(' ')}\n`); };
}

let win = null;
let baseUrl = null;

// Built-in MySQL (bundled in resources/mysql on 64-bit Windows builds)
const { EmbeddedMySQL } = require('./embedded-mysql');
const mysqlBase = app.isPackaged ? path.join(process.resourcesPath, 'mysql') : path.join(__dirname, '..', 'vendor', process.platform === 'win32' ? 'mysql-win64' : 'mysql-none');
const embedded = new EmbeddedMySQL({ baseDir: mysqlBase, dataDir: path.join(userData, 'mysql-data'), store, log: (...a) => console.log(...a) });
const backupDir = path.join(userData, 'backups');
const { Updater } = require('./updater');
const updater = new Updater({ store, log: (...a) => console.log(...a) });

async function backupNow() {
  fs.mkdirSync(backupDir, { recursive: true });
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  const file = path.join(backupDir, `maluti-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.sql`);
  await embedded.backup(file);
  // keep the 14 newest
  const old = fs.readdirSync(backupDir).filter(f => /^maluti-.*\.sql$/.test(f)).sort().reverse().slice(14);
  for (const f of old) { try { fs.unlinkSync(path.join(backupDir, f)); } catch (_) {} }
  console.log('[backup] saved', file);
  return file;
}
function scheduleBackups() {
  const last = () => { try { return fs.readdirSync(backupDir).filter(f => f.endsWith('.sql')).map(f => fs.statSync(path.join(backupDir, f)).mtimeMs).sort().pop() || 0; } catch (_) { return 0; } };
  const tick = () => { if (Date.now() - last() > 20 * 3600 * 1000) backupNow().catch(e => console.error('[backup]', e.message)); };
  setTimeout(tick, 5 * 60 * 1000); setInterval(tick, 60 * 60 * 1000);
}

const bundledPlugins = app.isPackaged ? path.join(process.resourcesPath, 'plugins') : path.join(__dirname, '..', 'plugins');

async function startServer() {
  const cfg = store.load();
  if (cfg.remote_url) { baseUrl = cfg.remote_url.replace(/\/$/, ''); return; }
  const { start } = require('../server/app');
  let dbConfig = cfg.db;
  if (cfg.db && cfg.db.embedded) {
    try { dbConfig = await embedded.start(); store.save({ db: dbConfig }); scheduleBackups(); }
    catch (e) { console.error('[mysql]', e.message); dialog.showErrorBox('Built-in database did not start', e.message + `\n\nDetails: ${path.join(userData, 'mysqld.err')}`); }
  }
  const embeddedDb = embedded.available() ? {
    start: async () => { const c = await embedded.start(); scheduleBackups(); return c; },
    backup: backupNow, running: () => !!(store.load().db || {}).embedded
  } : null;
  const opts = { dbConfig, configStore: store, embeddedDb, pluginDirs: [bundledPlugins, userPlugins], publicDir: path.join(__dirname, '..', 'public') };
  let result;
  try {
    result = await start({ ...opts, port: Number(cfg.port || 8069), host: cfg.lan_access === false ? '127.0.0.1' : '0.0.0.0' });
  } catch (e) {
    if (e.code !== 'EADDRINUSE') throw e;
    result = await start({ ...opts, port: 0, host: '127.0.0.1' });
  }
  baseUrl = `http://localhost:${result.port}`;
  console.log('Server listening on', baseUrl);
}

// Web Serial (scales): grant access and pick the port without a browser prompt where possible
function setupSerial(ses) {
  const allowed = new Set(['serial', 'clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'notifications']);
  ses.setPermissionCheckHandler((wc, permission) => allowed.has(permission));
  ses.setDevicePermissionHandler(details => details.deviceType === 'serial');
  ses.on('select-serial-port', (event, portList, webContents, callback) => {
    event.preventDefault();
    const pref = store.load().scale_port;
    const pick = portList.find(p => pref && (p.portName === pref || p.displayName === pref)) || portList[0];
    if (pick) store.save({ scale_port: pick.portName || pick.displayName });
    callback(pick ? pick.portId : '');
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1366, height: 860, minWidth: 1024, minHeight: 680, title: 'Maluti ERP',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  setupSerial(win.webContents.session);
  win.loadURL(baseUrl);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(baseUrl) || url.startsWith('blob:')) return { action: 'allow' }; // attachments open in a window
    shell.openExternal(url); return { action: 'deny' };
  });
}

function buildMenu() {
  const tpl = [
    { label: 'File', submenu: [
      { label: 'Open in web browser', click: () => shell.openExternal(baseUrl) },
      { label: 'Open plugins folder', click: () => shell.openPath(userPlugins) },
      { label: 'Open log file', click: () => shell.openPath(logFile) },
      { label: 'Check for updates…', click: () => win && win.loadURL(baseUrl + '/#/settings?tab=updates') },
      ...((store.load().db || {}).embedded ? [
        { label: 'Back up database now', click: async () => { try { const f = await backupNow(); dialog.showMessageBox(win, { message: 'Backup saved', detail: f }); } catch (e) { dialog.showErrorBox('Backup failed', e.message); } } },
        { label: 'Open backups folder', click: () => { fs.mkdirSync(backupDir, { recursive: true }); shell.openPath(backupDir); } }] : []),
      { type: 'separator' },
      { label: 'Reset connection settings…', click: async () => {
        const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Cancel', 'Reset'], defaultId: 0,
          message: 'Forget the database / server connection and show the setup screen on next start? Your data in MySQL is not touched.' });
        if (r.response === 1) { const c = store.load(); delete c.db; delete c.remote_url; fs.writeFileSync(cfgFile, JSON.stringify(c, null, 2)); app.relaunch(); app.exit(0); }
      } },
      { type: 'separator' }, { role: 'quit' }
    ] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'toggleDevTools' }] },
    { label: 'Help', submenu: [{ label: 'About Maluti ERP', click: () => dialog.showMessageBox(win, { message: `Maluti ERP v${app.getVersion()}\nServer: ${baseUrl}\nData folder: ${userData}` }) }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

ipcMain.handle('maluti:update-settings', (e, s) => s ? updater.save(s) : updater.publicSettings());
ipcMain.handle('maluti:update-check', async () => { try { return await updater.check(); } catch (err) { return { status: 'error', error: err.message }; } });
ipcMain.handle('maluti:update-apply', async () => {
  try { return await updater.apply(p => { if (win) win.webContents.send('maluti:update-progress', p); }, () => { app.quit(); setTimeout(() => app.exit(0), 4000); }); }
  catch (err) { return { error: err.message }; }
});
ipcMain.handle('maluti:info', () => ({ desktop: true, version: app.getVersion(), arch: process.arch, baseUrl, remote: !!store.load().remote_url, embedded_db: !!(store.load().db || {}).embedded }));
ipcMain.handle('maluti:set-remote', (e, url) => {
  store.save({ remote_url: url || undefined });
  app.relaunch(); app.exit(0);
});
ipcMain.handle('maluti:print-silent', (e, html) => new Promise(resolve => {
  // print receipt HTML to the default printer without dialog
  const pw = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  pw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  pw.webContents.on('did-finish-load', () => pw.webContents.print({ silent: true, printBackground: false }, ok => { pw.close(); resolve(ok); }));
}));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    try { await startServer(); }
    catch (e) { dialog.showErrorBox('Maluti ERP failed to start', e.stack || String(e)); app.quit(); return; }
    buildMenu();
    createWindow();
    // quiet update check shortly after start
    const us = updater.settings();
    if (us.repo && us.auto_check) setTimeout(() => updater.check().then(st => { if (st.status === 'available' && win) win.webContents.send('maluti:update-available', st); }).catch(e => console.log('[update]', e.message)), 15000);
  });
  app.on('window-all-closed', () => app.quit());
  // stop the built-in MySQL cleanly before quitting
  let stopping = false;
  app.on('before-quit', e => {
    if (stopping || !embedded.proc || embedded.exited !== null) return;
    e.preventDefault(); stopping = true;
    embedded.stop().catch(() => {}).finally(() => app.quit());
  });
}
