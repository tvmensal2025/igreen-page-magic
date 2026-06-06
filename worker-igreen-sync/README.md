# igreen-sync-worker

Worker Playwright dedicado à **leitura** do portal iGreen (`escritorio.igreenenergy.com.br`).
Consumido apenas pela edge function `sync-igreen-customers`.

Não confundir com `worker-portal/` (escrita/cadastro de leads no portal `digital.igreenenergy`)
nem com `worker-portal-2/` (cadastro via API direta em `green.igreenenergy/autoconexao`).

## Endpoints

Auth: header `X-Worker-Token: <WORKER_TOKEN>`.

| Método | Path              | Função                                       |
|--------|-------------------|----------------------------------------------|
| GET    | `/health`         | healthcheck (`{ ok, sessions, uptime_s }`)   |
| POST   | `/sync-customers` | retorna JSON cru de `/customer-map`          |
| POST   | `/sync-network`   | retorna JSON cru de `/network-map`           |

Body dos POST:
```json
{ "portal_email": "x@y.com", "portal_password": "..." }
```

Resposta:
```json
{ "ok": true, "consultor_id": "12345", "customers": [ /* JSON cru */ ] }
```

## Variáveis de ambiente

| Var                    | Default     | Descrição                                |
|------------------------|-------------|------------------------------------------|
| `PORT`                 | `3102`      | Porta HTTP                               |
| `WORKER_TOKEN`         | —           | == secret `IGREEN_SYNC_WORKER_SECRET`    |
| `SESSION_TTL_MS`       | `1800000`   | TTL da sessão Playwright (30 min)        |
| `MAX_SESSIONS`         | `20`        | Limite do pool (LRU)                     |
| `PLAYWRIGHT_HEADLESS`  | `true`      | Headless on/off                          |

## Deploy no Easypanel

1. **Source → Github**
   - Proprietário: `tvmensal25`
   - Repositório: `portal-oficial-igreen`
   - Ramo: `main`
   - Caminho de Build: `worker-igreen-sync`
2. **Porta**: `3102`
3. **Environment**:
   ```
   PORT=3102
   NODE_ENV=production
   PLAYWRIGHT_HEADLESS=true
   WORKER_TOKEN=<gere um segredo longo>
   ```
4. **Domain**: `igreen-sync.d9v83a.easypanel.host`
5. **Recursos sugeridos**: 1 CPU / 1 GB RAM

### Erro no Easypanel: `curl: (23) Failure writing output to destination`

Esse erro acontece antes do Dockerfile rodar: o Easypanel conseguiu acessar o GitHub, mas falhou ao gravar ou extrair o archive baixado.

Verifique a VPS via SSH:

```bash
df -h
df -i
docker system df
```

Se o disco estiver cheio, limpe caches/builds antigos com segurança:

```bash
docker builder prune -af
docker image prune -af
docker container prune -f
```

Se houver espaço livre e o erro continuar, remova somente o cache de código desse app para o Easypanel baixar novamente:

```bash
rm -rf /etc/easypanel/projects/igreen/worker-igreen/code
```

Depois clique em deploy novamente no Easypanel.

## Configurar no Supabase (lado da edge function)

```sql
INSERT INTO settings (key, value) VALUES
  ('igreen_sync_worker_url',    'https://igreen-sync.d9v83a.easypanel.host'),
  ('igreen_sync_worker_secret', '<mesmo WORKER_TOKEN>')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

Ou via secrets do edge function: `IGREEN_SYNC_WORKER_URL` e `IGREEN_SYNC_WORKER_SECRET`.

## Teste rápido

```bash
# health
curl https://igreen-sync.d9v83a.easypanel.host/health

# customers
curl -X POST https://igreen-sync.d9v83a.easypanel.host/sync-customers \
  -H "X-Worker-Token: $WORKER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"portal_email":"...","portal_password":"..."}'
```
