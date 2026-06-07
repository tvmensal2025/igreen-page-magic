## Diagnóstico

Os logs do `worker-igreen-sync` no easypanel mostram:

```
[login] status=401 body=Unauthorized
[login] ERRO: Login rejeitado — email ou senha incorretos
```

**Importante:** o worker ESTÁ conseguindo passar pelo Cloudflare (via Tor) e ESTÁ chegando até a API `api-voffice.igreenenergy.com.br/v1/login`. O 401 é a resposta REAL da API iGreen rejeitando o login.

Comparando com o `worker-portal` (que funciona em produção e usa as MESMAS credenciais da tabela `consultants.igreen_portal_password`):

- `worker-portal/playwright-automation.mjs:826` faz `fetch` **direto via Node** (sem Tor, sem browser, sem Playwright) para `/v1/login`, passando apenas `Origin` e `Referer` de `escritorio.igreenenergy.com.br`. **Funciona perfeitamente.**
- `worker-igreen-sync/server.mjs` faz o mesmo login via **Tor + Playwright + page.evaluate** — recebe 401 com as mesmas credenciais.

Ou seja: a complexidade adicionada (Tor + browser real) está sendo rejeitada pela API. Provavelmente o IP residencial do Tor tem reputação ruim para essa rota específica, OU algum header automático do `fetch` do browser (cookie/CSRF/cf_clearance) está fazendo a API rejeitar.

A solução é alinhar o `worker-igreen-sync` com o método que JÁ FUNCIONA no `worker-portal`.

## Plano

### 1. Refatorar `worker-igreen-sync/server.mjs`

Trocar a estratégia de login e leitura de dados:

- **Remover** uso de Playwright/Chromium e Tor para o fluxo `/sync-customers` e `/sync-network`.
- **Usar `fetch` nativo do Node** direto contra `https://api-voffice.igreenenergy.com.br/v1/login`, exatamente como `worker-portal/playwright-automation.mjs:819-834`:
  - Headers: `Content-Type: application/json`, `Accept: application/json, text/plain, */*`, `Origin: https://escritorio.igreenenergy.com.br`, `Referer: https://escritorio.igreenenergy.com.br/`, `User-Agent` de Chrome desktop.
  - Body: `{ email, password }`.
- Após obter `accessToken`, fazer as chamadas a `/v1/consultant`, `/v1/customer-map/<id>?page=N&pageSize=500` e `/v1/network-map?page=N&per_page=100` também via `fetch` nativo com `Authorization: Bearer <token>`.
- Manter paginação até esgotar resultados, manter pool de tokens em memória (TTL 30 min) por email para evitar relogar a cada request.
- Manter endpoints `/health`, `/last-debug`, `/sync-customers`, `/sync-network` com o mesmo contrato (a edge function não muda).
- Tratamento de erros: 401/403 → "Credenciais inválidas"; 429 → aguardar 30s e tentar 1x; 5xx/timeout → erro 502.

### 2. Plano B (fallback se a API começar a bloquear IP de datacenter)

Se algum dia a API começar a 403/Cloudflare-block o IP do easypanel (não está acontecendo hoje — worker-portal prova isso), reativamos a rota Tor+Playwright como fallback automático. Por enquanto deixar só o caminho simples.

### 3. Limpar dependências

- Remover `playwright-chromium`, instalação do Chromium e Tor do `Dockerfile`.
- Remover `torrc` do build.
- Imagem fica MUITO menor (~150MB em vez de ~1.5GB) e sobe em segundos.

### 4. Edge function `sync-igreen-customers`

**Nenhuma mudança** — o contrato HTTP do worker é idêntico. A edge já está apontando para o `IGREEN_SYNC_WORKER_URL=https://igreen-worker-igreen.d9v63q.easypanel.host` e usando o secret correto (validado em `settings`).

### 5. Validação após deploy

1. Redeploy do container `worker-igreen` no easypanel (você faz no painel).
2. Eu chamo a edge `sync-igreen-customers` via curl para o seu consultor (Rafael Ferreira) e confirmo que retorna `success: true` com lista de customers.
3. Se vier erro, leio `GET /last-debug` no worker para entender em qual passo travou.

## Detalhes técnicos

Arquivos que mudam:
- `worker-igreen-sync/server.mjs` — reescrita do core, mesmo contrato HTTP.
- `worker-igreen-sync/Dockerfile` — remover Playwright e Tor, virar `FROM node:20-alpine` simples.
- `worker-igreen-sync/package.json` — remover `playwright-chromium`.
- `worker-igreen-sync/torrc` — apagar.

Risco: baixo. O método é o MESMO que já funciona em produção há meses no `worker-portal` com as mesmas credenciais da mesma tabela.