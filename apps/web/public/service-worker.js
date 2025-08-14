const STATIC_CACHE = 'static-v3';
const API_CACHE = 'api-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => ![STATIC_CACHE, API_CACHE].includes(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  const isGET = req.method === 'GET';
  const sameOrigin = url.origin === location.origin;

  // Navigation and Next data: network-first to avoid stale UI
  const isNavigate = req.mode === 'navigate';
  const isNextData = sameOrigin && url.pathname.startsWith('/_next/data');
  if (isGET && (isNavigate || isNextData)) {
    event.respondWith((async () => {
      try { return await fetch(req); } catch {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(req);
        if (cached) return cached;
        throw new Error('offline');
      }
    })());
    return;
  }

  // Static assets and Next hashed assets: cache-first
  const isStaticAsset = /\.(?:js|css|woff2?|png|jpg|jpeg|gif|svg)$/.test(url.pathname) || url.pathname.startsWith('/_next/static');
  if (isGET && sameOrigin && isStaticAsset) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      const resp = await fetch(req);
      if (resp.ok) cache.put(req, resp.clone());
      return resp;
    })());
    return;
  }

  // API: network-first with cache fallback
  if (isGET && url.pathname.startsWith('/api/')) {
    event.respondWith((async () => {
      try {
        const resp = await fetch(req);
        const cache = await caches.open(API_CACHE);
        if (resp.ok) cache.put(req, resp.clone());
        return resp;
      } catch {
        const cache = await caches.open(API_CACHE);
        const cached = await cache.match(req);
        if (cached) return cached;
        throw new Error('offline');
      }
    })());
  }
});


