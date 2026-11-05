// Maluti ERP service worker (web / Android): the app screens load instantly and open even with a weak connection.
// Only the app's own files are cached. The API (/api), receipts (/r) and the customer portal (/p) always go to the server –
// money and stock are never served from a cache.
const VERSION = 'maluti-__VERSION__';
const SHELL = ['./', 'index.html', 'css/app.css', 'img/icon.svg', 'img/icon-192.png', 'manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || /^\/(api|r|p)\//.test(u.pathname)) return;
  // network first (always the newest version after an update), cache when offline
  e.respondWith(fetch(e.request).then(res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); } return res; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
