// Customer portal: make / share / switch off a customer's private link, and the portal settings (Settings → Customer portal)
import { GET, POST, PUT, DEL, esc, $, toast, err, modal, formHtml, readForm, tableHtml, dt, confirmBox, can } from './core.js';
import { L } from './i18n.js';

export async function portalLinkDialog(partnerId, name) {
  let x;
  try { x = await POST(`/partners/${partnerId}/portal-link`); } catch (e) { return err(e); }
  const logRows = await GET(`/partners/${partnerId}/portal-log`).catch(() => []);
  const wa = `https://wa.me/${String(x.phone || '').replace(/\D/g, '').replace(/^(?=[56]\d{7}$)/, '266')}?text=${encodeURIComponent(L('See your account and pay online: ', 'Bona akhaonto ea hau ’me u lefe inthaneteng: ') + x.url)}`;
  modal({ title: `🔗 ${L('Customer portal', 'Portal ea moreki')} – ${name || x.name}`, size: 'lg', body: `<div class="cols cols-2" style="align-items:center"><div style="max-width:220px;margin:0 auto">${x.qr_svg}</div>
      <div><p>${L('Anyone with this link sees this customer\'s balance, invoices and statement, and can pay online or send proof of a bank payment. Share it only with the customer.', 'Mang kapa mang ea nang le link ena o bona akhaonto ea moreki enoa. E arolelane le moreki feela.')}</p>
      <input id="pl" readonly value="${esc(x.url)}" style="width:100%"><div class="row wrap" style="gap:6px;margin-top:8px"><button class="btn" id="cp">${L('Copy', 'Kopitsa')}</button><a class="btn" href="${esc(x.url)}" target="_blank" rel="noopener">${L('Open', 'Bula')}</a>
      ${x.phone ? `<button class="btn" id="sms">📱 SMS</button><a class="btn" target="_blank" rel="noopener" href="${esc(wa)}">WhatsApp</a>` : ''}</div>
      <small class="help-note">${L('"New link" switches the old one off – use it if a link was sent to the wrong person.', '"New link" e tima link ea khale.')}</small></div></div>
      ${logRows.length ? `<h4>${L('Recent visits', 'Ho etela ha morao')}</h4>${tableHtml([{ key: 'created_at', label: L('When', 'Neng'), fmt: dt }, { key: 'action', label: L('What', 'Eng') }, { key: 'detail', label: '' }], logRows.slice(0, 10))}` : ''}`,
    onOpen: r => {
      r.querySelector('#cp').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(x.url); r.querySelector('#pl').select(); toast(L('Copied', 'E kopitsoe')); };
      const s = r.querySelector('#sms'); if (s) s.onclick = async () => { try { await POST(`/partners/${partnerId}/portal-link/sms`); toast(L('SMS sent', 'SMS e rometsoe')); } catch (e) { err(e); } };
    },
    actions: [{ label: L('Switch off', 'Tima'), onClick: async c => { if (!await confirmBox(L('Switch this link off? The customer can no longer open it.', 'Tima link ena?'))) return; await DEL(`/partners/${partnerId}/portal-link`); c(); toast(L('Link switched off', 'Link e timiloe')); } },
      { label: L('New link', 'Link e ncha'), onClick: async c => { await POST(`/partners/${partnerId}/portal-link`, { renew: 1 }); c(); portalLinkDialog(partnerId, name); } }, { label: L('Close', 'Koala'), cls: 'btn-primary' }] });
}

export async function portalSettingsTab(sb) {
  const [s, sm] = await Promise.all([GET('/portal/settings'), GET('/smartel/status').catch(() => null)]);
  const tills = sm ? sm.terminals.filter(t => t.terminal_uuid) : [];
  const f = [{ key: 'enabled', label: L('Customer portal switched on', 'Portal e butsoe'), type: 'checkbox' }, { key: 'allow_proof', label: L('Customers may upload proof of a bank payment', 'Bareki ba ka kenya bopaki ba tefo'), type: 'checkbox' },
    { key: 'terminal_id', label: L('Online payments (MyWallet / card / Switch) through the Smartel till', 'Litefo inthaneteng ka till ea Smartel'), type: 'select', options: [{ value: '', label: L('— no online payment —', '— ha ho tefo inthaneteng —') }, ...tills.map(t => ({ value: t.pos_terminal_id, label: t.name }))] }];
  sb.innerHTML = `<div class="card"><div id="pf">${formHtml(f, { ...s, terminal_id: s.terminal_id || '' }, { ctx: 'portal' })}</div><button class="btn btn-primary" id="ps" style="margin-top:8px">${L('Save', 'Boloka')}</button>
    <p class="muted">${L('Make a customer\'s link from their contact (Contacts → customer → 🔗 Portal link). The portal must be reachable from the internet – see "Web version" in the README, or set the public address under Settings → Company → receipt QR.', 'Etsa link ho tsoa ho contact ea moreki.')}</p></div>`;
  $('#ps').onclick = async () => { try { await PUT('/portal/settings', readForm($('#pf'), f)); toast(L('Saved', 'E bolokiloe')); } catch (e) { err(e); } };
}
