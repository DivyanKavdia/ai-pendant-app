/* Release 5.7.0. Only this application's public shell is cached. */
const APP_VERSION = "5.7.0";
const ENTRY_PATH = "./index.html?v=" + APP_VERSION;
const CACHE_NAME = "dk-pendant-pwa-v" + APP_VERSION;
const APP_SHELL = [
  ENTRY_PATH, "./ota.js?v=5.7.0", "./styles.css?v=5.7.0", "./audio-store.js?v=5.7.0", "./app.js?v=5.7.0",
  "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png", "./logo.webp?v=5.7.0"
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
self.addEventListener("message", event => {
  if (event.data && event.data.type === "GET_VERSION" && event.source) {
    event.source.postMessage({ type: "APP_VERSION", version: APP_VERSION });
  }
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  const isEntry = request.mode === "navigate" && url.origin === scope.origin &&
    (url.pathname === scope.pathname || url.pathname === scope.pathname + "index.html");
  if (request.method !== "GET" || (!SHELL_URLS.has(request.url) && !isEntry)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Serve the complete installed release, not independently refreshed files.
    // A new worker precaches all assets before activation. Query-string entry
    // URLs use the same shell, including when offline.
    const cached = await cache.match(isEntry ? new URL(ENTRY_PATH, scope).href : request);
    return cached || fetch(request);
  })());
});
