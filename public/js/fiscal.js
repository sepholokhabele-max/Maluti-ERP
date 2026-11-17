// The RSL Lekuka block printed on receipts and invoices (E-Invoicing Gateway API v1.16, section 10 and 11):
// taxpayer TIN / VAT No, invoice No (receipt counter / global No), fiscal period, device serial and ID, date,
// the QR code and the verification code.
import { esc } from './core.js';

const LABEL = { Receipt: 'RECEIPT', FiscalInvoice: 'TAX INVOICE', CreditNote: 'CREDIT NOTE', DebitNote: 'DEBIT NOTE', Payout: 'PAYOUT NOTICE' };
export const fiscalLabel = (f, vatPayer = true) => f ? (f.receipt_type === 'FiscalInvoice' && !(f.taxpayer && f.taxpayer.vat) && !vatPayer ? 'INVOICE' : LABEL[f.receipt_type] || 'RECEIPT') : '';
const when = s => { const [d, t] = String(s || '').split('T'); if (!d) return ''; const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y} ${String(t || '').slice(0, 5)}`; };

/** small: for 80 mm receipt paper */
export function fiscalReceiptHtml(f) {
  if (!f) return '';
  return `<hr><div class="c b">${esc(fiscalLabel(f))}</div>
    ${f.taxpayer && f.taxpayer.tin ? `<div class="c">TIN: ${esc(f.taxpayer.tin)}${f.taxpayer.vat ? ` &nbsp;VAT No: ${esc(f.taxpayer.vat)}` : ''}</div>` : ''}
    <table><tr><td>Invoice No:</td><td class="r">${f.receipt_counter}/${f.global_no}</td></tr><tr><td>Fiscal period No:</td><td class="r">${f.day_no}</td></tr>
    <tr><td>Customer reference No:</td><td class="r">${esc(f.invoice_no || '')}</td></tr><tr><td>Device Serial No:</td><td class="r">${esc(f.serial_no || '')}</td></tr>
    <tr><td>Device ID:</td><td class="r">${f.device_id}</td></tr><tr><td>Date:</td><td class="r">${esc(when(f.receipt_date))}</td></tr></table>
    <div class="c" style="margin-top:6px"><div style="width:32mm;margin:0 auto">${f.qr_svg || ''}</div>
    <div>Verification code:</div><div class="b" style="font-size:13px;letter-spacing:1px">${esc(f.verification_code || '')}</div>
    <div style="font-size:9px;word-break:break-all">${esc(f.qr_url || '')}</div>
    ${f.mode === 'demo' ? '<div class="b" style="margin-top:4px">DEMO – NOT SENT TO RSL</div>' : f.mode === 'test' ? '<div class="b" style="margin-top:4px">RSL TEST ENVIRONMENT</div>' : ''}</div>`;
}
/** A4 invoices */
export function fiscalA4Html(f) {
  if (!f) return '';
  return `<div style="margin-top:22px;border-top:2px solid #333;padding-top:10px;display:flex;gap:20px;align-items:center;font-size:12px">
    <div style="width:110px;flex:none">${f.qr_svg || ''}</div>
    <div><b>RSL Lekuka e-invoice</b>${f.mode === 'demo' ? ' <b>(DEMO – not sent to RSL)</b>' : f.mode === 'test' ? ' <b>(RSL test environment)</b>' : ''}<br>
      Invoice No: ${f.receipt_counter}/${f.global_no} · Fiscal period No: ${f.day_no} · Customer reference No: ${esc(f.invoice_no || '')}<br>
      Device Serial No: ${esc(f.serial_no || '')} · Device ID: ${f.device_id} · Date: ${esc(when(f.receipt_date))}${f.taxpayer && f.taxpayer.tin ? ` · TIN: ${esc(f.taxpayer.tin)}` : ''}${f.taxpayer && f.taxpayer.vat ? ` · VAT No: ${esc(f.taxpayer.vat)}` : ''}<br>
      Verification code: <b style="letter-spacing:1px">${esc(f.verification_code || '')}</b> – scan the code or open ${esc(f.qr_url || '')}</div></div>`;
}
