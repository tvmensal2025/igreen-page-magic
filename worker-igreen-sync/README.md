# igreen-sync-worker

Worker Playwright dedicado à **leitura** do portal iGreen (`escritorio.igreenenergy.com.br`).
Consumido apenas pela edge function `sync-igreen-customers`.

> **Propósito:** este worker baixa **dados de clientes e rede do portal iGreen**
> (via `api-voffice.igreenenergy.com.br`). Nada de Facebook, Ads ou marketing —
> é só sincronização de clientes iGreen.

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
   - Proprietário: `tvmensal2025`
   - Repositório: `igreen-official-portal`
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

### Erro no Easypanel: `curl: (23) Failure writing output to destination, passed 1370 returned 0`

Esse erro acontece **antes do Dockerfile rodar**. O Easypanel baixou apenas
~1.3 KB do GitHub e tentou descompactar como `.tar.gz` — 1.3 KB nunca é um
repositório real, normalmente é uma resposta de erro do GitHub (404, página
de login HTML, permissão negada, rate limit) sendo interpretada como tar.

**Não é problema de disco nem de Dockerfile.** Causas comuns:

- Owner/Repositório errados no app do Easypanel
- App do GitHub do Easypanel sem acesso ao repositório (precisa reautorizar)
- Branch inexistente
- Repositório privado sem a integração GitHub instalada

**Diagnóstico na VPS:**

```bash
curl -L -o /tmp/igreen.tar.gz \
  https://github.com/tvmensal2025/igreen-official-portal/archive/refs/heads/main.tar.gz
ls -lh /tmp/igreen.tar.gz          # deve ter centenas de KB, não 1.3 KB
file /tmp/igreen.tar.gz            # deve ser: gzip compressed data
tar -tzf /tmp/igreen.tar.gz | grep worker-igreen-sync/Dockerfile
```

Se vier ~1.3 KB, abra para ver a resposta real do GitHub:

```bash
cat /tmp/igreen.tar.gz
```

**Correção:**

1. No app `worker-igreen` → **Source**, confirme owner `tvmensal2025`,
   repo `igreen-official-portal`, branch `main`, build path `worker-igreen-sync`.
2. **Settings → Integrations → GitHub** → **Reautorize** dando acesso a este repo.
3. Limpe o cache de código quebrado:
   ```bash
   rm -rf /etc/easypanel/projects/igreen/worker-igreen/code
   ```
4. Clique em **Deploy** no Easypanel.

### Erro no Easypanel: `No such image: easypanel/igreen/worker-igreen:latest`

Esse erro acontece quando o Easypanel tenta iniciar o app, mas a imagem Docker local ainda não existe. Ou seja: o build não terminou com sucesso, não rodou, ou o app está configurado como **Docker Image** em vez de **Github**.

Verifique no app `worker-igreen`:

```text
Source: Github
Proprietário: tvmensal2025
Repositório: igreen-official-portal
Ramo: main
Caminho de Build: worker-igreen-sync
Porta: 3102
```

Depois clique em **Deploy** e acompanhe os logs até taggear `easypanel/igreen/worker-igreen:latest`.

Se o app estiver preso, recrie apenas o app `worker-igreen` no Easypanel com Source = **Github** (não Docker Image).

Na VPS:

```bash
docker images | grep worker-igreen
```

## Configurar no Supabase (lado da edge function)

```sql
INSERT INTO settings (key, value) VALUES
  ('igreen_sync_worker_url',    'https://igreen-sync.d9v83a.easypanel.host'),
  ('igreen_sync_worker_secret', '<mesmo WORKER_TOKEN>')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```
