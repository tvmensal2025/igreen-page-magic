# Por que a página fica recarregando

Encontrei 3 causas reais analisando `src/main.tsx`, `public/sw.js`, `CampaignsList.tsx` e `AudioStudio.tsx`. Não é a UI re-renderizando — é a página inteira **recarregando sozinha** em loop.

## Causa 1 (principal): "version gate" agressivo em `src/main.tsx`

Hoje o `main.tsx` faz, em produção:

- `checkVersionGate()` **na inicialização**
- `checkVersionGate()` em **toda navegação SPA** (patch em `history.pushState`, `replaceState`, `popstate`)
- `setInterval(poll, 30_000)` chamando `r.update()` + `checkVersionGate()` a cada **30 s**
- `checkVersionGate()` em **todo `visibilitychange`** (trocou de aba e voltou → checa)
- `checkVersionGate()` em **todo evento `online`**
- Auto-reload em `controllerchange` do Service Worker
- `nukeAndReload` em qualquer `vite:preloadError` / `ChunkLoadError`

Quando `/version.json` responde com um `buildId` diferente do `__BUILD_ID__` do bundle (acontece sempre que o CDN serve uma versão e o `version.json` outra, ou logo após deploy), ele dispara `nukeAndReload` → limpa caches → `window.location.replace(...)`. A trava `__sw_recovered__` é **por sessionStorage**, então abrir uma nova aba zera e o loop volta.

Soma disso com o `controllerchange` (cada novo SW que ativa força reload) = página recarregando "do nada" no meio do trabalho.

## Causa 2: erros 400 derrubando confiança e gerando reloads

- `src/components/admin/ads/CampaignsList.tsx:187` faz `select("public_url")` mas a coluna correta da tabela `ad_image_library` é `url` (ver `src/services/adImageLibrary.ts`). Isso gera o `400 Bad Request` que aparece no console.
- `tts-cache/v6_417632168_111.mp3` retorna 400 porque o arquivo não existe no bucket (cache miss tratado como erro). É um `HEAD/GET` de probe — não deveria poluir o console nem afetar render; o `AudioStudio` precisa engolir esse 400 como "não tem cache, gera".

## Causa 3: `QuotaExceededError` do Workbox

O service worker do `vite-plugin-pwa` está tentando precachear assets demais e estoura o quota do navegador. Isso aborta a instalação do SW novo → o velho continua → `controllerchange` dispara depois → reload. Hoje não há `maximumFileSizeToCacheInBytes` nem exclusão de arquivos grandes (áudios/vídeos/PDFs) no `vite.config.ts`.

# O que vou mudar

## 1) `src/main.tsx` — desarmar o loop de reload
- Remover o patch em `history.pushState/replaceState/popstate` que chama `checkVersionGate` (causa principal das checagens em rajada).
- Aumentar o intervalo do `setInterval` de **30 s → 10 min**.
- Remover a chamada de `checkVersionGate` no `visibilitychange`/`online` (manter só `r.update()`).
- Mover a trava `__sw_recovered__` de **sessionStorage → localStorage** com TTL de 10 min, para não relooper ao abrir nova aba.
- No `controllerchange`: **não** recarregar automaticamente; mostrar o banner "Nova versão disponível — toque para atualizar" (`showUpdateBanner`) e deixar o usuário decidir. Isso evita perder o que está digitando.
- Manter `?nuke=1`, `vite:preloadError` e `ChunkLoadError` como hoje (são recuperação real de tela branca).

## 2) `src/components/admin/ads/CampaignsList.tsx`
- Trocar `select("public_url")` por `select("url")` e ler `imgs[0]?.url`. Acaba com o 400 do `ad_image_library`.

## 3) `src/components/admin/AudioStudio.tsx`
- No probe do cache TTS (`tts-cache/...mp3`), tratar 400/404 como cache-miss silencioso (sem logar erro vermelho).

## 4) `vite.config.ts` — Workbox sem estourar quota
- Adicionar em `VitePWA({ workbox: { ... } })`:
  - `maximumFileSizeToCacheInBytes: 3 * 1024 * 1024` (3 MB)
  - `globIgnores: ["**/*.mp3", "**/*.mp4", "**/*.wav", "**/*.pdf", "**/opus/*"]`
- Mantém `NetworkFirst` para navegações; só corta o precache gigante que estoura quota.

# Resultado esperado

- Página para de recarregar sozinha enquanto o usuário trabalha (especialmente no AudioStudio).
- Quando houver deploy novo, aparece o banner verde "Nova versão disponível" em vez de reload forçado.
- Console limpa: sem mais 400 do `ad_image_library` nem `QuotaExceededError` do workbox.
- Rascunho do AudioStudio (já implementado antes) continua salvando, mas tende a não ser mais necessário porque o reload espontâneo some.

# Detalhes técnicos

Arquivos editados:
- `src/main.tsx` (linhas ~136–183 e ~206–264)
- `src/components/admin/ads/CampaignsList.tsx` (linhas 185–193)
- `src/components/admin/AudioStudio.tsx` (handler do probe `tts-cache`)
- `vite.config.ts` (opções do `VitePWA`)

Nada de banco / edge function muda. Nenhum dado é apagado.
