// Settings → Translations: a native speaker checks and corrects the Sesotho screen texts. Corrections take effect at once
// for everybody, without a new version. Export to Excel/CSV to work offline, import it back.
import { GET, PUT, DEL, esc, $, $$, toast, err, page, query, confirmBox } from './core.js';
import { L } from './i18n.js';
import { ST_UI } from './sesotho_ui.js';
import { setOverrides } from './i18n_dom.js';

const csvCell = v => /[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',' || c === ';') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

export async function translationsPage(view) {
  const qy = query();
  const show = qy.show || 'missing';
  const data = await GET('/i18n/review');
  const ov = { ...data.overrides };
  const all = new Set([...Object.keys(ST_UI), ...Object.keys(data.missing), ...Object.keys(ov)]);
  const rows = [...all].map(en => ({ en, built: ST_UI[en] || '', mine: ov[en] || '', seen: data.missing[en] || 0 }))
    .filter(r => show === 'all' || (show === 'missing' ? !r.built && !r.mine : show === 'mine' ? !!r.mine : !!r.built && !r.mine))
    .sort((a, b) => b.seen - a.seen || a.en.localeCompare(b.en));
  const counts = { all: all.size, missing: [...all].filter(e => !ST_UI[e] && !ov[e]).length, mine: Object.keys(ov).length };
  view.innerHTML = page(L('Translations (Sesotho)', 'Liphetolelo (Sesotho)'), `<button class="btn" id="exp">⬇ ${L('Export CSV', 'Ntša CSV')}</button><label class="btn">⬆ ${L('Import CSV', 'Kenya CSV')}<input type="file" id="imp" accept=".csv,text/csv" hidden></label><button class="btn btn-primary" id="sv">${L('Save corrections', 'Boloka liphetoho')}</button>`,
    `<div class="card act-trial" style="margin-bottom:12px">${L('Choose Sesotho at the top of the screen and the whole program speaks Sesotho. Here a native speaker can correct any word, or fill in texts that have no Sesotho yet ("Missing" – the most seen first). Corrections apply to everybody straight away. Export the list to work on it in Excel, then import it back (columns: English, Sesotho).', 'Khetha Sesotho holimo ’me lenaneo lohle le bua Sesotho. Mona sebui sa letsoalloa se ka lokisa lentsoe lefe kapa lefe, kapa sa tlatsa mantsoe a so fetoleloang.')}</div>
    <div class="row wrap" style="gap:6px;margin-bottom:10px">${[['missing', L('Missing', 'A sieo'), counts.missing], ['builtin', L('Built-in', 'A teng'), counts.all - counts.missing - counts.mine], ['mine', L('Corrected', 'A lokisitsoeng'), counts.mine], ['all', L('All', 'Tsohle'), counts.all]]
      .map(([k, l, n]) => `<a class="btn btn-sm ${show === k ? 'btn-primary' : ''}" href="#/translations?show=${k}">${l} (${n})</a>`).join('')}<input id="q" placeholder="${L('Search…', 'Batla…')}" style="max-width:240px;margin-left:auto">${counts.missing ? `<button class="btn btn-sm" id="clr">${L('Forget seen texts', 'Lebala mantsoe a bonoeng')}</button>` : ''}</div>
    <div class="card no-tr"><div class="table-wrap"><table class="grid" id="tt"><thead><tr><th>English</th><th>${L('Built-in Sesotho', 'Sesotho se teng')}</th><th>${L('Your Sesotho (overrides)', 'Sesotho sa hau')}</th><th class="r">${L('Seen', 'E bonoe')}</th></tr></thead>
    <tbody>${rows.slice(0, 4000).map(r => `<tr data-en="${esc(r.en)}"><td>${esc(r.en)}</td><td class="muted">${esc(r.built)}</td><td><input data-o value="${esc(r.mine)}" placeholder="${esc(r.built)}" style="width:100%"></td><td class="r">${r.seen || ''}</td></tr>`).join('') || `<tr><td colspan="4" class="muted">${L('Nothing here.', 'Ha ho letho.')}</td></tr>`}</tbody></table></div>
    ${rows.length > 4000 ? `<p class="muted">${L('Showing the first 4 000 – use the search.', 'Ho bontšoa 1 500 tsa pele – sebelisa ho batla.')}</p>` : ''}</div>`);
  $('#q').oninput = () => { const q = $('#q').value.toLowerCase(); $$('#tt tbody tr').forEach(tr => { tr.style.display = !q || tr.textContent.toLowerCase().includes(q) || (tr.querySelector('input') && tr.querySelector('input').value.toLowerCase().includes(q)) ? '' : 'none'; }); };
  $$('[data-o]').forEach(i => i.oninput = () => { const en = i.closest('tr').dataset.en; if (i.value.trim()) ov[en] = i.value.trim(); else delete ov[en]; });
  const save = async (o) => { const r = await PUT('/i18n/overrides', { overrides: o }); setOverrides(r.overrides); toast(`${L('Saved', 'E bolokiloe')} – ${r.saved}`); translationsPage(view); };
  $('#sv').onclick = () => save(ov).catch(err);
  $('#exp').onclick = () => {
    const lines = [['English', 'Sesotho', 'Built-in Sesotho', 'Seen']].concat([...all].sort().map(en => [en, ov[en] || '', ST_UI[en] || '', data.missing[en] || '']));
    const blob = new Blob(['﻿' + lines.map(r => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'maluti-sesotho.csv'; a.click();
  };
  $('#imp').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const rows2 = parseCsv((await f.text()).replace(/^﻿/, ''));
      const head = rows2.shift().map(h => h.trim().toLowerCase());
      const ie = head.indexOf('english'), is = head.indexOf('sesotho');
      if (ie < 0 || is < 0) throw new Error(L('The file needs the columns English and Sesotho', 'Faele e hloka litšiea English le Sesotho'));
      let n = 0; const next = { ...ov };
      for (const r of rows2) { const en = (r[ie] || '').trim(), st = (r[is] || '').trim(); if (en && st && st !== ST_UI[en]) { next[en] = st; n++; } }
      if (!await confirmBox(L(`Use ${n} Sesotho texts from the file?`, `Sebelisa mantsoe a ${n} a tsoang faeleng?`))) return;
      await save(next);
    } catch (x) { err(x); }
  };
  if ($('#clr')) $('#clr').onclick = async () => { await DEL('/i18n/missing'); translationsPage(view); };
}
