// School fees: learners & guardians, classes, fee structure, billing runs, arrears, statements
import { remindOne } from './remindui.js';
import { state, GET, POST, PUT, esc, $, $$, toast, err, can, money, qty, modal, confirmBox, formHtml, readForm, tableHtml, badge, page, d, today, plusDays, query, filesCard, printHtml } from './core.js';

const PER = [['term', 'Per term'], ['month', 'Per month'], ['year', 'Per year'], ['once', 'Once (registration, uniform…)']];
const methods = async () => (await GET('/payment-methods')).filter(m => m.active && m.kind !== 'account');

export async function school(view) {
  const q = query(); const tab = q.tab || 'learners';
  const tabs = [['learners', 'Learners'], ['classes', 'Classes'], ['fees', 'Fees'], ['billing', 'Billing'], ['arrears', 'Arrears']];
  view.innerHTML = page('School fees', `<button class="btn btn-primary" id="nl">＋ New learner</button>`, `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/school?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="sb"></div>`);
  $('#nl').onclick = () => learnerDialog(null, l => { location.hash = '#/learner/' + l.id; });
  const sb = $('#sb');
  const classes = await GET('/school/classes');
  if (tab === 'learners') {
    const rows = await GET(`/learners?status=${q.status || 'enrolled'}${q.class_id ? '&class_id=' + q.class_id : ''}${q.q ? '&q=' + encodeURIComponent(q.q) : ''}`);
    const owed = rows.reduce((t, x) => t + x.balance, 0);
    sb.innerHTML = `<div class="row wrap" style="margin-bottom:8px"><select id="fc"><option value="">All classes</option>${classes.map(c => `<option value="${c.id}" ${String(c.id) === String(q.class_id || '') ? 'selected' : ''}>${esc(c.name)} (${c.learners})</option>`).join('')}</select>
      <select id="fs">${[['enrolled', 'Enrolled'], ['left', 'Left'], ['graduated', 'Graduated'], ['all', 'All']].map(([k, l]) => `<option value="${k}" ${k === (q.status || 'enrolled') ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <input id="fq" placeholder="Name, admission no., parent or phone" value="${esc(q.q || '')}" style="max-width:280px"><span class="spacer"></span><span class="muted">${rows.length} learners · ${money(owed)} owed</span></div>
      <div class="card">${tableHtml([{ key: 'admission_no', label: 'Adm. no.' }, { key: 'name', label: 'Learner' }, { key: 'class_name', label: 'Class' }, { key: 'guardian_name', label: 'Parent / guardian' }, { key: 'guardian_phone', label: 'Phone' },
        { key: 'bursary_pct', label: 'Bursary', right: 1, fmt: v => Number(v) ? Number(v) + '%' : '' }, { key: 'balance', label: 'Owes', right: 1, html: 1, fmt: v => v > 0 ? `<b class="neg">${money(v)}</b>` : '' }], rows,
        { rowAttr: x => `data-id="${x.id}"`, empty: classes.length ? 'No learners here.' : 'Add classes first (Classes tab), then learners.' })}</div>`;
    const go = () => { location.hash = `#/school?tab=learners&class_id=${$('#fc').value}&status=${$('#fs').value}&q=${encodeURIComponent($('#fq').value)}`; };
    $('#fc').onchange = go; $('#fs').onchange = go; let t; $('#fq').oninput = () => { clearTimeout(t); t = setTimeout(go, 500); };
    $$('[data-id]', sb).forEach(tr => tr.onclick = () => { location.hash = '#/learner/' + tr.dataset.id; });
  }
  if (tab === 'classes') {
    sb.innerHTML = `<div class="card"><div class="row" style="margin-bottom:8px"><span class="spacer"></span><button class="btn" id="pro">⬆ End of year: move everyone up</button><button class="btn btn-primary" id="nc">＋ Class</button></div>
      ${tableHtml([{ key: 'name', label: 'Class' }, { key: 'grade', label: 'Grade (for fees)' }, { key: 'teacher', label: 'Teacher' }, { key: 'learners', label: 'Learners', right: 1, fmt: (v, c) => `${v}${c.capacity ? ' / ' + c.capacity : ''}` },
        { key: 'next_class_name', label: 'Moves up to', fmt: v => v || '— leaves school —' }], classes, { rowAttr: c => `data-id="${c.id}"`, empty: 'No classes yet.' })}</div>`;
    const dlg = c => {
      const f = [{ key: 'name', label: 'Class name', required: true }, { key: 'grade', label: 'Grade', required: true }, { key: 'sort', label: 'Order', type: 'number' }, { key: 'teacher', label: 'Class teacher' },
        { key: 'capacity', label: 'Maximum learners', type: 'number', nullable: true }, { key: 'next_class_id', label: 'Moves up to', type: 'select', numeric: true, options: [{ value: '', label: '— final class (learners graduate) —' }, ...classes.filter(x => !c || x.id !== c.id).map(x => ({ value: x.id, label: x.name }))] }];
      modal({ title: c ? c.name : 'New class', body: formHtml(f, c || { sort: classes.length + 1 }, { ctx: 'sclass' }), actions: [{ label: 'Cancel' },
        { label: 'Save', cls: 'btn-primary', onClick: async (cl, r) => { const v = readForm(r, f); if (c) await PUT('/school/classes/' + c.id, v); else await POST('/school/classes', v); cl(); school(view); } }] });
    };
    $('#nc').onclick = () => dlg(null);
    $$('[data-id]', sb).forEach(tr => tr.onclick = () => dlg(classes.find(c => String(c.id) === tr.dataset.id)));
    $('#pro').onclick = () => modal({ title: 'Move learners up a class', body: `<p>Every enrolled learner moves to their class's "moves up to" class. Learners in a final class:</p><label class="row" style="gap:6px"><input type="checkbox" id="gf" checked> are marked as graduated</label><small class="help-note">Do this once, after the last term is billed and before the new year's first billing run.</small>`,
      actions: [{ label: 'Cancel' }, { label: 'Move up', cls: 'btn-primary', onClick: async (c, r) => { const o = await POST('/school/promote', { graduate_final: r.querySelector('#gf').checked }); c(); toast(o.moved.map(m => `${m.from}: ${m.learners} ${m.graduated ? 'graduated' : 'moved up'}`).join(' · ') || 'Nobody to move', 'ok', 8000); school(view); } }] });
  }
  if (tab === 'fees') {
    const fees = await GET('/school/fees'); const s = await GET('/school/settings');
    sb.innerHTML = `<div class="card"><div class="row" style="margin-bottom:8px"><span class="muted">Sibling discount: <b>${Number(s.sibling_discount_pct)}%</b> for the 2nd and later child of the same parent${can('settings') ? ' · <a href="#" id="ss">change</a>' : ''}</span><span class="spacer"></span><button class="btn btn-primary" id="nf">＋ Fee</button></div>
      ${tableHtml([{ key: 'name', label: 'Fee' }, { key: 'grade', label: 'Grade', fmt: v => v || 'all grades' }, { key: 'period', label: 'Charged', fmt: v => (PER.find(p => p[0] === v) || [v, v])[1] },
        { key: 'amount', label: 'Amount', right: 1, fmt: money }, { key: 'optional', label: 'Who pays', fmt: (v, f) => v ? `chosen learners (${f.subscribed})` : 'everyone in the grade' }, { key: 'sibling_discount', label: 'Sibling discount', fmt: v => v ? '✓' : '' }], fees,
        { rowAttr: f => `data-id="${f.id}"`, empty: 'No fees yet – e.g. Tuition Grade 1 per term, Lunch per term (optional), Registration once.' })}</div>`;
    const dlg = f0 => {
      const grades = [...new Set(classes.map(c => c.grade))];
      const f = [{ key: 'name', label: 'Fee', required: true }, { key: 'grade', label: 'Grade', type: 'select', options: [{ value: '', label: 'All grades' }, ...grades.map(g => ({ value: g, label: g }))] },
        { key: 'amount', label: 'Amount (M)', type: 'number', required: true }, { key: 'period', label: 'Charged', type: 'select', options: PER.map(([value, label]) => ({ value, label })) },
        { key: 'optional', label: 'Optional – only learners who choose it (lunch, transport, aftercare)', type: 'checkbox', span: 2 }, { key: 'sibling_discount', label: 'Sibling discount applies', type: 'checkbox', default: 1, span: 2 },
        ...(f0 ? [{ key: 'active', label: 'In use', type: 'checkbox' }] : [])];
      modal({ title: f0 ? f0.name : 'New fee', body: formHtml(f, f0 || { period: 'term', sibling_discount: 1 }, { ctx: 'fee' }), actions: [{ label: 'Cancel' },
        { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); if (f0) await PUT('/school/fees/' + f0.id, v); else await POST('/school/fees', v); c(); school(view); } }] });
    };
    $('#nf').onclick = () => dlg(null);
    $$('[data-id]', sb).forEach(tr => tr.onclick = () => dlg(fees.find(x => String(x.id) === tr.dataset.id)));
    if ($('#ss')) $('#ss').onclick = e => { e.preventDefault(); const f = [{ key: 'sibling_discount_pct', label: 'Sibling discount %', type: 'number' }, { key: 'post_invoices', label: 'Post fee invoices at once (otherwise drafts)', type: 'checkbox' }];
      modal({ title: 'Fee settings', body: formHtml(f, s, { ctx: 'schoolset' }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await PUT('/school/settings', readForm(r, f)); c(); school(view); } }] }); };
  }
  if (tab === 'billing') {
    const runs = await GET('/school/runs');
    const yr = new Date().getFullYear();
    const f = [{ key: 'label', label: 'Name of this billing run', required: true }, { key: 'period', label: 'Which fees', type: 'select', options: PER.map(([value, label]) => ({ value, label })) },
      { key: 'invoice_date', label: 'Invoice date', type: 'date' }, { key: 'due_date', label: 'Pay by', type: 'date' }];
    sb.innerHTML = `<div class="cols" style="grid-template-columns:1fr 2fr;align-items:start"><div class="card"><h3>New billing run</h3>${formHtml(f, { label: `Term 1 ${yr + (new Date().getMonth() > 9 ? 1 : 0)}`, period: 'term', invoice_date: today(), due_date: plusDays(30) }, { ctx: 'feerun' })}
      <div class="row"><span class="spacer"></span><button class="btn" id="pv">Preview</button><button class="btn btn-primary" id="go">Bill learners</button></div><div id="pvr"></div></div>
      <div class="card"><h3>Billed</h3>${tableHtml([{ key: 'label', label: 'Run' }, { key: 'invoice_date', label: 'Date', fmt: d }, { key: 'due_date', label: 'Pay by', fmt: d }, { key: 'invoices', label: 'Learners', right: 1 },
        { key: 'total', label: 'Billed', right: 1, fmt: money }, { key: 'collected', label: 'Collected', right: 1, fmt: money }, { key: 'total', label: '%', right: 1, fmt: (v, r) => v ? Math.round(r.collected / v * 100) + '%' : '' }], runs, { empty: 'Nothing billed yet.' })}</div></div>`;
    $('#pv').onclick = async () => {
      try { const p = await POST('/school/bill', { ...readForm(sb, f), preview: true });
        $('#pvr').innerHTML = `<p><b>${p.learners}</b> learners · <b>${money(p.total)}</b></p>${tableHtml([{ key: 'name', label: 'Learner' }, { key: 'class_name', label: 'Class' }, { key: 'total', label: 'Fees', right: 1, fmt: money }], p.rows)}`; } catch (e) { err(e); }
    };
    $('#go').onclick = async () => {
      try { const v = readForm(sb, f); if (!(await confirmBox(`Bill "${v.label}" to every enrolled learner now? An invoice goes to each parent.`, { okLabel: 'Bill' }))) return;
        const o = await POST('/school/bill', v); toast(`${o.invoices} invoices · ${money(o.total)}`); school(view); } catch (e) { err(e); }
    };
  }
  if (tab === 'arrears') {
    const a = await GET(`/school/arrears${q.class_id ? '?class_id=' + q.class_id : ''}`);
    sb.innerHTML = `<div class="cols" style="grid-template-columns:2fr 1fr;align-items:start"><div class="card"><h3>Learners owing fees <small class="muted" style="font-weight:400">${money(a.total)}</small></h3>
      ${tableHtml([{ key: 'name', label: 'Learner' }, { key: 'class_name', label: 'Class' }, { key: 'guardian_name', label: 'Parent' }, { key: 'guardian_phone', label: 'Phone' },
        { key: 'current', label: 'Not yet due', right: 1, fmt: money }, { key: 'd30', label: '1–30 d', right: 1, fmt: money }, { key: 'd60', label: '31–60 d', right: 1, fmt: money }, { key: 'd90', label: '60+ d', right: 1, fmt: money },
        { key: 'due', label: 'Owes', right: 1, html: 1, fmt: v => `<b>${money(v)}</b>` }], a.rows, { rowAttr: x => `data-id="${x.id}"`, empty: 'All fees are paid. 🎉' })}</div>
      <div class="card"><h3>By class</h3>${tableHtml([{ key: 'class_name', label: 'Class' }, { key: 'due', label: 'Owed', right: 1, fmt: money }], a.by_class)}</div></div>`;
    $$('[data-id]', sb).forEach(tr => tr.onclick = () => { location.hash = '#/learner/' + tr.dataset.id; });
  }
}

async function learnerDialog(l, done) {
  const [classes, parents] = await Promise.all([GET('/school/classes'), GET('/partners?is_customer=1')]);
  const f = [{ key: 'first_name', label: 'First name', required: true }, { key: 'last_name', label: 'Surname', required: true },
    { key: 'class_id', label: 'Class', type: 'select', numeric: true, required: true, options: classes.map(c => ({ value: c.id, label: c.name })) }, { key: 'admission_no', label: 'Admission no. (blank = automatic)' },
    { key: 'gender', label: 'Gender', type: 'select', options: [{ value: '', label: '—' }, { value: 'F', label: 'Girl' }, { value: 'M', label: 'Boy' }] }, { key: 'birth_date', label: 'Date of birth', type: 'date' },
    { key: 'guardian_id', label: 'Parent / guardian who pays', type: 'select', numeric: true, options: [{ value: '', label: '— new parent (fill in below) —' }, ...parents.map(p => ({ value: p.id, label: `${p.name}${p.phone ? ' · ' + p.phone : ''}` }))] },
    { key: 'guardian_name', label: 'New parent: name' }, { key: 'guardian_phone', label: 'New parent: phone' }, { key: 'guardian2', label: 'Second parent / emergency contact' },
    { key: 'bursary_pct', label: 'Bursary / scholarship %', type: 'number' }, { key: 'enrolled_on', label: 'Enrolled on', type: 'date' },
    { key: 'medical', label: 'Allergies / medical', span: 2 }, { key: 'notes', label: 'Notes', span: 2 }];
  modal({ title: l ? l.name : 'New learner', size: 'lg', body: formHtml(f, l ? { ...l, birth_date: d(l.birth_date), enrolled_on: d(l.enrolled_on) } : { enrolled_on: today(), bursary_pct: 0, class_id: (classes[0] || {}).id }, { ctx: 'learner' }),
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); const o = l ? await PUT('/learners/' + l.id, v) : await POST('/learners', v); c(); toast('Saved'); done(o); } }] });
}

export async function learner(view, [idq]) {
  const id = (idq || '').split('?')[0];
  const [l, fees] = await Promise.all([GET('/learners/' + id), GET('/school/fees')]);
  const optional = fees.filter(f => f.optional && (!f.grade || f.grade === l.grade));
  const acts = ['<button class="btn btn-primary" id="lp">💵 Payment</button>', '<button class="btn" id="ls">🖨 Statement</button>', '<button class="btn" id="le">Edit</button>'];
  if (l.balance > 0 && can('reminders')) acts.push('<button class="btn" id="lrm">📱 Remind</button>');
  acts.push(l.status === 'enrolled' ? '<button class="btn btn-danger" id="lx">Left school</button>' : '<button class="btn" id="lb">Re-enrol</button>');
  view.innerHTML = page(`${l.name} · ${l.admission_no}`, acts.join(''), `<div class="cols cols-4" style="margin-bottom:14px">
      <div class="kpi"><div class="label">Class</div><div class="value" style="font-size:20px">${esc(l.class_name || '–')}</div><div class="hint">${l.status === 'enrolled' ? '' : badge(l.status, 'closed')}</div></div>
      <div class="kpi"><div class="label">Parent / guardian</div><div class="value" style="font-size:16px">${esc(l.guardian_name)}</div><div class="hint">${esc(l.guardian_phone || '')}${l.guardian2 ? ' · ' + esc(l.guardian2) : ''}</div></div>
      <div class="kpi"><div class="label">Owes</div><div class="value" style="color:${l.balance > 0 ? 'var(--bad)' : 'var(--ok)'}">${money(l.balance)}</div></div>
      <div class="kpi"><div class="label">Bursary</div><div class="value">${Number(l.bursary_pct)}%</div><div class="hint">${l.siblings.length ? 'siblings: ' + l.siblings.map(s => esc(s.name)).join(', ') : ''}</div></div></div>
    <div class="cols" style="grid-template-columns:2fr 1fr;align-items:start"><div class="card"><h3>Statement</h3>${tableHtml([{ key: 'date', label: 'Date', fmt: d }, { key: 'text', label: 'Details' }, { key: 'debit', label: 'Charged', right: 1, fmt: v => v ? money(v) : '' },
      { key: 'credit', label: 'Paid', right: 1, fmt: v => v ? money(v) : '' }, { key: 'balance', label: 'Balance', right: 1, fmt: money }], l.statement, { empty: 'Nothing billed yet.' })}</div>
      <div class="card"><h3>Optional fees</h3>${optional.length ? optional.map(f => `<label class="row" style="gap:6px;margin-bottom:6px"><input type="checkbox" data-f="${f.id}" ${l.fees.includes(f.id) ? 'checked' : ''}> ${esc(f.name)} <span class="muted">${money(f.amount)} ${esc(f.period)}</span></label>`).join('') + '<button class="btn btn-sm" id="sf">Save</button>' : '<div class="muted">No optional fees for this grade.</div>'}
      ${l.medical ? `<h3 style="margin-top:14px">Medical</h3><p>${esc(l.medical)}</p>` : ''}</div></div>`, { back: '#/school' });
  filesCard('learner', l.id, 'Birth certificate, reports & documents');
  const reload = () => learner(view, [id]);
  if ($('#sf')) $('#sf').onclick = async () => { await PUT(`/learners/${l.id}/fees`, { fee_item_ids: $$('[data-f]').filter(c => c.checked).map(c => Number(c.dataset.f)) }); toast('Saved – used from the next billing run'); reload(); };
  $('#le').onclick = () => learnerDialog(l, reload);
  if ($('#lrm')) $('#lrm').onclick = () => remindOne(l.guardian_id, 'school', l.guardian_phone);
  if ($('#lx')) $('#lx').onclick = () => modal({ title: 'Learner leaves', body: `<label class="row" style="gap:6px"><input type="checkbox" id="gr"> Finished school (graduated)</label><small class="help-note">They will not be billed any more. What they owe stays on the parent's account.</small>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-danger', onClick: async (c, r) => { await POST(`/learners/${l.id}/leave`, { graduated: r.querySelector('#gr').checked }); c(); reload(); } }] });
  if ($('#lb')) $('#lb').onclick = async () => { await POST(`/learners/${l.id}/return`, {}); reload(); };
  $('#lp').onclick = async () => {
    const ms = await methods();
    const f = [{ key: 'amount', label: 'Amount (M)', type: 'number', required: true }, { key: 'method_id', label: 'Paid by', type: 'select', numeric: true, options: ms.map(m => ({ value: m.id, label: m.name })) },
      { key: 'reference', label: 'Reference (M-Pesa / bank deposit no.)' }, { key: 'date', label: 'Date', type: 'date' },
      ...(l.siblings.length ? [{ key: 'family', label: 'Pay for all the parent\'s children (oldest fees first)', type: 'checkbox', span: 2 }] : [])];
    modal({ title: `Payment for ${l.name}`, body: formHtml(f, { amount: l.balance || '', date: today() }, { ctx: 'feepay' }), actions: [{ label: 'Cancel' },
      { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const o = await POST(`/learners/${l.id}/receive`, readForm(r, f)); c(); toast(`${money(o.amount)} received${o.credit_left > 0 ? ` – ${money(o.credit_left)} kept as credit` : ''}`); reload(); } }] });
  };
  $('#ls').onclick = () => printHtml(`<div style="font-family:Arial;font-size:13px;max-width:760px;margin:auto"><h2>${esc(state.company.name || '')}</h2><div>${esc(state.company.address || '')} · ${esc(state.company.phone || '')}</div>
    <h1 style="font-size:20px">Fee statement</h1><p><b>${esc(l.name)}</b> (${esc(l.admission_no)}, ${esc(l.class_name || '')}) · ${esc(l.guardian_name)} · ${esc(today())}</p>
    <table border="1" cellpadding="5" style="border-collapse:collapse;width:100%"><tr><th align="left">Date</th><th align="left">Details</th><th align="right">Charged</th><th align="right">Paid</th><th align="right">Balance</th></tr>
    ${l.statement.map(x => `<tr><td>${esc(d(x.date))}</td><td>${esc(x.text)}</td><td align="right">${x.debit ? money(x.debit) : ''}</td><td align="right">${x.credit ? money(x.credit) : ''}</td><td align="right">${money(x.balance)}</td></tr>`).join('')}</table>
    <p style="text-align:right;font-size:16px">Amount due: <b>${money(l.balance)}</b></p></div>`);
}
