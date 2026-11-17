// Activation: the My Wallet agent number and password (once – no trial, no codes, no expiry). For businesses that are
// not yet My Wallet agents: the application to My Wallet with the KYC documents.
import { state, GET, POST, PUT, DEL, esc, $, $$, toast, err, page, d } from './core.js';
import { L } from './i18n.js';

const fileToDataUrl = f => new Promise((res, rej) => { if (f.size > 8 * 1024 * 1024) return rej(new Error(L('The file is bigger than 8 MB', 'Faele e kholo ho feta 8 MB'))); const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read the file')); r.readAsDataURL(f); });

export async function activationPage(view) {
  const s = await GET('/activation');
  const head = s.activated ? `<div class="card act-ok"><b>✅ ${L('S-ERP is activated', 'S-ERP e butsoe')}</b> – ${s.agent ? L(`My Wallet agent ${esc(s.agent.number)} since ${esc(d(s.agent.activated_at))}`, `agent ea My Wallet ${esc(s.agent.number)} ho tloha ${esc(d(s.agent.activated_at))}`) : L('activated with an activation code (it no longer expires)', 'e butsoe ka khoutu (ha e sa fela)')}.</div>`
    : s.demo ? `<div class="card act-trial"><b>${L('Demo mode', 'Mokhoa oa demo')}</b> – ${L('activate with your My Wallet agent number and password to work with your real business. There is no time limit.', 'bula ka nomoro ea agent le phasewete ea My Wallet ho sebetsa ka khoebo ea hau ea nnete.')}</div>`
    : `<div class="card act-bad"><b>${L('Not activated', 'Ha e e-s’o buloe')}</b> – ${L('selling is paused until the owner enters the My Wallet agent number and password below.', 'ho rekisa ho emisitsoe ho fihlela mong’a khoebo a kenya nomoro ea agent le phasewete.')}</div>`;
  view.innerHTML = page(L('Activation', 'Ho bula'), '', `${head}
    <div class="cols cols-2"><div class="card"><h3>${s.activated && s.agent ? L('Change the My Wallet agent', 'Fetola agent ea My Wallet') : L('Activate with My Wallet', 'Bula ka My Wallet')}</h3>
      <div class="form-grid"><label class="field"><span>${L('My Wallet agent number', 'Nomoro ea agent ea My Wallet')}</span><input id="an" autocomplete="off" autocapitalize="characters"></label>
        <label class="field"><span>${L('My Wallet password', 'Phasewete ea My Wallet')}</span><input id="ap" type="password" autocomplete="off"></label></div>
      <button class="btn btn-primary" id="act" style="margin-top:10px">${s.activated && s.agent ? L('Save', 'Boloka') : L('Activate', 'Bula')}</button>
      <p class="muted" style="margin-top:10px">${L('Once activated there is nothing to renew. The owner can also sign in to S-ERP with this agent number and password.', 'Ha e se e butsoe ha ho letho la ho nchafatsa. Mong’a khoebo a ka kena ka nomoro ena le phasewete.')}${s.agent && s.agent.owner ? ` ${L('Linked to', 'E hokahantsoe le')} <b>${esc(s.agent.owner)}</b>.` : ''}</p>
      <p class="muted" style="font-size:12px">${s.agent && s.agent.check === 'mywallet' ? L(`Checked by My Wallet – till ${esc(s.agent.till_number || '')}${s.agent.name ? ' · ' + esc(s.agent.name) : ''}. My Wallet payments at the till are switched on.`, `E netefalitsoe ke My Wallet – till ${esc(s.agent.till_number || '')}.`)
        : L('Checked by S-ERP itself and kept only as a one-way code. Set the My Wallet address under Settings → My Wallet payments and activate again to have My Wallet check it and link the till payments.', 'E hlahlojoa ke S-ERP. Kenya aterese ea My Wallet tlas’a Settings → My Wallet payments ’me u bule hape.')}</p></div>
    <div class="card" ${s.activated ? 'hidden' : ''}><h3>${L('Not a My Wallet agent yet?', 'Ha u e-s’o be agent ea My Wallet?')}</h3>
      <p>${L('Apply to My Wallet: upload your documents and send the application. My Wallet gives you an agent number and password; then activate here.', 'Etsa kopo ho My Wallet: kenya litokomane ’me u romele kopo.')}</p>
      <table class="grid">${s.doc_types.map(t => { const f = s.documents.find(x => x.doc === t.key); return `<tr><td>${f ? '✅' : t.required ? '⬜' : '▫️'}</td><td><b>${esc(L(t.name, t.name_st))}</b>${f ? `<br><small class="muted">${esc(f.filename)}</small>` : ''}</td>
        <td class="r" style="white-space:nowrap">${f ? `<button class="btn btn-sm" data-del="${f.id}">${L('Remove', 'Tlosa')}</button> ` : ''}<label class="btn btn-sm ${f ? '' : 'btn-primary'}">${f ? L('Replace', 'Fetola') : '⬆ ' + L('Upload', 'Kenya')}<input type="file" accept="image/*,application/pdf" data-doc="${t.key}" hidden></label></td></tr>`; }).join('')}</table>
      <div class="row" style="margin-top:10px;gap:8px"><button class="btn" id="sub">${L('Send the application to My Wallet', 'Romela kopo ho My Wallet')}</button><a class="btn" href="#" id="pack">⬇ ${L('Download the application', 'Jarolla kopo')}</a></div>
      <small class="help-note">${L(`The application is emailed to ${s.kyc_email} (needs Settings → Email). Install ID: ${s.install_id}`, `Kopo e romelloa ho ${s.kyc_email}. Install ID: ${s.install_id}`)}</small></div></div>`);
  const reload = () => activationPage(view);
  $('#act').onclick = async () => {
    try { await POST('/activation/agent', { agent_no: $('#an').value.trim(), password: $('#ap').value }); $('#ap').value = ''; toast(L('Activated – thank you!', 'E butsoe – re a leboha!')); state.activation = await GET('/activation'); reload(); }
    catch (e) { err(e); }
  };
  $$('[data-doc]').forEach(i => i.onchange = async () => { const f = i.files[0]; if (!f) return; try { await POST('/activation/documents', { doc: i.dataset.doc, filename: f.name, data_url: await fileToDataUrl(f) }); reload(); } catch (e) { err(e); } });
  $$('[data-del]').forEach(b => b.onclick = async () => { await DEL('/activation/documents/' + b.dataset.del); reload(); });
  $('#sub').onclick = async () => {
    try { await PUT('/activation/kyc', { path: 'documents' }); const o = await POST('/activation/submit', {}); toast(o.emailed ? L('Sent to My Wallet', 'E rometsoe ho My Wallet') : (o.email_error || L('Download the application and send it to My Wallet', 'Jarolla kopo ’me u e romele')), o.emailed ? 'ok' : 'err', 6000); }
    catch (e) { err(e); }
  };
  $('#pack').onclick = async e => { e.preventDefault(); try { await PUT('/activation/kyc', { path: 'documents' }); const r = await fetch('/api/activation/pack', { headers: { Authorization: 'Bearer ' + state.token } }); if (!r.ok) throw new Error((await r.json()).error); const b = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `My Wallet application ${s.install_id}.zip`; a.click(); } catch (x) { err(x); } };
}

/** the strip under the top bar: not activated, or demo mode */
export function banner(s, isAdmin) {
  if (!s || s.activated) return '';
  if (s.locked) return `<a class="act-banner bad" href="${isAdmin ? '#/activation' : '#/'}">⛔ ${L('S-ERP is not activated – selling is paused.', 'S-ERP ha e e-s’o buloe – ho rekisa ho emisitsoe.')} ${isAdmin ? L('Activate with your My Wallet agent number →', 'Bula ka nomoro ea agent ea My Wallet →') : L('Ask the owner to activate it.', 'Kopa mong\'a khoebo ho e bula.')}</a>`;
  if (s.demo && isAdmin) return `<a class="act-banner" href="#/activation">🧪 ${L('Demo mode. Activate with your My Wallet agent number to work with your real business →', 'Mokhoa oa demo. Bula ka nomoro ea agent ea My Wallet →')}</a>`;
  return '';
}
