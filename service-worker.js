/* ============================================================
   Blood Network Baraikhali — Service Worker  (v3)
   - Own files (HTML/JS/CSS/manifest): NETWORK-FIRST, fall back to cache when offline.
     => after you upload a new version, visitors get it on the very next load
        (the old cache-first logic kept serving stale app.js).
   - Fonts / Font Awesome / Firebase SDK (CDN, versioned URLs): cache-first.
   - Firebase database traffic, non-GET requests, other origins: never touched.
   BUMP CACHE_VERSION when you change files, so old caches are dropped.
   ============================================================ */
const CACHE_VERSION = "bnb-v3";
const CACHE_NAME = "bnb-shell-" + CACHE_VERSION;

const APP_SHELL = [
  "./", "./index.html", "./style.css", "./app.js", "./i18n.js", "./early.js",
  "./install-bar.js", "./manifest.json", "./fav.jpeg", "./icon-192.png"
];

/* Only these CDN hosts are cached (all are pinned/versioned URLs or immutable font files). */
const CDN_HOSTS = [
  "fonts.googleapis.com", "fonts.gstatic.com", "cdnjs.cloudflare.com", "www.gstatic.com"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // one missing file (e.g. an icon) must not abort the whole install
      Promise.all(APP_SHELL.map(url => cache.add(url).catch(err => console.log("SW skip:", url, err))))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.startsWith("bnb-shell-") && k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function putInCache(request, response) {
  if (response && response.ok && response.type !== "opaque") {
    const copy = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
  }
  return response;
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  const sameOrigin = url.origin === self.location.origin;
  const cdn = CDN_HOSTS.indexOf(url.hostname) !== -1;
  if (!sameOrigin && !cdn) return;   // Firebase DB, Drive images, QR service ... go straight to the network

  if (sameOrigin) {
    // network-first; offline -> cached copy; offline page navigation (even with ?id=...) -> cached index.html
    event.respondWith(
      fetch(request).then(res => putInCache(request, res)).catch(() =>
        caches.match(request, { ignoreSearch: request.mode === "navigate" }).then(hit =>
          hit || (request.mode === "navigate" ? caches.match("./index.html") : null) || Response.error()
        )
      )
    );
    return;
  }

  // CDN: cache-first
  event.respondWith(
    caches.match(request).then(hit => hit || fetch(request).then(res => putInCache(request, res)))
  );
});
