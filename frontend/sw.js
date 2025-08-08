const CACHE = 'nutri-pwa-v1';
const ASSETS = [
  './',
  './index.html',
  './sw.js',
  './manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  // For navigations (HTML), try network first then cache.
  if (request.mode === 'navigate'){
    e.respondWith((async () => {
      try{
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE); cache.put('./index.html', fresh.clone());
        return fresh;
      } catch{
        const cache = await caches.open(CACHE);
        const cached = await cache.match('./index.html');
        return cached || new Response('<h1>Offline</h1>', { headers:{'Content-Type':'text/html'} });
      }
    })());
    return;
  }

  // For static assets: cache-first, then network and update cache.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    try{
      const fresh = await fetch(request);
      cache.put(request, fresh.clone());
      return fresh;
    } catch {
      return new Response('', { status: 504 });
    }
  })());
});
