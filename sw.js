/* Release 5.0.0. Only this application's public shell is cached. */
const CACHE_NAME = "dk-pendant-pwa-v5.0.0";
const APP_SHELL = [
  "./", "./index.html", "./styles.css?v=5.0.0", "./audio-store.js?v=5.0.0", "./app.js?v=5.0.0",
  "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png"
];
const SHELL_URLS = new Set(APP_SHELL.map(path => new URL(path, self.registration.scope).href));

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith("dk-pendant-pwa-") && key !== CACHE_NAME)
      .map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || !SHELL_URLS.has(request.url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      // Network-first avoids stale JavaScript after a deployment. Query versions
      // also keep an older worker from serving the previous app.js to a new page.
      const response = await fetch(request);
      if (response.ok) {
        await cache.put(request, response.clone());
        return response;
      }
      return (await cache.match(request)) || response;
    } catch (error) {
      const cached = await cache.match(request);
      if (cached) return cached;
      throw error;
    }
  })());
});
