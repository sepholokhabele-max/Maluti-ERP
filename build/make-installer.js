// Builds dist/MalutiERP-Setup-<version>.exe from dist/win-unpacked using build/installer.nsi (plain NSIS).
// Needs makensis: Windows `choco install nsis` (or nsis.sourceforge.io), Linux `apt install nsis`.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
// node build/make-installer.js [x64|ia32] [db|nodb]
const arch = process.argv[2] || 'x64';
const withDb = (process.argv[3] || (arch === 'x64' ? 'db' : 'nodb')) === 'db';
const src = path.join(root, 'dist', arch === 'ia32' ? 'win-ia32-unpacked' : 'win-unpacked');
if (!fs.existsSync(path.join(src, 'Maluti ERP.exe'))) { console.error(`${src} not found – run electron-builder for ${arch} first`); process.exit(1); }

const candidates = [
  process.env.MAKENSIS,
  'makensis',
  'C:\\Program Files (x86)\\NSIS\\makensis.exe',
  'C:\\Program Files\\NSIS\\makensis.exe',
  path.join(os.homedir(), '.cache/electron-builder/nsis/nsis-3.0.4.1/linux/makensis'),
  path.join(process.env.LOCALAPPDATA || '', 'electron-builder/Cache/nsis/nsis-3.0.4.1/Bin/makensis.exe')
].filter(Boolean);

let makensis = null, env = { ...process.env };
for (const c of candidates) {
  try {
    const e = { ...process.env };
    if (c.includes('electron-builder') && c.includes('linux')) e.NSISDIR = path.resolve(path.dirname(c), '..');
    execFileSync(c, ['-VERSION'], { stdio: 'ignore', env: e });
    makensis = c; env = e; break;
  } catch (_) {}
}
if (!makensis) { console.error('makensis not found. Install NSIS (Windows: choco install nsis, Linux: apt install nsis) or set MAKENSIS.'); process.exit(1); }

const out = path.join(root, 'dist', `MalutiERP-Setup-${version}-${arch}.exe`);
const dbText = withDb && fs.existsSync(path.join(src, 'resources', 'mysql', 'bin', 'mysqld.exe'))
  ? 'A MySQL 8 database is built in - nothing else to install. You can also connect to your own MySQL server.'
  : 'You will need a MySQL (or MariaDB) server, or another computer running Maluti ERP to connect to.';
console.log(`Building ${path.basename(out)} with ${makensis} …`);
execFileSync(makensis, ['-V2', `-DVERSION=${version}`, `-DSRCDIR=${src}`, `-DOUTFILE=${out}`, `-DARCHNAME=${arch === 'ia32' ? '32-bit' : '64-bit'}`, `-DDBTEXT=${dbText}`, path.join(__dirname, 'installer.nsi')],
  { stdio: 'inherit', env, cwd: __dirname });
console.log('Done:', out, (fs.statSync(out).size / 1048576).toFixed(1) + ' MB');
