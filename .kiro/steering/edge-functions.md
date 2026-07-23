---
inclusion: always
---

# Edge Functions — mapa + auth

~210 pastas `supabase/functions/<kebab>/index.ts`. Shared: `_shared/`.

## Auth / CORS
| Helper | Uso |
|---|---|
| `cron-auth` → `assertCronAuth` | `x-service-secret` / internal / Bearer service_role |
| `caller-auth` → `resolveCaller`+`assertOwnership` | JWT UI ou service secret |
| `webhook-auth` | Whapi/Evolution; enforce com `ENFORCE_WEBHOOK_ORIGIN` |
| `cors` → `buildCors` | Allowlist (evitar `*` em edge nova) |
| `admin-client` | service_role + `x-edge-caller` |

Crons: preferir 200 `{ skipped }` quando gate fecha.

## Críticas (1 linha)
- **whapi-webhook** — inbound primário → bot-flow/Cérebro/rodízio
- **evolution-webhook** — inbound Evolution legado
- **cadence-tick** — motor Zero Lead Perdido (~5 min)
- **daily-reheat-cron** — reheat; live só com todos cadeados
- **send-scheduled-messages** — agenda humana (sem quiet hours)
- **bulk-scheduler** — Disparo PRO
- **manual-step-send** — step manual (não religa bot)
- **finalize-capture** / **finalize-club** — despacha workers
- **submit-otp** / **worker-callback** / **portal-otp-watchdog** — OTP/portal
- **capture-extract** / **reprocess-capture** — OCR ficha
- **notify-partner-leads-batch** — aviso rodízio parceiro
- **voice-dialer-cron** / **webhook** / **enqueue** / **voice-sms-send** — Velip
- **facebook-create-campaign** / **capi** / **auto-pause** / **meta-leadads-webhook**
- **start-customer-attendance** / **customer-takeover** / **end-customer-attendance**
- **process-followups** / **bot-stuck-recovery** / **faq-reengagement-nudge**
- **fluxo-b-ai** — simulador dryRun; **ai-agent-router** — Gemini no webhook
- **production-health-snapshot** / **sync-igreen-customers** / **lead-intake**
- **outbound-delivery-reconcile-cron** — ACK Whapi
- **rodizio-metrics-broadcast** — métricas/avisos parceiro

## Shared não-HTTP
`cadence-engine`, `cadence-inbound-router`, `automation-gate`, `bot/global-flag`, `customer-display-name`, `consultant-public-label`, `deterministic-campaign-resolver`, `channel-sender`, `channels/*`, `portal-worker`, `club-worker`, `cerebro/*`, `daily-reheat/*`, `voice-dialer/*`
