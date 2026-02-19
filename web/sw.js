const CACHE_NAME = 'notjaec-cache-v1';
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

  // Notify all controlled clients that a new service worker has activated.
  // Pages can reload in response to this message to get the new content.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        try {
          client.postMessage({ type: 'NEW_VERSION_ACTIVATED' });
        } catch (e) {
          // ignore
        }
      }

      // Show a system notification so backgrounded PWAs receive an immediate alert.
      // Browsers will ignore this if Notification permission is denied.
      try {
        if (self.registration && self.registration.showNotification) {
          return self.registration.showNotification('Signalbox updated', {
            body: 'A new version is available — tap to open.',
            tag: 'app-update',
            renotify: true,
            data: { url: '/' },
            icon: '/icons/icon-192.svg'
          });
        }
      } catch (e) {
        // ignore notification errors
      }
    })
  );
});

// Allow the page to send a message to the SW to skip waiting and activate immediately.
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Handle notification click to focus or open the app.
self.addEventListener('notificationclick', (event) => {
  const notif = event.notification;
  const url = (notif && notif.data && notif.data.url) ? notif.data.url : '/';
  notif.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        try {
          if (client.url === url && 'focus' in client) return client.focus();
        } catch (e) {
          // ignore
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // API requests: try network first, fallback to cache.
  // Support both /api/ and /v1/ prefixes and treat requests that accept JSON as API calls.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/v1/') ||
    req.headers.get('accept')?.includes('application/json')
  ) {
    event.respondWith(
      fetch(req).then(res => {
        try {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
        } catch (e) {
          // ignore caching errors for API responses
        }
        return res;
      }).catch(() => caches.match(req))
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
