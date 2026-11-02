// Configurable REST connector for VAS aggregators such as My Wallet.
// Everything (endpoints, payloads, response mapping) comes from the plugin settings screen.
module.exports = (ctx) => {
  const get = (obj, path) => !path ? undefined : String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const parse = (v, def) => { if (typeof v !== 'string') return v ?? def; try { return JSON.parse(v); } catch (_) { return def; } };

  function render(template, vars) {
    // Replace {{var}} in the raw template text. Strings are JSON-escaped (without quotes) so templates stay valid JSON.
    const text = typeof template === 'string' ? template : JSON.stringify(template || {});
    return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
      const v = vars[k];
      if (v === undefined || v === null) return '';
      return typeof v === 'number' ? String(v) : JSON.stringify(String(v)).slice(1, -1);
    });
  }

  function headers(c) {
    const h = {};
    if (c.auth_type === 'bearer' && c.api_key) h.Authorization = `Bearer ${c.api_key}`;
    if (c.auth_type === 'header' && c.api_key) h[c.api_key_header || 'X-API-Key'] = c.api_key;
    if (c.auth_type === 'basic') h.Authorization = 'Basic ' + Buffer.from(`${c.username || ''}:${c.password || ''}`).toString('base64');
    return h;
  }
  const url = (c, p, vars = {}) => String(c.base_url || '').replace(/\/$/, '') + render(p, vars);

  function mapResult(c, data) {
    const sv = String(get(data, c.success_field));
    const ok = String(c.success_values || 'success').split(',').map(s => s.trim()).includes(sv);
    const pending = String(c.pending_values || '').split(',').map(s => s.trim()).filter(Boolean).includes(sv);
    const commission = c.commission_field ? Number(get(data, c.commission_field)) : undefined;
    return {
      status: ok ? 'success' : pending ? 'pending' : 'failed',
      provider_ref: get(data, c.ref_field) != null ? String(get(data, c.ref_field)) : undefined,
      token: get(data, c.token_field) != null ? String(get(data, c.token_field)) : undefined,
      message: get(data, c.message_field) != null ? String(get(data, c.message_field)) : (ok ? 'Success' : 'Declined'),
      commission: isFinite(commission) ? commission : undefined,
      raw: data
    };
  }

  return {
    async listServices(c) { return parse(c.services_json, []); },

    async lookup(c, args) {
      if (!c.lookup_path) return { ok: true, message: 'No lookup configured' };
      const vars = { ...c, ...args };
      const res = await ctx.http(url(c, c.lookup_path, vars), { method: 'POST', headers: headers(c), body: render(c.lookup_body, vars), timeout: c.timeout_ms });
      const name = get(res.data, c.lookup_name_field);
      return { ok: res.ok && !!name, name, message: res.ok ? (name ? 'Verified' : 'Account not found') : `HTTP ${res.status}` };
    },

    async purchase(c, args) {
      const vars = { ...c, ...args, amount_cents: Math.round(Number(args.amount) * 100) };
      const method = c.purchase_method || 'POST';
      const body = method === 'GET' ? undefined : render(c.purchase_body, vars);
      const res = await ctx.http(url(c, c.purchase_path, vars), { method, headers: headers(c), body, timeout: c.timeout_ms });
      if (!res.ok && res.status >= 500) return { status: 'pending', message: `Provider error HTTP ${res.status} — check status before re-selling`, raw: res.data };
      return mapResult(c, res.data);
    },

    async checkStatus(c, args) {
      if (!c.status_path) return { status: 'pending', message: 'No status endpoint configured' };
      const res = await ctx.http(url(c, c.status_path, { ...c, ...args }), { headers: headers(c), timeout: c.timeout_ms });
      return mapResult(c, res.data);
    },

    async balance(c) {
      if (!c.balance_path) return { balance: null, message: 'No balance endpoint configured' };
      const res = await ctx.http(url(c, c.balance_path, c), { headers: headers(c), timeout: c.timeout_ms });
      return { balance: Number(get(res.data, c.balance_field)), raw: res.data };
    }
  };
};
