// Builds the Samsung Wallet "Data Fetch Link" for a receipt. The receipt reference (refId) is the receipt token;
// Samsung's servers fetch the card content from your partner endpoint as configured in the Partner Portal.
module.exports = () => ({
  async addToWallet(c, { token }) {
    if (!c.card_id || !c.link_template) return null;
    const url = String(c.link_template)
      .replace(/\{card_id\}/g, encodeURIComponent(c.card_id))
      .replace(/\{certificate_id\}/g, encodeURIComponent(c.certificate_id || ''))
      .replace(/\{ref\}/g, encodeURIComponent(token));
    return { label: c.button_label || 'Add to Samsung Wallet', url };
  }
});
