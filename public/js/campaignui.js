// SMS & email campaigns: list, editor with live audience count and SMS cost, test, send now or schedule, results
import { GET, POST, PUT, esc, $, $$, toast, err, modal, formHtml, readForm, tableHtml, badge, page, dt, query, confirmBox } from './core.js';
import { L } from './i18n.js';

const CS = { draft: ['draft', 'draft'], scheduled: ['scheduled', 'posted'], sending: ['sending', 'partial'], sent: ['sent', 'paid'], cancelled: ['cancelled', 'cancelled'] };
const csBadge = s => badge((CS[s] || [s])[0], (CS[s] || [s, ''])[1]);
const GROUPS = [['customers', 'All customers'], ['tenants', 'Tenants (running leases)'], ['parents', 'Parents of enrolled learners'], ['patients', 'Patients'], ['hire', 'Hire customers'], ['suppliers', 'Suppliers'], ['all', 'Every contact']];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export async function campaigns(view) {
  const rows = await GET('/campaigns');
  view.innerHTML = page(L('SMS & email campaigns', 'Melaetsa ea SMS le email'), `<button class="btn btn-primary" id="nc">＋ ${L('New campaign', 'Molaetsa o mocha')}</button>`,
    `<div class="card"><p class="muted" style="margin-top:0">${L('Send specials, events and news to a chosen group. People who asked not to receive marketing (tick on the contact) are never messaged. SMS uses the provider set under Reminders → Settings.', 'Romela litheolelo, liketsahalo le litaba ho sehlopha se khethiloeng.')}</p>
    ${tableHtml([{ key: 'name', label: 'Campaign' }, { key: 'channel', label: 'By' }, { key: 'status', label: 'Status', html: 1, fmt: csBadge }, { key: 'scheduled_at', label: 'Scheduled', fmt: (x, c) => c.status === 'scheduled' ? dt(x) : '' },
      { key: 'sent_at', label: 'Sent', fmt: dt }, { key: 'recipients', label: 'People', right: 1, fmt: (x, c) => c.status === 'sent' ? x : '' }, { key: 'sent', label: 'Delivered', right: 1, fmt: (x, c) => c.status === 'sent' ? x : '' }, { key: 'failed', label: 'Failed', right: 1, fmt: (x, c) => c.status === 'sent' && x ? x : '' }, { key: 'user_name', label: 'By' }],
      rows, { rowAttr: c => `data-c="${c.id}"`, empty: L('No campaigns yet.', 'Ha ho melaetsa.') })}</div>`);
  $('#nc').onclick = async () => { const o = await POST('/campaigns', { name: `Campaign ${new Date().toLocaleDateString()}`, channel: 'sms', audience: { group: 'customers' }, message: 'Hi {first_name}, ' }); location.hash = '#/campaign/' + o.id; };
  $$('[data-c]').forEach(tr => tr.onclick = () => { location.hash = '#/campaign/' + tr.dataset.c; });
}

export async function campaign(view, [idq]) {
  const id = (idq || '').split('?')[0];
  const c = await GET('/campaigns/' + id);
  const editable = ['draft', 'scheduled'].includes(c.status);
  const a = c.audience || {};
  const f = [{ key: 'name', label: 'Campaign name (only you see it)', required: true }, { key: 'channel', label: 'Send by', type: 'select', options: [['sms', 'SMS'], ['email', 'Email'], ['both', 'SMS and email']].map(([value, label]) => ({ value, label })) },
    { key: 'group', label: 'Who', type: 'select', options: GROUPS.map(([value, label]) => ({ value, label })) }, { key: 'tags', label: 'Only contacts with these tags (comma separated)' },
    { key: 'bought_within', label: 'Bought in the last … days', type: 'number', nullable: true }, { key: 'not_bought_for', label: 'Not bought for … days (win them back)', type: 'number', nullable: true },
    { key: 'birthday_month', label: 'Birthday in', type: 'select', options: [{ value: '', label: '— any month —' }, ...MONTHS.map((m, i) => ({ value: i + 1, label: m }))] }, { key: 'min_spent', label: 'Spent at least (M, all time)', type: 'number', nullable: true },
    { key: 'subject', label: 'Email subject', span: 2 }, { key: 'message', label: 'Message – {first_name}, {name}, {company} and {phone} are filled in', type: 'textarea', rows: 5, span: 2 }];
  const vals = { ...c, ...a, tags: (a.tags || []).join(', ') };
  view.innerHTML = page(c.name, editable ? `<button class="btn" id="tst">${L('Send a test', 'Romela teko')}</button><button class="btn" id="sch">🕒 ${L('Schedule', 'Beha nako')}</button><button class="btn btn-primary" id="snd">📣 ${L('Send now', 'Romela hona joale')}</button>` : '',
    `<div class="cols cols-2" style="align-items:start"><div class="card"><div id="cf">${formHtml(f, vals, { ctx: 'campaign' })}</div>${editable ? `<button class="btn btn-primary" id="sv" style="margin-top:8px">${L('Save', 'Boloka')}</button>` : ''}</div>
      <div><div class="card" style="margin-bottom:12px"><h3>${L('Who gets it', 'Ba tla e fumana')}</h3><div id="pv" class="muted">…</div></div>
      <div class="card"><h3>${L('Status', 'Boemo')}</h3><p>${csBadge(c.status)} ${c.status === 'scheduled' ? `${L('goes out', 'e tla tsoa')} ${esc(dt(c.scheduled_at))} <button class="btn btn-sm" id="uns">${L('Unschedule', 'Tlosa nako')}</button>` : ''}${c.sent_at ? ` ${esc(dt(c.sent_at))} · ${c.sent} ${L('delivered', 'e fihlile')}, ${c.failed} ${L('failed', 'e hlolehile')}` : ''}</p>
      ${c.log.length ? tableHtml([{ key: 'name', label: 'Contact' }, { key: 'channel', label: 'By' }, { key: 'sent_to', label: 'To' }, { key: 'status', label: 'Status', html: 1, fmt: v => badge(v, v === 'sent' ? 'ok' : 'cancelled') }, { key: 'error', label: 'Why not' }], c.log) : ''}</div></div></div>`, { back: '#/campaigns' });
  if (!editable) $$('#cf input, #cf select, #cf textarea').forEach(x => { x.disabled = true; });
  const body = () => { if (!$('#cf')) throw new Error('left'); const v = readForm($('#cf'), f); return { name: v.name, channel: v.channel, subject: v.subject, message: v.message, audience: { group: v.group, tags: v.tags, bought_within: v.bought_within, not_bought_for: v.not_bought_for, birthday_month: v.birthday_month, min_spent: v.min_spent } }; };
  const preview = async () => {
    const el = () => $('#pv');
    try { const b = body(); const p = await POST('/campaigns/preview', b); if (!el()) return;
      el().innerHTML = `<p style="font-size:22px;margin:0"><b>${p.count}</b> ${L('people', 'batho')}</p><p class="muted" style="margin:4px 0">${p.with_phone} ${L('with a phone', 'ba nang le mohala')} · ${p.with_email} ${L('with email', 'ba nang le email')} · ${p.opted_out} ${L('opted out (never sent)', 'ba hanne (ha ba romelloe)')}</p>
        ${b.channel !== 'email' ? `<div class="msg" style="white-space:pre-wrap">${esc(p.sms_text)}</div><small class="muted">${p.sms_text.length} ${L('characters', 'litlhaku')} · ${p.sms_parts} SMS ${L('each', 'ka mong')} · <b>${p.sms_total} SMS ${L('in total', 'kaofela')}</b></small>` : ''}
        ${p.sample_names.length ? `<p class="muted" style="margin-top:6px">${esc(p.sample_names.join(', '))}${p.count > p.sample_names.length ? '…' : ''}</p>` : ''}`;
    } catch (e) { if (el()) el().textContent = e.message; }
  };
  let t; $$('#cf input, #cf select, #cf textarea').forEach(x => { x.addEventListener('input', () => { clearTimeout(t); t = setTimeout(preview, 400); }); x.addEventListener('change', preview); });
  preview();
  const save = async () => { await PUT('/campaigns/' + c.id, body()); };
  if ($('#sv')) $('#sv').onclick = async () => { try { await save(); toast(L('Saved', 'E bolokiloe')); } catch (e) { err(e); } };
  if ($('#tst')) $('#tst').onclick = () => modal({ title: L('Send a test to yourself', 'Iromelle teko'), body: formHtml([{ key: 'phone', label: 'Your phone' }, { key: 'email', label: 'Your email' }], {}),
    actions: [{ label: 'Cancel' }, { label: 'Send test', cls: 'btn-primary', onClick: async (cl, r) => { await save(); await POST(`/campaigns/${c.id}/test`, { phone: r.querySelector('[name=phone]').value, email: r.querySelector('[name=email]').value }); cl(); toast(L('Test sent', 'Teko e rometsoe')); } }] });
  if ($('#sch')) $('#sch').onclick = () => modal({ title: L('Schedule', 'Beha nako'), body: `<label class="field"><span>${L('Send on', 'Romela ka')}</span><input type="datetime-local" id="at"></label><small class="help-note">${L('It goes out within five minutes of this time while the system is running.', 'E tla tsoa nakong ena ha sistimi e ntse e sebetsa.')}</small>`,
    actions: [{ label: 'Cancel' }, { label: 'Schedule', cls: 'btn-primary', onClick: async (cl, r) => { await save(); await POST(`/campaigns/${c.id}/schedule`, { at: r.querySelector('#at').value }); cl(); campaign(view, [id]); } }] });
  if ($('#uns')) $('#uns').onclick = async () => { await POST(`/campaigns/${c.id}/schedule`, {}); campaign(view, [id]); };
  if ($('#snd')) $('#snd').onclick = async () => {
    try { await save(); const p = await POST('/campaigns/preview', body());
      if (!await confirmBox(L(`Send to ${p.count} people now${p.sms_total ? ` (${p.sms_total} SMS)` : ''}?`, `Romela ho batho ba ${p.count} hona joale?`), { okLabel: L('Send', 'Romela') })) return;
      toast(L('Sending…', 'E ea romeloa…')); const o = await POST(`/campaigns/${c.id}/send`, {}); toast(`${o.sent} ${L('sent', 'e rometsoe')}${o.failed ? `, ${o.failed} ${L('failed', 'e hlolehile')}` : ''}`, o.failed ? 'err' : 'ok'); campaign(view, [id]);
    } catch (e) { err(e); }
  };
}
