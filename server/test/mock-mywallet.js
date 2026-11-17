// A stand-in for the My Wallet API v4 POS endpoints, for the smoke test. It checks request signatures exactly the way
// the Laravel middleware does (MerchantSignature.php) and keeps payments in memory.
const http = require('http');
const crypto = require('crypto');

function start({ agent = '100045', password = '9911' } = {}) {
  const keys = {}; const payments = {}; const idem = {}; const nonces = new Set(); const calls = [];
  const out = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(status < 400 ? { ok: true, data } : { ok: false, error: data })); };
  const view = p => ({ id: p.id, code: p.code, status: p.status, amount: p.amount, merchant_reference: p.merchant_reference, channel: p.channel, payer_member: p.payer_member,
    payer_cell: p.payer_cell, merchant_fee: Math.round(p.amount) / 100, refunded: p.refunded, reference: p.reference, expires_at: p.expires_at,
    paid_at: p.paid_at, ...(p.channel === 'nps' ? { instructions: `Send from your wallet to 26662223344 with reference ${p.code}`, pay_to: { member: '2010002', wallet: '26662223344', reference: p.code } } : {}) });
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      calls.push({ method: req.method, url: req.url, headers: req.headers, body });
      const j = body ? JSON.parse(body) : {};
      if (req.method === 'POST' && req.url === '/api/v4/merchant/activate') {
        if (j.agent_no !== agent || j.password !== password) return out(res, 401, { code: 'INVALID_CREDENTIALS', message: 'The agent number or password is wrong.' });
        const kid = 'mk_' + crypto.randomBytes(6).toString('hex'), secret = 'sk_' + crypto.randomBytes(24).toString('hex');
        for (const k of Object.values(keys)) if (k.install === j.install_id) k.active = false;
        keys[kid] = { secret, install: j.install_id, active: true };
        return out(res, 201, { key_id: kid, secret, till_number: agent, name: 'Lesedi General Dealer', cell: '62223344' });
      }
      // signature check (as the v4 middleware)
      const h = req.headers; const k = keys[h['x-key-id']];
      if (!k || !k.active) return out(res, 401, { code: 'UNAUTHENTICATED', message: 'Unknown or disabled merchant key.' });
      if (Math.abs(Date.now() / 1000 - Number(h['x-timestamp'])) > 300) return out(res, 401, { code: 'CLOCK_SKEW', message: 'clock' });
      const base = [h['x-timestamp'], h['x-nonce'], req.method, req.url, crypto.createHash('sha256').update(body).digest('hex')].join('\n');
      const want = crypto.createHmac('sha256', k.secret).update(base).digest('hex');
      if (want !== h['x-signature']) return out(res, 401, { code: 'BAD_SIGNATURE', message: 'The request signature does not match.' });
      if (nonces.has(h['x-nonce'])) return out(res, 401, { code: 'REPLAYED', message: 'replayed' });
      nonces.add(h['x-nonce']);
      const ik = h['idempotency-key'];
      if (ik && idem[ik]) { res.writeHead(idem[ik].status, { 'Content-Type': 'application/json', 'Idempotent-Replay': 'true' }); return res.end(idem[ik].body); }
      const remember = (status, data) => { const b = JSON.stringify(status < 400 ? { ok: true, data } : { ok: false, error: data }); if (ik) idem[ik] = { status, body: b }; res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(b); };
      let m;
      if (req.method === 'GET' && req.url === '/api/v4/pos/me') return out(res, 200, { till_number: agent, name: 'Lesedi General Dealer', cell: '62223344', balance_today: 0, merchant_fee_percent: 1 });
      if (req.method === 'POST' && req.url === '/api/v4/pos/payments') {
        if (!ik) return out(res, 400, { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'key' });
        const id = crypto.randomUUID(), code = crypto.randomBytes(3).toString('hex').toUpperCase();
        payments[id] = { id, code, status: 'PENDING', amount: j.amount, merchant_reference: j.merchant_reference, channel: j.payer_member === '2010002' ? 'wallet' : 'nps',
          payer_member: j.payer_member, payer_cell: j.payer_cell || null, refunded: 0, expires_at: new Date(Date.now() + 300000).toISOString(), paid_at: null, reference: null };
        return remember(201, view(payments[id]));
      }
      if ((m = req.url.match(/^\/api\/v4\/pos\/payments\/([^/]+)(\/(cancel|refund))?$/))) {
        const p = payments[m[1]]; if (!p) return out(res, 404, { code: 'NOT_FOUND', message: 'Payment not found.' });
        if (!m[3] && req.method === 'GET') return out(res, 200, view(p));
        if (m[3] === 'cancel') { if (p.status !== 'PENDING') return out(res, 409, { code: 'NOT_CANCELLABLE', message: 'not pending' }); p.status = 'CANCELLED'; return out(res, 200, view(p)); }
        if (m[3] === 'refund') {
          if (!ik) return out(res, 400, { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'key' });
          const amt = j.amount ?? (p.amount - p.refunded);
          if (amt > p.amount - p.refunded + 1e-9) return out(res, 422, { code: 'INVALID_AMOUNT', message: 'too much' });
          p.refunded = Math.round((p.refunded + amt) * 100) / 100; p.status = p.refunded >= p.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
          return remember(201, { refund: { reference: 'MW4R.' + crypto.randomBytes(3).toString('hex').toUpperCase(), amount: amt, status: p.channel === 'nps' ? 'PENDING' : 'DONE' }, payment: view(p) });
        }
      }
      out(res, 404, { code: 'NOT_FOUND', message: 'Not found.' });
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({
    url: `http://127.0.0.1:${srv.address().port}`, calls, payments, keys,
    pay: (code, cell = '58001122') => { const p = Object.values(payments).find(x => x.code === code); p.status = 'PAID'; p.payer_cell = cell; p.paid_at = new Date().toISOString(); p.reference = 'MW4P.171126.' + code; },
    close: () => srv.close()
  })));
}
module.exports = { start };
