---
inclusion: auto
name: security-auth
description: Use ao criar/editar edge functions, webhooks, CORS, JWT, service_role, verify_jwt, cron auth ou callbacks de worker.
---

# Security / auth das edges

Alinhado ao padrão Supabase: `verify_jwt` fica **ligado** para UI autenticada; **desligado** para webhooks/cron/service-to-service — mas a função DEVE autenticar sozinha.

## Helpers do repo
| Caso | Helper |
|---|---|
| Cron / pg_cron | `assertCronAuth` (`_shared/cron-auth.ts`) |
| UI consultor | `resolveCaller` + `assertOwnership` (`caller-auth.ts`) |
| Webhook WA | `webhook-auth.ts` (`ENFORCE_WEBHOOK_ORIGIN`) |
| CORS browser | `buildCors(req)` — avoid `*` em edges novas |
| Admin DB | `admin-client.ts` service_role |

## Regras
- Nunca expor `service_role` no browser
- Webhooks: `verify_jwt=false` no config.toml + secret próprio (Whapi/Velip/Meta HMAC)
- Worker callback: Bearer `worker_secret`
- Crons: preferir 200 `{ skipped }` quando gate fecha (não 5xx barulhento)
- Secrets só em Edge env / `settings` — **nunca** em steering/commits
