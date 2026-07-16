# 08 — Edge Functions (prioridade verify_jwt=false)

**Data:** 2026-07-16
**Fonte:** `supabase/config.toml` + leitura de `index.ts` de cada função com `verify_jwt=false`.
**Total verify_jwt=false:** 59

> `verify_jwt=false` não é vulnerabilidade automática. Exige autenticação alternativa comprovada (assinatura, cron secret, JWT manual, public token, worker secret).

## Legenda de controles (heurística + leitura pontual)

| Flag | Significado |
|---|---|
| cron_secret | Header/env CRON_SECRET |
| worker_secret | WORKER_SECRET / x-worker |
| webhook_sig | HMAC / Stripe / Meta signature |
| jwt_manual | getUser / Authorization Bearer validado no código |
| public_token | Token de recurso (proposta/solar) |
| service_role | Usa SERVICE_ROLE (bypass RLS) |
| alt_auth | Heurística: algum dos acima (exceto só service_role) |

## Inventário verify_jwt=false

| Função | Linhas | alt_auth | Controles | service_role | automation | dnc | bot_global | Status |
|---|---:|---|---|---|---|---|---|---|
| ad-creative-qa | 89 | NAO_DETECTADO | — | nao | nao | nao | nao | ⚠ revisar |
| ai-agent-router | 1194 | sim | webhook_sig,jwt_manual | sim | nao | nao | nao | controle detectado |
| ai-transcribe-media | 76 | sim | jwt_manual | sim | nao | nao | nao | controle detectado |
| capture-extract | 178 | sim | jwt_manual | sim | nao | nao | nao | controle detectado |
| ctwa-status | 75 | NAO_DETECTADO | — | nao | nao | nao | nao | ⚠ revisar |
| daily-reheat-cron | 284 | sim | webhook_sig,jwt_manual | sim | sim | nao | sim | controle detectado |
| embed-knowledge | 121 | sim | jwt_manual | sim | nao | nao | nao | controle detectado |
| evolution-webhook | 3271 | sim | webhook_sig,jwt_manual | sim | nao | nao | sim | controle detectado |
| facebook-auto-pause | 62 | NAO_DETECTADO | — | nao | nao | nao | nao | ⚠ revisar |
| facebook-balance-reconcile | 82 | NAO_DETECTADO | — | nao | nao | nao | nao | ⚠ revisar |
| facebook-campaign-healthcheck | 173 | NAO_DETECTADO | — | nao | nao | nao | nao | ⚠ revisar |
| facebook-campaign-status | 133 | NAO_DETECTADO | — | nao | nao | nao | nao | ⚠ revisar |
| facebook-capi | 142 | sim | jwt_manual | nao | nao | nao | nao | controle detectado |
| facebook-cbo-to-abo | 50 | NAO_DETECTADO | — | nao | nao | nao | nao | ⚠ revisar |
| facebook-oauth-callback | 195 | NAO_DETECTADO | — | sim | nao | nao | nao | ⚠ revisar |
| facebook-sync-metrics | 493 | sim | jwt_manual | sim | nao | nao | nao | controle detectado |
| facebook-token-refresh | 79 | sim | jwt_manual | nao | nao | nao | nao | controle detectado |
| faq-reengagement-nudge | 185 | sim | webhook_sig | sim | sim | sim | sim | controle detectado |
| finalize-club | 94 | sim | jwt_manual | sim | nao | nao | nao | controle detectado |
| flow-d-stuck-watchdog | 160 | sim | jwt_manual | sim | nao | nao | nao | controle detectado |
| flow-engine-rollout-cron | 212 | sim | jwt_manual | sim | nao | nao | nao | controle detectado |
| flow-engine-v3-rollout-cron | 557 | sim | jwt_manual | sim | nao | nao | nao | controle detectado |
| igreen-ingest-customers | 15 | NAO_DETECTADO | — | nao | nao | nao | nao | ⚠ revisar |
| inbound-media-retry-cron | 161 | sim | jwt_manual | sim | nao | nao | nao | controle detectado |
| lead-intake | 120 | NAO_DETECTADO | — | sim | nao | nao | nao | ⚠ revisar |
| lead-research-sweep-cron | 471 | sim | jwt_manual | sim | nao | nao | nao | controle detectado |
| lead-temperature-classifier | 421 | sim | jwt_manual | sim | nao | nao | nao | controle detectado |
| marcar-conversa-vencedora | 108 | sim | jwt_manual | sim | nao | nao | nao | controle detectado |
| meta-leadads-webhook | 220 | sim | webhook_sig | sim | nao | nao | nao | controle detectado |
| migrate-engine-v3 | 350 | sim | jwt_manual | sim | nao | nao | nao | controle detectado |
| notify-partner-leads-batch | 385 | sim | jwt_manual | sim | sim | nao | nao | controle detectado |
| notify-superadmin-signup | 136 | sim | webhook_sig,jwt_manual | sim | nao | nao | nao | controle detectado |
| outbound-media-flush-cron | 296 | sim | jwt_manual | sim | nao | nao | nao | controle detectado |
| portal-offline-retry | 114 | sim | jwt_manual | sim | nao | nao | nao | controle detectado |
| portal2-ai-audit | 173 | sim | worker_secret,jwt_manual | sim | nao | nao | nao | controle detectado |
| process-followups | 278 | sim | webhook_sig,jwt_manual | sim | sim | sim | nao | controle detectado |
| proposal-public-get | 154 | sim | public_token | sim | nao | nao | nao | controle detectado |
| proposal-respond | 302 | sim | public_token | sim | nao | nao | nao | controle detectado |
| qr-redirect | 279 | sim | jwt_manual | sim | nao | nao | nao | controle detectado |
| reactivation-cron | 488 | sim | jwt_manual | sim | sim | sim | nao | controle detectado |
| recover-stuck-otp | 294 | sim | cron_secret,worker_secret,jwt_manual | sim | nao | nao | nao | controle detectado |
| rodizio-metrics-broadcast | 462 | sim | jwt_manual | sim | nao | nao | nao | controle detectado |
| solar-design-get | 85 | NAO_DETECTADO | — | nao | nao | nao | nao | ⚠ revisar |
| solar-design-public | 66 | sim | public_token | nao | nao | nao | nao | controle detectado |
| solar-geocode | 34 | NAO_DETECTADO | — | nao | nao | nao | nao | ⚠ revisar |
| solar-hd-probe | 66 | NAO_DETECTADO | — | nao | nao | nao | nao | ⚠ revisar |
| solar-roof-analyze | 86 | NAO_DETECTADO | — | nao | nao | nao | nao | ⚠ revisar |
| solar-roof-context | 28 | NAO_DETECTADO | — | nao | nao | nao | nao | ⚠ revisar |
| solar-roof-hd | 123 | NAO_DETECTADO | — | nao | nao | nao | nao | ⚠ revisar |
| solar-roof-image | 90 | NAO_DETECTADO | — | nao | nao | nao | nao | ⚠ revisar |
| solar-roof-public | 71 | NAO_DETECTADO | — | nao | nao | nao | nao | ⚠ revisar |
| speed-to-lead-check | 135 | sim | jwt_manual | sim | sim | nao | nao | controle detectado |
| tiktok-leadgen-webhook | 131 | sim | webhook_sig | sim | nao | nao | nao | controle detectado |
| upload-documents-minio | 404 | sim | webhook_sig,jwt_manual | sim | nao | nao | nao | controle detectado |
| voice-dialer-cron | 307 | sim | cron_secret,webhook_sig,jwt_manual | sim | nao | nao | nao | controle detectado |
| voice-dialer-health | 127 | NAO_DETECTADO | — | sim | nao | nao | nao | ⚠ revisar |
| voice-dialer-webhook | 371 | sim | jwt_manual | sim | sim | sim | nao | controle detectado |
| wallet-stripe-webhook | 118 | sim | webhook_sig,jwt_manual | sim | nao | nao | nao | controle detectado |
| whapi-webhook | 3004 | sim | webhook_sig,jwt_manual | sim | nao | nao | sim | controle detectado |

## Funções sem autenticação alternativa detectada (prioridade)

Total: **19**

| Função | Observação da leitura pontual |
|---|---|
| facebook-campaign-healthcheck | Cron path **sem** secret: qualquer caller pode varrer/reativar campanhas; path com `campaign_id` exige `authConsultant`. Evidência: `index.ts` L23–56. |
| facebook-auto-pause / campaign-status / cbo-to-abo / balance-reconcile | Mesmo padrão Meta cron — confirmar se pg_cron envia secret ou se gateway restringe. |
| lead-intake | Público intencional; resolve consultor por license; **service_role**; consent obrigatório; **sem rate limit** aparente. Custo: spam de leads. |
| solar-geocode / solar-roof-* / solar-design-get | Falso negativo da heurística: várias usam `resolveCaller` (JWT manual) — solar-geocode **confirmado** exige `caller.mode==="jwt"`. |
| solar-hd-probe | Diagnóstico — risco de custo Google se público. |
| ad-creative-qa / ctwa-status | Revisar auth real. |
| igreen-ingest-customers | stub curto (15 linhas) — inspecionar. |
| voice-dialer-health | service_role client; health — risco menor se só lê. |

## Controles compartilhados relevantes

| Módulo | Papel |
|---|---|
| `_shared/caller-auth.ts` | JWT + `x-service-secret` timing-safe + ownership |
| `_shared/automation-gate.ts` | Toggle default **false** |
| `_shared/bot/global-flag.ts` | Kill switch global |
| `_shared/contact-suppression.ts` | DNC unificado (`assertCanContact`) |
| `_shared/customer-pause-filter.ts` | `checkCustomerCanSend` (DNC + bot_paused + v3) |
| `_shared/cors.ts` / fb-graph cors | CORS — alguns `*` |

## Webhooks críticos

| Função | verify_jwt | Controle esperado |
|---|---|---|
| evolution-webhook | false | assinatura/secret + kill switch |
| whapi-webhook | false | token/assinatura + kill switch |
| meta-leadads-webhook | false | X-Hub-Signature-256 |
| tiktok-leadgen-webhook | false | assinatura TikTok |
| wallet-stripe-webhook | false | Stripe constructEvent |
| voice-dialer-webhook | false | auth provedor (a comprovar) |

## Funções no disco sem bloco no config.toml

~125 dirs não listados no toml usam default do gateway (geralmente verify_jwt=true no Supabase recente — **confirmar versão/projeto**). Inventário parcial na fotografia.

## Pendências

- [ ] Ler assinatura real evolution/whapi webhook
- [ ] Confirmar secrets nos crons pg_cron (headers)
- [ ] Rate limit lead-intake / solar públicos
- [ ] Catalogar as 196 funções (não só jwt=false)
