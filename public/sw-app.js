// Kill-switch Service Worker.
// /sw-app.js foi o Service Worker principal do PWA. Agora este arquivo existe
// só para atualizar navegadores antigos, limpar caches do app e se remover.

function isAppCacheName(name) {
  return (
    /(^|-)precache-v\d+-|(^|-)runtime-|(^|-)googleAnalytics-/.test(name) ||
    /^workbox-/.test(name) ||
    name === "img-cache" ||
    name === "google-fonts"
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try { await self.clients.claim(); } catch (_) {}
    try {
      const names = await caches.keys();
      await Promise.all(names.filter(isAppCacheName).map((n) => caches.delete(n)));
    } catch (_) {}
    try {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of clients) {
        const url = new URL(c.url);
        url.searchParams.set("sw-cleanup", String(Date.now()));
        try { await c.navigate(url.toString()); } catch (_) {}
      }
    } catch (_) {}
    try { await self.registration.unregister(); } catch (_) {}
  })());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request).catch(() => Response.error()));
});