# iGreen Sync Worker — Especificação

Worker Playwright dedicado à **leitura** do portal iGreen (`escritorio.igreenenergy.com.br`). Roda na VPS (EasyPanel), em Docker, e expõe uma API HTTP consumida pela edge function `sync-igreen-customers`.

Não confundir com o `portal-worker` / `worker-portal-2` (que faz **escrita** / cadastro de leads — outro worker, outro container, outro setting).

## URL oficial (produção)

| | |
|--|--|
| **Host EasyPanel** | `https://igreen-worker-igreen.d9v63q.easypanel.host` |
| **Setting** | `settings.igreen_sync_worker_url` |
| **Secret (opcional)** | `IGREEN_SYNC_WORKER_URL` |
| **Helper no código** | `supabase/functions/_shared/igreen-sync-worker.ts` |
| **Health** | `GET /health` → `mode: tor+playwright+api-vo-*` |

Hosts **proibidos** em produção: `localhost:3102`, docker interno `igreen-sync-worker`, typo `igreen-sync.d9v83a`, URL do portal2.

---

## Endpoints

Todas as rotas POST exigem header `X-Worker-Token: <IGREEN_SYNC_WORKER_SECRET>`.

### `GET /health`
```json
{ "ok": true, "sessions": 2, "uptime_s": 12345, "mode": "tor+playwright+api-vo-v19" }
```

### `POST /sync-customers` / `POST /sync-all`
Coleta clientes e extras do escritório; resposta crua para a edge normalizar.

### `POST /sync-network`
Membros da rede do consultor.

---

## Configuração no Supabase

Resolução (`resolveIgreenSyncWorker`):

1. `settings.igreen_sync_worker_url`
2. Secret `IGREEN_SYNC_WORKER_URL`
3. Fallback hardcoded: `https://igreen-worker-igreen.d9v63q.easypanel.host`

Hosts locais/legados são **sanitizados** de volta para a URL oficial.

```
IGREEN_SYNC_WORKER_URL=https://igreen-worker-igreen.d9v63q.easypanel.host
```

---

## Docker / EasyPanel

- **Build path:** `worker-igreen-sync`
- **Port:** `3102`
- **Domain:** `igreen-worker-igreen.d9v63q.easypanel.host`

Após mudança em `server.mjs`: Rebuild no EasyPanel e confirme `GET /health`.
