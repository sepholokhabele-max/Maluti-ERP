// HR & Payroll with Lesotho PAYE
import { state, GET, POST, PUT, DEL, esc, $, $$, toast, err, can, money, modal, confirmBox, promptBox, formHtml, readForm, tableHtml, badge, page, d, dt, today, query, printHtml, round2 } from './core.js';

const TABS = [['employees', 'Employees'], ['leave', 'Leave'], ['payroll', 'Payroll'], ['paye', 'PAYE return'], ['settings', 'Settings']];
const fullName = e => `${e.first_name} ${e.last_name}`;
const thisPeriod = () => today().slice(0, 7);
const periodLabel = p => new Date(p + '-01T12:00:00').toLocaleDateString([], { month: 'long', year: 'numeric' });

export async function hrm(view) {
  const st = await GET('/hrm/status');
  const tab = query().tab || 'employees';
  if (!st.enabled && tab !== 'settings') {
    view.innerHTML = page('HR & Payroll', '', `<div class="empty" style="padding:50px">
      <div style="font-size:40px">👥</div><h3 style="margin:10px 0">The HR & Payroll module is turned off</h3>
      <p class="muted">Turn it on to manage employees, leave and monthly payroll with Lesotho PAYE.</p>
      ${can('settings') ? '<a class="btn btn-primary" href="#/hrm?tab=settings">Open HR settings</a>' : '<p class="muted">Ask an administrator to turn it on.</p>'}</div>`);
    return;
  }
  view.innerHTML = page('HR & Payroll', st.paye_enabled ? badge('Lesotho PAYE on', 'ok') : badge('PAYE off', 'draft'),
    `<div class="tabs">${TABS.filter(([k]) => k !== 'payroll' && k !== 'paye' || can('payroll')).map(([k, l]) => `<a href="#/hrm?tab=${k}" class="${tab === k ? 'active' : ''}">${l}</a>`).join('')}</div><div id="hb"></div>`);
  const hb = $('#hb');
  if (tab === 'employees') return employeesTab(hb);
  if (tab === 'leave') return leaveTab(hb);
  if (tab === 'payroll') return payrollTab(hb);
  if (tab === 'paye') return payeTab(hb);
  if (tab === 'settings') return settingsTab(hb, view);
}

// ---------------------------------------------------------------- employees
const EMP_FIELDS = (depts, users = []) => [
  { key: 'first_name', label: 'First name', required: true }, { key: 'last_name', label: 'Last name', required: true },
  { key: 'code', label: 'Employee no. (auto if blank)' }, { key: 'job_title', label: 'Job title' },
  { key: 'department_id', label: 'Department', type: 'select', numeric: true, options: [{ value: '', label: '—' }, ...depts.map(x => ({ value: x.id, label: x.name }))] },
  { key: 'employment_type', label: 'Employment type', type: 'select', options: [['permanent', 'Permanent'], ['fixed_term', 'Fixed term'], ['casual', 'Casual'], ['intern', 'Intern']].map(([v, l]) => ({ value: v, label: l })) },
  { key: 'hire_date', label: 'Start date', type: 'date' }, { key: 'status', label: 'Status', type: 'select', options: ['active', 'suspended', 'terminated'].map(v => ({ value: v, label: v })) },
  { key: 'termination_date', label: 'Termination date', type: 'date' },
  { key: 'basic_salary', label: 'Basic salary (monthly)', type: 'number', step: '0.01' },
  { key: 'id_number', label: 'ID / passport no.' }, { key: 'tin', label: 'Tax number (TIN)' },
  { key: 'gender', label: 'Gender', type: 'select', options: [{ value: '', label: '—' }, { value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }, { value: 'other', label: 'Other' }] },
  { key: 'birth_date', label: 'Date of birth', type: 'date' },
  { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email', type: 'email' }, { key: 'address', label: 'Address', span: 2 },
  { key: 'pay_method', label: 'Paid by', type: 'select', options: [['bank', 'Bank transfer'], ['cash', 'Cash'], ['mobile_money', 'Mobile money']].map(([v, l]) => ({ value: v, label: l })) },
  { key: 'bank_name', label: 'Bank' }, { key: 'bank_account', label: 'Bank account no.' }, { key: 'mobile_money_number', label: 'M-Pesa / EcoCash no.' },
  { key: 'paye_applies', label: 'Deduct PAYE for this employee', type: 'checkbox', default: 1 },
  { key: 'user_id', label: 'Login user (for clock-in / attendance)', type: 'select', numeric: true, options: [{ value: '', label: '— none —' }, ...users.map(u => ({ value: u.id, label: `${u.name} (${u.username})` }))] },
  { key: 'emergency_contact', label: 'Emergency contact', span: 2 }, { key: 'notes', label: 'Notes', type: 'textarea', span: 2 }
];

async function employeesTab(root) {
  root.innerHTML = `<div class="row wrap" style="margin-bottom:10px"><input id="eq" placeholder="Search name, number, job…" style="max-width:280px">
    <select id="es" style="max-width:170px"><option value="">All statuses</option><option value="active" selected>Active</option><option value="suspended">Suspended</option><option value="terminated">Terminated</option></select>
    <span class="spacer"></span><span class="muted" id="ec"></span><button class="btn btn-primary" id="ne">＋ New employee</button></div><div id="el"></div>`;
  const load = async () => {
    const rows = await GET(`/hrm/employees?status=${$('#es').value}&q=${encodeURIComponent($('#eq').value)}`);
    $('#ec').textContent = `${rows.length} employees · monthly basic ${money(rows.filter(r => r.status === 'active').reduce((s, r) => s + Number(r.basic_salary), 0))}`;
    $('#el').innerHTML = tableHtml([
      { key: 'code', label: 'No.' }, { key: 'full_name', label: 'Name', html: 1, fmt: v => `<b>${esc(v)}</b>` }, { key: 'job_title', label: 'Job title' },
      { key: 'department', label: 'Department' }, { key: 'hire_date', label: 'Started', fmt: d },
      { key: 'basic_salary', label: 'Basic', right: 1, fmt: money }, { key: 'recurring_earnings', label: '+ Allowances', right: 1, fmt: v => Number(v) ? money(v) : '' },
      { key: 'recurring_deductions', label: '− Deductions', right: 1, fmt: v => Number(v) ? money(v) : '' },
      { key: 'pay_method', label: 'Paid by', fmt: v => v.replace('_', ' ') }, { key: 'status', label: 'Status', html: 1, fmt: v => badge(v, v === 'active' ? 'ok' : v === 'suspended' ? 'draft' : 'closed') }
    ], rows, { rowAttr: r => `data-href="#/employee/${r.id}"`, empty: 'No employees yet — click "New employee".' });
    $$('[data-href]', root).forEach(tr => tr.onclick = () => location.hash = tr.dataset.href);
  };
  $('#eq').oninput = () => { clearTimeout(load.t); load.t = setTimeout(load, 250); }; $('#es').onchange = load;
  $('#ne').onclick = async () => {
    const f = EMP_FIELDS(await GET('/hrm/departments'), await GET('/users').catch(() => []));
    modal({ title: 'New employee', wide: true, body: formHtml(f, { status: 'active', employment_type: 'permanent', pay_method: 'bank', paye_applies: 1, hire_date: today() }, { ctx: 'employee' }),
      actions: [{ label: 'Cancel' }, { label: 'Create', cls: 'btn-primary', onClick: async (c, r) => { const x = await POST('/hrm/employees', readForm(r, f)); c(); location.hash = '#/employee/' + x.id; } }] });
  };
  load();
}

export async function employee(view, [id]) {
  const e = await GET('/hrm/employees/' + id);
  const depts = await GET('/hrm/departments');
  const f = EMP_FIELDS(depts, await GET('/users').catch(() => []));
  const p = e.pay_preview;
  view.innerHTML = page(`${fullName(e)} ${e.code ? `· ${e.code}` : ''}`, `<button class="btn" id="edit">Edit details</button>${can('payroll') ? '<button class="btn btn-primary" id="addItem">＋ Allowance / deduction</button>' : ''}<button class="btn" id="addLeave">＋ Leave</button>`, `
    <div class="cols cols-4" style="margin-bottom:14px">
      <div class="kpi"><div class="label">Basic salary</div><div class="value">${money(e.basic_salary)}</div><div class="hint">${esc(e.job_title || '')} · ${esc(e.department || 'no department')}</div></div>
      <div class="kpi"><div class="label">Gross this month</div><div class="value">${money(p.gross)}</div><div class="hint">Taxable ${money(p.taxable)}</div></div>
      <div class="kpi"><div class="label">PAYE (est.)</div><div class="value">${money(p.paye)}</div><div class="hint">${e.paye_applies ? esc(p.table || 'no PAYE table') : 'PAYE not applied to this employee'}</div></div>
      <div class="kpi"><div class="label">Net pay (est.)</div><div class="value" style="color:var(--ok)">${money(p.net)}</div><div class="hint">after ${money(p.other_deductions)} other deductions</div></div>
    </div>
    <div class="cols cols-2">
      <div><div class="card"><h3>Recurring allowances & deductions</h3>
        ${tableHtml([{ key: 'kind', label: 'Type', html: 1, fmt: v => badge(v, v === 'earning' ? 'ok' : 'draft') }, { key: 'name', label: 'Description' },
          { key: 'amount', label: 'Monthly', right: 1, fmt: money },
          { key: 'taxable', label: 'Tax treatment', fmt: (v, r) => r.kind === 'earning' ? (v ? 'taxable' : 'non-taxable') : (r.pre_tax ? 'pre-tax (reduces PAYE)' : 'after tax') },
          { key: 'active', label: '', html: 1, fmt: (v, r) => (v ? '' : badge('paused', 'closed')) + (can('payroll') ? ` <button class="btn btn-sm" data-pi="${r.id}">Edit</button>` : '') }],
          e.pay_items, { empty: 'Only basic salary is paid.' })}
        <p class="muted" style="font-size:12px;margin-bottom:0">Contributions to an approved pension fund or retirement annuity are deducted before PAYE is calculated – mark them "pre-tax".</p></div>
        <div class="card"><h3>Payslips</h3>${tableHtml([{ key: 'period', label: 'Period', fmt: periodLabel }, { key: 'gross', label: 'Gross', right: 1, fmt: money }, { key: 'paye', label: 'PAYE', right: 1, fmt: money }, { key: 'net', label: 'Net', right: 1, fmt: money }, { key: 'status', label: 'Run', html: 1, fmt: v => badge(v) }], e.payslips, { rowAttr: r => `data-href="#/payrun/${r.run_id}"`, empty: 'No payslips yet' })}</div></div>
      <div><div class="card"><h3>Leave balances ${new Date().getFullYear()}</h3>${tableHtml([{ key: 'name', label: 'Type' }, { key: 'days_per_year', label: 'Entitled', right: 1 }, { key: 'taken', label: 'Taken', right: 1 }, { key: 'pending', label: 'Pending', right: 1 }, { key: 'balance', label: 'Balance', right: 1, html: 1, fmt: (v, r) => Number(r.days_per_year) ? `<b style="color:${v < 0 ? 'var(--bad)' : 'inherit'}">${Number(v)}</b>` : '—' }], e.leave_balances)}</div>
        <div class="card"><h3>Leave history</h3>${tableHtml([{ key: 'type', label: 'Type' }, { key: 'start_date', label: 'From', fmt: d }, { key: 'end_date', label: 'To', fmt: d }, { key: 'days', label: 'Days', right: 1 }, { key: 'status', label: 'Status', html: 1, fmt: v => badge(v, { approved: 'ok', pending: 'pending', rejected: 'failed', cancelled: 'closed' }[v]) }], e.leave, { empty: 'No leave taken' })}</div>
        <div class="card"><h3>Personal & payment details</h3><ul class="list-plain">
          ${[['ID / passport', e.id_number], ['TIN', e.tin], ['Started', d(e.hire_date)], ['Employment', e.employment_type.replace('_', ' ')], ['Status', e.status], ['Phone', e.phone], ['Email', e.email],
            ['Paid by', e.pay_method.replace('_', ' ')], ['Bank', [e.bank_name, e.bank_account].filter(Boolean).join(' · ')], ['Mobile money', e.mobile_money_number], ['Emergency contact', e.emergency_contact]]
            .filter(x => x[1]).map(([k, v]) => `<li><span class="muted">${k}</span><span>${esc(v)}</span></li>`).join('')}</ul></div></div>
    </div>`, { back: '#/hrm' });
  $$('[data-href]', view).forEach(el => el.onclick = () => location.hash = el.dataset.href);
  const reload = () => employee(view, [id]);
  $('#edit').onclick = () => modal({ title: 'Edit ' + fullName(e), wide: true, body: formHtml(f, { ...e, hire_date: d(e.hire_date), termination_date: d(e.termination_date), birth_date: d(e.birth_date) }, { ctx: 'employee' }),
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await PUT('/hrm/employees/' + id, readForm(r, f)); c(); toast('Saved'); reload(); } }] });
  const itemForm = it => {
    const fi = [{ key: 'kind', label: 'Type', type: 'select', options: [{ value: 'earning', label: 'Allowance / earning' }, { value: 'deduction', label: 'Deduction' }] },
      { key: 'name', label: 'Description', required: true }, { key: 'amount', label: 'Monthly amount', type: 'number', step: '0.01' },
      { key: 'taxable', label: 'Earning is taxable', type: 'checkbox', default: 1 }, { key: 'pre_tax', label: 'Deduction is pre-tax (approved pension / RA)', type: 'checkbox' },
      ...(it ? [{ key: 'active', label: 'Active', type: 'checkbox' }] : [])];
    const acts = [{ label: 'Cancel' }];
    if (it) acts.push({ label: 'Delete', cls: 'btn-danger', onClick: async c => { await DEL('/hrm/pay-items/' + it.id); c(); reload(); } });
    acts.push({ label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, fi); if (it) await PUT('/hrm/pay-items/' + it.id, v); else await POST(`/hrm/employees/${id}/pay-items`, v); c(); toast('Saved'); reload(); } });
    modal({ title: it ? 'Edit pay item' : 'New recurring pay item', size: 'lg', body: formHtml(fi, it || { kind: 'earning', taxable: 1 }, { ctx: 'payitem' }) +
      '<p class="muted" style="font-size:12px">Examples: transport or housing allowance (earning), pension fund (pre-tax deduction), staff loan, union dues, funeral scheme (after-tax deductions).</p>', actions: acts });
  };
  const ai = $('#addItem'); if (ai) ai.onclick = () => itemForm(null);
  $$('[data-pi]').forEach(b => b.onclick = ev => { ev.stopPropagation(); itemForm(e.pay_items.find(x => String(x.id) === b.dataset.pi)); });
  $('#addLeave').onclick = () => leaveDialog({ employee: e, onSaved: reload });
}

// ---------------------------------------------------------------- leave
async function leaveDialog({ employee: emp, onSaved }) {
  const [types, emps] = await Promise.all([GET('/hrm/leave-types'), emp ? [] : GET('/hrm/employees?status=active')]);
  const f = [...(emp ? [] : [{ key: 'employee_id', label: 'Employee', type: 'select', numeric: true, required: true, options: [{ value: '', label: '— choose —' }, ...emps.map(x => ({ value: x.id, label: x.full_name }))], span: 2 }]),
    { key: 'leave_type_id', label: 'Leave type', type: 'select', numeric: true, options: types.map(t => ({ value: t.id, label: `${t.name}${t.paid ? '' : ' (unpaid)'}` })) },
    { key: 'days', label: 'Working days (blank = count Mon–Fri)', type: 'number', nullable: true },
    { key: 'start_date', label: 'From', type: 'date', required: true }, { key: 'end_date', label: 'To', type: 'date', required: true },
    { key: 'reason', label: 'Reason', span: 2 }];
  modal({ title: `Book leave${emp ? ' — ' + fullName(emp) : ''}`, size: 'lg', body: formHtml(f, { start_date: today(), end_date: today() }),
    actions: [{ label: 'Cancel' }, { label: 'Save request', cls: 'btn-primary', onClick: async (c, r) => {
      const v = readForm(r, f); if (v.days === null) delete v.days;
      const x = await POST('/hrm/leave', { ...v, employee_id: emp ? emp.id : v.employee_id }); c(); toast(`Leave request saved (${x.days} day${x.days == 1 ? '' : 's'})`); onSaved && onSaved();
    } }] });
}

async function leaveTab(root) {
  root.innerHTML = `<div class="row wrap" style="margin-bottom:10px"><select id="ls" style="max-width:180px"><option value="pending">Pending approval</option><option value="approved">Approved</option><option value="">All</option></select>
    <span class="spacer"></span><button class="btn btn-primary" id="nl">＋ Book leave</button></div><div id="ll"></div>`;
  const load = async () => {
    const rows = await GET('/hrm/leave?status=' + $('#ls').value);
    $('#ll').innerHTML = tableHtml([{ key: 'employee', label: 'Employee' }, { key: 'type', label: 'Type', fmt: (v, r) => v + (r.paid ? '' : ' (unpaid)') }, { key: 'start_date', label: 'From', fmt: d }, { key: 'end_date', label: 'To', fmt: d },
      { key: 'days', label: 'Days', right: 1 }, { key: 'reason', label: 'Reason' }, { key: 'status', label: 'Status', html: 1, fmt: v => badge(v, { approved: 'ok', pending: 'pending', rejected: 'failed', cancelled: 'closed' }[v]) },
      { key: 'id', label: '', html: 1, fmt: (v, r) => r.status === 'pending' ? `<button class="btn btn-sm btn-ok" data-la="${v}" data-act="approve">Approve</button> <button class="btn btn-sm" data-la="${v}" data-act="reject">Reject</button>` : r.status === 'approved' ? `<button class="btn btn-sm" data-la="${v}" data-act="cancel">Cancel</button>` : '' }],
      rows, { empty: 'No leave requests.' });
    $$('[data-la]').forEach(b => b.onclick = async () => {
      try { await POST(`/hrm/leave/${b.dataset.la}/${b.dataset.act}`, {}); toast('Done'); load(); }
      catch (e) {
        if (/Approve anyway/.test(e.message) && await confirmBox(e.message.replace(' Approve anyway with "allow negative".', '') + ' Approve anyway?')) { await POST(`/hrm/leave/${b.dataset.la}/approve`, { allow_negative: true }); load(); }
        else err(e);
      }
    });
  };
  $('#ls').onchange = load; $('#nl').onclick = () => leaveDialog({ onSaved: load });
  load();
}

// ---------------------------------------------------------------- payroll
async function payrollTab(root) {
  const runs = await GET('/hrm/payroll');
  root.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="muted">One run per month. Draft runs recalculate from employee records; approving posts to the ledger.</span><span class="spacer"></span><button class="btn btn-primary" id="nr">＋ Run payroll</button></div>
    ${tableHtml([{ key: 'period', label: 'Month', fmt: periodLabel }, { key: 'pay_date', label: 'Pay date', fmt: d }, { key: 'employees', label: 'Employees', right: 1 },
      { key: 'gross_total', label: 'Gross', right: 1, fmt: money }, { key: 'paye_total', label: 'PAYE', right: 1, fmt: money }, { key: 'deductions_total', label: 'Other deductions', right: 1, fmt: money },
      { key: 'net_total', label: 'Net pay', right: 1, fmt: money }, { key: 'paye_enabled', label: 'PAYE', fmt: v => v ? 'on' : 'off' }, { key: 'status', label: 'Status', html: 1, fmt: v => badge(v, { draft: 'draft', approved: 'posted', paid: 'ok' }[v]) }],
      runs, { rowAttr: r => `data-href="#/payrun/${r.id}"`, empty: 'No payroll runs yet.' })}`;
  $$('[data-href]', root).forEach(tr => tr.onclick = () => location.hash = tr.dataset.href);
  $('#nr').onclick = () => {
    const next = (() => { const used = new Set(runs.map(r => r.period)); let p = thisPeriod(); if (used.has(p)) { const [y, m] = p.split('-').map(Number); const dd = new Date(y, m, 1); p = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}`; } return p; })();
    const f = [{ key: 'period', label: 'Month', type: 'month', required: true }, { key: 'pay_date', label: 'Pay date (blank = month end)', type: 'date' }, { key: 'notes', label: 'Notes', span: 2 }];
    modal({ title: 'Run payroll', size: 'lg', body: formHtml(f, { period: next }) + '<p class="muted">All active employees are included with their basic salary and recurring allowances/deductions. Joiners and leavers are paid pro-rata. You can add once-off overtime, bonuses or deductions on the next screen.</p>',
      actions: [{ label: 'Cancel' }, { label: 'Calculate', cls: 'btn-primary', onClick: async (c, r) => { const x = await POST('/hrm/payroll', readForm(r, f)); c(); location.hash = '#/payrun/' + x.id; } }] });
  };
}

export async function payrun(view, [id]) {
  const run = await GET('/hrm/payroll/' + id);
  const draft = run.status === 'draft';
  const acts = [];
  if (draft) acts.push('<button class="btn" id="adj">＋ Once-off item</button><button class="btn" id="recalc">⟳ Recalculate</button><button class="btn btn-danger" id="del">Delete</button><button class="btn btn-ok" id="approve">Approve & post</button>');
  if (run.status === 'approved') acts.push('<button class="btn btn-ok" id="paid">Mark salaries paid</button>');
  if (run.status !== 'draft' && state.user.role === 'admin') acts.push('<button class="btn btn-danger" id="reopen">Reopen</button>');
  acts.push('<button class="btn" id="printAll">🖨 All payslips</button><button class="btn" id="csv">⬇ CSV</button>');
  view.innerHTML = page(`Payroll — ${periodLabel(run.period)}`, acts.join(''), `
    <div class="row wrap" style="margin-bottom:12px">${badge(run.status, { draft: 'draft', approved: 'posted', paid: 'ok' }[run.status])}
      <span class="muted">Pay date ${d(run.pay_date)} · ${run.paye_enabled ? `PAYE: ${esc(run.paye_table || '—')} (20% up to ${money(run.band_monthly)}, 30% above, credit ${money(run.credit_monthly)})` : 'PAYE switched off for this run'}</span>
      ${draft ? `<label class="row" style="gap:6px;margin-left:auto"><input type="checkbox" id="payeOn" ${run.paye_enabled ? 'checked' : ''}> Deduct PAYE</label>` : ''}
      ${run.approved_by_name ? `<span class="muted">· approved by ${esc(run.approved_by_name)}</span>` : ''}</div>
    <div class="cols cols-4" style="margin-bottom:14px">
      <div class="kpi"><div class="label">Gross pay</div><div class="value">${money(run.gross_total)}</div><div class="hint">${run.employees} employees</div></div>
      <div class="kpi"><div class="label">PAYE to RSL</div><div class="value">${money(run.paye_total)}</div><div class="hint">due by the 15th of next month</div></div>
      <div class="kpi"><div class="label">Other deductions</div><div class="value">${money(run.deductions_total)}</div></div>
      <div class="kpi"><div class="label">Net pay</div><div class="value" style="color:var(--ok)">${money(run.net_total)}</div></div></div>
    ${tableHtml([{ key: 'code', label: 'No.' }, { key: 'name', label: 'Employee', html: 1, fmt: (v, r) => `<b>${esc(v)}</b><div class="muted" style="font-size:12px">${esc(r.job_title || '')}</div>` },
      { key: 'gross', label: 'Gross', right: 1, fmt: money }, { key: 'pre_tax_deductions', label: 'Pre-tax ded.', right: 1, fmt: v => Number(v) ? money(v) : '' },
      { key: 'taxable_income', label: 'Taxable', right: 1, fmt: money }, { key: 'tax_before_credit', label: 'Tax', right: 1, fmt: money }, { key: 'tax_credit', label: 'Credit', right: 1, fmt: v => Number(v) ? '−' + money(v) : '' },
      { key: 'paye', label: 'PAYE', right: 1, html: 1, fmt: v => `<b>${money(v)}</b>` }, { key: 'other_deductions', label: 'Other ded.', right: 1, fmt: money },
      { key: 'net', label: 'Net pay', right: 1, html: 1, fmt: v => `<b style="color:var(--ok)">${money(v)}</b>` }, { key: 'pay_method', label: 'Paid by', fmt: v => v.replace('_', ' ') },
      { key: 'id', label: '', html: 1, fmt: v => `<button class="btn btn-sm" data-slip="${v}">Payslip</button>` }], run.payslips, { empty: 'No employees to pay.' })}
    ${run.adjustments.length ? `<div class="card" style="margin-top:14px"><h3>Once-off items this month</h3>${tableHtml([{ key: 'employee', label: 'Employee' }, { key: 'kind', label: 'Type' }, { key: 'name', label: 'Description' }, { key: 'amount', label: 'Amount', right: 1, fmt: money },
      { key: 'id', label: '', html: 1, fmt: v => draft ? `<button class="btn btn-sm" data-deladj="${v}">Remove</button>` : '' }], run.adjustments)}</div>` : ''}`, { back: '#/hrm?tab=payroll' });
  const reload = () => payrun(view, [id]);
  const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = async () => { el.disabled = true; try { await fn(); } catch (e) { err(e); } el.disabled = false; }; };
  on('#recalc', async () => { await POST(`/hrm/payroll/${id}/recalculate`); toast('Recalculated'); reload(); });
  on('#approve', async () => { if (!(await confirmBox(`Approve payroll for ${periodLabel(run.period)}? Gross ${money(run.gross_total)}, PAYE ${money(run.paye_total)}, net ${money(run.net_total)} will be posted to the accounts.`, { okLabel: 'Approve & post' }))) return; await POST(`/hrm/payroll/${id}/approve`); toast('Payroll approved'); reload(); });
  on('#paid', async () => { if (!(await confirmBox(`Record that net salaries of ${money(run.net_total)} have been paid (bank / cash / mobile money per employee)?`, { okLabel: 'Mark paid' }))) return; await POST(`/hrm/payroll/${id}/pay`, {}); toast('Salaries marked paid'); reload(); });
  on('#reopen', async () => { if (!(await confirmBox('Reopen this run? Its ledger postings will be reversed.', { danger: true, okLabel: 'Reopen' }))) return; await POST(`/hrm/payroll/${id}/reopen`); reload(); });
  on('#del', async () => { if (!(await confirmBox('Delete this draft payroll run?', { danger: true, okLabel: 'Delete' }))) return; await DEL('/hrm/payroll/' + id); location.hash = '#/hrm?tab=payroll'; });
  const po = $('#payeOn'); if (po) po.onchange = async () => { try { await PUT('/hrm/payroll/' + id, { paye_enabled: po.checked }); reload(); } catch (e) { err(e); } };
  $$('[data-deladj]').forEach(b => b.onclick = async () => { await DEL(`/hrm/payroll/${id}/adjustments/${b.dataset.deladj}`); reload(); });
  $$('[data-slip]').forEach(b => b.onclick = () => { const s = run.payslips.find(x => String(x.id) === b.dataset.slip); slipPreview(run, s); });
  on('#printAll', async () => printHtml(payslipDoc(run, run.payslips)));
  on('#csv', async () => {
    const rows = [['Employee no', 'Name', 'ID number', 'TIN', 'Gross', 'Pre-tax deductions', 'Taxable', 'Tax before credit', 'Tax credit', 'PAYE', 'Other deductions', 'Net', 'Paid by', 'Bank', 'Account', 'Mobile money']]
      .concat(run.payslips.map(s => [s.code, s.name, s.id_number, s.tin, s.gross, s.pre_tax_deductions, s.taxable_income, s.tax_before_credit, s.tax_credit, s.paye, s.other_deductions, s.net, s.pay_method, s.bank_name, s.bank_account, s.mobile_money_number]));
    download(`payroll-${run.period}.csv`, rows);
  });
  on('#adj', async () => {
    const f = [{ key: 'employee_id', label: 'Employee', type: 'select', numeric: true, required: true, options: run.payslips.map(s => ({ value: s.employee_id, label: s.name })), span: 2 },
      { key: 'kind', label: 'Type', type: 'select', options: [{ value: 'earning', label: 'Earning (overtime, bonus, commission…)' }, { value: 'deduction', label: 'Deduction (advance, shortage, unpaid leave…)' }] },
      { key: 'name', label: 'Description', required: true }, { key: 'amount', label: 'Amount', type: 'number', step: '0.01', required: true },
      { key: 'taxable', label: 'Earning is taxable', type: 'checkbox', default: 1 }, { key: 'pre_tax', label: 'Deduction is pre-tax', type: 'checkbox' }];
    modal({ title: 'Once-off item for this month', size: 'lg', body: formHtml(f, { kind: 'earning', taxable: 1 }),
      actions: [{ label: 'Cancel' }, { label: 'Add', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/hrm/payroll/${id}/adjustments`, readForm(r, f)); c(); toast('Added'); reload(); } }] });
  });
}

function download(name, rows) {
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function slipHtml(run, s) {
  const c = state.company;
  const L = s.lines || [];
  const row = (n, a, cls = '') => `<tr class="${cls}"><td>${esc(n)}</td><td class="r">${money(a)}</td></tr>`;
  return `<div class="slip">
    <table class="hd"><tr><td>${state.logo ? `<img src="${state.logo}" style="max-height:60px;max-width:180px"><br>` : ''}<b style="font-size:16px">${esc(c.name || '')}</b><br>${esc(c.address || '')}${c.tax_number ? '<br>TIN ' + esc(c.tax_number) : ''}</td>
      <td class="r"><b style="font-size:18px">PAYSLIP</b><br>${periodLabel(run.period)}<br>Pay date ${d(run.pay_date)}</td></tr></table>
    <table class="emp"><tr><td><b>${esc(s.name)}</b> (${esc(s.code || '')})<br>${esc(s.job_title || '')}${s.department ? ' · ' + esc(s.department) : ''}</td>
      <td class="r">ID ${esc(s.id_number || '—')}<br>TIN ${esc(s.tin || '—')}<br>Paid by ${esc(s.pay_method.replace('_', ' '))}${s.bank_account ? ' · ' + esc(s.bank_name || '') + ' ' + esc(s.bank_account) : s.mobile_money_number ? ' · ' + esc(s.mobile_money_number) : ''}</td></tr></table>
    <table class="cols2"><tr><td style="width:50%;vertical-align:top"><table class="ln"><tr><th colspan="2">Earnings</th></tr>
        ${L.filter(l => l.kind === 'earning').map(l => row(l.name + (l.taxable ? '' : ' (non-taxable)'), l.amount)).join('')}${row('Gross pay', s.gross, 'tot')}</table></td>
      <td style="vertical-align:top"><table class="ln"><tr><th colspan="2">Deductions</th></tr>
        ${row('PAYE', s.paye)}${L.filter(l => l.kind === 'deduction').map(l => row(l.name + (l.pre_tax ? ' (pre-tax)' : ''), l.amount)).join('')}${row('Total deductions', round2(Number(s.paye) + Number(s.other_deductions)), 'tot')}</table></td></tr></table>
    <table class="ln tax"><tr><th colspan="2">PAYE calculation</th></tr>${row('Taxable income', s.taxable_income)}${row('Tax at 20% / 30%', s.tax_before_credit)}${row('Less tax credit', -s.tax_credit)}${row('PAYE', s.paye, 'tot')}</table>
    <div class="net">NET PAY <span>${money(s.net)}</span></div></div>`;
}

function payslipDoc(run, slips) {
  return `<html><head><meta charset="utf-8"><style>
    body{font-family:Segoe UI,Arial,sans-serif;font-size:12.5px;color:#111;margin:0} .slip{padding:24px 30px;page-break-after:always} table{width:100%;border-collapse:collapse}
    .hd td{vertical-align:top;padding-bottom:12px;border-bottom:2px solid #3f3d9e} .emp td{padding:10px 0;vertical-align:top} .r{text-align:right}
    .ln th{text-align:left;background:#eef0f7;padding:6px} .ln td{padding:5px 6px;border-bottom:1px solid #eee} .ln .tot td{font-weight:bold;border-top:1px solid #999}
    .cols2>tbody>tr>td{padding:0 6px 0 0} .tax{margin-top:12px;width:50%} .net{margin-top:14px;background:#3f3d9e;color:#fff;padding:10px 14px;font-size:16px;font-weight:bold;display:flex;justify-content:space-between}
  </style></head><body>${slips.map(s => slipHtml(run, s)).join('')}</body></html>`;
}

function slipPreview(run, s) {
  const html = payslipDoc(run, [s]);
  modal({ title: `Payslip — ${s.name}`, wide: true, body: '<iframe id="ps" style="width:100%;height:560px;border:1px solid var(--line);border-radius:8px;background:#fff"></iframe>',
    onOpen: r => { const f = r.querySelector('#ps'); f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close(); },
    actions: [{ label: 'Close' }, { label: '🖨 Print', cls: 'btn-primary', onClick: () => printHtml(html) }] });
}

// ---------------------------------------------------------------- PAYE return
async function payeTab(root) {
  const period = query().period || thisPeriod();
  const r = await GET('/hrm/paye-report?period=' + period);
  root.innerHTML = `<div class="row wrap" style="margin-bottom:12px"><label class="row">Month <input type="month" id="pp" value="${period}" style="max-width:180px"></label>
      <span class="spacer"></span>${r.rows.length ? '<button class="btn" id="pcsv">⬇ CSV for RSL</button><button class="btn" onclick="window.print()">🖨 Print</button><button class="btn btn-primary" id="remit">Record payment to RSL</button>' : ''}</div>
    ${r.run ? `<div class="cols cols-3" style="margin-bottom:14px"><div class="kpi"><div class="label">PAYE withheld</div><div class="value">${money(r.totals.paye)}</div><div class="hint">${r.rows.length} employees</div></div>
      <div class="kpi"><div class="label">Total taxable income</div><div class="value">${money(r.totals.taxable)}</div></div>
      <div class="kpi"><div class="label">Pay to Revenue Services Lesotho by</div><div class="value">${d(r.due_date)}</div><div class="hint">payroll run is ${esc(r.run.status)}</div></div></div>` : ''}
    ${tableHtml([{ key: 'code', label: 'No.' }, { key: 'name', label: 'Employee' }, { key: 'id_number', label: 'ID number' }, { key: 'tin', label: 'TIN' }, { key: 'gross', label: 'Gross', right: 1, fmt: money },
      { key: 'taxable_income', label: 'Taxable', right: 1, fmt: money }, { key: 'tax_before_credit', label: 'Tax', right: 1, fmt: money }, { key: 'tax_credit', label: 'Credit', right: 1, fmt: money }, { key: 'paye', label: 'PAYE', right: 1, fmt: money }],
      r.rows, { empty: `No payroll run for ${periodLabel(period)}.` })}`;
  $('#pp').onchange = e => location.hash = `#/hrm?tab=paye&period=${e.target.value}`;
  const pc = $('#pcsv');
  if (pc) pc.onclick = () => download(`paye-${period}.csv`, [['Employee no', 'Name', 'ID number', 'TIN', 'Gross', 'Taxable income', 'Tax before credit', 'Tax credit', 'PAYE']].concat(r.rows.map(x => [x.code, x.name, x.id_number, x.tin, x.gross, x.taxable_income, x.tax_before_credit, x.tax_credit, x.paye])).concat([['', 'TOTAL', '', '', r.totals.gross, r.totals.taxable, '', '', r.totals.paye]]));
  const rm = $('#remit');
  if (rm) rm.onclick = () => {
    const f = [{ key: 'amount', label: 'Amount paid to RSL', type: 'number', default: r.totals.paye }, { key: 'from_account', label: 'Paid from', type: 'select', options: [{ value: '1050', label: 'Bank' }, { value: '1000', label: 'Cash' }, { value: '1020', label: 'Mobile money' }] }, { key: 'reference', label: 'Reference / receipt no.' }];
    modal({ title: `PAYE payment for ${periodLabel(period)}`, size: 'sm', body: formHtml(f), actions: [{ label: 'Cancel' }, { label: 'Record', cls: 'btn-primary', onClick: async (c, x) => { await POST('/hrm/paye-remit', { ...readForm(x, f), period }); c(); toast('PAYE payment recorded'); } }] });
  };
}

// ---------------------------------------------------------------- settings
async function settingsTab(root, view) {
  const { settings: s, paye_tables } = await GET('/hrm/settings');
  const admin = can('settings');
  root.innerHTML = `<div class="cols cols-2">
    <div class="card"><h3>Module</h3>
      <label class="toggle-row"><input type="checkbox" id="hOn" ${s.enabled ? 'checked' : ''} ${admin ? '' : 'disabled'}><span><b>HR & Payroll module</b><br><small class="muted">Employees, leave and payroll screens. Turning it off hides the module; no data is deleted.</small></span></label>
      <label class="toggle-row"><input type="checkbox" id="pOn" ${s.paye_enabled ? 'checked' : ''} ${admin ? '' : 'disabled'}><span><b>Deduct Lesotho PAYE</b><br><small class="muted">Default for new payroll runs. You can still switch PAYE off for a single run, or for individual employees.</small></span></label>
      ${admin ? '<button class="btn btn-primary" id="hSave">Save</button>' : '<p class="muted">Only an administrator can change these.</p>'}
      <h3 style="margin-top:20px">PAYE calculator</h3>
      <div class="row"><input type="number" id="cIn" placeholder="Monthly taxable income" step="0.01" style="max-width:220px"><input type="month" id="cP" value="${thisPeriod()}" style="max-width:170px"><button class="btn" id="cGo">Calculate</button></div>
      <div id="cOut" class="muted" style="margin-top:8px"></div></div>
    <div class="card"><div class="row" style="margin-bottom:8px"><h3 style="flex:1;margin:0">Lesotho PAYE tables</h3>${admin ? '<button class="btn btn-sm" id="nt">＋ New tax year</button>' : ''}</div>
      ${tableHtml([{ key: 'name', label: 'Name' }, { key: 'effective_from', label: 'From', fmt: d }, { key: 'band_monthly', label: '20% band (monthly)', right: 1, fmt: money },
        { key: 'lower_rate', label: 'Lower', right: 1, fmt: v => Number(v) + '%' }, { key: 'upper_rate', label: 'Upper', right: 1, fmt: v => Number(v) + '%' }, { key: 'credit_monthly', label: 'Tax credit', right: 1, fmt: money }],
        paye_tables, { rowAttr: t => admin ? `data-t="${t.id}"` : '' })}
      <p class="muted" style="font-size:12px;margin-bottom:0">Pre-loaded from Revenue Services Lesotho: 2026/27 (from 1 April 2026) – 20% on the first M6,480 a month, 30% above, less a M1,020 monthly credit; 2025/26 – M6,170 band, M970 credit. When the Minister of Finance announces new rates, add a new tax year with its effective date — earlier months keep using the old table.</p></div>
  </div>
  <div class="cols cols-2" style="margin-top:14px"><div class="card" id="ltc"></div><div class="card" id="dpc"></div></div>`;
  if (admin) $('#hSave').onclick = async () => {
    try { await PUT('/hrm/settings', { enabled: $('#hOn').checked, paye_enabled: $('#pOn').checked }); toast('Saved'); setTimeout(() => location.reload(), 400); }
    catch (e) { err(e); }
  };
  $('#cGo').onclick = async () => {
    const x = await GET(`/hrm/paye-calc?taxable=${$('#cIn').value || 0}&period=${$('#cP').value}`);
    $('#cOut').innerHTML = x.table ? `${esc(x.table.name)}: tax ${money(x.tax_before_credit)} − credit ${money(x.tax_credit)} = <b style="color:var(--ink)">PAYE ${money(x.paye)}</b>` : 'No PAYE table for that month';
  };
  const tf = [{ key: 'name', label: 'Name', required: true }, { key: 'effective_from', label: 'Effective from', type: 'date', required: true },
    { key: 'band_monthly', label: 'Lower band – monthly limit', type: 'number', step: '0.01' }, { key: 'credit_monthly', label: 'Tax credit – monthly', type: 'number', step: '0.01' },
    { key: 'lower_rate', label: 'Lower rate %', type: 'number' }, { key: 'upper_rate', label: 'Upper rate %', type: 'number' }, { key: 'source', label: 'Source / notice', span: 2 }];
  const nt = $('#nt');
  if (nt) nt.onclick = () => modal({ title: 'New PAYE tax year', size: 'lg', body: formHtml(tf, { lower_rate: 20, upper_rate: 30 }, { ctx: 'hrm_tax' }),
    actions: [{ label: 'Cancel' }, { label: 'Add', cls: 'btn-primary', onClick: async (c, r) => { await POST('/hrm/paye-tables', readForm(r, tf)); c(); toast('Tax table added'); settingsTab(root, view); } }] });
  $$('[data-t]', root).forEach(tr => tr.onclick = () => {
    const t = paye_tables.find(x => String(x.id) === tr.dataset.t);
    modal({ title: 'Edit ' + t.name, size: 'lg', body: formHtml(tf, { ...t, effective_from: d(t.effective_from) }, { ctx: 'hrm_tax' }),
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await PUT('/hrm/paye-tables/' + t.id, readForm(r, tf)); c(); toast('Saved'); settingsTab(root, view); } }] });
  });
  if (!s.enabled) { $('#ltc').innerHTML = '<p class="muted">Turn the module on to manage leave types and departments.</p>'; $('#dpc').remove(); return; }
  const lts = await GET('/hrm/leave-types');
  $('#ltc').innerHTML = `<div class="row" style="margin-bottom:8px"><h3 style="flex:1;margin:0">Leave types</h3><button class="btn btn-sm" id="nlt">＋ Leave type</button></div>` +
    tableHtml([{ key: 'name', label: 'Type' }, { key: 'days_per_year', label: 'Days / year', right: 1 }, { key: 'paid', label: 'Paid', fmt: v => v ? 'yes' : 'no' }], lts, { rowAttr: t => `data-lt="${t.id}"` }) +
    '<p class="muted" style="font-size:12px;margin-bottom:0">Defaults follow common Lesotho practice; check them against the Labour Code and your contracts.</p>';
  const lf = [{ key: 'name', label: 'Name', required: true }, { key: 'days_per_year', label: 'Days per year (0 = unlimited / not tracked)', type: 'number' }, { key: 'paid', label: 'Paid leave', type: 'checkbox', default: 1 }];
  $('#nlt').onclick = () => modal({ title: 'New leave type', size: 'sm', body: formHtml(lf, {}, { ctx: 'leavetype' }), actions: [{ label: 'Cancel' }, { label: 'Add', cls: 'btn-primary', onClick: async (c, r) => { await POST('/hrm/leave-types', readForm(r, lf)); c(); settingsTab(root, view); } }] });
  $$('[data-lt]', root).forEach(tr => tr.onclick = () => { const t = lts.find(x => String(x.id) === tr.dataset.lt);
    modal({ title: 'Edit ' + t.name, size: 'sm', body: formHtml([...lf, { key: 'active', label: 'Active', type: 'checkbox' }], t, { ctx: 'leavetype' }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await PUT('/hrm/leave-types/' + t.id, readForm(r, [...lf, { key: 'active', type: 'checkbox' }])); c(); settingsTab(root, view); } }] }); });
  const deps = await GET('/hrm/departments');
  $('#dpc').innerHTML = `<div class="row" style="margin-bottom:8px"><h3 style="flex:1;margin:0">Departments</h3><button class="btn btn-sm" id="nd">＋ Department</button></div>
    <ul class="list-plain">${deps.map(x => `<li><span>${esc(x.name)}</span><button class="icon-btn" data-dd="${x.id}" title="Remove">✕</button></li>`).join('')}</ul>`;
  $('#nd').onclick = async () => { const n = await promptBox('New department'); if (n) { await POST('/hrm/departments', { name: n }); settingsTab(root, view); } };
  $$('[data-dd]', root).forEach(b => b.onclick = async () => { await DEL('/hrm/departments/' + b.dataset.dd); settingsTab(root, view); });
}
