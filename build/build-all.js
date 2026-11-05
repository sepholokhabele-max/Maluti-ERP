// Builds everything for a release into dist/release/<version>/:
//   S-ERP-<v>-Windows-64bit.zip   portable app + built-in MySQL 8 (unzip and run)
//   S-ERP-<v>-Windows-32bit.zip   portable app for 32-bit Windows (connects to MySQL / a main PC)
//   S-ERP-Setup-<v>-x64.exe / -ia32.exe   installers
//   app-<v>.asar + update.json         small online update used by the app's updater
// Usage: node build/build-all.js [x64] [ia32]      (default both)
// The 64-bit build bundles vendor/mysql-win64 (bin/mysqld.exe, share/, VC++ runtime DLLs) when present.
const { build, Platform, Arch } = require('electron-builder');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const version = pkg.version;
const arches = process.argv.slice(2).filter(a => ['x64', 'ia32'].includes(a));
if (!arches.length) arches.push('x64', 'ia32');
const rel = path.join(root, 'dist', 'release', version);
fs.mkdirSync(rel, { recursive: true });
const mysqlDir = path.join(root, 'vendor', 'mysql-win64');
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function zipDir(srcParent, name, out, extra = []) {
  if (fs.existsSync(out)) fs.unlinkSync(out);
  if (process.platform === 'win32') execFileSync('7z', ['a', '-tzip', '-mx=9', '-bd', out, name, ...extra], { cwd: srcParent, stdio: 'ignore' });
  else execFileSync('zip', ['-qr', '-9', out, name, ...extra], { cwd: srcParent, stdio: 'inherit' });
}

(async () => {
  for (const arch of arches) {
    const withDb = arch === 'x64' && fs.existsSync(path.join(mysqlDir, 'bin', 'mysqld.exe'));
    console.log(`\n=== ${arch} ${withDb ? '(with built-in MySQL)' : '(no built-in MySQL)'} ===`);
    const config = { ...pkg.build, extraResources: [...pkg.build.extraResources, ...(withDb ? [{ from: 'vendor/mysql-win64', to: 'mysql' }] : [])],
      win: { ...pkg.build.win, target: [{ target: 'dir', arch: [arch] }] } };
    await build({ targets: Platform.WINDOWS.createTarget('dir', arch === 'x64' ? Arch.x64 : Arch.ia32), config, publish: 'never' });
    const unpacked = path.join(root, 'dist', arch === 'x64' ? 'win-unpacked' : 'win-ia32-unpacked');

    // installer
    execFileSync('node', [path.join(__dirname, 'make-installer.js'), arch, withDb ? 'db' : 'nodb'], { stdio: 'inherit' });

    // portable zip: "Maluti ERP" folder + README + shortcut helper
    const stage = path.join(root, 'dist', `portable-${arch}`);
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    fs.cpSync(unpacked, path.join(stage, 'Maluti ERP'), { recursive: true });
    const bits = arch === 'x64' ? '64-bit' : '32-bit';
    fs.writeFileSync(path.join(stage, 'README.txt'), [
      `S-ERP ${version} – Windows ${bits}`, '',
      '1. Unzip this folder anywhere you like (e.g. C:\\S-ERP or your Desktop). Do not run it from inside the zip.',
      '2. Open the "Maluti ERP" folder and double-click "Maluti ERP.exe".',
      '   Optional: double-click "Create shortcuts.cmd" for a desktop and Start-menu shortcut.',
      withDb ? '3. On first start choose "Use the built-in database". MySQL 8 is included – nothing else to install.\n   Your data is kept in %APPDATA%\\Maluti ERP\\mysql-data and backed up daily to %APPDATA%\\Maluti ERP\\backups.'
        : '3. On first start connect to your MySQL/MariaDB server, or (for an extra till) enter the address of the main\n   S-ERP computer, e.g. http://192.168.1.10:8069. MySQL 8 does not run on 32-bit Windows, so the built-in\n   database is only in the 64-bit edition.',
      '', 'Updates: Settings → Updates & backup (downloads new versions from GitHub).',
      'Prefer an installer? Use S-ERP-Setup-' + version + '-' + arch + '.exe instead.', ''
    ].join('\r\n'));
    fs.writeFileSync(path.join(stage, 'Create shortcuts.cmd'), [
      '@echo off',
      'set "APP=%~dp0Maluti ERP\\Maluti ERP.exe"',
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=New-Object -ComObject WScript.Shell;' +
      ' foreach($d in @([Environment]::GetFolderPath(\'Desktop\'), (Join-Path $env:APPDATA \'Microsoft\\Windows\\Start Menu\\Programs\'))){' +
      ' $l=$s.CreateShortcut((Join-Path $d \'S-ERP.lnk\')); $l.TargetPath=$env:APP; $l.WorkingDirectory=(Split-Path $env:APP); $l.Save() }"',
      'echo Shortcuts created on the Desktop and in the Start menu.',
      'pause', ''
    ].join('\r\n'));
    const zipName = `S-ERP-${version}-Windows-${bits.replace('-', '')}.zip`;
    zipDir(stage, '.', path.join(rel, zipName));
    fs.copyFileSync(path.join(root, 'dist', `S-ERP-Setup-${version}-${arch}.exe`), path.join(rel, `S-ERP-Setup-${version}-${arch}.exe`));

    if (arch === 'x64' || !fs.existsSync(path.join(rel, `app-${version}.asar`))) fs.copyFileSync(path.join(unpacked, 'resources', 'app.asar'), path.join(rel, `app-${version}.asar`));
  }

  // update manifest for the in-app updater
  const asar = path.join(rel, `app-${version}.asar`);
  const manifest = { version, electron: require('electron/package.json').version, asar: path.basename(asar), sha256: sha(asar),
    installers: { x64: `S-ERP-Setup-${version}-x64.exe`, ia32: `S-ERP-Setup-${version}-ia32.exe` }, built_at: new Date().toISOString() };
  fs.writeFileSync(path.join(rel, 'update.json'), JSON.stringify(manifest, null, 2));
  const sums = fs.readdirSync(rel).filter(f => f !== 'SHA256SUMS.txt').map(f => `${sha(path.join(rel, f))}  ${f}`).join('\n') + '\n';
  fs.writeFileSync(path.join(rel, 'SHA256SUMS.txt'), sums);
  console.log('\nRelease files in', rel); console.log(sums);
})().catch(e => { console.error(e); process.exit(1); });
