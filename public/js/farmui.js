// Farm: diary, herds & flocks, tagged animals, fields & crop seasons, health due, and cost / income per flock and field
import { GET, POST, PUT, esc, $, $$, toast, err, can, money, qty, modal, formHtml, readForm, tableHtml, badge, page, d, today, query } from './core.js';
import { L } from './i18n.js';

const KIND = { feed: ['Feed', 'Ho fepa'], vaccinate: ['Vaccinate', 'Ente'], treat: ['Treat / dose', 'Phekolo'], weigh: ['Weigh', 'Ho lekanya boima'], production: ['Production (eggs, milk, wool…)', 'Tlhahiso (mahe, lebese, boea…)'],
  plant: ['Plant / sow', 'Ho jala'], fertilise: ['Fertilise', 'Manyolo'], spray: ['Spray', 'Ho fafatsa'], harvest: ['Harvest', 'Kotulo'], labour: ['Labour / contractor', 'Mosebetsi / khontraktara'],
  expense: ['Other cost', 'Tšenyehelo e ’ngoe'], death: ['Death(s) in the flock', 'Lefu mohlapeng'], other: ['Other note', 'Tlhaloso e ’ngoe'], birth: ['Birth', 'Tsoalo'], sale: ['Sold', 'E rekisitsoe'] };
const kname = k => L(...(KIND[k] || [k, k]));
const STATUS = { alive: ['alive', 'ok'], sold: ['sold', 'paid'], died: ['died', 'cancelled'], slaughtered: ['slaughtered', 'closed'], growing: ['growing', 'ok'], planned: ['planned', 'draft'], harvested: ['harvested', 'paid'], failed: ['failed', 'cancelled'] };
const st = x => badge((STATUS[x] || [x])[0], (STATUS[x] || [x, ''])[1]);
const SPECIES = ['cattle', 'sheep', 'goat', 'pig', 'chicken', 'horse', 'donkey', 'rabbit', 'other'];
const logCols = [{ key: 'log_date', label: 'Date', fmt: d }, { key: 'kind', label: 'What', fmt: kname }, { key: 'group_name', label: 'Flock / animal / crop', fmt: (x, l) => [x, l.animal_tag, l.season_name].filter(Boolean).join(' · ') },
  { key: 'product_name', label: 'Product', fmt: (x, l) => x ? `${x}${l.qty ? ` × ${qty(l.qty)}` : ''}` : (l.qty ? qty(l.qty) : '') }, { key: 'produced_qty', label: 'Produced', right: 1, fmt: (x, l) => x ? `${qty(x)} ${l.uom || ''}` : (l.weight ? `${qty(l.weight)} kg` : '') },
  { key: 'cost', label: 'Cost', right: 1, fmt: v => Number(v) ? money(v) : '' }, { key: 'value', label: 'Value', right: 1, fmt: v => Number(v) ? money(v) : '' }, { key: 'next_due', label: 'Next due', fmt: d }, { key: 'note', label: 'Note' }];

export async function farm(view) {
  const q = query(); const tab = q.tab || 'diary';
  const tabs = [['diary', L('Diary & health', 'Bukana le bophelo')], ['groups', L('Herds & flocks', 'Mehlape')], ['animals', L('Animals', 'Liphoofolo')], ['crops', L('Fields & crops', 'Masimo le lijalo')], ['report', L('Results', 'Liphetho')]];
  view.innerHTML = page(L('Farm', 'Polasi'), `<button class="btn btn-primary" id="rec">＋ ${L('Record', 'Ngola')}</button>`, `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/farm?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="fb"></div>`);
  $('#rec').onclick = () => recordDialog({}, () => farm(view));
  const fb = $('#fb');
  if (tab === 'diary') {
    const [due, logs, groups] = await Promise.all([GET('/farm/due?days=21'), GET('/farm/logs'), GET('/farm/groups')]);
    fb.innerHTML = `<div class="cols cols-4" style="margin-bottom:14px">${groups.slice(0, 4).map(g => `<a class="kpi" href="#/farmgroup/${g.id}" style="text-decoration:none;color:inherit"><div class="label">${esc(g.name)}</div><div class="value" style="font-size:20px">${qty(g.heads)} <small>${esc(g.species || '')}</small></div>
      <div class="hint">${g.produce_name ? `${L('today', 'kajeno')} ${qty(g.produced_today)} · 30 ${L('days', 'matsatsi')} ${qty(g.produced_30)} ${esc(g.produce_uom || '')}<br>` : ''}${L('costs 30 days', 'litšenyehelo matsatsi a 30')} ${money(g.cost_30)}</div></a>`).join('') || `<div class="muted">${L('Add your herds and flocks first.', 'Eketsa mehlape ea hau pele.')}</div>`}</div>
      <div class="card" style="margin-bottom:12px"><h3>${L('Health due (next 3 weeks)', 'Bophelo bo lokelang (libeke tse 3)')}</h3>${tableHtml([{ key: 'next_due', label: 'Due', html: 1, fmt: (x, l) => `<b style="color:${l.in_days < 0 ? 'var(--bad)' : 'inherit'}">${esc(d(x))}</b> <small class="muted">${l.in_days < 0 ? `${-l.in_days} days late` : `in ${l.in_days} days`}</small>` },
        { key: 'kind', label: 'What', fmt: kname }, { key: 'product_name', label: 'Product' }, { key: 'group_name', label: 'Flock / animal', fmt: (x, l) => [x, l.animal_tag].filter(Boolean).join(' · ') }, { key: 'log_date', label: 'Last done', fmt: d },
        { key: 'id', label: '', html: 1, fmt: (x, l) => `<button class="btn btn-sm" data-redo="${x}">${L('Done now', 'E entsoe')}</button>` }], due, { empty: L('Nothing due – give vaccinations and dosing a "next due" date when you record them.', 'Ha ho letho le lokelang – fa liente letsatsi la "next due".') })}</div>
      <div class="card"><h3>${L('Diary', 'Bukana')}</h3>${tableHtml(logCols, logs.slice(0, 60), { empty: L('Nothing recorded yet – click "＋ Record".', 'Ha ho se ngotsoeng – tobetsa "＋ Ngola".') })}</div>`;
    $$('[data-redo]', fb).forEach(b => b.onclick = () => { const l = due.find(x => String(x.id) === b.dataset.redo); recordDialog({ kind: l.kind, group_id: l.group_id, animal_id: l.animal_id, product_id: l.product_id, qty: l.qty }, () => farm(view)); });
  }
  if (tab === 'groups') {
    const gs = await GET('/farm/groups?all=1');
    fb.innerHTML = `<div class="card"><div class="row" style="margin-bottom:8px"><h3 style="flex:1">${L('Herds, flocks and houses', 'Mehlape le matlo')}</h3><button class="btn btn-sm btn-primary" id="ng">＋ ${L('Herd / flock', 'Mohlape')}</button></div>
      ${tableHtml([{ key: 'name', label: 'Name' }, { key: 'species', label: 'Species' }, { key: 'purpose', label: 'Kept for' }, { key: 'heads', label: 'Head', right: 1, fmt: qty }, { key: 'produce_name', label: 'Produces' },
        { key: 'produced_30', label: 'Produced 30 days', right: 1, fmt: (x, g) => g.produce_name ? `${qty(x)} ${g.produce_uom || ''}` : '' }, { key: 'cost_30', label: 'Costs 30 days', right: 1, fmt: money }, { key: 'place', label: 'Where' }, { key: 'active', label: 'Active', fmt: v => v ? '✓' : '' }],
        gs, { rowAttr: g => `data-g="${g.id}"`, empty: 'No herds or flocks yet.' })}</div>`;
    $('#ng').onclick = () => groupDialog(null, id => { location.hash = '#/farmgroup/' + id; });
    $$('[data-g]', fb).forEach(tr => tr.onclick = () => { location.hash = '#/farmgroup/' + tr.dataset.g; });
  }
  if (tab === 'animals') {
    const [rows, groups] = await Promise.all([GET(`/farm/animals?status=${q.status || 'alive'}${q.species ? '&species=' + q.species : ''}${q.q ? '&q=' + encodeURIComponent(q.q) : ''}`), GET('/farm/groups')]);
    const bySp = {}; rows.forEach(a => { bySp[a.species] = (bySp[a.species] || 0) + 1; });
    fb.innerHTML = `<div class="row wrap" style="margin-bottom:8px">${['alive', 'sold', 'died', 'slaughtered', 'all'].map(k => `<a class="btn btn-sm ${(q.status || 'alive') === k ? 'btn-primary' : ''}" href="#/farm?tab=animals&status=${k}">${k}</a>`).join('')}
      <span class="muted" style="margin-left:8px">${Object.entries(bySp).map(([k, n]) => `${n} ${esc(k)}`).join(' · ')}</span><span class="spacer"></span><input id="aq" placeholder="Tag, name or breed" value="${esc(q.q || '')}" style="max-width:200px"><button class="btn btn-sm btn-primary" id="na">＋ ${L('Animal', 'Phoofolo')}</button></div>
      <div class="card">${tableHtml([{ key: 'tag', label: 'Tag' }, { key: 'name', label: 'Name' }, { key: 'species', label: 'Species' }, { key: 'breed', label: 'Breed' }, { key: 'sex', label: 'Sex' },
        { key: 'age_months', label: 'Age', right: 1, fmt: m => m == null ? '' : m >= 24 ? `${Math.floor(m / 12)} y` : `${m} m` }, { key: 'weight', label: 'Weight kg', right: 1, fmt: v => v ? qty(v) : '' }, { key: 'group_name', label: 'Herd / flock' }, { key: 'mother_tag', label: 'Mother' }, { key: 'status', label: 'Status', html: 1, fmt: st }],
        rows, { rowAttr: a => `data-a="${a.id}"`, empty: 'No animals.' })}</div>`;
    $('#na').onclick = () => animalDialog(null, groups, a => { location.hash = '#/animal/' + a.id; });
    $$('[data-a]', fb).forEach(tr => tr.onclick = () => { location.hash = '#/animal/' + tr.dataset.a; });
    let t; $('#aq').oninput = e => { clearTimeout(t); t = setTimeout(() => { location.hash = `#/farm?tab=animals&status=all&q=${encodeURIComponent(e.target.value)}`; }, 450); };
  }
  if (tab === 'crops') {
    const [fields, seasons] = await Promise.all([GET('/farm/fields?all=1'), GET('/farm/seasons')]);
    fb.innerHTML = `<div class="cols cols-2" style="align-items:start"><div class="card"><div class="row" style="margin-bottom:8px"><h3 style="flex:1">${L('Fields', 'Masimo')}</h3><button class="btn btn-sm" id="nf">＋ ${L('Field', 'Tšimo')}</button></div>
      ${tableHtml([{ key: 'name', label: 'Field' }, { key: 'size_ha', label: 'Hectares', right: 1, fmt: v => v ? qty(v) : '' }, { key: 'irrigated', label: 'Irrigated', fmt: v => v ? '✓' : '' }, { key: 'current', label: 'Now' }], fields, { rowAttr: f => `data-f="${f.id}"`, empty: 'No fields yet.' })}</div>
      <div class="card"><div class="row" style="margin-bottom:8px"><h3 style="flex:1">${L('Crop seasons', 'Linako tsa lijalo')}</h3><button class="btn btn-sm btn-primary" id="ns">＋ ${L('Season', 'Nako')}</button></div>
      ${tableHtml([{ key: 'crop', label: 'Crop', fmt: (x, s) => `${x}${s.variety ? ' – ' + s.variety : ''}` }, { key: 'field_name', label: 'Field' }, { key: 'planted_on', label: 'Planted', fmt: d }, { key: 'cost', label: 'Costs', right: 1, fmt: money },
        { key: 'harvested', label: 'Harvested', right: 1, fmt: (x, s) => x ? `${qty(x)} ${s.produce_uom || ''}` : '' }, { key: 'yield_per_ha', label: 'Per ha', right: 1, fmt: v => v ? qty(v) : '' }, { key: 'status', label: 'Status', html: 1, fmt: st }], seasons, { rowAttr: s => `data-s="${s.id}"`, empty: 'No crop seasons yet.' })}</div></div>`;
    $('#nf').onclick = () => fieldDialog(null, () => farm(view));
    $$('[data-f]', fb).forEach(tr => tr.onclick = () => fieldDialog(fields.find(f => String(f.id) === tr.dataset.f), () => farm(view)));
    $('#ns').onclick = () => { if (!fields.length) return toast(L('Add a field first', 'Eketsa tšimo pele'), 'err'); seasonDialog(null, fields, id => { location.hash = '#/season/' + id; }); };
    $$('[data-s]', fb).forEach(tr => tr.onclick = () => { location.hash = '#/season/' + tr.dataset.s; });
  }
  if (tab === 'report') {
    const to = q.to || today(), from = q.from || `${to.slice(0, 4)}-01-01`;
    const rep = await GET(`/farm/report?from=${from}&to=${to}`);
    fb.innerHTML = `<div class="card" style="margin-bottom:12px"><div class="row"><label>From <input type="date" id="rf" value="${from}"></label><label>To <input type="date" id="rt" value="${to}"></label><button class="btn btn-sm" id="rg">Show</button></div></div>
      <div class="card" style="margin-bottom:12px"><h3>${L('Per herd / flock', 'Ka mohlape')}</h3>${tableHtml([{ key: 'name', label: 'Herd / flock' }, { key: 'species', label: 'Species' }, { key: 'costs', label: 'Inputs & costs', right: 1, fmt: money },
        { key: 'produced', label: 'Produced', right: 1, fmt: qty }, { key: 'produce_value', label: 'Produce at cost', right: 1, fmt: money }, { key: 'animal_sales', label: 'Animals sold', right: 1, fmt: money }, { key: 'born', label: 'Born', right: 1 }, { key: 'deaths', label: 'Deaths', right: 1 },
        { key: 'result', label: 'Result', right: 1, html: 1, fmt: v => `<b style="color:${v < 0 ? 'var(--bad)' : 'var(--ok)'}">${money(v)}</b>` }], rep.groups, { empty: 'No herds.' })}
        <p class="muted" style="margin:8px 0 0">${L('Produce is valued at its cost price when it goes into stock; the profit on it shows in sales when it is sold.', 'Tlhahiso e baloa ka theko ea eona ha e kena setokong.')}</p></div>
      <div class="cols cols-2" style="align-items:start"><div class="card"><h3>${L('Per crop season', 'Ka nako ea sejalo')}</h3>${tableHtml([{ key: 'crop', label: 'Crop' }, { key: 'field_name', label: 'Field' }, { key: 'ha', label: 'ha', right: 1, fmt: v => v ? qty(v) : '' }, { key: 'costs', label: 'Costs', right: 1, fmt: money },
        { key: 'cost_per_ha', label: 'Cost / ha', right: 1, fmt: v => v == null ? '' : money(v) }, { key: 'harvested', label: 'Harvested', right: 1, fmt: qty }, { key: 'harvest_value', label: 'Harvest value', right: 1, fmt: money }, { key: 'result', label: 'Result', right: 1, fmt: money }], rep.seasons, { empty: 'No seasons.' })}</div>
      <div class="card"><h3>${L('Herd book', 'Buka ea mohlape')}</h3>${tableHtml([{ key: 'species', label: 'Species' }, { key: 'alive', label: 'Now', right: 1 }, { key: 'females', label: 'Female', right: 1 }, { key: 'males', label: 'Male', right: 1 }, { key: 'born', label: 'Born', right: 1 }, { key: 'sold', label: 'Sold', right: 1 }, { key: 'died', label: 'Died', right: 1 }], rep.herd, { empty: 'No tagged animals.' })}</div></div>`;
    $('#rg').onclick = () => { location.hash = `#/farm?tab=report&from=${$('#rf').value}&to=${$('#rt').value}`; };
  }
}

const products = async () => (await GET('/products')).filter(p => p.active !== 0);
async function groupDialog(g, done) {
  const ps = (await products()).filter(p => p.type === 'stock');
  const f = [{ key: 'name', label: 'Name', required: true }, { key: 'kind', label: 'Kind', type: 'select', options: [['livestock', 'Livestock'], ['poultry', 'Poultry'], ['other', 'Other (bees, fish…)']].map(([value, label]) => ({ value, label })) },
    { key: 'species', label: 'Species', type: 'select', options: SPECIES.map(x => ({ value: x, label: x })) }, { key: 'purpose', label: 'Kept for (eggs, broilers, milk, beef, wool, mohair, breeding…)' },
    { key: 'head_count', label: 'Number of animals / birds (if not tagged one by one)', type: 'number', nullable: true }, { key: 'started_on', label: 'Started / placed on', type: 'date' },
    { key: 'produce_id', label: 'Produces (daily production goes into this product)', type: 'select', numeric: true, options: [{ value: '', label: '— nothing daily —' }, ...ps.map(p => ({ value: p.id, label: `${p.name} (${p.uom})` }))] },
    { key: 'place', label: 'House / camp / kraal' }, { key: 'notes', label: 'Notes', span: 2 }, ...(g ? [{ key: 'active', label: 'Active', type: 'checkbox' }] : [])];
  modal({ title: g ? g.name : L('New herd / flock', 'Mohlape o mocha'), size: 'lg', body: formHtml(f, g ? { ...g, started_on: d(g.started_on) } : { kind: 'livestock', species: 'cattle', started_on: today() }, { ctx: 'farmgroup' }),
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); const o = g ? await PUT('/farm/groups/' + g.id, v) : await POST('/farm/groups', v); c(); toast('Saved'); done(o.id); } }] });
}
async function animalDialog(a, groups, done) {
  const f = [{ key: 'tag', label: 'Ear tag / brand number', required: true }, { key: 'name', label: 'Name' }, { key: 'species', label: 'Species', type: 'select', options: SPECIES.map(x => ({ value: x, label: x })) },
    { key: 'breed', label: 'Breed' }, { key: 'sex', label: 'Sex', type: 'select', options: [{ value: '', label: '—' }, { value: 'F', label: 'Female' }, { value: 'M', label: 'Male' }] }, { key: 'birth_date', label: 'Born', type: 'date' },
    { key: 'group_id', label: 'Herd / flock', type: 'select', numeric: true, options: [{ value: '', label: '—' }, ...groups.map(g => ({ value: g.id, label: g.name }))] },
    { key: 'acquired', label: 'Came from', type: 'select', options: [['bought', 'Bought'], ['born', 'Born on the farm'], ['other', 'Other']].map(([value, label]) => ({ value, label })) }, { key: 'cost', label: 'Bought for (M)', type: 'number' },
    { key: 'weight', label: 'Weight kg', type: 'number', nullable: true }, { key: 'notes', label: 'Notes', span: 2 }];
  modal({ title: a ? a.tag : L('New animal', 'Phoofolo e ncha'), size: 'lg', body: formHtml(f, a ? { ...a, birth_date: d(a.birth_date) } : { species: 'cattle', acquired: 'bought' }, { ctx: 'animal' }),
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); const o = a ? await PUT('/farm/animals/' + a.id, v) : await POST('/farm/animals', v); c(); toast(`${o.tag} saved`); done(o); } }] });
}
function fieldDialog(fl, done) {
  const f = [{ key: 'name', label: 'Field', required: true }, { key: 'size_ha', label: 'Hectares', type: 'number', nullable: true }, { key: 'place', label: 'Where' }, { key: 'irrigated', label: 'Irrigated', type: 'checkbox' }, { key: 'notes', label: 'Notes (soil, last lime…)', span: 2 }, ...(fl ? [{ key: 'active', label: 'In use', type: 'checkbox' }] : [])];
  modal({ title: fl ? fl.name : L('New field', 'Tšimo e ncha'), body: formHtml(f, fl || {}, { ctx: 'field' }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); if (fl) await PUT('/farm/fields/' + fl.id, v); else await POST('/farm/fields', v); c(); done(); } }] });
}
async function seasonDialog(x, fields, done) {
  const ps = (await products()).filter(p => p.type === 'stock');
  const f = [{ key: 'field_id', label: 'Field', type: 'select', numeric: true, required: true, options: fields.filter(fl => fl.active).map(fl => ({ value: fl.id, label: `${fl.name}${fl.size_ha ? ` (${fl.size_ha} ha)` : ''}` })) },
    { key: 'crop', label: 'Crop', required: true }, { key: 'variety', label: 'Variety / seed' }, { key: 'area_ha', label: 'Hectares planted', type: 'number', nullable: true }, { key: 'planted_on', label: 'Planted on', type: 'date' }, { key: 'expected_harvest', label: 'Expected harvest', type: 'date' },
    { key: 'produce_id', label: 'Harvest goes into (product)', type: 'select', numeric: true, options: [{ value: '', label: '—' }, ...ps.map(p => ({ value: p.id, label: `${p.name} (${p.uom})` }))] },
    { key: 'status', label: 'Status', type: 'select', options: Object.keys(STATUS).filter(k => ['planned', 'growing', 'harvested', 'failed'].includes(k)).map(k => ({ value: k, label: k })) }, { key: 'notes', label: 'Notes', span: 2 }];
  modal({ title: x ? `${x.crop} – ${x.field_name}` : L('New crop season', 'Nako e ncha ea sejalo'), size: 'lg', body: formHtml(f, x ? { ...x, planted_on: d(x.planted_on), expected_harvest: d(x.expected_harvest) } : { status: 'growing', planted_on: today() }, { ctx: 'season' }),
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); const o = x ? await PUT('/farm/seasons/' + x.id, v) : await POST('/farm/seasons', v); c(); done(o.id); } }] });
}

/** the farm diary entry: what was done, to which flock / animal / crop, with what */
export async function recordDialog(pre, done) {
  const [groups, seasons, ps, animals] = await Promise.all([GET('/farm/groups'), GET('/farm/seasons'), products(), pre.animal_id ? [] : GET('/farm/animals')]);
  const kinds = ['production', 'feed', 'vaccinate', 'treat', 'weigh', 'harvest', 'plant', 'fertilise', 'spray', 'labour', 'expense', 'death', 'other'];
  const f = [{ key: 'kind', label: 'What was done', type: 'select', options: kinds.map(k => ({ value: k, label: kname(k) })) }, { key: 'date', label: 'Date', type: 'date' },
    { key: 'group_id', label: 'Herd / flock', type: 'select', numeric: true, options: [{ value: '', label: '—' }, ...groups.map(g => ({ value: g.id, label: g.name }))] },
    ...(pre.animal_id ? [] : [{ key: 'animal_id', label: 'Or one animal', type: 'select', numeric: true, options: [{ value: '', label: '—' }, ...animals.map(a => ({ value: a.id, label: `${a.tag} ${a.name || ''} (${a.species})` }))] }]),
    { key: 'season_id', label: 'Or crop', type: 'select', numeric: true, options: [{ value: '', label: '—' }, ...seasons.filter(s => s.status !== 'harvested' || s.id === pre.season_id).map(s => ({ value: s.id, label: `${s.crop} – ${s.field_name}` }))] },
    { key: 'product_id', label: 'Product (feed, vaccine, medicine, seed, fertiliser – or what was produced)', type: 'select', numeric: true, span: 2, options: [{ value: '', label: '—' }, ...ps.map(p => ({ value: p.id, label: `${p.name} (${p.type === 'stock' ? qty(p.stock_qty) + ' ' + p.uom + ' in stock' : p.type})` }))] },
    { key: 'qty', label: 'Quantity used / number of animals', type: 'number', nullable: true }, { key: 'produced_qty', label: 'Quantity produced / harvested', type: 'number', nullable: true },
    { key: 'weight', label: 'Weight kg', type: 'number', nullable: true }, { key: 'cost', label: 'Cost (labour, contractor, other)', type: 'number', nullable: true },
    { key: 'next_due', label: 'Next dose / vaccination due', type: 'date' }, { key: 'final', label: 'Last harvest – season finished', type: 'checkbox' }, { key: 'note', label: 'Note', span: 2 }];
  const show = { production: ['group_id', 'animal_id', 'product_id', 'produced_qty'], harvest: ['season_id', 'product_id', 'produced_qty', 'final'], feed: ['group_id', 'animal_id', 'product_id', 'qty'], vaccinate: ['group_id', 'animal_id', 'product_id', 'qty', 'next_due'],
    treat: ['group_id', 'animal_id', 'product_id', 'qty', 'next_due'], weigh: ['animal_id', 'group_id', 'weight'], plant: ['season_id', 'product_id', 'qty'], fertilise: ['season_id', 'product_id', 'qty'], spray: ['season_id', 'product_id', 'qty', 'next_due'],
    labour: ['group_id', 'season_id', 'cost'], expense: ['group_id', 'season_id', 'cost'], death: ['group_id', 'animal_id', 'qty'], other: ['group_id', 'animal_id', 'season_id'] };
  modal({ title: L('Record on the farm', 'Ngola polasing'), size: 'lg', body: formHtml(f, { kind: 'production', date: today(), ...pre }, { ctx: 'farmlog' }),
    onOpen: r => { const sync = () => { const k = r.querySelector('[name=kind]').value; const vis = show[k] || [];
        for (const x of f) { if (['kind', 'date', 'note'].includes(x.key)) continue; const el = r.querySelector(`[name=${x.key}]`); if (!el) continue; const box = el.closest('.field'); if (box) box.style.display = vis.includes(x.key) ? '' : 'none'; } };
      r.querySelector('[name=kind]').onchange = sync; sync(); },
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => {
      const v = readForm(r, f); const k = v.kind; const vis = show[k] || [];
      for (const x of f) if (!['kind', 'date', 'note'].includes(x.key) && !vis.includes(x.key)) delete v[x.key];
      if (pre.animal_id) v.animal_id = pre.animal_id;
      if (v.animal_id === null) delete v.animal_id;
      await POST('/farm/logs', v); c(); toast(L('Recorded', 'E ngotsoe')); done(); } }] });
}

export async function farmGroup(view, [idq]) {
  const id = (idq || '').split('?')[0]; const g = await GET('/farm/groups/' + id);
  const max = Math.max(1, ...g.daily.map(x => Number(x.qty)));
  view.innerHTML = page(g.name, `<button class="btn" id="ge">Edit</button><button class="btn btn-primary" id="gr">＋ ${L('Record', 'Ngola')}</button>`,
    `<div class="cols cols-4" style="margin-bottom:14px"><div class="kpi"><div class="label">${esc(g.species || g.kind)}</div><div class="value">${qty(g.heads)}</div><div class="hint">${esc(g.purpose || '')} ${g.place ? '· ' + esc(g.place) : ''}</div></div>
      <div class="kpi"><div class="label">${L('Produced today', 'Tlhahiso kajeno')}</div><div class="value">${qty(g.produced_today)} <small>${esc(g.produce_uom || '')}</small></div><div class="hint">${esc(g.produce_name || L('no daily produce set', 'ha ho tlhahiso e behiloeng'))}</div></div>
      <div class="kpi"><div class="label">${L('Produced 30 days', 'Tlhahiso matsatsi a 30')}</div><div class="value">${qty(g.produced_30)}</div>${g.heads && g.produced_30 ? `<div class="hint">${qty(Math.round(g.produced_30 / 30 / g.heads * 1000) / 10)}% ${L('per head per day (lay rate)', 'ka hlooho ka letsatsi')}</div>` : ''}</div>
      <div class="kpi"><div class="label">${L('Costs 30 days', 'Litšenyehelo matsatsi a 30')}</div><div class="value">${money(g.cost_30)}</div></div></div>
    ${g.daily.length ? `<div class="card" style="margin-bottom:12px"><h3>${L('Daily production, last 14 days', 'Tlhahiso ea letsatsi, matsatsi a 14')}</h3><div class="row" style="align-items:flex-end;gap:6px;height:120px">${g.daily.map(x => `<div title="${esc(d(x.log_date))}: ${qty(x.qty)}" style="flex:1;background:var(--ok);opacity:.8;height:${Math.round(Number(x.qty) / max * 100)}%;border-radius:3px 3px 0 0"></div>`).join('')}</div>
      <div class="row" style="gap:6px">${g.daily.map(x => `<small class="muted" style="flex:1;text-align:center">${esc(d(x.log_date).slice(8))}</small>`).join('')}</div></div>` : ''}
    ${g.animals.length ? `<div class="card" style="margin-bottom:12px"><h3>${L('Animals', 'Liphoofolo')}</h3>${tableHtml([{ key: 'tag', label: 'Tag' }, { key: 'name', label: 'Name' }, { key: 'breed', label: 'Breed' }, { key: 'sex', label: 'Sex' }, { key: 'weight', label: 'kg', right: 1, fmt: v => v ? qty(v) : '' }], g.animals, { rowAttr: a => `data-a="${a.id}"` })}</div>` : ''}
    <div class="card"><h3>${L('Diary', 'Bukana')}</h3>${tableHtml(logCols, g.logs, { empty: 'Nothing recorded yet.' })}</div>`, { back: '#/farm?tab=groups' });
  $('#ge').onclick = () => groupDialog(g, () => farmGroup(view, [id]));
  $('#gr').onclick = () => recordDialog({ group_id: g.id }, () => farmGroup(view, [id]));
  $$('[data-a]').forEach(tr => tr.onclick = () => { location.hash = '#/animal/' + tr.dataset.a; });
}

export async function animal(view, [idq]) {
  const id = (idq || '').split('?')[0]; const [a, groups] = await Promise.all([GET('/farm/animals/' + id), GET('/farm/groups')]);
  const alive = a.status === 'alive';
  view.innerHTML = page(`${a.tag}${a.name ? ' · ' + a.name : ''}`, `${alive ? `<button class="btn" id="ar">＋ ${L('Record', 'Ngola')}</button>${a.sex !== 'M' ? `<button class="btn" id="ab">🐣 ${L('Birth', 'Tsoalo')}</button>` : ''}<button class="btn btn-danger" id="ax">${L('Sold / died', 'E rekisitsoe / e shoele')}</button>` : ''}<button class="btn" id="ae">Edit</button>`,
    `<div class="cols cols-4" style="margin-bottom:14px"><div class="kpi"><div class="label">${esc(a.species)}</div><div class="value" style="font-size:18px">${esc(a.breed || '')} ${esc(a.sex || '')}</div><div class="hint">${a.birth_date ? 'born ' + esc(d(a.birth_date)) : ''}${a.mother_tag ? ` · mother ${esc(a.mother_tag)}` : ''}</div></div>
      <div class="kpi"><div class="label">Status</div><div class="value" style="font-size:18px">${st(a.status)}</div><div class="hint">${esc(a.exit_note || '')} ${a.exit_date ? esc(d(a.exit_date)) : ''}</div></div>
      <div class="kpi"><div class="label">Weight</div><div class="value">${a.weight ? qty(a.weight) + ' kg' : '–'}</div></div><div class="kpi"><div class="label">Herd</div><div class="value" style="font-size:18px">${esc(a.group_name || '–')}</div></div></div>
    ${a.offspring.length ? `<div class="card" style="margin-bottom:12px"><h3>${L('Offspring', 'Bana')}</h3>${tableHtml([{ key: 'tag', label: 'Tag' }, { key: 'sex', label: 'Sex' }, { key: 'birth_date', label: 'Born', fmt: d }, { key: 'status', label: 'Status', html: 1, fmt: st }], a.offspring, { rowAttr: o => `data-a="${o.id}"` })}</div>` : ''}
    <div class="card"><h3>${L('History', 'Nalane')}</h3>${tableHtml(logCols, a.logs, { empty: 'Nothing recorded yet.' })}</div>`, { back: '#/farm?tab=animals' });
  const reload = () => animal(view, [id]);
  $$('[data-a]').forEach(tr => tr.onclick = () => { location.hash = '#/animal/' + tr.dataset.a; });
  $('#ae').onclick = () => animalDialog(a, groups, reload);
  if ($('#ar')) $('#ar').onclick = () => recordDialog({ animal_id: a.id, group_id: a.group_id, kind: 'weigh' }, reload);
  if ($('#ab')) $('#ab').onclick = () => modal({ title: L(`Birth – mother ${a.tag}`, `Tsoalo – ’mè ${a.tag}`), body: `<label class="field"><span>Date</span><input type="date" id="bd" value="${today()}"></label>
      <table class="grid" style="margin-top:8px"><thead><tr><th>Tag of the young</th><th>Sex</th><th>Weight kg</th></tr></thead><tbody>${[0, 1, 2].map(i => `<tr data-y="${i}"><td><input data-f="tag" placeholder="${i ? '(twin / triplet)' : ''}"></td><td><select data-f="sex"><option value="">—</option><option>F</option><option>M</option></select></td><td><input data-f="weight" type="number" style="width:80px"></td></tr>`).join('')}</tbody></table>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const young = $$('[data-y]', r).map(tr => ({ tag: tr.querySelector('[data-f=tag]').value, sex: tr.querySelector('[data-f=sex]').value, weight: tr.querySelector('[data-f=weight]').value })).filter(y => y.tag);
      await POST(`/farm/animals/${a.id}/birth`, { date: r.querySelector('#bd').value, young }); c(); toast(L('Birth recorded', 'Tsoalo e ngotsoe')); reload(); } }] });
  if ($('#ax')) $('#ax').onclick = async () => {
    const custs = await GET('/partners?is_customer=1');
    const f = [{ key: 'kind', label: 'What happened', type: 'select', options: [['sold', 'Sold'], ['died', 'Died'], ['slaughtered', 'Slaughtered']].map(([value, label]) => ({ value, label })) }, { key: 'date', label: 'Date', type: 'date' },
      { key: 'partner_id', label: 'Buyer (if sold)', type: 'select', numeric: true, options: [{ value: '', label: '—' }, ...custs.map(p => ({ value: p.id, label: p.name }))] }, { key: 'amount', label: 'Price (if sold)', type: 'number' }, { key: 'weight', label: 'Weight kg', type: 'number', nullable: true }, { key: 'note', label: 'Cause / note', span: 2 }];
    modal({ title: `${a.tag}`, body: formHtml(f, { kind: 'sold', date: today() }, { ctx: 'farmexit' }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-danger', onClick: async (c, r) => { const o = await POST(`/farm/animals/${a.id}/exit`, readForm(r, f)); c(); if (o.invoice_id) location.hash = '#/invoice/' + o.invoice_id; else reload(); } }] });
  };
}

export async function season(view, [idq]) {
  const id = (idq || '').split('?')[0]; const [x, fields] = await Promise.all([GET('/farm/seasons/' + id), GET('/farm/fields')]);
  const ha = Number(x.area_ha || x.field_ha) || 0;
  view.innerHTML = page(`${x.crop}${x.variety ? ' – ' + x.variety : ''} · ${x.field_name}`, `<button class="btn" id="se">Edit</button><button class="btn btn-primary" id="sr">＋ ${L('Record', 'Ngola')}</button>`,
    `<div class="cols cols-4" style="margin-bottom:14px"><div class="kpi"><div class="label">Status</div><div class="value" style="font-size:18px">${st(x.status)}</div><div class="hint">${x.planted_on ? 'planted ' + esc(d(x.planted_on)) : ''}${x.expected_harvest ? ' · harvest ~' + esc(d(x.expected_harvest)) : ''}</div></div>
      <div class="kpi"><div class="label">Costs</div><div class="value">${money(x.cost)}</div>${ha ? `<div class="hint">${money(x.cost / ha)} per ha (${qty(ha)} ha)</div>` : ''}</div>
      <div class="kpi"><div class="label">Harvested</div><div class="value">${qty(x.harvested)} <small>${esc(x.produce_uom || '')}</small></div>${ha && x.harvested ? `<div class="hint">${qty(Math.round(x.harvested / ha * 100) / 100)} per ha</div>` : ''}</div>
      <div class="kpi"><div class="label">Harvest at cost</div><div class="value">${money(x.harvest_value)}</div></div></div>
    <div class="card"><h3>${L('Diary', 'Bukana')}</h3>${tableHtml(logCols, x.logs, { empty: 'Nothing recorded yet.' })}</div>`, { back: '#/farm?tab=crops' });
  $('#se').onclick = () => seasonDialog(x, fields, () => season(view, [id]));
  $('#sr').onclick = () => recordDialog({ season_id: x.id, kind: x.status === 'growing' ? 'fertilise' : 'plant' }, () => season(view, [id]));
}
