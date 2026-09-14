const CACHE = 'synapsenest-v6-pty';
const PRECACHE = [
  '/workspace',
  '/workspace.html',
  '/styles.css',
  '/workspace.css',
  '/workspace.js',
  '/vendor/monaco/vs/loader.js',
  '/vendor/monaco/vs/editor/editor.main.css',
  '/vendor/xterm/xterm.css',
  '/vendor/xterm/xterm.js',
  '/vendor/xterm/addon-fit.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request).then((cached) => cached || caches.match('/workspace.html')))
  );
});
