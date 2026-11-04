/**
 * Maluti ERP server. Used by the desktop app (Electron) and by `npm run server` (headless / LAN server).
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

async function start({ port = 8069, host = '0.0.0.0', dbConfig, configStore, embeddedDb = null, pluginDirs = [], publicDir } = {}) {
  const app = express();
  app.locals.configStore = configStore || null;
  app.locals.embeddedDb = embeddedDb;
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
  app.use('/api', require('./routes/attendance').pub);
  // list of business types for the first-run setup screen (no login yet)
  app.get('/api/business-types', (req, res) => res.json(require('./services/modules').TYPES.map(({ key, name, icon, desc }) => ({ key, name, icon, desc }))));
  app.use('/api', (req, res, next) => db.isConnected() ? next() : next(new HttpError(503, 'Database not configured')));
  app.use('/api', auth.requireAuth);
  app.use('/api', admin.priv);
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
  app.use('/api', require('./routes/importer'));
  app.use('/api', require('./routes/master'));
  app.use('/api', require('./routes/business'));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(require('./routes/public-receipt'));
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
      console.log(`[db] connected to ${dbConfig.host}/${dbConfig.database}`);
    } catch (e) {
      console.error('[db] connection failed:', e.message);
    }
  }

  const server = await new Promise((resolve, reject) => {
    const s = app.listen(port, host, () => { app.locals.port = s.address().port; resolve(s); });
    s.on('error', reject);
  });
  require('./services/qr').setPort(server.address().port);
  return { app, server, port: server.address().port };
}

module.exports = { start };
