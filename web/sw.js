// Keeps the app working offline. The build fills in CACHE and FILES (every file it wrote): they're stored when this worker
// installs, the page comes from the network when it answers, and API calls are never stored.
const CACHE = __CACHE__;
const FILES = __FILES__;

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))));

self.addEventListener('activate', (e) =>
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))),
);

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  const stored = (request) => caches.match(request, { cacheName: CACHE });
  if (e.request.mode === 'navigate') {
    // the newest page if the server answers well within 4 s; otherwise (offline, server down, Cloudflare error) the stored one
    const network = Promise.race([fetch(e.request), new Promise((_, fail) => setTimeout(fail, 4000))]);
    e.respondWith(network.then((r) => (r.ok ? r : Promise.reject())).catch(async () => (await stored('/index.html')) ?? Response.error()));
    return;
  }
  e.respondWith(stored(e.request).then((hit) => hit ?? fetch(e.request)));
});
