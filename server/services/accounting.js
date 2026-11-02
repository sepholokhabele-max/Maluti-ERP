// Double-entry posting helpers. Every business document posts a balanced journal entry.
const { round2, bad } = require('../util');

// Default chart of accounts (codes are referenced throughout the app)
const DEFAULT_ACCOUNTS = [
  ['1000', 'Cash on Hand', 'asset'],
  ['1010', 'Card Clearing', 'asset'],
  ['1020', 'Mobile Money Wallet', 'asset'],
  ['1050', 'Bank Account', 'asset'],
  ['1100', 'Accounts Receivable', 'asset'],
  ['1200', 'Inventory', 'asset'],
  ['1300', 'VAS Float (Prepaid with provider)', 'asset'],
  ['1400', 'VAT Input (Claimable)', 'asset'],
  ['2000', 'Accounts Payable', 'liability'],
  ['2050', 'Goods Received Not Invoiced', 'liability'],
  ['2100', 'VAT Output (Payable)', 'liability'],
  ['2200', 'PAYE Payable (RSL)', 'liability'],
  ['2210', 'Payroll Deductions Payable', 'liability'],
  ['2300', 'Net Salaries Payable', 'liability'],
  ['3000', "Owner's Equity", 'equity'],
  ['3100', 'Retained Earnings', 'equity'],
  ['4000', 'Sales Revenue', 'income'],
  ['4100', 'VAS Commission Income', 'income'],
  ['4200', 'Other Income', 'income'],
  ['4900', 'Sales Returns & Refunds', 'income'],
  ['5000', 'Cost of Goods Sold', 'expense'],
  ['5100', 'Inventory Adjustments', 'expense'],
  ['5150', 'Stock Losses & Wastage', 'expense'],
  ['6000', 'General Expenses', 'expense'],
  ['6100', 'Rent', 'expense'],
  ['6200', 'Salaries & Wages', 'expense'],
  ['6300', 'Utilities', 'expense'],
  ['6900', 'Cash Over/Short', 'expense']
];

const accountCache = new Map();

async function accountId(conn, code) {
  if (accountCache.has(code)) return accountCache.get(code);
  const a = await conn.one('SELECT id FROM accounts WHERE code = ?', [code]);
  if (!a) throw bad(`Account ${code} missing from chart of accounts`);
  accountCache.set(code, a.id);
  return a.id;
}

/**
 * Post a journal entry. lines: [{ code, debit, credit, partner_id, description }]
 * Lines with zero amounts are skipped. Throws if not balanced.
 */
async function post(conn, { date, reference, memo, source_type, source_id, user_id, lines }) {
  const clean = lines
    .map(l => ({ ...l, debit: round2(l.debit || 0), credit: round2(l.credit || 0) }))
    .filter(l => l.debit !== 0 || l.credit !== 0);
  if (!clean.length) return null;
  const dr = round2(clean.reduce((s, l) => s + l.debit, 0));
  const cr = round2(clean.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(dr - cr) > 0.009) throw bad(`Unbalanced journal entry ${reference}: debit ${dr} vs credit ${cr}`);
  const r = await conn.query(
    `INSERT INTO journal_entries (entry_date, reference, memo, source_type, source_id, user_id)
     VALUES (COALESCE(?, CURDATE()), ?, ?, ?, ?, ?)`,
    [date || null, reference || null, memo || null, source_type || null, source_id || null, user_id || null]);
  for (const l of clean) {
    await conn.query(
      'INSERT INTO journal_lines (entry_id, account_id, partner_id, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?)',
      [r.insertId, await accountId(conn, l.code), l.partner_id || null, l.description || null, l.debit, l.credit]);
  }
  return r.insertId;
}

/** Reverse every journal entry created for a source document */
async function reverseSource(conn, source_type, source_id, { reference, user_id } = {}) {
  const entries = await conn.query('SELECT id FROM journal_entries WHERE source_type = ? AND source_id = ?', [source_type, source_id]);
  for (const e of entries) {
    const lines = await conn.query(
      'SELECT a.code, l.debit, l.credit, l.partner_id, l.description FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ?', [e.id]);
    await post(conn, {
      reference: reference || `REV-${source_type}-${source_id}`, memo: 'Reversal',
      source_type: `${source_type}_reversal`, source_id, user_id,
      lines: lines.map(l => ({ code: l.code, debit: l.credit, credit: l.debit, partner_id: l.partner_id, description: l.description }))
    });
  }
}

module.exports = { DEFAULT_ACCOUNTS, post, reverseSource, accountId, clearCache: () => accountCache.clear() };
