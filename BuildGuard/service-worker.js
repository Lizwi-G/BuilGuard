/*
  BuildGuard service worker — Phase 6 (PWA / Offline)
  Caches the app shell so the interface loads instantly and works with a
  flaky or absent site connection. Data writes made while offline are
  queued separately by js/offline.js (IndexedDB), not by this file.
*/

const CACHE_NAME = 'buildguard-shell-v5';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/config.js',
  './js/supabaseClient.js',
  './js/utils.js',
  './js/storage.js',
  './js/demoData.js',
  './js/db.js',
  './js/state.js',
  './js/offline.js',
  './js/nav.js',
  './js/auth.js',
  './js/notifications.js',
  './js/dashboard.js',
  './js/approvals.js',
  './js/expenses.js',
  './js/purchases.js',
  './js/fuel.js',
  './js/deliveries.js',
  './js/inventory.js',
  './js/suppliers.js',
  './js/projects.js',
  './js/alerts.js',
  './js/moneyleaks.js',
  './js/savings.js',
  './js/insights.js',
  './js/reports.js',
  './js/team.js',
  './js/activity.js',
  './js/auditlog.js',
  './js/settings.js',
  './js/app.js',
  './assets/icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for navigation (so users get fresh app updates when online),
// falling back to the cached shell when offline. Cache-first for everything
// else (css/js/icons) for speed.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() => cached);
    })
  );
});
