#!/usr/bin/env node
// My Wallet only: make an activation code for a business whose KYC you have approved.
//   node make-code.js --key "C:\path\to\private-key.pem" --install ABCD-1234-EF56-7890 --business "Ha Thetsane Butchery" [--days 365 | --expires 2027-12-31]
// The private key must never be put in the source code or on the business's computer.
const crypto = require('crypto'), fs = require('fs');
const a = {}; process.argv.slice(2).forEach((x, i, arr) => { if (x.startsWith('--')) a[x.slice(2)] = arr[i + 1]; });
if (!a.key || !a.install) { console.log('Usage: node make-code.js --key private-key.pem --install INSTALL-ID --business "Name" [--days 365 | --expires YYYY-MM-DD]'); process.exit(1); }
const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const today = new Date().toISOString().slice(0, 10);
let e = a.expires || null;
if (!e && a.days) { const d = new Date(); d.setUTCDate(d.getUTCDate() + Number(a.days)); e = d.toISOString().slice(0, 10); }
const p = b64u(JSON.stringify({ v: 1, i: String(a.install).trim().toUpperCase(), b: a.business || '', d: today, e }));
const code = `${p}.${b64u(crypto.sign(null, Buffer.from(p), fs.readFileSync(a.key, 'utf8')))}`;
console.log(`\nActivation code for ${a.business || a.install}${e ? ` (valid until ${e})` : ' (no end date)'}:\n\n${code}\n`);
