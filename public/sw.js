self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Intentionally no fetch/cache handler.
// TurnIA handles sensitive professional and patient data; the PWA service worker
// enables installation/standalone behavior without persisting protected responses
// in an offline cache.
