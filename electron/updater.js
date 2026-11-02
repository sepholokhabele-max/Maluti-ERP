// Online updates from GitHub Releases.
// A release (tag vX.Y.Z) carries:
//   update.json            { version, electron, asar, sha256, installers: { x64, ia32 } }
//   app-X.Y.Z.asar         the application code (small: swapped in place, no reinstall)
//   MalutiERP-Setup-X.Y.Z-x64.exe / -ia32.exe   full installers (used when the Electron shell changed)
const { app, net } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const cmpVer = (a, b) => { const x = String(a).replace(/^v/, '').split('.').map(Number), y = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };

class Updater {
  constructor({ store, log = console.log }) {
    this.store = store; this.log = log;
    this.dir = path.join(app.getPath('userData'), 'updates');
    this.state = { status: 'idle' };
  }
  settings() { return { repo: 'sepholokhabele-max/Maluti-ERP', auto_check: true, token: '', ...(this.store.load().updates || {}) }; }
  save(s) {
    const cur = this.settings();
    const repo = String(s.repo ?? cur.repo).trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
    if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Repository must look like owner/name, e.g. sepholo/maluti-erp');
    this.store.save({ updates: { ...cur, ...s, repo } });
    return this.publicSettings();
  }
  publicSettings() { const s = this.settings(); return { repo: s.repo, auto_check: !!s.auto_check, has_token: !!s.token, current: app.getVersion(), arch: process.arch, state: this.state }; }

  headers(extra = {}) {
    const s = this.settings();
    return { 'User-Agent': 'MalutiERP-Updater', Accept: 'application/vnd.github+json', ...(s.token ? { Authorization: `Bearer ${s.token}` } : {}), ...extra };
  }
  // public repos: plain download link; private repos (token): API asset link
  assetUrl(a) { return this.settings().token ? a.url : a.browser_download_url; }
  async getJson(url) {
    const r = await net.fetch(url, { headers: this.headers() });
    if (r.status === 404) throw new Error('No release found. Check the repository name (and that it has a published release).');
    if (!r.ok) throw new Error(`GitHub answered ${r.status} ${r.statusText}`);
    return r.json();
  }

  /** Look for a newer release. Resolves { available, version, notes, mode } */
  async check() {
    const s = this.settings();
    if (!s.repo) throw new Error('Set the GitHub repository first (Settings → Updates).');
    this.state = { status: 'checking' };
    try {
      const rel = await this.getJson(`https://api.github.com/repos/${s.repo}/releases/latest`);
      const version = String(rel.tag_name || '').replace(/^v/, '');
      const asset = name => (rel.assets || []).find(a => a.name === name);
      const manifestAsset = asset('update.json');
      let manifest = null;
      if (manifestAsset) manifest = await (await net.fetch(this.assetUrl(manifestAsset), { headers: this.headers({ Accept: 'application/octet-stream' }) })).json();
      const newer = cmpVer(version, app.getVersion()) > 0;
      // the small code-only update works when the release was built on the same Electron major version
      const sameShell = manifest && String(manifest.electron || '').split('.')[0] === process.versions.electron.split('.')[0];
      const asarAsset = manifest && asset(manifest.asar);
      const instName = manifest && manifest.installers && manifest.installers[process.arch];
      const instAsset = (instName && asset(instName)) || (rel.assets || []).find(a => a.name.endsWith(`-${process.arch}.exe`));
      const mode = sameShell && asarAsset && app.isPackaged ? 'asar' : instAsset ? 'installer' : null;
      this.release = { version, manifest, asarAsset, instAsset, mode, notes: rel.body || '', published: rel.published_at, url: rel.html_url };
      this.state = { status: newer ? (mode ? 'available' : 'no-asset') : 'up-to-date', version, notes: rel.body || '', published: rel.published_at, mode, url: rel.html_url,
        size: mode === 'asar' ? asarAsset.size : instAsset ? instAsset.size : null, checked_at: new Date().toISOString() };
      return this.state;
    } catch (e) { this.state = { status: 'error', error: e.message }; throw e; }
  }

  async download(asset, file, onProgress) {
    fs.mkdirSync(this.dir, { recursive: true });
    const r = await net.fetch(this.assetUrl(asset), { headers: this.headers({ Accept: 'application/octet-stream' }) });
    if (!r.ok) throw new Error(`Download failed: ${r.status}`);
    const total = Number(r.headers.get('content-length')) || asset.size || 0;
    const tmp = file + '.part';
    const out = fs.createWriteStream(tmp);
    const hash = crypto.createHash('sha256');
    let got = 0;
    const reader = r.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      hash.update(buf); got += buf.length;
      if (!out.write(buf)) await new Promise(res => out.once('drain', res));
      if (onProgress) onProgress(total ? Math.round(got / total * 100) : null);
    }
    await new Promise(res => out.end(res));
    fs.renameSync(tmp, file);
    return hash.digest('hex');
  }

  /** Download the update and restart into it. Returns after scheduling the restart. */
  async apply(onProgress, quit) {
    if (!this.release || cmpVer(this.release.version, app.getVersion()) <= 0) await this.check();
    const R = this.release;
    if (!R || cmpVer(R.version, app.getVersion()) <= 0) throw new Error('Already up to date');
    this.state = { ...this.state, status: 'downloading', progress: 0 };
    const prog = p => { this.state.progress = p; onProgress && onProgress(p); };
    if (R.mode === 'asar') {
      const file = path.join(this.dir, `app-${R.version}.asar`);
      const sha = await this.download(R.asarAsset, file, prog);
      if (R.manifest.sha256 && sha !== String(R.manifest.sha256).toLowerCase()) { fs.unlinkSync(file); throw new Error('The downloaded update is damaged (checksum mismatch). Try again.'); }
      const target = path.join(process.resourcesPath, 'app.asar');
      try { fs.accessSync(path.dirname(target), fs.constants.W_OK); } catch (_) { throw new Error('Maluti ERP is installed in a protected folder. Download the full installer from the release page instead.'); }
      // a small script waits for the app to close, swaps the code file and starts the app again
      const script = path.join(this.dir, 'apply-update.cmd');
      fs.writeFileSync(script, [
        '@echo off',
        ':wait',
        `tasklist /FI "PID eq ${process.pid}" 2>nul | find "${process.pid}" >nul && (ping -n 2 127.0.0.1 >nul & goto wait)`,
        `copy /y "${target}" "${target}.bak" >nul`,
        `copy /y "${file}" "${target}" >nul || (copy /y "${target}.bak" "${target}" >nul)`,
        `start "" "${process.execPath}"`,
        ''
      ].join('\r\n'));
      this.log('[update] restarting into', R.version);
      spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      this.state = { ...this.state, status: 'restarting' };
      setTimeout(quit, 500);
      return { restarting: true, version: R.version };
    }
    if (R.mode === 'installer') {
      const file = path.join(this.dir, R.instAsset.name);
      await this.download(R.instAsset, file, prog);
      spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
      this.state = { ...this.state, status: 'installer-started' };
      setTimeout(quit, 1500);
      return { installer: true, version: R.version };
    }
    throw new Error('This release has no update file for this computer (' + process.arch + ').');
  }
}

module.exports = { Updater, cmpVer };
