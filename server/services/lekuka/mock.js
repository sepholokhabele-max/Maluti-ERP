// An HTTPS stand-in for the RSL gateway (tests): mutual TLS, the real paths and methods, answers from the practice gateway.
const https = require('https');
const sim = require('./simulator');
const { EP } = require('./client');

function start({ port = 0, key, cert, ca }) {
  const routes = Object.entries(EP).map(([op, [method, p]]) => ({ op, method, re: new RegExp('^' + p.replace('{id}', '(\\d+)').replace(/\//g, '\\/') + '$') }));
  const srv = https.createServer({ key, cert, ca, requestCert: true, rejectUnauthorized: false }, (req, res) => {
    const u = new URL(req.url, 'https://x'); const r = routes.find(x => x.method === req.method && x.re.test(u.pathname));
    const send = (code, j) => { res.writeHead(code, { 'Content-Type': code >= 400 ? 'application/problem+json' : 'application/json' }); res.end(JSON.stringify(j)); };
    if (!r) return send(404, { title: 'Not found', status: 404 });
    if (!req.headers.devicemodelname || !req.headers.devicemodelversionno) return send(422, { title: 'Device model and version is not registered in Lekuka', status: 422, errorCode: 'DEV06' });
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks).toString('utf8'); let body = {};
      if (r.method === 'GET') body = Object.fromEntries(u.searchParams);
      else if (/multipart/.test(req.headers['content-type'] || '')) body = { file: (raw.split('\r\n\r\n')[1] || '').split('\r\n--')[0] };
      else { try { body = JSON.parse(raw || '{}'); } catch (_) { return send(400, { title: 'Bad request', status: 400 }); } }
      const pc = req.socket.getPeerCertificate && req.socket.getPeerCertificate();
      const certPem = pc && pc.raw ? `-----BEGIN CERTIFICATE-----\n${pc.raw.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n` : null;
      const isPublic = ['VerifyTaxpayerInformation', 'RegisterDevice', 'GetServerCertificate'].includes(r.op);
      try { send(200, await sim.handle(r.op, (u.pathname.match(r.re) || [])[1], body, { cert: isPublic ? undefined : certPem, model: { name: req.headers.devicemodelname, version: req.headers.devicemodelversionno } })); }
      catch (e) { send(e.status || 500, e.problem || { title: e.message, status: 500 }); }
    });
  });
  return new Promise(resolve => srv.listen(port, '127.0.0.1', () => resolve(srv)));
}
module.exports = { start };
