// Talking to Lekuka: in demo mode to the practice gateway inside S-ERP, otherwise to RSL over HTTPS with the device
// certificate (mutual TLS). Every request carries the device model name and version registered with RSL.
const https = require('https');
const sim = require('./simulator');

const URLS = { test: 'https://lekukaapi.rsl.org.ls:8443', live: 'https://lekukaapi.rsl.org.ls' };
// endpoint → [HTTP method, path]  (E-Invoicing Gateway API specification v1.16, section 4)
const EP = {
  VerifyTaxpayerInformation: ['POST', '/Public/v1/{id}/VerifyTaxpayerInformation'], RegisterDevice: ['POST', '/Public/v1/{id}/RegisterDevice'],
  GetServerCertificate: ['GET', '/Public/v1/GetServerCertificate'], IssueCertificate: ['POST', '/Device/v2/{id}/IssueCertificate'],
  ConfirmCertificate: ['POST', '/Device/v2/{id}/ConfirmCertificate'], GetConfig: ['GET', '/Device/v2/{id}/GetConfig'], GetStatus: ['GET', '/Device/v1/{id}/GetStatus'],
  OpenDay: ['POST', '/Device/v1/{id}/OpenDay'], SubmitReceipt: ['POST', '/Device/v2/{id}/SubmitReceipt'], CloseDay: ['POST', '/Device/v2/{id}/CloseDay'],
  Ping: ['POST', '/Device/v1/{id}/Ping'], SubmitFile: ['POST', '/Device/v1/{id}/SubmitFile'], SubmittedFileList: ['GET', '/Device/v1/{id}/SubmittedFileList'],
  VerifyByTin: ['POST', '/Buyer/v1/{id}/verifyByTin']
};
const PUBLIC = new Set(['VerifyTaxpayerInformation', 'RegisterDevice', 'GetServerCertificate']);

/** the device model registered with RSL during accreditation of S-ERP (Smartel Money sets these when RSL confirms them) */
function model() {
  return { name: process.env.MALUTI_LEKUKA_MODEL_NAME || 'S-ERP', version: process.env.MALUTI_LEKUKA_MODEL_VERSION || '1.0', accredited: process.env.MALUTI_LEKUKA_ACCREDITED === '1' };
}
const fail = (status, title, errorCode, extra = {}) => Object.assign(new Error(title), { status, errorCode, ...extra });

function request(cfg, op, deviceID, body = {}) {
  const [method, path0] = EP[op];
  const base = cfg.url || process.env.MALUTI_LEKUKA_URL || URLS[cfg.mode] || URLS.test;
  let path = path0.replace('{id}', String(deviceID));
  if (method === 'GET' && body && Object.keys(body).length) path += '?' + new URLSearchParams(body).toString();
  const u = new URL(base + path);
  const m = model();
  let payload = null; const headers = { DeviceModelName: m.name, DeviceModelVersionNo: m.version, Accept: 'application/json' };
  if (method !== 'GET') {
    if (op === 'SubmitFile') { // multipart/form-data with the base64 file
      const boundary = '----serp' + Date.now().toString(16);
      payload = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${body.fileName || 'file.json'}"\r\nContent-Type: application/octet-stream\r\n\r\n${body.file}\r\n--${boundary}--\r\n`);
      headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
    } else { payload = Buffer.from(JSON.stringify(body)); headers['Content-Type'] = 'application/json'; }
    headers['Content-Length'] = payload.length;
  }
  const opts = { method, hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, headers, timeout: 30000,
    ...(PUBLIC.has(op) ? {} : { key: cfg.private_key, cert: cfg.certificate }), ...(cfg.server_ca || process.env.MALUTI_LEKUKA_CA ? { ca: cfg.server_ca || require('fs').readFileSync(process.env.MALUTI_LEKUKA_CA) } : {}) };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8'); let j = null; try { j = text ? JSON.parse(text) : {}; } catch (_) { j = { title: text.slice(0, 300) }; }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(j);
        reject(fail(res.statusCode, (j && (j.title || j.detail)) || `Lekuka answered ${res.statusCode}`, j && j.errorCode, { retry: res.statusCode >= 500 }));
      });
    });
    req.on('timeout', () => req.destroy(fail(0, 'Lekuka did not answer within 30 seconds', null, { retry: true, offline: true })));
    req.on('error', e => reject(e.status !== undefined ? e : fail(0, `Cannot reach Lekuka (${e.code || e.message})`, null, { retry: true, offline: true })));
    if (payload) req.write(payload);
    req.end();
  });
}

/** call an endpoint; cfg = the installation's Lekuka settings */
async function call(cfg, op, deviceID, body) {
  if (cfg.mode === 'demo') {
    if (cfg.simulate_offline) throw fail(0, 'Cannot reach Lekuka (practice: offline)', null, { retry: true, offline: true });
    try { return await sim.handle(op, deviceID, body, { cert: PUBLIC.has(op) ? undefined : cfg.certificate, model: model() }); }
    catch (e) { if (e.problem) throw fail(e.status, e.problem.title, e.problem.errorCode, { retry: e.status >= 500 }); throw e; }
  }
  if (cfg.mode === 'live' && !model().accredited) throw fail(0, 'S-ERP is not yet accredited by RSL for live e-invoicing. Use the RSL test environment until Smartel Money confirms accreditation.', 'NOT_ACCREDITED');
  return request(cfg, op, deviceID, body);
}

module.exports = { call, model, URLS, EP };
