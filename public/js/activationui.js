// Activation & KYC: trial status, existing My Wallet agent/merchant or KYC documents, request + KYC pack, activation code
import { state, GET, POST, PUT, DEL, esc, $, $$, toast, err, page, d, money } from './core.js';
import { L, lang } from './i18n.js';

const fileToDataUrl = f => new Promise((res, rej) => { if (f.size > 8 * 1024 * 1024) return rej(new Error(L('The file is bigger than 8 MB', 'Faele e kholo ho feta 8 MB'))); const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read the file')); r.readAsDataURL(f); });

export async function activationPage(view) {
  const s = await GET('/activation');
  const st = lang() === 'st';
  const head = s.activated ? `<div class="card act-ok"><b>✓ ${L('Activated', 'E butsoe')}</b> – ${esc(s.licence.business || state.company.name || '')}${s.licence.expires ? ` · ${L('valid until', 'e sebetsa ho fihlela')} ${esc(s.licence.expires)}` : ''}</div>`
    : s.locked ? `<div class="card act-bad"><b>${L('Selling is paused', 'Ho rekisa ho emisitsoe')}</b> – ${s.expired_licence ? L('your activation has expired.', 'ho bula ha hau ho felile.') : L('the 30-day trial has ended.', 'nako ea teko ea matsatsi a 30 e felile.')} ${L('Everything else still works. Finish the three steps below.', 'Tse ling tsohle li ntse li sebetsa. Phetha mehato e meraro e ka tlase.')}</div>`
    : `<div class="card act-trial"><b>${L(`Trial – ${s.days_left} days left`, `Teko – matsatsi a ${s.days_left} a setseng`)}</b> (${L('until', 'ho fihlela')} ${esc(s.trial_ends)}). ${L('Activate before then so selling does not stop.', 'Bula pele ho moo hore ho rekisa ho se eme.')}</div>`;
  const step = (n, title, body, done) => `<div class="card act-step ${done ? 'done' : ''}"><div class="row" style="gap:10px;align-items:flex-start"><span class="act-n">${done ? '✓' : n}</span><div style="flex:1"><h3 style="margin:2px 0 8px">${title}</h3>${body}</div></div></div>`;
  const kyc = s.kyc;
  view.innerHTML = page(L('Activation & KYC', 'Ho bula le KYC'), '', `${head}
    <p class="muted">${L('My Wallet must know who runs each business (KYC – "know your customer"). Existing My Wallet agents and merchants are already known, so they only give their number.', 'My Wallet e tlameha ho tseba hore na ke mang ea tsamaisang khoebo (KYC). Li-agent le bahoebi ba My Wallet ba seng ba ntse ba tsejoa, kahoo ba fana ka nomoro ea bona feela.')}</p>
    ${step(1, L('Are you already a My Wallet agent or merchant?', 'Na u se u le agent kapa mohoebi oa My Wallet?'), `<div class="wz-choices two">
        <button class="wz-choice ${kyc.path === 'merchant' ? 'on' : ''}" data-path="merchant"><b>${L('Yes – I have an agent / merchant number', 'E – ke na le nomoro ea agent / mohoebi')}</b><small>${L('My KYC is already with My Wallet. No documents needed.', 'KYC ea ka e se e le ho My Wallet. Ha ho litokomane tse hlokahalang.')}</small></button>
        <button class="wz-choice ${kyc.path === 'documents' ? 'on' : ''}" data-path="documents"><b>${L('No – I am new to My Wallet', 'Che – ke mocha ho My Wallet')}</b><small>${L('Upload photos or PDFs of a few documents.', 'Kenya lifoto kapa li-PDF tsa litokomane tse seng kae.')}</small></button></div>
      <div id="pathBody" style="margin-top:12px"></div>`, kyc.ready)}
    ${step(2, L('Send your request to My Wallet', 'Romela kopo ea hau ho My Wallet'), `<p class="muted" style="margin-top:0">${L('Your install ID', 'ID ea hau ea ho kenya')}: <b class="mono" id="iid">${esc(s.install_id)}</b> <button class="btn btn-sm" id="cp">${L('Copy', 'Kopitsa')}</button></p>
      <div class="row wrap" style="gap:8px"><button class="btn btn-primary" id="sub" ${kyc.ready ? '' : 'disabled'}>📨 ${L('Prepare my request', 'Lokisa kopo ea ka')}</button><a class="btn" id="pack" ${kyc.ready ? '' : 'style="pointer-events:none;opacity:.5"'}>⬇ ${L('Download KYC pack (.zip)', 'Jarolla KYC (.zip)')}</a></div>
      <div id="reqOut" style="margin-top:10px">${kyc.submitted_at ? `<small class="muted">${L('Request prepared on', 'Kopo e lokisitsoe ka')} ${esc(d(kyc.submitted_at))}.</small>` : ''}</div>
      <small class="help-note">${s.kyc_email ? L(`The request and your documents are emailed to ${s.kyc_email} (needs Settings → Email). You can also download the pack and send it yourself.`, `Kopo le litokomane li romeloa ka email ho ${s.kyc_email} (ho hloka Settings → Email). U ka boela ua jarolla pack ’me ua e romela ka bouena.`) : L('Send the pack (or, for agents / merchants, the request text) to your My Wallet contact by email or WhatsApp. They check it and send you an activation code.', 'Romela pack (kapa mongolo oa kopo) ho motho oa hau oa My Wallet ka email kapa WhatsApp. Ba e hlahloba ’me ba u romella khoutu ea ho bula.')}</small>`, !!kyc.submitted_at)}
    ${step(3, L('Enter the activation code', 'Kenya khoutu ea ho bula'), s.activated ? `<p>${L('Done – this business is activated.', 'Ho felile – khoebo ena e butsoe.')}</p>` : `<textarea id="code" rows="3" placeholder="${L('Paste the whole code you received from My Wallet', 'Kenya khoutu eohle eo u e fumaneng ho My Wallet')}" style="font-family:monospace"></textarea>
      <button class="btn btn-ok" id="act" style="margin-top:8px">✓ ${L('Activate', 'Bula')}</button>`, s.activated)}`);
  const reload = () => activationPage(view);
  const pb = $('#pathBody');
  const drawPath = () => {
    if (kyc.path === 'merchant') {
      pb.innerHTML = `<div class="form-grid"><label class="field"><span>${L('My Wallet agent / merchant number', 'Nomoro ea agent / mohoebi oa My Wallet')} *</span><input id="mn" value="${esc(kyc.merchant_no || '')}"></label>
        <label class="field"><span>${L('Phone number registered with My Wallet', 'Nomoro ea mohala e ngolisitsoeng ho My Wallet')} *</span><input id="mp" inputmode="tel" value="${esc(kyc.merchant_phone || '')}"></label></div><button class="btn btn-primary" id="sm" style="margin-top:8px">${L('Save', 'Boloka')}</button>`;
      $('#sm').onclick = async () => { try { await PUT('/activation/kyc', { path: 'merchant', merchant_no: $('#mn').value.trim(), merchant_phone: $('#mp').value.trim() }); toast(L('Saved', 'E bolokiloe')); reload(); } catch (e) { err(e); } };
    } else if (kyc.path === 'documents') {
      pb.innerHTML = `<table class="grid">${s.doc_types.map(t => { const f = s.documents.find(x => x.doc === t.key);
        return `<tr><td>${f ? '✅' : t.required ? '⬜' : '▫️'}</td><td><b>${esc(st ? t.name_st : t.name)}</b>${t.required ? '' : ` <small class="muted">(${L('if you have it', 'haeba u na le eona')})</small>`}${f ? `<br><small class="muted">${esc(f.filename)}</small>` : ''}</td>
          <td class="r" style="white-space:nowrap">${f ? `<a class="btn btn-sm" href="/api/activation/documents/${f.id}" data-view="${f.id}">${L('View', 'Sheba')}</a> <button class="btn btn-sm" data-del="${f.id}">✕</button>` : ''}
          <label class="btn btn-sm ${f ? '' : 'btn-primary'}">${f ? L('Replace', 'Fetola') : '⬆ ' + L('Upload', 'Kenya')}<input type="file" accept="image/*,application/pdf" capture="environment" data-doc="${t.key}" hidden></label></td></tr>`; }).join('')}</table>
        <small class="help-note">${L('A clear phone photo is fine. All four corners of the document must show and the writing must be readable.', 'Foto e hlakileng ea mohala e lokile. Likhutlo tsohle tse ’nè tsa tokomane li tlameha ho bonahala.')}</small>`;
      $$('[data-doc]', pb).forEach(i => i.onchange = async () => { const f = i.files[0]; if (!f) return; try { toast(L('Uploading…', 'E ea kenngoa…')); await POST('/activation/documents', { doc: i.dataset.doc, filename: f.name, data_url: await fileToDataUrl(f) }); reload(); } catch (e) { err(e); } });
      $$('[data-del]', pb).forEach(b => b.onclick = async () => { await DEL('/activation/documents/' + b.dataset.del); reload(); });
      $$('[data-view]', pb).forEach(a => a.onclick = async e => { e.preventDefault(); const r = await fetch(a.getAttribute('href'), { headers: { Authorization: 'Bearer ' + state.token } }); window.open(URL.createObjectURL(await r.blob()), '_blank'); });
    } else pb.innerHTML = '';
  };
  drawPath();
  $$('[data-path]').forEach(b => b.onclick = async () => { if (b.dataset.path === 'documents') { try { await PUT('/activation/kyc', { path: 'documents' }); } catch (e) { return err(e); } reload(); } else { kyc.path = 'merchant'; $$('[data-path]').forEach(x => x.classList.toggle('on', x === b)); drawPath(); } });
  $('#cp').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(s.install_id); toast(L('Copied', 'E kopitsoe')); };
  $('#sub').onclick = async () => { try { const o = await POST('/activation/submit', {});
    $('#reqOut').innerHTML = `<textarea readonly rows="9" style="font-family:monospace;font-size:12px">${esc(o.request_text)}</textarea><div class="row" style="gap:8px;margin-top:6px"><button class="btn btn-sm" id="cpr">${L('Copy the request', 'Kopitsa kopo')}</button>${o.emailed ? `<span class="badge badge-ok">${L('emailed to', 'e rometsoe ho')} ${esc(o.kyc_email)}</span>` : ''}</div>
      ${!o.emailed && o.kyc_email ? `<div class="card act-trial" style="margin-top:8px">${L('It could not be emailed from here', 'Ha ea khona ho romeloa ka email mona')}${o.email_error ? ` (${esc(o.email_error)})` : ''}. ${L('Download the KYC pack and send it, with the request text, to', 'Jarolla KYC pack ’me u e romele, le mongolo oa kopo, ho')} <a href="mailto:${esc(o.kyc_email)}?subject=${encodeURIComponent('Activation request ' + o.install_id)}&body=${encodeURIComponent(o.request_text)}">${esc(o.kyc_email)}</a>.</div>` : ''}`;
    $('#cpr').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(o.request_text); toast(L('Copied', 'E kopitsoe')); }; } catch (e) { err(e); } };
  $('#pack').onclick = async e => { e.preventDefault(); try { const r = await fetch('/api/activation/pack', { headers: { Authorization: 'Bearer ' + state.token } }); if (!r.ok) throw new Error((await r.json()).error);
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `KYC ${state.company.name || ''} ${s.install_id}.zip`; a.click(); } catch (x) { err(x); } };
  if ($('#act')) $('#act').onclick = async () => { try { await POST('/activation/code', { code: $('#code').value }); toast(L('Activated – thank you!', 'E butsoe – re a leboha!')); state.activation = null; reload(); } catch (e) { err(e); } };
}

/** the strip under the top bar: days left in the trial, or selling paused */
export function banner(s, isAdmin) {
  if (!s || s.activated) return '';
  if (s.locked) return `<a class="act-banner bad" href="${isAdmin ? '#/activation' : '#/'}">⛔ ${L('Selling is paused until this business is activated.', 'Ho rekisa ho emisitsoe ho fihlela khoebo ena e butsoa.')} ${isAdmin ? L('Finish activation →', 'Phetha ho bula →') : L('Ask the owner to finish activation.', 'Kopa mong\'a khoebo ho phetha ho bula.')}</a>`;
  if (isAdmin) return `<a class="act-banner" href="#/activation">🪪 ${L(`Trial: ${s.days_left} days left. Finish KYC and activation so selling does not stop →`, `Teko: matsatsi a ${s.days_left} a setseng. Phetha KYC le ho bula →`)}</a>`;
  return '';
}
