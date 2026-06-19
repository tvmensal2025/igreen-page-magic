## Diagnóstico

O projeto já tem boa infra anti-cache (kill-switch `/sw.js`, SW principal `/sw-app.js` com `skipWaiting`+`clientsClaim`, version gate via `/version.json`, reload em `controllerchange`). Mas há **um furo crítico**:

- `igreen.cloud` está no **Cloudflare com nuvem cinza (DNS-only)** → o tráfego vai **direto para a Lovable Hosting**, que **NÃO processa `public/_headers`**.
- Resultado: `index.html`, `/sw-app.js` e `/version.json` podem ser servidos com cache padrão do CDN/navegador → o version gate nunca dispara porque o próprio `version.json` vem velho, e o SW novo nunca é baixado.

Sem cabeçalhos do servidor, precisamos forçar "no-cache" pelo lado do **cliente** (meta tags, query busters, checagens mais agressivas) e adicionar uma rota de emergência manual.

## O que será feito

### 1. Forçar revalidação do HTML pelo lado do cliente (`index.html`)
Adicionar no `<head>`:
```html
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
<meta http-equiv="Pragma" content="no-cache" />
<meta http-equiv="Expires" content="0" />
```
Faz o navegador revalidar o HTML a cada navegação, independente do servidor.

### 2. Quebrar cache do `/version.json` e `/sw-app.js` no registro
Em `src/main.tsx`:
- `fetch("/version.json")` já usa cache-buster — ok.
- Adicionar buster também ao registrar o SW: `registerSW({ ... })` por baixo carrega `/sw-app.js`. Vamos usar `updateViaCache: "none"` no `navigator.serviceWorker.register` equivalente, e forçar `r.update()` com `fetch("/sw-app.js?_=" + Date.now(), {cache:"no-store"})` antes para invalidar.

### 3. Version gate mais agressivo
Hoje checa: ao registrar, a cada 60s, em `visibilitychange`, em `online`.
Adicionar:
- Checagem **a cada navegação de rota** (hook no React Router que chama `checkVersionGate`).
- Reduzir o intervalo de polling de 60s → **30s**.
- Rodar `checkVersionGate()` **antes** do `registerSW` (pega usuário cujo SW antigo está servindo HTML cacheado e nem chegaria a registrar o novo).

### 4. Rota de emergência `?nuke=1` / `/__reset`
Qualquer usuário preso pode acessar `https://igreen.cloud/?nuke=1` e o app:
- Desregistra todos os SWs
- Limpa todos os caches (`caches.keys()` → delete)
- Limpa `localStorage` opcionalmente (só flags PWA, preserva auth)
- Recarrega com `location.replace("/")`.
Reutiliza a função `nukeAndReload` já existente; só adicionar o gatilho de URL no topo do `main.tsx`.

### 5. Aviso visual de atualização (opcional, recomendado)
Quando o version gate detecta versão nova mas o usuário está digitando (não pode recarregar agora), mostrar um **toast persistente** "Nova versão disponível — clique para atualizar". Hoje só re-tenta em 15s silenciosamente. Garante que o usuário tem opção manual.

### 6. Limpar/remover `public/_headers` e `public/_redirects`
Como Lovable Hosting ignora ambos, eles dão falsa segurança. Vamos:
- **Remover** `public/_headers` e `public/_redirects` (Lovable já faz SPA fallback nativo).
- Deixar comentário no `vite.config.ts` documentando que a estratégia anti-cache é 100% client-side.

### 7. Documentação rápida (no `vite.config.ts` em comentário)
Anotar que se um dia o domínio voltar para nuvem laranja do Cloudflare, basta recriar `_headers` que volta a funcionar como reforço.

## Arquivos afetados

- `index.html` — meta tags no-cache
- `src/main.tsx` — polling 30s, hook por rota, gatilho `?nuke=1`, toast de update
- `public/_headers` — remover
- `public/_redirects` — remover
- `vite.config.ts` — comentário explicativo

## Resultado esperado

Após publicar uma vez com essas mudanças, **todo deploy futuro** chega em qualquer navegador em no máximo:
- **Imediato** se a aba está aberta (controllerchange + version gate).
- **Na próxima navegação** se a aba estava fechada (meta no-cache força revalidar HTML).
- **Manual via `?nuke=1`** para casos extremos (PWA instalado offline há semanas).

## Nota importante

Esta primeira atualização ainda depende dos navegadores pegarem o **novo** `index.html` que contém as meta tags. Usuários muito presos podem precisar abrir `https://igreen.cloud/?nuke=1` **uma vez**. Daí em diante, está blindado.
