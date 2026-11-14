// Audit: ledger integrity & hash chain, control account reconciliations, exception reports (CAATs), Benford's law,
// audit trail & logins, auditor queries, and the audit pack (one Excel workbook + printable summary).
import { state, GET, POST, esc, $, $$, toast, err, can, money, qty, modal, formHtml, readForm, tableHtml, badge, page, d, dt, today, query } from './core.js';
import { exportButtons, wireExport } from './reportexport.js';
import { workbook, download } from './xlsx.js';

const RISK = { high: ['high', 'cancelled'], medium: ['medium', 'partial'], low: ['low', 'draft'] };
const rBadge = r => badge((RISK[r] || [r])[0], (RISK[r] || [r, ''])[1]);
const y0 = () => today().slice(0, 4) + '-01-01';
const fmtCell = v => v === null || v === undefined ? '' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : money(v)) : /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 16).replace('T', ' ') : String(v);

export async function audit(view) {
  const tab = query().tab || 'overview';
  const tabs = [['overview', 'Integrity'], ['exceptions', 'Exception reports'], ['recon', 'Control accounts'], ['benford', 'Benford'], ['trail', 'Audit trail'], ['queries', 'Queries'], ['pack', 'Audit pack']];
  view.innerHTML = page('Audit', '', `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/audit?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="ab"></div>`);
  const T = { overview, exceptions, recon, benford, trail, queries, pack };
  await (T[tab] || overview)($('#ab'), () => audit(view));
}
const range = () => { const q = query(); return { ...q, from: q.from || y0(), to: q.to || today() }; };
const bar = (q, extra = '') => `<div class="row wrap no-print" style="margin-bottom:10px"><label>From <input type="date" id="af" value="${q.from}"></label><label>To <input type="date" id="at" value="${q.to}"></label>${extra}<button class="btn" id="ag">Run</button><span class="spacer"></span>${exportButtons('xp')}</div>`;

async function overview(ab) {
  const x = await GET('/audit/integrity');
  const c = x.chain;
  ab.innerHTML = `<div class="cols cols-4" style="margin-bottom:12px">
      <div class="kpi"><div class="label">Ledger seal (hash chain)</div><div class="value" style="color:${c.intact ? 'var(--ok)' : 'var(--bad)'}">${c.intact ? '✔ intact' : '✖ BROKEN'}</div><div class="hint">${qty(c.checked)} entries checked · ${c.unsealed} waiting to be sealed</div></div>
      <div class="kpi"><div class="label">Debits = credits</div><div class="value" style="color:${x.ledger_balanced ? 'var(--ok)' : 'var(--bad)'}">${x.ledger_balanced ? '✔' : '✖'}</div><div class="hint">${money(x.ledger_debits)} / ${money(x.ledger_credits)}</div></div>
      <div class="kpi"><div class="label">Unbalanced entries</div><div class="value">${x.unbalanced.length}</div></div><div class="kpi"><div class="label">Postings to inactive accounts</div><div class="value">${x.postings_to_inactive.length}</div></div></div>
    <div class="card" id="rep"><h3>What this checks</h3><p>Every journal entry is sealed with a SHA-256 fingerprint that includes the previous entry's fingerprint. If anyone changes or deletes a posted entry – even directly in the database – the chain breaks from that point and is listed below. Posted entries are corrected only by reversing them.</p>
      ${c.broken.length ? `<h3 style="color:var(--bad)">Broken seals</h3>${tableHtml([{ key: 'id', label: 'Entry' }, { key: 'date', label: 'Date' }, { key: 'number', label: 'Number' }, { key: 'reference', label: 'Reference' }, { key: 'problem', label: 'Problem' }], c.broken)}` : ''}
      ${x.unbalanced.length ? `<h3>Unbalanced entries</h3>${tableHtml([{ key: 'id', label: 'Entry' }, { key: 'entry_date', label: 'Date', fmt: d }, { key: 'reference', label: 'Reference' }, { key: 'dr', label: 'Debits', right: 1, fmt: money }, { key: 'cr', label: 'Credits', right: 1, fmt: money }], x.unbalanced)}` : ''}
      <p class="muted">Checked ${dt(c.at)}.</p><button class="btn btn-sm" id="sl">Seal now</button></div>`;
  $('#sl').onclick = async () => { const r = await POST('/audit/seal', { all: true }); toast(`${r.sealed} entries sealed`); overview(ab); };
}
async function exceptions(ab) {
  const q = range(); const x = await GET(`/audit/exceptions?from=${q.from}&to=${q.to}`);
  ab.innerHTML = `${bar(q)}<div id="rep"><div class="card"><h3>Exception reports ${esc(x.from)} to ${esc(x.to)} – ${x.flagged} of ${x.tests.length} tests have items</h3>
    ${tableHtml([{ key: 'title', label: 'Test' }, { key: 'risk', label: 'Risk', html: 1, fmt: rBadge }, { key: 'count', label: 'Items', right: 1, html: 1, fmt: v => v ? `<b>${v}</b>` : '0 ✓' }, { key: 'why', label: 'Why it matters' }], x.tests, { rowAttr: t => `data-t="${t.key}"` })}</div>
    ${x.tests.filter(t => t.count).map(t => `<div class="card"><h3>${esc(t.title)} (${t.count})</h3>${tableHtml(t.cols.map(k => ({ key: k, label: k.replace(/_/g, ' '), right: ['debit', 'credit', 'amount', 'days', 'missing', 'refunds', 'refunded', 'voids', 'attempts'].includes(k), fmt: fmtCell })), t.rows, { rowAttr: r => r.entry_id ? `data-e="${r.entry_id}"` : '' })}</div>`).join('')}</div>`;
  $('#ag').onclick = () => { location.hash = `#/audit?tab=exceptions&from=${$('#af').value}&to=${$('#at').value}`; };
  wireExport('xp', '#rep', `Audit exception reports ${x.from} to ${x.to}`);
  $$('[data-e]', ab).forEach(tr => tr.onclick = async () => (await import('./financeui.js')).entryView(Number(tr.dataset.e)));
}
async function recon(ab) {
  const q = query(); const x = await GET('/audit/control-recon' + (q.as_of ? '?as_of=' + q.as_of : ''));
  ab.innerHTML = `<div class="row no-print" style="margin-bottom:10px"><label>As at <input type="date" id="ra" value="${x.as_of}"></label><button class="btn" id="rg">Run</button><span class="spacer"></span>${exportButtons('xp')}</div>
    <div id="rep"><div class="card"><h3>Control account reconciliations at ${esc(x.as_of)}</h3>${tableHtml([{ key: 'code', label: 'Account' }, { key: 'name', label: '' }, { key: 'ledger', label: 'General ledger', right: 1, fmt: money }, { key: 'subledger', label: 'Documents / register', right: 1, fmt: money },
      { key: 'difference', label: 'Difference', right: 1, html: 1, fmt: v => Math.abs(v) < 0.01 ? '0.00 ✓' : `<b class="neg">${money(v)}</b>` }, { key: 'explained_by', label: 'Usual reasons for a difference' }], x.accounts)}</div>
    ${x.accounts.filter(a => a.by_partner && a.by_partner.length).map(a => `<div class="card"><h3>${esc(a.code)} ${esc(a.name)} – differences by customer / supplier</h3>${tableHtml([{ key: 'name', label: 'Name' }, { key: 'ledger', label: 'Ledger', right: 1, fmt: money }, { key: 'documents', label: 'Open documents', right: 1, fmt: money }, { key: 'ledger', label: 'Difference', right: 1, fmt: (v, r) => money(Number(r.ledger) - Number(r.documents)) }], a.by_partner)}</div>`).join('')}</div>`;
  $('#rg').onclick = () => { location.hash = '#/audit?tab=recon&as_of=' + $('#ra').value; };
  wireExport('xp', '#rep', `Control account reconciliations ${x.as_of}`);
}
async function benford(ab) {
  const q = range(); const src = q.source || 'all';
  const x = await GET(`/audit/benford?from=${q.from}&to=${q.to}&source=${src}`);
  const mx = Math.max(31, ...x.digits.map(g => g.actual_pct));
  ab.innerHTML = `${bar(q, `<select id="as">${[['all', 'All postings'], ['manual', 'Manual journals'], ['bills', 'Supplier bills & expenses']].map(([k, l]) => `<option value="${k}" ${k === src ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
    <div class="card" id="rep"><h3>Benford's law – first digits of ${qty(x.amounts)} amounts</h3><p>Result: <b>${esc(x.conformity)}</b> (mean absolute deviation ${x.mad})</p>
      <div style="display:flex;gap:10px;align-items:flex-end;height:220px;margin:14px 0">${x.digits.map(g => `<div style="flex:1;text-align:center;font-size:11px"><div style="position:relative;height:180px"><div title="expected ${g.expected_pct}%" style="position:absolute;bottom:${g.expected_pct / mx * 180}px;left:0;right:0;border-top:2px dashed #555"></div><div style="position:absolute;bottom:0;left:20%;right:20%;height:${g.actual_pct / mx * 180}px;background:var(--primary,#3f3d9e);border-radius:3px 3px 0 0"></div></div><b>${g.digit}</b><br>${g.actual_pct}%</div>`).join('')}</div>
      ${tableHtml([{ key: 'digit', label: 'First digit' }, { key: 'count', label: 'Count', right: 1 }, { key: 'actual_pct', label: 'Actual %', right: 1 }, { key: 'expected_pct', label: 'Expected %', right: 1 }], x.digits)}
      <p class="muted">Natural financial data starts with 1 about 30% of the time and with 9 under 5%. Made-up or split amounts often break this pattern. Bars = actual, dashed line = expected.</p></div>`;
  $('#ag').onclick = () => { location.hash = `#/audit?tab=benford&from=${$('#af').value}&to=${$('#at').value}&source=${$('#as').value}`; };
  wireExport('xp', '#rep', "Benford's law analysis");
}
async function trail(ab) {
  const q = range(); const users = await GET('/users').catch(() => []);
  const rows = await GET(`/audit/trail?from=${q.from}&to=${q.to}${q.user_id ? '&user_id=' + q.user_id : ''}${q.action ? '&action=' + encodeURIComponent(q.action) : ''}${q.q ? '&q=' + encodeURIComponent(q.q) : ''}`);
  ab.innerHTML = `${bar(q, `<select id="au"><option value="">Everyone</option>${users.map(u => `<option value="${u.id}" ${String(u.id) === q.user_id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
      <select id="aa"><option value="">All actions</option>${[['login', 'Logins'], ['login_failed', 'Failed logins'], ['api.post', 'Creates'], ['api.put', 'Changes'], ['api.delete', 'Deletes'], ['finance', 'Finance (locks, year-end)'], ['account', 'Chart of accounts']].map(([k, l]) => `<option value="${k}" ${k === q.action ? 'selected' : ''}>${l}</option>`).join('')}</select><input id="aq" placeholder="search" value="${esc(q.q || '')}">`)}
    <div class="card" id="rep"><h3>Audit trail (${rows.length}${rows.length === 2000 ? '+' : ''} records)</h3>${tableHtml([{ key: 'created_at', label: 'When', fmt: dt }, { key: 'user_name', label: 'Who', fmt: v => v || '–' }, { key: 'action', label: 'Action' }, { key: 'entity', label: 'Area' },
      { key: 'details', label: 'Details', fmt: v => { if (!v) return ''; try { const o = typeof v === 'string' ? JSON.parse(v) : v; return o.path ? `${o.path} → ${o.status}${o.body && typeof o.body === 'object' ? ' ' + JSON.stringify(o.body).slice(0, 140) : ''}` : JSON.stringify(o).slice(0, 180); } catch (_) { return String(v).slice(0, 180); } } }, { key: 'ip', label: 'IP' }], rows, { empty: 'Nothing in this period.' })}</div>`;
  $('#ag').onclick = () => { location.hash = `#/audit?tab=trail&from=${$('#af').value}&to=${$('#at').value}&user_id=${$('#au').value}&action=${$('#aa').value}&q=${encodeURIComponent($('#aq').value)}`; };
  wireExport('xp', '#rep', 'Audit trail');
}
async function queries(ab, reload) {
  const rows = await GET('/audit/queries');
  ab.innerHTML = `<div class="row no-print" style="margin-bottom:10px"><span class="spacer"></span>${exportButtons('xp')}${can('audit') ? '<button class="btn btn-primary" id="qn">＋ Query</button>' : ''}</div>
    <div class="card" id="rep"><h3>Audit queries</h3>${queryTable(rows)}</div>`;
  wireExport('xp', '#rep', 'Audit queries');
  if ($('#qn')) $('#qn').onclick = () => queryDialog({}, reload);
  wireQueries(ab, rows, reload);
}
const queryTable = rows => tableHtml([{ key: 'id', label: '#' }, { key: 'created_at', label: 'Raised', fmt: d }, { key: 'subject', label: 'Subject' }, { key: 'risk', label: 'Risk', html: 1, fmt: rBadge }, { key: 'raised_by_name', label: 'By' }, { key: 'assigned_name', label: 'For' },
  { key: 'answer', label: 'Answer', fmt: v => v ? String(v).slice(0, 80) : '' }, { key: 'status', label: 'Status', html: 1, fmt: v => v === 'open' ? badge('open', 'partial') : v === 'answered' ? badge('answered', 'posted') : badge('closed', 'closed') }], rows, { rowAttr: x => `data-q="${x.id}"`, empty: 'No queries.' });
function wireQueries(root, rows, reload) {
  $$('[data-q]', root).forEach(tr => tr.onclick = () => {
    const x = rows.find(r => r.id === Number(tr.dataset.q));
    const acts = [{ label: 'Close' }];
    if (x.status !== 'closed' && (x.assigned_to === state.user.id || can('accounting'))) acts.push({ label: 'Answer', cls: 'btn-primary', onClick: async (c, r) => { await POST(`/audit/queries/${x.id}/answer`, { answer: r.querySelector('#qa').value }); c(); reload && reload(); } });
    if (can('audit') && x.status === 'answered') acts.push({ label: 'Re-open', onClick: async c => { await POST(`/audit/queries/${x.id}/close`, { reopen: true }); c(); reload && reload(); } }, { label: '✔ Close query', cls: 'btn-primary', onClick: async c => { await POST(`/audit/queries/${x.id}/close`); c(); reload && reload(); } });
    modal({ title: `Query #${x.id}: ${x.subject}`, body: `<p style="white-space:pre-wrap">${esc(x.question)}</p><p class="muted">${esc(x.entity)}${x.entity_id ? ' #' + x.entity_id : ''} · raised by ${esc(x.raised_by_name || '')} ${d(x.created_at)}</p>
      ${x.answer ? `<h4>Answer (${esc(x.answered_by_name || '')} ${d(x.answered_at)})</h4><p style="white-space:pre-wrap">${esc(x.answer)}</p>` : ''}${x.status !== 'closed' && (x.assigned_to === state.user.id || can('accounting')) ? '<label class="field"><span>Your answer</span><textarea id="qa" rows="4"></textarea></label>' : ''}
      ${x.entity === 'journal_entry' && x.entity_id ? `<p><a href="#" id="qe">Open the entry →</a></p>` : ''}`,
      onOpen: r => { const a = r.querySelector('#qe'); if (a) a.onclick = async e => { e.preventDefault(); (await import('./financeui.js')).entryView(x.entity_id); }; }, actions: acts });
  });
}
export async function queryDialog(pre = {}, done) {
  const users = await GET('/users').catch(() => []);
  const f = [{ key: 'subject', label: 'Subject', required: true, span: 2 }, { key: 'question', label: 'Question / request for information', type: 'textarea', rows: 5, span: 2, required: true },
    { key: 'assigned_to', label: 'For', type: 'select', options: [{ value: '', label: '– finance team –' }, ...users.filter(u => u.active).map(u => ({ value: u.id, label: `${u.name} (${u.role})` }))] }, { key: 'risk', label: 'Risk', type: 'select', options: ['high', 'medium', 'low'].map(v => ({ value: v, label: v })) }];
  modal({ title: 'Raise an audit query', body: formHtml(f, { risk: 'medium', ...pre }), actions: [{ label: 'Cancel' }, { label: 'Raise', cls: 'btn-primary', onClick: async (c, r) => { await POST('/audit/queries', { ...readForm(r, f), entity: pre.entity || 'general', entity_id: pre.entity_id }); toast('Query raised'); c(); done && done(); } }] });
}
/** for staff who are asked: their queries */
export async function myQueries(view) {
  const rows = await GET('/audit/queries');
  view.innerHTML = page('Audit queries for me', '', `<div class="card">${queryTable(rows)}</div>`);
  wireQueries(view, rows, () => myQueries(view));
}
async function pack(ab) {
  const q = range();
  ab.innerHTML = `${bar(q).replace(exportButtons('xp'), '<button class="btn btn-primary" id="pk">⬇ Download audit pack (Excel)</button><button class="btn" id="pp">🖨 Summary (PDF)</button>')}<div class="card" id="rep"><p>The audit pack is one Excel workbook for the external auditors with: trial balance, income statement, balance sheet, cash flow, every journal line with its seal, receivables and payables listings, the fixed asset register, control account reconciliations, exception reports and audit queries.</p><div id="ps"></div></div>`;
  $('#ag').onclick = () => { location.hash = `#/audit?tab=pack&from=${$('#af').value}&to=${$('#at').value}`; };
  const load = async () => GET(`/audit/pack?from=${$('#af').value}&to=${$('#at').value}`);
  const T = (head, rows) => [head, ...rows];
  $('#pk').onclick = async () => {
    try {
      $('#pk').disabled = true; $('#pk').textContent = 'Preparing…';
      const p = await load();
      const st = (s, f) => s.lines.map(l => [l.code, l.name, l.amount, ...(f ? [l.compare] : [])]);
      const sheets = [
        { name: 'Cover', rows: [['Audit pack'], ['Company', p.company.name || ''], ['Registration', p.company.reg_no || ''], ['Period', `${p.from} to ${p.to}`], ['Generated', p.generated_at], ['Ledger seal', p.chain.intact ? `intact – ${p.chain.checked} entries` : `BROKEN – ${p.chain.broken.length} entries`], ['Trial balance', p.trial_balance.balanced ? 'balances' : 'OUT OF BALANCE']], header: false },
        { name: 'Trial balance', rows: T(['Code', 'Account', 'Opening', 'Debits', 'Credits', 'Closing Dr', 'Closing Cr'], p.trial_balance.rows.map(r => [r.code, r.name, r.opening, r.debit, r.credit, r.closing_dr, r.closing_cr])) },
        { name: 'Income statement', rows: T(['Code', 'Account', 'Current', 'Comparative'], p.income_statement.sections.flatMap(s => [[s.name, '', s.total, s.compare], ...st(s, true)]).concat([['', 'Profit for the period', p.income_statement.totals.net_profit, p.income_statement.compare_totals.net_profit]])) },
        { name: 'Balance sheet', rows: T(['Code', 'Account', p.balance_sheet.as_of, p.balance_sheet.compare_as_of || ''], Object.values(p.balance_sheet.sections).flatMap(s => [[s.name, '', s.total, s.compare], ...st(s, true)])) },
        { name: 'Cash flow', rows: T(['Section', 'Item', 'Amount'], [...p.cash_flow.operating.map(l => ['Operating', l.name, l.amount]), ...p.cash_flow.investing.map(l => ['Investing', l.name, l.amount]), ...p.cash_flow.financing.map(l => ['Financing', l.name, l.amount]), ['', 'Net change', p.cash_flow.net_change], ['', 'Cash at start', p.cash_flow.cash_open], ['', 'Cash at end', p.cash_flow.cash_close]]) },
        { name: 'Journal lines', rows: T(['Entry', 'Date', 'Number', 'Reference', 'Narration', 'Source', 'User', 'Account', 'Account name', 'Debit', 'Credit', 'Cost centre', 'Partner', 'Captured', 'Seal'], p.journals.map(j => [j.id, String(j.entry_date).slice(0, 10), j.number || '', j.reference || '', j.memo || '', j.source_type || '', j.user_name || '', j.code, j.account, Number(j.debit), Number(j.credit), j.cost_centre || '', j.partner || '', String(j.created_at).slice(0, 19), j.hash || ''])) },
        { name: 'Receivables', rows: T(['Customer', 'Invoice', 'Date', 'Due', 'Open', 'Days'], p.receivables.map(r => [r.name, r.number, String(r.invoice_date).slice(0, 10), r.due_date ? String(r.due_date).slice(0, 10) : '', Number(r.open), r.days])) },
        { name: 'Payables', rows: T(['Supplier', 'Bill', 'Date', 'Due', 'Open', 'Days'], p.payables.map(r => [r.name, r.number, String(r.invoice_date).slice(0, 10), r.due_date ? String(r.due_date).slice(0, 10) : '', Number(r.open), r.days])) },
        { name: 'Fixed assets', rows: T(['Asset', 'Name', 'Category', 'Location', 'In use from', 'Cost', 'Depreciation', 'Book value', 'Status'], p.fixed_assets.map(a => [a.asset_no, a.name, a.category, a.location || '', String(a.in_service_date).slice(0, 10), Number(a.cost), Number(a.accum_dep), Number(a.nbv), a.status])) },
        { name: 'Control recons', rows: T(['Account', 'Name', 'Ledger', 'Documents', 'Difference'], p.control_reconciliations.accounts.map(a => [a.code, a.name, a.ledger, a.subledger, a.difference])) },
        { name: 'Exceptions', rows: T(['Test', 'Risk', 'Items', 'Why'], p.exceptions.tests.map(t => [t.title, t.risk, t.count, t.why])) },
        ...p.exceptions.tests.filter(t => t.count).slice(0, 10).map(t => ({ name: ('X ' + t.key).slice(0, 31), rows: T(t.cols, t.rows.map(r => t.cols.map(k => r[k] === null || r[k] === undefined ? '' : typeof r[k] === 'number' ? r[k] : (isNaN(Number(r[k])) || String(r[k]).trim() === '' ? String(r[k]) : Number(r[k]))))) })),
        { name: 'Queries', rows: T(['#', 'Subject', 'Risk', 'Status', 'Question', 'Answer'], p.queries.map(x => [x.id, x.subject, x.risk, x.status, x.question, x.answer || ''])) }];
      download(workbook(sheets), `Audit-pack-${p.from}-to-${p.to}.xlsx`);
      $('#ps').innerHTML = `<p class="muted">Downloaded: ${p.journals.length} journal lines, ${p.trial_balance.rows.length} accounts, ${p.exceptions.flagged} exception tests with items.</p>`;
    } catch (e) { err(e); } finally { $('#pk').disabled = false; $('#pk').textContent = '⬇ Download audit pack (Excel)'; }
  };
  $('#pp').onclick = async () => {
    const p = await load(); const { toPdf } = await import('./reportexport.js');
    toPdf(`<h2>Summary</h2><p>Period ${esc(p.from)} to ${esc(p.to)}. Ledger seal ${p.chain.intact ? 'intact' : 'BROKEN'} (${p.chain.checked} entries). Trial balance ${p.trial_balance.balanced ? 'balances' : 'does not balance'}.</p>
      <h2>Results</h2><table><tr><th>Revenue</th><td class="r">${money(p.income_statement.sections.find(s => s.key === 'revenue').total)}</td></tr><tr><th>Profit for the period</th><td class="r">${money(p.income_statement.totals.net_profit)}</td></tr><tr><th>Total assets</th><td class="r">${money(p.balance_sheet.total_assets)}</td></tr></table>
      <h2>Control accounts</h2><table><tr><th>Account</th><th class="r">Ledger</th><th class="r">Documents</th><th class="r">Difference</th></tr>${p.control_reconciliations.accounts.map(a => `<tr><td>${esc(a.code)} ${esc(a.name)}</td><td class="r">${money(a.ledger)}</td><td class="r">${money(a.subledger)}</td><td class="r">${money(a.difference)}</td></tr>`).join('')}</table>
      <h2>Exception reports</h2><table><tr><th>Test</th><th>Risk</th><th class="r">Items</th></tr>${p.exceptions.tests.map(t => `<tr><td>${esc(t.title)}</td><td>${esc(t.risk)}</td><td class="r">${t.count}</td></tr>`).join('')}</table>
      <h2>Open queries</h2><p>${p.queries.filter(x => x.status !== 'closed').length} of ${p.queries.length} not closed.</p>`, `Audit pack summary ${p.from} to ${p.to}`);
  };
}
