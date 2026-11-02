// Google Wallet "save" link for a receipt, as a Generic pass (signed JWT, RS256).
// Docs: developers.google.com/wallet/generic  –  link format https://pay.google.com/gp/v/save/<jwt>
const crypto = require('crypto');

module.exports = () => {
  const b64u = x => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
  const lv = v => ({ defaultValue: { language: 'en', value: String(v) } });

  function sign(claims, pem) {
    const unsigned = `${b64u({ alg: 'RS256', typ: 'JWT' })}.${b64u(claims)}`;
    const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(pem.replace(/\\n/g, '\n'));
    return `${unsigned}.${sig.toString('base64url')}`;
  }

  return {
    async addToWallet(c, { company, order: o, receipt_url, token }) {
      if (!c.issuer_id || !c.service_account_email || !c.private_key) return null;
      const sym = company.currency_symbol || 'M';
      const money = n => `${sym} ${Number(n).toFixed(2)}`;
      const classId = `${c.issuer_id}.${(c.class_suffix || 'maluti_receipt').replace(/[^\w.-]/g, '_')}`;
      const items = o.lines.slice(0, 12).map(l => `${Number(l.qty)} × ${l.name}  ${money(l.line_total)}`).join('\n') + (o.lines.length > 12 ? `\n…and ${o.lines.length - 12} more` : '');
      const obj = {
        id: `${c.issuer_id}.rcpt_${token.replace(/[^\w.-]/g, '_')}`,
        classId,
        state: 'ACTIVE',
        cardTitle: lv(company.name || 'Receipt'),
        header: lv(`${money(o.total)}`),
        subheader: lv(`Receipt ${o.number}`),
        hexBackgroundColor: c.background_color || '#3f3d9e',
        textModulesData: [
          { id: 'date', header: 'Date', body: String(o.paid_at || o.created_at).slice(0, 16) },
          { id: 'items', header: 'Items', body: items },
          { id: 'vat', header: 'VAT included', body: money(o.tax_total) },
          { id: 'paid', header: 'Paid with', body: o.payments.map(p => p.method).join(', ') || '-' }
        ],
        linksModuleData: { uris: [{ uri: receipt_url, description: 'View full receipt', id: 'receipt' }] },
        barcode: { type: 'QR_CODE', value: receipt_url, alternateText: o.number }
      };
      if (c.logo_url && /^https:\/\//.test(c.logo_url)) obj.logo = { sourceUri: { uri: c.logo_url }, contentDescription: lv(company.name || 'Logo') };
      const jwt = sign({ iss: c.service_account_email, aud: 'google', typ: 'savetowallet', iat: Math.floor(Date.now() / 1000), origins: [],
        payload: { genericClasses: [{ id: classId }], genericObjects: [obj] } }, c.private_key);
      return { label: c.button_label || 'Add to Google Wallet', url: `https://pay.google.com/gp/v/save/${jwt}` };
    }
  };
};
