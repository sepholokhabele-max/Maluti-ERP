// Recruitment & appraisals: job openings with advert, applicant board by stage, applicant file with CV, hire into HR;
// appraisals with weighted scores, goals and salary increase
import { GET, POST, PUT, esc, $, $$, toast, err, can, money, modal, formHtml, readForm, tableHtml, badge, page, d, dt, today, query, printHtml, attachPanel, state } from './core.js';
import { L } from './i18n.js';

const STAGES = [['new', 'New'], ['screening', 'Screening'], ['interview', 'Interview'], ['offer', 'Offer'], ['hired', 'Hired'], ['rejected', 'Rejected'], ['withdrawn', 'Withdrawn']];
const SB = { new: 'draft', screening: 'posted', interview: 'partial', offer: 'posted', hired: 'paid', rejected: 'cancelled', withdrawn: 'closed', open: 'ok', draft: 'draft', closed: 'closed', filled: 'paid', discussed: 'posted' };
const sb = x => badge(x, SB[x] || '');
const stars = n => n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '';
const TYPES = [['permanent', 'Permanent'], ['fixed_term', 'Fixed-term contract'], ['casual', 'Casual'], ['intern', 'Intern']];
const SOURCES = [['walk_in', 'Walk-in / CV dropped off'], ['referral', 'Referred by staff'], ['facebook', 'Facebook'], ['whatsapp', 'WhatsApp'], ['newspaper', 'Newspaper'], ['radio', 'Radio'], ['website', 'Website'], ['other', 'Other']];

export async function recruitment(view) {
  const q = query(); const tab = q.tab || 'jobs';
  const tabs = [['jobs', L('Jobs & applicants', 'Mesebetsi le bakopi')], ['appraisals', L('Appraisals', 'Litlhahlobo tsa basebetsi')]];
  view.innerHTML = page(L('Recruitment & appraisals', 'Ho hira le tlhahlobo'), tab === 'jobs' ? `<button class="btn btn-primary" id="nj">＋ ${L('Job opening', 'Mosebetsi o bulehileng')}</button>` : `<button class="btn btn-primary" id="na">＋ ${L('Appraisal', 'Tlhahlobo')}</button>`,
    `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/recruitment?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="rb"></div>`);
  const rb = $('#rb');
  if (tab === 'jobs') {
    const [st, jobs] = await Promise.all([GET('/recruitment/stats'), GET('/recruitment/openings')]);
    rb.innerHTML = `<div class="cols cols-4" style="margin-bottom:14px"><div class="kpi"><div class="label">${L('Open jobs', 'Mesebetsi e bulehileng')}</div><div class="value">${st.open_jobs}</div></div>
      <div class="kpi"><div class="label">${L('To screen', 'Ho hlahlojoa')}</div><div class="value">${st.to_screen}</div></div><div class="kpi"><div class="label">${L('Interviews', 'Lipuisano')}</div><div class="value">${st.interviews}</div><div class="hint">${st.interviews_week} ${L('in the next 7 days', 'matsatsing a 7 a tlang')}</div></div>
      <div class="kpi"><div class="label">${L('Hired (90 days)', 'Ba hiriloeng (matsatsi a 90)')}</div><div class="value">${st.hired_90}</div><div class="hint">${st.by_source.filter(x => x.hired).map(x => `${x.source.replace('_', ' ')} ${x.hired}`).join(' · ')}</div></div></div>
      <div class="card">${tableHtml([{ key: 'title', label: 'Job' }, { key: 'department_name', label: 'Department' }, { key: 'positions', label: 'Posts', right: 1 }, { key: 'closing_date', label: 'Closes', fmt: d },
        { key: 'applicants', label: 'Applicants', right: 1 }, { key: 'active', label: 'In progress', right: 1 }, { key: 'hired', label: 'Hired', right: 1 }, { key: 'status', label: 'Status', html: 1, fmt: sb }], jobs, { rowAttr: j => `data-j="${j.id}"`, empty: L('No job openings yet.', 'Ha ho mesebetsi e bulehileng.') })}</div>`;
    $('#nj').onclick = () => openingDialog(null, id => { location.hash = '#/opening/' + id; });
    $$('[data-j]', rb).forEach(tr => tr.onclick = () => { location.hash = '#/opening/' + tr.dataset.j; });
  }
  if (tab === 'appraisals') {
    const period = q.period || String(new Date().getFullYear());
    const sum = await GET('/appraisals/summary?period=' + encodeURIComponent(period));
    rb.innerHTML = `<div class="card"><div class="row" style="margin-bottom:8px"><label>${L('Period', 'Nako')} <input id="pp" value="${esc(period)}" style="width:120px"></label><span class="spacer"></span><b>${sum.done} / ${sum.total}</b>&nbsp;${L('closed', 'li koetsoe')}${can('settings') ? '<button class="btn btn-sm" id="crit" style="margin-left:10px">What is scored</button>' : ''}</div>
      ${tableHtml([{ key: 'name', label: 'Employee' }, { key: 'job_title', label: 'Job' }, { key: 'department_name', label: 'Department' }, { key: 'overall', label: 'Score (1–5)', right: 1, html: 1, fmt: v => v == null ? '' : `<b style="color:${v < 2.5 ? 'var(--bad)' : v >= 4 ? 'var(--ok)' : 'inherit'}">${Number(v).toFixed(2)}</b>` },
        { key: 'status', label: 'Status', html: 1, fmt: (x, r) => x ? sb(x) : `<button class="btn btn-sm" data-start="${r.employee_id}">${L('Start', 'Qala')}</button>` }], sum.rows, { rowAttr: r => r.appraisal_id ? `data-p="${r.appraisal_id}"` : '', empty: 'No active employees.' })}</div>`;
    $('#pp').onchange = () => { location.hash = '#/recruitment?tab=appraisals&period=' + encodeURIComponent($('#pp').value); };
    $$('[data-p]', rb).forEach(tr => tr.onclick = () => { location.hash = '#/appraisal/' + tr.dataset.p; });
    $$('[data-start]', rb).forEach(b => b.onclick = async e => { e.stopPropagation(); try { const p = await POST('/appraisals', { employee_id: Number(b.dataset.start), period }); location.hash = '#/appraisal/' + p.id; } catch (x) { err(x); } });
    $('#na').onclick = () => toast(L('Click "Start" next to the employee', 'Tobetsa "Qala" pel\'a mosebetsi'));
    if ($('#crit')) $('#crit').onclick = async () => { const s = await GET('/appraisals/settings');
      modal({ title: 'What is scored', size: 'lg', body: `<p class="muted">One per line: <code>name | weight</code>. Weight 2 counts double.</p><textarea id="cr" rows="9">${esc(s.criteria.map(c => `${c.name} | ${c.weight}`).join('\n'))}</textarea>`,
        actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await PUT('/appraisals/settings', { criteria: r.querySelector('#cr').value.split('\n').map(l => { const [name, w] = l.split('|'); return { name: (name || '').trim(), weight: Number(w) || 1 }; }) }); c(); toast('Saved'); } }] }); };
  }
}

async function openingDialog(o, done) {
  const deps = await GET('/hrm/departments').catch(() => []);
  const f = [{ key: 'title', label: 'Job title', required: true }, { key: 'department_id', label: 'Department', type: 'select', numeric: true, options: [{ value: '', label: '—' }, ...deps.map(x => ({ value: x.id, label: x.name }))] },
    { key: 'location', label: 'Where (branch / site)' }, { key: 'employment_type', label: 'Type', type: 'select', options: TYPES.map(([value, label]) => ({ value, label })) }, { key: 'positions', label: 'Number of posts', type: 'number' },
    { key: 'closing_date', label: 'Closing date', type: 'date' }, { key: 'salary_from', label: 'Salary from (M / month)', type: 'number', nullable: true }, { key: 'salary_to', label: 'Salary to', type: 'number', nullable: true },
    { key: 'description', label: 'The job – what the person will do', type: 'textarea', rows: 4, span: 2 }, { key: 'requirements', label: 'Requirements – qualifications, experience, licence…', type: 'textarea', rows: 4, span: 2 },
    { key: 'how_to_apply', label: 'How to apply (printed on the advert)', span: 2 }, ...(o ? [{ key: 'status', label: 'Status', type: 'select', options: ['draft', 'open', 'closed', 'filled'].map(x => ({ value: x, label: x })) }] : [])];
  modal({ title: o ? o.title : L('New job opening', 'Mosebetsi o mocha'), size: 'lg', body: formHtml(f, o ? { ...o, closing_date: d(o.closing_date) } : { positions: 1, employment_type: 'permanent', how_to_apply: `Bring your CV and certified copies to ${state.company.address || 'our office'} or send to ${state.company.email || state.company.phone || ''}.` }, { ctx: 'opening' }),
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); const x = o ? await PUT('/recruitment/openings/' + o.id, v) : await POST('/recruitment/openings', v); c(); done(x.id); } }] });
}
function applicantDialog(openingId, done) {
  const f = [{ key: 'first_name', label: 'First name', required: true }, { key: 'last_name', label: 'Surname' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'id_number', label: 'ID number' },
    { key: 'source', label: 'Heard about the job from', type: 'select', options: SOURCES.map(([value, label]) => ({ value, label })) }, { key: 'rating', label: 'First impression (1–5 stars)', type: 'number', nullable: true }, { key: 'notes', label: 'Notes from the CV', type: 'textarea', rows: 3, span: 2 }];
  modal({ title: L('New applicant', 'Mokopi e mocha'), size: 'lg', body: formHtml(f, { source: 'walk_in' }, { ctx: 'applicant' }) + `<small class="help-note">${L('Attach the CV and certificates on the applicant\'s page after saving.', 'Hokela CV le litifikeiti leqepheng la mokopi ka mor\'a ho boloka.')}</small>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const o = await POST('/recruitment/applicants', { ...readForm(r, f), opening_id: openingId }); c(); done(o.id); } }] });
}

export async function opening(view, [idq]) {
  const id = (idq || '').split('?')[0]; const o = await GET('/recruitment/openings/' + id);
  const cols = STAGES.slice(0, 5);
  view.innerHTML = page(o.title, `<button class="btn" id="ad">🖨 ${L('Advert', 'Papatso')}</button><button class="btn" id="oe">Edit</button><button class="btn btn-primary" id="np">＋ ${L('Applicant', 'Mokopi')}</button>`,
    `<p>${sb(o.status)} ${esc(o.department_name || '')} ${o.location ? '· ' + esc(o.location) : ''} · ${o.positions} post(s)${o.closing_date ? ` · closes ${esc(d(o.closing_date))}` : ''}${o.salary_from ? ` · ${money(o.salary_from)}${o.salary_to ? '–' + money(o.salary_to) : ''}` : ''}</p>
    <div class="pipe" style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px">${cols.map(([k, l]) => { const xs = o.applicants_list.filter(a => a.stage === k);
      return `<div class="card" style="padding:10px;margin:0"><b>${l}</b> <span class="muted">${xs.length}</span>${xs.map(a => `<div class="card" data-a="${a.id}" style="margin:8px 0 0;padding:8px;cursor:pointer;box-shadow:none"><b>${esc(a.first_name)} ${esc(a.last_name || '')}</b><br>
        <small class="muted">${esc(a.phone || '')}${a.files ? ` · 📎${a.files}` : ''}</small>${a.rating ? `<br><small style="color:#b8860b">${stars(a.rating)}</small>` : ''}${a.stage === 'interview' && a.interview_at ? `<br><small>🗓 ${esc(dt(a.interview_at))}</small>` : ''}</div>`).join('')}</div>`; }).join('')}</div>
    ${o.applicants_list.some(a => ['rejected', 'withdrawn'].includes(a.stage)) ? `<div class="card" style="margin-top:12px"><h3>${L('Not taken further', 'Ha ba tsoela pele')}</h3>${tableHtml([{ key: 'first_name', label: 'Name', fmt: (x, a) => `${x} ${a.last_name || ''}` }, { key: 'stage', label: 'Stage', html: 1, fmt: sb }, { key: 'reject_reason', label: 'Reason' }], o.applicants_list.filter(a => ['rejected', 'withdrawn'].includes(a.stage)), { rowAttr: a => `data-a="${a.id}"` })}</div>` : ''}`, { back: '#/recruitment' });
  $('#np').onclick = () => applicantDialog(o.id, aid => { location.hash = '#/applicant/' + aid; });
  $('#oe').onclick = () => openingDialog(o, () => opening(view, [id]));
  $$('[data-a]').forEach(c => c.onclick = () => { location.hash = '#/applicant/' + c.dataset.a; });
  $('#ad').onclick = () => { const co = state.company || {};
    printHtml(`<div style="font-family:Arial;font-size:14px;max-width:700px;margin:auto"><h2 style="margin:0">${esc(co.name || '')}</h2><div>${esc(co.address || '')} · ${esc(co.phone || '')}</div><h1>Vacancy: ${esc(o.title)}</h1>
      <p><b>${esc(TYPES.find(t => t[0] === o.employment_type)[1])}</b>${o.location ? ' · ' + esc(o.location) : ''}${o.positions > 1 ? ` · ${o.positions} posts` : ''}${o.salary_from ? ` · ${money(o.salary_from)}${o.salary_to ? ' – ' + money(o.salary_to) : ''} per month` : ''}</p>
      ${o.description ? `<h3>The job</h3><p style="white-space:pre-wrap">${esc(o.description)}</p>` : ''}${o.requirements ? `<h3>Requirements</h3><p style="white-space:pre-wrap">${esc(o.requirements)}</p>` : ''}
      ${o.how_to_apply ? `<h3>How to apply</h3><p>${esc(o.how_to_apply)}</p>` : ''}${o.closing_date ? `<p><b>Closing date: ${esc(d(o.closing_date))}</b></p>` : ''}<p style="font-size:12px">Only shortlisted candidates will be contacted.</p></div>`); };
}

export async function applicant(view, [idq]) {
  const id = (idq || '').split('?')[0]; const a = await GET('/recruitment/applicants/' + id);
  const done = ['hired', 'rejected', 'withdrawn'].includes(a.stage);
  const next = { new: 'screening', screening: 'interview', interview: 'offer' }[a.stage];
  view.innerHTML = page(`${a.first_name} ${a.last_name || ''}`, `${!done && next ? `<button class="btn btn-primary" id="nx">→ ${STAGES.find(s => s[0] === next)[1]}</button>` : ''}${!done && ['interview', 'offer'].includes(a.stage) ? `<button class="btn btn-ok" id="hi">✓ ${L('Hire', 'Hira')}</button>` : ''}${!done ? `<button class="btn btn-danger" id="rj">${L('Not suitable', 'Ha a tšoanele')}</button>` : ''}<button class="btn" id="ae">Edit</button>`,
    `<div class="cols cols-4" style="margin-bottom:14px"><div class="kpi"><div class="label">${L('Job', 'Mosebetsi')}</div><div class="value" style="font-size:18px"><a href="#/opening/${a.opening_id}">${esc(a.job_title)}</a></div></div>
      <div class="kpi"><div class="label">Stage</div><div class="value" style="font-size:18px">${sb(a.stage)}</div><div class="hint">${a.stage === 'interview' && a.interview_at ? '🗓 ' + esc(dt(a.interview_at)) + (a.interviewer ? ' · ' + esc(a.interviewer) : '') : ''}${a.reject_reason ? esc(a.reject_reason) : ''}</div></div>
      <div class="kpi"><div class="label">Contact</div><div class="value" style="font-size:16px">${esc(a.phone || '–')}</div><div class="hint">${esc(a.email || '')} ${a.id_number ? '· ID ' + esc(a.id_number) : ''}</div></div>
      <div class="kpi"><div class="label">${a.employee_id ? 'Employee' : 'Rating'}</div><div class="value" style="font-size:18px">${a.employee_id ? `<a href="#/employee/${a.employee_id}">${esc(a.employee_code || 'HR file')}</a>` : `<span style="color:#b8860b">${stars(a.rating) || '–'}</span>`}</div>${a.salary_offered ? `<div class="hint">offered ${money(a.salary_offered)}${a.start_date ? ' from ' + esc(d(a.start_date)) : ''}</div>` : ''}</div></div>
    <div class="cols cols-2" style="align-items:start"><div class="card"><h3>Notes</h3><p style="white-space:pre-wrap">${esc(a.notes || '—')}</p><small class="muted">source: ${esc(a.source.replace('_', ' '))} · applied ${esc(d(a.created_at))}</small></div><div class="card" id="files"></div></div>`, { back: '#/opening/' + a.opening_id });
  attachPanel($('#files'), 'applicant', a.id, { title: L('CV, ID and certificates', 'CV, ID le litifikeiti') });
  const reload = () => applicant(view, [id]);
  const stageDlg = (stage, title, extra = []) => { const f = [...extra, { key: 'notify', label: L('Send the applicant an SMS', 'Romela mokopi SMS'), type: 'checkbox' }];
    modal({ title, body: formHtml(f, { notify: a.phone ? 1 : 0, interview_at: '', salary_offered: a.salary_offered }, { ctx: 'appstage' }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => {
      const o = await POST(`/recruitment/applicants/${a.id}/stage`, { ...readForm(r, f), stage }); c(); if (o.sms) toast(`SMS ${o.sms}`, /not/.test(o.sms) ? 'err' : 'ok'); reload(); } }] }); };
  if ($('#nx')) $('#nx').onclick = () => next === 'interview' ? stageDlg('interview', L('Invite for interview', 'Memela puisanong'), [{ key: 'interview_at', label: 'Date and time', type: 'datetime-local', required: true }, { key: 'interviewer', label: 'Interviewer(s)' }])
    : next === 'offer' ? stageDlg('offer', L('Make an offer', 'Etsa tlhahiso'), [{ key: 'salary_offered', label: 'Salary offered (M / month)', type: 'number' }, { key: 'start_date', label: 'Start date', type: 'date' }])
    : POST(`/recruitment/applicants/${a.id}/stage`, { stage: next }).then(reload).catch(err);
  if ($('#rj')) $('#rj').onclick = () => stageDlg('rejected', L('Not suitable', 'Ha a tšoanele'), [{ key: 'reject_reason', label: 'Reason (kept for your records)' }]);
  if ($('#hi')) $('#hi').onclick = () => { const f = [...(a.last_name ? [] : [{ key: 'last_name', label: 'Surname', required: true }]), { key: 'basic_salary', label: 'Basic salary (M / month)', type: 'number', required: true }, { key: 'hire_date', label: 'Start date', type: 'date', required: true }];
    modal({ title: L(`Hire ${a.first_name}`, `Hira ${a.first_name}`), body: formHtml(f, { basic_salary: a.salary_offered, hire_date: d(a.start_date) || today() }, { ctx: 'apphire' }) + `<small class="help-note">${L('An employee is created in HR & Payroll with this salary; the CV and documents are copied to their file.', 'Mosebetsi o etsoa ho HR & Payroll.')}</small>`,
      actions: [{ label: 'Cancel' }, { label: 'Hire', cls: 'btn-primary', onClick: async (c, r) => { const o = await POST(`/recruitment/applicants/${a.id}/hire`, readForm(r, f)); c(); toast(L('Hired – now in HR & Payroll', 'O hiriloe')); reload(); if (o.filled) toast(L('All posts filled – job closed', 'Mesebetsi eohle e tletse')); } }] }); };
  $('#ae').onclick = () => { const f = [{ key: 'first_name', label: 'First name', required: true }, { key: 'last_name', label: 'Surname' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'id_number', label: 'ID number' }, { key: 'rating', label: 'Rating 1–5', type: 'number', nullable: true }, { key: 'notes', label: 'Notes', type: 'textarea', rows: 5, span: 2 }];
    modal({ title: 'Edit', size: 'lg', body: formHtml(f, a, { ctx: 'applicant' }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await PUT('/recruitment/applicants/' + a.id, readForm(r, f)); c(); reload(); } }] }); };
}

export async function appraisal(view, [idq]) {
  const id = (idq || '').split('?')[0]; const p = await GET('/appraisals/' + id);
  const open = p.status !== 'closed';
  view.innerHTML = page(`${p.employee_name} · ${p.period}`, `${open ? `<button class="btn" id="sv">${L('Save', 'Boloka')}</button><button class="btn btn-primary" id="cl">✓ ${L('Close', 'Koala')}</button>` : ''}<button class="btn" id="pr">🖨</button>`,
    `<div class="cols cols-4" style="margin-bottom:14px"><div class="kpi"><div class="label">${esc(p.job_title || '')}</div><div class="value" style="font-size:18px">${esc(p.department_name || '–')}</div><div class="hint">reviewed by ${esc(p.reviewer_name || '')} on ${esc(d(p.review_date))}</div></div>
      <div class="kpi"><div class="label">Overall (1–5)</div><div class="value" id="ov">${p.overall == null ? '–' : Number(p.overall).toFixed(2)}</div></div><div class="kpi"><div class="label">Status</div><div class="value" style="font-size:18px">${sb(p.status)}</div>${p.increase_applied ? `<div class="hint">increase applied</div>` : ''}</div>
      <div class="kpi"><div class="label">Salary</div><div class="value" style="font-size:18px">${money(p.basic_salary)}</div>${p.previous.length ? `<div class="hint">before: ${p.previous.map(x => `${esc(x.period)} ${x.overall == null ? '–' : Number(x.overall).toFixed(1)}`).join(' · ')}</div>` : ''}</div></div>
    <div class="card" style="margin-bottom:12px"><h3>${L('Scores – 1 poor, 3 meets expectations, 5 excellent', 'Matšoao – 1 e fokola, 3 e lekane, 5 e ntle haholo')}</h3><table class="grid"><thead><tr><th>${L('Area', 'Karolo')}</th><th class="r">Weight</th><th>Score</th><th>Comment</th></tr></thead><tbody>
      ${p.scores.map(x => `<tr data-s="${x.id}"><td>${esc(x.criterion)}</td><td class="r">${Number(x.weight)}</td><td><div class="row" style="gap:4px">${[1, 2, 3, 4, 5].map(n => `<label style="display:inline-flex;gap:2px"><input type="radio" name="s${x.id}" value="${n}" ${x.score === n ? 'checked' : ''} ${open ? '' : 'disabled'}>${n}</label>`).join('')}</div></td>
        <td><input data-c value="${esc(x.comment || '')}" ${open ? '' : 'disabled'}></td></tr>`).join('')}</tbody></table></div>
    <div class="card"><div class="form-grid">${[['strengths', L('Strengths – what went well', 'Matla – se tsamaileng hantle')], ['improvements', L('To improve', 'Se lokelang ho ntlafatsoa')], ['goals', L('Goals for the next period', 'Lipheo tsa nako e tlang')], ['employee_comment', L('Employee\'s comment', 'Maikutlo a mosebetsi')]].map(([k, l]) => `<label class="field"><span>${l}</span><textarea name="${k}" rows="3" ${open ? '' : 'disabled'}>${esc(p[k] || '')}</textarea></label>`).join('')}
      <label class="field"><span>${L('Salary increase agreed (%)', 'Keketseho ea moputso (%)')}</span><input name="increase_pct" type="number" step="any" value="${p.increase_pct ?? ''}" ${open ? '' : 'disabled'}><small class="help-note">${L('When you close the appraisal you can put it on the basic salary from the next payroll.', 'Ha u koala u ka e kenya moputsong.')}</small></label></div></div>`, { back: '#/recruitment?tab=appraisals&period=' + encodeURIComponent(p.period) });
  const body = () => ({ scores: $$('[data-s]').map(tr => ({ id: Number(tr.dataset.s), score: (tr.querySelector('input[type=radio]:checked') || {}).value || null, comment: tr.querySelector('[data-c]').value })),
    ...Object.fromEntries(['strengths', 'improvements', 'goals', 'employee_comment', 'increase_pct'].map(k => [k, $(`[name=${k}]`).value])), status: 'discussed' });
  if ($('#sv')) $('#sv').onclick = async () => { try { const o = await PUT('/appraisals/' + p.id, body()); $('#ov').textContent = o.overall == null ? '–' : Number(o.overall).toFixed(2); toast(L('Saved', 'E bolokiloe')); } catch (e) { err(e); } };
  if ($('#cl')) $('#cl').onclick = async () => { try { const o = await PUT('/appraisals/' + p.id, body());
    modal({ title: L('Close the appraisal', 'Koala tlhahlobo'), body: `<p>Overall <b>${o.overall == null ? '–' : Number(o.overall).toFixed(2)}</b>.</p>${Number(o.increase_pct) > 0 ? `<label class="check"><input type="checkbox" id="ap" checked> <span>${L(`Raise the basic salary by ${o.increase_pct}% to`, `Eketsa moputso ka ${o.increase_pct}% ho`)} ${money(Number(o.basic_salary) * (1 + Number(o.increase_pct) / 100))}</span></label>` : ''}`,
      actions: [{ label: 'Cancel' }, { label: 'Close', cls: 'btn-primary', onClick: async (c, r) => { const x = await POST(`/appraisals/${p.id}/close`, { apply_increase: r.querySelector('#ap') ? r.querySelector('#ap').checked : false }); c(); toast(x.new_salary ? `${L('New salary', 'Moputso o mocha')} ${money(x.new_salary)}` : L('Closed', 'E koetsoe')); appraisal(view, [id]); } }] });
  } catch (e) { err(e); } };
  $('#pr').onclick = () => printHtml(`<div style="font-family:Arial;font-size:13px;max-width:720px;margin:auto"><h2>${esc(state.company.name || '')} – Staff appraisal ${esc(p.period)}</h2><p><b>${esc(p.employee_name)}</b> · ${esc(p.job_title || '')} · reviewed by ${esc(p.reviewer_name || '')} on ${esc(d(p.review_date))}</p>
    <table border="1" cellpadding="5" style="border-collapse:collapse;width:100%"><tr><th align="left">Area</th><th>Weight</th><th>Score</th><th align="left">Comment</th></tr>${p.scores.map(x => `<tr><td>${esc(x.criterion)}</td><td align="center">${Number(x.weight)}</td><td align="center">${x.score || ''}</td><td>${esc(x.comment || '')}</td></tr>`).join('')}
    <tr><td colspan="2"><b>Overall</b></td><td align="center"><b>${p.overall == null ? '' : Number(p.overall).toFixed(2)}</b></td><td></td></tr></table>
    ${['strengths', 'improvements', 'goals', 'employee_comment'].map(k => `<h4>${({ strengths: 'Strengths', improvements: 'To improve', goals: 'Goals', employee_comment: 'Employee\'s comment' })[k]}</h4><p style="white-space:pre-wrap">${esc(p[k] || '')}</p>`).join('')}
    <table style="width:100%;margin-top:30px"><tr><td>Employee: ______________________</td><td>Manager: ______________________</td></tr></table></div>`);
}
