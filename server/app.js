/**
 * S-ERP server. Used by the desktop app (Electron) and by `npm run server` (headless / LAN server).
 *
 * start({ port, host, dbConfig, configStore, pluginDirs, publicDir }) -> { server, port }
 */
const path = require('path');
const express = require('express');
const db = require('./db');
const auth = require('./auth');
const plugins = require('./services/plugins');
const mailer = require('./services/mailer');
const admin = require('./routes/admin');
const { HttpError } = require('./util');

/**
 * mode: 'desktop' (the app on one PC), 'office' (the desktop app serving the office), 'server' (server edition), 'docker'
 * tls: { cert, key } or { pfx, passphrase } (file contents) – serve HTTPS directly; httpRedirectPort: also answer on http and send people to https
 */
async function start({ port = 8069, host = '0.0.0.0', dbConfig, configStore, embeddedDb = null, pluginDirs = [], publicDir, mode = null, tls = null, httpRedirectPort = null, backups = false } = {}) {
  const app = express();
  app.locals.configStore = configStore || null;
  app.locals.embeddedDb = embeddedDb;
  // hosted behind a reverse proxy (nginx / Caddy / a cloud load balancer): real client IPs and https links
  // By default only a proxy or secure tunnel on this same machine (Caddy, IIS, cloudflared) is believed about the visitor's address,
  // so people coming in through it are treated as "away from the office".
  app.set('trust proxy', process.env.TRUST_PROXY ? (/^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY) : 'loopback');
  app.locals.mode = mode || process.env.MALUTI_MODE || 'server'; app.locals.https = !!tls; app.locals.backups = !!(backups || embeddedDb);
  app.disable('x-powered-by');
  // browser security headers (safe for the desktop window too)
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (!req.path.startsWith('/api/collect')) res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  });
  app.use(express.json({ limit: '12mb' }));

  // Allow other tills/tablets on the LAN to use the browser UI against this server
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use('/api', admin.pub);
  app.use('/api', require('./routes/i18n').pub);
  app.use('/api', require('./routes/attendance').pub);
  // list of business types for the first-run setup screen (no login yet)
  app.get('/api/entity-types', (req, res) => res.json(require('./services/entity').ENTITY_TYPES));
  app.get('/api/business-types', (req, res) => { const M = require('./services/modules'); const names = Object.fromEntries(M.MODULES.map(m => [m.key, m.name]));
    res.json(M.TYPES.map(({ key, name, icon, desc, modules }) => ({ key, name, icon, desc, apps: (modules || []).map(k => names[k]).filter(Boolean) }))); });
  app.use('/api/collect/v1', require('./routes/paypartners').pub); // payment partners' collections API: own API-key auth, before login
  app.use('/api', (req, res, next) => db.isConnected() ? next() : next(new HttpError(503, 'Database not configured')));
  app.use('/api', auth.requireAuth);
  // activity log: every change made through the API (who, what, when, from where, result) – passwords never stored
  app.use('/api', (req, res, next) => {
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return next();
    res.on('finish', () => {
      const body = req.body && typeof req.body === 'object' ? Object.fromEntries(Object.entries(req.body).filter(([k]) => !/pass|pin|token|secret|key|data_url|otp/i.test(k)).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 120) : (Array.isArray(v) ? `[${v.length} items]` : v)])) : null;
      db.query(`INSERT INTO audit_log (user_id, action, entity, details, ip) VALUES (?, ?, ?, ?, ?)`, [req.user ? req.user.id : null, `api.${req.method.toLowerCase()}`, req.path.split('/')[1] || null,
        JSON.stringify({ path: req.path.slice(0, 160), status: res.statusCode, body: body && JSON.stringify(body).length < 2000 ? body : '(large)' }), String(req.ip || '').slice(0, 64)]).catch(() => {});
    });
    next();
  });
  app.use('/api', admin.priv);
  app.use('/api', require('./routes/security'));
  app.use('/api', require('./routes/lekuka'));
  app.use('/api', require('./routes/mywallet'));
  // POS: kitchen staff only reach the kitchen display endpoints
  app.use('/api/pos', (req, res, next) => {
    if (req.path.startsWith('/kitchen')) return next();
    if (auth.can(req.user, 'pos') || (req.method === 'GET' && auth.can(req.user, 'reports'))) return next();
    next(new HttpError(403, 'No POS access'));
  }, require('./routes/pos'));
  app.use('/api/vas', require('./routes/vas'));
  app.use('/api/recon', require('./routes/recon'));
  app.use('/api/crm', require('./routes/crm'));
  app.use('/api/hrm', require('./routes/hrm'));
  app.use('/api/butchery', require('./routes/butchery'));
  app.use('/api/bar', require('./routes/bar'));
  app.use('/api', require('./routes/sales'));
  app.use('/api', require('./routes/finance').router);
  app.use('/api', require('./routes/attendance').router);
  app.use('/api', require('./routes/locations'));
  app.use('/api', require('./routes/mrp'));
  app.use('/api', require('./routes/operations'));
  app.use('/api', require('./routes/services'));
  app.use('/api', require('./routes/growth').router);
  app.use('/api', require('./routes/property').router);
  app.use('/api', require('./routes/school'));
  app.use('/api', require('./routes/sites'));
  app.use('/api', require('./routes/reminders').router);
  app.use('/api', require('./routes/rooms'));
  app.use('/api', require('./routes/fleet'));
  app.use('/api', require('./routes/hire'));
  app.use('/api', require('./routes/clinic'));
  app.use('/api', require('./routes/farm'));
  app.use('/api', require('./routes/campaigns').router);
  app.use('/api', require('./routes/recruit'));
  app.use('/api', require('./routes/activation'));
  app.use('/api', require('./routes/smartel'));
  app.use('/api', require('./routes/tax'));
  app.use('/api', require('./routes/water'));
  app.use('/api', require('./routes/paypartners').router);
  app.use('/api', require('./routes/procurement').router);
  app.use('/api', require('./routes/assets'));
  app.use('/api', require('./routes/fleetplus'));
  app.use('/api', require('./routes/financeplus'));
  app.use('/api', require('./routes/governance'));
  app.use('/api', require('./routes/portal').router);
  app.use('/api', require('./routes/i18n').router);
  app.use('/api', require('./routes/importer'));
  app.use('/api', require('./routes/master'));
  app.use('/api', require('./routes/business'));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(require('./routes/public-receipt'));
  app.use(require('./routes/portal').pub);
  app.use(require('./routes/procurement').pub); // supplier bid portal /s/<token> and public tender notices /tenders
  // service worker carries the app version so an update replaces the cached screens
  app.get('/sw.js', (req, res) => {
    const f = require('fs').readFileSync(path.join(publicDir || path.join(__dirname, '..', 'public'), 'sw.js'), 'utf8');
    res.type('application/javascript').set('Cache-Control', 'no-cache').send(f.replace('__VERSION__', require('../package.json').version));
  });
  app.use(express.static(publicDir || path.join(__dirname, '..', 'public')));

  // error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = err.status || 500;
    let msg = err.message || 'Server error';
    if (err.code === 'ER_DUP_ENTRY') { status = 400; msg = 'A record with that value already exists (' + (msg.match(/'([^']+)'/) || [, ''])[1] + ')'; }
    if (err.code === 'ER_ROW_IS_REFERENCED_2') { status = 400; msg = 'This record is in use and cannot be deleted'; }
    if (status >= 500) console.error('[api]', req.method, req.originalUrl, err);
    res.status(status).json({ error: msg });
  });

  plugins.loadAll(pluginDirs);
  // RSL Lekuka e-invoicing: send waiting documents, ping, close fiscal days, renew the certificate (every minute)
  require('./services/lekuka').startScheduler();
  require('./services/mywallet').startScheduler();
  // seal new journal entries into the audit hash chain every two minutes (tamper evidence)
  setInterval(() => { if (db.isConnected()) require('./services/audit').seal().catch(e => console.error('[audit] seal:', e.message)); }, 120000).unref();

  if (dbConfig && dbConfig.host) {
    try {
      await db.connect(dbConfig);
      await db.migrate();
      await require('./services/stock').syncLocations(db).catch(e => console.error('[stock] location sync:', e.message));
      await mailer.schedule();
      // recurring contract invoices: shortly after start and then every hour
      const runContracts = () => require('./routes/property').escalate().catch(e => console.error('[rent]', e.message)).then(() => require('./routes/growth').runDue(null)).catch(e => console.error('[contracts]', e.message))
        .then(() => require('./routes/reminders').runAuto()).catch(e => console.error('[reminders]', e.message));
      setTimeout(runContracts, 20000); setInterval(runContracts, 3600000).unref();
      // scheduled SMS / email campaigns go out within five minutes of their time
      setInterval(() => require('./routes/campaigns').runScheduled().catch(e => console.error('[campaigns]', e.message)), 300000).unref();
      // Smartel POS backend: push sealed receipts, pull recalls / catalogue / prices / Thoki, heartbeats, unknown services
      require('./services/smartel').startScheduler();
      console.log(`[db] connected to ${dbConfig.host}/${dbConfig.database}`);
    } catch (e) {
      console.error('[db] connection failed:', e.message);
    }
  }

  const server = await new Promise((resolve, reject) => {
    const s = tls ? require('https').createServer(tls, app) : require('http').createServer(app);
    s.listen(port, host, () => { app.locals.port = s.address().port; resolve(s); });
    s.on('error', reject);
  });
  // with HTTPS, plain http on another port only sends people to the secure address
  if (tls && httpRedirectPort) {
    require('http').createServer((req, res) => { const h = String(req.headers.host || 'localhost').replace(/:\d+$/, ''); res.writeHead(301, { Location: `https://${h}${port === 443 ? '' : ':' + server.address().port}${req.url}` }); res.end(); })
      .listen(httpRedirectPort, host).on('error', e => console.error('[http→https]', e.message));
  }
  require('./services/qr').setPort(server.address().port);
  return { app, server, port: server.address().port };
}

module.exports = { start };
