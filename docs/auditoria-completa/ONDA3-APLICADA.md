# Onda 3 — correções aplicadas

**Data:** 2026-07-16  
**Escopo:** AUD-009, 010, 011, 012, 007 (Evolution), DNC residual, helper AUD-006

---

## O que foi feito

| ID | Mudança |
|---|---|
| AUD-009 | `_shared/cron-auth.ts` + auth nos crons de envio/ops |
| AUD-010 | Migration agenda `outbound-media-flush-1min` + headers secret |
| AUD-011 | `solar-design-public` exige `public_token` (sem IDOR por snapshotId) |
| AUD-012 | `solar-hd-probe` 403 por padrão; só com `ALLOW_SOLAR_HD_PROBE=true` + auth |
| AUD-007 | Evolution + Whapi: grace por padrão; 401 só com `ENFORCE_WEBHOOK_ORIGIN=true` (alinhados) |
| DNC | `bot-stuck-recovery` + `portal-otp-watchdog` filtram `do_not_contact` |
| AUD-006 | Helper `_shared/bot/outbound-gate.ts` (unificação monólito **não** feita — risco alto) |
| Dev | `dev-fire-all-steps` + `super-admin-alerts` + `bot-loop-watchdog` com cron-auth |

### EFs com `assertCronAuth`

`bulk-scheduler`, `bot-followup-checker`, `faq-reengagement-nudge`, `reactivation-cron`, `cadence-tick`, `send-scheduled-messages`, `rodizio-metrics-broadcast`, `outbound-media-flush-cron`, `bot-stuck-recovery`, `portal-otp-watchdog`, `bot-loop-watchdog`, `super-admin-alerts`, `dev-fire-all-steps`

### Migration

`supabase/migrations/20260716120000_onda3_cron_auth_headers.sql`  
**Corrigida 2026-07-16:** nomes = inventário real `cron.job` (Python + SQL prod).  
- Mantém jobs existentes (`bulk-scheduler-5min`, `outbound-media-flush-3min`, …)  
- Aposenta duplicatas: `cadence-tick-every-5min`, `process-followups-10min`  
- Headers: `x-internal-secret` + `x-service-secret` (padrão Context7 `jsonb_build_object`)  
- Validar: `python3 docs/auditoria-completa/scripts/validate_onda3_cron.py`

---

## Ops (ordem obrigatória)

1. Garantir `settings.embed_internal_token` (e opcional `service_shared_secret` = `SERVICE_SHARED_SECRET`).
2. **Aplicar migration** onda3 (headers nos jobs).
3. Deploy das EFs.
4. Só então: `ENFORCE_CRON_AUTH=true` nas Edge secrets (senão auth fica em grace/log).
5. Evolution + Whapi: `ENFORCE_WEBHOOK_ORIGIN=true` só com `?secret=` na URL.
6. **Não** setar `ALLOW_SOLAR_HD_PROBE` em produção.

---

## Não feito (risco / escopo)

| Item | Motivo |
|---|---|
| Unificar `bot-flow.ts` Evo/Whapi (AUD-006 full) | ~12k linhas divergentes; exige E2E dryRun longo |
| RLS / SECURITY DEFINER search_path em massa | auditoria SQL separada; risco de quebrar policies |
| CORS `*` global | mudança ampla no front/edge |
| sessionStorage PII | front; fora desta onda |

---

## Impacto

- Crons sem header continuam (grace) até `ENFORCE_CRON_AUTH`.
- Evolution com secret mal configurado → inbound 401 (corrigir URL).
- Solar público sem token → 400.
- Probe solar morto para abuso de custo.
