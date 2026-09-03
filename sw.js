/* Release 1.0.0 production reliability shell. */
const APP_VERSION = "1.0.0";
const APP_REVISION = "1.0.0-prod6";
const ENTRY_PATH = "./index.html?v=" + APP_REVISION;
const CACHE_NAME = "dk-pendant-pwa-v" + APP_REVISION;
const OTA_PATH = "./ota.js";
const OTA_ASSET = "./ota.js?v=1.0.0-ota4";
const RELEASES_PATH = "./releases.js";
const RELEASES_ASSET = "./releases.js?v=1.0.0-prod2";
const APP_SHELL = [
  ENTRY_PATH, "./theme.js?v=1.0.0-infinity2", "./device-identity.js?v=1.0.0-device1", OTA_ASSET, RELEASES_ASSET, "./styles.css?v=1.0.0-diag1", "./brand.css?v=1.0.0-infinity3", "./audio-store.js?v=1.0.0-prod2", "./enhancements.js?v=1.0.0-prod2", "./app.js?v=1.0.0-diag1", "./ai-providers.js?v=1.0.0-ai2", "./recording-bridge.js?v=1.0.0-touch1",
  "./manifest.webmanifest", "./icon.svg?v=1.0.0-infinity2", "./synap-logo.svg?v=1.0.0-infinity2", "./icon-192.png", "./icon-512.png", "./logo.webp?v=1.0.0"
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
    event.source.postMessage({ type: "APP_VERSION", version: APP_REVISION, release: APP_VERSION, revision: APP_REVISION });
  }
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  const otaUrl = new URL(OTA_PATH, scope);
  const canonicalOtaUrl = new URL(OTA_ASSET, scope);
  const releasesUrl = new URL(RELEASES_PATH, scope);
  const canonicalReleasesUrl = new URL(RELEASES_ASSET, scope);
  const isOta = request.method === "GET" && url.origin === scope.origin && url.pathname === otaUrl.pathname;
  const isReleases = request.method === "GET" && url.origin === scope.origin && url.pathname === releasesUrl.pathname;
  const isEntry = request.mode === "navigate" && url.origin === scope.origin &&
    (url.pathname === scope.pathname || url.pathname === scope.pathname + "index.html");

  if (isOta || isReleases) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const canonicalUrl = isOta ? canonicalOtaUrl.href : canonicalReleasesUrl.href;
      const cached = await cache.match(canonicalUrl);
      if (cached) return cached;
      const fresh = await fetch(canonicalUrl, {cache:"reload"});
      if (fresh.ok) await cache.put(canonicalUrl, fresh.clone());
      return fresh;
    })());
    return;
  }

  if (request.method !== "GET" || (!SHELL_URLS.has(request.url) && !isEntry)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(isEntry ? new URL(ENTRY_PATH, scope).href : request);
    return cached || fetch(request);
  })());
});