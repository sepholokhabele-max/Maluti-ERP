// A stand-in for the Smartel POS backend (pos-api + syncd) for tests and demos. It follows the contracts in
// SM-POS-TDD-001 closely enough to exercise S-ERP's adapter: sessions, agent ops with OTP and unknown outcomes,
// payment intents, NPR scope, bulk batches, envelope batches with hash-chain + sale validation, and the change log.
// It never talks to MyWallet. Run alone: node server/test/mock-smartel.js 8790
const http = require('http');
const crypto = require('crypto');

function start(port = 0) {
  const S = {
    terminals: new Set(), sessions: new Map(), ops: new Map(), idem: new Map(), intents: new Map(), batches: new Map(),
    chain: new Map(), envelopes: [], rejected: [], changes: { recall: [], catalogue: [], prices: [], credit: [] }, cursors: {},
    register: { version: 1, gtins: [], lots: [], recalls: [] }, otp: '12345', calls: [], confirms: 0, autoPay: true
  };
  const id = () => crypto.randomUUID();
  const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
  const err = (res, code, c, msg) => send(res, code, { code: c, error: msg });
  const view = o => ({ operation_id: o.operation_id, session_id: o.session_id, line_no: o.line_no, op: o.op, amount_minor: o.amount_minor, fee_minor: o.fee_minor, commission_minor: o.commission_minor,
    counterparty: o.counterparty, account_masked: o.account_masked, state: o.state, failure_code: o.failure_code || null, mw_ref: o.mw_ref || null, result: o.result || null,
    cash_minor: o.state === 'completed' ? o.sign * o.amount_minor : 0, needs_otp: o.state === 'otp_wait' });
  const SIGN = { dep: 1, wd: -1, tillout: -1, sthru: 1, nps: 1, vredeem: -1, airtime: 1, lec: 1, biller: 1 };
  const OTP = new Set(['wd', 'tillout']);
  const sesView = s => { const lines = [...S.ops.values()].filter(o => o.session_id === s.session_id);
    return { ...s, services: lines.map(view), services_cash_minor: lines.filter(o => o.state === 'completed').reduce((a, o) => a + o.sign * o.amount_minor, 0), blocked: lines.some(o => ['draft', 'submitted', 'unknown'].includes(o.state)) }; };
  const hash = (prev, seq, body) => crypto.createHash('sha256').update(`${prev}|${seq}|`).update(Buffer.from(body, 'utf8')).digest('hex');

  function validateSale(s) {
    if (!s.sessionId || !s.receiptNo) return ['ENV_SCHEMA_INVALID', 'sessionId and receiptNo are required'];
    if (!(s.lines || []).length && !(s.svcs || []).length) return ['ENV_SCHEMA_INVALID', 'a session needs goods or services'];
    let goods = 0, tendered = 0, cashT = 0, svc = 0;
    for (const l of s.lines || []) {
      if (!(l.qtyScaled > 0) || !(l.grossMinor > 0)) return ['ENV_SCHEMA_INVALID', `line ${l.lineNo}: qty and gross must be positive`];
      if (!['STD', 'ZERO', 'EXEMPT'].includes(l.taxClass)) return ['ENV_SCHEMA_INVALID', `line ${l.lineNo}: tax class`];
      if (String(l.gtin || '').length < 8) return ['ENV_SCHEMA_INVALID', `line ${l.lineNo}: gtin required`];
      const lq = (l.lots || []).reduce((a, x) => a + x.qty, 0);
      if ((l.lots || []).length && lq !== l.qtyScaled) return ['ENV_SCHEMA_INVALID', `line ${l.lineNo}: lots ${lq} != ${l.qtyScaled}`];
      goods += l.grossMinor;
    }
    for (const t of s.tenders || []) {
      if (!['cash', 'card', 'mywallet', 'switch'].includes(t.type)) return ['ENV_SCHEMA_INVALID', 'tender type'];
      if (!(t.amountMinor > 0)) return ['ENV_SCHEMA_INVALID', 'tender amount'];
      if (t.type !== 'cash' && !t.mwRef) return ['ENV_TENDER_UNCONFIRMED', 'no mwRef'];
      tendered += t.amountMinor; if (t.type === 'cash') cashT += t.amountMinor;
    }
    if (tendered !== goods) return ['ENV_TENDER_MISMATCH', `tenders ${tendered} do not equal goods ${goods}`];
    if (s.offline && (s.svcs || []).length) return ['SES_OFFLINE_SERVICES', 'services offline'];
    for (const v of s.svcs || []) {
      if (v.state !== 'completed' || !v.mwRef || !v.operationId) return ['ENV_SCHEMA_INVALID', `service line ${v.lineNo}`];
      const sg = SIGN[v.type]; if (sg === undefined) return ['ENV_SCHEMA_INVALID', 'service type'];
      if (sg < 0 && v.cashMinor !== -v.amountMinor) return ['ENV_SCHEMA_INVALID', 'cash must be -amount'];
      if (sg > 0 && v.cashMinor !== v.amountMinor && v.cashMinor !== 0) return ['ENV_SCHEMA_INVALID', 'cash must be +amount or 0'];
      svc += v.cashMinor;
    }
    if (s.netCashMinor !== svc + cashT) return ['ENV_NETCASH_MISMATCH', `netCashMinor ${s.netCashMinor} but lines imply ${svc + cashT}`];
    return null;
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch (_) { return err(res, 400, 'ENV_SCHEMA', 'bad json'); }
      const u = new URL(req.url, 'http://x'); const p = u.pathname; const m = req.method;
      const tid = req.headers['x-terminal-id'];
      S.calls.push(`${m} ${p}`);
      if (p === '/healthz') return send(res, 200, { status: 'ok' });
      const portal = p.startsWith('/v1/portal/');
      if (portal) { if (!req.headers['x-merchant-id'] && !req.headers.authorization) return err(res, 403, 'AUTH', 'merchant credentials required'); }
      else if (!tid || !S.terminals.has(tid)) return err(res, 403, 'AUTH', 'terminal credentials required');
      let mm;
      // ---- sessions
      if (m === 'POST' && p === '/v1/sessions') { const sid = body.sessionId || id(); if (!S.sessions.has(sid)) S.sessions.set(sid, { session_id: sid, terminal_id: tid, state: 'open' }); return send(res, 201, sesView(S.sessions.get(sid))); }
      if ((mm = p.match(/^\/v1\/sessions\/([\w-]+)$/)) && m === 'GET') { const s = S.sessions.get(mm[1]); return s ? send(res, 200, sesView(s)) : err(res, 404, 'SES_NOT_FOUND', 'no such session'); }
      if ((mm = p.match(/^\/v1\/sessions\/([\w-]+)\/close$/)) && m === 'POST') {
        const s = S.sessions.get(mm[1]); if (!s) return err(res, 404, 'SES_NOT_FOUND', 'no such session');
        const v = sesView(s); if (v.blocked) return err(res, 409, 'SES_BLOCKED', 'a service line is still unresolved');
        const goods = Number(body.goodsGrossMinor || 0);
        if (goods && body.goodsTender !== 'cash') { const paid = [...S.intents.values()].some(i => i.sale_id === s.session_id && i.state === 'PAID' && i.amount_minor === goods); if (!paid) return err(res, 409, 'SES_TENDER_UNPAID', `${body.goodsTender} tender is not PAID yet`); }
        s.state = 'closed'; s.receipt_no = body.receiptNo; s.net_cash_minor = v.services_cash_minor + (body.goodsTender === 'cash' ? goods : 0);
        return send(res, 200, { ...sesView(s), net_cash_minor: s.net_cash_minor });
      }
      // ---- agent ops
      if (m === 'POST' && p === '/v1/agent/ops') {
        const key = `${body.sessionId}:${body.lineNo}:${body.op}`;
        if (S.idem.has(key)) return send(res, 201, view(S.ops.get(S.idem.get(key))));
        const s = S.sessions.get(body.sessionId);
        if (!s || s.terminal_id !== tid) return err(res, 404, 'SES_NOT_FOUND', 'open the session on this till first');
        if (SIGN[body.op] === undefined) return err(res, 400, 'AGT_OP_UNKNOWN', 'unknown operation');
        const f = body.fields || {}; const amt = Number(f.amount_minor || 0);
        if (!(amt > 0)) return err(res, 400, 'AGT_AMOUNT', 'amount_minor must be positive');
        const fee = Math.max(200, Math.round(amt * 0.015));
        const o = { operation_id: id(), session_id: body.sessionId, line_no: body.lineNo, op: body.op, amount_minor: amt, sign: SIGN[body.op], fee_minor: fee, commission_minor: Math.round(fee * 0.4),
          counterparty: f.cell === '58000000' ? null : 'T. MOKOENA', account_masked: String(f.cell || f.account || f.meter || '').replace(/^(\d{3})\d+(\d{2})$/, '$1****$2'), state: OTP.has(body.op) ? 'otp_wait' : 'checked', fields: f };
        if (f.cell === '58000000') { o.state = 'failed'; o.failure_code = 'MW_NOT_REGISTERED'; o.result = 'This number is not on MyWallet'; }
        S.ops.set(o.operation_id, o); S.idem.set(key, o.operation_id);
        return send(res, 201, view(o));
      }
      if ((mm = p.match(/^\/v1\/agent\/ops\/([\w-]+)$/)) && m === 'GET') {
        const o = S.ops.get(mm[1]); if (!o) return err(res, 404, 'AGT_NOT_FOUND', 'not found');
        if (o.state === 'unknown') { o.state = 'completed'; o.mw_ref = 'MW' + Math.floor(Math.random() * 1e9); o.result = 'resolved from history'; }
        return send(res, 200, view(o));
      }
      if ((mm = p.match(/^\/v1\/agent\/ops\/([\w-]+)\/confirm$/)) && m === 'POST') {
        const o = S.ops.get(mm[1]); if (!o) return err(res, 404, 'AGT_NOT_FOUND', 'not found');
        if (!['checked', 'otp_wait'].includes(o.state)) return send(res, 200, view(o));
        if (o.state === 'otp_wait') {
          if (String(body.otp || '') !== S.otp) { o.bad = (o.bad || 0) + 1; if (o.bad >= 3) { o.state = 'failed'; o.failure_code = 'AGT_OTP_INVALID'; return send(res, 200, view(o)); } return err(res, 403, 'AGT_OTP_INVALID', `wrong OTP, ${3 - o.bad} attempts left`); }
        }
        S.confirms++;
        if (o.amount_minor === 77700) { o.state = 'unknown'; o.failure_code = 'AGT_TIMEOUT'; return send(res, 200, view(o)); }
        o.state = 'completed'; o.mw_ref = 'MW' + Math.floor(Math.random() * 1e9); o.result = o.op === 'lec' ? 'Token 1234 5678 9012 3456 7890' : 'ok';
        return send(res, 200, view(o));
      }
      // ---- payment intents
      if (m === 'POST' && p === '/v1/payments/intents') {
        const key = `${body.saleId}:${body.tenderSeq}`;
        const ex = [...S.intents.values()].find(i => i.key === key); if (ex) return send(res, 201, ivw(ex));
        if (!['card', 'mywallet', 'switch'].includes(body.tender)) return err(res, 400, 'PAY_TENDER', 'tender');
        const i = { intent_id: id(), key, sale_id: body.saleId, type: body.tender, amount_minor: Number(body.amountMinor), state: 'PRESENTED', payload: body.tender === 'card' ? { url: 'https://pay.example/card/' + key } : { qr: 'MWQR|' + key + '|' + body.amountMinor } };
        S.intents.set(i.intent_id, i); return send(res, 201, ivw(i));
      }
      if ((mm = p.match(/^\/v1\/payments\/intents\/([\w-]+)$/)) && m === 'GET') {
        const i = S.intents.get(mm[1]); if (!i) return err(res, 404, 'PAY_NOT_FOUND', 'no');
        if (S.autoPay && i.state === 'PRESENTED') { i.state = 'PAID'; i.mw_ref = 'MWP' + Math.floor(Math.random() * 1e9); }
        return send(res, 200, ivw(i));
      }
      // ---- register
      if (m === 'GET' && p === '/v1/register/scope') return send(res, 200, { ...S.register, sha256: 'x', signature: '' });
      // ---- bulk (owner portal)
      if (m === 'POST' && p === '/v1/portal/bulk-batches') {
        const lines = body.lines || []; if (!lines.length) return err(res, 400, 'BULK_EMPTY', 'no lines');
        for (const [i, l] of lines.entries()) { if (!/^266[56]\d{7}$/.test(l.msisdn)) return err(res, 400, 'BULK_MSISDN', `line ${i + 1}: ${l.msisdn} is not a Lesotho mobile number`); }
        const b = { batchId: id(), state: 'draft', lines: lines.map((l, i) => ({ line_no: i + 1, ...l, state: 'ready' })) };
        S.batches.set(b.batchId, b); return send(res, 201, { batchId: b.batchId, totalMinor: lines.reduce((a, l) => a + l.amount_minor, 0), lines: lines.length });
      }
      if ((mm = p.match(/^\/v1\/portal\/bulk-batches\/([\w-]+)\/disburse$/)) && m === 'POST') { const b = S.batches.get(mm[1]); if (!b) return err(res, 404, 'BULK_NOT_FOUND', 'no'); b.state = 'sending'; for (const l of b.lines) { l.state = l.msisdn.endsWith('99') ? 'failed' : 'paid'; if (l.state === 'paid') l.mw_ref = 'MWB' + l.line_no; else l.failure = 'Wallet closed'; } return send(res, 200, { batchId: b.batchId, state: 'sending' }); }
      if ((mm = p.match(/^\/v1\/portal\/bulk-batches\/([\w-]+)$/)) && m === 'GET') { const b = S.batches.get(mm[1]); return b ? send(res, 200, { batchId: b.batchId, lines: b.lines }) : err(res, 404, 'BULK_NOT_FOUND', 'no'); }
      // ---- syncd
      if (m === 'POST' && p === '/v1/sync/batches') {
        if (body.terminalId !== tid) return err(res, 403, 'TERM_MISMATCH', 'terminal');
        const results = [];
        // raw body bytes per envelope: our adapter writes bodies with JSON.stringify, so a re-stringify is byte-identical
        for (const e of body.envelopes || []) {
          const b = JSON.stringify(e.body);
          const head = S.chain.get(tid) || { seq: 0, hash: 'GENESIS', broken: false };
          if (S.envelopes.some(x => x.clientId === e.clientId)) { results.push({ clientId: e.clientId, status: 'duplicate' }); continue; }
          if (hash(e.prevHash, e.deviceSeq, b) !== e.hash) { head.broken = true; S.chain.set(tid, head); results.push({ clientId: e.clientId, status: 'rejected', code: 'ENV_HASH_MISMATCH', reason: 'hash does not match body' }); continue; }
          if (head.broken) { results.push({ clientId: e.clientId, status: 'held', code: 'CHAIN_QUARANTINED' }); continue; }
          if (e.deviceSeq <= head.seq) { results.push({ clientId: e.clientId, status: 'duplicate' }); continue; }
          if (e.deviceSeq > head.seq + 1) { results.push({ clientId: e.clientId, status: 'held', code: 'CHAIN_GAP', reason: `expected seq ${head.seq + 1}` }); continue; }
          if (e.prevHash !== head.hash) { head.broken = true; S.chain.set(tid, head); results.push({ clientId: e.clientId, status: 'rejected', code: 'CHAIN_BROKEN' }); continue; }
          let rej = null;
          if (e.type === 'sale') rej = e.schemaVersion < 2 ? ['ENV_SCHEMA_VERSION', 'v2'] : validateSale(e.body);
          S.chain.set(tid, { seq: e.deviceSeq, hash: e.hash, broken: false });
          if (rej) { S.rejected.push({ ...e, code: rej[0] }); results.push({ clientId: e.clientId, status: 'rejected', code: rej[0], reason: rej[1] }); continue; }
          S.envelopes.push({ ...e, terminalId: tid }); results.push({ clientId: e.clientId, status: 'applied' });
        }
        return send(res, 200, { batchId: body.batchId, results });
      }
      if (m === 'GET' && p === '/v1/sync/changes') {
        const scope = u.searchParams.get('scope'); const after = Number(u.searchParams.get('after') || 0); const limit = Math.min(Number(u.searchParams.get('limit') || 500), 500);
        const all = (S.changes[scope] || []).filter(c => c.seq > after).sort((a, b) => a.seq - b.seq);
        return send(res, 200, { scope, changes: all.slice(0, limit), more: all.length > limit });
      }
      if (m === 'POST' && p === '/v1/sync/cursor') { S.cursors[`${tid}:${body.scope}`] = Math.max(S.cursors[`${tid}:${body.scope}`] || 0, body.seq); return send(res, 204); }
      return err(res, 404, 'NOT_FOUND', `${m} ${p}`);
    });
  });
  const ivw = i => ({ intentId: i.intent_id, state: i.state, type: i.type, amountMinor: i.amount_minor, payload: i.payload, mwRef: i.mw_ref || null });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}`;
    resolve({ url, state: S, close: () => new Promise(r => server.close(r)), addChange: (scope, c) => { const seq = (S.changes[scope].slice(-1)[0] || { seq: 0 }).seq + 1; S.changes[scope].push({ seq, priority: scope === 'recall', op: 'upsert', ...c }); return seq; } });
  }));
}

module.exports = { start };
if (require.main === module) start(Number(process.argv[2]) || 8790).then(m => { m.state.terminals.add(process.argv[3] || '11111111-2222-3333-4444-555555555555'); console.log('mock Smartel backend on', m.url); });
