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

## Views SECURITY DEFINER (lint 0010) — 2026-07-24
| View | Decisão | Motivo |
|---|---|---|
| `v_boletos_carteira` | **invoker=true** | RLS owner/admin nas tabelas base |
| `cadence_metrics_daily` | **invoker=true** | RLS cadence_action_log |
| `igreen_recon_queue_progress` | **invoker=true** | Só admin na fila |
| `consultants_public` | **DEFINER intencional** | LP anon; `invoker=off` desde 20260604 |
| `platform_facebook_audience_status` | **DEFINER intencional** | Status sem token; tabela base só admin |

Migration: `20260724120000_views_security_invoker_safe.sql`. Não “consertar” as 2 exceções sem quebrar LP/Ads.

## RPCs `SECURITY DEFINER` + `EXECUTE` para `anon` (inventário 2026-07-24)
Advisor residual: **21** funções anon+DEFINER (era 27). **P0 revogado** (`20260724140000_revoke_p0_anon_definer_rpcs`).

- **P0 (fechado):** `admin_cron_*` + `claim_scheduled_messages` → só `service_role` (edges `admin-cron-status` / `send-scheduled-messages`).
- **P2 (grant errado, corpo protege):** `admin_clear_ban`, `admin_mark_instance_banned`, … — `is_super_admin(auth.uid())`; `is_super_admin(NULL)=false`.
- Detalhe + SQL sugerido: `#[[file:.kiro/steering/RPC-ANON-DEFINER-INVENTARIO.md]]`

Não revogar em massa sem pedido explícito + smoke da UI/cron.
