// Lekuka signatures, hashes and QR codes (E-Invoicing Gateway API specification v1.16, sections 11 and 13).
const crypto = require('crypto');

const cents = v => String(Math.round(Number(v) * 100));
/** tax rate for signatures: "15.00", "14.50", "0.00"; empty for exempt (no rate) */
const rateStr = r => r === null || r === undefined || r === '' ? '' : Number(r).toFixed(2);
/** local time in Lesotho (UTC+2) without a zone: 2024-02-23T14:43:23 */
function localTime(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Maseru', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`;
}
const sha256b64 = s => crypto.createHash('sha256').update(String(s), 'utf8').digest('base64');

/** taxes for the receipt hash: ordered by taxID, then taxCode (empty first); taxCode || taxRate || taxAmount || salesAmountWithTax */
function taxesString(receiptTaxes) {
  return [...receiptTaxes].sort((a, b) => (a.taxID - b.taxID) || String(a.taxCode || '').localeCompare(String(b.taxCode || '')))
    .map(t => `${t.taxCode || ''}${rateStr(t.taxRate)}${cents(t.taxAmount)}${cents(t.salesAmountWithTax)}`).join('');
}
/** the string hashed for a receipt's device signature (13.2.1) */
function receiptString(deviceID, r, previousReceiptHash) {
  return `${deviceID}${String(r.receiptType).toUpperCase()}${String(r.receiptCurrency).toUpperCase()}${r.receiptGlobalNo}${r.receiptDate}${cents(r.receiptTotal)}${taxesString(r.receiptTaxes)}${previousReceiptHash || ''}`;
}
const MONEY_ORDER = ['Cash', 'Card', 'MobileWallet', 'Coupon', 'Credit', 'BankTransfer', 'Other'];
const COUNTER_ORDER = ['SaleByTax', 'SaleTaxByTax', 'CreditNoteByTax', 'CreditNoteTaxByTax', 'DebitNoteByTax', 'DebitNoteTaxByTax', 'BalanceByMoneyType', 'PayoutByTax', 'PayoutTaxByTax'];
/** counters in signature order, zero values left out */
function sortCounters(counters) {
  return counters.filter(c => Math.round(Number(c.fiscalCounterValue) * 100) !== 0).sort((a, b) =>
    (COUNTER_ORDER.indexOf(a.fiscalCounterType) - COUNTER_ORDER.indexOf(b.fiscalCounterType)) || String(a.fiscalCounterCurrency).localeCompare(String(b.fiscalCounterCurrency))
    || (a.fiscalCounterType === 'BalanceByMoneyType' ? MONEY_ORDER.indexOf(a.fiscalCounterMoneyType) - MONEY_ORDER.indexOf(b.fiscalCounterMoneyType) : (Number(a.fiscalCounterTaxID) || 0) - (Number(b.fiscalCounterTaxID) || 0)));
}
function countersString(counters) {
  return sortCounters(counters).map(c => `${c.fiscalCounterType.toUpperCase()}${String(c.fiscalCounterCurrency).toUpperCase()}${c.fiscalCounterType === 'BalanceByMoneyType' ? String(c.fiscalCounterMoneyType).toUpperCase() : rateStr(c.fiscalCounterTaxRate)}${cents(c.fiscalCounterValue)}`).join('');
}
/** the string hashed for the fiscal day (Z report) device signature (13.3.1) */
const dayString = (deviceID, fiscalDayNo, fiscalDayDate, counters) => `${deviceID}${fiscalDayNo}${fiscalDayDate}${countersString(counters)}`;

/** { hash, signature } – SHA-256 of the string, signed with the device private key (ECDSA or RSA, SHA-256) */
function signString(s, privateKeyPem) {
  return { hash: sha256b64(s), signature: crypto.sign('sha256', Buffer.from(String(s), 'utf8'), privateKeyPem).toString('base64') };
}
function verifyString(s, signatureB64, publicKey) {
  try { return crypto.verify('sha256', Buffer.from(String(s), 'utf8'), publicKey, Buffer.from(signatureB64, 'base64')); } catch (_) { return false; }
}
/** QR data: first 16 hex characters of MD5 of the receipt device signature */
const qrData = signatureB64 => crypto.createHash('md5').update(Buffer.from(signatureB64, 'base64')).digest('hex').slice(0, 16).toUpperCase();
/** the verification link printed as a QR code: qrUrl + deviceID(10) + ddMMyyyy + receiptGlobalNo(10) + qrData(16) */
function qrUrl(base, deviceID, receiptDate, receiptGlobalNo, signatureB64) {
  const [y, m, d] = String(receiptDate).slice(0, 10).split('-');
  const b = String(base || '').trim().replace(/\s+/g, '');
  return `${b}${b.endsWith('/') ? '' : '/'}${String(deviceID).padStart(10, '0')}${d}${m}${y}${String(receiptGlobalNo).padStart(10, '0')}${qrData(signatureB64)}`;
}
const verificationCode = signatureB64 => qrData(signatureB64).match(/.{4}/g).join('-');

module.exports = { cents, rateStr, localTime, sha256b64, taxesString, receiptString, countersString, sortCounters, dayString, signString, verifyString, qrData, qrUrl, verificationCode, MONEY_ORDER, COUNTER_ORDER };
