// First run, made foolproof: one question per screen, big buttons, English or Sesotho from the first click, every answer
// checked before moving on, nothing lost on a reload, a summary before anything is created, and a clear "what next".
// Also the first-time tour of the home screen.
import { state, POST, PUT, GET, esc, $, $$, toast, setToken, imageFileToDataUrl, ensureLogo } from './core.js';
import { lang, setLang, L } from './i18n.js';

const KEY = 'maluti_setup';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { return {}; } };
const keep = d => { try { const { password, password2, pin, ...rest } = d; localStorage.setItem(KEY, JSON.stringify(rest)); } catch (_) {} };
const friendly = m => {
  m = String(m || '');
  if (/ECONNREFUSED|connect ETIMEDOUT|ENOTFOUND/i.test(m)) return L('Cannot reach MySQL on that computer. Check that MySQL is running and the server name is right – or use the built-in database.', 'Ha ho khonehe ho fihla MySQL k\'homphieutheng eo. Sheba hore MySQL ea sebetsa – kapa sebelisa database e kahare.');
  if (/ER_ACCESS_DENIED|Access denied/i.test(m)) return L('MySQL refused the user name or password. Type the MySQL password chosen when MySQL was installed.', 'MySQL e hanne lebitso kapa phasewete.');
  if (/Failed to fetch|NetworkError/i.test(m)) return L('The program is not answering. Close Maluti ERP and open it again.', 'Lenaneo ha le arabe. Koala Maluti ERP ’me u e bule hape.');
  return m;
};

export async function firstRun(onDone) {
  const st = state.status || {};
  const d = { step: 'welcome', types: ['retail'], currency: 'LSL', vat_registered: 'yes', vat_rate: 15, start: 'clean', ...load() };
  if (st.connected && d.step === 'storage') d.step = 'business';
  const steps = [['welcome', L('Language', 'Puo')], ...(st.connected ? [] : [['storage', L('Storage', 'Polokelo')]]), ['business', L('Your business', 'Khoebo ea hau')],
    ['types', L('What you do', 'Seo u se etsang')], ['login', L('Your login', 'Ho kena ha hau')], ['kyc', 'KYC'], ['review', L('Check', 'Hlahloba')]];
  let types = null, logo = null; const kycFiles = {};
  const DOCS = [['owner_id', L('ID or passport of the owner', 'ID kapa phasepoto ea mong\'a khoebo'), 1], ['registration', L('Company registration or trader\'s licence', 'Ngoliso ea khamphani kapa laesense ea khoebo'), 1], ['address', L('Proof of business address', 'Bopaki ba aterese ea khoebo'), 1], ['tax', L('TIN / VAT certificate (if you have it)', 'Setifikeiti sa TIN / VAT (haeba u na le sona)'), 0], ['bank', L('Bank confirmation letter (if you have it)', 'Lengolo la banka (haeba u na le lona)'), 0]];
  const go = s => { d.step = s; keep(d); draw(); window.scrollTo(0, 0); };
  const bar = () => { const i = steps.findIndex(x => x[0] === d.step);
    return `<div class="wz-steps">${steps.map(([k, l], n) => `<div class="wz-step ${n < i ? 'done' : n === i ? 'on' : ''}"><span>${n < i ? '✓' : n + 1}</span><small>${l}</small></div>`).join('')}</div>`; };
  const card = (title, sub, body, { back, next = L('Next', 'E latelang') + ' →', nextId = 'nx' } = {}) => `<div class="auth"><div class="auth-card wide wz">${bar()}
    <h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}${body}
    <div class="wz-err" id="wzErr" role="alert"></div>
    <div class="row wz-nav">${back ? `<button class="btn btn-lg" id="bk">← ${L('Back', 'Morao')}</button>` : '<span></span>'}<span class="spacer"></span>${next ? `<button class="btn btn-primary btn-lg" id="${nextId}">${next}</button>` : ''}</div></div></div>`;
  const fail = (msg, el) => { const e = $('#wzErr'); e.textContent = msg; e.style.display = 'block'; if (el) { el.classList.add('invalid'); el.focus(); el.addEventListener('input', () => el.classList.remove('invalid'), { once: true }); } };
  const val = id => ($(id) ? $(id).value.trim() : '');
  const idx = s => steps.findIndex(x => x[0] === s);
  const prev = () => steps[Math.max(0, idx(d.step) - 1)][0];
  const nextOf = s => steps[Math.min(steps.length - 1, idx(s) + 1)][0];

  async function draw() {
    const app = $('#app');
    if (d.step === 'welcome') {
      app.innerHTML = card(`<div class="logo">M</div>${L('Welcome to Maluti ERP', 'Rea u amohela ho Maluti ERP')}`, L('Let\'s get your business ready. It takes about 5 minutes and you can change everything later.', 'A re lokise khoebo ea hau. Ho nka metsotso e ka bang 5 ’me u ka fetola tsohle hamorao.'),
        `<h4 style="margin:6px 0 10px">${L('Which language do you prefer for the instructions?', 'U khetha puo efe bakeng sa litaelo?')}</h4>
        <div class="wz-choices">${[['en', 'English', 'Instructions in English'], ['st', 'Sesotho', 'Litaelo ka Sesotho'], ['both', 'English + Sesotho', 'Both, one under the other / Ka bobeli']].map(([k, t, s]) =>
          `<button class="wz-choice ${lang() === k ? 'on' : ''}" data-lang="${k}"><b>${t}</b><small>${s}</small></button>`).join('')}</div>`, { next: L('Start', 'Qala') + ' →' });
      $$('[data-lang]').forEach(b => b.onclick = () => { setLang(b.dataset.lang); draw(); });
      $('#nx').onclick = () => go(nextOf('welcome'));
    }
    if (d.step === 'storage') {
      const info = window.maluti ? await window.maluti.info().catch(() => null) : null;
      const emb = st.embedded_available;
      app.innerHTML = card(L('Where should your data be kept?', 'Lintlha tsa hau li bolokoe kae?'), L('All sales, stock and accounts are kept in a database on this computer.', 'Thekiso, setoko le libuka li bolokoa ka database k\'homphieutheng ena.'),
        `${emb ? `<button class="wz-big" id="useEmb"><span class="wz-ico">💾</span><span><b>${L('Keep it on this computer (recommended)', 'E boloke k\'homphieutheng ena (e khothalletsoa)')}</b><small>${L('One click. Nothing else to install. Backed up every day.', 'Ho tobetsa hang. Ha ho letho le leng le kenngoang. Backup letsatsi le letsatsi.')}</small></span></button>` : ''}
        ${info && info.desktop ? `<button class="wz-big" id="toServer"><span class="wz-ico">🖥️</span><span><b>${L('This is an extra till – connect to the main computer', 'Ena ke till e eketsehileng – hokahanya le k\'homphieutha e kholo')}</b><small>${L('The main computer already runs Maluti ERP. You need its address, e.g. http://192.168.1.10:8069', 'U hloka aterese ea eona')}</small></span></button>
          <div id="srv" style="display:none;margin:-4px 0 12px"><div class="row"><input id="remote" placeholder="http://192.168.1.10:8069"><button class="btn btn-primary" id="useRemote">${L('Connect', 'Hokahanya')}</button></div></div>` : ''}
        <details ${emb ? '' : 'open'} class="wz-adv"><summary>${L('Advanced: use my own MySQL server', 'Ho tsoetseng pele: sebelisa seva ea ka ea MySQL')}</summary>
          <div class="form-grid" style="margin-top:10px"><label class="field"><span>${L('Server', 'Seva')}</span><input id="h" value="${esc(d.host || 'localhost')}"></label><label class="field"><span>Port</span><input id="pt" type="number" value="${esc(d.port || 3306)}"></label>
          <label class="field"><span>${L('MySQL user', 'Mosebelisi oa MySQL')}</span><input id="u" value="${esc(d.user || 'root')}"></label><label class="field"><span>${L('MySQL password', 'Phasewete ea MySQL')}</span><input id="pw" type="password"></label>
          <label class="field" style="grid-column:span 2"><span>${L('Database name', 'Lebitso la database')}</span><input id="dbn" value="${esc(d.database || 'maluti_erp')}"></label></div>
          <button class="btn btn-block" id="conn" style="margin-top:10px">${L('Connect to this server', 'Hokahanya le seva ena')}</button></details>`, { back: 1, next: null });
      $('#bk').onclick = () => go(prev());
      if ($('#useEmb')) $('#useEmb').onclick = async () => { const b = $('#useEmb'); b.disabled = true; b.querySelector('b').textContent = L('Preparing the database… the first time this can take a minute', 'Ho lokisoa database… lekhetlong la pele ho ka nka motsotso');
        try { await POST('/db-embedded', {}); st.connected = true; steps.splice(idx('storage'), 1); go('business'); } catch (e) { b.disabled = false; fail(friendly(e.message)); } };
      if ($('#toServer')) $('#toServer').onclick = () => { $('#srv').style.display = ''; $('#remote').focus(); };
      if ($('#useRemote')) $('#useRemote').onclick = () => { const v = val('#remote'); if (!/^https?:\/\/[^ ]+$/.test(v)) return fail(L('Type the address like http://192.168.1.10:8069', 'Ngola aterese joalo ka http://192.168.1.10:8069'), $('#remote')); window.maluti.setRemote(v); };
      $('#conn').onclick = async () => {
        Object.assign(d, { host: val('#h') || 'localhost', port: Number(val('#pt')) || 3306, user: val('#u'), database: val('#dbn') || 'maluti_erp' });
        if (!d.user) return fail(L('Type the MySQL user name (usually root)', 'Ngola lebitso la mosebelisi oa MySQL (hangata ke root)'), $('#u'));
        if (!/^[A-Za-z0-9_]+$/.test(d.database)) return fail(L('The database name may only have letters, numbers and _', 'Lebitso la database le ka ba le litlhaku, linomoro le _ feela'), $('#dbn'));
        const b = $('#conn'); b.disabled = true; b.textContent = L('Connecting…', 'Ea hokahanya…');
        try { await POST('/db-config', { host: d.host, port: d.port, user: d.user, password: $('#pw').value, database: d.database }); st.connected = true; go('business'); }
        catch (e) { b.disabled = false; b.textContent = L('Connect to this server', 'Hokahanya le seva ena'); fail(friendly(e.message)); }
      };
    }
    if (d.step === 'business') {
      app.innerHTML = card(L('About your business', 'Ka khoebo ea hau'), L('This is printed on your receipts and invoices.', 'Sena se hatisoa ho li-receipt le li-invoice.'),
        `<div class="form-grid"><label class="field" style="grid-column:span 2"><span>${L('Business name', 'Lebitso la khoebo')} *</span><input id="nm" value="${esc(d.name || '')}" placeholder="${L('e.g. Ha Thetsane Butchery', 'mohl. Ha Thetsane Butchery')}" autofocus></label>
        <label class="field"><span>${L('Phone number', 'Nomoro ea mohala')} *</span><input id="ph" inputmode="tel" value="${esc(d.phone || '')}" placeholder="5800 0000"></label>
        <label class="field"><span>Email (${L('optional', 'ha ho hlokahale')})</span><input id="em" type="email" value="${esc(d.email || '')}"></label>
        <label class="field" style="grid-column:span 2"><span>${L('Address – street and town', 'Aterese – seterata le toropo')}</span><input id="ad" value="${esc(d.address || '')}" placeholder="${L('e.g. Kingsway, Maseru', 'mohl. Kingsway, Maseru')}"></label></div>
        <h4 style="margin:16px 0 8px">${L('Money', 'Chelete')}</h4>
        <div class="wz-choices two">${[['LSL', 'Maloti (M)'], ['ZAR', 'Rand (R)']].map(([k, t]) => `<button class="wz-choice ${d.currency === k ? 'on' : ''}" data-cur="${k}"><b>${t}</b></button>`).join('')}</div>
        <h4 style="margin:16px 0 8px">${L('Are you registered for VAT with Revenue Services Lesotho?', 'Na u ngolisitsoe bakeng sa VAT ho Revenue Services Lesotho?')}</h4>
        <div class="wz-choices three">${[['yes', L('Yes', 'E')], ['no', L('No', 'Che')], ['unsure', L('Not sure', 'Ha ke tsebe')]].map(([k, t]) => `<button class="wz-choice ${d.vat_registered === k ? 'on' : ''}" data-vat="${k}"><b>${t}</b></button>`).join('')}</div>
        <div id="vatx" class="form-grid" style="margin-top:10px">${d.vat_registered === 'yes' ? `<label class="field"><span>${L('VAT number', 'Nomoro ea VAT')}</span><input id="vn" value="${esc(d.tax_number || '')}"></label><label class="field"><span>VAT %</span><input id="vr" type="number" value="${esc(d.vat_rate ?? 15)}"></label>`
          : `<small class="help-note" style="grid-column:span 2">${d.vat_registered === 'no' ? L('No VAT is added to your prices. If you register later, change it under Settings → Taxes.', 'Ha ho VAT e eketsoang litheko tsa hau. Haeba u ngolisa hamorao, e fetole ho Settings → Taxes.') : L('Then we set no VAT for now – ask your accountant and change it later under Settings → Taxes. (Businesses selling more than M 850 000 a year must register.)', 'Ha re behe VAT hona joale – botsa akhaontente ea hau ’me u e fetole hamorao.')}</small>`}</div>
        <h4 style="margin:16px 0 8px">${L('Logo (optional)', 'Logo (ha ho hlokahale)')}</h4><div class="row"><input type="file" id="lg" accept="image/*"><img id="lgp" style="max-height:48px;${logo ? '' : 'display:none'}" src="${logo || ''}"></div>`, { back: 1 });
      const save = () => Object.assign(d, { name: val('#nm'), phone: val('#ph'), email: val('#em'), address: val('#ad'), tax_number: $('#vn') ? val('#vn') : d.tax_number, vat_rate: $('#vr') ? Number(val('#vr')) : d.vat_rate });
      $$('[data-cur]').forEach(b => b.onclick = () => { save(); d.currency = b.dataset.cur; keep(d); draw(); });
      $$('[data-vat]').forEach(b => b.onclick = () => { save(); d.vat_registered = b.dataset.vat; keep(d); draw(); });
      $('#lg').onchange = async e => { try { logo = (await imageFileToDataUrl(e.target.files[0])).dataUrl; $('#lgp').src = logo; $('#lgp').style.display = ''; } catch (x) { logo = null; e.target.value = ''; fail(x.message); } };
      $('#bk').onclick = () => { save(); go(prev()); };
      $('#nx').onclick = () => { save();
        if (d.name.length < 2) return fail(L('Type the name of your business', 'Ngola lebitso la khoebo ea hau'), $('#nm'));
        if (d.phone.replace(/\D/g, '').length < 8) return fail(L('Type a phone number with at least 8 digits', 'Ngola nomoro ea mohala e nang le linomoro tse 8'), $('#ph'));
        if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) return fail(L('That email address does not look right', 'Aterese eo ea email ha e shebahale hantle'), $('#em'));
        if (d.vat_registered === 'yes' && !(d.vat_rate >= 0 && d.vat_rate < 50)) return fail(L('VAT % must be a number like 15', 'VAT % e tlameha ho ba palo joalo ka 15'), $('#vr'));
        go(nextOf('business')); };
    }
    if (d.step === 'types') {
      if (!types) types = await fetch('/api/business-types').then(r => r.json()).catch(() => []);
      app.innerHTML = card(L('What does your business do?', 'Khoebo ea hau e etsa eng?'), L('Tick everything that fits – for example a lodge with a bar, or a butchery that also sells groceries. This decides which apps you see. Not sure? Pick the closest; you can change it later.', 'Tšoaea tsohle tse tšoanelang. Sena se etsa qeto ea li-app tseo u li bonang. Ha u na bonnete? Khetha e haufi; u ka fetola hamorao.'),
        `<div class="wz-types">${types.map(t => `<button class="wz-type ${d.types.includes(t.key) ? 'on' : ''}" data-t="${t.key}"><span class="wz-ico">${t.icon}</span><b>${esc(t.name)}</b><small>${esc(t.desc)}</small><i>✓</i></button>`).join('')}</div>
        <div class="wz-apps" id="apps"></div>`, { back: 1 });
      const apps = () => { const sel = types.filter(t => d.types.includes(t.key)); const set = [...new Set(sel.flatMap(t => t.apps || []))];
        $('#apps').innerHTML = sel.length ? `<b>${L('These apps will be switched on', 'Li-app tsena li tla buloa')}:</b> ${set.map(a => `<span class="badge">${esc(a)}</span>`).join(' ')}` : `<span style="color:var(--bad)">${L('Choose at least one', 'Khetha bonyane e le ’ngoe')}</span>`; };
      $$('[data-t]').forEach(b => b.onclick = () => { const k = b.dataset.t; d.types = d.types.includes(k) ? d.types.filter(x => x !== k) : [...d.types, k]; b.classList.toggle('on'); keep(d); apps(); });
      apps();
      $('#bk').onclick = () => go(prev());
      $('#nx').onclick = () => d.types.length ? go(nextOf('types')) : fail(L('Tick at least one kind of business', 'Tšoaea bonyane mofuta o le mong oa khoebo'));
    }
    if (d.step === 'login') {
      const sugg = d.username || (d.owner || '').split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '') || 'admin';
      app.innerHTML = card(L('Your own login', 'Ho kena ha hau'), L('You are the boss of the system: only you can add staff, change prices and settings. Choose a password you will remember – write it down and keep it safe.', 'Ke uena mookameli oa sistimi. Khetha phasewete eo u tla e hopola – e ngole ’me u e boloke hantle.'),
        `<div class="form-grid"><label class="field" style="grid-column:span 2"><span>${L('Your full name', 'Lebitso la hau le feletseng')} *</span><input id="on" value="${esc(d.owner || '')}" placeholder="${L('e.g. Lineo Mokhele', 'mohl. Lineo Mokhele')}"></label>
        <label class="field"><span>${L('User name (to log in)', 'Lebitso la ho kena')} *</span><input id="un" value="${esc(sugg)}" autocapitalize="off"></label><span></span>
        <label class="field"><span>${L('Password', 'Phasewete')} *</span><div class="row" style="gap:4px"><input id="p1" type="password" autocomplete="new-password"><button class="btn" id="eye" type="button" title="Show">👁</button></div><div class="pw-meter"><span id="pm"></span></div></label>
        <label class="field"><span>${L('Type the password again', 'Ngola phasewete hape')} *</span><input id="p2" type="password" autocomplete="new-password"></label>
        <label class="field"><span>${L('Quick PIN for the till (4–6 numbers, optional)', 'PIN ea till (linomoro tse 4–6, ha ho hlokahale)')}</span><input id="pn" type="password" inputmode="numeric" maxlength="6"></label></div>
        <small class="help-note">${L('Staff get their own logins and PINs later (Settings → Users). Never share this login with staff.', 'Basebetsi ba tla fumana ho kena ha bona hamorao. U se ke ua arolelana ho kena hona le basebetsi.')}</small>`, { back: 1 });
      const meter = () => { const p = $('#p1').value; const sc = (p.length >= 6) + (p.length >= 10) + /\d/.test(p) + /[A-Z]/.test(p) + /[^A-Za-z0-9]/.test(p);
        const [w, c, t] = sc <= 1 ? [20, 'var(--bad)', L('too weak', 'e fokola haholo')] : sc <= 3 ? [60, '#f59e0b', L('fair', 'e lokile')] : [100, 'var(--ok)', L('strong', 'e matla')];
        $('#pm').style.width = (p ? w : 0) + '%'; $('#pm').style.background = c; $('#pm').title = t; };
      $('#p1').oninput = meter; $('#eye').onclick = () => { const t = $('#p1').type === 'password' ? 'text' : 'password'; $('#p1').type = t; $('#p2').type = t; };
      $('#on').oninput = () => { if (!d.username) $('#un').value = val('#on').split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, ''); };
      $('#bk').onclick = () => go(prev());
      $('#nx').onclick = () => {
        d.owner = val('#on'); d.username = val('#un').toLowerCase(); d.password = $('#p1').value; d.pin = $('#pn').value.trim();
        if (d.owner.length < 2) return fail(L('Type your name', 'Ngola lebitso la hau'), $('#on'));
        if (!/^[a-z0-9._-]{3,30}$/.test(d.username)) return fail(L('User name: at least 3 letters or numbers, no spaces', 'Lebitso la ho kena: bonyane litlhaku tse 3, ntle le libaka'), $('#un'));
        if (d.password.length < 6) return fail(L('The password needs at least 6 characters', 'Phasewete e hloka bonyane litlhaku tse 6'), $('#p1'));
        if (d.password !== $('#p2').value) return fail(L('The two passwords are not the same – type them again', 'Liphasewete tse peli ha li tšoane – li ngole hape'), $('#p2'));
        if (d.pin && !/^\d{4,6}$/.test(d.pin)) return fail(L('The PIN must be 4 to 6 numbers', 'PIN e tlameha ho ba linomoro tse 4 ho isa ho 6'), $('#pn'));
        go('kyc');
      };
    }
    if (d.step === 'kyc') {
      d.kyc = d.kyc || 'later';
      app.innerHTML = card(L('Verify your business (KYC)', 'Netefatsa khoebo ea hau (KYC)'), L('You can use everything free for 30 days. To keep selling after that, My Wallet must know who runs the business. Existing My Wallet agents and merchants only give their number.', 'U ka sebelisa tsohle mahala matsatsi a 30. Ho tsoela pele ho rekisa ka mor\'a moo, My Wallet e tlameha ho tseba hore na ke mang ea tsamaisang khoebo. Li-agent le bahoebi ba My Wallet ba fana ka nomoro ea bona feela.'),
        `<div class="wz-choices">${[['merchant', L('I am already a My Wallet agent or merchant', 'Ke se ke le agent kapa mohoebi oa My Wallet'), L('My KYC is already done – I just give my number.', 'KYC ea ka e se e entsoe – ke fana ka nomoro ea ka feela.')],
          ['documents', L('I am new – upload my documents now', 'Ke mocha – ke kenya litokomane tsa ka hona joale'), L('Photos or PDFs: ID, business registration or trader\'s licence, proof of address.', 'Lifoto kapa li-PDF: ID, ngoliso ea khoebo kapa laesense, bopaki ba aterese.')],
          ['later', L('Later', 'Hamorao'), L('Start the 30-day trial now and do this under Settings → Activation & KYC.', 'Qala teko ea matsatsi a 30 hona joale ’me u etse sena hamorao.')]].map(([k, t, s2]) => `<button class="wz-choice ${d.kyc === k ? 'on' : ''}" data-k="${k}"><b>${t}</b><small>${s2}</small></button>`).join('')}</div>
        <div id="kb" style="margin-top:12px">${d.kyc === 'merchant' ? `<div class="form-grid"><label class="field"><span>${L('Agent / merchant number', 'Nomoro ea agent / mohoebi')} *</span><input id="mn" value="${esc(d.merchant_no || '')}"></label><label class="field"><span>${L('Phone registered with My Wallet', 'Mohala o ngolisitsoeng ho My Wallet')} *</span><input id="mp" inputmode="tel" value="${esc(d.merchant_phone || d.phone || '')}"></label></div>`
          : d.kyc === 'documents' ? `<table class="grid">${DOCS.map(([k, t, req]) => `<tr><td>${kycFiles[k] ? '✅' : req ? '⬜' : '▫️'}</td><td><b>${t}</b>${kycFiles[k] ? `<br><small class="muted">${esc(kycFiles[k].filename)}</small>` : ''}</td><td class="r"><label class="btn btn-sm ${kycFiles[k] ? '' : 'btn-primary'}">${kycFiles[k] ? L('Replace', 'Fetola') : '⬆ ' + L('Upload', 'Kenya')}<input type="file" accept="image/*,application/pdf" data-doc="${k}" hidden></label></td></tr>`).join('')}</table><small class="help-note">${L('A clear phone photo is fine. You can also add missing documents later.', 'Foto e hlakileng ea mohala e lokile. U ka eketsa litokomane hamorao.')}</small>` : ''}</div>`, { back: 1 });
      const savek = () => { if ($('#mn')) { d.merchant_no = val('#mn'); d.merchant_phone = val('#mp'); } };
      $$('[data-k]').forEach(b => b.onclick = () => { savek(); d.kyc = b.dataset.k; keep(d); draw(); });
      $$('[data-doc]').forEach(i => i.onchange = () => { const f = i.files[0]; if (!f) return; if (f.size > 8 * 1024 * 1024) return fail(L('That file is bigger than 8 MB', 'Faele eo e kholo ho feta 8 MB')); const r = new FileReader(); r.onload = () => { kycFiles[i.dataset.doc] = { filename: f.name, data_url: r.result }; draw(); }; r.readAsDataURL(f); });
      $('#bk').onclick = () => { savek(); go(prev()); };
      $('#nx').onclick = () => { savek();
        if (d.kyc === 'merchant' && !/^[A-Za-z0-9-]{3,40}$/.test(d.merchant_no || '')) return fail(L('Type your My Wallet agent or merchant number', 'Ngola nomoro ea hau ea agent kapa mohoebi'), $('#mn'));
        if (d.kyc === 'merchant' && String(d.merchant_phone || '').replace(/\D/g, '').length < 8) return fail(L('Type the phone number registered with My Wallet', 'Ngola nomoro ea mohala e ngolisitsoeng'), $('#mp'));
        go('review'); };
    }
    if (d.step === 'review') {
      if (!d.password) return go('login');
      if (!types) types = await fetch('/api/business-types').then(r => r.json()).catch(() => []);
      const row = (l, v, st) => `<tr><td class="muted">${l}</td><td><b>${esc(v || '–')}</b></td><td class="r"><a href="#" data-go="${st}">${L('change', 'fetola')}</a></td></tr>`;
      app.innerHTML = card(L('Check and create', 'Hlahloba ’me u etse'), L('Is everything right?', 'Na tsohle li nepahetse?'),
        `<table class="grid">${row(L('Business', 'Khoebo'), d.name, 'business')}${row(L('Phone', 'Mohala'), d.phone, 'business')}${row(L('Address', 'Aterese'), d.address, 'business')}
          ${row(L('Money', 'Chelete'), d.currency === 'ZAR' ? 'Rand (R)' : 'Maloti (M)', 'business')}${row('VAT', d.vat_registered === 'yes' ? `${d.vat_rate}% ${d.tax_number || ''}` : L('not registered', 'ha e ngolisoe'), 'business')}
          ${row(L('What you do', 'Seo u se etsang'), types.filter(t => d.types.includes(t.key)).map(t => t.name).join(', '), 'types')}${row(L('Your login', 'Ho kena ha hau'), `${d.owner} (${d.username})`, 'login')}
          ${row('KYC', d.kyc === 'merchant' ? `My Wallet ${d.merchant_no}` : d.kyc === 'documents' ? `${Object.keys(kycFiles).length} ${L('document(s)', 'litokomane')}` : L('later (30-day trial)', 'hamorao (teko ea matsatsi a 30)'), 'kyc')}</table>
        <h4 style="margin:16px 0 8px">${L('How do you want to start?', 'U batla ho qala joang?')}</h4>
        <div class="wz-choices two">${[['clean', L('With my real business', 'Ka khoebo ea ka ea nnete'), L('Empty – I will add my own products and customers (or import them).', 'Ha ho letho – ke tla kenya lihlahisoa le bareki ba ka.')],
          ['demo', L('With practice data', 'Ka lintlha tsa boikoetliso'), L('Sample products and customers to try things out. They stay in this company – best for a test copy only.', 'Lihlahisoa le bareki ba mohlala bakeng sa ho leka.')]].map(([k, t, s]) => `<button class="wz-choice ${d.start === k ? 'on' : ''}" data-st="${k}"><b>${t}</b><small>${s}</small></button>`).join('')}</div>`,
        { back: 1, next: '✓ ' + L('Create my business', 'Etsa khoebo ea ka'), nextId: 'mk' });
      $$('[data-go]').forEach(a => a.onclick = e => { e.preventDefault(); go(a.dataset.go); });
      $$('[data-st]').forEach(b => b.onclick = () => { d.start = b.dataset.st; keep(d); draw(); });
      $('#bk').onclick = () => go(prev());
      $('#mk').onclick = async () => {
        const b = $('#mk'); b.disabled = true; b.textContent = L('Creating your business…', 'Ho etsoa khoebo ea hau…');
        try {
          const vat = d.vat_registered === 'yes' ? Number(d.vat_rate) : 0;
          const stt = await GET('/status').catch(() => ({}));
          let setup_key;
          if (stt.setup_key_required) { setup_key = await (await import('./core.js')).promptBox(L('Set-up key from the person who installed the server', 'Senotlolo sa ho qala se tsoang ho ea kentseng server'), { type: 'password' }); if (!setup_key) throw new Error(L('The set-up key is needed', 'Senotlolo sea hlokahala')); }
          const r = await POST('/setup', { setup_key, company: { name: d.name, phone: d.phone, address: d.address, email: d.email, tax_number: d.vat_registered === 'yes' ? d.tax_number : '', currency_code: d.currency, currency_symbol: d.currency === 'ZAR' ? 'R' : 'M', vat_rate: vat, receipt_footer: L('Thank you for your business!', 'Re leboha khoebo ea hau!') },
            admin: { name: d.owner, username: d.username, password: d.password, pin: d.pin || undefined }, demo: d.start === 'demo', business_types: d.types,
            kyc: d.kyc === 'merchant' ? { path: 'merchant', merchant_no: d.merchant_no, merchant_phone: d.merchant_phone } : d.kyc === 'documents' ? { path: 'documents' } : null });
          setToken(r.token); state.user = r.user;
          if (logo) await PUT('/settings-logo', { data_url: logo }).catch(() => {});
          for (const [doc, f] of Object.entries(kycFiles)) await POST('/activation/documents', { doc, ...f }).catch(() => {});
          state.company = await GET('/company'); await ensureLogo();
          try { localStorage.removeItem(KEY); } catch (_) {}
          done();
        } catch (e) { b.disabled = false; b.textContent = '✓ ' + L('Create my business', 'Etsa khoebo ea ka'); fail(friendly(e.message)); }
      };
    }
  }
  function done() {
    $('#app').innerHTML = `<div class="auth"><div class="auth-card wide wz" style="text-align:center"><div style="font-size:54px">🎉</div><h1>${L('Your business is ready!', 'Khoebo ea hau e loketse!')}</h1>
      <div class="sub">${L(`Log in as "${esc(state.user.username || '')}" from now on. What would you like to do first?`, `Kena ka "${esc(state.user.username || '')}" ho tloha joale. U ka rata ho etsa eng pele?`)}</div>
      <div class="wz-choices" style="text-align:left">
        <button class="wz-choice on" data-go="#/guide"><b>🧭 ${L('Follow the setup guide (recommended)', 'Latela tataiso ea ho lokisa (e khothalletsoa)')}</b><small>${L('Step by step: products, staff, tills and your first sale – only what your business needs.', 'Mohato ka mohato: lihlahisoa, basebetsi, li-till le thekiso ea pele.')}</small></button>
        <button class="wz-choice" data-go="#/import"><b>⬆️ ${L('Bring my data from another program or Excel', 'Tlisa lintlha tsa ka ho tsoa lenaneong le leng kapa Excel')}</b><small>${L('Customers, products, stock and balances – no retyping.', 'Bareki, lihlahisoa, setoko le libalance – ntle le ho thaepa hape.')}</small></button>
        <button class="wz-choice" data-go="#/"><b>🏠 ${L('Look around first', 'Sheba pele')}</b><small>${L('Go to the home screen. A short tour shows where things are.', 'E ea skrineng sa lapeng. Leeto le lekhutšoanyane le bontša moo lintho li leng teng.')}</small></button></div></div></div>`;
    $$('[data-go]').forEach(b => b.onclick = () => { location.hash = b.dataset.go; onDone && onDone(); });
  }
  draw();
}

/** short first-time tour of the home screen, once per user and computer */
export function tour(force) {
  const k = 'maluti_tour_' + (state.user ? state.user.id : 0);
  try { if (!force && localStorage.getItem(k)) return; localStorage.setItem(k, '1'); } catch (_) { if (!force) return; }
  const stops = [
    ['.tiles', L('Your apps', 'Li-app tsa hau'), L('Each square opens one part of the business. You only see what your business type and your role need.', 'Sekoere se seng le se seng se bula karolo e le ’ngoe ea khoebo.')],
    ['#guideBanner', L('Setup guide', 'Tataiso'), L('Tells you the next thing to set up and takes you straight there. Green ticks show what is done.', 'E u bolella ntho e latelang ’me e u isa teng hang-hang.')],
    ['.topbar nav', L('Menu', 'Lethathamo'), L('The same apps in a bar at the top, on every screen.', 'Li-app tse tšoanang holimo, skrineng se seng le se seng.')],
    ['#lang', L('Language', 'Puo'), L('Switch the instructions between English and Sesotho at any time.', 'Fetola litaelo pakeng tsa Senyesemane le Sesotho neng kapa neng.')],
    ['.help-note, .tiles', L('Yellow notes', 'Lintlha tse mosehla'), L('Every box you fill in has a yellow note under it explaining what to type. When in doubt, read the yellow note.', 'Lebokose le leng le le leng le na le ntlha e mosehla ka tlase e hlalosang seo u lokelang ho se ngola.')]
  ].filter(([s]) => document.querySelector(s));
  let i = 0;
  const ov = document.createElement('div'); ov.className = 'tour'; document.body.appendChild(ov);
  // leaving the home screen ends the tour (it must never sit on top of the till)
  const leave = () => { ov.remove(); removeEventListener('hashchange', leave); }; addEventListener('hashchange', leave);
  const show = () => {
    if (i >= stops.length) { ov.remove(); return; }
    const [sel, t, txt] = stops[i]; const el = document.querySelector(sel); const r = el.getBoundingClientRect();
    ov.innerHTML = `<div class="tour-hole" style="top:${r.top - 6}px;left:${r.left - 6}px;width:${r.width + 12}px;height:${Math.min(r.height + 12, innerHeight - r.top)}px"></div>
      <div class="tour-tip" style="top:${Math.min(r.bottom + 12, innerHeight - 170)}px;left:${Math.max(12, Math.min(r.left, innerWidth - 340))}px"><b>${t}</b><p>${txt}</p>
      <div class="row"><small class="muted">${i + 1} / ${stops.length}</small><span class="spacer"></span><button class="btn btn-sm" data-x>${L('Skip', 'Tlola')}</button><button class="btn btn-sm btn-primary" data-n>${i + 1 < stops.length ? L('Next', 'E latelang') : L('Done', 'Ho felile')}</button></div></div>`;
    ov.querySelector('[data-n]').onclick = () => { i++; show(); }; ov.querySelector('[data-x]').onclick = () => ov.remove();
  };
  show();
}
