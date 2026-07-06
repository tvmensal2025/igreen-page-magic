# igreen-sync-worker (v18 — cobertura total de páginas)

> **v18 (2026-07-06):** o `/sync-all` agora coleta TODAS as páginas do portal
> (Clientes Green, Telecom completo, Seguros completo, Rede histórica) com
> paginação sem cap. Cada rota é retornada como bloco separado em
> `full_extras.blocks` e persistida em `igreen_telecom_linhas`,
> `igreen_telecom_faturas`, `igreen_telecom_comissoes`,
> `igreen_seguros_comissoes`, `igreen_seguros_customers` (sinistros/renovação)
> e `igreen_network_snapshots`. **Precisa redeploy do container** — veja seção
> "Deploy" abaixo. Boot log mostra `v18` quando estiver certo.

> **v16 (2026-07-01):** o portal iGreen migrou de arquitetura. Não há mais
> "Exportar Excel" nem os endpoints antigos. Agora é uma API REST em
> `https://api-vo.igreenenergy.com.br/v1`, autenticada por JWT
> (`POST /auth/session`). O login **não tem mais reCAPTCHA** (confirmado ao vivo).
> Ver `ESTRATEGIA_CAPTURA_TOTAL_IGREEN.md` na raiz.

## Deploy (EasyPanel / VPS Docker)

O worker roda fora do Lovable. Após qualquer mudança em `server.mjs`:

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
docker logs -f igreen-sync-worker | head -20   # confirme "v18" no boot
```

No EasyPanel: use o botão "Rebuild" no serviço `igreen-sync-worker` — ele já
puxa o commit mais recente do Git. Após subir, confirme em
`GET /health` que `mode` retorna `tor+playwright+api-vo-v18`.



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
| `TWOCAPTCHA_API_KEY`  | não*        | *só usada se o portal voltar a exigir reCAPTCHA (hoje não exige)   |
| `OPENAI_API_KEY`      | recomendada | debug visual via OpenAI Vision                                     |
| `OPENAI_VISION_MODEL` | não         | default `gpt-4o-mini`                                              |
| `TOR_SOCKS_PROXY`     | não         | default `socks5://127.0.0.1:9050`. Use `none`/`direct` para desativar (teste local) |
| `PORT`                | não         | default `3102`                                                     |
| `SESSION_TTL_MS`      | não         | default `1800000` (30 min)                                         |

## Custos por sync

- 2captcha: **US$0** no fluxo atual (sem reCAPTCHA).
- OpenAI Vision (`gpt-4o-mini`, ~3 screenshots): ~US$0,001.
