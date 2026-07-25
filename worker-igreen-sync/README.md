# igreen-sync-worker (leitura do escritório)

> **URL oficial (produção):** `https://igreen-worker-igreen.d9v63q.easypanel.host`  
> Setting: `settings.igreen_sync_worker_url` · Helper: `supabase/functions/_shared/igreen-sync-worker.ts`  
> **Não** confundir com `portal2_worker_url` (cadastro) nem `club_worker_url`.

> **v18+:** `/sync-all` coleta páginas do portal (Clientes Green, Telecom, Seguros, Rede)
> com paginação. Persistência na edge `sync-igreen-customers`. **Precisa Rebuild** no
> EasyPanel após mudar `server.mjs`. Confirme `GET /health` no host oficial acima.

> **API:** `https://api-vo.igreenenergy.com.br/v1` (JWT via `POST /auth/session`).

## Deploy (EasyPanel / VPS Docker)

O worker roda na VPS. Após qualquer mudança em `server.mjs`:

```bash
# no host onde o container está
cd /caminho/do/repo/worker-igreen-sync
git pull
docker build -t igreen-sync-worker:latest .
docker stop igreen-sync-worker || true
docker rm igreen-sync-worker || true
docker run -d --name igreen-sync-worker \
  -p 3102:3102 \
  --env-file .env \
  --restart unless-stopped \
  igreen-sync-worker:latest
docker logs -f igreen-sync-worker | head -20
```

No EasyPanel: **Rebuild** no serviço cujo domínio é
`igreen-worker-igreen.d9v63q.easypanel.host`. Confirme:

```bash
curl -sS https://igreen-worker-igreen.d9v63q.easypanel.host/health
```

`mode` deve começar com `tor+playwright+api-vo-`.

## Auditoria IA (Gemini)

Após rebuild, no Easy Panel do Sync configure:
- `SUPABASE_URL` = `https://zlzasfhcxcznaprrragl.supabase.co`
- `WORKER_TOKEN` = mesmo valor de `igreen_sync_worker_secret` / secret da edge

Health passa a exibir `ai_audit`. Falhas de sync → Gemini + alerta WA. Sucessos: até 20 (default).


Worker dedicado à **leitura** dos dados do portal iGreen (clientes, rede e
métricas de gestão), individual por consultor. Consumido pela edge function
`sync-igreen-customers`.

## Por que Tor + Playwright?

Tanto o portal quanto a API `api-vo` ficam atrás do **Cloudflare**, que bloqueia
IP de datacenter (EasyPanel/AWS) e requisições não-browser com **403**. Por isso:

```
Playwright Chromium ──(via Tor SOCKS5)──► Cloudflare ✅
       │
       ├─ preenche email/senha + clica "Entrar"
       ├─ (reCAPTCHA só se existir — hoje não existe; 2captcha vira fallback)
       └─ intercepta POST /v1/auth/session → captura token (data.token)
                    │
                    ▼   (fetch DENTRO da página, herda cf_clearance)
         /crm/green · /network-map/data · /painel/* · /rotinas/*
```

**IMPORTANTE:** as chamadas de API rodam via `page.evaluate` (dentro da página
já liberada pelo Cloudflare). Chamar via `context.request.get` toma 403.

A sessão fica cacheada 30min (`SESSION_TTL_MS`), então o login pesado só roda
uma vez por consultor a cada meia hora.

## Endpoints do worker

Auth: header `X-Worker-Token: <WORKER_TOKEN>`.

| Método | Path              | Função                                                             |
|--------|-------------------|--------------------------------------------------------------------|
| GET    | `/health`         | status + `api_base` + flags de config                              |
| GET    | `/last-debug`     | passos + análise IA do último login                                |
| GET    | `/last-screenshot`| PNG do último step                                                 |
| POST   | `/sync-customers` | `{portal_email, portal_password}` → clientes (achatados do `/crm/green`) |
| POST   | `/sync-network`   | `{portal_email, portal_password, month?}` → rede (`/network-map/data`)   |
| POST   | `/sync-metrics`   | `{portal_email, portal_password, month?}` → painel + rotinas       |
| POST   | `/sync-all`       | tudo de uma vez (1 login) — **recomendado**                        |

Resposta de erro quando o Cloudflare bloqueia: `error_code: "igreen_waf_blocked"`
(HTTP 503) — para não entrar em loop.

## O que cada sync traz

- **/sync-customers** (`/crm/green`): lista de clientes com `codigo, nome,
  cidade, uf, kwh, distribuidora, celular, data, devolutiva, status_coluna`.
- **/sync-network** (`/network-map/data?month=`): rede completa já com o de-para
  de campos para o formato que a edge espera (idconsultor, nome, celular,
  idpatrocinador, nivel, data_ativo, cidade, uf, cliativo, gp, gi, qtde_diretos)
  + campos ricos (bonificavel, qualificavel, graduacao, licenciados_diretos...).
- **/sync-metrics**: `/painel/overview`, `/painel/producao`,
  `/clientes-green/resumo-geral`, `/rotinas/{diaria,semanal,mensal}`.

## Variáveis de ambiente

| Nome                  | Obrigatória | Descrição                                                          |
|-----------------------|-------------|--------------------------------------------------------------------|
| `WORKER_TOKEN`        | sim         | header `X-Worker-Token` esperado                                   |
| `PROXY_URL`           | recomendado | Evomi residencial: `http://USER:PASS@core-residential.evomi.com:1000` (prioridade sobre Tor) |
| `IGREEN_USE_TOR`      | não         | `0` com Evomi (Tor desliga sozinho se `PROXY_URL` existir)         |
| `IGREEN_PROXY_STICKY` | não         | default `1` — sessão fixa no Cloudflare                            |
| `TWOCAPTCHA_API_KEY`  | não*        | *só usada se o portal voltar a exigir reCAPTCHA (hoje não exige)   |
| `OPENAI_API_KEY`      | recomendada | debug visual via OpenAI Vision                                     |
| `OPENAI_VISION_MODEL` | não         | default `gpt-4o-mini`                                              |
| `TOR_SOCKS_PROXY`     | não         | só se Tor; com Evomi ignore                                        |
| `PORT`                | não         | default `3102`                                                     |
| `SESSION_TTL_MS`      | não         | default `1800000` (30 min)                                         |

**Sync:** só no clique da UI (`igreen_sync_manual_only=true`). Cron diário desligado — não gasta proxy sozinho.

## Custos por sync

- 2captcha: **US$0** no fluxo atual (sem reCAPTCHA).
- OpenAI Vision (`gpt-4o-mini`, ~3 screenshots): ~US$0,001.
