/* SM-Crestboard service worker
   - Halaman: ambil dari jaringan dulu, pakai salinan terakhir kalau offline.
   - Data harga & fundamental: jaringan dulu, salinan terakhir kalau offline.
   - Penghitung pengunjung & RS: selalu dari jaringan.
   - Skrip & konfigurasi situs: jaringan dulu (supaya perubahan langsung terasa).
   - Pustaka grafik, font, ikon: pakai salinan, perbarui di belakang layar. */
const VERSION = 'smcb-v2';
const SHELL = ['/', '/index.html', '/scanner.html', '/manifest.json', '/logo-mark.png', '/favicon.png', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function networkFirst(req, key) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(key || req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key || req, { ignoreSearch: !key });
    if (hit) return hit;
    throw err;
  }
}
async function staleWhileRevalidate(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.startsWith('/api/visit') || url.pathname.startsWith('/api/rs')) return;
    if (url.pathname.startsWith('/api/')) { e.respondWith(networkFirst(req, url.pathname + url.search)); return; }
    if (req.mode === 'navigate') { e.respondWith(networkFirst(req, url.pathname === '/' ? '/' : url.pathname)); return; }
    if (url.pathname.endsWith('.js') || url.pathname.endsWith('.json')) { e.respondWith(networkFirst(req)); return; }
    e.respondWith(staleWhileRevalidate(req));
    return;
  }
  if (/cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com|flagcdn\.com/.test(url.host)) e.respondWith(staleWhileRevalidate(req));
});
