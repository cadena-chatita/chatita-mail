// Chatita Mail service worker: app-shell cache. API/auth calls are never cached (mail stays private).
const CACHE = "chatita-mail-shell-v1";
const SHELL = ["/mail/", "/mail/manifest.webmanifest", "/mail/chatita-mail-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (!url.pathname.startsWith("/mail/") || url.pathname.startsWith("/mail-api/")) return;
  // Hashed build assets: cache-first. Navigations: network-first with cached shell fallback (offline).
  if (url.pathname.startsWith("/mail/assets/")) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; }))
    );
    return;
  }
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/mail/")));
  }
});
