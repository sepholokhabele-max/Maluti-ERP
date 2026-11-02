module.exports = (ctx) => {
  const pending = new Map();
  return {
    async requestPayment(config, { phone, amount, reference }) {
      if (!phone) return { status: 'failed', message: 'Customer phone number required' };
      const ref = `MM${Date.now()}`;
      pending.set(ref, Date.now() + Number(config.approve_after_ms || 4000));
      ctx.log('push request', phone, amount, reference);
      return { status: 'pending', provider_ref: ref, message: `Payment request sent to ${phone}. Ask the customer to approve on their phone.` };
    },
    async checkStatus(config, { provider_ref }) {
      const at = pending.get(provider_ref);
      if (!at) return { status: 'failed', message: 'Unknown transaction' };
      if (Date.now() >= at) return { status: 'success', provider_ref, message: 'Customer approved payment' };
      return { status: 'pending', provider_ref, message: 'Waiting for customer…' };
    }
  };
};
