// "My account": password, two-step sign-in with an authenticator app, where I am signed in.
// Settings → Access & security: the two ways to run S-ERP, working from anywhere, the safety checklist, rules and all sessions.
import { state, GET, POST, PUT, esc, $, $$, toast, err, can, modal, confirmBox, promptBox, formHtml, readForm, tableHtml, badge, page, dt } from './core.js';

const METHOD = { password: 'password', '2fa': 'password + code', pin: 'PIN' };
const where = s => s.remote ? badge('away from the office', 'partial') : badge('office', 'ok');

/** the two-step set-up box: QR code to scan, the key to type, and the first code */
export function enrolHtml(x) {
  return `<div class="cols cols-2" style="align-items:center"><div class="qr-box" style="max-width:220px;background:#fff;padding:8px;border-radius:8px">${x.qr_svg}</div>
    <div><ol style="padding-left:18px;margin:0 0 10px"><li>Install an authenticator app on your phone (Microsoft Authenticator, Google Authenticator or Authy).</li><li>In the app, add an account and scan this code.</li><li>Type the 6-digit code the app shows.</li></ol>
    <p class="muted" style="font-size:12px">Can't scan? Enter this key in the app:<br><code style="word-break:break-all;user-select:all">${esc(x.secret)}</code></p>
    <label class="field"><span>6-digit code</span><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" style="font-size:22px;letter-spacing:6px;text-align:center"></label></div></div>`;
}

export async function account(view) {
  const me = await GET('/me/security');
  view.innerHTML = page('My account', '', `
    <div class="cols cols-2">
      <div class="card"><h3>Two-step sign-in</h3>
        <p>${me.two_factor ? `${badge('on', 'ok')} When you sign in with your password you also enter a code from the authenticator app on your phone.` : `${badge('off', 'draft')} Protect your account with a code from your phone as well as your password.`}</p>
        ${me.required ? `<p class="muted">Required for your role ${me.scope === 'remote' ? 'when you sign in from outside the office' : 'every time you sign in with a password'}.</p>` : ''}
        ${me.two_factor ? `<button class="btn" id="off" ${me.required ? 'disabled title="Required for your role"' : ''}>Switch off</button> <button class="btn" id="re">Move to a new phone</button>` : '<button class="btn btn-primary" id="on">Set up two-step sign-in</button>'}</div>
      <div class="card"><h3>Password</h3><button class="btn" id="pw">Change my password</button>
        <p class="muted" style="margin-top:10px">You are now ${me.in_office ? 'on the office network' : '<b>away from the office</b>'}.</p></div></div>
    <div class="card"><div class="row"><h3 style="margin:0">Where I am signed in</h3><span class="spacer"></span>${me.sessions.length > 1 ? '<button class="btn btn-sm" id="others">Sign out everywhere else</button>' : ''}</div>
      ${tableHtml([{ key: 'device', label: 'Device' }, { key: 'ip', label: 'Address' }, { key: 'remote', label: 'Where', html: 1, fmt: (v, s) => where(s) }, { key: 'method', label: 'Signed in with', fmt: v => METHOD[v] || v || '' },
        { key: 'started', label: 'Since', fmt: dt }, { key: 'last_seen', label: 'Last active', fmt: dt }, { key: 'id', label: '', html: 1, fmt: (v, s) => s.current ? '<b>this one</b>' : `<button class="btn btn-sm" data-end="${v}">Sign out</button>` }], me.sessions)}
      <p class="muted">Don't recognise one? Sign it out and change your password.</p></div>`);
  const enrol = async () => {
    const x = await POST('/me/2fa/start');
    modal({ title: 'Set up two-step sign-in', wide: true, body: enrolHtml(x), actions: [{ label: 'Cancel' }, { label: 'Switch on', cls: 'btn-primary', onClick: async (c, r) => {
      await POST('/me/2fa/enable', { ticket: x.ticket, code: r.querySelector('#code').value }); c(); toast('Two-step sign-in is on'); account(view); } }] });
  };
  if ($('#on')) $('#on').onclick = () => enrol().catch(err);
  if ($('#re')) $('#re').onclick = () => enrol().catch(err);
  if ($('#off')) $('#off').onclick = async () => { const p = await promptBox('Confirm with your password', { label: 'Password', type: 'password' }); if (!p) return; try { await POST('/me/2fa/disable', { password: p }); toast('Two-step sign-in is off'); account(view); } catch (e) { err(e); } };
  $('#pw').onclick = () => {
    const f = [{ key: 'current', label: 'Current password', type: 'password', required: true }, { key: 'password', label: 'New password (at least 6 characters)', type: 'password', required: true }];
    modal({ title: 'Change my password', body: formHtml(f, {}), actions: [{ label: 'Cancel' }, { label: 'Change', cls: 'btn-primary', onClick: async (c, r) => { await POST('/me/password', readForm(r, f)); c(); toast('Password changed'); } }] });
  };
  if ($('#others')) $('#others').onclick = async () => { try { const x = await POST('/me/sessions/end-others'); toast(`Signed out of ${x.ended} other session(s)`); account(view); } catch (e) { err(e); } };
  $$('[data-end]', view).forEach(b => b.onclick = async () => { try { await POST(`/me/sessions/${b.dataset.end}/end`); account(view); } catch (e) { err(e); } });
}

/* ---------------- Settings → Access & security ---------------- */
const MODES = { desktop: 'Desktop – this computer only', office: 'Office server (desktop app serving the office)', server: 'Server edition', docker: 'Server edition (Docker / cloud)' };
export async function accessTab(sb) {
  const x = await GET('/security'), s = x.settings, st = x.status;
  const desk = window.maluti && window.maluti.info ? await window.maluti.info().catch(() => null) : null;
  const office = desk && window.maluti.officeServer ? await window.maluti.officeServer().catch(() => null) : null;
  const ok = x.checks.filter(c => c.ok).length;
  sb.innerHTML = `
    <div class="card"><h3>How this S-ERP is running</h3>
      <div class="cols cols-3"><div><div class="muted">Set-up</div><b>${esc(MODES[st.mode] || st.mode)}</b></div><div><div class="muted">Version</div><b>${esc(st.version)}</b></div><div><div class="muted">You are</div><b>${st.you_are_in_office ? 'on the office network' : 'away from the office'}</b> <small class="muted">(${esc(st.your_address)})</small></div></div>
      ${st.lan.length ? `<p style="margin-top:10px">Other computers in the office open: ${st.lan.map(u => `<code style="user-select:all">${esc(u)}</code>`).join(' · ')}</p>` : ''}
      ${s.public_url ? `<p>From anywhere: <code style="user-select:all">${esc(s.public_url)}</code></p>` : ''}
      ${office ? `<div class="row" style="margin-top:10px;gap:10px;flex-wrap:wrap"><label class="check"><input type="checkbox" id="osrv" ${office.on ? 'checked' : ''}> <span><b>This computer is the office server</b> – start S-ERP with Windows and keep it running in the tray when the window is closed, so other computers can always connect.</span></label></div>` : ''}</div>

    <div class="cols cols-2">
      <div class="card"><h3>The two ways to run S-ERP</h3>
        <h4 style="margin:10px 0 4px">1 · Office server (desktop app)</h4>
        <p>Install S-ERP on one office PC, tick "This computer is the office server", and everyone else opens its address in Chrome or Edge. Built-in database with daily backups; nothing else to install.</p>
        <p class="muted">Best for: shops, restaurants, clinics, schools and small companies – one site, up to about 25 people, someone's PC that stays on during working hours.</p>
        <h4 style="margin:14px 0 4px">2 · Server edition</h4>
        <p>S-ERP runs on a server as a background service: it starts with Windows (or Linux / Docker), needs no one signed in, restarts itself, serves HTTPS with your certificate and can use your own MySQL server.</p>
        <p class="muted">Best for: companies with several branches or depots, parastatals and utilities, government bodies, anyone with an IT team or 25+ users – and anyone who wants staff to work from anywhere.</p>
        <p class="muted">Both use the same program, the same screens and the same data; you can move from 1 to 2 later by restoring a backup.</p></div>
      <div class="card"><h3>Working from anywhere</h3>
        <p><b>Private network (simplest, no open ports):</b> install a VPN such as Tailscale or WireGuard on the server and on staff laptops and phones; they then use the server's VPN address as if they were in the office.</p>
        <p><b>Secure tunnel (an https address, no router changes):</b> run Cloudflare Tunnel on the server PC and point a name such as <code>erp.yourcompany.co.ls</code> at S-ERP. Works for option 1 and 2.</p>
        <p><b>Your own domain and certificate (server edition):</b> give the server a public name, open port 443 on the firewall and load your certificate (or use Caddy / IIS in front).</p>
        <p class="muted">Whatever you choose, people coming in from outside are treated as "away from the office": the rules below apply to them.</p></div></div>

    <div class="card"><h3>Before staff work from outside: ${ok} of ${x.checks.length} done</h3>
      ${tableHtml([{ key: 'ok', label: '', html: 1, fmt: v => v ? '✅' : '⚠️' }, { key: 'label', label: 'Check' }, { key: 'fix', label: 'How to fix', fmt: (v, c) => c.ok ? '' : v }], x.checks)}</div>

    <div class="card"><h3>Rules</h3><div id="rules"></div><button class="btn btn-primary" id="sv" style="margin-top:12px">Save rules</button></div>

    <div class="card"><div class="row"><h3 style="margin:0">Who is signed in</h3><span class="spacer"></span><span class="muted">${st.remote_sessions} away from the office · ${st.failed_logins_24h} failed sign-ins in 24 h · ${st.users_2fa} of ${st.users} people use two-step sign-in${st.managers_without_2fa ? ` · <b>${st.managers_without_2fa} manager(s) not yet</b>` : ''}</span></div><div id="sess"></div></div>`;

  const f = [
    { type: 'heading', label: 'Signing in from outside the office' },
    { key: 'remote_access', label: 'Who may sign in from outside', type: 'select', options: [{ value: 'everyone', label: 'Everyone' }, { value: 'roles', label: 'Only the roles ticked below' }, { value: 'office_only', label: 'Nobody – office network only' }] },
    { key: 'public_url', label: 'Address used from outside (e.g. https://erp.example.co.ls)' },
    { key: 'twofa_for', label: 'Two-step sign-in (code from a phone) is required for', type: 'select', options: [{ value: 'managers', label: 'Managers, accountants and auditors' }, { value: 'everyone', label: 'Everyone' }, { value: 'nobody', label: 'Nobody (not recommended)' }] },
    { key: 'twofa_scope', label: 'Ask for the code', type: 'select', options: [{ value: 'remote', label: 'Only away from the office' }, { value: 'always', label: 'Always, also in the office' }] },
    { key: 'pin_remote', label: 'Allow staff PIN sign-in from outside (not recommended)', type: 'checkbox' },
    { key: 'trusted_networks', label: 'Office networks (one per line, e.g. 192.168.1.0/24)', type: 'textarea', rows: 3 },
    { type: 'heading', label: 'Sessions and wrong passwords' },
    { key: 'remote_session_hours', label: 'Away from the office, sign people out after (hours)', type: 'number' }, { key: 'remote_idle_minutes', label: '… or after this many idle minutes', type: 'number' },
    { key: 'idle_minutes', label: 'In the office, sign out after idle minutes (0 = never)', type: 'number' },
    { key: 'max_failed', label: 'Lock an account after this many wrong passwords', type: 'number' }, { key: 'lock_minutes', label: '… for this many minutes', type: 'number' }];
  $('#rules').innerHTML = formHtml(f, { ...s, trusted_networks: (s.trusted_networks || []).join('\n') }) +
    `<div class="field" style="margin-top:8px"><span>Roles that may work from outside (when "only the roles ticked")</span><div class="row" style="flex-wrap:wrap;gap:10px">${x.roles.map(r => `<label class="check"><input type="checkbox" data-role="${esc(r)}" ${s.remote_roles.includes(r) ? 'checked' : ''}> ${esc(r)}</label>`).join('')}</div></div>`;
  $('#sv').onclick = async () => { try { const v = readForm(sb, f.filter(z => z.key)); v.remote_roles = $$('[data-role]', sb).filter(i => i.checked).map(i => i.dataset.role); await PUT('/security', v); toast('Saved'); accessTab(sb); } catch (e) { err(e); } };
  if ($('#osrv')) $('#osrv').onchange = async e => { try { const r = await window.maluti.officeServer(e.target.checked); toast(r.on ? 'This computer now serves the office and starts with Windows' : 'Office server switched off'); } catch (x2) { err(x2); } };
  const sess = await GET('/security/sessions');
  $('#sess').innerHTML = tableHtml([{ key: 'name', label: 'Person' }, { key: 'role', label: 'Role' }, { key: 'device', label: 'Device' }, { key: 'ip', label: 'Address' }, { key: 'remote', label: 'Where', html: 1, fmt: (v, r) => where(r) },
    { key: 'method', label: 'Signed in with', fmt: v => METHOD[v] || v || '' }, { key: 'last_seen', label: 'Last active', fmt: dt }, { key: 'id', label: '', html: 1, fmt: (v, r) => r.current ? '<b>you</b>' : `<button class="btn btn-sm" data-end="${v}">Sign out</button>` }], sess, { empty: 'Nobody else is signed in.' });
  $$('[data-end]', sb).forEach(b => b.onclick = async () => { if (!(await confirmBox('Sign this session out?'))) return; try { await POST(`/security/sessions/${b.dataset.end}/end`); accessTab(sb); } catch (e) { err(e); } });
}
