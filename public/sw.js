// Kill-switch Service Worker.
//
// Antes este caminho (/sw.js) era o SW principal do app, gerado pelo
// vite-plugin-pwa. O SW principal foi movido para /sw-app.js. Este arquivo
// substitui qualquer instalação antiga em /sw.js e faz uma única coisa:
// limpar todos os caches e desregistrar a si mesmo, liberando o usuário
// que estava preso em uma versão velha do app (sintoma: "só abre em aba
// anônima"). Após a primeira ativação o navegador remove o SW e o app
// passa a rodar sem cache antigo.

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try { await self.clients.claim(); } catch (_) {}
    try {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    } catch (_) {}
    try { await self.registration.unregister(); } catch (_) {}
    try {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of clients) {
        const url = new URL(c.url);
        url.searchParams.set("sw-cleanup", String(Date.now()));
        try { await c.navigate(url.toString()); } catch (_) {}
      }
    } catch (_) {}
  })());
});

// Garante que enquanto este SW estiver vivo ele NUNCA serve nada do cache —
// sempre rede. Isso evita servir respostas obsoletas durante o curto período
// entre install e unregister.
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request).catch(() => Response.error()));
});
