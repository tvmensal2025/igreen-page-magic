# iGreen Sync Worker — Especificação

Worker Playwright dedicado à **leitura** do portal iGreen (`escritorio.igreenenergy.com.br`). Roda na VPS do usuário, em Docker, e expõe uma API HTTP consumida apenas pela edge function `sync-igreen-customers`.

Não confundir com o `portal-worker` (que faz **escrita** / cadastro de leads — outro worker, outro container).

---

## Endpoints

Todas as rotas POST exigem header `X-Worker-Token: <IGREEN_SYNC_WORKER_SECRET>`.

### `GET /health`
```json
{ "ok": true, "sessions": 2, "uptime_s": 12345 }
```

### `POST /sync-customers`
Request:
```json
{ "portal_email": "x@y.com", "portal_password": "..." }
```
Response (200):
```json
{
  "ok": true,
  "consultor_id": "12345",
  "customers": [ { "...campos crus da API /customer-map..." } ]
}
```
Erro (4xx/5xx):
```json
{ "ok": false, "error": "Login rejeitado / Cloudflare / timeout / ..." }
```

### `POST /sync-network`
Request:
```json
{ "portal_email": "x@y.com", "portal_password": "..." }
```
Response (200):
```json
{
  "ok": true,
  "consultor_id": "12345",
  "members": [ { "...campos crus da API /network-map..." } ]
}
```

---

## Comportamento esperado

1. **Pool de sessões Playwright em memória**: 1 contexto persistente por `portal_email`, TTL 30 min. Reaproveita cookies entre requests para evitar relogar (e cair em rate-limit/captcha).
2. **Login**: navegação real no `https://escritorio.igreenenergy.com.br/login` com browser headless (chromium), preenche o form e aguarda redirect autenticado. Salva os cookies no contexto.
3. **Coleta**: depois do login, faz as chamadas para `https://api-voffice.igreenenergy.com.br/v1/consultant`, `/customer-map/<consultorId>?page=N&pageSize=500` (paginar até esgotar) e `/network-map?page=N&per_page=100` usando `page.request.get(...)` — assim os cookies da sessão Playwright vão junto e o Cloudflare aceita a request como “mesma origem”.
4. **Retorna o JSON cru** — não normalizar nada. O parsing/mapeamento fica no edge function `sync-igreen-customers`.
5. **Erros**: distinguir `401/403` (credenciais inválidas) de `429` (rate-limit, esperar 30 s e tentar 1x) de `5xx`/timeout.

---

## Variáveis de ambiente do worker

| Var | Default | Descrição |
|-----|---------|-----------|
| `PORT` | `3102` | Porta HTTP |
| `WORKER_TOKEN` | — | Mesmo valor do secret `IGREEN_SYNC_WORKER_SECRET` no Supabase |
| `SESSION_TTL_MS` | `1800000` (30 min) | Validade da sessão Playwright |
| `MAX_SESSIONS` | `20` | Limite do pool (LRU) |
| `PLAYWRIGHT_HEADLESS` | `true` | |

---

## Configuração no Supabase (lado do edge function)

A edge function `sync-igreen-customers` resolve a URL/secret nesta ordem (mesmo padrão do `portal-worker.ts`):

1. `settings.igreen_sync_worker_url` (tabela `settings`)
2. Secret `IGREEN_SYNC_WORKER_URL` (env)

Secret obrigatório: `IGREEN_SYNC_WORKER_SECRET` (ou fallback `WORKER_SECRET`).

Exemplo:
```
IGREEN_SYNC_WORKER_URL=http://igreen-sync-worker:3102
IGREEN_SYNC_WORKER_SECRET=<token-longo-aleatório>
```

---

## Docker (referência rápida)

```dockerfile
FROM mcr.microsoft.com/playwright:v1.49.0-jammy
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3102
CMD ["node", "src/server.js"]
```

`docker-compose.yml` no mesmo network dos outros workers:
```yaml
services:
  igreen-sync-worker:
    build: ./igreen-sync-worker
    container_name: igreen-sync-worker
    restart: unless-stopped
    ports:
      - "3102:3102"
    environment:
      - WORKER_TOKEN=${IGREEN_SYNC_WORKER_SECRET}
      - PORT=3102
```

---

## Cron

O pg_cron existente (`sync-igreen-customers-daily`, 9h UTC) continua chamando o edge function com `{"source":"cron"}` — nada muda. A função agora delega ao worker.
