// Daily sales reconciliation per payment method
import { state, GET, POST, PUT, esc, $, $$, toast, err, can, money, modal, confirmBox, promptBox, tableHtml, badge, page, dt, today, round2, query } from './core.js';

const STATUS_LABEL = { not_started: 'not started', draft: 'draft', submitted: 'submitted', approved: 'approved' };
const statusBadge = s => badge(STATUS_LABEL[s] || s, { not_started: 'failed', draft: 'draft', submitted: 'posted', approved: 'ok' }[s]);
const weekday = d => new Date(d + 'T12:00:00').toLocaleDateString([], { weekday: 'short' });
const shiftDate = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const varCell = v => v === null || v === undefined ? '<span class="muted">—</span>'
  : `<b class="${Math.abs(v) < 0.005 ? 'var-ok' : v < 0 ? 'var-bad' : 'var-over'}">${Math.abs(v) < 0.005 ? '✓ 0.00' : money(v)}</b>`;

export async function reconList(view) {
  const days = Number(query().days || 45);
  const rows = await GET('/recon?days=' + days);
  const t = today();
  const pending = rows.filter(r => r.date < t && r.status !== 'approved');
  const totalVar = round2(rows.filter(r => r.status === 'approved').reduce((s, r) => s + Number(r.variance_total || 0), 0));
  view.innerHTML = page('Sales reconciliation', `<select id="days">${[14, 30, 45, 90, 180].map(n => `<option value="${n}" ${n === days ? 'selected' : ''}>Last ${n} days</option>`).join('')}</select>
    <a class="btn btn-primary" href="#/recon/${t}">Reconcile today</a>`, `
    <div class="cols cols-3" style="margin-bottom:14px">
      <div class="kpi"><div class="label">Days awaiting reconciliation</div><div class="value" style="color:${pending.length ? 'var(--bad)' : 'var(--ok)'}">${pending.length}</div><div class="hint">Before today, not yet approved</div></div>
      <div class="kpi"><div class="label">Awaiting approval</div><div class="value">${rows.filter(r => r.status === 'submitted').length}</div><div class="hint">Submitted, needs a second person</div></div>
      <div class="kpi"><div class="label">Net variance (approved days)</div><div class="value">${varCell(totalVar)}</div><div class="hint">Over (+) / short (−)</div></div>
    </div>
    ${tableHtml([
      { key: 'date', label: 'Date', fmt: (v) => `${v} · ${weekday(v)}` },
      { key: 'txns', label: 'Payments', right: 1 },
      { key: 'amount', label: 'System takings', right: 1, fmt: money },
      { key: 'actual_total', label: 'Actual', right: 1, fmt: (v, r) => r.status === 'not_started' ? '' : money(v) },
      { key: 'variance_total', label: 'Variance', right: 1, html: 1, fmt: (v, r) => r.status === 'not_started' ? '' : varCell(v) },
      { key: 'status', label: 'Status', html: 1, fmt: statusBadge },
      { key: 'prepared_by_name', label: 'Prepared by' }, { key: 'approved_by_name', label: 'Approved by' }
    ], rows, { rowAttr: r => `data-href="#/recon/${r.date}"`, empty: 'No sales in this period.' })}`);
  $('#days').onchange = e => location.hash = '#/recon?days=' + e.target.value;
  $$('[data-href]').forEach(tr => tr.onclick = () => location.hash = tr.dataset.href);
}

export async function reconDetail(view, [date]) {
  let R = await GET('/recon/' + date);
  const editable = () => R.status === 'draft' || R.status === 'not_started';

  const render = () => {
    const acts = [`<a class="btn" href="#/recon/${shiftDate(date, -1)}" title="Previous day">◀</a><a class="btn" href="#/recon/${shiftDate(date, 1)}" title="Next day">▶</a>`];
    if (editable()) acts.push('<button class="btn" id="save">Save draft</button><button class="btn btn-primary" id="submit">Submit for approval</button>');
    if (R.status === 'submitted' && can('recon.approve')) acts.push('<button class="btn btn-danger" id="reject">Send back</button><button class="btn btn-ok" id="approve">Approve & post</button>');
    if (R.status === 'approved' && state.user.role === 'admin') acts.push('<button class="btn btn-danger" id="reopen">Reopen</button>');
    acts.push('<button class="btn" onclick="window.print()">🖨 Print</button>');

    const warn = [];
    if (R.open_sessions.length) warn.push(`⚠ ${R.open_sessions.length} cashier session(s) still open (${R.open_sessions.map(s => esc(s.terminal + ' · ' + s.user)).join(', ')}). Close them first so cash is counted.`);
    if (R.stale) warn.push('⚠ Payments were recorded for this day after it was submitted/approved. Figures below are frozen; the live total differs. Send back or reopen to include them.');
    if (date >= today() && editable()) warn.push('ℹ The day is not over yet — more sales may come in. Expected figures update until you submit.');

    view.innerHTML = page(`Reconciliation — ${date} (${weekday(date)})`, acts.join(''), `
      ${warn.map(w => `<div class="card notice">${w}</div>`).join('')}
      <div class="row" style="margin:4px 0 12px">${statusBadge(R.status)}
        ${R.recon && R.recon.prepared_by_name ? `<span class="muted">Prepared by <b>${esc(R.recon.prepared_by_name)}</b>${R.recon.prepared_at ? ' · ' + dt(R.recon.prepared_at) : ''}</span>` : ''}
        ${R.recon && R.recon.approved_by_name ? `<span class="muted">· Approved by <b>${esc(R.recon.approved_by_name)}</b> · ${dt(R.recon.approved_at)}</span>` : ''}
        ${R.recon && R.recon.adjust_entry_id ? `<a href="#/accounting?tab=journal" class="muted">· Journal #${R.recon.adjust_entry_id}</a>` : ''}</div>
      <div class="card">
        <div class="table-wrap"><table class="grid recon"><thead><tr>
          <th>Payment method</th><th class="r">Txns</th><th class="r">Received</th><th class="r">Refunds</th><th class="r">Expected</th>
          <th class="r" style="width:150px">Actual</th><th class="r">Variance</th><th style="width:22%">Note</th><th></th></tr></thead>
        <tbody>${R.lines.map((l, i) => `<tr>
          <td><b>${esc(l.name)}</b><div class="muted" style="font-size:12px">${hint(l)}</div></td>
          <td class="r">${l.txn_count}</td><td class="r">${money(l.received)}</td><td class="r">${l.refunded ? '−' + money(l.refunded) : ''}</td>
          <td class="r"><b>${money(l.expected)}</b></td>
          <td class="r">${editable() ? `<input type="number" step="0.01" class="r" data-act="${i}" value="${l.actual ?? ''}" placeholder="enter">` : (l.actual == null ? '—' : money(l.actual))}</td>
          <td class="r" data-var="${i}">${varCell(l.actual == null || l.actual === '' ? null : round2(l.actual - l.expected))}</td>
          <td>${editable() ? `<input data-note="${i}" value="${esc(l.note || '')}" placeholder="e.g. bank charges, late deposit">` : esc(l.note || '')}</td>
          <td>${l.txn_count ? `<button class="btn btn-sm" data-tx="${i}">View</button>` : ''}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td class="r">${R.lines.reduce((s, l) => s + l.txn_count, 0)}</td><td></td><td></td><td class="r">${money(R.expected_total)}</td>
          <td class="r" id="tAct">${money(R.actual_total)}</td><td class="r" id="tVar">${varCell(R.variance_total)}</td><td colspan="2"></td></tr></tfoot></table></div>
        ${R.account_charges.count ? `<p class="muted" style="margin:10px 0 0">Not included: ${R.account_charges.count} sale(s) charged to customer accounts (${money(R.account_charges.amount)}) — no money received; they show in receivables.</p>` : ''}
        ${R.status === 'approved' && R.lines.some(l => l.adjustment_posted) ? `<p class="muted">Posted to <b>6900 Cash Over/Short</b>: ${R.lines.filter(l => l.adjustment_posted).map(l => `${esc(l.name)} ${money(l.adjustment_posted)}`).join(' · ')}</p>` : ''}
      </div>
      <div class="cols cols-2" style="margin-top:14px">
        <div class="card"><h3>Cashier sessions closed this day</h3>
          ${tableHtml([{ key: 'terminal', label: 'Till' }, { key: 'user', label: 'Cashier' }, { key: 'closed_at', label: 'Closed', fmt: dt },
            { key: 'expected_cash', label: 'Expected', right: 1, fmt: money }, { key: 'counted_cash', label: 'Counted', right: 1, fmt: money },
            { key: 'difference', label: 'Over/short', right: 1, html: 1, fmt: v => varCell(Number(v)) }], R.sessions, { empty: 'No sessions closed on this day.' })}
          ${R.sessions.length ? `<p class="muted" style="margin-bottom:0">Session over/short (${money(R.session_variance)}) was already posted when the sessions were closed; it is not posted again.</p>` : ''}</div>
        <div class="card"><h3>Notes</h3>
          ${editable() ? `<textarea id="notes" rows="5" placeholder="Anything the approver should know">${esc(R.recon?.notes || '')}</textarea>` : `<div style="white-space:pre-wrap">${esc(R.recon?.notes || '—')}</div>`}
          <h4 style="margin:14px 0 6px">How to fill in "Actual"</h4>
          <ul class="muted" style="margin:0;padding-left:18px;line-height:1.6"><li><b>Cash</b> – cash counted / banked (pre-filled from the counts at session close).</li>
          <li><b>Card</b> – the settlement/batch total printed by the card machine or on the acquirer statement.</li>
          <li><b>Mobile money</b> – total received on the merchant wallet statement (M-Pesa, EcoCash) for the day.</li></ul></div>
      </div>`, { back: '#/recon' });
    wire();
  };

  const hint = l => {
    if (l.kind === 'cash') return l.already_posted ? `Counted at close: ${money(l.suggested_actual)} (session over/short ${money(l.already_posted)} already posted)` : 'Cash counted / banked';
    if (l.kind === 'card') return 'Card machine settlement total';
    if (l.kind === 'mobile_money') return 'Wallet statement total';
    return l.kind;
  };

  const collect = () => ({
    notes: $('#notes') ? $('#notes').value : undefined,
    lines: R.lines.map((l, i) => ({ method_id: l.method_id, actual: $(`[data-act="${i}"]`).value, note: $(`[data-note="${i}"]`).value }))
  });

  const wire = () => {
    $$('[data-act]').forEach(inp => inp.oninput = () => {
      const i = Number(inp.dataset.act); const l = R.lines[i];
      l.actual = inp.value === '' ? null : Number(inp.value);
      $(`[data-var="${i}"]`).innerHTML = varCell(l.actual == null ? null : round2(l.actual - l.expected));
      const filled = R.lines.filter(x => x.actual != null);
      $('#tAct').textContent = money(filled.reduce((s, x) => s + Number(x.actual), 0));
      $('#tVar').innerHTML = varCell(round2(filled.reduce((s, x) => s + Number(x.actual) - x.expected, 0)));
    });
    $$('[data-tx]').forEach(b => b.onclick = () => txDialog(R.lines[Number(b.dataset.tx)]));
    const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = async () => { el.disabled = true; try { await fn(); } catch (e) { err(e); } el.disabled = false; }; };
    on('#save', async () => { R = await PUT('/recon/' + date, collect()); toast('Draft saved'); render(); });
    on('#submit', async () => {
      const body = collect();
      if (body.lines.some(l => l.actual === '')) throw new Error('Enter an actual amount for every payment method (0 if nothing was received)');
      const v = round2(R.lines.reduce((s, l) => s + Number(l.actual || 0) - l.expected, 0));
      if (!(await confirmBox(`Submit ${date} for approval? Net variance ${money(v)}. You won't be able to edit it afterwards.`, { okLabel: 'Submit' }))) return;
      R = await POST(`/recon/${date}/submit`, body); toast('Submitted for approval'); render();
    });
    on('#approve', async () => {
      const big = R.lines.filter(l => Math.abs(Number(l.actual) - l.expected) >= 0.005);
      if (!(await confirmBox(big.length ? `Approve and post ${big.length} variance(s) totalling ${money(R.variance_total)} to Cash Over/Short?` : 'Approve this reconciliation? Everything balances.', { okLabel: 'Approve' }))) return;
      R = await POST(`/recon/${date}/approve`, {}); toast('Approved'); render();
    });
    on('#reject', async () => { const reason = await promptBox('Send back to preparer', { label: 'Reason' }); if (reason === null) return; R = await POST(`/recon/${date}/reject`, { reason }); toast('Sent back'); render(); });
    on('#reopen', async () => { if (!(await confirmBox('Reopen this day? The posted adjustment will be reversed.', { danger: true, okLabel: 'Reopen' }))) return; R = await POST(`/recon/${date}/reopen`); toast('Reopened'); render(); });
  };

  render();
}

async function txDialog(line) {
  const rows = await GET(`/recon/${line.date || location.hash.split('/')[2]}/transactions?method_id=${line.method_id}`);
  const dups = rows.filter(r => r.duplicate_count > 1).length;
  modal({ title: `${line.name} — ${rows.length} transactions`, wide: true, body: `
    ${dups ? `<div class="card notice" style="margin-bottom:10px">⚠ ${dups} payment(s) use a reference that appears more than once — check for a re-used mobile money confirmation.</div>` : ''}
    <p class="muted" style="margin-top:0">Tick each line as you find it on the statement; the ticked total helps locate differences (ticks are not saved).</p>
    <div class="table-wrap" style="max-height:55vh"><table class="grid"><thead><tr><th></th><th>Time</th><th>Document</th><th>Till / staff</th><th>Customer</th><th>Reference</th><th>Phone</th><th class="r">Amount</th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr class="${r.duplicate_count > 1 ? 'dup-row' : ''}"><td><input type="checkbox" data-tick="${i}"></td><td class="nowrap">${dt(r.created_at)}</td>
      <td>${esc(r.order_number || r.invoice_number || 'Account payment')}</td><td>${esc([r.terminal, r.user_name].filter(Boolean).join(' · '))}</td><td>${esc(r.partner_name || '')}</td>
      <td class="mono">${esc(r.reference || '')}${r.duplicate_count > 1 ? ` <span class="badge badge-failed">used ${r.duplicate_count}×</span>` : ''}</td><td>${esc(r.phone || '')}</td>
      <td class="r">${r.direction === 'out' ? '−' : ''}${money(r.amount)}</td></tr>`).join('')}</tbody></table></div>
    <div class="row" style="margin-top:10px"><span class="muted">Ticked: <b id="tk">0</b> · <b id="tka">${money(0)}</b></span><span class="spacer"></span><span>System total <b>${money(line.expected)}</b></span></div>`,
    onOpen: r => $$('[data-tick]', r).forEach(cb => cb.onchange = () => {
      const t = $$('[data-tick]:checked', r).map(c => rows[Number(c.dataset.tick)]);
      r.querySelector('#tk').textContent = t.length;
      r.querySelector('#tka').textContent = money(t.reduce((s, x) => s + (x.direction === 'out' ? -1 : 1) * Number(x.amount), 0));
    }) });
}
