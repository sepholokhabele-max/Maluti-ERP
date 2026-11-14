// Finance centre: overview & month-end close, chart of accounts, journals (approval, reversing), recurring journals,
// trial balance, general ledger, income statement (comparative / budget / cost centre / monthly), balance sheet,
// cash flow, budgets, ratios, periods & year-end, cost centres, settings. Every report exports to PDF, Word and Excel.
import { state, GET, POST, PUT, esc, $, $$, toast, err, can, money, qty, modal, confirmBox, formHtml, readForm, tableHtml, badge, page, d, dt, today, query } from './core.js';
import { exportButtons, wireExport } from './reportexport.js';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const JS = { draft: ['draft', 'draft'], submitted: ['waiting for approval', 'partial'], posted: ['posted', 'ok'], rejected: ['rejected', 'cancelled'], cancelled: ['cancelled', 'closed'] };
const jBadge = s => badge((JS[s] || [s])[0], (JS[s] || [s, ''])[1]);
const edit = () => can('accounting');
const y0 = () => today().slice(0, 4) + '-01-01';
const neg = v => Number(v) < 0 ? `(${money(-v)})` : money(v);
let ACC = null, CC = null;
const accts = async () => ACC || (ACC = (await GET('/finance/accounts')).accounts);
const ccs = async () => CC || (CC = await GET('/finance/cost-centres'));

export async function finance(view) {
  ACC = null; CC = null;
  const tab = query().tab || 'overview';
  const tabs = [['overview', 'Overview & close'], ['accounts', 'Chart of accounts'], ['journals', 'Journals'], ['recurring', 'Recurring'], ['tb', 'Trial balance'], ['gl', 'General ledger'],
    ['is', 'Income statement'], ['bs', 'Balance sheet'], ['cf', 'Cash flow'], ['budgets', 'Budgets'], ['ratios', 'Ratios'], ['periods', 'Periods & year-end'], ['cc', 'Cost centres'], ['settings', 'Settings']];
  view.innerHTML = page('Finance', edit() ? '<button class="btn btn-primary" id="nj">＋ Journal</button>' : '<span class="muted">read-only</span>',
    `<div class="tabs" style="flex-wrap:wrap">${tabs.map(([k, l]) => `<a href="#/finance?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="fb"></div>`);
  if ($('#nj')) $('#nj').onclick = () => journalDialog(null, () => { location.hash = '#/finance?tab=journals&_=' + Date.now(); });
  const T = { overview, accounts, journals, recurring, tb, gl, is: incomeStatement, bs: balanceSheet, cf: cashFlow, budgets, ratios, periods, cc: costCentres, settings };
  await (T[tab] || overview)($('#fb'), () => finance(view));
}
const periodBar = (q, extra = '') => `<div class="row wrap no-print" style="margin-bottom:10px"><label>From <input type="date" id="pf" value="${q.from}"></label><label>To <input type="date" id="pt" value="${q.to}"></label>${extra}
  <button class="btn" id="pg">Show</button><span class="spacer"></span>${exportButtons('xp')}</div>`;
const rangeQ = () => { const q = query(); return { ...q, from: q.from || y0(), to: q.to || today() }; };
const go = (tab, extra = {}) => { const p = new URLSearchParams({ tab, from: $('#pf') ? $('#pf').value : '', to: $('#pt') ? $('#pt').value : '', ...extra }); location.hash = '#/finance?' + p.toString(); };
async function ccSelect(sel) { const c = await ccs(); return `<select id="pcc"><option value="">All cost centres</option>${c.map(x => `<option value="${x.id}" ${String(x.id) === String(sel || '') ? 'selected' : ''}>${esc(x.code)} ${esc(x.name)}</option>`).join('')}</select>`; }

/* ---------------- overview & month-end ---------------- */
async function overview(fb) {
  const month = query().month || (() => { const x = new Date(); x.setDate(1); x.setMonth(x.getMonth() - 1); return x.toISOString().slice(0, 7); })();
  const [ck, bs, is, js, yrs] = await Promise.all([GET('/finance/checklist?month=' + month), GET('/finance/balance-sheet?as_of=' + today()), GET(`/finance/income-statement?from=${y0()}&to=${today()}&compare=prior_year`), GET('/finance/journals?status=submitted'), GET('/finance/years')]);
  const line = (sec, code) => ((bs.sections[sec] || { lines: [] }).lines.find(l => l.code === code) || { amount: 0 }).amount;
  const cash = ['1000', '1010', '1020', '1050', '1170'].reduce((s, c) => s + line('ca', c), 0);
  fb.innerHTML = `<div class="cols cols-4" style="margin-bottom:12px"><div class="kpi"><div class="label">Cash & bank</div><div class="value">${money(cash)}</div></div>
      <div class="kpi"><div class="label">Owed to us</div><div class="value">${money(line('ca', '1100'))}</div></div><div class="kpi"><div class="label">We owe suppliers</div><div class="value">${money(line('cl', '2000'))}</div></div>
      <div class="kpi"><div class="label">Profit this year</div><div class="value" style="color:${is.totals.net_profit < 0 ? 'var(--bad)' : 'var(--ok)'}">${neg(is.totals.net_profit)}</div><div class="hint">last year same period ${neg(is.compare_totals.net_profit)}</div></div></div>
    ${js.length ? `<div class="card" style="border-left:4px solid var(--warn,#d97706)"><b>${js.length} journal${js.length === 1 ? '' : 's'} waiting for approval.</b> <a href="#/finance?tab=journals&status=submitted">Review →</a></div>` : ''}
    <div class="card"><div class="row"><h3 style="flex:1">Month-end close – ${esc(month)}</h3><label>Month <input type="month" id="ckm" value="${month}"></label></div>
      <p><b>${ck.done} of ${ck.total}</b> done ${yrs.lock_date ? `· books locked up to <b>${d(yrs.lock_date)}</b>` : '· books not locked'}</p>
      ${tableHtml([{ key: 'ok', label: '', html: 1, fmt: v => v ? '✅' : '⬜' }, { key: 'label', label: 'Step' }, { key: 'detail', label: 'Status' }, { key: 'link', label: '', html: 1, fmt: v => v ? `<a href="${v}">open →</a>` : '' }], ck.items)}
      ${edit() && ck.done >= ck.total - 1 && !(yrs.lock_date >= ck.to) ? `<button class="btn btn-primary" id="lockm">🔒 Lock ${esc(month)}</button>` : ''}</div>`;
  $('#ckm').onchange = e => { location.hash = '#/finance?tab=overview&month=' + e.target.value; };
  if ($('#lockm')) $('#lockm').onclick = async () => { if (!(await confirmBox(`Lock the books up to ${ck.to}? Nothing can be posted on or before that date until it is reopened.`, { okLabel: 'Lock' }))) return; await POST('/finance/lock', { lock_date: ck.to }); toast('Locked'); overview(fb); };
}

/* ---------------- chart of accounts ---------------- */
async function accounts(fb, reload) {
  const x = await GET('/finance/accounts');
  const grouped = x.categories.map(c => ({ ...c, rows: x.accounts.filter(a => a.category === c.key) })).filter(c => c.rows.length);
  fb.innerHTML = `<div class="row" style="margin-bottom:10px"><input id="aq" placeholder="Find an account"><span class="spacer"></span>${exportButtons('xp')}${edit() ? '<button class="btn btn-primary" id="na">＋ Account</button>' : ''}</div>
    <div id="rep">${grouped.map(c => `<div class="card"><h3>${esc(c.name)}</h3>${tableHtml([{ key: 'code', label: 'Code' }, { key: 'name', label: 'Account' }, { key: 'is_control', label: '', html: 1, fmt: (v, a) => `${v ? badge('control', 'partial') : ''} ${a.active ? '' : badge('inactive', 'closed')}` },
      { key: 'cash_flow', label: 'Cash flow' }, { key: 'description', label: 'Notes' }, { key: 'balance', label: 'Balance', right: 1, fmt: neg }], c.rows, { rowAttr: a => `data-a="${a.id}" data-code="${a.code}"` })}</div>`).join('')}</div>`;
  wireExport('xp', '#rep', 'Chart of accounts');
  $('#aq').oninput = e => { const t = e.target.value.toLowerCase(); $$('[data-a]', fb).forEach(tr => { tr.style.display = tr.textContent.toLowerCase().includes(t) ? '' : 'none'; }); };
  const f = a => [...(a ? [] : [{ key: 'code', label: 'Code', required: true }]), { key: 'name', label: 'Name', required: true }, { key: 'category', label: 'Appears in', type: 'select', options: x.categories.map(c => ({ value: c.key, label: c.name })) },
    { key: 'cash_flow', label: 'Cash flow statement', type: 'select', options: [['cash', 'Cash & bank account'], ['operating', 'Operating (working capital)'], ['investing', 'Investing'], ['financing', 'Financing'], ['none', 'Not on the cash flow (income / expense)']].map(([value, label]) => ({ value, label })) },
    { key: 'is_control', label: 'Control account – only its own documents post to it', type: 'checkbox' }, { key: 'description', label: 'Notes', span: 2 }, ...(a ? [{ key: 'active', label: 'Active', type: 'checkbox' }] : [])];
  if ($('#na')) $('#na').onclick = () => modal({ title: 'New account', body: formHtml(f(null), { category: 'operating_expense', cash_flow: 'none' }), actions: [{ label: 'Cancel' }, { label: 'Create', cls: 'btn-primary', onClick: async (c, r) => { await POST('/finance/accounts', readForm(r, f(null))); c(); reload(); } }] });
  $$('[data-a]', fb).forEach(tr => tr.onclick = () => {
    const a = x.accounts.find(z => z.id === Number(tr.dataset.a));
    modal({ title: `${a.code} ${a.name}`, body: `<p>Balance ${neg(a.balance)} · ${a.n_lines} postings · <a href="#/finance?tab=gl&accounts=${a.code}">open the ledger →</a></p>${edit() ? formHtml(f(a), a) : ''}`,
      actions: edit() ? [{ label: 'Close' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { await PUT('/finance/accounts/' + a.id, readForm(r, f(a))); c(); reload(); } }] : [{ label: 'Close' }] });
  });
}

/* ---------------- journals ---------------- */
async function journals(fb, reload) {
  const st = query().status || '';
  const rows = await GET('/finance/journals' + (st ? '?status=' + st : ''));
  fb.innerHTML = `<div class="row wrap" style="margin-bottom:10px">${[['', 'All'], ['draft', 'Drafts'], ['submitted', 'Waiting for approval'], ['posted', 'Posted']].map(([k, l]) => `<a class="btn btn-sm ${k === st ? 'btn-primary' : ''}" href="#/finance?tab=journals&status=${k}">${l}</a>`).join('')}
    <span class="spacer"></span><button class="btn btn-sm" id="ae">🔎 All ledger entries</button></div>
    <div class="card" id="rep">${tableHtml([{ key: 'number', label: 'Journal' }, { key: 'entry_date', label: 'Date', fmt: d }, { key: 'reference', label: 'Reference' }, { key: 'memo', label: 'Narration' }, { key: 'total', label: 'Amount', right: 1, fmt: money },
      { key: 'reverse_on', label: 'Reverses on', fmt: d }, { key: 'created_by_name', label: 'Prepared by' }, { key: 'approved_by_name', label: 'Approved / posted by' }, { key: 'status', label: 'Status', html: 1, fmt: jBadge }], rows, { rowAttr: j => `data-j="${j.id}"`, empty: 'No journals yet.' })}</div>`;
  $('#ae').onclick = () => entriesDialog();
  $$('[data-j]', fb).forEach(tr => tr.onclick = () => journalView(Number(tr.dataset.j), reload));
}
async function journalDialog(j, done) {
  const [a, c] = await Promise.all([accts(), ccs()]);
  const active = a.filter(x => x.active);
  const lines = j ? j.lines.map(l => ({ ...l })) : [{ code: '', debit: '', credit: '', cost_centre_id: '', description: '' }, { code: '', debit: '', credit: '', cost_centre_id: '', description: '' }];
  const accOpt = v => `<option value="">– account –</option>${active.map(x => `<option value="${x.code}" ${x.code === v ? 'selected' : ''}>${esc(x.code)} ${esc(x.name)}${x.is_control ? ' (control)' : ''}</option>`).join('')}`;
  const ccOpt = v => `<option value="">–</option>${c.filter(x => x.active).map(x => `<option value="${x.id}" ${String(x.id) === String(v || '') ? 'selected' : ''}>${esc(x.code)}</option>`).join('')}`;
  const head = [{ key: 'entry_date', label: 'Date', type: 'date' }, { key: 'reference', label: 'Reference' }, { key: 'memo', label: 'Narration (why)', span: 2 }, { key: 'reverse_on', label: 'Reverse automatically on (accruals / prepayments)', type: 'date' }];
  modal({ title: j ? `Edit ${j.number}` : 'New journal', size: 'lg', body: `${formHtml(head, j ? { ...j, entry_date: String(j.entry_date).slice(0, 10), reverse_on: j.reverse_on ? String(j.reverse_on).slice(0, 10) : '' } : { entry_date: today() })}<div id="jl"></div><button class="btn btn-sm" id="addl">＋ Line</button>`,
    onOpen: r => {
      const totals = () => {
        const td = r2(lines.reduce((s, l) => s + Number(l.debit || 0), 0)), tc = r2(lines.reduce((s, l) => s + Number(l.credit || 0), 0));
        r.querySelector('#jbal').innerHTML = td === tc && td > 0 ? '<b style="color:var(--ok)">Balanced ✓</b>' : `<b style="color:var(--bad)">Out of balance by ${money(Math.abs(td - tc))}</b>`;
        r.querySelector('#jtd').textContent = money(td); r.querySelector('#jtc').textContent = money(tc);
      };
      const draw = () => {
        r.querySelector('#jl').innerHTML = `<table class="grid"><thead><tr><th>Account</th><th>Cost centre</th><th>Line note</th><th style="width:120px">Debit</th><th style="width:120px">Credit</th><th></th></tr></thead><tbody>
          ${lines.map((l, i) => `<tr><td><select data-i="${i}" data-k="code">${accOpt(l.code)}</select></td><td><select data-i="${i}" data-k="cost_centre_id">${ccOpt(l.cost_centre_id)}</select></td><td><input data-i="${i}" data-k="description" value="${esc(l.description || '')}"></td>
            <td><input type="number" step="0.01" min="0" data-i="${i}" data-k="debit" value="${l.debit || ''}"></td><td><input type="number" step="0.01" min="0" data-i="${i}" data-k="credit" value="${l.credit || ''}"></td><td><button class="btn btn-sm" data-rm="${i}">✕</button></td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="3" id="jbal"></td><td class="r"><b id="jtd"></b></td><td class="r"><b id="jtc"></b></td><td></td></tr></tfoot></table>`;
        totals();
        // typing changes only the line and the totals; the table is never rebuilt while a field is being left (no redraw on blur)
        $$('[data-k]', r).forEach(el => el.onchange = () => {
          const l = lines[Number(el.dataset.i)]; l[el.dataset.k] = el.value;
          const other = el.dataset.k === 'debit' ? 'credit' : el.dataset.k === 'credit' ? 'debit' : null;
          if (other && el.value) { l[other] = ''; const o = el.closest('tr').querySelector(`[data-k="${other}"]`); if (o) o.value = ''; }
          totals();
        });
        $$('[data-rm]', r).forEach(b => b.onclick = () => { lines.splice(Number(b.dataset.rm), 1); draw(); });
      };
      r.querySelector('#addl').onclick = () => { lines.push({ code: '', debit: '', credit: '', cost_centre_id: '', description: '' }); draw(); };
      draw();
    },
    actions: [{ label: 'Cancel' }, { label: 'Save draft', onClick: async (cl, r) => { const v = { ...readForm(r, head), lines }; const x = j ? await PUT('/finance/journals/' + j.id, v) : await POST('/finance/journals', v); toast('Saved as draft'); cl(); done && done(x.id); } },
      { label: 'Save & post', cls: 'btn-primary', onClick: async (cl, r) => { const v = { ...readForm(r, head), lines }; const x = j ? await PUT('/finance/journals/' + j.id, v) : await POST('/finance/journals', v); const s = await POST(`/finance/journals/${x.id}/submit`); toast(s.status === 'posted' ? 'Posted' : s.message || 'Sent for approval – above the approval limit'); cl(); done && done(x.id); } }] });
}
async function journalView(id, reload) {
  const j = await GET('/finance/journals/' + id);
  const acts = [{ label: 'Close' }];
  if (edit() && ['draft', 'rejected'].includes(j.status)) acts.push({ label: 'Cancel journal', cls: 'btn-danger', onClick: async c => { await POST(`/finance/journals/${id}/cancel`); c(); reload(); } }, { label: 'Edit', onClick: c => { c(); journalDialog(j, reload); } }, { label: 'Post', cls: 'btn-primary', onClick: async c => { const s = await POST(`/finance/journals/${id}/submit`); toast(s.message || s.status); c(); reload(); } });
  if (j.status === 'submitted' && j.created_by !== state.user.id) acts.push({ label: 'Reject', onClick: async c => { await POST(`/finance/journals/${id}/approve`, { reject: true }); c(); reload(); } }, { label: '✔ Approve & post', cls: 'btn-primary', onClick: async c => { const s = await POST(`/finance/journals/${id}/approve`, {}); toast(s.message || 'Posted'); c(); reload(); } });
  if (j.entry_id) acts.splice(1, 0, { label: 'Ledger entry', onClick: c => { c(); entryView(j.entry_id); } });
  modal({ title: `${j.number} – ${(JS[j.status] || [j.status])[0]}`, size: 'lg', body: `<p>${d(j.entry_date)} · ${esc(j.reference || '')} · ${esc(j.memo || '')}${j.reverse_on ? ` · reverses on ${d(j.reverse_on)}` : ''}<br><small class="muted">Prepared by ${esc(j.created_by_name || '')}${j.approved_by_name ? ` · approved by ${esc(j.approved_by_name)}` : ''}${j.note ? ' · ' + esc(j.note) : ''}</small></p>
    ${tableHtml([{ key: 'code', label: 'Account' }, { key: 'description', label: 'Note' }, { key: 'cost_centre_id', label: 'Cost centre', fmt: v => v ? ((CC || []).find(c => c.id === Number(v)) || {}).code || v : '' }, { key: 'debit', label: 'Debit', right: 1, fmt: v => Number(v) ? money(v) : '' }, { key: 'credit', label: 'Credit', right: 1, fmt: v => Number(v) ? money(v) : '' }], j.lines)}`, actions: acts });
}
export async function entryView(id) {
  const e = await GET('/finance/entries/' + id);
  const acts = [{ label: 'Close' }];
  if (edit() && ['manual', 'opening'].includes(e.source_type || 'manual') && !e.reversed_by_id && !e.reverses_id) acts.push({ label: 'Reverse entry', cls: 'btn-danger', onClick: async c => { const f = [{ key: 'date', label: 'Reversal date', type: 'date' }, { key: 'reason', label: 'Reason', span: 2 }];
    c(); modal({ title: 'Reverse the entry', body: formHtml(f, { date: today() }), actions: [{ label: 'Cancel' }, { label: 'Reverse', cls: 'btn-danger', onClick: async (c2, r) => { await POST(`/finance/entries/${id}/reverse`, readForm(r, f)); toast('Reversed'); c2(); } }] }); } });
  if (can('audit')) acts.push({ label: '❓ Audit query', onClick: async c => { c(); (await import('./auditui.js')).queryDialog({ entity: 'journal_entry', entity_id: id, subject: `Journal entry #${id} ${e.reference || ''}` }); } });
  modal({ title: `Ledger entry #${e.id}${e.number ? ' – ' + esc(e.number) : ''}`, size: 'lg', body: `<p>${d(e.entry_date)} · ${esc(e.reference || '')} · ${esc(e.memo || '')}<br><small class="muted">source ${esc(e.source_type || 'manual')}${e.source_id ? ' #' + e.source_id : ''} · by ${esc(e.user_name || 'system')} · captured ${dt(e.created_at)}${e.reverses_id ? ` · reverses #${e.reverses_id}` : ''}${e.reversed_by_id ? ` · reversed by #${e.reversed_by_id}` : ''}${e.hash ? ` · sealed ${esc(e.hash.slice(0, 12))}…` : ''}</small></p>
    ${tableHtml([{ key: 'code', label: 'Account', fmt: (v, l) => `${v} ${l.account_name}` }, { key: 'partner_name', label: 'Customer / supplier' }, { key: 'cost_centre', label: 'CC' }, { key: 'description', label: 'Note' }, { key: 'debit', label: 'Debit', right: 1, fmt: v => Number(v) ? money(v) : '' }, { key: 'credit', label: 'Credit', right: 1, fmt: v => Number(v) ? money(v) : '' }], e.lines)}
    ${e.queries.length ? `<p>Audit queries: ${e.queries.map(q => `${esc(q.subject)} (${esc(q.status)})`).join(', ')}</p>` : ''}`, actions: acts });
}
async function entriesDialog() {
  const rows = await GET('/journal');
  modal({ title: 'Ledger entries (latest 1 000)', size: 'lg', body: tableHtml([{ key: 'id', label: '#' }, { key: 'entry_date', label: 'Date', fmt: d }, { key: 'reference', label: 'Reference' }, { key: 'memo', label: 'Memo' }, { key: 'source_type', label: 'Source' }, { key: 'amount', label: 'Amount', right: 1, fmt: money }, { key: 'user_name', label: 'By' }], rows, { rowAttr: e => `data-e="${e.id}"` }),
    onOpen: r => $$('[data-e]', r).forEach(tr => tr.onclick = () => entryView(Number(tr.dataset.e))), actions: [{ label: 'Close' }] });
}
async function recurring(fb, reload) {
  const rows = await GET('/finance/recurring');
  fb.innerHTML = `<div class="row" style="margin-bottom:10px"><p class="muted" style="flex:1">Journals that repeat – rent, insurance, accruals, loan interest. "Make due journals" creates every one that is due (as drafts, or posted when set to post automatically).</p>${edit() ? '<button class="btn" id="rr">▶ Make due journals</button><button class="btn btn-primary" id="rn">＋ Recurring journal</button>' : ''}</div>
    <div class="card">${tableHtml([{ key: 'name', label: 'Name' }, { key: 'frequency', label: 'Every' }, { key: 'next_date', label: 'Next', fmt: d }, { key: 'end_date', label: 'Until', fmt: d }, { key: 'auto_post', label: 'Posts', fmt: v => v ? 'automatically' : 'as draft' },
      { key: 'lines', label: 'Amount', right: 1, fmt: v => money((typeof v === 'string' ? JSON.parse(v) : v).reduce((s, l) => s + Number(l.debit || 0), 0)) }, { key: 'active', label: '', html: 1, fmt: v => v ? '' : badge('off', 'closed') }], rows, { rowAttr: x => `data-r="${x.id}"`, empty: 'No recurring journals.' })}</div>`;
  if ($('#rr')) $('#rr').onclick = async () => { const x = await POST('/finance/recurring/run'); toast(`${x.made.length} journals made`); reload(); };
  const dlg = async x => {
    const a = (await accts()).filter(z => z.active && !z.is_control);
    const f = [{ key: 'name', label: 'Name', required: true }, { key: 'frequency', label: 'Every', type: 'select', options: ['monthly', 'quarterly', 'yearly'].map(v => ({ value: v, label: v })) }, { key: 'next_date', label: 'Next date', type: 'date' }, { key: 'end_date', label: 'Until (optional)', type: 'date' },
      { key: 'reference', label: 'Reference' }, { key: 'auto_post', label: 'Post automatically (no draft)', type: 'checkbox' }, { key: 'dr', label: 'Debit account', type: 'select', options: a.map(z => ({ value: z.code, label: `${z.code} ${z.name}` })) }, { key: 'cr', label: 'Credit account', type: 'select', options: a.map(z => ({ value: z.code, label: `${z.code} ${z.name}` })) },
      { key: 'amount', label: 'Amount', type: 'number', required: true }, ...(x ? [{ key: 'active', label: 'Active', type: 'checkbox' }] : [])];
    const L = x ? (typeof x.lines === 'string' ? JSON.parse(x.lines) : x.lines) : [];
    modal({ title: x ? x.name : 'New recurring journal', body: formHtml(f, x ? { ...x, next_date: String(x.next_date).slice(0, 10), dr: (L.find(l => Number(l.debit)) || {}).code, cr: (L.find(l => Number(l.credit)) || {}).code, amount: L.reduce((s, l) => s + Number(l.debit || 0), 0) } : { frequency: 'monthly', next_date: today() }),
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { const v = readForm(r, f); v.lines = [{ code: v.dr, debit: v.amount }, { code: v.cr, credit: v.amount }]; if (x) await PUT('/finance/recurring/' + x.id, v); else await POST('/finance/recurring', v); c(); reload(); } }] });
  };
  if ($('#rn')) $('#rn').onclick = () => dlg(null);
  $$('[data-r]', fb).forEach(tr => tr.onclick = () => edit() && dlg(rows.find(x => x.id === Number(tr.dataset.r))));
}

/* ---------------- reports ---------------- */
async function tb(fb) {
  const q = rangeQ();
  const x = await GET(`/finance/tb?from=${q.from}&to=${q.to}${q.cost_centre_id ? '&cost_centre_id=' + q.cost_centre_id : ''}`);
  fb.innerHTML = `${periodBar(q, await ccSelect(q.cost_centre_id))}<div class="card" id="rep"><h3>Trial balance ${esc(x.from)} to ${esc(x.to)} ${x.balanced ? badge('balanced', 'ok') : badge('OUT OF BALANCE', 'cancelled')}</h3>
    ${tableHtml([{ key: 'code', label: 'Code' }, { key: 'name', label: 'Account' }, { key: 'opening', label: 'Opening', right: 1, fmt: neg }, { key: 'debit', label: 'Debits', right: 1, fmt: money }, { key: 'credit', label: 'Credits', right: 1, fmt: money }, { key: 'closing_dr', label: 'Closing Dr', right: 1, fmt: v => v ? money(v) : '' }, { key: 'closing_cr', label: 'Closing Cr', right: 1, fmt: v => v ? money(v) : '' }],
      [...x.rows, { code: '', name: 'Total', opening: x.totals.opening, debit: x.totals.debit, credit: x.totals.credit, closing_dr: x.totals.closing_dr, closing_cr: x.totals.closing_cr }], { rowAttr: r => r.code ? `data-code="${r.code}"` : 'class="tot"' })}</div>`;
  $('#pg').onclick = () => go('tb', { cost_centre_id: $('#pcc').value });
  wireExport('xp', '#rep', `Trial balance ${x.from} to ${x.to}`);
  $$('[data-code]', fb).forEach(tr => tr.onclick = () => { location.hash = `#/finance?tab=gl&from=${q.from}&to=${q.to}&accounts=${tr.dataset.code}`; });
}
async function gl(fb) {
  const q = rangeQ(); const a = await accts();
  const sel = q.accounts || '';
  const x = sel ? await GET(`/finance/gl?from=${q.from}&to=${q.to}&accounts=${encodeURIComponent(sel)}${q.cost_centre_id ? '&cost_centre_id=' + q.cost_centre_id : ''}`) : { accounts: [] };
  fb.innerHTML = `${periodBar(q, `<select id="pa"><option value="">– choose an account –</option>${a.map(z => `<option value="${z.code}" ${z.code === sel ? 'selected' : ''}>${esc(z.code)} ${esc(z.name)}</option>`).join('')}</select>${await ccSelect(q.cost_centre_id)}`)}
    <div id="rep">${x.accounts.map(acc => `<div class="card"><h3>${esc(acc.code)} ${esc(acc.name)}</h3><p>Opening ${neg(acc.opening)} · debits ${money(acc.debit)} · credits ${money(acc.credit)} · closing <b>${neg(acc.closing)}</b></p>
      ${tableHtml([{ key: 'entry_date', label: 'Date', fmt: d }, { key: 'number', label: 'Entry', fmt: (v, t) => v || '#' + t.entry_id }, { key: 'reference', label: 'Reference' }, { key: 'memo', label: 'Narration', fmt: (v, t) => [v, t.description].filter(Boolean).join(' – ') }, { key: 'partner', label: 'Customer / supplier' },
        { key: 'cost_centre', label: 'CC' }, { key: 'debit', label: 'Debit', right: 1, fmt: v => Number(v) ? money(v) : '' }, { key: 'credit', label: 'Credit', right: 1, fmt: v => Number(v) ? money(v) : '' }, { key: 'balance', label: 'Balance', right: 1, fmt: neg }], acc.transactions, { rowAttr: t => `data-e="${t.entry_id}"`, empty: 'No movements in this period.' })}</div>`).join('') || '<div class="card"><div class="empty">Choose an account (or click one in the trial balance).</div></div>'}</div>`;
  $('#pg').onclick = () => go('gl', { accounts: $('#pa').value, cost_centre_id: $('#pcc').value });
  $('#pa').onchange = () => go('gl', { accounts: $('#pa').value, cost_centre_id: $('#pcc').value });
  wireExport('xp', '#rep', `General ledger ${sel} ${q.from} to ${q.to}`);
  $$('[data-e]', fb).forEach(tr => tr.onclick = () => entryView(Number(tr.dataset.e)));
}
function statementTable(sections, totals, cmpTotals, budTotals, labels, showCmp, showBud) {
  const colh = `<tr><th></th><th class="r">${esc(labels.cur)}</th>${showCmp ? `<th class="r">${esc(labels.cmp)}</th>` : ''}${showBud ? '<th class="r">Budget</th><th class="r">Variance</th>' : ''}</tr>`;
  const row = (name, v, c, b, cls = '', indent = 0) => `<tr class="${cls}"><td style="padding-left:${8 + indent * 16}px">${esc(name)}</td><td class="r">${neg(v)}</td>${showCmp ? `<td class="r">${neg(c)}</td>` : ''}${showBud ? `<td class="r">${b === null || b === undefined ? '' : neg(b)}</td><td class="r">${b === null || b === undefined ? '' : neg(r2(v - b))}</td>` : ''}</tr>`;
  const sec = k => { const s = sections.find(x => x.key === k); if (!s || !s.lines.length) return ''; return `<tr><td colspan="5"><b>${esc(s.name)}</b></td></tr>${s.lines.map(l => row(`${l.code} ${l.name}`, l.amount, l.compare, l.budget, '', 1)).join('')}${row(`Total ${s.name.toLowerCase()}`, s.total, s.compare, s.budget, 'tot')}`; };
  const T = (k, name) => row(name, totals[k], cmpTotals ? cmpTotals[k] : 0, budTotals ? budTotals[k] : null, 'tot');
  return `<table class="grid report-table"><thead>${colh}</thead><tbody>${sec('revenue')}${sec('cost_of_sales')}${T('gross_profit', 'Gross profit')}${sec('other_income')}${sec('operating_expense')}${T('operating_profit', 'Operating profit')}${sec('finance_cost')}${T('profit_before_tax', 'Profit before tax')}${sec('tax_expense')}${T('net_profit', 'Profit for the period')}</tbody></table>`;
}
async function incomeStatement(fb) {
  const q = rangeQ(); const cmp = q.compare || 'prior_year';
  const [bud, yrs] = await Promise.all([GET('/finance/budgets'), GET('/finance/years')]);
  if (q.view === 'monthly') {
    const yid = q.year_id || (yrs.years.find(y => String(y.start_date).slice(0, 10) <= today() && String(y.end_date).slice(0, 10) >= today()) || yrs.years[0] || {}).id;
    const m = await GET(`/finance/income-monthly?year_id=${yid}${q.cost_centre_id ? '&cost_centre_id=' + q.cost_centre_id : ''}`);
    fb.innerHTML = `<div class="row wrap no-print" style="margin-bottom:10px"><select id="py">${yrs.years.map(y => `<option value="${y.id}" ${y.id === Number(yid) ? 'selected' : ''}>${esc(y.name)}</option>`).join('')}</select>${await ccSelect(q.cost_centre_id)}<a class="btn" href="#/finance?tab=is">Period view</a><span class="spacer"></span>${exportButtons('xp')}</div>
      <div class="card" id="rep" style="overflow:auto"><h3>Income statement by month – ${esc(m.year)}</h3><table class="grid"><thead><tr><th>Account</th>${m.months.map(x => `<th class="r">${x}</th>`).join('')}<th class="r">Total</th></tr></thead><tbody>
      ${m.rows.map(r => `<tr><td>${esc(r.code)} ${esc(r.name)}</td>${r.values.map(v => `<td class="r">${v ? money(v) : ''}</td>`).join('')}<td class="r"><b>${money(r.values.reduce((a, b) => a + b, 0))}</b></td></tr>`).join('')}
      <tr class="tot"><td>Profit</td>${m.net_profit.map(v => `<td class="r">${neg(v)}</td>`).join('')}<td class="r">${neg(m.net_profit.reduce((a, b) => a + b, 0))}</td></tr></tbody></table></div>`;
    const reGo = () => { location.hash = `#/finance?tab=is&view=monthly&year_id=${$('#py').value}&cost_centre_id=${$('#pcc').value}`; };
    $('#py').onchange = reGo; $('#pcc').onchange = reGo; wireExport('xp', '#rep', `Income statement by month ${m.year}`); return;
  }
  const x = await GET(`/finance/income-statement?from=${q.from}&to=${q.to}&compare=${cmp}${q.cost_centre_id ? '&cost_centre_id=' + q.cost_centre_id : ''}${q.budget_id ? '&budget_id=' + q.budget_id : ''}`);
  fb.innerHTML = `${periodBar(q, `<select id="pc">${[['prior_year', 'vs last year'], ['prior_period', 'vs previous period'], ['none', 'no comparison']].map(([k, l]) => `<option value="${k}" ${k === cmp ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select id="pb"><option value="">no budget</option>${bud.map(b => `<option value="${b.id}" ${String(b.id) === q.budget_id ? 'selected' : ''}>${esc(b.name)} (${esc(b.year_name)})</option>`).join('')}</select>${await ccSelect(q.cost_centre_id)}<a class="btn" href="#/finance?tab=is&view=monthly">By month</a>`)}
    <div class="card" id="rep"><h3>Income statement ${esc(x.from)} to ${esc(x.to)}${x.cost_centre_id ? ' – ' + esc(((CC || []).find(c => c.id === Number(x.cost_centre_id)) || {}).name || '') : ''}</h3>
      ${statementTable(x.sections, x.totals, x.compare_totals, x.budget_totals, { cur: `${x.from} – ${x.to}`, cmp: x.compare_from ? `${x.compare_from} – ${x.compare_to}` : '' }, cmp !== 'none', !!x.budget_totals)}</div>`;
  $('#pg').onclick = () => go('is', { compare: $('#pc').value, budget_id: $('#pb').value, cost_centre_id: $('#pcc').value });
  wireExport('xp', '#rep', `Income statement ${x.from} to ${x.to}`);
}
async function balanceSheet(fb) {
  const q = query(); const asOf = q.as_of || today(), cmp = q.compare_as_of || `${Number(asOf.slice(0, 4)) - 1}${asOf.slice(4)}`;
  const x = await GET(`/finance/balance-sheet?as_of=${asOf}&compare_as_of=${cmp}`);
  const S = x.sections;
  const sec = s => !s.lines.length ? '' : `<tr><td colspan="3"><b>${esc(s.name)}</b></td></tr>${s.lines.map(l => `<tr><td style="padding-left:24px">${esc(l.code)} ${esc(l.name)}</td><td class="r">${neg(l.amount)}</td><td class="r">${neg(l.compare)}</td></tr>`).join('')}<tr class="tot"><td>Total ${esc(s.name.toLowerCase())}</td><td class="r">${neg(s.total)}</td><td class="r">${neg(s.compare)}</td></tr>`;
  fb.innerHTML = `<div class="row wrap no-print" style="margin-bottom:10px"><label>As at <input type="date" id="pa" value="${asOf}"></label><label>Compare with <input type="date" id="pc" value="${cmp}"></label><button class="btn" id="pg">Show</button><span class="spacer"></span>${exportButtons('xp')}</div>
    <div class="card" id="rep"><h3>Statement of financial position as at ${esc(asOf)} ${x.balanced ? '' : badge('does not balance', 'cancelled')}</h3><table class="grid report-table"><thead><tr><th></th><th class="r">${esc(asOf)}</th><th class="r">${esc(cmp)}</th></tr></thead><tbody>
      <tr><td colspan="3"><h4 style="margin:6px 0">Assets</h4></td></tr>${sec(S.nca)}${sec(S.ca)}<tr class="tot"><td>TOTAL ASSETS</td><td class="r">${money(x.total_assets)}</td><td class="r">${money(x.compare_total_assets)}</td></tr>
      <tr><td colspan="3"><h4 style="margin:6px 0">Equity and liabilities</h4></td></tr>${sec(S.equity)}${sec(S.ncl)}${sec(S.cl)}<tr class="tot"><td>TOTAL EQUITY AND LIABILITIES</td><td class="r">${money(x.total_equity_liabilities)}</td><td class="r">${money(x.compare_total_equity_liabilities)}</td></tr></tbody></table></div>`;
  $('#pg').onclick = () => { location.hash = `#/finance?tab=bs&as_of=${$('#pa').value}&compare_as_of=${$('#pc').value}`; };
  wireExport('xp', '#rep', `Balance sheet ${asOf}`);
}
async function cashFlow(fb) {
  const q = rangeQ(); const x = await GET(`/finance/cash-flow?from=${q.from}&to=${q.to}`);
  const sec = (name, rows, tot) => `<tr><td colspan="2"><b>${esc(name)}</b></td></tr>${rows.map(l => `<tr><td style="padding-left:24px">${esc(l.name)}</td><td class="r">${neg(l.amount)}</td></tr>`).join('')}<tr class="tot"><td>Net cash from ${esc(name.toLowerCase())}</td><td class="r">${neg(tot)}</td></tr>`;
  fb.innerHTML = `${periodBar(q)}<div class="card" id="rep"><h3>Statement of cash flows ${esc(x.from)} to ${esc(x.to)} (indirect method)</h3><table class="grid report-table"><tbody>
    ${sec('Operating activities', x.operating, x.net_operating)}${sec('Investing activities', x.investing, x.net_investing)}${sec('Financing activities', x.financing, x.net_financing)}
    <tr class="tot"><td>Net change in cash</td><td class="r">${neg(x.net_change)}</td></tr><tr><td>Cash at the start</td><td class="r">${money(x.cash_open)}</td></tr><tr class="tot"><td>Cash at the end</td><td class="r">${money(x.cash_close)}</td></tr></tbody></table>
    ${Math.abs(x.difference) >= 0.01 ? `<p class="help-note">Difference of ${money(x.difference)} – check the cash-flow class of each account in the chart of accounts.</p>` : '<p class="muted">Reconciles to the cash accounts ✓</p>'}<p class="muted">Cash accounts: ${esc(x.cash_accounts.join(', '))}</p></div>`;
  $('#pg').onclick = () => go('cf');
  wireExport('xp', '#rep', `Cash flow ${x.from} to ${x.to}`);
}
async function ratios(fb) {
  const q = query(); const x = await GET(`/finance/ratios?as_of=${q.as_of || today()}${q.from ? '&from=' + q.from : ''}`);
  const R = [['Current ratio', x.current_ratio, 'current assets ÷ current liabilities – above 1.5 is comfortable'], ['Quick ratio', x.quick_ratio, 'without stock – above 1 is comfortable'], ['Gross margin', x.gross_margin_pct === null ? null : x.gross_margin_pct + '%', 'gross profit ÷ revenue'],
    ['Net margin', x.net_margin_pct === null ? null : x.net_margin_pct + '%', 'profit ÷ revenue'], ['Debtor days', x.debtor_days, 'how long customers take to pay'], ['Creditor days', x.creditor_days, 'how long we take to pay suppliers'], ['Stock days', x.stock_days, 'how long stock sits before it is sold'],
    ['Debt to equity', x.debt_to_equity, 'liabilities ÷ equity'], ['Return on assets', x.return_on_assets_pct === null ? null : x.return_on_assets_pct + '%', 'profit ÷ total assets']];
  fb.innerHTML = `<div class="row no-print" style="margin-bottom:10px"><span class="muted">From ${esc(x.from)} to ${esc(x.as_of)}</span><span class="spacer"></span>${exportButtons('xp')}</div><div class="card" id="rep"><h3>Financial ratios</h3>${tableHtml([{ key: 0, label: 'Ratio' }, { key: 1, label: 'Value', right: 1, fmt: v => v === null || v === undefined ? '–' : v }, { key: 2, label: 'What it means' }], R)}</div>`;
  wireExport('xp', '#rep', 'Financial ratios');
}
async function budgets(fb, reload) {
  const q = query();
  if (q.budget) return budgetGrid(fb, Number(q.budget));
  const [rows, yrs] = await Promise.all([GET('/finance/budgets'), GET('/finance/years')]);
  fb.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="spacer"></span>${edit() ? '<button class="btn btn-primary" id="bn">＋ Budget</button>' : ''}</div>
    <div class="card">${tableHtml([{ key: 'name', label: 'Budget' }, { key: 'year_name', label: 'Year' }, { key: 'total', label: 'Total (income + expenses)', right: 1, fmt: money }, { key: 'status', label: 'Status', html: 1, fmt: v => v === 'approved' ? badge('approved', 'ok') : badge('draft', 'draft') }], rows, { rowAttr: b => `data-b="${b.id}"`, empty: 'No budgets yet.' })}
    <p class="muted">Compare actuals with a budget in the income statement (choose the budget there).</p></div>`;
  if ($('#bn')) $('#bn').onclick = () => { const f = [{ key: 'fin_year_id', label: 'Financial year', type: 'select', options: yrs.years.map(y => ({ value: y.id, label: y.name })) }, { key: 'name', label: 'Name' }, { key: 'from_actuals', label: 'Start from last year\'s actual figures', type: 'checkbox' }, { key: 'uplift_pct', label: '… plus this % increase', type: 'number' }];
    modal({ title: 'New budget', body: formHtml(f, { from_actuals: 1, uplift_pct: 6 }), actions: [{ label: 'Cancel' }, { label: 'Create', cls: 'btn-primary', onClick: async (c, r) => { const x = await POST('/finance/budgets', readForm(r, f)); c(); location.hash = '#/finance?tab=budgets&budget=' + x.id; } }] }); };
  $$('[data-b]', fb).forEach(tr => tr.onclick = () => { location.hash = '#/finance?tab=budgets&budget=' + tr.dataset.b; });
}
async function budgetGrid(fb, id) {
  const [b, a] = await Promise.all([GET('/finance/budgets/' + id), accts()]);
  const ie = a.filter(x => ['income', 'expense'].includes(x.type) && x.active);
  const months = []; const s = new Date(String(b.start_date).slice(0, 10) + 'T12:00:00Z'); for (let i = 0; i < 12; i++) { const m = new Date(s); m.setUTCMonth(s.getUTCMonth() + i); months.push(m.toISOString().slice(0, 7)); }
  const val = (aid, p) => (b.lines.find(l => l.account_id === aid && l.period === p && !l.cost_centre_id) || {}).amount || '';
  const ro = b.status === 'approved' || !edit();
  fb.innerHTML = `<div class="row" style="margin-bottom:10px"><a class="btn" href="#/finance?tab=budgets">← Budgets</a><h3 style="margin:0 10px;flex:1">${esc(b.name)} – ${esc(b.year_name)} ${b.status === 'approved' ? badge('approved', 'ok') : ''}</h3>${exportButtons('xp')}${ro ? '' : '<button class="btn" id="bsv">Save</button><button class="btn btn-primary" id="bap">Approve</button>'}</div>
    <div class="card" id="rep" style="overflow:auto"><table class="grid"><thead><tr><th>Account</th>${months.map(m => `<th class="r">${m}</th>`).join('')}<th class="r">Year</th></tr></thead><tbody>
    ${ie.map(x => `<tr data-acc="${x.id}"><td style="white-space:nowrap">${esc(x.code)} ${esc(x.name)}</td>${months.map((m, i) => `<td><input type="number" step="1" data-p="${i + 1}" value="${val(x.id, i + 1)}" style="width:80px" ${ro ? 'disabled' : ''}></td>`).join('')}<td class="r" data-sum></td></tr>`).join('')}</tbody></table></div>`;
  const sums = () => $$('[data-acc]', fb).forEach(tr => { tr.querySelector('[data-sum]').textContent = money($$('[data-p]', tr).reduce((t, i) => t + Number(i.value || 0), 0)); });
  sums(); fb.oninput = sums;
  wireExport('xp', '#rep', `${b.name} ${b.year_name}`);
  const save = async () => PUT(`/finance/budgets/${id}/lines`, { rows: $$('[data-acc]', fb).map(tr => ({ account_id: Number(tr.dataset.acc), amounts: $$('[data-p]', tr).map(i => Number(i.value || 0)) })) });
  if ($('#bsv')) $('#bsv').onclick = async () => { try { await save(); toast('Budget saved'); } catch (e) { err(e); } };
  if ($('#bap')) $('#bap').onclick = async () => { try { await save(); const s = await POST(`/finance/budgets/${id}/approve`); toast(s.message || 'Approved'); budgetGrid(fb, id); } catch (e) { err(e); } };
}
async function periods(fb, reload) {
  const x = await GET('/finance/years');
  fb.innerHTML = `<div class="card"><h3>Period lock</h3><p>The books are ${x.lock_date ? `locked up to <b>${d(x.lock_date)}</b> – nothing can be posted on or before that date by any module` : '<b>not locked</b>'}.</p>
      ${edit() ? `<div class="row"><label>Lock up to <input type="date" id="ld" value="${x.lock_date || ''}"></label><button class="btn btn-primary" id="lk">Set lock</button>${x.lock_date ? '<button class="btn" id="ul">Unlock</button>' : ''}</div>` : ''}</div>
    <div class="card"><h3>Financial years</h3>${tableHtml([{ key: 'name', label: 'Year' }, { key: 'start_date', label: 'From', fmt: d }, { key: 'end_date', label: 'To', fmt: d }, { key: 'status', label: 'Status', html: 1, fmt: (v, y) => v === 'closed' ? `${badge('closed', 'closed')} <small class="muted">${esc(y.closed_by_name || '')} ${d(y.closed_at)}</small>` : badge('open', 'ok') },
      { key: 'id', label: '', html: 1, fmt: (v, y) => can('finance.close') ? (y.status === 'open' && String(y.end_date).slice(0, 10) < today() ? `<button class="btn btn-sm btn-primary" data-close="${v}">Year-end close</button>` : y.status === 'closed' && can('settings') ? `<button class="btn btn-sm" data-reopen="${v}">Reopen</button>` : '') : '' }], x.years)}
      <p class="muted">Year-end close moves the year's income and expenses into retained earnings (3100) with a closing entry and locks the year. The income statement for a closed year still shows its figures.</p></div>`;
  if ($('#lk')) $('#lk').onclick = async () => { try { await POST('/finance/lock', { lock_date: $('#ld').value }); toast('Locked'); reload(); } catch (e) { err(e); } };
  if ($('#ul')) $('#ul').onclick = async () => { try { await POST('/finance/lock', { lock_date: null }); toast('Unlocked'); reload(); } catch (e) { err(e); } };
  $$('[data-close]', fb).forEach(b => b.onclick = async () => { if (!(await confirmBox('Close this financial year? Income and expenses are closed to retained earnings and the year is locked.', { okLabel: 'Close the year' }))) return; try { const r = await POST(`/finance/years/${b.dataset.close}/close`); toast(`Closed – profit ${money(r.profit)} to retained earnings`); reload(); } catch (e) { err(e); } });
  $$('[data-reopen]', fb).forEach(b => b.onclick = async () => { if (!(await confirmBox('Reopen this year? The closing entry is reversed and the year can be posted to again.', { danger: true, okLabel: 'Reopen' }))) return; try { await POST(`/finance/years/${b.dataset.reopen}/reopen`); reload(); } catch (e) { err(e); } });
}
async function costCentres(fb, reload) {
  const rows = await GET('/finance/cost-centres');
  fb.innerHTML = `<div class="row" style="margin-bottom:10px"><p class="muted" style="flex:1">Departments, projects, branches or donor funds. Tag journal lines with a cost centre and run the income statement or ledger for one cost centre.</p>${edit() ? '<button class="btn btn-primary" id="cn">＋ Cost centre</button>' : ''}</div>
    <div class="card">${tableHtml([{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'kind', label: 'Kind' }, { key: 'manager', label: 'Manager' }, { key: 'active', label: '', html: 1, fmt: v => v ? '' : badge('off', 'closed') }, { key: 'id', label: '', html: 1, fmt: v => `<a href="#/finance?tab=is&cost_centre_id=${v}">income statement →</a>` }], rows, { rowAttr: c => `data-c="${c.id}"`, empty: 'No cost centres yet.' })}</div>`;
  const f = x => [{ key: 'code', label: 'Code', required: true }, { key: 'name', label: 'Name', required: true }, { key: 'kind', label: 'Kind', type: 'select', options: ['department', 'project', 'branch', 'fund', 'other'].map(v => ({ value: v, label: v })) }, { key: 'manager', label: 'Manager' }, ...(x ? [{ key: 'active', label: 'Active', type: 'checkbox' }] : [])];
  const dlg = x => modal({ title: x ? x.name : 'New cost centre', body: formHtml(f(x), x || { kind: 'department' }), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: async (c, r) => { if (x) await PUT('/finance/cost-centres/' + x.id, readForm(r, f(x))); else await POST('/finance/cost-centres', readForm(r, f(x))); c(); reload(); } }] });
  if ($('#cn')) $('#cn').onclick = () => dlg(null);
  $$('[data-c]', fb).forEach(tr => tr.onclick = e => { if (e.target.tagName !== 'A' && edit()) dlg(rows.find(x => x.id === Number(tr.dataset.c))); });
}
async function settings(fb) {
  const s = await GET('/finance/settings');
  const f = [{ key: 'year_end_month', label: 'Financial year ends in month (1–12)', type: 'number' }, { key: 'manual_approval_limit', label: 'Manual journals from this amount need a second person to approve (0 = never)', type: 'number' },
    { key: 'allow_control_manual', label: 'Allow manual journals to control accounts (not advised)', type: 'checkbox' }, { key: 'backdate_days', label: 'Audit: flag entries back-dated more than … days', type: 'number' }, { key: 'large_cash', label: 'Audit: flag cash payments from', type: 'number' }];
  fb.innerHTML = `<div class="card">${formHtml(f, s)}${edit() ? '<div class="row"><span class="spacer"></span><button class="btn btn-primary" id="fs">Save</button></div>' : ''}</div>`;
  if ($('#fs')) $('#fs').onclick = async () => { try { await PUT('/finance/settings', readForm(fb, f)); toast('Saved'); } catch (e) { err(e); } };
}
