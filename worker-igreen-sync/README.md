# igreen-sync-worker (v16 — API nova api-vo)

> **v16 (2026-07-01):** o portal iGreen migrou de arquitetura. Não há mais
> "Exportar Excel" nem os endpoints antigos. Agora é uma API REST em
> `https://api-vo.igreenenergy.com.br/v1`, autenticada por JWT
> (`POST /auth/session`). O login **não tem mais reCAPTCHA** (confirmado ao vivo).
> O worker foi adaptado para consumir a nova API. Ver
> `ESTRATEGIA_CAPTURA_TOTAL_IGREEN.md` na raiz.

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
