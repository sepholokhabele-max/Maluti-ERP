// Keys, certificate signing requests (PKCS #10) and – for demo mode and tests only – a small certificate authority,
// built with Node's own crypto and a minimal DER encoder (no extra packages).
// Lekuka needs: ECC P-256 (preferred) or RSA 2048 keys; CSR subject CN = RSL-<serial>-<10-digit device id>, C=LS,
// O=Revenue Services Lesotho, ST=Lesotho; signature ecdsa-with-SHA256.
const crypto = require('crypto');

/* ---------- DER ---------- */
const len = n => n < 0x80 ? Buffer.from([n]) : (() => { const b = []; while (n > 0) { b.unshift(n & 0xff); n >>= 8; } return Buffer.from([0x80 | b.length, ...b]); })();
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...x) => tlv(0x30, Buffer.concat(x));
const set = (...x) => tlv(0x31, Buffer.concat(x));
const int = n => { let b = typeof n === 'bigint' ? Buffer.from(n.toString(16).padStart(2, '0').replace(/^(.(..)*)$/, '0$1'), 'hex') : Buffer.isBuffer(n) ? n : Buffer.from([n]); if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]); return tlv(0x02, b); };
const oid = s => { const p = s.split('.').map(Number); const out = [40 * p[0] + p[1]]; for (const v of p.slice(2)) { const st = []; let x = v; st.unshift(x & 0x7f); x >>= 7; while (x > 0) { st.unshift(0x80 | (x & 0x7f)); x >>= 7; } out.push(...st); } return tlv(0x06, Buffer.from(out)); };
const utf8 = s => tlv(0x0c, Buffer.from(String(s), 'utf8'));
const printable = s => tlv(0x13, Buffer.from(String(s), 'ascii'));
const bitstr = b => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
const octet = b => tlv(0x04, b);
const ctx = (n, body, constructed = true) => tlv((constructed ? 0xa0 : 0x80) | n, body);
const utcTime = d => { const s = d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'; return tlv(0x17, Buffer.from(s)); };

const OID = { CN: '2.5.4.3', C: '2.5.4.6', O: '2.5.4.10', ST: '2.5.4.8', ecdsaSha256: '1.2.840.10045.4.3.2', rsaSha256: '1.2.840.113549.1.1.11', basicConstraints: '2.5.29.19', keyUsage: '2.5.29.15', extKeyUsage: '2.5.29.37', clientAuth: '1.3.6.1.5.5.7.3.2', serverAuth: '1.3.6.1.5.5.7.3.1', subjectAltName: '2.5.29.17' };
const name = ({ C, O, ST, CN }) => seq(...[C && set(seq(oid(OID.C), printable(C))), ST && set(seq(oid(OID.ST), utf8(ST))), O && set(seq(oid(OID.O), utf8(O))), CN && set(seq(oid(OID.CN), utf8(CN)))].filter(Boolean));
const algId = key => crypto.createPublicKey(key).asymmetricKeyType === 'ec' ? seq(oid(OID.ecdsaSha256)) : seq(oid(OID.rsaSha256), tlv(0x05, Buffer.alloc(0)));
const sign = (key, data) => crypto.sign('sha256', data, key);
const pem = (label, der) => `-----BEGIN ${label}-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;
const unpem = s => Buffer.from(String(s).replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');

/** a new device key pair (ECC P-256, as Lekuka prefers); the private key never leaves this installation */
function newKey() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return privateKey.export({ type: 'pkcs8', format: 'pem' });
}
const deviceCN = (serial, deviceId) => `RSL-${serial}-${String(deviceId).padStart(10, '0')}`;
/** PKCS #10 certificate signing request in PEM */
function csr(privateKeyPem, subject) {
  const pub = crypto.createPublicKey(privateKeyPem).export({ type: 'spki', format: 'der' });
  const info = seq(int(0), name(subject), pub, ctx(0, Buffer.alloc(0)));
  return pem('CERTIFICATE REQUEST', seq(info, algId(privateKeyPem), bitstr(sign(privateKeyPem, info))));
}
/** read a CSR: subject CN and the public key (and check its own signature) */
function readCsr(csrPem) {
  const der = unpem(csrPem);
  const walk = (b, i = 0) => { const tag = b[i]; let l = b[i + 1], o = i + 2; if (l & 0x80) { const n = l & 0x7f; l = 0; for (let k = 0; k < n; k++) l = (l << 8) | b[o + k]; o += n; } return { tag, start: i, body: o, end: o + l }; };
  const outer = walk(der), info = walk(der, outer.body), infoDer = der.slice(info.start, info.end);
  let p = info.body; const ver = walk(der, p); p = ver.end; const subj = walk(der, p); p = subj.end; const spki = walk(der, p);
  const spkiDer = der.slice(spki.start, spki.end);
  const alg = walk(der, info.end), sig = walk(der, alg.end);
  const sigBytes = der.slice(sig.body + 1, sig.end);
  const pub = crypto.createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });
  if (!crypto.verify('sha256', infoDer, pub, sigBytes)) throw new Error('The certificate request signature is not valid');
  const cn = (der.slice(subj.start, subj.end).toString('utf8').match(/RSL-[^\u0000-\u001f]+?-\d{10}/) || [])[0] || null;
  return { cn, publicKey: pub.export({ type: 'spki', format: 'pem' }), spkiDer };
}
/** X.509 v3 certificate (demo CA / tests): subject, its public key (SPKI DER), issued by issuerKey */
function certificate({ subject, issuer, spkiDer, issuerKey, days = 365, ca = false, client = false, server = false, serial, dns }) {
  const now = new Date(Date.now() - 60000), till = new Date(now.getTime() + days * 864e5);
  const exts = [seq(oid(OID.basicConstraints), ...(ca ? [tlv(0x01, Buffer.from([0xff]))] : []), octet(seq(...(ca ? [tlv(0x01, Buffer.from([0xff]))] : []))))];
  exts.push(seq(oid(OID.keyUsage), tlv(0x01, Buffer.from([0xff])), octet(tlv(0x03, ca ? Buffer.from([0x01, 0x06]) : Buffer.from([0x07, 0x80])))));
  if (client || server) exts.push(seq(oid(OID.extKeyUsage), octet(seq(...(client ? [oid(OID.clientAuth)] : []), ...(server ? [oid(OID.serverAuth)] : [])))));
  if (dns) exts.push(seq(oid(OID.subjectAltName), octet(seq(...dns.map(d => /^\d+\.\d+\.\d+\.\d+$/.test(d) ? tlv(0x87, Buffer.from(d.split('.').map(Number))) : tlv(0x82, Buffer.from(d)))))));
  const tbs = seq(ctx(0, int(2)), int(serial ? Buffer.from(serial, 'hex') : crypto.randomBytes(8)), algId(issuerKey), name(issuer), seq(utcTime(now), utcTime(till)), name(subject), spkiDer, ctx(3, seq(...exts)));
  return pem('CERTIFICATE', seq(tbs, algId(issuerKey), bitstr(sign(issuerKey, tbs))));
}
/** validity end and SHA-1 thumbprint of a certificate */
function certInfo(certPem) {
  const x = new crypto.X509Certificate(certPem);
  return { valid_to: new Date(x.validTo).toISOString().slice(0, 10), valid_from: new Date(x.validFrom).toISOString().slice(0, 10), subject: x.subject, issuer: x.issuer,
    thumbprint: crypto.createHash('sha1').update(x.raw).digest('base64'), serial: x.serialNumber, publicKey: x.publicKey };
}

module.exports = { newKey, csr, readCsr, certificate, certInfo, deviceCN, pem, unpem };
