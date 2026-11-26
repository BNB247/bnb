/* ============================================================
   Blood Network Baraikhali — Service Worker  (v3)
   - Own HTML/JS/CSS/manifest: NETWORK-FIRST (3s limit — on a slow connection the cached copy is shown
     instead of waiting), fall back to cache when offline.
   - Own images/icons: cache-first + refreshed in the background (stale-while-revalidate) => instant repeat loads.
     => after you upload a new version, visitors get it on the very next load
        (the old cache-first logic kept serving stale app.js).
   - Fonts / Font Awesome / Firebase SDK (CDN, versioned URLs): cache-first.
   - Firebase database traffic, non-GET requests, other origins: never touched.
   BUMP CACHE_VERSION when you change files, so old caches are dropped.
   ============================================================ */
const CACHE_VERSION = "bnb-v23";
const CACHE_NAME = "bnb-shell-" + CACHE_VERSION;

const APP_SHELL = [
  "/", "/index.html",
  "/how-it-works/", "/blood-group-chart/", "/donations/", "/news/", "/hospitals/", "/gallery/", "/about/", "/privacy/",
  "/assets/css/style.css",
  "/assets/js/app.js", "/assets/js/i18n.js", "/assets/js/early.js", "/assets/js/install-bar.js",
  "/manifest.json",
  "/assets/images/fav.jpeg", "/assets/images/fav-128.webp", "/assets/images/icon-192.png"
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

  /* Private pages (/admin/, /list/) are never cached or touched by the public site's worker.
     /list/ has its own worker (/list/sw.js); /admin/ always goes straight to the network. */
  if (sameOrigin && /^\/(admin|list)(\/|$)/.test(url.pathname)) return;
  const cdn = CDN_HOSTS.indexOf(url.hostname) !== -1;
  if (!sameOrigin && !cdn) return;   // Firebase DB, Drive images, QR service ... go straight to the network

  if (sameOrigin) {
    const offlineFallback = () =>
      caches.match(request, { ignoreSearch: request.mode === "navigate" }).then(hit =>
        hit || (request.mode === "navigate" ? caches.match("/index.html") : null) || Response.error()
      );

    // images / icons: show the cached copy at once, refresh it quietly in the background
    if (request.destination === "image") {
      event.respondWith(
        caches.match(request).then(hit => {
          const net = fetch(request).then(res => putInCache(request, res)).catch(() => hit || Response.error());
          return hit || net;
        })
      );
      return;
    }

    // everything else: network-first, but never wait longer than 3s when a cached copy exists
    event.respondWith(
      caches.match(request, { ignoreSearch: request.mode === "navigate" }).then(cached => {
        const net = fetch(request).then(res => putInCache(request, res));
        if (!cached) return net.catch(offlineFallback);
        const timeout = new Promise(resolve => setTimeout(() => resolve(cached), 3000));
        return Promise.race([net.catch(() => cached), timeout]);
      })
    );
    return;
  }

  // CDN: cache-first
  event.respondWith(
    caches.match(request).then(hit => hit || fetch(request).then(res => putInCache(request, res)))
  );
});
