// Payment reminders: who owes, send by SMS / email / WhatsApp, log, and the SMS provider & automatic settings
import { state, GET, POST, PUT, esc, $, $$, toast, err, can, money, modal, formHtml, readForm, tableHtml, badge, page, d, dt, query } from './core.js';

const SRC = [['all', 'Everyone'], ['rent', 'Rent (tenants)'], ['school', 'School fees (parents)'], ['contracts', 'Contracts'], ['hire', 'Hire'], ['invoices', 'Other invoices']];
const waLink = (phone, text) => { let p = String(phone || '').replace(/\D/g, ''); if (p.length === 8) p = '266' + p; return `https://wa.me/${p}?text=${encodeURIComponent(text)}`; };

export async function reminders(view) {
  const q = query(); const tab = q.tab || 'due';
  const tabs = [['due', 'Who owes'], ['log', 'Sent'], ...(can('settings') ? [['settings', 'Settings']] : [])];
  view.innerHTML = page('Payment reminders', '', `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/reminders?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="rb"></div>`);
  const rb = $('#rb');
  if (tab === 'due') {
    const src = q.source || 'all', min = Number(q.min_days) || 1;
    const [rows, s] = await Promise.all([GET(`/reminders/due?source=${src}&min_days=${min}`), GET('/reminders/settings')]);
    const pv = await POST('/reminders/preview', { source: src });
    sb(rb, rows, src, min, s, pv, () => reminders(view));
  }
  if (tab === 'log') {
    const rows = await GET('/reminders/log');
    rb.innerHTML = `<div class="card">${tableHtml([{ key: 'created_at', label: 'When', fmt: dt }, { key: 'partner_name', label: 'Customer' }, { key: 'channel', label: 'By' }, { key: 'sent_to', label: 'To' },
      { key: 'amount', label: 'Owed', right: 1, fmt: money }, { key: 'status', label: 'Result', html: 1, fmt: (v, x) => v === 'sent' ? badge('sent', 'ok') : `${badge('failed', 'cancelled')} <small class="muted">${esc(x.error || '')}</small>` },
      { key: 'auto', label: 'How', fmt: (v, x) => v ? 'automatic' : (x.user_name || '') }], rows, { empty: 'No reminders sent yet.' })}</div>`;
  }
  if (tab === 'settings') return settingsTab(rb);
}

function sb(rb, rows, src, min, s, pv, reload) {
  const total = rows.reduce((t, x) => t + x.amount, 0);
  rb.innerHTML = `<div class="card"><div class="row wrap" style="margin-bottom:10px"><select id="rs" style="max-width:240px">${SRC.map(([k, l]) => `<option value="${k}" ${k === src ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label>At least <input type="number" id="rm" value="${min}" style="width:70px;display:inline-block"> days late</label><span class="spacer"></span><span class="muted">${rows.length} customers · ${money(total)} overdue</span></div>
    ${s.sms.mode === 'off' ? '<div class="help-note" style="display:block;margin-bottom:10px">SMS is not set up yet – email and WhatsApp still work. An admin can add the SMS provider under the Settings tab.</div>' : ''}
    <div class="table-wrap"><table class="grid"><thead><tr><th style="width:30px"><input type="checkbox" id="all"></th><th>Customer</th><th>For</th><th>Phone</th><th>Email</th><th class="r">Overdue</th><th class="r">Days late</th><th>Last reminded</th><th></th></tr></thead><tbody>
    ${rows.map(x => `<tr><td><input type="checkbox" data-p="${x.partner_id}"></td><td><a href="#/customer/${x.partner_id}">${esc(x.name)}</a></td><td><small>${esc((x.details || '').replace(/^ (for )?/, '').replace(/^\(|\)$/g, ''))}</small></td><td>${esc(x.phone || '')}</td><td>${esc(x.email || '')}</td>
      <td class="r"><b>${money(x.amount)}</b></td><td class="r ${x.days > 30 ? 'neg' : ''}">${x.days}</td><td>${x.last_reminded ? esc(d(x.last_reminded)) : '<span class="muted">never</span>'}</td>
      <td>${x.phone ? `<button class="btn btn-sm" data-wa="${x.partner_id}" title="Open WhatsApp with the message">WhatsApp</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">Nobody is late. 🎉</td></tr>'}</tbody></table></div>
    <div class="row wrap" style="margin-top:10px"><span class="muted">Message for the first customer:</span><span class="spacer"></span>
      <select id="rc" style="max-width:180px"><option value="sms">SMS</option><option value="email">Email</option><option value="both">SMS and email</option></select><button class="btn btn-primary" id="send">Send to ticked customers</button></div>
    <div class="msg" style="margin-top:6px" id="pvt">${esc(pv.sms)}<div class="muted" style="font-size:12px">${pv.sms.length} characters · ${pv.sms_parts} SMS</div></div></div>`;
  if (!rb.isConnected) return; // the user moved on while this was loading
  const go = () => { location.hash = `#/reminders?tab=due&source=${$('#rs').value}&min_days=${$('#rm').value}`; };
  $('#rs').onchange = go; $('#rm').onchange = go;
  $('#all').onchange = e => $$('[data-p]', rb).forEach(c => { c.checked = e.target.checked; });
  $$('[data-wa]', rb).forEach(b => b.onclick = async () => {
    const x = rows.find(r => String(r.partner_id) === b.dataset.wa);
    const p = await POST('/reminders/preview', { source: src, partner_id: x.partner_id });
    window.open(waLink(x.phone, p.whatsapp), '_blank');
    await POST('/crm/activities', { partner_id: x.partner_id, type: 'sms', subject: `WhatsApp payment reminder – M ${x.amount.toFixed(2)}`, body: p.whatsapp, done: 1 }).catch(() => {});
  });
  $('#send').onclick = async () => {
    const ids = $$('[data-p]', rb).filter(c => c.checked).map(c => Number(c.dataset.p));
    if (!ids.length) return toast('Tick the customers to remind', 'err');
    try {
      const o = await POST('/reminders/send', { partner_ids: ids, source: src, channel: $('#rc').value });
      toast(`${o.sent} sent${o.failed.length ? ` · ${o.failed.length} failed: ${o.failed.slice(0, 3).map(f => `${f.name} (${f.error})`).join(', ')}` : ''}`, o.failed.length ? 'err' : 'ok', 9000); reload();
    } catch (e) { err(e); }
  };
}

/** small "remind this customer" dialog used on the lease and learner screens */
export async function remindOne(partnerId, source, phone) {
  const pv = await POST('/reminders/preview', { source, partner_id: partnerId });
  modal({ title: 'Send a payment reminder', body: `<div class="msg">${esc(pv.sms)}</div><small class="help-note">Change the wording under Reminders → Settings. Only the amount that is already overdue is mentioned.</small>`,
    actions: [{ label: 'Cancel' }, ...(phone ? [{ label: 'WhatsApp', onClick: c => { window.open(waLink(phone, pv.whatsapp), '_blank'); c(); } }] : []),
      { label: 'Email', onClick: async c => { const o = await POST('/reminders/send', { partner_ids: [partnerId], source, channel: 'email' }); c(); toast(o.sent ? 'Email sent' : `Not sent: ${(o.failed[0] || {}).error}`, o.sent ? 'ok' : 'err'); } },
      { label: 'SMS', cls: 'btn-primary', onClick: async c => { const o = await POST('/reminders/send', { partner_ids: [partnerId], source, channel: 'sms' }); c(); toast(o.sent ? 'SMS sent' : `Not sent: ${(o.failed[0] || {}).error}`, o.sent ? 'ok' : 'err'); } }] });
}

async function settingsTab(rb) {
  const s = await GET('/reminders/settings');
  const sf = [{ key: 'mode', label: 'SMS sending', type: 'select', options: [{ value: 'off', label: 'Off' }, { value: 'http', label: 'Through my SMS provider' }, { value: 'log', label: 'Test mode (nothing is sent)' }] },
    { key: 'method', label: 'Request type', type: 'select', options: [{ value: 'GET', label: 'GET (link)' }, { value: 'POST', label: 'POST (form / JSON)' }] },
    { key: 'url', label: 'Provider web address (URL)', span: 2, placeholder: 'https://api.provider.com/send?user=ME&key=SECRET&to={to}&text={message}&from={sender}' },
    { key: 'body', label: 'Body for POST (optional)', type: 'textarea', rows: 2, span: 2, placeholder: '{"to":"{to}","message":"{message}","from":"{sender}"}' },
    { key: 'headers', label: 'Extra headers (one per line, e.g. Authorization: Bearer …)', type: 'textarea', rows: 2, span: 2 },
    { key: 'sender', label: 'Sender name', placeholder: 'e.g. MOKHELEPROP' }, { key: 'success_text', label: 'Text the provider returns when sent (optional)' }, { key: 'country_code', label: 'Country code for 8-digit numbers' }];
  const tf = [{ key: 'sms', label: 'SMS message', type: 'textarea', rows: 3, span: 2 }, { key: 'email_subject', label: 'Email subject', span: 2 }, { key: 'email_body', label: 'Email message', type: 'textarea', rows: 6, span: 2 }];
  const af = [{ key: 'enabled', label: 'Send reminders automatically', type: 'checkbox', span: 2 }, { key: 'days', label: 'Days after the due date (e.g. 3, 14, 30)' },
    { key: 'channel', label: 'By', type: 'select', options: [{ value: 'sms', label: 'SMS' }, { value: 'email', label: 'Email' }, { value: 'both', label: 'SMS and email' }] },
    { key: 'min_amount', label: 'Only when at least (M)', type: 'number' }];
  rb.innerHTML = `<div class="cols cols-2" style="align-items:start"><div class="card" id="smsc"><h3>SMS provider</h3>${formHtml(sf, s.sms, { ctx: 'sms' })}
      <div class="row" style="margin-top:8px"><input id="tn" placeholder="Your phone, e.g. 5800 0000" style="max-width:220px"><button class="btn" id="tt">Send test SMS</button></div></div>
    <div><div class="card" id="tplc"><h3>Wording</h3>${formHtml(tf, s.templates, { ctx: 'remtpl' })}
      <small class="help-note">You can use {name} {amount} {oldest_date} {days} {details} {company} {phone}. Keep the SMS under 160 characters to pay for one SMS.</small><div class="msg" id="pv" style="margin-top:8px"></div></div>
      <div class="card" id="autoc" style="margin-top:14px"><h3>Automatic reminders</h3>${formHtml(af, { ...s.auto, days: s.auto.days.join(', ') }, { ctx: 'remauto' })}
        <div class="row wrap">${SRC.slice(1).map(([k, l]) => `<label class="row" style="gap:4px"><input type="checkbox" data-src="${k}" ${s.auto.sources.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
        <small class="help-note">Sent once a day after 09:00 while Maluti ERP is running, to customers whose oldest unpaid invoice is exactly that many days late${s.last_auto_run ? ` · last run ${esc(s.last_auto_run)}` : ''}.</small></div></div></div>
    <div class="row" style="margin-top:14px"><span class="spacer"></span><button class="btn btn-primary" id="save">Save</button></div>`;
  const preview = async () => { try { const p = await POST('/reminders/preview', { templates: readForm($('#tplc'), tf) }); $('#pv').innerHTML = `${esc(p.sms)}<div class="muted" style="font-size:12px">${p.sms.length} characters · ${p.sms_parts} SMS</div>`; } catch (_) {} };
  $$('#tplc textarea, #tplc input').forEach(i => i.addEventListener('input', () => { clearTimeout(i._t); i._t = setTimeout(preview, 400); }));
  preview();
  const save = async () => PUT('/reminders/settings', { sms: readForm($('#smsc'), sf), templates: readForm($('#tplc'), tf), auto: { ...readForm($('#autoc'), af), sources: $$('[data-src]').filter(c => c.checked).map(c => c.dataset.src) } });
  $('#save').onclick = async () => { try { await save(); toast('Saved'); } catch (e) { err(e); } };
  $('#tt').onclick = async () => { try { await save(); const o = await POST('/sms/test', { to: $('#tn').value }); toast(`Test SMS sent to ${o.to}${o.response ? ' – provider said: ' + String(o.response).slice(0, 80) : ''}`, 'ok', 8000); } catch (e) { err(e); } };
}
