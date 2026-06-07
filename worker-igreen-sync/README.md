# igreen-sync-worker (v9 — http-direct + 2captcha)

Worker dedicado à **leitura** dos dados do portal iGreen
(clientes e rede). Consumido apenas pela edge function `sync-igreen-customers`.

## Como funciona

O endpoint `POST https://api-voffice.igreenenergy.com.br/v1/login` **exige
reCAPTCHA v2** (sitekey `6LemKQktAAAAAM626YG0ZoBi-PAbOIvwb5QD0Vi6`, página
`https://escritorio.igreenenergy.com.br/login`). Sem o token, devolve 401
"Unauthorized action" mesmo com email/senha corretos.

Fluxo a cada sync (token de login dura ~30 min, então só roda 1x por meia hora
por consultor):

1. `solveRecaptcha()` chama **2captcha** (`method=userrecaptcha`) → recebe `gToken` em ~20s.
2. `POST /v1/login` com `{ email, password, recaptchaToken: gToken, keepConnected: true }` → `accessToken`.
3. `GET /v1/customer-map/{consultorId}?page=N&pageSize=500` paginado com `Bearer accessToken`.

```
Painel → edge sync-igreen-customers → worker-igreen-sync
                                          │
                                          ├─► 2captcha.com (resolve reCAPTCHA)
                                          └─► api-voffice.igreenenergy.com.br
```

Sem Tor, sem Playwright, sem Chromium. Imagem Docker ~150MB.

## Variáveis de ambiente

| Nome                  | Obrigatória | Descrição                                      |
|-----------------------|-------------|------------------------------------------------|
| `WORKER_TOKEN`        | sim         | header `X-Worker-Token` esperado das chamadas  |
| `TWOCAPTCHA_API_KEY`  | sim         | chave do serviço 2captcha (resolve reCAPTCHA)  |
| `PORT`                | não         | default `3102`                                 |
| `SESSION_TTL_MS`      | não         | default `1800000` (30 min)                     |



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
