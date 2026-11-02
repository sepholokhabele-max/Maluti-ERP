// Built-in MySQL: runs the MySQL server that ships with Maluti ERP (resources/mysql) as a child process,
// with its data in the user's data folder. No separate MySQL installation is needed.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');

const fwd = p => p.replace(/\\/g, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function portFree(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, host);
  });
}
function portOpen(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const c = net.connect(port, host);
    c.once('connect', () => { c.destroy(); resolve(true); });
    c.once('error', () => resolve(false));
    c.setTimeout(1000, () => { c.destroy(); resolve(false); });
  });
}

class EmbeddedMySQL {
  /**
   * @param {object} o
   * @param {string} o.baseDir   folder with bin/mysqld(.exe) and share/
   * @param {string} o.dataDir   where the databases live (created on first run)
   * @param {object} o.store     { load(), save(obj) } – persists ports & passwords
   * @param {function} [o.log]
   * @param {string[]} [o.initArgs]  override the initialise command (tests with other MySQL builds)
   */
  constructor({ baseDir, dataDir, store, log = console.log, initArgs, mysqld }) {
    this.baseDir = baseDir; this.dataDir = dataDir; this.store = store; this.log = log;
    this.mysqld = mysqld || path.join(baseDir, 'bin', process.platform === 'win32' ? 'mysqld.exe' : 'mysqld');
    this.initArgs = initArgs; this.proc = null; this.exited = null;
    this.iniFile = path.join(path.dirname(dataDir), 'mysql.ini');
    this.errLog = path.join(path.dirname(dataDir), 'mysqld.err');
  }

  available() { return fs.existsSync(this.mysqld); }
  initialised() { return fs.existsSync(path.join(this.dataDir, 'mysql')) || fs.existsSync(path.join(this.dataDir, 'mysql.ibd')); }
  settings() { return (this.store.load().embedded_mysql) || {}; }
  saveSettings(s) { this.store.save({ embedded_mysql: { ...this.settings(), ...s } }); }

  writeIni(port) {
    const ini = [
      '[mysqld]',
      `basedir="${fwd(this.baseDir)}"`,
      `datadir="${fwd(this.dataDir)}"`,
      `port=${port}`,
      'bind-address=127.0.0.1',
      'mysqlx=OFF',
      'skip-name-resolve',
      `log-error="${fwd(this.errLog)}"`,
      'character-set-server=utf8mb4',
      'innodb_buffer_pool_size=128M',
      'max_connections=150',
      'sql_mode=STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION',
      'performance_schema=OFF',
      ''
    ].join('\r\n');
    fs.mkdirSync(path.dirname(this.iniFile), { recursive: true });
    fs.writeFileSync(this.iniFile, ini);
  }

  run(args, { wait = true } = {}) {
    const p = spawn(this.mysqld, args, { cwd: path.dirname(this.mysqld), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; if (out.length > 20000) out = out.slice(-10000); });
    if (!wait) return { proc: p, output: () => out };
    return new Promise((resolve, reject) => {
      p.on('error', reject);
      p.on('exit', code => code === 0 ? resolve(out) : reject(new Error(`mysqld exited with code ${code}: ${out.slice(-1500)}`)));
    });
  }

  tail() { try { return fs.readFileSync(this.errLog, 'utf8').slice(-2000); } catch (_) { return ''; } }

  async pickPort() {
    const s = this.settings();
    if (s.port && await portFree(s.port)) return s.port;
    for (let p = 3307; p < 3330; p++) if (await portFree(p)) return p;
    throw new Error('No free port for the built-in MySQL (3307–3329 are all in use)');
  }

  /** Initialise (first time) and start the server. Returns a dbConfig for the app. */
  async start() {
    if (!this.available()) throw new Error('The built-in MySQL is not included in this copy of Maluti ERP');
    if (this.proc && this.exited === null) return this.dbConfig();
    const port = await this.pickPort();
    this.writeIni(port);
    let fresh = false;
    if (!this.initialised()) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      if (fs.readdirSync(this.dataDir).length) throw new Error(`The database folder ${this.dataDir} is not empty but has no MySQL data. Move it away and try again.`);
      this.log('[mysql] initialising data folder', this.dataDir);
      await this.run(this.initArgs || [`--defaults-file=${this.iniFile}`, '--initialize-insecure', '--console']);
      fresh = true;
    }
    this.log('[mysql] starting on port', port);
    const r = this.run(this.initArgs ? ['--defaults-file=' + this.iniFile] : [`--defaults-file=${this.iniFile}`, '--console'], { wait: false });
    this.proc = r.proc; this.exited = null;
    this.proc.on('exit', code => { this.exited = code; this.log('[mysql] server stopped', code); });
    const t0 = Date.now();
    while (!(await portOpen(port))) {
      if (this.exited !== null) throw new Error(`The built-in MySQL could not start (code ${this.exited}).\n${this.tail() || r.output().slice(-1500)}`);
      if (Date.now() - t0 > 90000) throw new Error('The built-in MySQL did not start within 90 seconds.\n' + this.tail());
      await sleep(300);
    }
    this.saveSettings({ port });
    if (fresh || !this.settings().password) await this.secure(port);
    return this.dbConfig();
  }

  async rootConn(port, password) {
    const mysql = require('mysql2/promise');
    return mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password: password || '', multipleStatements: true });
  }

  /** First run: give root a random password and create the app's own user and database */
  async secure(port) {
    const s = this.settings();
    const rootPw = s.root_password || crypto.randomBytes(18).toString('base64url');
    const appPw = s.password || crypto.randomBytes(18).toString('base64url');
    let c;
    try { c = await this.rootConn(port, ''); } catch (_) { c = await this.rootConn(port, s.root_password); }
    try {
      await c.query(`ALTER USER 'root'@'localhost' IDENTIFIED BY ${c.escape(rootPw)}`);
      await c.query('CREATE DATABASE IF NOT EXISTS maluti_erp CHARACTER SET utf8mb4');
      await c.query(`CREATE USER IF NOT EXISTS 'maluti'@'127.0.0.1' IDENTIFIED BY ${c.escape(appPw)}`);
      await c.query(`CREATE USER IF NOT EXISTS 'maluti'@'localhost' IDENTIFIED BY ${c.escape(appPw)}`);
      await c.query(`ALTER USER 'maluti'@'127.0.0.1' IDENTIFIED BY ${c.escape(appPw)}`);
      await c.query(`ALTER USER 'maluti'@'localhost' IDENTIFIED BY ${c.escape(appPw)}`);
      await c.query(`GRANT ALL PRIVILEGES ON maluti_erp.* TO 'maluti'@'127.0.0.1', 'maluti'@'localhost'`);
      await c.query('FLUSH PRIVILEGES');
    } finally { await c.end(); }
    this.saveSettings({ root_password: rootPw, password: appPw });
  }

  dbConfig() {
    const s = this.settings();
    return { host: '127.0.0.1', port: s.port, user: 'maluti', password: s.password, database: 'maluti_erp', embedded: true };
  }

  /** Clean shutdown (SHUTDOWN statement), falling back to killing the process */
  async stop() {
    if (!this.proc || this.exited !== null) return;
    const s = this.settings();
    try { const c = await this.rootConn(s.port, s.root_password); await c.query('SHUTDOWN').catch(() => {}); await c.end().catch(() => {}); } catch (_) {}
    const t0 = Date.now();
    while (this.exited === null && Date.now() - t0 < 20000) await sleep(200);
    if (this.exited === null) { this.log('[mysql] forcing stop'); this.proc.kill(); }
  }

  /** Make a .sql backup with the bundled mysqldump (Windows) */
  async backup(file) {
    const s = this.settings();
    const dump = path.join(this.baseDir, 'bin', process.platform === 'win32' ? 'mysqldump.exe' : 'mysqldump');
    if (!fs.existsSync(dump)) throw new Error('mysqldump is not included');
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(file);
      const p = spawn(dump, ['-h127.0.0.1', `-P${s.port}`, '-uroot', '--single-transaction', '--routines', '--databases', 'maluti_erp'],
        { windowsHide: true, env: { ...process.env, MYSQL_PWD: s.root_password } });
      let errOut = '';
      p.stdout.pipe(out); p.stderr.on('data', d => { errOut += d; });
      p.on('exit', code => code === 0 ? resolve() : reject(new Error('Backup failed: ' + errOut.slice(-500))));
    });
    return file;
  }
}

module.exports = { EmbeddedMySQL, portFree, portOpen };
