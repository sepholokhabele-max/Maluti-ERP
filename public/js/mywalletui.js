// My Wallet payments (My Wallet API v4): the settings page and the till's "Ask customer to pay" window.
import { GET, POST, PUT, esc, $, $$, toast, err, page, modal, money, dt, badge, tableHtml } from './core.js';
import { L } from './i18n.js';

export const isMyWalletMethod = m => /^mywallet:/.test(String((m && m.plugin_id) || ''));
const STATUS_KIND = { PAID: 'paid', PENDING: 'draft', NEW: 'draft', DECLINED: 'cancelled', CANCELLED: 'cancelled', EXPIRED: 'overdue', FAILED: 'overdue', REFUNDED: 'cancelled', PARTIALLY_REFUNDED: 'partial' };
const stBadge = s => badge(s.replace('_', ' '), STATUS_KIND[s] || '');

// ---------------------------------------------------------------- settings page
export async function myWalletPage(view) {
  const st = await GET('/mywallet/status');
  const s = st.settings;
  const linked = !!(s.key_id && s.has_secret);
  view.innerHTML = page(L('My Wallet payments', 'Litefo tsa My Wallet'), '', `
    <div class="card ${s.enabled ? 'act-ok' : 'act-trial'}" style="margin-bottom:12px"><b>${s.enabled ? (s.mode === 'live' ? '✅ ' + L('On – live', 'E butsoe – live') : '🧪 ' + L('On – demo (nothing leaves this computer)', 'E butsoe – demo')) : L('Off', 'E koetsoe')}</b>
      ${s.till_number ? ` · ${L('Till', 'Till')} <b>${esc(s.till_number)}</b>` : ''}${s.merchant_name ? ` · ${esc(s.merchant_name)}` : ''}
      <div class="muted" style="margin-top:6px">${L('Customers pay at the till from their My Wallet (scan the QR or approve a request on their phone), or from M-Pesa, EcoCash and other wallets through the national payment switch. The money goes to your My Wallet agent account.', 'Bareki ba lefa ka My Wallet kapa li-wallet tse ling ka switch.')}</div></div>
    <div class="cols cols-2">
      <div class="card"><h3>${L('Link this shop to My Wallet', 'Hokahanya lebenkele le My Wallet')}</h3>
        <p class="muted">${L('Enter the My Wallet address and your agent number (till number or the agent cell number) and password. My Wallet checks them and gives this installation its own payment key – nobody has to copy keys by hand. This also activates S-ERP.', 'Kenya aterese ea My Wallet, nomoro ea agent le phasewete.')}</p>
        <div class="form-grid">
          <label class="field"><span>${L('My Wallet address', 'Aterese ea My Wallet')}</span><input id="url" placeholder="https://api.mywallet.co.ls" value="${esc(s.api_url || '')}"></label>
          <label class="field"><span>${L('Agent number', 'Nomoro ea agent')}</span><input id="ag" autocomplete="off"></label>
          <label class="field"><span>${L('Agent password', 'Phasewete ea agent')}</span><input id="pw" type="password" autocomplete="off"></label>
        </div>
        <div class="row" style="gap:8px;margin-top:10px"><button class="btn btn-primary" id="link">${linked ? L('Link again', 'Hokahanya hape') : L('Link and switch on', 'Hokahanya')}</button>
          ${linked || s.mode === 'demo' ? `<button class="btn" id="test">${L('Test the connection', 'Leka khokahano')}</button>` : ''}</div>
        ${s.linked_at ? `<small class="help-note">${L('Linked', 'E hokahantsoe')} ${esc(dt(s.linked_at))} · ${L('key', 'key')} ${esc(s.key_id)}</small>` : ''}
      </div>
      <div class="card"><h3>${L('Options', 'Likhetho')}</h3>
        <div class="form-grid">
          <label class="field"><span>${L('Payments at the till', 'Litefo till')}</span><select id="en"><option value="1" ${s.enabled ? 'selected' : ''}>${L('On', 'E butsoe')}</option><option value="0" ${!s.enabled ? 'selected' : ''}>${L('Off', 'E koetsoe')}</option></select></label>
          <label class="field"><span>${L('Mode', 'Mokhoa')}</span><select id="mode"><option value="demo" ${s.mode === 'demo' ? 'selected' : ''}>${L('Demo (simulator)', 'Demo')}</option><option value="live" ${s.mode === 'live' ? 'selected' : ''}>${L('Live', 'Live')}</option></select></label>
          <label class="field"><span>${L('Customer has … seconds to approve', 'Metsotsoana ea ho amohela')}</span><input id="ttl" type="number" min="60" max="900" value="${Number(s.request_ttl)}"></label>
          <label class="field"><span>${L('Key id (only if My Wallet gave you one by hand)', 'Key id')}</span><input id="kid" value="${esc(s.key_id || '')}"></label>
          <label class="field"><span>${L('Key secret', 'Lekunutu')}</span><input id="sec" type="password" placeholder="${s.has_secret ? '********' : ''}" autocomplete="off"></label>
        </div>
        <button class="btn" id="save" style="margin-top:10px">${L('Save', 'Boloka')}</button>
        <small class="help-note">${L('The key secret stays on this server; tills and browsers never see it.', 'Lekunutu le lula server.')}</small>
      </div>
    </div>
    <div class="cols cols-3" style="margin:12px 0">
      <div class="card"><small class="muted">${L('Paid today', 'Tse lefiloeng kajeno')}</small><h2>${money(st.today.total)}</h2><small>${st.today.count} ${L('payments', 'litefo')}</small></div>
      <div class="card"><small class="muted">${L('Due from My Wallet (account 1150)', 'E tlang ho tsoa My Wallet (1150)')}</small><h2>${money(st.digital_due)}</h2><small>${L('Record the payout under Smartel connection → Settle when My Wallet pays you out', 'Ngola tefo ha My Wallet e u lefa')}</small></div>
      <div class="card ${st.unused.count ? 'act-bad' : ''}"><small class="muted">${L('Approved but not on a sale', 'E amohetsoe empa ha e ea rekisoa')}</small><h2>${money(st.unused.total)}</h2><small>${st.unused.count ? L('A customer paid but the sale was not finished – find it below and refund it in My Wallet, or finish the sale.', 'Moreki o lefile empa thekiso ha ea phethoa.') : L('None', 'Ha ho')}</small></div>
    </div>
    <div class="card"><h3>${L('Recent payment requests', 'Likopo tsa morao tjena')}</h3>${tableHtml([
      { label: L('When', 'Neng'), key: 'created_at', fmt: v => dt(v) }, { label: L('Code', 'Khoutu'), key: 'code', html: true, fmt: v => `<b>${esc(v || '')}</b>` },
      { label: L('Method', 'Mokhoa'), key: 'method_name', fmt: (v, p) => v || p.channel }, { label: L('Customer', 'Moreki'), key: 'payer_cell', fmt: v => v || '' },
      { label: L('Amount', 'Chelete'), key: 'amount', right: true, fmt: v => money(v) },
      { label: L('Status', 'Boemo'), key: 'status', html: true, fmt: (v, p) => stBadge(v) + (Number(p.refunded) ? ` <small>${L('refunded', 'e khutlisitsoe')} ${money(p.refunded)}</small>` : '') },
      { label: L('Sale', 'Thekiso'), key: 'order_number', fmt: (v, p) => p.order_id ? (v || '#' + p.order_id) : '' }, { label: '', key: 'mode', fmt: v => v === 'demo' ? 'demo' : '' }
    ], st.recent, { empty: L('No payment requests yet.', 'Ha ho likopo.') })}</div>`);

  $('#link').onclick = async () => {
    try { const r = await POST('/mywallet/link', { api_url: $('#url').value.trim(), agent_no: $('#ag').value.trim(), password: $('#pw').value }); $('#pw').value = ''; toast(L(`Linked – till ${r.till_number} (${r.name})`, `E hokahantsoe – till ${r.till_number}`)); myWalletPage(view); }
    catch (e) { err(e); }
  };
  if ($('#test')) $('#test').onclick = async () => { try { const r = await POST('/mywallet/test'); toast(`${L('Connected', 'E hokahane')}: ${r.till_number} · ${r.name}`); } catch (e) { err(e); } };
  $('#save').onclick = async () => {
    try { await PUT('/mywallet/settings', { enabled: $('#en').value === '1', mode: $('#mode').value, request_ttl: Number($('#ttl').value), key_id: $('#kid').value.trim(), secret: $('#sec').value, api_url: $('#url').value.trim() }); toast(L('Saved', 'E bolokiloe')); myWalletPage(view); }
    catch (e) { err(e); }
  };
}

// ---------------------------------------------------------------- the till
/** ask the customer to pay p.amount with My Wallet / another wallet; resolves when approved (p.approved = true) */
export async function askMyWallet(S, p, btn, redraw) {
  const sw = p.m.plugin_id === 'mywallet:switch';
  const members = (S.catalog.mywallet && S.catalog.mywallet.members) || [];
  // 1. who pays (optional number for My Wallet, required wallet for the switch)
  const who = await new Promise(resolve => {
    let chosen = null;
    modal({ title: `${esc(p.m.name)} – ${money(p.amount)}`, body: `<div class="form-grid">
        ${sw ? `<label class="field"><span>${L('Customer’s wallet', 'Wallet ea moreki')}</span><select id="mwm">${members.map(m => `<option value="${m.code}">${esc(m.name)}</option>`).join('')}</select></label>` : ''}
        <label class="field"><span>${L('Customer’s cell number', 'Nomoro ea moreki')}${sw ? '' : ' ' + L('(optional – they get the request on their phone)', '(ha ho tlamo)')}</span><input id="mwc" inputmode="tel" placeholder="5xxxxxxx / 6xxxxxxx" value="${esc(p.phone || '')}"></label></div>`,
      onClose: () => resolve(chosen),
      actions: [{ label: L('Cancel', 'Hlakola') }, { label: '📲 ' + L('Send the request', 'Romela kopo'), cls: 'btn-primary', onClick: close => { chosen = { cell: $('#mwc').value.trim(), member: sw ? $('#mwm').value : undefined }; close(); } }] });
  });
  if (!who) return;
  btn.disabled = true;
  let it;
  try { it = await POST('/mywallet/payments', { method_id: p.method_id, amount: p.amount, payer_cell: who.cell || undefined, payer_member: who.member, session_id: S.session && S.session.id, partner_id: S.order && S.order.partner_id }); }
  catch (e) { btn.disabled = false; return err(e); }
  p.phone = who.cell || p.phone;
  let stop = false;
  const close = modal({ title: `${esc(p.m.name)} – ${money(p.amount)}`, body: `<div style="text-align:center">
      ${it.qr_svg ? `<div style="width:210px;margin:0 auto">${it.qr_svg}</div>` : ''}
      <div style="font-size:28px;letter-spacing:4px;margin:6px 0"><b id="mwCode">${esc(it.code || '')}</b></div>
      <p class="muted">${sw ? esc(it.instructions || '') : L('Ask the customer to scan the code in the My Wallet app (or open the request on their phone) and approve with their PIN.', 'Kopa moreki ho scan khoutu ka My Wallet ’me a amohele ka PIN.')}</p>
      <p id="mwSt">${stBadge(it.status)} <small class="muted">${L('waiting for the customer…', 'ho emetsoe moreki…')}</small></p>
      ${it.mode === 'demo' ? `<div class="row" style="justify-content:center;gap:8px"><button class="btn btn-sm" id="mwSimOk">🧪 ${L('Simulate: customer approves', 'Etsisa: moreki o amohela')}</button><button class="btn btn-sm" id="mwSimNo">🧪 ${L('Simulate: declines', 'Etsisa: o hana')}</button></div>` : ''}
      <small class="help-note">${L('The till never sees the customer’s PIN. The sale can only be finished once My Wallet says it is paid.', 'Till ha e bone PIN ea moreki.')}</small></div>`,
    onClose: () => { stop = true; if (!p.approved) POST(`/mywallet/payments/${it.id}/cancel`).catch(() => {}); },
    actions: [{ label: L('Cancel the request', 'Hlakola kopo') }] });
  const sim = o => POST(`/mywallet/payments/${it.id}/simulate`, { outcome: o }).catch(err);
  if ($('#mwSimOk')) { $('#mwSimOk').onclick = () => sim('approve'); $('#mwSimNo').onclick = () => sim('decline'); }
  try {
    for (let i = 0; i < 400 && !stop; i++) {
      await new Promise(r => setTimeout(r, 1500));
      if (stop) break;
      it = await GET('/mywallet/payments/' + it.id).catch(() => it);
      const el = document.getElementById('mwSt'); if (el) el.innerHTML = stBadge(it.status);
      if (it.paid) {
        Object.assign(p, { mywallet_payment_id: it.id, reference: `MW ${it.code}`, approved: true, phone: it.payer_cell || p.phone });
        toast(L('Customer paid with My Wallet', 'Moreki o lefile ka My Wallet')); stop = true; close(); redraw(); return;
      }
      if (it.final) { toast(`${L('Payment', 'Tefo')} ${it.status.toLowerCase()}`, 'err', 5000); stop = true; close(); return; }
    }
  } finally { btn.disabled = false; }
}
