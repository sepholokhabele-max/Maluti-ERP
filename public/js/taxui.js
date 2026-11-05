// Tax centre: what is due to Revenue Services Lesotho and when, returns worked out from the books, filing and paying RSL
// (bank / EFT / M-Pesa, or MyWallet through the Smartel POS backend), withholding tax certificates.
import { state, GET, POST, PUT, esc, $, $$, toast, err, modal, formHtml, readForm, tableHtml, badge, page, d, dt, query, money, can, confirmBox, printHtml, attachPanel } from './core.js';
import { L, lang } from './i18n.js';

const TABS = [['calendar', 'What is due', 'Se lokelang ho lefshoa'], ['returns', 'Returns', 'Li-return'], ['wht', 'Withholding tax', 'Lekhetho le tšoaroang'], ['settings', 'Settings', 'Litlhophiso']];
const SB = { not_started: ['not started', 'draft'], draft: ['draft', 'draft'], filed: ['filed – to pay', 'posted'], part_paid: ['part paid', 'partial'], paid: ['paid', 'paid'] };
const SB_ST = { 'not started': 'ha e so qale', draft: 'draft', 'filed – to pay': 'e rometsoe – e lefshoe', 'part paid': 'e lefiloe karolo', paid: 'e lefiloe' };
const stBadge = (s, overdue) => { if (overdue) return badge(L('overdue', 'e fetile nako'), 'overdue'); const [en, k] = SB[s] || [s, '']; return badge(L(en, SB_ST[en] || en), k); };
const nm = x => lang() === 'st' ? (x.name_st || x.name) : x.name;

export async function taxPage(view) {
  const tab = query().tab || 'calendar';
  view.innerHTML = page(L('Tax centre (RSL)', 'Setsi sa lekhetho (RSL)'), '', `<div class="card act-trial" style="margin-bottom:12px">${L('Every return is worked out from your books. Check the figures, file it on RSL e-Tax (or at RSL), press <b>Filed</b>, then pay. Rates and due days follow RSL\'s published schedule – change them under Settings when the budget changes.', 'Return e ’ngoe le e ’ngoe e baloa ho tsoa libukeng tsa hau. Hlahloba, e romele RSL, tobetsa Filed, ebe u lefa.')}</div>
    <div class="tabs">${TABS.map(([k, en, st]) => `<a href="#/tax?tab=${k}" class="${tab === k ? 'active' : ''}">${L(en, st)}</a>`).join('')}</div><div id="txb"></div>`);
  const b = $('#txb');
  await ({ calendar: calTab, returns: returnsTab, wht: whtTab, settings: settingsTab }[tab] || calTab)(b, () => taxPage(view));
}

async function calTab(b) {
  const c = await GET('/tax/calendar');
  const L2 = code => (c.liabilities.find(x => x.code === code) || { balance: 0 }).balance;
  const owed = [[L('VAT on sales not yet filed', 'VAT e e so romeloe'), round(L2('2100') + L2('1400'))], [L('VAT filed, to pay (2110)', 'VAT e lokelang ho lefshoa'), L2('2110')], [L('PAYE (2200)', 'PAYE (2200)'), L2('2200')], [L('Withholding tax (2220)', 'Lekhetho le tšoaroang'), L2('2220')],
    [L('Income tax (2230)', 'Lekhetho la lekeno'), L2('2230')], [L('Fringe benefit tax (2240)', 'FBT'), L2('2240')], [L('Levies (2250)', 'Makhetho a mang'), L2('2250')]];
  const items = c.items;
  const soon = items.filter(x => x.status !== 'paid' && x.days_left <= 31 && !(x.status === 'filed' && x.amount_due <= 0));
  b.innerHTML = `<div class="tiles" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));margin-bottom:12px">${owed.map(([k, v]) => `<div class="card"><small class="muted">${k}</small><div style="font-size:19px;font-weight:700">${money(v)}</div></div>`).join('')}</div>
    ${c.payments && c.payments.rows.length ? `<div class="card" style="margin-bottom:12px"><b>${L('Paid to RSL in tax year', 'Se lefiloeng RSL selemong sa lekhetho')} ${esc(c.tax_year)}</b>: ${money(c.payments.total_paid)} · ${L('fees for paying', 'litefo tsa ho lefa')} ${money(c.payments.total_fees)}
      <div class="muted">${c.payments.rows.map(x => `${esc(x.name)} ${money(x.paid)}${x.fees ? ` (+${money(x.fees)} ${L('fee', 'tefo')})` : ''}`).join(' · ')}</div></div>` : ''}
    ${soon.length ? `<div class="card ${soon.some(x => x.overdue) ? 'act-bad' : 'act-trial'}" style="margin-bottom:12px"><b>${L('Due in the next month', 'Tse tlang khoeling e tlang')}</b>: ${soon.map(x => `${esc(nm(x))} ${esc(x.period_label)} – ${esc(x.due_date)}${x.overdue ? ' ⚠' : ''}`).join(' · ')}</div>` : ''}
    <div class="card">${tableHtml([{ key: 'due_date', label: L('Due', 'Letsatsi'), fmt: (v, x) => `<b>${esc(v)}</b>${x.status !== 'paid' && x.days_left >= 0 && x.days_left <= 14 ? ` <small class="muted">(${x.days_left} ${L('days', 'matsatsi')})</small>` : ''}`, html: 1 },
      { key: 'name', label: L('Tax', 'Lekhetho'), fmt: (v, x) => nm(x) }, { key: 'period_label', label: L('Period', 'Nako') },
      { key: 'amount_due', label: L('Amount', 'Chelete'), right: 1, fmt: v => v === null ? '' : money(v) }, { key: 'amount_paid', label: L('Paid', 'E lefiloe'), right: 1, fmt: (v, x) => x.return_id ? money(v) : '' },
      { key: 'status', label: L('Status', 'Boemo'), html: 1, fmt: (v, x) => stBadge(v, x.overdue) },
      { key: 'tax', label: '', html: 1, fmt: (v, x) => x.return_id ? `<a class="btn btn-sm" href="#/taxreturn/${x.return_id}">${L('Open', 'Bula')}</a>` : `<button class="btn btn-sm btn-primary" data-prep='${esc(JSON.stringify({ tax: x.tax, period_from: x.period_from, period_to: x.period_to, due_date: x.due_date, period_label: x.period_label }))}'>${L('Prepare', 'Lokisa')}</button>` }], items, { empty: L('Nothing due. Switch on VAT, payroll or fringe benefits under Settings if they apply to you.', 'Ha ho letho.') })}</div>`;
  $$('[data-prep]', b).forEach(x => x.onclick = async () => { try { const r = await POST('/tax/returns/prepare', JSON.parse(x.dataset.prep)); location.hash = '#/taxreturn/' + r.id; } catch (e) { err(e); } });
}
const round = n => Math.round(n * 100) / 100;

async function returnsTab(b) {
  const rows = await GET('/tax/returns');
  b.innerHTML = `<div class="card"><div class="row" style="margin-bottom:8px"><span class="spacer"></span><button class="btn" id="levy">＋ ${L('Other levy (plastic, gaming…)', 'Lekhetho le leng')}</button></div>
    ${tableHtml([{ key: 'due_date', label: L('Due', 'Letsatsi') }, { key: 'name', label: L('Tax', 'Lekhetho') }, { key: 'period_label', label: L('Period', 'Nako') }, { key: 'amount_due', label: L('Amount', 'Chelete'), right: 1, fmt: v => money(v) },
      { key: 'amount_paid', label: L('Paid', 'E lefiloe'), right: 1, fmt: v => money(v) }, { key: 'status', label: L('Status', 'Boemo'), html: 1, fmt: v => stBadge(v) }, { key: 'filed_ref', label: L('RSL ref', 'Ref ea RSL') }], rows,
      { rowAttr: r => `data-r="${r.id}" style="cursor:pointer"`, empty: L('No returns yet – start from "What is due".', 'Ha ho li-return.') })}</div>`;
  $$('[data-r]', b).forEach(tr => tr.onclick = () => { location.hash = '#/taxreturn/' + tr.dataset.r; });
  $('#levy').onclick = () => {
    const f = [{ key: 'levy_name', label: L('Levy', 'Lekhetho'), required: true, placeholder: 'Plastic levy' }, { key: 'basis', label: L('Worked out on', 'Le baloa ho') }, { key: 'amount', label: L('Amount (M)', 'Chelete (M)'), type: 'number', required: true },
      { key: 'period_from', label: L('Period from', 'Ho tloha'), type: 'date', required: true }, { key: 'period_to', label: L('to', 'ho fihla'), type: 'date', required: true }, { key: 'due_date', label: L('Due date', 'Letsatsi la ho lefa'), type: 'date', required: true }];
    modal({ title: L('Other levy', 'Lekhetho le leng'), body: formHtml(f, {}, { ctx: 'tax_levy' }), actions: [{ label: L('Cancel', 'Hlakola') }, { label: L('Prepare', 'Lokisa'), cls: 'btn-primary', onClick: async (cl, r) => {
      const v = readForm(r, f); const x = await POST('/tax/returns/prepare', { tax: 'levy', period_from: v.period_from, period_to: v.period_to, due_date: v.due_date, period_label: `${v.levy_name} ${v.period_from.slice(0, 7)}`, inputs: { levy_name: v.levy_name, basis: v.basis, amount: v.amount } }); cl(); location.hash = '#/taxreturn/' + x.id; } }] });
  };
}

const INPUTS = {
  fbt: [{ key: 'benefits_value', label: 'Taxable value of fringe benefits this quarter (M)', st: 'Boleng ba melemo kotara ena (M)', type: 'number' }, { key: 'details', label: 'What benefits (car, housing, loans…)', st: 'Melemo efe' }],
  levy: [{ key: 'levy_name', label: 'Levy', st: 'Lekhetho' }, { key: 'basis', label: 'Worked out on', st: 'Le baloa ho' }, { key: 'amount', label: 'Amount (M)', st: 'Chelete (M)', type: 'number' }],
  cit_1: [{ key: 'estimated_income', label: 'Estimated taxable income for the year (M) – leave empty to use the books', st: 'Lekeno le lebelletsoeng (M)', type: 'number', nullable: true }, { key: 'rate', label: 'Rate % (10 for manufacturing / farming)', st: 'Sekhahla %', type: 'number', nullable: true }],
  cit_final: [{ key: 'add_backs', label: 'Add back: costs that are not deductible (M)', st: 'Litšenyehelo tse sa fokotsoeng (M)', type: 'number' }, { key: 'allowances', label: 'Less: capital allowances / wear-and-tear (M)', st: 'Ho fokotsa: allowances (M)', type: 'number' },
    { key: 'losses_brought_forward', label: 'Less: assessed loss brought forward (M)', st: 'Tahlehelo e tlisitsoeng (M)', type: 'number' }, { key: 'rate', label: 'Rate % (10 for manufacturing / farming)', st: 'Sekhahla %', type: 'number', nullable: true }]
};
INPUTS.cit_2 = INPUTS.cit_1; INPUTS.cit_3 = INPUTS.cit_1;

function figuresHtml(r) {
  const f = r.figures || {}; const row = (k, v, bold) => `<tr><td>${k}</td><td class="r">${bold ? `<b>${v}</b>` : v}</td></tr>`;
  if (r.tax === 'vat') return `<table class="grid">${row(L('Output VAT on sales', 'VAT ea thekiso'), money(f.output_vat))}${row(L('Less input VAT on purchases', 'Ho fokotsa VAT ea lithekong'), money(f.input_vat))}${row(f.net >= 0 ? L('VAT to pay', 'VAT e lokelang ho lefshoa') : L('VAT refund due to you', 'VAT eo u lokelang ho e khutlisetsoa'), money(Math.abs(f.net)), 1)}</table>
    ${f.supplies ? `<h4>${L('Supplies (excl. VAT)', 'Thekiso (ntle le VAT)')}</h4><table class="grid">${row(L('Standard-rated', 'Sekhahla se tloaelehileng'), money(f.supplies.standard))}${row(L('Zero-rated', 'Sekhahla sa 0'), money(f.supplies.zero_rated))}${row(L('Exempt', 'Tse lokolotsoeng'), money(f.supplies.exempt))}</table>` : ''}
    ${f.checks ? `<h4>${L('Checks before filing', 'Tlhahlobo pele ho romela')}</h4>${f.checks.map(c => `<div class="card ${c.level === 'bad' ? 'act-bad' : c.level === 'warn' ? 'act-trial' : 'act-ok'}" style="margin-bottom:6px;padding:8px 12px">${c.level === 'ok' ? '✓' : c.level === 'bad' ? '⛔' : '⚠'} ${esc(c.text)}${c.items ? `<details><summary class="muted">${L('show', 'bontša')}</summary><small>${c.items.map(esc).join('<br>')}</small></details>` : ''}</div>`).join('')}` : ''}
    <h4>${L('Supplies by rate', 'Thekiso ka sekhahla')}</h4>${tableHtml([{ key: 'rate', label: '%', fmt: v => v + '%' }, { key: 'net', label: L('Value excl. VAT', 'Boleng ntle le VAT'), right: 1, fmt: v => money(v) }, { key: 'tax', label: 'VAT', right: 1, fmt: v => money(v) }], f.sales || [])}
    <h4>${L('Purchases by rate (supplier bills)', 'Lithekong ka sekhahla')}</h4>${tableHtml([{ key: 'rate', label: '%', fmt: v => v + '%' }, { key: 'net', label: L('Value excl. VAT', 'Boleng'), right: 1, fmt: v => money(v) }, { key: 'tax', label: 'VAT', right: 1, fmt: v => money(v) }], f.purchases || [])}
    <small class="help-note">${esc(f.note || '')} ${L('Till purchases paid in cash and expense claims with VAT also count – they are in input VAT.', '')}</small>`;
  if (r.tax === 'paye') return `<table class="grid">${row(L('Employees', 'Basebetsi'), f.employees ?? 0)}${row(L('Gross pay', 'Moputso kaofela'), money(f.gross))}${row('PAYE', money(f.paye), 1)}</table>${f.note ? `<p class="muted">${esc(f.note)}</p>` : ''}
    <small class="help-note">${L('Taken from the payroll run of this month (HR → Payroll). Pay it here – not also under HR → PAYE paid, or it is counted twice.', 'E nkiloe ho payroll ea khoeli ena.')}</small>`;
  if (r.tax === 'wht') return tableHtml([{ key: 'date', label: L('Date', 'Letsatsi') }, { key: 'payee', label: L('Paid to', 'E lefiloe ho') }, { key: 'kind', label: L('For', 'Bakeng sa') }, { key: 'gross', label: L('Amount', 'Chelete'), right: 1, fmt: v => money(v) }, { key: 'rate', label: '%', right: 1 }, { key: 'tax', label: L('Tax withheld', 'Lekhetho'), right: 1, fmt: v => money(v) }, { key: 'certificate_no', label: L('Certificate', 'Setifikeiti') }], f.lines || [], { empty: L('No tax was withheld this month.', 'Ha ho letho.') });
  if (r.tax === 'fbt') return `<table class="grid">${row(L('Taxable value of benefits', 'Boleng ba melemo'), money(f.benefits_value))}${row(L('Rate', 'Sekhahla'), f.rate + '%')}${row(L('Fringe benefit tax', 'Lekhetho la melemo'), money(r.amount_due), 1)}</table>`;
  if (r.tax === 'levy') return `<table class="grid">${row(L('Levy', 'Lekhetho'), esc(f.levy_name))}${row(L('Worked out on', 'Le baloa ho'), esc(f.basis || ''))}${row(L('Amount', 'Chelete'), money(f.amount), 1)}</table>`;
  if (r.tax === 'cit_final') return `<table class="grid">${row(L('Income', 'Lekeno'), money(f.income))}${row(L('Expenses', 'Litšenyehelo'), money(f.expenses))}${row(L('Profit before tax (books)', 'Phaello pele ho lekhetho'), money(f.profit))}${row(L('Add back', 'Kenya hape'), money(f.add_backs))}${row(L('Less allowances', 'Ho fokotsa allowances'), money(f.allowances))}${row(L('Less losses brought forward', 'Ho fokotsa tahlehelo'), money(f.losses_brought_forward))}
    ${row(L('Chargeable income', 'Lekeno le lefisoang'), money(f.chargeable_income), 1)}${row(`${L('Tax at', 'Lekhetho ho')} ${f.rate}%`, money(f.tax))}${row(L('Less provisional tax paid', 'Ho fokotsa tse lefiloeng'), money(f.provisional_paid))}${row(L('Less withholding tax credits', 'Ho fokotsa WHT'), money(f.wht_credits))}${row(f.balance >= 0 ? L('Balance to pay', 'Se setseng ho lefshoa') : L('Overpaid – refund / credit', 'E lefiloe ho feta'), money(Math.abs(f.balance)), 1)}</table>`;
  if (r.tax.startsWith('cit_')) return `<table class="grid">${row(L('Estimated taxable income for the year', 'Lekeno le lebelletsoeng'), money(f.estimated_income))}${row(L('Based on', 'Ho ipapisitsoe le'), esc(f.basis || ''))}${row(`${L('Estimated tax at', 'Lekhetho ho')} ${f.rate}%`, money(f.estimated_tax))}${row(L('Paid so far this year', 'Se lefiloeng selemong sena'), money(f.paid_so_far))}${row(`${L('Instalment', 'Karolo')} ${f.instalment} ${L('of 3', 'ho 3')}`, money(r.amount_due), 1)}</table>
    <small class="help-note">${L('Each instalment brings what you have paid up to one third, two thirds and all of the estimated tax. Update the estimate if the year goes better or worse.', 'Karolo ka ’ngoe e tlisa se lefiloeng ho karolo ea boraro.')}</small>`;
  return '';
}

export async function taxReturn(view, [id]) {
  const r = await GET('/tax/returns/' + id);
  const draft = r.status === 'draft';
  const ins = INPUTS[r.tax] ? INPUTS[r.tax].map(x => ({ ...x, label: L(x.label, x.st) })) : null;
  view.innerHTML = page(`${nm(r)} – ${r.period_label}`, `<button class="btn" id="pr">🖨 ${L('Print', 'Hatisa')}</button>${draft ? `<button class="btn" id="rf">🔄 ${L('Work out again', 'Bala hape')}</button><button class="btn btn-primary" id="fl">📨 ${L('Filed with RSL', 'E rometsoe RSL')}</button>` : ''}${!draft && r.balance > 0.004 ? `<button class="btn btn-ok" id="py">💸 ${L('Pay', 'Lefa')} ${money(r.balance)}</button>` : ''}${!draft && state.user.role === 'admin' && !r.payments.some(p => p.status === 'paid') ? `<button class="btn" id="ro">${L('Reopen', 'Bula hape')}</button>` : ''}`,
    `<div class="cols cols-2" style="align-items:start"><div class="card"><p>${stBadge(r.status, r.due_date < new Date().toISOString().slice(0, 10) && r.status !== 'paid')} ${L('Period', 'Nako')} ${esc(r.period_from)} – ${esc(r.period_to)} · ${L('due', 'e lefshoa')} <b>${esc(r.due_date)}</b>${r.filed_ref ? ` · RSL ${esc(r.filed_ref)}` : ''}</p>${figuresHtml(r)}</div>
      <div>${ins && draft ? `<div class="card" style="margin-bottom:12px"><h3>${L('Your figures', 'Lipalo tsa hau')}</h3><div id="inF">${formHtml(ins, (r.figures || {}).inputs || {}, { ctx: 'tax_inputs' })}</div><button class="btn btn-primary" id="inB" style="margin-top:8px">${L('Work out', 'Bala')}</button></div>` : ''}
      <div class="card"><h3>${L('Payments to RSL', 'Litefo ho RSL')}</h3>${tableHtml([{ key: 'created_at', label: L('When', 'Neng'), fmt: dt }, { key: 'method', label: L('How', 'Joang') }, { key: 'amount', label: 'M', right: 1, fmt: v => money(v) }, { key: 'fee', label: L('Fee', 'Tefo'), right: 1, fmt: v => Number(v) ? money(v) : '' }, { key: 'reference', label: 'Ref' }, { key: 'status', label: L('Status', 'Boemo'), html: 1, fmt: (v, p) => `${badge(v, v === 'paid' ? 'paid' : v === 'failed' ? 'cancelled' : 'partial')}${v === 'pending' ? ` <button class="btn btn-sm" data-pr="${p.id}">${L('Check', 'Hlahloba')}</button>` : ''}` }], r.payments, { empty: L('Nothing paid yet.', 'Ha ho se lefiloeng.') })}
      <p><b>${L('Balance', 'Se setseng')}: ${money(r.balance)}</b></p></div>
      <div class="card" style="margin-top:12px" id="txFiles"></div></div></div>`, { back: '#/tax' });
  attachPanel($('#txFiles'), 'tax_return', r.id, { title: L('RSL acknowledgement & papers', 'Netefatso ea RSL le lipampiri') });
  const reload = () => taxReturn(view, [id]);
  const prepAgain = async (inputs) => { try { await POST('/tax/returns/prepare', { tax: r.tax, period_from: r.period_from, period_to: r.period_to, inputs }); toast(L('Worked out again from the books', 'E baliloe hape')); reload(); } catch (e) { err(e); } };
  if ($('#rf')) $('#rf').onclick = () => prepAgain({});
  if ($('#inB')) $('#inB').onclick = () => { try { prepAgain(readForm($('#inF'), ins)); } catch (e) { err(e); } };
  if ($('#fl')) $('#fl').onclick = () => modal({ title: L('Filed with RSL', 'E rometsoe RSL'), body: `${formHtml([{ key: 'filed_ref', label: L('RSL acknowledgement / e-Tax reference', 'Referense ea RSL') }], {}, { ctx: 'tax_file' })}<p class="muted">${L('Only press this after you submitted the return on RSL e-Tax or at RSL. The figures are then locked and the closing entry is posted. Attach RSL\'s acknowledgement under "RSL acknowledgement & papers".', 'Tobetsa sena ha u se u e romeletse RSL.')}</p>
      ${((r.figures || {}).checks || []).some(c => c.level === 'bad') ? `<label class="check"><input type="checkbox" id="accw"> <span>${L('I checked the serious problems listed and file anyway', 'Ke hlahlobile mathata ’me ke romela')}</span></label>` : ''}`,
    actions: [{ label: L('Cancel', 'Hlakola') }, { label: L('Filed', 'E rometsoe'), cls: 'btn-primary', onClick: async (cl, m) => { await POST(`/tax/returns/${id}/file`, { filed_ref: m.querySelector('[name=filed_ref]').value, accept_warnings: !!(m.querySelector('#accw') && m.querySelector('#accw').checked) }); cl(); reload(); } }] });
  if ($('#ro')) $('#ro').onclick = async () => { if (!await confirmBox(L('Reopen this return? Its closing entry is reversed.', 'Bula hape? Ho ngoloa ho khutlisoa.'))) return; try { await POST(`/tax/returns/${id}/reopen`); reload(); } catch (e) { err(e); } };
  if ($('#py')) $('#py').onclick = () => payDialog(r, reload);
  $$('[data-pr]', view).forEach(b => b.onclick = async () => { try { const x = await POST(`/tax/payments/${b.dataset.pr}/refresh`); toast(x.payment.status); reload(); } catch (e) { err(e); } });
  $('#pr').onclick = () => { const c = state.company || {}; printHtml(`<html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;font-size:12px;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:4px}.r{text-align:right}</style></head><body>
    <h2>${esc(c.name || '')}</h2><div>${esc(c.address || '')}</div><h3>${esc(r.name)} – ${esc(r.period_label)}</h3><div>${L('Period', 'Nako')} ${esc(r.period_from)} – ${esc(r.period_to)} · ${L('Due', 'E lefshoa')} ${esc(r.due_date)}</div><br>${figuresHtml(r)}</body></html>`); };
}

async function payDialog(r, reload) {
  const sm = await GET('/smartel/status').catch(() => null);
  const tills = sm && sm.settings.enabled ? sm.terminals.filter(t => t.terminal_uuid && !Number(t.quarantined)) : [];
  const sessions = tills.length ? await GET('/pos/sessions?status=open').catch(() => []) : [];
  const usable = sessions.filter(s => tills.some(t => t.pos_terminal_id === s.terminal_id));
  const f = [{ key: 'method', label: L('How', 'Joang'), type: 'select', options: [...(usable.length ? [{ value: 'smartel', label: L('MyWallet through Smartel (at the till)', 'MyWallet ka Smartel (ho till)') }] : []), { value: 'bank', label: L('Bank deposit / EFT', 'Banka / EFT') }, { value: 'mpesa', label: 'M-Pesa' }, { value: 'cash', label: L('Cash at RSL', 'Chelete RSL') }] },
    { key: 'amount', label: L('Amount (M)', 'Chelete (M)'), type: 'number', default: r.balance },
    { key: 'pos_session_id', label: L('Till (open cashier session)', 'Till'), type: 'select', options: usable.map(s => ({ value: s.id, label: `${s.terminal_name} – ${s.user_name}` })) },
    { key: 'account_code', label: L('Money comes from', 'Chelete e tsoa ho'), type: 'select', options: [['1050', L('Bank (1050)', 'Banka (1050)')], ['1000', L('Cash (1000)', 'Chelete (1000)')], ['1020', L('Mobile money (1020)', 'Mobile money (1020)')], ['1170', L('MyWallet business wallet (1170)', 'Wallet ea khoebo (1170)')]].map(([value, label]) => ({ value, label })) },
    { key: 'reference', label: L('Bank / RSL receipt reference', 'Referense') }, { key: 'fee', label: L('Bank charge (M)', 'Tefo ea banka (M)'), type: 'number' }];
  modal({ title: `${L('Pay RSL', 'Lefa RSL')} – ${nm(r)} ${r.period_label}`, body: formHtml(f, { method: usable.length ? 'smartel' : 'bank' }, { ctx: 'tax_pay' }) + `<div id="mwOut"></div>`,
    onOpen: m => { const sync = () => { const v = m.querySelector('[name=method]').value; for (const k of ['pos_session_id']) m.querySelector(`[name=${k}]`).closest('.field').style.display = v === 'smartel' ? '' : 'none'; for (const k of ['reference', 'fee']) m.querySelector(`[name=${k}]`).closest('.field').style.display = v === 'smartel' ? 'none' : ''; }; m.querySelector('[name=method]').onchange = sync; sync(); },
    actions: [{ label: L('Cancel', 'Hlakola') }, { label: L('Pay', 'Lefa'), cls: 'btn-primary', onClick: async (cl, m) => {
      const v = readForm(m, f);
      if (v.method !== 'smartel') { await POST(`/tax/returns/${r.id}/pay`, v); cl(); toast(L('Payment recorded', 'Tefo e ngotsoe')); reload(); return; }
      const x = await POST(`/tax/returns/${r.id}/pay`, { method: 'smartel', amount: v.amount, pos_session_id: v.pos_session_id, account_code: v.account_code });
      cl();
      modal({ title: L('Confirm payment to RSL', 'Netefatsa tefo ho RSL'), body: `<table class="grid"><tr><td>${L('Tax to Revenue Services Lesotho', 'Lekhetho ho RSL')}${x.op.counterparty ? ` (${esc(x.op.counterparty)})` : ''}</td><td class="r">${money(v.amount)}</td></tr>
        <tr><td>${L('Service fee', 'Tefo ea tšebeletso')} <small class="muted">(${x.fee_from === 'MyWallet' ? L('MyWallet tariff', 'tefo ea MyWallet') : L('tariff in Settings', 'tefo ho Settings')})</small></td><td class="r">${money(x.fee)}</td></tr>
        <tr><td><b>${L('Total', 'Kakaretso')}</b></td><td class="r"><b>${money(x.total)}</b></td></tr></table><p class="muted">${L('Hand the cash in at that till – its cash-up expects it. The fee is booked as a tax payment fee.', 'Kenya chelete ho till eo. Tefo e ngoloa e le tefo ea ho lefa lekhetho.')}</p>`,
        actions: [{ label: L('Not now', 'Eseng hona joale') }, { label: L('Confirm and pay', 'Netefatsa'), cls: 'btn-ok', onClick: async cl2 => { const y = await POST(`/tax/payments/${x.payment_id}/confirm`, {}); cl2(); toast(y.payment.status === 'paid' ? L('Paid – RSL ref ', 'E lefiloe – ref ') + (y.payment.reference || '') : y.payment.status, y.payment.status === 'paid' ? 'ok' : 'err', 7000); reload(); } }] });
    } }] });
}

async function whtTab(b, reload) {
  const [rows, st, partners] = await Promise.all([GET('/tax/withholding'), GET('/tax/settings'), GET('/partners')]);
  const kinds = Object.entries(st.wht_kinds).map(([value, label]) => ({ value, label: `${label} (${st.settings.wht_rates[value]}%)` }));
  const f = [{ key: 'direction', label: L('Who withheld it', 'Ke mang ea e tšoereng'), type: 'select', options: [{ value: 'deducted', label: L('I withheld it from a supplier / contractor', 'Ke e tšoere ho mofani') }, { value: 'suffered', label: L('A customer withheld it from me (certificate received)', 'Moreki o e tšoere ho nna') }] },
    { key: 'partner_id', label: L('Supplier / customer', 'Mofani / moreki'), type: 'select', numeric: true, options: partners.map(p => ({ value: p.id, label: p.name })) },
    { key: 'kind', label: L('Payment for', 'Tefo bakeng sa'), type: 'select', options: kinds }, { key: 'gross', label: L('Amount before VAT (M)', 'Chelete pele ho VAT (M)'), type: 'number', required: true },
    { key: 'tx_date', label: L('Date', 'Letsatsi'), type: 'date' }, { key: 'reference', label: L('Invoice / certificate number', 'Nomoro ea invoice / setifikeiti') }];
  b.innerHTML = `<div class="cols cols-2" style="align-items:start"><div class="card"><h3>${L('Record withholding tax', 'Ngola lekhetho le tšoaroang')}</h3><div id="wf">${formHtml(f, { direction: 'deducted', tx_date: new Date().toISOString().slice(0, 10) }, { ctx: 'tax_wht' })}</div><button class="btn btn-primary" id="wb" style="margin-top:8px">${L('Record', 'Ngola')}</button></div>
    <div class="card">${tableHtml([{ key: 'tx_date', label: L('Date', 'Letsatsi'), fmt: d }, { key: 'direction', label: '', fmt: v => v === 'deducted' ? L('withheld', 'e tšoeroe') : L('suffered', 'e tšoaretsoe') }, { key: 'partner_name', label: L('Who', 'Mang') }, { key: 'gross', label: L('Amount', 'Chelete'), right: 1, fmt: v => money(v) }, { key: 'rate', label: '%', right: 1 }, { key: 'amount', label: L('Tax', 'Lekhetho'), right: 1, fmt: v => money(v) },
      { key: 'certificate_no', label: L('Certificate', 'Setifikeiti'), html: 1, fmt: (v, w) => w.direction === 'deducted' ? `<button class="btn btn-sm" data-cert="${w.id}">🖨 ${esc(v)}</button>` : esc(v || '') }], rows, { empty: L('Nothing recorded yet.', 'Ha ho letho.') })}</div></div>`;
  $('#wb').onclick = async () => { try { const w = await POST('/tax/withholding', readForm($('#wf'), f)); toast(`${L('Withholding tax', 'Lekhetho')} ${money(w.amount)}`); reload(); } catch (e) { err(e); } };
  $$('[data-cert]', b).forEach(x => x.onclick = async () => { const w = await GET(`/tax/withholding/${x.dataset.cert}/certificate`);
    printHtml(`<html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;margin:30px;font-size:13px}td{padding:4px 8px}</style></head><body><h2>WITHHOLDING TAX CERTIFICATE</h2><p>${esc(w.certificate_no)}</p>
      <table><tr><td>Withholding agent</td><td><b>${esc(w.company.name || '')}</b>, TIN ${esc(w.tin || '')}</td></tr><tr><td>Payee</td><td><b>${esc(w.partner_name)}</b>${w.partner_tin ? `, TIN ${esc(w.partner_tin)}` : ''}</td></tr>
      <tr><td>Payment for</td><td>${esc(w.kind_name)}</td></tr><tr><td>Date</td><td>${esc(d(w.tx_date))}</td></tr><tr><td>Amount (excl. VAT)</td><td>M ${Number(w.gross).toFixed(2)}</td></tr><tr><td>Rate</td><td>${w.rate}%</td></tr><tr><td>Tax withheld</td><td><b>M ${Number(w.amount).toFixed(2)}</b></td></tr><tr><td>Reference</td><td>${esc(w.reference || '')}</td></tr></table>
      <p>This tax is paid to Revenue Services Lesotho by the 15th of the following month. Keep this certificate to claim it against your income tax.</p><br><br><p>Signed: ______________________ Date: ____________</p></body></html>`); });
}

async function settingsTab(b, reload) {
  const st = await GET('/tax/settings'); const s = st.settings;
  const f = [{ key: 'tin', label: L('Your TIN (RSL taxpayer number)', 'TIN ea hau'), required: true }, { key: 'entity', label: L('Business type', 'Mofuta oa khoebo'), type: 'select', options: [{ value: 'company', label: L('Company (company income tax)', 'Khamphani') }, { value: 'individual', label: L('Sole trader (personal income tax)', 'Motho ka mong') }] },
    { key: 'vat_registered', label: L('Registered for VAT', 'E ngolisitsoe bakeng sa VAT'), type: 'checkbox' }, { key: 'vat_rate', label: L('Standard VAT rate %', 'Sekhahla sa VAT %'), type: 'number' }, { key: 'vat_due_day', label: L('VAT due day of the next month', 'Letsatsi la VAT'), type: 'number' },
    { key: 'paye_due_day', label: L('PAYE due day', 'Letsatsi la PAYE'), type: 'number' }, { key: 'wht_due_day', label: L('Withholding tax due day', 'Letsatsi la WHT'), type: 'number' },
    { key: 'cit_rate', label: L('Income tax rate %', 'Sekhahla sa lekhetho la lekeno %'), type: 'number' }, { key: 'year_end_month', label: L('Financial year ends in month (3 = March)', 'Selemo se fela khoeling'), type: 'number' },
    { key: 'fbt_enabled', label: L('We give staff fringe benefits (car, housing, loans…)', 'Re fa basebetsi melemo'), type: 'checkbox' }, { key: 'fbt_rate', label: L('Fringe benefit tax rate %', 'Sekhahla sa FBT %'), type: 'number' },
    ...Object.entries(st.wht_kinds).map(([k, label]) => ({ key: 'wht_' + k, label: `${L('Withholding', 'WHT')}: ${label} %`, type: 'number' })),
    { key: 'rsl_phone', label: L('Phone for RSL payment SMS', 'Mohala oa SMS ea tefo') },
    { key: 'rsl_fee_fixed', label: L('Fee for paying RSL through MyWallet – fixed (M)', 'Tefo ea ho lefa RSL ka MyWallet – e tsitsitseng (M)'), type: 'number' },
    { key: 'rsl_fee_pct', label: L('… plus % of the tax paid', '… le % ea lekhetho'), type: 'number' },
    { key: 'rsl_fee_max', label: L('… but not more than (M, empty = no cap)', '… empa eseng ho feta (M)'), type: 'number', nullable: true },
    { key: 'start_month', label: L('Show returns from (month)', 'Bontša li-return ho tloha (khoeli)'), type: 'month' }];
  const vals = { ...s, ...Object.fromEntries(Object.entries(s.wht_rates).map(([k, v]) => ['wht_' + k, v])) };
  b.innerHTML = `<div class="card"><div id="sf">${formHtml(f, vals, { ctx: 'tax_settings' })}</div><button class="btn btn-primary" id="sv" style="margin-top:8px">${L('Save', 'Boloka')}</button>
    <small class="help-note">${L('Defaults (Nov 2026, from RSL): VAT 15% (electricity 10%, exports and basic foods 0%), VAT by the 20th; PAYE and withholding by the 15th; income tax 25% (10% manufacturing and commercial farming) with instalments on 30 Sep, 31 Dec, 31 Mar and the return by 30 Jun; withholding 5% resident contractors, 10% non-resident contractors and interest, 7.5% South African technical services. RSL and other published sources differ on the fringe benefit tax rate – check it with RSL.', 'Litlhophiso tsa motheo li latela RSL.')}</small></div>`;
  $('#sv').onclick = async () => { try { const v = readForm($('#sf'), f); const wr = {}; for (const k of Object.keys(st.wht_kinds)) { wr[k] = v['wht_' + k]; delete v['wht_' + k]; } await PUT('/tax/settings', { ...v, wht_rates: wr }); toast(L('Saved', 'E bolokiloe')); reload(); } catch (e) { err(e); } };
}
