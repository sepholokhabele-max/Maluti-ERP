// Finance screens: bank / M-Pesa reconciliation, expense claims, approvals inbox
import { state, GET, POST, PUT, DEL, esc, $, $$, toast, err, can, money, qty, modal, confirmBox, promptBox, formHtml, readForm, tableHtml, badge, page, d, dt, today, query, round2, imageFileToDataUrl } from './core.js';

const ACCOUNTS = [['1050', 'Bank account'], ['1020', 'Mobile money wallet (M-Pesa / EcoCash)'], ['1010', 'Card clearing'], ['1000', 'Cash on hand']];
const COUNTER = [['6400', 'Bank / M-Pesa charges'], ['4300', 'Interest received'], ['1000', 'Cash deposited from the till (or cash withdrawn)'], ['1010', 'Card settlement from the bank'],
  ['1020', 'Transfer to/from mobile money'], ['1050', 'Transfer to/from bank'], ['1100', 'Payment from a customer (on account)'], ['2000', 'Payment to a supplier'],
  ['2200', 'PAYE paid to RSL'], ['2300', 'Salaries paid'], ['2100', 'VAT paid to RSL'], ['3000', 'Owner put in / took out money'], ['6100', 'Rent'], ['6300', 'Utilities (LEC, WASCO)'], ['6000', 'Other expense'], ['4200', 'Other income']];

// ---------------------------------------------------------------- CSV parsing (bank exports vary)
function splitCsv(text) {
  const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : (text.includes('\t') ? '\t' : ',');
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === sep) { row.push(cur.trim()); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur.trim()); cur = ''; if (row.some(c => c !== '')) rows.push(row); row = []; }
    else cur += ch;
  }
  row.push(cur.trim()); if (row.some(c => c !== '')) rows.push(row);
  return rows;
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function parseDate(s) {
  s = String(s || '').trim(); let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; } // day first (Lesotho / SA banks)
  if ((m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-,]*(\d{2,4})/))) { const mo = MONTHS[m[2].toLowerCase()]; if (mo) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}`; } }
  return null;
}
export function parseAmount(s) {
  if (s == null || s === '') return 0;
  let t = String(s).replace(/[^\d,.\-()]/g, '');
  const neg = /^\(.*\)$/.test(t) || /-/.test(t); t = t.replace(/[()\-]/g, '');
  if (/,\d{2}$/.test(t) && !/\.\d{2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.'); else t = t.replace(/,/g, '');
  const n = Number(t); return isFinite(n) ? (neg ? -n : n) : 0;
}

// ---------------------------------------------------------------- bank reconciliation
export async function bank(view, [id]) {
  if (id) return statementPage(view, id);
  const rows = await GET('/bank-statements');
  view.innerHTML = page('Bank & M-Pesa reconciliation', `<a class="btn" href="#/accounting">Accounting</a><button class="btn btn-primary" id="imp">⬆ Import statement</button>`, `
    <p class="muted" style="margin-top:0">Import the statement from your bank (Standard Lesotho Bank, FNB, Nedbank, PostBank) or your M-Pesa / EcoCash merchant statement as CSV.
    Lines that match sales, payments and expenses already in the books are ticked off automatically; for the rest you choose what they are (bank charges, a cash deposit, a customer payment…).</p>
    ${tableHtml([{ key: 'name', label: 'Statement' }, { key: 'account_name', label: 'Account' }, { key: 'date_from', label: 'From', fmt: d }, { key: 'date_to', label: 'To', fmt: d },
      { key: 'line_count', label: 'Lines', right: 1 }, { key: 'matched', label: 'Matched', right: 1, html: 1, fmt: (v, r) => `<b style="color:${Number(v) === Number(r.line_count) ? 'var(--ok)' : 'var(--warn)'}">${v} / ${r.line_count}</b>` },
      { key: 'status', label: 'Status', html: 1, fmt: v => badge(v === 'done' ? 'reconciled' : 'open', v === 'done' ? 'paid' : 'draft') }], rows, { rowAttr: r => `data-href="#/bank/${r.id}"`, empty: 'No statements imported yet.' })}`);
  $$('[data-href]').forEach(tr => tr.onclick = () => location.hash = tr.dataset.href);
  $('#imp').onclick = () => importDialog();
}

function importDialog() {
  let rows = [], map = {}, build = () => [];
  modal({ title: 'Import a statement', wide: true, body: `${formHtml([
      { key: 'account_code', label: 'Statement for', type: 'select', options: ACCOUNTS.map(([v, l]) => ({ value: v, label: `${v} ${l}` })) },
      { key: 'name', label: 'Name', placeholder: 'e.g. SLB current account October' },
      { key: 'opening_balance', label: 'Opening balance on the statement', type: 'number', step: '0.01' }, { key: 'closing_balance', label: 'Closing balance on the statement', type: 'number', step: '0.01' }], {}, { ctx: 'statement' })}
    <div class="field" style="margin-top:12px"><span>Statement file (CSV) – or paste it below</span><input type="file" id="sf" accept=".csv,.txt,text/csv"><textarea id="st" rows="5" placeholder="Date,Description,Reference,Amount&#10;01/10/2026,Card settlement,,1520.50"></textarea>
      <small class="help-note">In internet banking choose "Export / Download → CSV". Money in should be positive and money out negative, or in separate Debit / Credit columns – you match the columns below.</small></div>
    <div id="sm" style="margin-top:12px"></div>`, actions: [{ label: 'Cancel' }, { label: 'Import & match', cls: 'btn-primary', onClick: async (c, r) => {
      const v = readForm(r, [{ key: 'account_code' }, { key: 'name' }, { key: 'opening_balance' }, { key: 'closing_balance' }]);
      const lines = build();
      if (!lines.length) throw new Error('No lines with a date and amount – check the column choices');
      const s = await POST('/bank-statements', { ...v, lines }); c(); toast(`${s.lines.length} lines imported, ${s.matched} matched automatically`); location.hash = '#/bank/' + s.id;
    } }], onOpen: r => {
      const guess = hdr => {
        const h = hdr.map(x => x.toLowerCase()), f = (...ws) => h.findIndex(x => ws.some(w => x.includes(w)));
        return { date: Math.max(0, f('date', 'datum')), description: f('desc', 'narrat', 'details', 'particular', 'transaction'), reference: f('ref', 'receipt', 'id'),
          amount: f('amount', 'value'), debit: f('debit', 'withdraw', 'paid out', 'money out'), credit: f('credit', 'deposit', 'paid in', 'money in'), header: 1 };
      };
      const draw = () => {
        if (!rows.length) { r.querySelector('#sm').innerHTML = ''; return; }
        const cols = rows[0].map((h, i) => ({ value: i, label: `${i + 1}: ${h || '(column ' + (i + 1) + ')'}` }));
        const sel = (k, l, opt) => `<label class="field"><span>${l}</span><select data-map="${k}">${opt ? '<option value="-1">— none —</option>' : ''}${cols.map(c => `<option value="${c.value}" ${map[k] === c.value ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>`;
        const prev = build().slice(0, 6);
        r.querySelector('#sm').innerHTML = `<div class="form-grid">${sel('date', 'Date column')}${sel('description', 'Description column', 1)}${sel('reference', 'Reference column', 1)}${sel('amount', 'Amount column (+ in / − out)', 1)}${sel('debit', 'or: money OUT column', 1)}${sel('credit', 'and: money IN column', 1)}
          <label class="field check"><input type="checkbox" id="hdr" ${map.header ? 'checked' : ''}> <span>First row is a header</span></label></div>
          <h4 style="margin:10px 0 4px">Preview (${build().length} lines)</h4>${tableHtml([{ key: 'date', label: 'Date' }, { key: 'description', label: 'Description' }, { key: 'reference', label: 'Ref' }, { key: 'amount', label: 'Amount', right: 1, fmt: money }], prev, { empty: 'Nothing recognised yet' })}`;
        $$('[data-map]', r).forEach(s => s.onchange = () => { map[s.dataset.map] = Number(s.value); draw(); });
        r.querySelector('#hdr').onchange = e => { map.header = e.target.checked ? 1 : 0; draw(); };
      };
      const load = text => { rows = splitCsv(text); map = guess(rows[0] || []); draw(); };
      r.querySelector('#sf').onchange = e => { const f = e.target.files[0]; if (!f) return; const fr = new FileReader(); fr.onload = () => { r.querySelector('#st').value = fr.result; load(fr.result); }; fr.readAsText(f); };
      r.querySelector('#st').oninput = e => load(e.target.value);
      build = () => rows.slice(map.header ? 1 : 0).map(row => {
        const g = k => (map[k] >= 0 ? row[map[k]] : '') || '';
        const amount = map.amount >= 0 ? parseAmount(g('amount')) : round2(parseAmount(g('credit')) - Math.abs(parseAmount(g('debit'))));
        return { date: parseDate(g('date')), description: g('description'), reference: g('reference'), amount: round2(amount) };
      }).filter(x => x.date && x.amount);
    } });
}

async function statementPage(view, id) {
  const [s, customers, suppliers] = await Promise.all([GET('/bank-statements/' + id), GET('/partners?is_customer=1'), GET('/partners?is_supplier=1')]);
  const open = s.status !== 'done';
  const diff = s.closing_balance != null ? round2(Number(s.closing_balance) - s.book_balance) : null;
  view.innerHTML = page(s.name, `<a class="btn" href="#/bank">All statements</a>${open ? '<button class="btn" id="auto">↻ Match again</button><button class="btn btn-ok" id="done">✓ Finish reconciliation</button><button class="btn btn-danger" id="del">Delete</button>' : badge('reconciled', 'paid')}`, `
    <div class="cols cols-4" style="margin-bottom:12px">
      <div class="kpi"><div class="label">Matched</div><div class="value" style="color:${s.matched === s.lines.length ? 'var(--ok)' : 'var(--warn)'}">${s.matched} / ${s.lines.length}</div><div class="hint">${esc(s.account_code)} ${esc(s.account_name || '')}</div></div>
      <div class="kpi"><div class="label">Money in / out</div><div class="value" style="font-size:18px">${money(s.total_in)} / ${money(s.total_out)}</div><div class="hint">${d(s.date_from)} – ${d(s.date_to)}</div></div>
      <div class="kpi"><div class="label">Balance in the books</div><div class="value">${money(s.book_balance)}</div><div class="hint">on ${d(s.date_to)}</div></div>
      <div class="kpi"><div class="label">Statement closing balance</div><div class="value">${s.closing_balance == null ? '—' : money(s.closing_balance)}</div><div class="hint" style="color:${diff ? 'var(--bad)' : 'var(--ok)'}">${diff == null ? 'not entered' : diff ? `difference ${money(diff)}` : 'agrees with the books ✓'}</div></div></div>
    <div class="card"><div class="table-wrap"><table class="grid"><thead><tr><th>Date</th><th>Statement line</th><th class="r">Amount</th><th>In the books</th><th style="width:260px"></th></tr></thead><tbody>
    ${s.lines.map(l => `<tr class="${l.journal_line_id ? '' : 'unmatched'}"><td>${d(l.line_date)}</td><td>${esc(l.description || '')}${l.reference ? `<br><small class="muted">${esc(l.reference)}</small>` : ''}</td>
      <td class="r" style="color:${l.amount < 0 ? 'var(--bad)' : 'var(--ok)'}">${money(l.amount)}</td>
      <td>${l.journal_line_id ? `✅ ${esc(l.je_reference || '')} <small class="muted">${esc(l.je_memo || '')} · ${d(l.je_date)}${l.partner_name ? ' · ' + esc(l.partner_name) : ''} · ${l.match_kind}</small>`
        : l.suggestions.length ? `<select data-sug="${l.id}"><option value="">— ${l.suggestions.length} possible match${l.suggestions.length > 1 ? 'es' : ''} —</option>${l.suggestions.map(x => `<option value="${x.id}">${d(x.entry_date)} · ${esc(x.reference || '')} ${esc(x.memo || '')}${x.partner_name ? ' · ' + esc(x.partner_name) : ''}</option>`).join('')}</select>` : '<span class="muted">nothing with this amount in the books</span>'}</td>
      <td>${open ? (l.journal_line_id ? (l.match_kind !== 'created' ? `<button class="btn btn-sm" data-un="${l.id}">Unmatch</button>` : '') : `${l.suggestions.length ? `<button class="btn btn-sm btn-primary" data-m="${l.id}">Match</button>` : ''} <button class="btn btn-sm" data-c="${l.id}">Create entry…</button>`) : ''}</td></tr>`).join('')}
    </tbody></table></div></div>
    ${s.outstanding.length ? `<div class="card" style="margin-top:14px"><h3>In the books but not on any statement yet (${s.outstanding.length})</h3><p class="muted" style="margin-top:0;font-size:13px">Usually cheques or deposits that clear later, or cash sales not yet banked. Check them if the balances don't agree.</p>
      ${tableHtml([{ key: 'entry_date', label: 'Date', fmt: d }, { key: 'reference', label: 'Reference' }, { key: 'memo', label: 'Details' }, { key: 'debit', label: 'In', right: 1, fmt: v => Number(v) ? money(v) : '' }, { key: 'credit', label: 'Out', right: 1, fmt: v => Number(v) ? money(v) : '' }], s.outstanding.slice(0, 100))}</div>` : ''}`);
  const reload = x => statementPage(view, id);
  const act = async fn => { try { await fn(); } catch (e) { err(e); } };
  $$('[data-m]').forEach(b => b.onclick = () => act(async () => { const v = $(`[data-sug="${b.dataset.m}"]`).value; if (!v) throw new Error('Choose one of the possible matches'); await POST(`/bank-statements/${id}/lines/${b.dataset.m}/match`, { journal_line_id: Number(v) }); reload(); }));
  $$('[data-un]').forEach(b => b.onclick = () => act(async () => { await POST(`/bank-statements/${id}/lines/${b.dataset.un}/unmatch`); reload(); }));
  $$('[data-c]').forEach(b => b.onclick = () => {
    const l = s.lines.find(x => String(x.id) === b.dataset.c);
    const opts = COUNTER.filter(([c]) => c !== s.account_code);
    const f = [{ key: 'account_code', label: `What is this ${l.amount > 0 ? 'money in' : 'money out'} of ${money(Math.abs(l.amount))}?`, type: 'select', options: opts.map(([v, t]) => ({ value: v, label: t })), span: 2 },
      { key: 'partner_id', label: 'Customer / supplier', type: 'select', numeric: true, options: [{ value: '', label: '—' }, ...[...customers, ...suppliers.filter(x => !customers.some(c => c.id === x.id))].map(p => ({ value: p.id, label: p.name }))] },
      { key: 'description', label: 'Description' }];
    modal({ title: `${d(l.line_date)} · ${esc(l.description || '')}`, body: formHtml(f, { account_code: l.amount < 0 && Math.abs(l.amount) < 200 ? '6400' : opts[0][0], description: l.description }, { ctx: 'statement' }) +
      '<p class="muted" style="font-size:12px">This books the line in the ledger (dated as on the statement) and ticks it off. Use it for bank charges, interest, cash deposits, transfers and payments that were not recorded yet.</p>',
      actions: [{ label: 'Cancel' }, { label: 'Book & match', cls: 'btn-primary', onClick: async c => { await POST(`/bank-statements/${id}/lines/${l.id}/create`, readForm($('.modal-backdrop:last-child'), f)); c(); reload(); } }] });
  });
  const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = () => act(fn); };
  on('#auto', async () => { await POST(`/bank-statements/${id}/auto`); reload(); });
  on('#done', async () => { await POST(`/bank-statements/${id}/done`); toast('Reconciliation finished'); reload(); });
  on('#del', async () => { if (await confirmBox('Delete this imported statement? Matches are undone.', { danger: true })) { await DEL('/bank-statements/' + id); location.hash = '#/bank'; } });
}

// ---------------------------------------------------------------- expense claims
const CLAIM_ST = { submitted: ['waiting for approval', 'draft'], approved: ['approved – to pay back', 'partial'], rejected: ['rejected', 'cancelled'], reimbursed: ['paid', 'paid'] };
export async function claims(view) {
  const tab = query().tab || (can('expenses.approve') ? 'approve' : 'mine');
  const status = { approve: 'submitted', pay: 'approved', all: '', mine: '' }[tab];
  const [rows, accounts, methods] = await Promise.all([GET(`/expense-claims?${tab === 'mine' ? 'mine=1' : ''}${status ? '&status=' + status : ''}`), GET('/accounts').catch(() => []), GET('/payment-methods')]);
  const tabs = [['mine', 'My claims'], ...(can('expenses.approve') ? [['approve', 'To approve'], ['pay', 'To pay back'], ['all', 'All claims']] : [])];
  view.innerHTML = page('Expense claims', `<button class="btn btn-primary" id="nc">＋ New claim</button>`, `
    <div class="tabs">${tabs.map(([k, l]) => `<a href="#/claims?tab=${k}" class="${tab === k ? 'active' : ''}">${l}</a>`).join('')}</div>
    <p class="muted" style="margin-top:0;font-size:13px">Spent your own money (or the shop's petty cash) on something for the business? Claim it here with a photo of the slip. A manager approves it and you are paid back.</p>
    ${tableHtml([{ key: 'number', label: 'Number' }, { key: 'claim_date', label: 'Date', fmt: d }, { key: 'user_name', label: 'Claimed by' }, { key: 'description', label: 'For' },
      { key: 'account_name', label: 'Category' }, { key: 'amount', label: 'Amount', right: 1, fmt: money }, { key: 'paid_by', label: 'Paid with', fmt: (v, r) => v === 'own' ? 'own money' : r.company_method_name || 'company' },
      { key: 'status', label: 'Status', html: 1, fmt: (v, r) => badge((CLAIM_ST[v] || [v])[0], (CLAIM_ST[v] || [])[1]) + (r.reject_reason ? `<br><small class="muted">${esc(r.reject_reason)}</small>` : '') },
      { key: 'has_receipt', label: 'Slip', html: 1, fmt: v => Number(v) ? '📎' : '' }], rows, { rowAttr: r => `data-c="${r.id}"`, empty: tab === 'approve' ? 'Nothing waiting for approval 👍' : 'No claims.' })}`);
  const expAcc = accounts.filter(a => a.type === 'expense' && !['5000', '5100', '5150', '6200', '6900'].includes(a.code));
  $('#nc').onclick = () => newClaim(expAcc.length ? expAcc : [{ code: '6000', name: 'General Expenses' }], methods, () => claims(view));
  $$('[data-c]').forEach(tr => tr.onclick = async () => {
    const c = rows.find(x => String(x.id) === tr.dataset.c);
    const rc = Number(c.has_receipt) ? (await GET(`/expense-claims/${c.id}/receipt`).catch(() => null)) : null;
    const acts = [{ label: 'Close' }];
    const mine = c.user_id === state.user.id;
    if (c.status === 'submitted' && mine) acts.push({ label: 'Withdraw', cls: 'btn-danger', onClick: async x => { await DEL('/expense-claims/' + c.id); x(); claims(view); } });
    if (c.status === 'submitted' && can('expenses.approve') && (!mine || state.user.role === 'admin')) {
      acts.push({ label: 'Reject', cls: 'btn-danger', onClick: async x => { const why = await promptBox('Why is it rejected?'); if (!why) return; await POST(`/expense-claims/${c.id}/reject`, { reason: why }); x(); claims(view); } });
      acts.push({ label: 'Approve', cls: 'btn-ok', onClick: async x => { await POST(`/expense-claims/${c.id}/approve`); x(); toast('Approved and booked'); claims(view); } });
    }
    if (c.status === 'approved' && can('expenses.approve')) acts.push({ label: 'Pay back…', cls: 'btn-primary', onClick: async x => {
      const ms = methods.filter(m => m.kind !== 'account' && m.active);
      const f = [{ key: 'method_id', label: `Pay ${money(c.amount)} back to ${c.user_name} by`, type: 'select', numeric: true, options: ms.map(m => ({ value: m.id, label: m.name })) }];
      modal({ title: 'Pay back expense claim', size: 'sm', body: formHtml(f, {}), actions: [{ label: 'Cancel' }, { label: 'Paid', cls: 'btn-primary', onClick: async (y, r) => { await POST(`/expense-claims/${c.id}/reimburse`, readForm(r, f)); y(); x(); toast('Marked as paid'); claims(view); } }] });
    } });
    modal({ title: `${c.number} — ${esc(c.description)}`, wide: !!rc, body: `<div class="cols ${rc ? 'cols-2' : ''}"><div>${tableHtml([{ key: 'k', label: '' }, { key: 'v', label: '' }], [
        { k: 'Claimed by', v: c.user_name }, { k: 'Date', v: d(c.claim_date) }, { k: 'Amount', v: money(c.amount) + (Number(c.tax_rate) ? ` (incl. ${Number(c.tax_rate)}% VAT)` : '') },
        { k: 'Category', v: `${c.account_code} ${c.account_name || ''}` }, { k: 'Supplier / shop', v: c.supplier || '' }, { k: 'Paid with', v: c.paid_by === 'own' ? 'own money – to be paid back' : c.company_method_name },
        { k: 'Status', v: (CLAIM_ST[c.status] || [c.status])[0] }, { k: 'Decided by', v: c.approver_name ? `${c.approver_name} · ${dt(c.decided_at)}` : '' }])}</div>
        ${rc ? (rc.data_url.startsWith('data:application/pdf') ? `<a class="btn" href="${rc.data_url}" download="${esc(c.number)}.pdf">Open PDF slip</a>` : `<img src="${rc.data_url}" alt="slip" style="max-width:100%;max-height:60vh;border:1px solid var(--line);border-radius:8px">`) : ''}</div>`, actions: acts });
  });
}

function newClaim(accounts, methods, done) {
  let receipt = null;
  const f = [{ key: 'description', label: 'What did you buy / pay for?', required: true, span: 2 }, { key: 'amount', label: 'Amount paid (incl. VAT)', type: 'number', step: '0.01', required: true },
    { key: 'claim_date', label: 'Date on the slip', type: 'date', default: today() },
    { key: 'account_code', label: 'Category', type: 'select', options: accounts.map(a => ({ value: a.code, label: `${a.name}` })) },
    { key: 'tax_rate', label: 'VAT on the slip %', type: 'number', default: 0 },
    { key: 'supplier', label: 'Shop / supplier' },
    { key: 'paid_by', label: 'Paid with', type: 'select', options: [{ value: 'own', label: 'My own money – pay me back' }, { value: 'company', label: "The shop's money (petty cash, company card…)" }] },
    { key: 'company_method_id', label: "Which of the shop's money", type: 'select', numeric: true, options: [{ value: '', label: '—' }, ...methods.filter(m => m.kind !== 'account' && m.active).map(m => ({ value: m.id, label: m.name }))] }];
  modal({ title: 'New expense claim', wide: true, body: formHtml(f, { paid_by: 'own', account_code: '6000' }, { ctx: 'claim' }) + `<div class="field" style="margin-top:12px"><span>Photo of the slip</span>
    <input type="file" id="rcpt" accept="image/*,application/pdf" capture="environment"><img id="rprev" style="max-height:160px;display:none;margin-top:6px;border-radius:6px">
    <small class="help-note">Take a clear photo of the till slip or invoice. Claims without a slip may be rejected; VAT can only be claimed back with a valid tax invoice.</small></div>`,
    actions: [{ label: 'Cancel' }, { label: 'Submit claim', cls: 'btn-primary', onClick: async (c, r) => { await POST('/expense-claims', { ...readForm(r, f), receipt }); c(); toast('Claim submitted for approval'); done(); } }],
    onOpen: r => {
      const pb = r.querySelector('[name=paid_by]'), cm = r.querySelector('[name=company_method_id]').closest('.field');
      const vis = () => { cm.style.display = pb.value === 'company' ? '' : 'none'; }; pb.onchange = vis; vis();
      r.querySelector('#rcpt').onchange = async e => {
        const file = e.target.files[0]; if (!file) return;
        try {
          if (file.type === 'application/pdf') { if (file.size > 2e6) throw new Error('PDF must be under 2 MB'); receipt = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(file); }); }
          else { receipt = (await imageFileToDataUrl(file, { maxW: 1400, maxH: 1400, keepColour: true })).dataUrl; const p = r.querySelector('#rprev'); p.src = receipt; p.style.display = ''; }
        } catch (x) { receipt = null; err(x); }
      };
    } });
}

// ---------------------------------------------------------------- approvals inbox
export async function approvals(view) {
  const [a, s] = await Promise.all([GET('/approvals'), GET('/approvals/settings')]);
  view.innerHTML = page('Approvals', '', `
    <div class="cols cols-3" style="margin-bottom:14px">
      <a class="kpi" href="#/claims?tab=approve" style="text-decoration:none;color:inherit"><div class="label">Expense claims</div><div class="value">${a.expense_claims.length}</div><div class="hint">waiting for approval</div></a>
      <div class="kpi"><div class="label">Purchase orders</div><div class="value">${a.purchase_orders.length}</div><div class="hint">above the ${Number(s.po_limit) ? money(s.po_limit) : '—'} limit</div></div>
      <a class="kpi" href="#/recon" style="text-decoration:none;color:inherit"><div class="label">Sales recons</div><div class="value">${a.recon}</div><div class="hint">waiting for sign-off</div></a></div>
    ${a.purchase_orders.length ? `<div class="card" style="margin-bottom:14px"><h3>Purchase orders to approve</h3>${tableHtml([{ key: 'number', label: 'PO' }, { key: 'supplier_name', label: 'Supplier' }, { key: 'order_date', label: 'Date', fmt: d }, { key: 'user_name', label: 'Raised by' },
      { key: 'total', label: 'Total', right: 1, fmt: money }, { key: 'id', label: '', html: 1, fmt: v => `<a class="btn btn-sm" href="#/purchase/${v}">Open</a> <button class="btn btn-sm btn-ok" data-pa="${v}">Approve</button> <button class="btn btn-sm" data-pr="${v}">Send back</button>` }], a.purchase_orders)}</div>` : ''}
    ${a.expense_claims.length ? `<div class="card" style="margin-bottom:14px"><h3>Expense claims to approve</h3>${tableHtml([{ key: 'number', label: 'Claim' }, { key: 'user_name', label: 'By' }, { key: 'description', label: 'For' }, { key: 'amount', label: 'Amount', right: 1, fmt: money },
      { key: 'has_receipt', label: 'Slip', html: 1, fmt: v => Number(v) ? '📎' : '<span style="color:var(--warn)">none</span>' }, { key: 'id', label: '', html: 1, fmt: () => '<a class="btn btn-sm" href="#/claims?tab=approve">Review</a>' }], a.expense_claims)}</div>` : ''}
    ${a.to_reimburse.length ? `<div class="card" style="margin-bottom:14px"><h3>Approved claims to pay back</h3>${tableHtml([{ key: 'number', label: 'Claim' }, { key: 'user_name', label: 'To' }, { key: 'amount', label: 'Amount', right: 1, fmt: money }, { key: 'id', label: '', html: 1, fmt: () => '<a class="btn btn-sm" href="#/claims?tab=pay">Pay back</a>' }], a.to_reimburse)}</div>` : ''}
    ${!a.count && !a.to_reimburse.length ? '<div class="empty">Nothing waiting for you 👍</div>' : ''}
    ${can('settings') ? `<div class="card" style="max-width:640px"><h3>Approval rules</h3>${formHtml([{ key: 'po_limit', label: 'Purchase orders above this amount need a manager (0 = no limit)', type: 'number', step: '0.01' }], s, { ctx: 'approvals' })}
      <button class="btn btn-primary" id="aps" style="margin-top:10px">Save</button></div>` : ''}`);
  $$('[data-pa]').forEach(b => b.onclick = async () => { try { await POST(`/purchases/${b.dataset.pa}/approve`); toast('Purchase order approved'); approvals(view); } catch (e) { err(e); } });
  $$('[data-pr]').forEach(b => b.onclick = async () => { const why = await promptBox('Why is it sent back?'); if (why === null) return; try { await POST(`/purchases/${b.dataset.pr}/reject`, { reason: why }); approvals(view); } catch (e) { err(e); } });
  const sv = $('#aps'); if (sv) sv.onclick = async () => { try { await PUT('/approvals/settings', readForm(view, [{ key: 'po_limit', type: 'number' }])); toast('Saved'); } catch (e) { err(e); } };
}
