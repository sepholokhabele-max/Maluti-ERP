const mysql = require('mysql2/promise');
const migrations = require('./schema');

let pool = null;

async function connect(cfg) {
  if (pool) { try { await pool.end(); } catch (_) {} pool = null; }
  // Create the database if it does not exist yet
  const bootstrap = await mysql.createConnection({
    host: cfg.host, port: cfg.port || 3306, user: cfg.user, password: cfg.password
  });
  await bootstrap.query(
    `CREATE DATABASE IF NOT EXISTS \`${cfg.database.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await bootstrap.end();

  pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port || 3306,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    waitForConnections: true,
    connectionLimit: 15,
    decimalNumbers: true,
    dateStrings: true,
    timezone: 'local'
  });
  await pool.query('SELECT 1');
  return pool;
}

function getPool() {
  if (!pool) throw Object.assign(new Error('Database not connected'), { status: 503 });
  return pool;
}

async function query(sql, params) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

async function one(sql, params) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

/** Run fn(conn) inside a transaction. conn exposes query/one helpers too. */
async function tx(fn) {
  const conn = await getPool().getConnection();
  const helper = {
    async query(sql, params) { const [r] = await conn.query(sql, params); return r; },
    async one(sql, params) { const [r] = await conn.query(sql, params); return r[0] || null; },
    raw: conn
  };
  try {
    await conn.beginTransaction();
    const result = await fn(helper);
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function migrate() {
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT PRIMARY KEY, name VARCHAR(100), applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
  const done = new Set((await query('SELECT id FROM schema_migrations')).map(r => r.id));
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    for (const stmt of m.sql) { if (typeof stmt === 'function') await stmt({ query, one }); else await query(stmt); }
    await query('INSERT INTO schema_migrations (id, name) VALUES (?, ?)', [m.id, m.name]);
    console.log(`[db] applied migration ${m.id} ${m.name}`);
  }
}

// ---- settings helpers ----
async function getSetting(k, def = null) {
  const r = await one('SELECT v FROM settings WHERE k = ?', [k]);
  if (!r || r.v === null) return def;
  return typeof r.v === 'string' ? JSON.parse(r.v) : r.v;
}
async function setSetting(k, v) {
  await query('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [k, JSON.stringify(v)]);
}

module.exports = { connect, getPool, query, one, tx, migrate, getSetting, setSetting, isConnected: () => !!pool };
