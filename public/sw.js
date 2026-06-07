// sw.js – Minimaler Service Worker.
// Nötig, damit der Browser die App als installierbar erkennt.
// Bewusst KEIN Caching: das Admin-Tool soll immer frische Daten vom Server holen.

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

// Netzwerk durchreichen, nichts cachen.
self.addEventListener('fetch', (e) => {
  // kein respondWith → Browser macht den normalen Netzwerk-Request
});
