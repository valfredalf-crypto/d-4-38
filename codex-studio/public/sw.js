// Service worker di Codex Studio (PWA).
// Strategia: cache dell'app shell (stale-while-revalidate) solo per le risorse di
// stessa origine. Le chiamate alle API dei provider e a /api non vengono mai messe in cache.
const CACHE = 'codex-studio-v1';
const SHELL = ['./', './index.html', './styles.css', './manifest.webmanifest', './icon.svg',
  './js/app.js', './js/markdown.js', './js/prompts.js', './js/catalog.js', './js/providers-browser.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Solo GET di stessa origine; mai /api o host esterni (provider AI).
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
      return cached || network;
    }),
  );
});
