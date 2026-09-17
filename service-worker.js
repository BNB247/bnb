/* ============================================================
   Blood Network Baraikhali — Service Worker
   ------------------------------------------------------------
   Strategy:
   - "App shell" (this site's own HTML/CSS/JS/icon + the Google
     Fonts + Font Awesome + Firebase SDK scripts it always loads)
     is cached so the page can open instantly and work offline.
   - Firebase Realtime Database traffic itself is NOT cached here
     (it uses its own websocket/long-poll connection, and the app
     already keeps a localStorage cache + falls back gracefully
     when offline — see readCache()/writeCache() in app.js).
   - Cache-first for the app shell (fast repeat loads), falling
     back to the network, and refreshing the cache in the
     background (stale-while-revalidate) so updates still reach
     returning visitors quickly.

   BUMP THIS VERSION whenever index.html/app.js/style.css change,
   so old caches are dropped and the new files are fetched. ------ */
const CACHE_VERSION = "bnb-v1";
const CACHE_NAME = "bnb-shell-" + CACHE_VERSION;

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./fav.jpeg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .catch(err => console.log("SW install cache failed:", err))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith("bnb-shell-") && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

/* Requests we never want to cache/intercept — Firebase's own
   read/write traffic, and anything that isn't a simple GET. */
function shouldBypass(request, url) {
  if (request.method !== "GET") return true;
  if (url.hostname.indexOf("firebasedatabase.app") !== -1) return true;
  if (url.hostname.indexOf("firebaseio.com") !== -1) return true;
  if (url.hostname === "www.googleapis.com") return true;
  return false;
}

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  if (shouldBypass(request, url)) return; // let the browser handle it normally

  event.respondWith(
    caches.match(request).then(cached => {
      const networkFetch = fetch(request)
        .then(response => {
          // Only cache good, basic/opaque responses (skip errors/redirects noise)
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached); // offline: fall back to whatever we cached

      // Cache-first: serve instantly if we have it, refresh in background.
      // Nothing cached yet: wait on the network.
      return cached || networkFetch;
    })
  );
});
