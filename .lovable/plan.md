## Diagnóstico

O sintoma "não abre em alguns navegadores, só funciona em aba anônima" é o padrão clássico de **Service Worker (PWA) com cache obsoleto**. O navegador anônimo funciona porque não há SW registrado nem cache.

Hoje a config (`vite.config.ts` + `src/main.tsx`) tem várias coisas certas — `NetworkFirst` no HTML, `skipWaiting`, `clientsClaim`, guard de iframe/preview, `NetworkOnly` no Supabase — mas falta o seguinte, que é exatamente o que prende o usuário:

1. **Sem recuperação no app quando um chunk hash some.** Quando o SW serve um `index.html` ainda válido mas que importa `assets/foo-OLDHASH.js`, e esse hash já não existe no novo deploy, o `import()` dinâmico falha e a tela fica em branco. Hoje não há listener para isso → o usuário precisa abrir aba anônima.
2. **SW antigo (de versões anteriores ao guard atual) pode estar instalado** em domínios `igreen.cloud` / `www.igreen.cloud` / `id-preview--*`. O guard novo só impede *novos* registros em preview/iframe; quem já tinha um SW velho em produção continua preso até o próprio SW se atualizar — e se a atualização falhar, fica preso pra sempre.
3. **Sem kill-switch acessível.** Se o estado quebrar, não existe uma rota / mecanismo que o usuário possa abrir para forçar limpeza (hoje só aba anônima resolve).
4. **`navigateFallback: "/index.html"`** pode servir um HTML cacheado do `precache` quando a rede demora >3s, mesmo com `NetworkFirst` — o que perpetua o problema em redes instáveis.
5. **manifest.json** está OK e não é o culpado, mas `id: "/admin"` + `start_url: "/admin?source=pwa"` são fixados no momento da instalação do PWA — não tocamos neles para não rebootar instalações já existentes.

## Plano (sem quebrar nada, sem migrações de banco)

### 1. Auto-recuperação de chunk hash obsoleto — `src/main.tsx`
Adicionar 1 listener global que detecta falha de import dinâmico e força recarregamento limpo:

- Escutar `window.addEventListener('vite:preloadError', ...)` (evento nativo do Vite ≥4).
- Escutar `window.addEventListener('error', ...)` filtrando mensagens `"Failed to fetch dynamically imported module"` / `"Importing a module script failed"`.
- Ao detectar, em **1 única vez por sessão** (sessionStorage flag pra não loopar):
  1. `caches.keys().then(ks => ks.forEach(k => caches.delete(k)))`
  2. `navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()))`
  3. `location.reload()` com query `?sw-recover=<timestamp>` para furar HTTP cache.
- O flag de sessionStorage garante que se o recarregamento ainda falhar, paramos de tentar e deixamos o erro aparecer normalmente (não cria loop infinito).

### 2. Kill-switch fallback `/sw.js` — `public/sw.js`
Criar um worker estático mínimo que **só faz limpeza e se desregistra**. Serve para devices que registraram um SW antigo num path diferente do gerado pelo VitePWA. Conteúdo essencial:

```js
self.addEventListener("install", e => e.waitUntil(self.skipWaiting()));
self.addEventListener("activate", e => e.waitUntil((async () => {
  await self.clients.claim();
  const names = await caches.keys();
  await Promise.all(names.map(n => caches.delete(n)));
  await self.registration.unregister();
})()));
```

Isso é seguro: o VitePWA gera seu próprio SW em outro nome (`/registerSW.js` + `/sw.js` injetado), e como o `injectRegister: null` está ativo, o app só registra o do plugin quando os guards permitem. O `/sw.js` estático só age se o navegador puxar esse caminho explicitamente — o que é o caso de instalações antigas.

> Confirmação necessária antes de aplicar: o VitePWA com `strategies: "generateSW"` **também emite um arquivo `/sw.js`** no build. Se for o caso, este passo entra em conflito. **Vou checar o output do build antes de escrever o `public/sw.js`** e, se houver conflito, troco a estratégia para servir o kill-switch em `/sw-cleanup.js` + adicionar registro do mesmo no `main.tsx` apenas para hosts publicados. Sem riscos para quem já está funcionando.

### 3. Endurecer o registro do SW — `src/main.tsx`
- Trocar `registerSW({ immediate: true })` por `registerSW({ immediate: true, onRegisteredSW(_, r) { setInterval(() => r?.update(), 60_000) } })` — força o navegador a checar atualização a cada minuto enquanto a aba está aberta, em vez de esperar o ciclo padrão (24h).
- Em caso de `onRegisterError`, fazer fallback: `unregister()` de tudo + `caches.delete(...)`.

### 4. Workbox: tornar HTML mais resiliente — `vite.config.ts`
- Reduzir `expiration.maxAgeSeconds` do `html-cache` de 24h para **5 min** (ainda permite offline curto, mas evita servir HTML antigo apontando para chunks que sumiram).
- Adicionar `cacheableResponse: { statuses: [200] }` no `html-cache` para não cachear redirects/erros.
- Manter tudo o mais igual (Supabase NetworkOnly, fontes/imagens iguais).

### 5. Adicionar rota oculta de "recuperação manual" — `src/App.tsx` (mínimo)
Rota `/reset` que renderiza um botão "Resetar app" que executa o mesmo cleanup do passo 1 e redireciona para `/`. Útil quando o usuário liga pelo suporte: "abre igreen.cloud/reset". Zero impacto em outros fluxos.

## Arquivos alterados
- `src/main.tsx` — listener de preloadError + onRegisteredSW com update periódico + onRegisterError com cleanup.
- `vite.config.ts` — `maxAgeSeconds` 24h→5min no `html-cache` + `cacheableResponse: { statuses: [200] }`.
- `public/sw.js` (ou `public/sw-cleanup.js` conforme verificação do build) — kill-switch estático.
- `src/App.tsx` — rota `/reset` (componente pequeno inline).

## Como vou validar
1. Build local (`tsc` automático do harness).
2. Conferir a saída do `dist/` para garantir que o `public/sw.js` não colide com o gerado pelo VitePWA.
3. Abrir o preview, simular um chunk error injetando uma URL falsa no console e verificar que o cleanup roda e a página recarrega (1x apenas).
4. Confirmar que em `/reset` o botão limpa caches + SW e volta para `/`.

## O que **NÃO** vou fazer (preservação)
- Não mudar `manifest.json` (`id`, `start_url`, `scope`, `display`) — alterar isso quebraria instalações PWA já adicionadas à tela de início dos usuários.
- Não mudar autenticação Supabase / sessão.
- Não mexer no banco / RLS / edge functions.
- Não remover o PWA — apenas torná-lo recuperável.