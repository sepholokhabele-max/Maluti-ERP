// A practice Lekuka (RSL E-Invoicing Gateway) that runs inside S-ERP for demo mode and for tests. It follows the
// E-Invoicing Gateway API specification v1.16: device registration with an activation key and a certificate request,
// configuration and taxes, fiscal days, receipts with validation colours, counters, signatures, offline files.
// Nothing is sent to Revenue Services Lesotho in demo mode, and nothing it accepts counts for tax.
const crypto = require('crypto');
const db = require('../../db');
const P = require('./pki');
const S = require('./sign');

const KEY = 'lekuka_sim';
const err = (status, title, errorCode) => Object.assign(new Error(title), { status, problem: { type: 'about:blank', title, status, errorCode } });
const TAXES = [ // practice taxes in the shape Lekuka returns them (the real list comes from RSL's getConfig)
  { taxID: 1, taxName: 'Exempt', taxType: 'Exempt', taxValidFrom: '2026-04-01' },
  { taxID: 2, taxName: 'VAT 0% (zero-rated)', taxType: 'VAT', taxRate: 0, taxValidFrom: '2026-04-01' },
  { taxID: 3, taxName: 'VAT 10%', taxType: 'VAT', taxRate: 10, taxValidFrom: '2026-04-01' },
  { taxID: 4, taxName: 'VAT 15%', taxType: 'VAT', taxRate: 15, taxValidFrom: '2026-04-01' },
  { taxID: 5, taxName: 'Non-VAT', taxType: 'NonVAT', taxRate: 0, taxValidFrom: '2026-04-01' },
  { taxID: 6, taxName: 'Tobacco levy 20%', taxType: 'PercentageLevy', taxRate: 20, taxValidFrom: '2026-04-01' },
  { taxID: 7, taxName: 'Alcohol levy 10%', taxType: 'PercentageLevy', taxRate: 10, taxValidFrom: '2026-04-01' }
];
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const opId = () => `DEMO-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

let mem = null; // the simulator's state lives in the settings table (one JSON document)
async function load() { if (!mem) mem = (await db.getSetting(KEY, null)) || {}; if (!mem.ca) { const key = P.newKey(); const spki = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' }); const n = { CN: 'Lekuka DEMO CA', O: 'Revenue Services Lesotho (DEMO)', C: 'LS' }; mem.ca = { key, cert: P.certificate({ subject: n, issuer: n, spkiDer: spki, issuerKey: key, ca: true, days: 3650 }) }; } mem.devices = mem.devices || {}; mem.nextReceiptId = mem.nextReceiptId || 1000; return mem; }
async function persist() { await db.setSetting(KEY, mem); }
const reset = async () => { mem = null; await db.setSetting(KEY, {}); };

async function taxpayer() {
  const c = (await db.getSetting('company', {})) || {};
  const vat = !!(c.tax_number && Number(c.default_vat ?? 15) > 0);
  return { taxPayerName: c.name || 'Demo taxpayer', taxPayerTIN: String(c.tax_number || '1000000000').replace(/\D/g, '').slice(0, 11) || '1000000000', ...(vat ? { vatNumber: String(c.tax_number).replace(/\D/g, '').slice(0, 9) } : {}),
    deviceBranchName: c.name || 'Main branch', deviceBranchAddress: { district: 'Maseru', city: 'Maseru', street: String(c.address || 'Kingsway').slice(0, 100), houseNo: '1' },
    deviceBranchContacts: { phoneNo: c.phone || '', email: c.email || '' } };
}
function device(s, id, certPem) {
  const d = s.devices[String(id)];
  if (!d) throw err(422, 'Device not found or not active', 'DEV01');
  if (certPem !== undefined) { // every Device/* call is authenticated with the device certificate (mutual TLS)
    if (!certPem || ![d.cert, d.pending_cert].filter(Boolean).some(c => P.certInfo(c).thumbprint === P.certInfo(certPem).thumbprint)) throw err(401, 'Unauthorized – device certificate not issued to this device');
  }
  return d;
}
function issue(s, csrPem, d) {
  let r; try { r = P.readCsr(csrPem); } catch (e) { throw err(422, 'Certificate request is invalid', 'DEV03'); }
  if (r.cn !== P.deviceCN(d.serial, d.id)) throw err(422, `Certificate request is invalid – subject must be ${P.deviceCN(d.serial, d.id)}`, 'DEV03');
  return P.certificate({ subject: { C: 'LS', O: 'Revenue Services Lesotho', CN: r.cn }, issuer: { CN: 'Lekuka DEMO CA', O: 'Revenue Services Lesotho (DEMO)', C: 'LS' }, spkiDer: r.spkiDer, issuerKey: s.ca.key, client: true, days: 365 });
}
const serverSign = (s, str) => ({ ...S.signString(str, s.ca.key), certificateThumbprint: P.certInfo(s.ca.cert).thumbprint });
function counterAdd(day, type, cur, key, extra, v) {
  if (!v) return;
  const k = `${type}|${cur}|${key}`; const c = day.counters[k] || (day.counters[k] = { fiscalCounterType: type, fiscalCounterCurrency: cur, ...extra, fiscalCounterValue: 0 });
  c.fiscalCounterValue = r2(c.fiscalCounterValue + v);
}

/** validate one receipt like Lekuka does; returns validation errors ({code,color,text}) */
function validate(s, d, day, rc, cfgTaxes) {
  const E = []; const add = (code, color, text) => E.push({ validationErrorCode: code, validationErrorColor: color, validationErrorDescription: text });
  if (rc.receiptCurrency !== 'LSL') add('RCPT010', 'Red', 'Wrong currency code is used');
  if (rc.receiptCounter !== day.lastCounter + 1) add('RCPT011', 'Red', 'Receipt counter is not sequential');
  if (!(rc.receiptGlobalNo === (d.lastGlobalNo || 0) + 1 || (rc.receiptGlobalNo === 1 && rc.receiptCounter === 1))) add('RCPT012', 'Red', 'Receipt global number is not sequential');
  if (d.invoiceNos.includes(rc.invoiceNo)) add('RCPT013', 'Red', 'Invoice number is not unique');
  if (rc.receiptDate < day.opened) add('RCPT014', 'Yellow', 'Receipt date is earlier than fiscal period opening date');
  if (!(rc.receiptLines || []).length) add('RCPT016', 'Red', 'No receipt lines provided');
  if (!(rc.receiptTaxes || []).length) add('RCPT017', 'Red', 'Taxes information is not provided');
  if (!(rc.receiptPayments || []).length) add('RCPT018', 'Red', 'Payment information is not provided');
  const lines = rc.receiptLines || [], taxes = rc.receiptTaxes || [];
  const sumLines = r2(lines.reduce((a, l) => a + Number(l.receiptLineTotal), 0));
  if (rc.receiptLinesTaxInclusive && r2(rc.receiptTotal) !== sumLines) add('RCPT019', 'Red', 'Invoice total amount is not equal to sum of all invoice lines');
  const vatPayer = !!d.taxpayer.vatNumber;
  for (const l of lines) {
    const t = cfgTaxes.find(x => x.taxID === l.taxID);
    if (!t || (t.taxRate ?? null) !== (l.taxRate ?? null)) add('RCPT025', 'Red', `Invalid tax is used (line ${l.receiptLineNo})`);
    else if (!vatPayer && t.taxType === 'VAT') add('RCPT021', 'Red', 'VAT tax is used in invoice while taxpayer is not VAT taxpayer');
    if (!(Number(l.receiptLineQuantity) > 0)) add('RCPT023', 'Red', 'Invoice line quantity, must be positive');
    if (l.receiptLinePrice !== undefined && l.receiptLinePrice !== null && r2(Number(l.receiptLinePrice) * Number(l.receiptLineQuantity)) !== r2(l.receiptLineTotal)) add('RCPT024', 'Red', `Invoice line total is not equal to unit price * quantity (line ${l.receiptLineNo})`);
    const sign = rc.receiptType === 'CreditNote' ? -1 : 1;
    if (l.receiptLineType === 'Sale' && Math.sign(Number(l.receiptLineTotal)) !== sign) add('RCPT022', 'Red', 'Invoice sales line price and / or line total has the wrong sign');
  }
  // taxes: PerReceipt rounding, tax inclusive
  for (const t of taxes) {
    const base = r2(lines.filter(l => l.taxID === t.taxID).reduce((a, l) => a + Number(l.receiptLineTotal), 0));
    const rate = Number(t.taxRate || 0);
    const expTax = t.taxType === 'Exempt' ? 0 : r2(base / (100 + rate) * rate);
    if (r2(t.taxAmount) !== expTax) add('RCPT026', 'Red', `Incorrectly calculated tax amount (tax ${t.taxID}: expected ${expTax.toFixed(2)})`);
    if (r2(t.salesAmountWithTax) !== base) add('RCPT027', 'Red', 'Incorrectly calculated total sales amount (including tax)');
  }
  const used = new Set(lines.map(l => l.taxID)); if ([...used].some(id => !taxes.some(t => t.taxID === id))) add('RCPT049', 'Red', 'Tax table is missing some taxes indicated in invoice lines');
  if (r2(taxes.reduce((a, t) => a + Number(t.salesAmountWithTax), 0)) !== r2(rc.receiptTotal)) add('RCPT038', 'Red', 'Invoice total amount is not equal to sum of sales amount including tax in tax table');
  if (r2((rc.receiptPayments || []).reduce((a, p) => a + Number(p.paymentAmount), 0)) !== r2(rc.receiptTotal)) add('RCPT039', 'Red', 'Invoice total amount is not equal to sum of all payment amounts');
  if (['CreditNote', 'DebitNote'].includes(rc.receiptType)) {
    if (!rc.receiptNotes) add('RCPT034', 'Red', 'Note for credit/debit note is not provided');
    if (!rc.creditDebitNote) add('RCPT015', 'Red', 'Credited/debited invoice data is not provided');
    else {
      const o = d.receipts.find(x => x.receiptID === Number(rc.creditDebitNote.receiptID) || (x.receiptGlobalNo === rc.creditDebitNote.receiptGlobalNo && x.fiscalDayNo === rc.creditDebitNote.fiscalDayNo));
      if (!o) add('RCPT032', 'Red', 'Credit/debit note refers to non-existing invoice');
      else if (rc.receiptType === 'CreditNote') { const left = r2(o.total + o.credited); if (Math.abs(rc.receiptTotal) > left + 0.001) add('RCPT035', 'Red', 'Total credit note amount exceeds original invoice amount'); }
    }
    if (rc.receiptType === 'CreditNote' && Number(rc.receiptTotal) > 0) add('RCPT040', 'Red', 'Credit note total must be less than or equal to 0');
  } else {
    if (rc.creditDebitNote) add('RCPT029', 'Red', 'Credited/debited invoice information provided for regular invoice');
    if (Number(rc.receiptTotal) < 0) add('RCPT040', 'Red', 'Invoice total amount must be greater than or equal to 0');
    if (rc.receiptType === 'FiscalInvoice' && !rc.buyerData) add('RCPT046', 'Red', 'Buyer data is not provided');
    if (rc.receiptType === 'Receipt' && Number(rc.receiptTotal) > d.threshold && !rc.buyerData) add('RCPT046', 'Red', 'Buyer data is not provided');
  }
  if (rc.buyerData && (!rc.buyerData.buyerRegisterName || !rc.buyerData.buyerTIN)) add('RCPT043', 'Red', 'Mandatory buyer data fields are not provided');
  if (rc.buyerData && rc.buyerData.buyerTIN === d.taxpayer.taxPayerTIN) add('RCPT054', 'Red', 'Buyer TIN cannot be the same as seller TIN');
  // signature over the receipt chain
  const str = S.receiptString(d.id, rc, rc.receiptCounter === 1 ? null : day.lastHash);
  const sig = rc.receiptDeviceSignature || {};
  if (sig.hash !== S.sha256b64(str) || !S.verifyString(str, sig.signature || '', P.certInfo(d.cert).publicKey)) add('RCPT020', 'Red', 'Invoice signature is not valid');
  return E;
}
function applyCounters(day, rc) {
  const type = rc.receiptType === 'CreditNote' ? 'CreditNote' : rc.receiptType === 'DebitNote' ? 'DebitNote' : rc.receiptType === 'Payout' ? 'Payout' : 'Sale';
  for (const t of rc.receiptTaxes) {
    const extra = { fiscalCounterTaxID: t.taxID, ...(t.taxType === 'Exempt' ? {} : { fiscalCounterTaxRate: t.taxRate }) };
    counterAdd(day, `${type}ByTax`, 'LSL', t.taxID, extra, Number(t.salesAmountWithTax));
    if (t.taxType !== 'Exempt') counterAdd(day, `${type}TaxByTax`, 'LSL', t.taxID, extra, Number(t.taxAmount));
  }
  for (const p of rc.receiptPayments) counterAdd(day, 'BalanceByMoneyType', 'LSL', p.moneyTypeCode, { fiscalCounterMoneyType: p.moneyTypeCode }, Number(p.paymentAmount));
}
function acceptReceipt(s, d, rc) {
  const day = d.day;
  const errors = validate(s, d, day, rc, TAXES);
  const receiptID = s.nextReceiptId++; const serverDate = S.localTime();
  const hash = S.sha256b64(S.receiptString(d.id, rc, rc.receiptCounter === 1 ? null : day.lastHash));
  day.lastCounter = Math.max(day.lastCounter, rc.receiptCounter); d.lastGlobalNo = Math.max(d.lastGlobalNo || 0, rc.receiptGlobalNo); day.lastHash = hash;
  d.invoiceNos.push(rc.invoiceNo); if (d.invoiceNos.length > 5000) d.invoiceNos.shift();
  const color = errors.some(e => e.validationErrorColor === 'Red') ? 'Red' : errors.some(e => e.validationErrorColor === 'Grey') ? 'Grey' : errors.length ? 'Yellow' : 'Valid';
  if (color === 'Red' || color === 'Grey') day.bad = (day.bad || 0) + 1;
  applyCounters(day, rc);
  day.docs[rc.receiptType] = day.docs[rc.receiptType] || { receiptQuantity: 0, receiptTotalAmount: 0 }; day.docs[rc.receiptType].receiptQuantity++; day.docs[rc.receiptType].receiptTotalAmount = r2(day.docs[rc.receiptType].receiptTotalAmount + Number(rc.receiptTotal));
  d.receipts.push({ receiptID, receiptGlobalNo: rc.receiptGlobalNo, fiscalDayNo: day.no, total: Number(rc.receiptTotal), credited: 0, type: rc.receiptType, color });
  if (rc.creditDebitNote) { const o = d.receipts.find(x => x.receiptID === Number(rc.creditDebitNote.receiptID)); if (o && rc.receiptType === 'CreditNote') o.credited = r2(o.credited + Number(rc.receiptTotal)); }
  if (d.receipts.length > 5000) d.receipts.shift();
  return { receiptID, serverDate, receiptServerSignature: serverSign(s, `${rc.receiptDeviceSignature.signature}${receiptID}${serverDate}`), ...(errors.length ? { validationErrors: errors } : {}) };
}
function closeDayCheck(s, d, b) {
  const day = d.day;
  const mine = S.countersString(Object.values(day.counters));
  const str = S.dayString(d.id, day.no, day.opened.slice(0, 10), b.fiscalDayCounters || []);
  const sig = b.fiscalDayDeviceSignature || {};
  let code = null;
  if (sig.hash !== S.sha256b64(str) || !S.verifyString(str, sig.signature || '', P.certInfo(d.cert).publicKey)) code = 'BadCertificateSignature';
  else if (S.countersString(b.fiscalDayCounters || []) !== mine || Number(b.receiptCounter) !== day.lastCounter) code = 'CountersMismatch';
  const closed = S.localTime();
  if (code) { day.status = 'FiscalDayCloseFailed'; day.closingError = code; return; }
  day.status = 'FiscalDayClosed'; day.closed = closed; day.reconciliation = 'Auto';
  day.serverSignature = serverSign(s, `${d.id}${day.no}${day.opened.slice(0, 10)}${closed}AUTO${mine}${sig.signature}`);
  d.lastDayNo = day.no;
}

/** one gateway call. op = endpoint name, cert = the client certificate presented (undefined for public endpoints) */
async function handle(op, deviceID, body = {}, { cert, model } = {}) {
  const s = await load(); const id = Number(deviceID);
  if (model && (!model.name || !model.version)) throw err(422, 'Device model and version is not registered in Lekuka', 'DEV06');
  try {
    if (op === 'GetServerCertificate') return { certificate: [s.ca.cert], certificateValidTill: P.certInfo(s.ca.cert).valid_to };
    if (op === 'VerifyTaxpayerInformation' || op === 'RegisterDevice') {
      if (!(id > 0)) throw err(422, 'Device not found or not active', 'DEV01');
      const key = String(body.activationKey || '');
      if (!/^[A-Za-z0-9]{8}$/.test(key)) throw err(422, 'Activation key is incorrect', 'DEV02');
      let d = s.devices[String(id)];
      if (d && d.activationKey && d.activationKey.toUpperCase() !== key.toUpperCase()) throw err(422, 'Activation key is incorrect', 'DEV02');
      const tp = await taxpayer();
      if (op === 'VerifyTaxpayerInformation') {
        if (!body.deviceSerialNo) throw err(400, 'deviceSerialNo is required');
        return { operationID: opId(), ...tp };
      }
      if (!d) d = s.devices[String(id)] = { id, serial: null, receipts: [], invoiceNos: [], lastGlobalNo: 0, lastDayNo: 0, day: null, threshold: 5000, mode: 'Online' };
      d.activationKey = key; d.taxpayer = tp;
      const cn = (P.readCsr(body.certificateRequest).cn || '').match(/^RSL-(.+)-(\d{10})$/);
      if (!cn || Number(cn[2]) !== id) throw err(422, 'Certificate request is invalid – the subject must name this device', 'DEV03');
      d.serial = cn[1];
      d.cert = issue(s, body.certificateRequest, d); d.pending_cert = null;
      await persist(); return { operationID: opId(), certificate: d.cert };
    }
    if (op === 'VerifyByTin') {
      device(s, id, cert); const tin = String(body.tin || '').replace(/\D/g, '');
      if (tin.length < 6) throw err(422, 'Taxpayer was not found', 'DEV19');
      return { TIN: tin, taxPayerName: `Registered taxpayer ${tin} (demo)`, ...(Number(tin.slice(-1)) % 2 ? { vatNumber: tin.slice(0, 9) } : {}) };
    }
    const d = device(s, id, cert);
    const day = d.day;
    let out;
    switch (op) {
      case 'GetConfig':
        out = { ...d.taxpayer, deviceSerialNo: d.serial, deviceOperatingMode: d.mode, taxPayerDayMaxHrs: 24, taxpayerDayEndNotificationHrs: 2, applicableTaxes: TAXES, certificateValidTill: P.certInfo(d.cert).valid_to, qrUrl: 'https://invoice.rsl.org.ls/', thresholdForMandatoryBuyerData: d.threshold };
        break;
      case 'GetStatus':
        if (d.mode === 'Offline') throw err(422, 'Device not found or not active', 'DEV01');
        out = { fiscalDayStatus: day ? day.status : 'FiscalDayClosed', ...(day && day.status === 'FiscalDayClosed' ? { fiscalDayReconciliationMode: day.reconciliation, fiscalDayServerSignature: day.serverSignature, fiscalDayClosed: day.closed } : {}),
          ...(day && day.status === 'FiscalDayCloseFailed' ? { fiscalDayClosingErrorCode: day.closingError } : {}), ...(d.lastGlobalNo ? { lastReceiptGlobalNo: d.lastGlobalNo } : {}), ...(day ? { lastFiscalDayNo: day.no } : {}),
          fiscalDayDocumentQuantities: day ? Object.entries(day.docs).map(([receiptType, x]) => ({ receiptType, receiptCurrency: 'LSL', ...x })) : [] };
        break;
      case 'OpenDay': {
        if (d.mode === 'Offline') throw err(422, 'Device not found or not active', 'DEV01');
        if (day && day.status !== 'FiscalDayClosed') throw err(422, 'Open day is not allowed', 'FISC01');
        const no = body.fiscalDayNo || (d.lastDayNo || 0) + 1;
        if (no !== (d.lastDayNo || 0) + 1) throw err(422, 'Open day is not allowed – fiscalDayNo must follow the last closed day', 'FISC01');
        d.day = { no, opened: body.fiscalDayOpened, status: 'FiscalDayOpened', lastCounter: 0, lastHash: null, counters: {}, docs: {} };
        out = { fiscalDayNo: no }; break;
      }
      case 'SubmitReceipt': {
        if (d.mode === 'Offline') throw err(422, 'Device not found or not active', 'DEV01');
        if (!day || !['FiscalDayOpened', 'FiscalDayCloseFailed'].includes(day.status)) throw err(422, 'Submitting receipt is not allowed. Fiscal period is closed, or fiscal period close initiated', 'RCPT01');
        const rc = body.receipt;
        if (!rc || !rc.receiptType || !rc.receiptDeviceSignature || !Array.isArray(rc.receiptLines) || !rc.invoiceNo) throw err(422, 'Submit receipt failed. The receipt structure invalid or field requirements not satisfied', 'RCPT02');
        // the same receipt sent again (same global no and hash) gets the original answer
        const dup = d.receipts.find(x => x.receiptGlobalNo === rc.receiptGlobalNo && x.fiscalDayNo === day.no && x.hash === rc.receiptDeviceSignature.hash);
        if (dup) { out = dup.answer; break; }
        out = acceptReceipt(s, d, rc); const last = d.receipts[d.receipts.length - 1]; last.hash = rc.receiptDeviceSignature.hash; last.answer = out;
        break;
      }
      case 'CloseDay':
        if (!day || day.status === 'FiscalDayClosed') throw err(422, 'Closing day is not allowed. Fiscal period not opened.', 'FISC04');
        if (day.status === 'FiscalDayCloseInitiated') throw err(422, 'Closing day is not allowed. Close day is in progress.', 'FISC03');
        if (Number(body.fiscalDayNo) !== day.no) throw err(422, 'fiscalDayNo is not the open fiscal period', 'FISC04');
        if (day.bad) { throw err(422, 'Closing day is not allowed. There are receipts with validation errors in fiscal period ("Red" validation error).', 'FISC04'); }
        closeDayCheck(s, d, body); out = {}; break;
      case 'Ping': out = { reportingFrequency: 5 }; break;
      case 'IssueCertificate': d.pending_cert = issue(s, body.certificateRequest, d); if (!body.twoStepsProcess) { d.cert = d.pending_cert; d.pending_cert = null; } out = { certificate: d.pending_cert || d.cert }; break;
      case 'ConfirmCertificate': if (d.pending_cert) { d.cert = d.pending_cert; d.pending_cert = null; } out = {}; break;
      case 'SubmitFile': {
        if (d.mode !== 'Offline') throw err(422, 'Device operating mode is not Offline.', 'FILE03');
        let f; try { f = JSON.parse(Buffer.from(String(body.file || ''), 'base64').toString('utf8')); } catch (_) { throw err(422, 'File structure invalid', 'FILE02'); }
        if (!f.header || Number(f.header.deviceID ?? f.header.deviceId) !== id) throw err(422, 'Device id in input parameters and file header are different', 'FILE05');
        const op2 = opId(); d.files = d.files || [];
        let status = 'FileProcessingIsSuccessful', errors = [];
        if (!d.day || d.day.no !== f.header.fiscalDayNo) { if (d.lastDayNo >= f.header.fiscalDayNo) throw err(422, 'File sent for already closed day', 'FILE04'); d.day = { no: f.header.fiscalDayNo, opened: f.header.fiscalDayOpened, status: 'FiscalDayOpened', lastCounter: 0, lastHash: null, counters: {}, docs: {} }; }
        const invalid = [];
        for (const rc of (f.content && f.content.receipts) || []) { const a = acceptReceipt(s, d, rc); if (a.validationErrors) invalid.push({ receiptCounter: rc.receiptCounter, receiptGlobalNo: rc.receiptGlobalNo, validationErrors: a.validationErrors }); }
        if (f.footer) { if (d.day.bad) { status = 'FileProcessingWithErrors'; errors = ['ReceiptsWithValidationErrors']; } else { closeDayCheck(s, d, { ...f.footer, fiscalDayNo: d.day.no }); if (d.day.status !== 'FiscalDayClosed') { status = 'FileProcessingWithErrors'; errors = [d.day.closingError]; } } }
        d.files.push({ operationID: op2, fileUploadDate: S.localTime(), deviceId: id, fileName: `${id}-${f.header.fiscalDayNo}-${f.header.fileSequence}.json`, fileProcessingDate: S.localTime(), fileProcessingStatus: status, ...(errors.length ? { fileProcessingErrorCode: errors } : {}), fiscalDayNo: f.header.fiscalDayNo, fiscalDayOpenedAt: f.header.fiscalDayOpened, fileSequence: f.header.fileSequence, ipAddress: '127.0.0.1', hasFooter: !!f.footer, ...(invalid.length ? { invoicesWithValidationErrors: invalid } : {}) });
        if (d.files.length > 200) d.files.shift();
        await persist(); return { operationID: op2 };
      }
      case 'SubmittedFileList': out = { fileStatus: (d.files || []).filter(f => !body.operationID || f.operationID === body.operationID) }; break;
      default: throw err(404, 'Resource not found');
    }
    await persist();
    return { operationID: opId(), ...out };
  } catch (e) { if (e.problem) await persist().catch(() => {}); throw e; }
}
/** test hooks: switch a practice device to offline mode or change the buyer-data threshold */
async function setDevice(deviceID, patch) { const s = await load(); const d = s.devices[String(deviceID)]; if (d) Object.assign(d, patch); await persist(); }
const caCert = async () => { const s = await load(); await persist(); return s.ca.cert; };

module.exports = { handle, reset, setDevice, caCert, TAXES };
