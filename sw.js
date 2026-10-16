/* Conyso Mart service worker: pages open on a weak signal, and the app works from the home screen.
 * Pages: network first, the last copy if offline, else the offline page.
 * Our CSS/JS/icons carry a content hash in the URL (?h=), so a cached copy never goes stale.
 * Brand photos: served from cache when we have them, refreshed in the background, capped in number.
 */
var PAGES = "mart-pages-v1", ASSETS = "mart-assets-v1", PHOTOS = "mart-photos-v1", MAX_PHOTOS = 60;  // cross-origin photos are opaque; browsers count each one large against storage

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(PAGES).then(function (c) { return c.addAll(["offline.html", "index.html"]); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  var keep = [PAGES, ASSETS, PHOTOS];
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("mart-") === 0 && keep.indexOf(k) < 0; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function trim(name, max) {
  caches.open(name).then(function (c) {
    c.keys().then(function (keys) { if (keys.length > max) { c.delete(keys[0]).then(function () { trim(name, max); }); } });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") { return; }
  var url = new URL(req.url);
  var scope = new URL(self.registration.scope);

  if (req.mode === "navigate" && url.origin === scope.origin && url.pathname.indexOf(scope.pathname) === 0) {
    e.respondWith(fetch(req).then(function (res) {
      var copy = res.clone();
      if (res.ok) { caches.open(PAGES).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || caches.match("offline.html"); });
    }));
    return;
  }

  if (url.origin === scope.origin && url.pathname.indexOf(scope.pathname + "img/") === 0) {
    // our own photo copies: named by source, so a cached one is always right
    e.respondWith(caches.open(ASSETS).then(function (c) {
      return c.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) { if (res.ok) { c.put(req, res.clone()); } return res; });
      });
    }));
    return;
  }

  if (url.origin === scope.origin && url.pathname.indexOf(scope.pathname) === 0 && /\.(css|js|png|svg|webmanifest)$/.test(url.pathname)) {
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        var copy = res.clone();
        if (res.ok && url.search) { caches.open(ASSETS).then(function (c) { c.put(req, copy); }); }
        return res;
      });
    }));
    return;
  }

  if (req.destination === "image" && url.origin !== scope.origin) {
    e.respondWith(caches.open(PHOTOS).then(function (c) {
      return c.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) {
          c.put(req, res.clone()); trim(PHOTOS, MAX_PHOTOS); return res;
        }).catch(function () { return hit; });
        return hit || net;
      });
    }));
  }
});
