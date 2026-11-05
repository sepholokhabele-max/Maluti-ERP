// Value Added Services (airtime, data, prepaid electricity, ...) and plugin management
const express = require('express');
const db = require('../db');
const plugins = require('../services/plugins');
const accounting = require('../services/accounting');
const pos = require('../services/pos');
const { requirePerm } = require('../auth');
const { ah, bad, round2, pad } = require('../util');

const r = express.Router();

// ---------- plugin admin ----------
r.get('/plugins', requirePerm('settings'), ah(async (req, res) => {
  const out = [];
  for (const p of plugins.list()) {
    const st = await plugins.getState(p.id);
    // never send secrets back in clear
    const cfg = { ...st.config };
    for (const f of p.config || []) if (f.secret && cfg[f.key]) cfg[f.key] = '********';
    out.push({ ...p, enabled: st.enabled, values: cfg });
  }
  res.json({ plugins: out, dirs: plugins.dirs() });
}));
r.put('/plugins/:id', requirePerm('settings'), ah(async (req, res) => {
  const p = plugins.list().find(x => x.id === req.params.id);
  if (!p) throw bad('Unknown plugin');
  const st = await plugins.getState(p.id);
  const cfg = { ...st.config };
  for (const f of p.config || []) {
    if (req.body.values && req.body.values[f.key] !== undefined) {
      const v = req.body.values[f.key];
      if (f.secret && v === '********') continue;
      cfg[f.key] = f.type === 'number' ? Number(v) : f.type === 'boolean' ? !!v : v;
    }
  }
  await db.query(`INSERT INTO plugins (id, enabled, config) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), config = VALUES(config)`,
    [p.id, req.body.enabled ? 1 : 0, JSON.stringify(cfg)]);
  res.json({ ok: true });
}));
r.post('/plugins/reload', requirePerm('settings'), ah(async (req, res) => {
  res.json(plugins.loadAll(plugins.dirs()));
}));
r.post('/plugins/:id/test', requirePerm('settings'), ah(async (req, res) => {
  const p = await plugins.get(req.params.id, { requireEnabled: false });
  const result = {};
  if (p.impl.balance) result.balance = await p.impl.balance(p.config).catch(e => ({ error: e.message }));
  if (p.impl.listServices) result.services = await p.impl.listServices(p.config).catch(e => ({ error: e.message }));
  res.json(result);
}));

// ---------- VAS selling ----------
r.post('/lookup', requirePerm('vas'), ah(async (req, res) => {
  const { plugin_id, ...args } = req.body;
  const p = await plugins.get(plugin_id);
  if (!p.impl.lookup) return res.json({ ok: true, message: 'Lookup not supported by this provider' });
  res.json(await p.impl.lookup(p.config, args));
}));

r.get('/balance/:plugin', requirePerm('vas'), ah(async (req, res) => {
  res.json(await plugins.call(req.params.plugin, 'balance'));
}));

/**
 * Sell a VAS product: payment is taken at the till, the provider is called,
 * and on success a paid POS order is created carrying the voucher/token.
 * body: { plugin_id, service, provider, product_code, recipient, amount, session_id, payments:[...] }
 */
r.post('/purchase', requirePerm('vas'), ah(async (req, res) => {
  await require('../services/activation').assertCanSell();
  const b = req.body;
  const amount = round2(b.amount);
  if (!(amount > 0)) throw bad('Enter an amount');
  if (!b.recipient) throw bad('Enter the phone number / meter number');
  const session = await db.tx(c => pos.requireOpenSession(c, b.session_id));
  const p = await plugins.get(b.plugin_id);
  if (await require('../services/smartel').enabled() && /my ?wallet/i.test(`${p.manifest.id} ${p.manifest.name} ${JSON.stringify(p.config || {})}`))
    throw bad('My Wallet services now go through the Smartel POS backend. Use "Agent services" on the till.');
  // validate tendered payment before calling the provider
  const methods = new Map((await db.query('SELECT * FROM payment_methods WHERE active = 1')).map(m => [m.id, m]));
  const pays = (b.payments || []).filter(x => Number(x.amount) > 0).map(x => ({ ...x, amount: round2(x.amount), m: methods.get(Number(x.method_id)) }));
  if (pays.some(x => !x.m)) throw bad('Invalid payment method');
  if (pays.some(x => x.m.kind === 'account')) throw bad('VAS cannot be sold on account');
  for (const x of pays) if (x.m.requires_reference && !x.reference) throw bad(`${x.m.name} needs a reference`);
  const tendered = round2(pays.reduce((s, x) => s + x.amount, 0));
  const nonCash = round2(pays.filter(x => x.m.kind !== 'cash').reduce((s, x) => s + x.amount, 0));
  if (tendered + 0.001 < amount) throw bad(`Payment short by ${round2(amount - tendered)}`);
  if (nonCash > amount + 0.001) throw bad('Card / mobile money cannot exceed the amount');

  const ins = await db.query(
    `INSERT INTO vas_transactions (plugin_id, service, provider, product_code, recipient, amount, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [p.manifest.id, b.service, b.provider || null, b.product_code || null, b.recipient, amount, req.user.id]);
  const vasId = ins.insertId;
  let result;
  try {
    result = await p.impl.purchase(p.config, { service: b.service, provider: b.provider, product_code: b.product_code,
      recipient: String(b.recipient).trim(), amount, reference: `VAS${pad(vasId, 8)}` });
  } catch (e) {
    result = { status: 'failed', message: e.message };
  }
  const status = ['success', 'pending', 'failed'].includes(result.status) ? result.status : 'failed';
  const commission = round2(result.commission ?? (amount * Number(p.config.commission_pct || 0) / 100));
  await db.query(`UPDATE vas_transactions SET status = ?, provider_ref = ?, token = ?, message = ?, commission = ?, response = ? WHERE id = ?`,
    [status, result.provider_ref || null, result.token || null, (result.message || '').slice(0, 250), status === 'failed' ? 0 : commission,
      JSON.stringify(result.raw || result), vasId]);
  if (status === 'failed') return res.status(502).json({ error: `Provider declined: ${result.message || 'unknown error'}. No money was taken.`, vas_id: vasId });

  // Success / pending: record the sale
  const out = await db.tx(async c => {
    const label = `${b.service}${b.provider ? ' ' + b.provider : ''} → ${b.recipient}`;
    const o = await c.query(
      `INSERT INTO orders (session_id, terminal_id, user_id, mode, status, subtotal, tax_total, total, paid_total, change_given, paid_at)
       VALUES (?, ?, ?, 'retail', 'paid', ?, 0, ?, ?, ?, NOW())`,
      [session.id, session.terminal_id, req.user.id, amount, amount, tendered, round2(tendered - amount)]);
    const number = `VAS/${new Date().getFullYear()}/${pad(o.insertId)}`;
    // cost of a VAS sale is what the provider keeps, so gross profit = commission
    await c.query('UPDATE orders SET number = ?, cost_total = ? WHERE id = ?', [number, round2(amount - commission), o.insertId]);
    await pos.insertLines(c, o.insertId, [{ product_id: null, name: label, qty: 1, unit_price: amount, tax_rate: 0, price_includes_tax: 1,
      net_amount: amount, tax_amount: 0, line_total: amount, unit_cost: 0, note: result.token ? `Token: ${result.token}` : null,
      kitchen_status: 'served', vas_transaction_id: vasId }]);
    await c.query('UPDATE vas_transactions SET order_id = ? WHERE id = ?', [o.insertId, vasId]);
    let change = round2(tendered - amount);
    const jl = [];
    for (const x of pays) {
      let applied = x.amount;
      if (x.m.kind === 'cash' && change > 0) { const d = Math.min(applied, change); applied = round2(applied - d); change = round2(change - d); }
      if (applied <= 0) continue;
      await c.query(`INSERT INTO payments (direction, order_id, method_id, amount, reference, phone, session_id, user_id) VALUES ('in', ?, ?, ?, ?, ?, ?, ?)`,
        [o.insertId, x.m.id, applied, x.reference || null, x.phone || null, session.id, req.user.id]);
      jl.push({ code: x.m.account_code, debit: applied, description: x.m.name });
    }
    // Float is consumed by (amount - commission); commission is our income
    jl.push({ code: '1300', credit: round2(amount - commission), description: `VAS float ${p.manifest.id}` });
    jl.push({ code: '4100', credit: commission, description: 'VAS commission' });
    await accounting.post(c, { reference: number, memo: label, source_type: 'vas', source_id: vasId, user_id: req.user.id, lines: jl });
    return { order_id: o.insertId, number };
  });
  res.json({ status, token: result.token, provider_ref: result.provider_ref, message: result.message, ...out,
    order: await db.tx(c => pos.getOrder(c, out.order_id)) });
}));

r.post('/transactions/:id/check', requirePerm('vas'), ah(async (req, res) => {
  const t = await db.one('SELECT * FROM vas_transactions WHERE id = ?', [req.params.id]);
  if (!t) throw bad('Not found');
  const result = await plugins.call(t.plugin_id, 'checkStatus', { provider_ref: t.provider_ref, reference: `VAS${pad(t.id, 8)}` });
  if (result.status && result.status !== t.status) {
    await db.query('UPDATE vas_transactions SET status = ?, token = COALESCE(?, token), message = ? WHERE id = ?',
      [result.status, result.token || null, result.message || null, t.id]);
  }
  res.json({ ...t, ...result });
}));

r.get('/transactions', requirePerm('vas'), ah(async (req, res) => {
  res.json(await db.query(
    `SELECT v.*, u.name user_name FROM vas_transactions v LEFT JOIN users u ON u.id = v.user_id ORDER BY v.id DESC LIMIT 300`));
}));

// Record float top-up paid to the VAS provider (e.g. bank transfer to My Wallet)
r.post('/float-topup', requirePerm('accounting'), ah(async (req, res) => {
  const amount = round2(req.body.amount);
  if (!(amount > 0)) throw bad('Amount required');
  await db.tx(c => accounting.post(c, {
    reference: req.body.reference || 'VAS-TOPUP', memo: `VAS float top-up ${req.body.plugin_id || ''}`, source_type: 'vas_topup', user_id: req.user.id,
    lines: [{ code: '1300', debit: amount }, { code: req.body.from_account || '1050', credit: amount }]
  }));
  res.json({ ok: true });
}));

// ---------- mobile money push payments via payment plugins ----------
r.post('/payments/request', requirePerm('pos'), ah(async (req, res) => {
  const m = await db.one('SELECT * FROM payment_methods WHERE id = ?', [req.body.method_id]);
  if (!m || !m.plugin_id) throw bad('This payment method has no payment plugin attached');
  res.json(await plugins.call(m.plugin_id, 'requestPayment', { phone: req.body.phone, amount: round2(req.body.amount), reference: req.body.reference || `POS${Date.now()}` }));
}));
r.post('/payments/status', requirePerm('pos'), ah(async (req, res) => {
  const m = await db.one('SELECT * FROM payment_methods WHERE id = ?', [req.body.method_id]);
  if (!m || !m.plugin_id) throw bad('This payment method has no payment plugin attached');
  res.json(await plugins.call(m.plugin_id, 'checkStatus', { provider_ref: req.body.provider_ref }));
}));

module.exports = r;
