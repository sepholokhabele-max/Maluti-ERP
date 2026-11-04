// Attendance: clock in/out with a PIN, who is at work, hours & overtime, link to payroll
import { state, GET, POST, PUT, DEL, esc, $, $$, toast, err, can, money, qty, modal, confirmBox, formHtml, readForm, tableHtml, badge, page, d, dt, today, plusDays, query } from './core.js';

const hm = h => { const m = Math.round(Number(h) * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}`; };
const time = s => s ? String(s).slice(11, 16) : '';

/** PIN keypad dialog used on the login screen: pick yourself, enter PIN → clocked in/out */
export async function clockDialog(users) {
  let sel = null, pin = '';
  modal({ title: '🕐 Clock in / out', body: '<div id="ck"></div>', onOpen: (r, close) => {
    const draw = () => {
      r.querySelector('#ck').innerHTML = !sel ? `<p class="muted" style="margin-top:0">Tap your name</p><div class="pin-users">${users.map(u => `<button class="pin-user" data-u="${u.id}"><span class="av">${esc(u.name.split(' ').map(x => x[0]).join('').slice(0, 2))}</span>${esc(u.name)}</button>`).join('')}</div>`
        : `<p style="margin-top:0"><b>${esc(sel.name)}</b> – enter your PIN</p><div class="pin-dots">${[0, 1, 2, 3, 4, 5].map(i => `<span class="${i < pin.length ? 'on' : ''}"></span>`).join('')}</div>
          <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 'C', 0, '✓'].map(k => `<button data-k="${k}">${k}</button>`).join('')}</div><button class="btn btn-sm" id="ckb" style="margin-top:8px">← someone else</button>`;
      $$('[data-u]', r).forEach(b => b.onclick = () => { sel = users.find(u => String(u.id) === b.dataset.u); pin = ''; draw(); });
      $$('[data-k]', r).forEach(b => b.onclick = async () => {
        const k = b.dataset.k;
        if (k === 'C') pin = ''; else if (k !== '✓') { if (pin.length < 6) pin += k; }
        if (k === '✓' || pin.length === 6) {
          try {
            const x = await POST('/attendance/clock', { user_id: sel.id, pin });
            close();
            toast(x.status === 'in' ? `👋 ${x.name} clocked IN at ${time(x.at)}` : `${x.name} clocked OUT at ${time(x.at)} – ${hm(x.hours)} today`, 'ok', 5000);
            if (x.warning) toast(x.warning, 'err', 8000);
            return;
          } catch (e) { pin = ''; err(e); }
        }
        draw();
      });
      const bk = r.querySelector('#ckb'); if (bk) bk.onclick = () => { sel = null; draw(); };
    };
    draw();
  } });
}

export async function attendance(view) {
  const q = query(); const to = q.to || today(); const from = q.from || plusDays(-6);
  const [rep, now, users, runs] = await Promise.all([GET(`/attendance?from=${from}&to=${to}`), GET('/attendance/now'), GET('/users').catch(() => []), can('payroll') ? GET('/hrm/payroll').catch(() => []) : []]);
  const s = rep.settings;
  view.innerHTML = page('Attendance', `<button class="btn" id="aAdd">＋ Add / correct a shift</button>${can('settings') ? '<button class="btn" id="aSet">Rules</button>' : ''}`, `
    <div class="card" style="margin-bottom:14px"><h3>At work now (${now.length})</h3>${now.length ? `<div class="row wrap" style="gap:8px">${now.map(a => `<span class="chip on" style="--c:#15803d">🟢 ${esc(a.user_name)} <small>since ${time(a.check_in)}${String(a.check_in).slice(0, 10) !== today() ? ' ' + d(a.check_in) : ''}</small></span>`).join('')}</div>` : '<span class="muted">Nobody is clocked in.</span>'}
      <p class="muted" style="font-size:12px;margin-bottom:0">Staff clock in and out on the login screen ("🕐 Clock in / out") or from the till menu with their PIN.</p></div>
    <div class="row wrap" style="margin-bottom:10px"><label class="row">From <input type="date" id="af" value="${from}"></label><label class="row">To <input type="date" id="at" value="${to}"></label>
      <span class="spacer"></span><span class="muted" style="font-size:12px">Overtime: hours above ${s.daily_hours} a day or ${s.weekly_hours} a week (whichever is more), paid at ${s.overtime_rate}×</span></div>
    ${tableHtml([{ key: 'name', label: 'Staff member', html: 1, fmt: (v, r) => `<b>${esc(v)}</b> <small class="muted">${esc(r.role)}</small>${r.open_shift ? ' 🟢' : ''}${r.flagged ? ` <span title="shifts needing correction" style="color:var(--warn)">⚠ ${r.flagged}</span>` : ''}` },
      { key: 'days_worked', label: 'Days', right: 1 }, { key: 'hours', label: 'Hours', right: 1, fmt: hm }, { key: 'regular_hours', label: 'Normal', right: 1, fmt: hm },
      { key: 'overtime_hours', label: 'Overtime', right: 1, html: 1, fmt: v => Number(v) ? `<b style="color:var(--warn)">${hm(v)}</b>` : '–' },
      { key: 'overtime_pay', label: 'Overtime pay (est.)', right: 1, fmt: (v, r) => v != null ? money(v) : r.employee_id ? '' : 'link to employee' }],
      rep.people, { rowAttr: r => `data-p="${r.user_id}"`, empty: 'No clock-ins in this period.' })}
    ${can('payroll') && rep.people.some(p => p.overtime_pay > 0) ? `<div class="row" style="margin-top:12px"><span class="spacer"></span><select id="aRun">${runs.filter(r => r.status === 'draft').map(r => `<option value="${r.id}">${esc(r.number || r.period)} (draft)</option>`).join('') || '<option value="">no draft payroll run</option>'}</select><button class="btn btn-primary" id="aPay">Add overtime to payroll run</button></div>` : ''}
    <p class="muted" style="font-size:12px">Overtime pay is estimated from the basic salary of the employee linked to each user (HR → employee → "Login user"). Check your sector's wage order for the rates that apply.</p>`);
  const go = () => location.hash = `#/attendance?from=${$('#af').value}&to=${$('#at').value}`;
  $('#af').onchange = go; $('#at').onchange = go;
  const editShift = (a, uid) => {
    const f = [{ key: 'user_id', label: 'Staff member', type: 'select', numeric: true, options: users.filter(u => u.active).map(u => ({ value: u.id, label: u.name })) },
      { key: 'check_in', label: 'Clocked in', type: 'datetime-local', required: true }, { key: 'check_out', label: 'Clocked out', type: 'datetime-local' }, { key: 'note', label: 'Reason for the change', span: 2 }];
    const acts = [{ label: 'Cancel' }];
    if (a) acts.push({ label: 'Delete', cls: 'btn-danger', onClick: async c => { if (await confirmBox('Delete this shift?', { danger: true })) { await DEL('/attendance/' + a.id); c(); attendance(view); } } });
    acts.push({ label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); if (a) await PUT('/attendance/' + a.id, v); else await POST('/attendance', v); c(); toast('Saved'); attendance(view); } });
    modal({ title: a ? 'Correct a shift' : 'Add a shift', body: formHtml(f, a ? { ...a, check_in: String(a.check_in).replace(' ', 'T').slice(0, 16), check_out: a.check_out ? String(a.check_out).replace(' ', 'T').slice(0, 16) : '' } : { user_id: uid, check_in: today() + 'T08:00' }, { ctx: 'attendance' }), actions: acts });
  };
  $('#aAdd').onclick = () => editShift(null);
  $$('[data-p]').forEach(tr => tr.onclick = () => {
    const p = rep.people.find(x => String(x.user_id) === tr.dataset.p);
    modal({ title: `${esc(p.name)} – ${d(from)} to ${d(to)}`, wide: true, body: tableHtml([{ key: 'check_in', label: 'Day', fmt: v => d(v) }, { key: 'check_in', label: 'In', fmt: time }, { key: 'check_out', label: 'Out', fmt: (v, r) => v ? time(v) + (String(v).slice(0, 10) !== String(r.check_in).slice(0, 10) ? ' (+1)' : '') : '🟢 still in' },
      { key: 'hours', label: 'Hours', right: 1, fmt: hm }, { key: 'source', label: 'How' }, { key: 'note', label: 'Note', html: 1, fmt: v => v ? `<span style="color:var(--warn)">${esc(v)}</span>` : '' }, { key: 'id', label: '', html: 1, fmt: v => `<button class="btn btn-sm" data-e="${v}">Edit</button>` }], p.entries),
      actions: [{ label: 'Close' }, { label: '＋ Add shift', onClick: c => { c(); editShift(null, p.user_id); } }], onOpen: r => $$('[data-e]', r).forEach(b => b.onclick = () => { const a = p.entries.find(x => String(x.id) === b.dataset.e); editShift(a); }) });
  });
  const set = $('#aSet');
  if (set) set.onclick = () => {
    const f = [{ key: 'weekly_hours', label: 'Normal hours per week', type: 'number' }, { key: 'daily_hours', label: 'Normal hours per day', type: 'number' },
      { key: 'overtime_rate', label: 'Overtime rate (× normal pay)', type: 'number', step: '0.05' }, { key: 'max_shift_hours', label: 'Close a forgotten clock-out after (hours)', type: 'number' }];
    modal({ title: 'Attendance rules', body: formHtml(f, s, { ctx: 'attendance' }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await PUT('/attendance/settings', readForm(r, f)); c(); attendance(view); } }] });
  };
  const ap = $('#aPay');
  if (ap) ap.onclick = async () => { const run = $('#aRun').value; if (!run) return err(new Error('Create the payroll run for the month first (HR → Payroll)')); try { const x = await POST('/attendance/to-payroll', { run_id: Number(run), from, to }); toast(`Overtime added for ${x.added} employee(s)`); } catch (e) { err(e); } };
}
