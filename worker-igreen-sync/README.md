# igreen-sync-worker (v7)

Worker dedicado à **leitura** dos dados do portal iGreen
(clientes e rede). Consumido apenas pela edge function `sync-igreen-customers`.

## Como funciona (auditoria 2026-06-07)

O portal **não precisa de captcha para login via API**. O reCAPTCHA só existe
na *página* da SPA (`escritorio.igreenenergy.com.br/login`). A API REST por trás
(`api-voffice.igreenenergy.com.br/v1/login`) aceita `{email, password}` e devolve
um `accessToken` — sem captcha. (Padrão já usado em `worker-portal/playwright-automation.mjs`.)

O único obstáculo é o **Cloudflare WAF**, que bloqueia IPs de datacenter (403) e
o TLS fingerprint do Node. Solução:

1. **Tor SOCKS5** → IP residencial, passa a reputação de IP do Cloudflare.
2. **Playwright Chromium** navega numa página iGreen → seta o cookie `cf_clearance`.
3. As chamadas à API são feitas de **dentro da página** (`page.evaluate(fetch)`),
   usando o fingerprint do browser real → Cloudflare devolve 200.

```
Painel → edge function sync-igreen-customers → este worker → API iGreen
```

Sem 2captcha, sem GitHub Actions, sem Cloudflare Worker proxy (abordagens
abandonadas, removidas do repo).

## Endpoints

Auth: header `X-Worker-Token: <WORKER_TOKEN>`.

| Método | Path              | Função                                       |
|--------|-------------------|----------------------------------------------|
| GET    | `/health`         | healthcheck (`{ ok, sessions, uptime_s }`)   |
| GET    | `/last-debug`     | passos do último login (debug)               |
| POST   | `/sync-customers` | JSON cru de `/customer-map/{consultorId}`    |
| POST   | `/sync-network`   | JSON cru de `/network-map`                   |

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
| `WORKER_TOKEN`         | —           | == `settings.igreen_sync_worker_secret`  |
| `SESSION_TTL_MS`       | `1800000`   | TTL da sessão Playwright (30 min)        |
| `MAX_SESSIONS`         | `20`        | Limite do pool (LRU)                     |
| `PLAYWRIGHT_HEADLESS`  | `true`      | Headless on/off                          |

## Deploy no Easypanel

1. **Source → Github**: `tvmensal2025/igreen-official-portal`, branch `main`,
   Caminho de Build `worker-igreen-sync`.
2. **Porta**: `3102`
3. **Environment**:
   ```
   PORT=3102
   NODE_ENV=production
   PLAYWRIGHT_HEADLESS=true
   WORKER_TOKEN=<segredo longo>
   ```
4. Clique em **Deploy**.

## Configurar no Supabase (edge function)

```sql
INSERT INTO settings (key, value) VALUES
  ('igreen_sync_worker_url',    'https://<dominio-do-worker>'),
  ('igreen_sync_worker_secret', '<mesmo WORKER_TOKEN>')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```
