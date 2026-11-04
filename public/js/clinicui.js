// Patients & dispensing: waiting queue, patient files, consultation screen with notes and prescribing, billing to patient or
// medical aid, medicine labels, prescriptions, sick notes, claims and the dispensing register
import { state, GET, POST, PUT, DEL, esc, $, $$, toast, err, can, money, qty, modal, confirmBox, formHtml, readForm, tableHtml, badge, page, d, dt, today, plusDays, query, printHtml } from './core.js';

const VS = { waiting: ['waiting', 'draft'], in_consult: ['with practitioner', 'partial'], done: ['to bill', 'posted'], billed: ['billed', 'paid'], cancelled: ['cancelled', 'cancelled'] };
const vsBadge = s => badge((VS[s] || [s])[0], (VS[s] || [s, ''])[1]);
const KIND = [['consultation', 'Consultation'], ['follow_up', 'Follow-up'], ['procedure', 'Procedure / dressing'], ['pharmacy', 'Pharmacy only']];
const SEX = { F: 'F', M: 'M', X: '–' };
const ageSex = p => [p.age != null ? `${p.age} y` : '', SEX[p.sex] || ''].filter(Boolean).join(' · ');
const allergyFlag = a => a && !/^(none|nil|no known|nkda)/i.test(a.trim()) ? badge('⚠ ' + a, 'cancelled') : '';
const methods = async () => (await GET('/payment-methods')).filter(m => m.active && m.kind !== 'account');
const vitalsF = [{ key: 'temp', label: 'Temp °C', step: '0.1' }, { key: 'bp_sys', label: 'BP systolic' }, { key: 'bp_dia', label: 'BP diastolic' },
  { key: 'pulse', label: 'Pulse /min' }, { key: 'resp', label: 'Breaths /min' }, { key: 'spo2', label: 'SpO₂ %' },
  { key: 'weight', label: 'Weight kg' }, { key: 'height', label: 'Height cm' }, { key: 'glucose', label: 'Glucose mmol/l' }].map(f => ({ ...f, type: 'number', nullable: true }));
const patientF = aids => [{ key: 'first_name', label: 'First name', required: true }, { key: 'last_name', label: 'Surname' }, { key: 'dob', label: 'Date of birth', type: 'date' },
  { key: 'sex', label: 'Sex', type: 'select', options: [{ value: '', label: '—' }, { value: 'F', label: 'Female' }, { value: 'M', label: 'Male' }, { value: 'X', label: 'Other' }] },
  { key: 'phone', label: 'Phone' }, { key: 'id_number', label: 'ID / passport number' }, { key: 'address', label: 'Village / address', span: 2 },
  { key: 'allergies', label: 'Allergies (e.g. Penicillin, sulpha) – or "None known"', span: 2 }, { key: 'chronic', label: 'Chronic conditions & long-term medicines', span: 2 },
  { key: 'medical_aid_id', label: 'Medical aid', type: 'select', numeric: true, options: [{ value: '', label: '— pays privately —' }, ...aids.map(a => ({ value: a.id, label: a.name }))] },
  { key: 'medical_aid_no', label: 'Membership number' }, { key: 'main_member', label: 'Main member (if a dependant)' }, { key: 'blood_group', label: 'Blood group' },
  { key: 'next_of_kin', label: 'Next of kin' }, { key: 'next_of_kin_phone', label: 'Next of kin phone' }, { key: 'species', label: 'Animal: species / breed (vets only)' }, { key: 'file_no', label: 'File number (blank = automatic)' }, { key: 'notes', label: 'Notes', span: 2 }];

export async function clinic(view) {
  const q = query(); const tab = q.tab || 'queue';
  const tabs = [['queue', 'Today & queue'], ['patients', 'Patients'], ['claims', 'Medical-aid claims'], ['report', 'Reports & register'], ...(can('settings') ? [['settings', 'Settings']] : [])];
  view.innerHTML = page('Patients', '<button class="btn" id="np">＋ Patient</button><button class="btn btn-primary" id="na">Patient arrives</button>',
    `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/clinic?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="cb"></div>`);
  $('#np').onclick = () => patientDialog(null, p => { location.hash = '#/patient/' + p.id; });
  $('#na').onclick = () => arrivalDialog(null, v => { location.hash = '#/clinic?tab=queue&_=' + v.id; });
  const cb = $('#cb');
  if (tab === 'queue') {
    const [st, rows] = await Promise.all([GET('/clinic/stats'), GET('/visits?view=today')]);
    cb.innerHTML = `<div class="cols cols-4" style="margin-bottom:14px"><div class="kpi"><div class="label">Waiting</div><div class="value">${st.waiting}</div><div class="hint">${st.in_consult} with a practitioner</div></div>
      <div class="kpi"><div class="label">To bill</div><div class="value">${st.to_bill}</div></div><div class="kpi"><div class="label">Seen today</div><div class="value">${st.seen_today}</div><div class="hint">billed ${money(st.revenue_today)}</div></div>
      <div class="kpi"><div class="label">Open medical-aid claims</div><div class="value">${st.claims_open}</div><div class="hint">${money(st.claims_amount)}</div></div></div>
      <div class="card">${tableHtml([{ key: 'queue_no', label: '#', right: 1 }, { key: 'patient_name', label: 'Patient', html: 1, fmt: (x, v) => `<b>${esc(x)}</b> <small class="muted">${esc(v.file_no)}</small> ${allergyFlag(v.allergies)}` },
        { key: 'age', label: 'Age / sex', fmt: (x, v) => ageSex(v) }, { key: 'kind', label: 'For', fmt: k => (KIND.find(x => x[0] === k) || [k, k])[1] }, { key: 'reason', label: 'Complaint' },
        { key: 'medical_aid', label: 'Medical aid' }, { key: 'practitioner', label: 'Seen by' }, { key: 'items_total', label: 'Bill', right: 1, fmt: v => Number(v) ? money(v) : '' }, { key: 'status', label: 'Status', html: 1, fmt: vsBadge }],
        rows, { rowAttr: v => `data-v="${v.id}"`, empty: 'Nobody in the queue yet – click "Patient arrives".' })}</div>`;
    $$('[data-v]', cb).forEach(tr => tr.onclick = () => { location.hash = '#/visit/' + tr.dataset.v; });
  }
  if (tab === 'patients') {
    const rows = await GET('/patients' + (q.q ? '?q=' + encodeURIComponent(q.q) : ''));
    cb.innerHTML = `<div class="row" style="margin-bottom:8px"><input id="pq" placeholder="Name, file no., phone, ID or medical aid number" value="${esc(q.q || '')}" style="max-width:360px"></div>
      <div class="card">${tableHtml([{ key: 'file_no', label: 'File' }, { key: 'first_name', label: 'Patient', html: 1, fmt: (x, p) => `<b>${esc(x)} ${esc(p.last_name || '')}</b> ${allergyFlag(p.allergies)}` }, { key: 'age', label: 'Age / sex', fmt: (x, p) => ageSex(p) },
        { key: 'phone', label: 'Phone' }, { key: 'medical_aid', label: 'Medical aid', fmt: (x, p) => x ? `${x} ${p.medical_aid_no || ''}` : 'private' }, { key: 'chronic', label: 'Chronic' }], rows, { rowAttr: p => `data-p="${p.id}"`, empty: 'No patients found.' })}</div>`;
    $$('[data-p]', cb).forEach(tr => tr.onclick = () => { location.hash = '#/patient/' + tr.dataset.p; });
    let t; $('#pq').oninput = e => { clearTimeout(t); t = setTimeout(() => { location.hash = '#/clinic?tab=patients&q=' + encodeURIComponent(e.target.value); }, 450); };
    setTimeout(() => { const i = $('#pq'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 50);
  }
  if (tab === 'claims') {
    const [rows, aids] = await Promise.all([GET('/clinic/claims' + (q.all ? '?all=1' : '')), GET('/medical-aids')]);
    const byAid = {}; rows.forEach(x => { byAid[x.medical_aid] = (byAid[x.medical_aid] || 0) + Number(x.open); });
    cb.innerHTML = `<div class="row wrap" style="margin-bottom:8px"><a class="btn btn-sm ${q.all ? '' : 'btn-primary'}" href="#/clinic?tab=claims">Unpaid</a><a class="btn btn-sm ${q.all ? 'btn-primary' : ''}" href="#/clinic?tab=claims&all=1">All</a>
      <span class="spacer"></span><button class="btn btn-sm" id="aa">＋ Medical aid</button></div>
      <div class="row wrap" style="gap:8px;margin-bottom:10px">${Object.entries(byAid).map(([k, v]) => `<div class="kpi" style="min-width:200px"><div class="label">${esc(k)}</div><div class="value" style="font-size:20px">${money(v)}</div></div>`).join('') || (aids.length ? '' : '<span class="muted">No medical aids yet.</span>')}</div>
      <div class="card">${tableHtml([{ key: 'medical_aid', label: 'Medical aid' }, { key: 'number', label: 'Invoice' }, { key: 'invoice_date', label: 'Date', fmt: d }, { key: 'patient', label: 'Patient' }, { key: 'medical_aid_no', label: 'Member no.' },
        { key: 'icd10', label: 'ICD-10' }, { key: 'total', label: 'Claimed', right: 1, fmt: money }, { key: 'open', label: 'Unpaid', right: 1, fmt: money }, { key: 'days', label: 'Days', right: 1, html: 1, fmt: n => `<span style="color:${n > 60 ? 'var(--bad)' : 'inherit'}">${n}</span>` }],
        rows, { rowAttr: x => `data-i="${x.invoice_id}"`, empty: 'No medical-aid claims.' })}
      <p class="muted" style="margin-top:8px">Record the medical aid's payment on the invoice (or Contacts → the medical aid → Receive payment) when the remittance arrives.</p></div>`;
    $$('[data-i]', cb).forEach(tr => tr.onclick = () => { location.hash = '#/invoice/' + tr.dataset.i; });
    $('#aa').onclick = () => { const f = [{ key: 'name', label: 'Medical aid name', required: true }, { key: 'phone', label: 'Claims phone' }, { key: 'email', label: 'Claims email' }];
      modal({ title: 'Add medical aid', body: formHtml(f, {}, { ctx: 'medaid' }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await POST('/medical-aids', readForm(r, f)); c(); clinic(view); } }] }); };
  }
  if (tab === 'report') {
    const to = q.to || today(), from = q.from || `${to.slice(0, 8)}01`;
    const meds = (await GET('/products')).filter(p => p.type === 'stock');
    const rep = await GET(`/clinic/report?from=${from}&to=${to}${q.product_id ? '&product_id=' + q.product_id : ''}`);
    cb.innerHTML = `<div class="card" style="margin-bottom:12px"><div class="row wrap"><label>From <input type="date" id="rf" value="${from}"></label><label>To <input type="date" id="rt" value="${to}"></label>
      <label>Medicine <select id="rp" style="max-width:240px"><option value="">all</option>${meds.map(p => `<option value="${p.id}" ${String(p.id) === q.product_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label><button class="btn btn-sm" id="rg">Show</button></div>
      <p style="margin:8px 0 0">${rep.totals.visits} billed visits · ${rep.totals.patients} patients · ${rep.totals.pharmacy} pharmacy only</p></div>
      <div class="cols cols-2" style="align-items:start;margin-bottom:12px"><div class="card"><h3>Per practitioner</h3>${tableHtml([{ key: 'name', label: 'Practitioner' }, { key: 'visits', label: 'Visits', right: 1 }, { key: 'consultations', label: 'Consultations', right: 1 }, { key: 'pharmacy', label: 'Pharmacy', right: 1 }, { key: 'billed', label: 'Billed', right: 1, fmt: money }], rep.by_practitioner, { empty: 'No billed visits.' })}</div>
      <div class="card"><h3>Most common diagnoses</h3>${tableHtml([{ key: 'icd10', label: 'ICD-10' }, { key: 'diagnosis', label: 'Diagnosis' }, { key: 'n', label: 'Patients', right: 1 }], rep.diagnoses, { empty: 'No diagnoses yet.' })}</div></div>
      <div class="card"><h3>Dispensing register</h3>${tableHtml([{ key: 'visit_date', label: 'Date', fmt: d }, { key: 'number', label: 'Visit' }, { key: 'file_no', label: 'File' }, { key: 'patient', label: 'Patient' }, { key: 'description', label: 'Medicine' }, { key: 'qty', label: 'Qty', right: 1, fmt: qty },
        { key: 'dosage', label: 'Directions' }, { key: 'practitioner', label: 'By' }, { key: 'invoice_number', label: 'Invoice' }], rep.register, { empty: 'Nothing dispensed in this period.' })}</div>`;
    $('#rg').onclick = () => { location.hash = `#/clinic?tab=report&from=${$('#rf').value}&to=${$('#rt').value}${$('#rp').value ? '&product_id=' + $('#rp').value : ''}`; };
  }
  if (tab === 'settings') {
    const s = await GET('/clinic/settings');
    const f = [{ key: 'practice_no', label: 'Practice / pharmacy licence number' }, { key: 'practitioner_title', label: 'Title under the signature, e.g. "Medical Practitioner"' }, { key: 'label_note', label: 'Warning printed on every medicine label', span: 2 }];
    cb.innerHTML = `<div class="card" style="max-width:760px">${formHtml(f, s, { ctx: 'clinicset' })}<button class="btn btn-primary" id="ss" style="margin-top:10px">Save</button></div>`;
    $('#ss').onclick = async () => { try { await PUT('/clinic/settings', readForm(cb, f)); toast('Saved'); } catch (e) { err(e); } };
  }
}

async function patientDialog(p, done) {
  const aids = await GET('/medical-aids');
  const f = patientF(aids);
  modal({ title: p ? `${p.first_name} ${p.last_name || ''}` : 'New patient', size: 'lg', body: formHtml(f, p ? { ...p, dob: d(p.dob) } : {}, { ctx: 'patient' }),
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); const o = p ? await PUT('/patients/' + p.id, v) : await POST('/patients', v); c(); toast(`${o.file_no} saved`); done(o); } }] });
}

async function arrivalDialog(pre, done) {
  const [docs, aids] = await Promise.all([GET('/clinic/practitioners'), GET('/medical-aids')]);
  const pf = patientF(aids).filter(x => ['first_name', 'last_name', 'dob', 'sex', 'phone', 'allergies', 'medical_aid_id', 'medical_aid_no'].includes(x.key));
  const vf = [{ key: 'kind', label: 'Here for', type: 'select', options: KIND.map(([value, label]) => ({ value, label })) },
    { key: 'practitioner_id', label: 'To see', type: 'select', numeric: true, options: [{ value: '', label: '— next available —' }, ...docs.map(u => ({ value: u.id, label: u.name }))] },
    { key: 'reason', label: 'Complaint / reason for visit', span: 2 }, ...vitalsF];
  modal({ title: 'Patient arrives', size: 'lg', body: `${pre ? `<p><b>${esc(pre.first_name)} ${esc(pre.last_name || '')}</b> · ${esc(pre.file_no)} ${allergyFlag(pre.allergies)}</p>` : `<label class="field"><span>Find the patient (name, file no., phone or ID)</span><input id="fs" placeholder="type at least 2 letters"></label>
      <div id="fr" style="margin:6px 0"></div><div id="newp" style="display:none"><h4 style="margin:8px 0">New patient</h4>${formHtml(pf, {}, { ctx: 'patient' })}</div>`}
      <h4 style="margin:12px 0 6px">Visit & vital signs</h4>${formHtml(vf, { kind: 'consultation' }, { ctx: 'arrival' })}`,
    onOpen: r => {
      if (pre) return;
      let t; const fs = r.querySelector('#fs');
      fs.oninput = () => { clearTimeout(t); t = setTimeout(async () => {
        const qv = fs.value.trim(); const fr = r.querySelector('#fr');
        if (qv.length < 2) { fr.innerHTML = ''; return; }
        const ps = await GET('/patients?q=' + encodeURIComponent(qv)).catch(() => []);
        fr.innerHTML = ps.slice(0, 8).map(p => `<label class="row" style="gap:6px;padding:3px 0"><input type="radio" name="pick" value="${p.id}"> <b>${esc(p.first_name)} ${esc(p.last_name || '')}</b> <small class="muted">${esc(p.file_no)} · ${esc(ageSex(p))} · ${esc(p.phone || '')}</small> ${allergyFlag(p.allergies)}</label>`).join('')
          + `<label class="row" style="gap:6px;padding:3px 0"><input type="radio" name="pick" value="new"> <span>New patient${ps.length ? ' (not in the list)' : ''}</span></label>`;
        $$('[name=pick]', fr).forEach(x => x.onchange = () => { r.querySelector('#newp').style.display = x.value === 'new' && x.checked ? '' : 'none';
          if (x.value === 'new') { const [a, ...b] = qv.split(' '); const fn = r.querySelector('#newp [name=first_name]'); if (!fn.value && !/\d/.test(qv)) { fn.value = a; r.querySelector('#newp [name=last_name]').value = b.join(' '); } } });
        if (!ps.length) { const n = fr.querySelector('[value=new]'); n.checked = true; n.onchange(); }
      }, 300); };
    },
    actions: [{ label: 'Cancel' }, { label: 'Add to queue', cls: 'btn-primary', onClick: async (c, r) => {
      const body = readForm(r, vf);
      if (pre) body.patient_id = pre.id;
      else { const pick = r.querySelector('[name=pick]:checked'); if (!pick) throw new Error('Find the patient, or choose "New patient"');
        if (pick.value === 'new') body.patient = readForm(r.querySelector('#newp'), pf); else body.patient_id = Number(pick.value); }
      const v = await POST('/visits', body); c(); toast(`${v.patient_name} is number ${v.queue_no} in the queue`); done(v); } }] });
}

export async function patient(view, [idq]) {
  const id = (idq || '').split('?')[0];
  const p = await GET('/patients/' + id);
  view.innerHTML = page(`${p.first_name} ${p.last_name || ''}`, '<button class="btn" id="pe">Edit</button><button class="btn btn-primary" id="pv">New visit</button>',
    `${allergyFlag(p.allergies) ? `<div class="card" style="border-left:4px solid var(--bad);margin-bottom:12px"><b>Allergies:</b> ${esc(p.allergies)}</div>` : ''}
    <div class="cols cols-4" style="margin-bottom:14px"><div class="kpi"><div class="label">File</div><div class="value" style="font-size:20px">${esc(p.file_no)}</div><div class="hint">${esc(ageSex(p))}${p.dob ? ' · born ' + esc(d(p.dob)) : ''}</div></div>
      <div class="kpi"><div class="label">Contact</div><div class="value" style="font-size:16px">${esc(p.phone || '–')}</div><div class="hint">${esc(p.address || '')}${p.next_of_kin ? `<br>next of kin ${esc(p.next_of_kin)} ${esc(p.next_of_kin_phone || '')}` : ''}</div></div>
      <div class="kpi"><div class="label">Medical aid</div><div class="value" style="font-size:16px">${esc(p.medical_aid || 'private')}</div><div class="hint">${esc(p.medical_aid_no || '')}${p.main_member ? ' · main member ' + esc(p.main_member) : ''}</div></div>
      <div class="kpi"><div class="label">Owes</div><div class="value" style="color:${p.balance > 0 ? 'var(--bad)' : 'inherit'}">${money(p.balance)}</div>${p.partner_id ? `<div class="hint"><a href="#/customer/${p.partner_id}">account</a></div>` : ''}</div></div>
    ${p.chronic ? `<div class="card" style="margin-bottom:12px"><b>Chronic conditions:</b> ${esc(p.chronic)}</div>` : ''}
    <div class="cols cols-2" style="align-items:start"><div class="card"><h3>Visits</h3>${tableHtml([{ key: 'visit_date', label: 'Date', fmt: d }, { key: 'reason', label: 'Complaint' }, { key: 'diagnosis', label: 'Diagnosis', fmt: (x, v) => `${v.icd10 ? v.icd10 + ' ' : ''}${x || ''}` },
      { key: 'practitioner', label: 'Seen by' }, { key: 'status', label: 'Status', html: 1, fmt: vsBadge }], p.visits, { rowAttr: v => `data-v="${v.id}"`, empty: 'No visits yet.' })}</div>
    <div class="card"><h3>Medicines given</h3>${tableHtml([{ key: 'visit_date', label: 'Date', fmt: d }, { key: 'description', label: 'Medicine' }, { key: 'qty', label: 'Qty', right: 1, fmt: qty }, { key: 'dosage', label: 'Directions' }], p.medicines, { empty: 'None yet.' })}</div></div>`, { back: '#/clinic?tab=patients' });
  $$('[data-v]').forEach(tr => tr.onclick = () => { location.hash = '#/visit/' + tr.dataset.v; });
  $('#pe').onclick = () => patientDialog(p, () => patient(view, [id]));
  $('#pv').onclick = () => arrivalDialog(p, v => { location.hash = '#/visit/' + v.id; });
}

export async function visit(view, [idq]) {
  const id = (idq || '').split('?')[0];
  const [v, cs] = await Promise.all([GET('/visits/' + id), GET('/clinic/settings')]);
  const open = ['waiting', 'in_consult', 'done'].includes(v.status);
  const acts = [];
  if (v.status === 'waiting') acts.push('<button class="btn btn-primary" id="vs">▶ Call in</button>');
  if (['waiting', 'in_consult'].includes(v.status)) acts.push('<button class="btn btn-ok" id="vd">✓ Finished</button>');
  if (v.status === 'done') acts.push('<button class="btn" id="vr">Reopen</button>');
  if (open) acts.push('<button class="btn btn-primary" id="vb">Bill & dispense</button>');
  acts.push('<button class="btn" id="pr">🖨 Prescription</button>', '<button class="btn" id="pl">🏷 Labels</button>');
  if (v.sick_note_days) acts.push('<button class="btn" id="ps">🖨 Sick note</button>');
  if (open) acts.push('<button class="btn btn-danger" id="vc">Cancel</button>');
  const notesF = [{ key: 'reason', label: 'Complaint', span: 2 }, { key: 'history', label: 'History', type: 'textarea', rows: 3, span: 2 }, { key: 'exam', label: 'Examination', type: 'textarea', rows: 3, span: 2 },
    { key: 'diagnosis', label: 'Diagnosis' }, { key: 'icd10', label: 'ICD-10 code' }, { key: 'plan', label: 'Plan / advice', type: 'textarea', rows: 2, span: 2 },
    { key: 'sick_note_days', label: 'Sick note – days off', type: 'number', nullable: true }, { key: 'follow_up', label: 'Come back on', type: 'date' }];
  const vit = [['Temp', v.temp, '°C'], ['BP', v.bp_sys ? `${v.bp_sys}/${v.bp_dia || '?'}` : null, ''], ['Pulse', v.pulse, '/min'], ['Resp', v.resp, '/min'], ['SpO₂', v.spo2, '%'], ['Weight', v.weight, 'kg'], ['Height', v.height, 'cm'], ['Glucose', v.glucose, 'mmol/l']].filter(x => x[1] != null && x[1] !== '');
  const bmi = v.weight && v.height ? Math.round(Number(v.weight) / ((Number(v.height) / 100) ** 2) * 10) / 10 : null;
  view.innerHTML = page(`${v.patient_name} · ${v.number}`, acts.join(''),
    `${allergyFlag(v.allergies) ? `<div class="card" style="border-left:4px solid var(--bad);margin-bottom:12px"><b>⚠ Allergies:</b> ${esc(v.allergies)}</div>` : ''}
    <div class="cols cols-4" style="margin-bottom:14px"><div class="kpi"><div class="label">Patient</div><div class="value" style="font-size:18px"><a href="#/patient/${v.patient_id}">${esc(v.file_no)}</a></div><div class="hint">${esc(ageSex(v))}${v.species ? ' · ' + esc(v.species) : ''}${v.chronic ? '<br>' + esc(v.chronic) : ''}</div></div>
      <div class="kpi"><div class="label">Status</div><div class="value" style="font-size:18px">${vsBadge(v.status)}</div><div class="hint">${esc((KIND.find(x => x[0] === v.kind) || [0, v.kind])[1])} · queue ${v.queue_no || '–'}${v.practitioner ? ' · ' + esc(v.practitioner) : ''}</div></div>
      <div class="kpi"><div class="label">Pays</div><div class="value" style="font-size:16px">${esc(v.medical_aid || 'private')}</div><div class="hint">${esc(v.medical_aid_no || '')}</div></div>
      <div class="kpi"><div class="label">${v.invoice_id ? 'Invoice' : 'Bill so far'}</div><div class="value">${v.invoice_id ? `<a href="#/invoice/${v.invoice_id}">${esc(v.invoice_number)}</a>` : money(v.total)}</div>${v.copay ? `<div class="hint">co-payment <a href="#/invoice/${v.copay.id}">${esc(v.copay.number)}</a> ${money(v.copay.total)}</div>` : ''}</div></div>
    <div class="cols cols-2" style="align-items:start"><div><div class="card" style="margin-bottom:12px"><div class="row"><h3 style="flex:1">Vital signs</h3>${open ? '<button class="btn btn-sm" id="ev">Edit</button>' : ''}</div>
      ${vit.length ? `<div class="row wrap" style="gap:14px">${vit.map(([l, x, u]) => `<div><small class="muted">${l}</small><br><b>${esc(x)}</b> <small>${u}</small></div>`).join('')}${bmi ? `<div><small class="muted">BMI</small><br><b>${bmi}</b></div>` : ''}</div>` : '<span class="muted">Not taken.</span>'}</div>
      <div class="card"><h3>Consultation notes</h3><div id="nf">${formHtml(notesF, { ...v, follow_up: d(v.follow_up) }, { ctx: 'visit' })}</div>${open ? '<button class="btn btn-primary" id="sn" style="margin-top:8px">Save notes</button>' : ''}</div></div>
    <div><div class="card" style="margin-bottom:12px"><div class="row" style="margin-bottom:6px"><h3 style="flex:1">Treatment & medicines</h3>${open ? '<button class="btn btn-sm" id="as">＋ Service</button><button class="btn btn-sm btn-primary" id="am">＋ Medicine</button>' : ''}</div>
      ${tableHtml([{ key: 'description', label: 'Item', html: 1, fmt: (x, i) => `${i.kind === 'medicine' ? '💊 ' : ''}<b>${esc(x)}</b>${i.dosage ? `<br><small>${esc(i.dosage)}${i.duration ? ' · ' + esc(i.duration) : ''}</small>` : ''}` },
        { key: 'qty', label: 'Qty', right: 1, fmt: qty }, { key: 'unit_price', label: 'Price', right: 1, fmt: money }, { key: 'amount', label: 'Amount', right: 1, fmt: money },
        ...(open ? [{ key: 'id', label: '', html: 1, fmt: x => `<button class="btn btn-sm" data-del="${x}">✕</button>` }] : [])], v.items, { empty: 'Add the consultation fee, procedures and medicines.' })}
      <div class="row" style="margin-top:6px"><span class="spacer"></span><b>Total ${money(v.total)}</b></div></div>
      <div class="card"><h3>Previous visits</h3>${tableHtml([{ key: 'visit_date', label: 'Date', fmt: d }, { key: 'reason', label: 'Complaint' }, { key: 'diagnosis', label: 'Diagnosis' }, { key: 'plan', label: 'Plan' }], v.previous, { rowAttr: h => `data-h="${h.id}"`, empty: 'First visit.' })}</div></div></div>`, { back: '#/clinic' });
  const reload = () => visit(view, [id]);
  const run = fn => async () => { try { await fn(); reload(); } catch (e) { err(e); } };
  if (!open) $$('#nf input, #nf textarea, #nf select').forEach(x => { x.disabled = true; });
  $$('[data-h]').forEach(tr => tr.onclick = () => { location.hash = '#/visit/' + tr.dataset.h; });
  if ($('#vs')) $('#vs').onclick = run(() => POST(`/visits/${v.id}/start`));
  if ($('#vr')) $('#vr').onclick = run(() => POST(`/visits/${v.id}/reopen`));
  if ($('#sn')) $('#sn').onclick = run(async () => { await PUT('/visits/' + v.id, readForm($('#nf'), notesF)); toast('Notes saved'); });
  if ($('#vd')) $('#vd').onclick = run(async () => { await PUT('/visits/' + v.id, readForm($('#nf'), notesF)); await POST(`/visits/${v.id}/done`, v.kind === 'pharmacy' ? { no_diagnosis: 1 } : {}); toast('Finished – ready to bill'); });
  if ($('#ev')) $('#ev').onclick = () => modal({ title: 'Vital signs', body: formHtml(vitalsF, v, { ctx: 'arrival' }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await PUT('/visits/' + v.id, readForm(r, vitalsF)); c(); reload(); } }] });
  if ($('#vc')) $('#vc').onclick = () => modal({ title: 'Cancel visit', body: '<input id="cr" placeholder="Reason, e.g. left without being seen">', actions: [{ label: 'Back' }, { label: 'Cancel visit', cls: 'btn-danger', onClick: async (c, r) => { await POST(`/visits/${v.id}/cancel`, { reason: r.querySelector('#cr').value }); c(); reload(); } }] });
  $$('[data-del]').forEach(b => b.onclick = run(() => DEL(`/visits/${v.id}/items/${b.dataset.del}`)));
  const products = open ? await GET('/products') : [];
  const addItem = kind => {
    const list = products.filter(p => kind === 'medicine' ? p.type === 'stock' : p.type !== 'stock');
    const f = [{ key: 'product_id', label: kind === 'medicine' ? 'Medicine' : 'Service', type: 'select', numeric: true, options: [{ value: '', label: '— choose —' }, ...list.map(p => ({ value: p.id, label: `${p.name} – ${money(p.price)}${kind === 'medicine' ? ` (${qty(p.stock_qty)} in stock)` : ''}` }))] },
      { key: 'qty', label: kind === 'medicine' ? 'Quantity to give (tablets, bottles…)' : 'Quantity', type: 'number' },
      ...(kind === 'medicine' ? [{ key: 'dosage', label: 'Directions, e.g. "1 tablet 3 times a day after meals"', span: 2 }, { key: 'duration', label: 'For how long, e.g. "5 days"' }] : [{ key: 'description', label: 'Or describe it (if not in the list)' }]),
      { key: 'unit_price', label: 'Price each incl. VAT (blank = list price)', type: 'number', nullable: true }];
    modal({ title: kind === 'medicine' ? 'Prescribe / dispense' : 'Add service', size: 'lg', body: formHtml(f, { qty: 1 }, { ctx: 'visititem' }),
      actions: [{ label: 'Cancel' }, { label: 'Add', cls: 'btn-primary', onClick: async (c, r) => {
        const body = { ...readForm(r, f), kind }; if (body.unit_price === null) delete body.unit_price;
        try { await POST(`/visits/${v.id}/items`, body); }
        catch (e) {
          if (!/^ALLERGY/.test(e.message)) throw e;
          if (!await confirmBox(e.message.replace(/^ALLERGY: /, '⚠ '), { okLabel: 'I have checked – give it', danger: true })) return;
          await POST(`/visits/${v.id}/items`, { ...body, override_allergy: 1 });
        }
        c(); reload(); } }] });
  };
  if ($('#as')) $('#as').onclick = () => addItem('service');
  if ($('#am')) $('#am').onclick = () => addItem('medicine');
  if ($('#vb')) $('#vb').onclick = async () => {
    const ms = await methods();
    const f = [{ key: 'bill_to', label: 'Bill to', type: 'select', options: [{ value: 'patient', label: 'The patient (pays now or later)' }, ...(v.medical_aid_id ? [{ value: 'medical_aid', label: `${v.medical_aid} (member ${v.medical_aid_no})` }] : [])] },
      { key: 'copay', label: 'Co-payment the patient pays (medical aid only)', type: 'number' }, { key: 'amount', label: 'Paid now (M)', type: 'number' },
      { key: 'method_id', label: 'Paid by', type: 'select', numeric: true, options: ms.map(m => ({ value: m.id, label: m.name })) }, { key: 'reference', label: 'Reference' }, { key: 'due_date', label: 'Patient pays by (if not now)', type: 'date' }];
    modal({ title: `Bill ${v.patient_name} – ${money(v.total)}`, body: formHtml(f, { bill_to: v.medical_aid_id ? 'medical_aid' : 'patient', copay: 0, amount: v.medical_aid_id ? 0 : v.total, due_date: plusDays(7) }, { ctx: 'visitbill' }),
      onOpen: r => { const bt = r.querySelector('[name=bill_to]'), cp = r.querySelector('[name=copay]'), am = r.querySelector('[name=amount]');
        const sync = () => { const aid = bt.value === 'medical_aid'; cp.closest('.field').style.display = aid ? '' : 'none'; am.value = aid ? (Number(cp.value) || 0) : v.total; };
        bt.onchange = sync; cp.oninput = sync; sync(); },
      actions: [{ label: 'Cancel' }, { label: 'Bill & dispense', cls: 'btn-primary', onClick: async (c, r) => { const o = await POST(`/visits/${v.id}/bill`, readForm(r, f)); c(); toast(`Billed – ${o.number}`); reload(); } }] });
  };
  const co = state.company || {};
  const head = `<div style="text-align:center"><h2 style="margin:0">${esc(co.name || '')}</h2><div>${esc(co.address || '')} · ${esc(co.phone || '')}${cs.practice_no ? ' · Practice no. ' + esc(cs.practice_no) : ''}</div></div><hr>`;
  const sign = `<p style="margin-top:40px">______________________________<br>${esc(v.practitioner || state.user.name)}${cs.practitioner_title ? '<br>' + esc(cs.practitioner_title) : ''}</p>`;
  const who = `<p><b>${esc(v.patient_name)}</b> · ${esc(v.file_no)} · ${esc(ageSex(v))}${v.allergies ? ` · <b>Allergies: ${esc(v.allergies)}</b>` : ''}<br>Date: ${esc(d(v.visit_date))}</p>`;
  $('#pr').onclick = () => printHtml(`<div style="font-family:Arial;font-size:13px;max-width:700px;margin:auto">${head}<h2>Prescription</h2>${who}
    <ol>${v.items.filter(i => i.kind === 'medicine').map(i => `<li style="margin-bottom:8px"><b>${esc(i.description)}</b> – ${qty(i.qty)}<br>${esc(i.dosage || '')}${i.duration ? ' · ' + esc(i.duration) : ''}</li>`).join('') || '<li>—</li>'}</ol>${v.diagnosis ? `<p>Diagnosis: ${esc(v.icd10 || '')} ${esc(v.diagnosis)}</p>` : ''}${sign}</div>`);
  $('#pl').onclick = () => { const meds = v.items.filter(i => i.kind === 'medicine'); if (!meds.length) return toast('No medicines on this visit', 'err');
    printHtml(`<style>.lbl{width:80mm;border:1px dashed #999;padding:3mm;margin:0 0 4mm;font-family:Arial;font-size:11px;page-break-inside:avoid}.lbl b.big{font-size:13px}</style>
      ${meds.map(i => `<div class="lbl"><div><b>${esc(co.name || '')}</b> · ${esc(co.phone || '')}</div><div style="margin:2mm 0"><b class="big">${esc(i.description)}</b> × ${qty(i.qty)}</div>
        <div style="font-size:13px"><b>${esc(i.dosage || '')}</b>${i.duration ? ' · ' + esc(i.duration) : ''}</div><div style="margin-top:2mm">${esc(v.patient_name)} · ${esc(d(v.visit_date))} · ${esc(v.number)}</div>${cs.label_note ? `<div><i>${esc(cs.label_note)}</i></div>` : ''}</div>`).join('')}`); };
  if ($('#ps')) $('#ps').onclick = () => { const from = d(v.visit_date); const x = new Date(from + 'T12:00:00'); x.setDate(x.getDate() + Number(v.sick_note_days) - 1);
    printHtml(`<div style="font-family:Arial;font-size:14px;max-width:700px;margin:auto">${head}<h2>Medical certificate</h2>
      <p>This is to certify that <b>${esc(v.patient_name)}</b>${v.age != null ? `, aged ${v.age},` : ''} was examined on ${esc(from)} and is unfit for work / school for <b>${v.sick_note_days} day(s)</b>, from ${esc(from)} up to and including ${x.toISOString().slice(0, 10)}.</p>${sign}</div>`); };
}
