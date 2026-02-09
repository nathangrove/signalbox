const CACHE_NAME = 'webmail-cache-v1';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map(k => { if (k !== CACHE_NAME) return caches.delete(k); return null; })
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // API requests: try network first, fallback to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
    return;
  }

  // Navigation or HTML: network-first
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      if (!res || res.status !== 200 || res.type !== 'basic') return res;
      const copy = res.clone();
      caches.open(CACHE_NAME).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match('/index.html')))
  );
});
