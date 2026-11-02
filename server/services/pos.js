// POS business logic: building orders, taking payment, refunds, sessions.
const { round2, bad, notFound, lineAmounts, pad, HttpError } = require('../util');
const accounting = require('./accounting');
const stock = require('./stock');
const { can } = require('../auth');

/** Turn raw lines from the client into fully priced lines (server is the source of truth for prices). */
async function buildLines(conn, rawLines, user) {
  const out = [];
  for (const raw of rawLines || []) {
    const qty = Number(raw.qty);
    if (!qty || !isFinite(qty)) continue;
    let line;
    if (raw.product_id) {
      const p = await conn.one(
        `SELECT p.*, t.rate tax_rate, t.price_includes_tax, c.station
         FROM products p LEFT JOIN taxes t ON t.id = p.tax_id LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.id = ?`, [raw.product_id]);
      if (!p) throw bad(`Product ${raw.product_id} not found`);
      let unit_price = Number(p.price);
      if (raw.unit_price !== undefined && Number(raw.unit_price) !== unit_price) {
        if (Number(p.price) !== 0 && !can(user, 'pos.discount')) throw new HttpError(403, 'Price override needs manager permission');
        unit_price = Number(raw.unit_price);
      }
      line = {
        id: raw.id || null, product_id: p.id, name: p.name, qty, unit_price,
        tax_rate: Number(p.tax_rate || 0), price_includes_tax: p.price_includes_tax == null ? 1 : p.price_includes_tax,
        unit_cost: Number(p.cost), station: p.station || 'none', type: p.type, uom: p.uom
      };
      // bar measure (tot / glass) poured from a bottle: costed as its share of the bottle
      if (p.pour_from_id && Number(p.pour_ml) > 0) {
        const b = await conn.one('SELECT cost, bottle_ml FROM products WHERE id = ?', [p.pour_from_id]);
        if (b && Number(b.bottle_ml) > 0) { line.unit_cost = Number(b.cost) * Number(p.pour_ml) / Number(b.bottle_ml); line.type = 'consumable'; }
      }
    } else {
      // free-text line (e.g. misc item)
      if (!can(user, 'pos.discount')) throw new HttpError(403, 'Custom items need manager permission');
      line = { id: raw.id || null, product_id: null, name: String(raw.name || 'Item'), qty, unit_price: Number(raw.unit_price || 0),
        tax_rate: Number(raw.tax_rate || 0), price_includes_tax: 1, unit_cost: 0, station: 'none', type: 'service' };
    }
    const disc = Number(raw.discount_pct || 0);
    if (disc && !can(user, 'pos.discount')) throw new HttpError(403, 'Discounts need manager permission');
    if (disc < 0 || disc > 100) throw bad('Discount must be 0–100%');
    line.discount_pct = disc;
    line.note = raw.note ? String(raw.note).slice(0, 250) : null;
    const a = lineAmounts(line);
    line.net_amount = a.net; line.tax_amount = a.tax; line.line_total = a.total;
    // price-embedded scale label: charge exactly the printed price (qty was derived from it, so it can only differ by rounding)
    if (raw.label_total !== undefined && raw.label_total !== null && raw.product_id && Number(line.unit_price) > 0) {
      const lt = round2(raw.label_total);
      if (!(lt > 0) || Math.abs(lt - a.total) > Math.max(0.05, a.total * 0.002)) throw bad(`Scale label price ${lt} does not match ${line.name}'s price per ${line.uom || 'kg'}`);
      const r = Number(line.tax_rate || 0) / 100;
      line.line_total = lt; line.net_amount = round2(lt / (1 + r));
      line.tax_amount = round2(lt - line.net_amount); line.label_total = lt;
    }
    line.discount_amount = round2(qty * line.unit_price * disc / 100);
    out.push(line);
  }
  return out;
}

function totals(lines) {
  const sum = k => round2(lines.reduce((s, l) => s + Number(l[k] || 0), 0));
  return {
    subtotal: sum('net_amount'), tax_total: sum('tax_amount'), total: sum('line_total'),
    discount_total: sum('discount_amount'),
    cost_total: round2(lines.reduce((s, l) => s + (l.type === 'service' ? 0 : Number(l.qty) * Number(l.unit_cost)), 0))
  };
}

/** bottles used by a bar-measure line (qty × ml / bottle size), or null if the line is not a measure */
function pourBottles(l) {
  if (!l.product_id || !l.pour_from_id || !(Number(l.pour_ml) > 0) || !(Number(l.pour_bottle_ml) > 0)) return null;
  return Math.round(Number(l.qty) * Number(l.pour_ml) / Number(l.pour_bottle_ml) * 10000) / 10000;
}

async function insertLines(conn, orderId, lines) {
  for (const l of lines) {
    await conn.query(
      `INSERT INTO order_lines (order_id, product_id, name, qty, unit_price, discount_pct, tax_rate, price_includes_tax,
        net_amount, tax_amount, line_total, unit_cost, note, station, kitchen_status, vas_transaction_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderId, l.product_id, l.name, l.qty, l.unit_price, l.discount_pct || 0, l.tax_rate, l.price_includes_tax,
        l.net_amount, l.tax_amount, l.line_total, l.unit_cost, l.note, l.station || 'none', l.kitchen_status || 'pending',
        l.vas_transaction_id || null]);
  }
}

async function getOrder(conn, id) {
  const o = await conn.one(
    `SELECT o.*, u.name user_name, t.name table_name, p.name partner_name, pt.name terminal_name
     FROM orders o LEFT JOIN users u ON u.id = o.user_id LEFT JOIN restaurant_tables t ON t.id = o.table_id
     LEFT JOIN partners p ON p.id = o.partner_id LEFT JOIN pos_terminals pt ON pt.id = o.terminal_id WHERE o.id = ?`, [id]);
  if (!o) throw notFound('Order');
  o.lines = await conn.query('SELECT * FROM order_lines WHERE order_id = ? ORDER BY id', [id]);
  o.payments = await conn.query(
    `SELECT p.*, m.name method_name, m.kind FROM payments p JOIN payment_methods m ON m.id = p.method_id WHERE p.order_id = ? ORDER BY p.id`, [id]);
  o.vas = await conn.query('SELECT * FROM vas_transactions WHERE order_id = ?', [id]);
  // quantities already refunded per original line (matched by product + name)
  const ref = await conn.query(
    `SELECT l.product_id, l.name, SUM(-l.qty) qty FROM order_lines l JOIN orders r ON r.id = l.order_id WHERE r.refund_of = ? GROUP BY l.product_id, l.name`, [id]);
  for (const l of o.lines) {
    const r = ref.find(x => x.product_id === l.product_id && x.name === l.name);
    l.refunded_qty = r ? Number(r.qty) : 0;
  }
  await require('./qr').decorateOrder(conn, o);
  return o;
}

async function requireOpenSession(conn, sessionId) {
  const s = await conn.one(`SELECT * FROM pos_sessions WHERE id = ? AND status = 'open'`, [sessionId]);
  if (!s) throw bad('No open cashier session. Open a session first.');
  return s;
}

/** Create or update an open (unpaid) order — used by restaurant tables and bar tabs. */
async function saveOrder(conn, user, body, orderId = null) {
  const lines = await buildLines(conn, body.lines, user);
  if (orderId) {
    const o = await conn.one('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
    if (!o) throw notFound('Order');
    if (o.status !== 'open') throw bad('Order is already closed');
    const existing = await conn.query('SELECT * FROM order_lines WHERE order_id = ?', [orderId]);
    const keep = new Map(existing.map(l => [l.id, l]));
    // removed or reduced lines that were already sent to kitchen need void permission
    for (const ex of existing) {
      const nl = lines.find(l => l.id === ex.id);
      if (ex.kitchen_status !== 'pending' && (!nl || Number(nl.qty) < Number(ex.qty)) && !can(user, 'pos.void'))
        throw new HttpError(403, `"${ex.name}" was already sent to the kitchen/bar. A manager must void it.`);
    }
    for (const l of lines) if (l.id && keep.has(l.id)) {
      const ex = keep.get(l.id);
      l.kitchen_status = ex.kitchen_status;
      l.sent_at = ex.sent_at;
    }
    await conn.query('DELETE FROM order_lines WHERE order_id = ?', [orderId]);
    await insertLines(conn, orderId, lines);
    const t = totals(lines);
    await conn.query(
      `UPDATE orders SET table_id = ?, tab_name = ?, partner_id = ?, guests = ?, notes = ?, subtotal = ?, tax_total = ?, total = ?,
        discount_total = ?, cost_total = ? WHERE id = ?`,
      [body.table_id ?? o.table_id, body.tab_name ?? o.tab_name, body.partner_id ?? o.partner_id, body.guests ?? o.guests,
        body.notes ?? o.notes, t.subtotal, t.tax_total, t.total, t.discount_total, t.cost_total, orderId]);
    return orderId;
  }
  const s = await requireOpenSession(conn, body.session_id);
  const term = await conn.one('SELECT * FROM pos_terminals WHERE id = ?', [s.terminal_id]);
  if (body.table_id) {
    const busy = await conn.one(`SELECT id FROM orders WHERE table_id = ? AND status = 'open'`, [body.table_id]);
    if (busy) throw bad('That table already has an open order');
  }
  const t = totals(lines);
  const r = await conn.query(
    `INSERT INTO orders (session_id, terminal_id, user_id, partner_id, table_id, tab_name, mode, guests, notes,
      subtotal, tax_total, total, discount_total, cost_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [s.id, s.terminal_id, user.id, body.partner_id || null, body.table_id || null, body.tab_name || null,
      body.mode || term.mode, body.guests || 0, body.notes || null, t.subtotal, t.tax_total, t.total, t.discount_total, t.cost_total]);
  await insertLines(conn, r.insertId, lines);
  return r.insertId;
}

async function sendToKitchen(conn, orderId) {
  const r = await conn.query(
    `UPDATE order_lines SET kitchen_status = 'sent', sent_at = NOW()
     WHERE order_id = ? AND kitchen_status = 'pending' AND station <> 'none'`, [orderId]);
  return r.affectedRows;
}

/**
 * Take payment for an open order and post it.
 * payments: [{ method_id, amount, reference, phone }] — amount is what was tendered.
 */
async function payOrder(conn, user, orderId, { payments, partner_id }) {
  const o = await conn.one('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
  if (!o) throw notFound('Order');
  if (o.status !== 'open') throw bad('Order is already closed');
  const s = await requireOpenSession(conn, o.session_id || 0).catch(async () => null);
  // if the order's session was closed (e.g. waiter shift ended) attach to the current user's open session on that terminal
  let sessionId = s ? s.id : null;
  if (!sessionId) {
    const alt = await conn.one(`SELECT id FROM pos_sessions WHERE terminal_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1`, [o.terminal_id]);
    if (!alt) throw bad('No open cashier session for this terminal');
    sessionId = alt.id;
  }
  if (partner_id !== undefined) { o.partner_id = partner_id || null; }
  const lines = await conn.query('SELECT l.*, p.type, p.pour_from_id, p.pour_ml, pb.bottle_ml pour_bottle_ml FROM order_lines l LEFT JOIN products p ON p.id = l.product_id LEFT JOIN products pb ON pb.id = p.pour_from_id WHERE l.order_id = ?', [orderId]);
  if (!lines.length) throw bad('Order has no items');
  const total = round2(o.total);

  // Validate payments
  const methods = new Map((await conn.query('SELECT * FROM payment_methods WHERE active = 1')).map(m => [m.id, m]));
  let nonCash = 0, cash = 0;
  const pays = (payments || []).filter(p => Number(p.amount) > 0).map(p => {
    const m = methods.get(Number(p.method_id));
    if (!m) throw bad('Invalid payment method');
    if (m.requires_reference && !p.reference) throw bad(`${m.name} payments need a transaction reference`);
    if (m.kind === 'account' && !o.partner_id) throw bad('Select a customer to charge to account');
    const amt = round2(p.amount);
    if (m.kind === 'cash') cash += amt; else nonCash += amt;
    return { ...p, amount: amt, m };
  });
  if (total >= 0 && round2(nonCash) > total + 0.001) throw bad('Card / mobile money / account payments cannot exceed the total');
  const tendered = round2(cash + nonCash);
  if (tendered + 0.001 < total) throw bad(`Payment short by ${round2(total - tendered)}`);
  const change = round2(tendered - total);

  // Record payments (cash net of change)
  let changeLeft = change;
  for (const p of pays) {
    let applied = p.amount;
    if (p.m.kind === 'cash' && changeLeft > 0) { const d = Math.min(applied, changeLeft); applied = round2(applied - d); changeLeft = round2(changeLeft - d); }
    p.applied = applied;
    if (applied <= 0) continue;
    await conn.query(
      `INSERT INTO payments (direction, order_id, partner_id, method_id, amount, reference, phone, session_id, user_id)
       VALUES ('in', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderId, o.partner_id, p.m.id, applied, p.reference || null, p.phone || null, sessionId, user.id]);
  }

  // Stock & COGS
  const number = `POS/${new Date().getFullYear()}/${pad(orderId)}`;
  let cogs = 0;
  for (const l of lines) {
    const pourQty = pourBottles(l);
    if (pourQty !== null) {
      const cost = await stock.move(conn, { product_id: l.pour_from_id, qty: -pourQty, move_type: 'sale', reference: number, user_id: user.id, reason: `${l.qty} × ${Number(l.pour_ml)} ml` });
      const uc = cost * Number(l.pour_ml) / Number(l.pour_bottle_ml);
      cogs += Number(l.qty) * uc;
      await conn.query('UPDATE order_lines SET unit_cost = ? WHERE id = ?', [uc, l.id]);
    } else if (l.product_id && l.type === 'stock') {
      const cost = await stock.move(conn, { product_id: l.product_id, qty: -Number(l.qty), move_type: 'sale', reference: number, user_id: user.id });
      cogs += Number(l.qty) * cost;
      await conn.query('UPDATE order_lines SET unit_cost = ? WHERE id = ?', [cost, l.id]);
    } else if (l.product_id && l.type === 'consumable') {
      cogs += Number(l.qty) * Number(l.unit_cost);
    }
  }
  cogs = round2(cogs);

  await conn.query(
    `UPDATE orders SET status = 'paid', number = ?, paid_total = ?, change_given = ?, cost_total = ?, paid_at = NOW(), partner_id = ?, session_id = ?,
     user_id = COALESCE(user_id, ?) WHERE id = ?`,
    [number, tendered, change, cogs, o.partner_id, sessionId, user.id, orderId]);
  await conn.query(`UPDATE order_lines SET kitchen_status = IF(kitchen_status = 'pending' AND station <> 'none', 'sent', kitchen_status) WHERE order_id = ?`, [orderId]);

  // Journal: Dr payment accounts, Cr sales & VAT, Dr COGS / Cr Inventory
  const jl = [];
  for (const p of pays) if (p.applied > 0) jl.push({ code: p.m.account_code, debit: p.applied, partner_id: p.m.kind === 'account' ? o.partner_id : null, description: p.m.name });
  jl.push({ code: '4000', credit: round2(o.subtotal), description: 'POS sales' });
  jl.push({ code: '2100', credit: round2(o.tax_total), description: 'VAT on sales' });
  if (cogs) { jl.push({ code: '5000', debit: cogs }); jl.push({ code: '1200', credit: cogs }); }
  await accounting.post(conn, { reference: number, memo: `POS order ${number}`, source_type: 'pos_order', source_id: orderId, user_id: user.id, lines: jl });

  return { order_id: orderId, number, change };
}

/** Refund some or all lines of a paid order */
async function refundOrder(conn, user, orderId, { lines: reqLines, method_id, reason, session_id }) {
  const o = await conn.one('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
  if (!o) throw notFound('Order');
  if (o.status !== 'paid' || o.refund_of) throw bad('Only paid sales can be refunded');
  const s = (session_id && await conn.one(`SELECT id FROM pos_sessions WHERE id = ? AND status = 'open'`, [session_id]))
    || await conn.one(`SELECT id FROM pos_sessions WHERE user_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1`, [user.id])
    || await conn.one(`SELECT id FROM pos_sessions WHERE terminal_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1`, [o.terminal_id]);
  if (!s) throw bad('Open a cashier session to process refunds');
  const origLines = await conn.query('SELECT l.*, p.type, p.pour_from_id, p.pour_ml, pb.bottle_ml pour_bottle_ml FROM order_lines l LEFT JOIN products p ON p.id = l.product_id LEFT JOIN products pb ON pb.id = p.pour_from_id WHERE order_id = ?', [orderId]);
  const already = await conn.query(
    `SELECT l.product_id, l.name, SUM(-l.qty) qty FROM order_lines l JOIN orders r ON r.id = l.order_id WHERE r.refund_of = ? GROUP BY l.product_id, l.name`, [orderId]);
  const reqMap = new Map((reqLines || origLines.map(l => ({ line_id: l.id, qty: l.qty }))).map(l => [Number(l.line_id), Number(l.qty)]));
  const refundLines = [];
  for (const l of origLines) {
    const q = reqMap.get(l.id);
    if (!q) continue;
    if (l.vas_transaction_id) throw bad('Value-added services (airtime/electricity) cannot be refunded at the till');
    const done = already.find(a => a.product_id === l.product_id && a.name === l.name);
    const avail = Number(l.qty) - (done ? Number(done.qty) : 0);
    if (q > avail + 1e-9) throw bad(`Cannot refund more than ${avail} of ${l.name}`);
    const ratio = q / Number(l.qty);
    refundLines.push({ ...l, qty: -q, net_amount: -round2(l.net_amount * ratio), tax_amount: -round2(l.tax_amount * ratio),
      line_total: -round2(l.line_total * ratio), kitchen_status: 'served' });
  }
  if (!refundLines.length) throw bad('Nothing to refund');
  const t = totals(refundLines);
  const method = await conn.one('SELECT * FROM payment_methods WHERE id = ?', [method_id || 1]);
  if (!method) throw bad('Invalid refund method');
  const r = await conn.query(
    `INSERT INTO orders (session_id, terminal_id, user_id, partner_id, mode, status, subtotal, tax_total, total, paid_total, refund_of, notes, paid_at)
     VALUES (?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?, ?, NOW())`,
    [s.id, o.terminal_id, user.id, o.partner_id, o.mode, t.subtotal, t.tax_total, t.total, t.total, orderId, reason || 'Refund']);
  const rid = r.insertId;
  const number = `RF/${new Date().getFullYear()}/${pad(rid)}`;
  await insertLines(conn, rid, refundLines);
  let cost = 0;
  for (const l of refundLines) {
    const pourQty = pourBottles(l);
    if (pourQty !== null) {
      const bc = Number(l.unit_cost) * Number(l.pour_bottle_ml) / Number(l.pour_ml);
      await stock.move(conn, { product_id: l.pour_from_id, qty: -pourQty, unit_cost: bc, move_type: 'refund', reference: number, user_id: user.id });
      cost += -l.qty * Number(l.unit_cost);
    } else if (l.product_id && l.type === 'stock') {
      await stock.move(conn, { product_id: l.product_id, qty: -l.qty, unit_cost: l.unit_cost, move_type: 'refund', reference: number, user_id: user.id });
      cost += -l.qty * Number(l.unit_cost);
    }
  }
  cost = round2(cost);
  await conn.query('UPDATE orders SET number = ?, cost_total = ? WHERE id = ?', [number, -cost, rid]);
  await conn.query(
    `INSERT INTO payments (direction, order_id, partner_id, method_id, amount, reference, session_id, user_id) VALUES ('out', ?, ?, ?, ?, ?, ?, ?)`,
    [rid, o.partner_id, method.id, -t.total, `Refund of ${o.number}`, s.id, user.id]);
  const fully = (await conn.one(
    `SELECT COALESCE(SUM(-total),0) refunded FROM orders WHERE refund_of = ?`, [orderId])).refunded >= Number(o.total) - 0.009;
  if (fully) await conn.query(`UPDATE orders SET status = 'refunded' WHERE id = ?`, [orderId]);
  await accounting.post(conn, {
    reference: number, memo: `Refund of ${o.number}`, source_type: 'pos_refund', source_id: rid, user_id: user.id,
    lines: [
      { code: '4900', debit: -t.subtotal }, { code: '2100', debit: -t.tax_total },
      { code: method.account_code, credit: -t.total, partner_id: method.kind === 'account' ? o.partner_id : null },
      { code: '1200', debit: cost }, { code: '5000', credit: cost }
    ]
  });
  return { refund_id: rid, number, amount: -t.total };
}

async function sessionSummary(conn, sessionId) {
  const s = await conn.one(
    `SELECT s.*, t.name terminal_name, t.mode, u.name user_name FROM pos_sessions s
     JOIN pos_terminals t ON t.id = s.terminal_id JOIN users u ON u.id = s.user_id WHERE s.id = ?`, [sessionId]);
  if (!s) throw notFound('Session');
  s.payments = await conn.query(
    `SELECT m.id method_id, m.name, m.kind, SUM(CASE WHEN p.direction = 'in' THEN p.amount ELSE -p.amount END) amount, COUNT(*) count
     FROM payments p JOIN payment_methods m ON m.id = p.method_id
     WHERE p.session_id = ? AND p.status = 'completed' GROUP BY m.id`, [sessionId]);
  const sales = await conn.one(
    `SELECT COUNT(*) orders, COALESCE(SUM(total),0) total FROM orders WHERE session_id = ? AND status IN ('paid','refunded') AND refund_of IS NULL`, [sessionId]);
  s.sales = sales;
  const cashIn = s.payments.filter(p => p.kind === 'cash').reduce((a, p) => a + Number(p.amount), 0);
  s.expected_cash_now = round2(Number(s.opening_cash) + cashIn);
  return s;
}

async function closeSession(conn, user, sessionId, { counted_cash, notes }) {
  const s = await sessionSummary(conn, sessionId);
  if (s.status !== 'open') throw bad('Session already closed');
  if (s.user_id !== user.id && !can(user, 'sessions')) throw new HttpError(403, 'Only the session owner or a manager can close it');
  const counted = round2(counted_cash || 0);
  const diff = round2(counted - s.expected_cash_now);
  await conn.query(`UPDATE pos_sessions SET status = 'closed', closed_at = NOW(), expected_cash = ?, counted_cash = ?, notes = ? WHERE id = ?`,
    [s.expected_cash_now, counted, notes || null, sessionId]);
  if (diff !== 0) {
    await accounting.post(conn, {
      reference: `SESSION-${sessionId}`, memo: `Cash ${diff > 0 ? 'over' : 'short'} on session close`,
      source_type: 'pos_session', source_id: sessionId, user_id: user.id,
      lines: diff > 0
        ? [{ code: '1000', debit: diff }, { code: '6900', credit: diff }]
        : [{ code: '6900', debit: -diff }, { code: '1000', credit: -diff }]
    });
  }
  return { ...s, status: 'closed', counted_cash: counted, difference: diff };
}

module.exports = { buildLines, totals, insertLines, getOrder, saveOrder, sendToKitchen, payOrder, refundOrder, sessionSummary, closeSession, requireOpenSession };
