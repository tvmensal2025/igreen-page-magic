# igreen-sync-worker (v11 — Tor + Playwright + 2captcha + OpenAI Vision)

Worker dedicado à **leitura** dos dados do portal iGreen (clientes e rede).
Consumido pela edge function `sync-igreen-customers`.

## Por que tudo isso?

O endpoint `POST https://api-voffice.igreenenergy.com.br/v1/login` é defendido por:

1. **Cloudflare WAF** — bloqueia IPs de datacenter (easypanel, AWS, etc.) com 403 HTML.
2. **reCAPTCHA v2** — sitekey `6LemKQktAAAAAM626YG0ZoBi-PAbOIvwb5QD0Vi6` (página `/login`).
   Sem o `recaptchaToken` no body, devolve 401 "Unauthorized action".

Para passar nos dois, o worker combina:

```
Playwright Chromium ──(via Tor SOCKS5)──► iGreen Cloudflare ✅
       │
       ├─ injeta token do 2captcha no widget reCAPTCHA
       ├─ clica "Entrar"
       └─ intercepta /v1/login → captura accessToken
                    │
                    ▼
           /v1/customer-map (Bearer)
```

A sessão fica cacheada 30min, então o pipeline pesado só roda uma vez por
consultor a cada meia hora.

## Debug visual com IA

A cada passo crítico (`abriu_login`, `preencheu_form`, `injetou_captcha`,
`pos_submit`) o worker tira screenshot e envia para a **OpenAI Vision
(`gpt-4o-mini` por default)**. A resposta vira uma linha no `/last-debug`:

```
21:42:11 [step] abriu_login → "Formulário de login do portal iGreen visível, com campo de email preenchido"
21:42:34 [step] pos_submit  → "Página de bloqueio Cloudflare 'Sorry, you have been blocked'"
```

E `GET /last-screenshot` devolve o PNG bruto do último passo para você abrir
no navegador.

## Endpoints

Auth: header `X-Worker-Token: <WORKER_TOKEN>`.

| Método | Path                | Função                                                    |
|--------|---------------------|-----------------------------------------------------------|
| GET    | `/health`           | `{ ok, sessions, uptime_s, mode, ia_vision, ia_model }`   |
| GET    | `/last-debug`       | passos + análise IA do último login                       |
| GET    | `/last-screenshot`  | PNG do último step                                        |
| POST   | `/sync-customers`   | `{ portal_email, portal_password }` → clientes            |
| POST   | `/sync-network`     | `{ portal_email, portal_password }` → rede                |

## Variáveis de ambiente

| Nome                  | Obrigatória | Descrição                                                          |
|-----------------------|-------------|--------------------------------------------------------------------|
| `WORKER_TOKEN`        | sim         | header `X-Worker-Token` esperado                                   |
| `TWOCAPTCHA_API_KEY`  | sim         | chave 2captcha (resolve reCAPTCHA v2)                              |
| `OPENAI_API_KEY`      | recomendada | habilita debug visual via OpenAI Vision                            |
| `OPENAI_VISION_MODEL` | não         | default `gpt-4o-mini` (barato). Pode ser `gpt-4o` para mais qualidade |
| `TOR_SOCKS_PROXY`     | não         | default `socks5://127.0.0.1:9050` (Tor local)                      |
| `PORT`                | não         | default `3102`                                                     |
| `SESSION_TTL_MS`      | não         | default `1800000` (30 min)                                         |

## Custos por sync (com cache de 30min ativo)

- 2captcha: ~US$0,003
- OpenAI Vision (`gpt-4o-mini`, ~4 screenshots por login): ~US$0,001
- Total: ~R$0,02/sync
