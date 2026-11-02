// Simulated VAS provider. Use it to learn the flow before connecting a real aggregator.
module.exports = (ctx) => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  let balance = 10000;
  return {
    async listServices() {
      return [
        { code: 'airtime', name: 'Airtime', providers: [{ code: 'VCL', name: 'Vodacom' }, { code: 'ECONET', name: 'Econet Telecom' }],
          fixedAmounts: [5, 10, 20, 50, 100], minAmount: 2, maxAmount: 1000, recipientLabel: 'Phone number' },
        { code: 'data', name: 'Data bundle', providers: [{ code: 'VCL', name: 'Vodacom' }, { code: 'ECONET', name: 'Econet Telecom' }],
          fixedAmounts: [10, 30, 60, 150], recipientLabel: 'Phone number' },
        { code: 'electricity', name: 'Prepaid electricity', providers: [{ code: 'LEC', name: 'LEC Prepaid' }],
          minAmount: 10, maxAmount: 5000, needsLookup: true, recipientLabel: 'Meter number' }
      ];
    },
    async lookup(config, { service, recipient }) {
      await wait(config.latency_ms);
      if (service === 'electricity') {
        if (!/^\d{11}$/.test(recipient)) return { ok: false, message: 'Meter number must be 11 digits' };
        return { ok: true, name: 'TEST CUSTOMER — Ha Thetsane', message: 'Meter verified' };
      }
      return { ok: true };
    },
    async purchase(config, { service, provider, recipient, amount, reference }) {
      await wait(config.latency_ms);
      if (String(recipient).endsWith('0000')) return { status: 'failed', message: 'Recipient not recognised by network' };
      if (amount > balance) return { status: 'failed', message: 'Insufficient float' };
      balance -= amount * (1 - config.commission_pct / 100);
      const out = { status: 'success', provider_ref: `SBX-${Date.now()}`, commission: Math.round(amount * config.commission_pct) / 100,
        message: `${service} ${provider || ''} sent to ${recipient}` };
      if (service === 'electricity') {
        out.token = Array.from({ length: 5 }, () => String(Math.floor(1000 + Math.random() * 9000))).join('-');
        out.message = `${(amount / 1.95).toFixed(1)} kWh — reference ${reference}`;
      }
      ctx.log('purchase', service, recipient, amount, out.status);
      return out;
    },
    async checkStatus() { return { status: 'success', message: 'Completed' }; },
    async balance() { return { balance: Math.round(balance * 100) / 100, currency: 'LSL' }; }
  };
};
