# Onda 1 — correções aplicadas

**Data:** 2026-07-16  
**Escopo:** AUD-001, 002, 003, 004, 008 (AUD-007 diferido)

---

## O que foi feito

| ID | Arquivo(s) | Mudança |
|---|---|---|
| AUD-001 | `supabase/functions/reactivation-send/index.ts` | `assertCanContact` no single e no batch; select inclui `do_not_contact`; 403 + log `reactivation_sends` |
| AUD-002 | `src/services/messageSender.ts` | Fail-**closed** se query DNC falhar (id ou telefone) |
| AUD-003 | `src/pages/SuperAdmin.tsx` | Gate com `isSuperAdmin` (alinhado a `SuperAdminRemoteSupport`) |
| AUD-004 | `facebook-campaign-healthcheck/index.ts` | Modo cron exige `x-service-secret` ou Bearer service_role; clique com `campaign_id` inalterado |
| AUD-008 | `worker-portal-2/server.mjs`, `worker-club/server.mjs` | `process.exit(1)` se `WORKER_SECRET` ausente ou `change-me` |

## Validação

- Python pós-patch: **ALL_OK**
- `npm run typecheck`: exit 0
- Lint IDE nos arquivos front: sem erros

## Deploy / ops necessários

1. **Deploy** edge functions: `reactivation-send`, `facebook-campaign-healthcheck`
2. **Redeploy** workers Portal 2 e Club **somente** com `WORKER_SECRET` forte já definido (senão o container não sobe)
3. Se existir cron externo chamando `facebook-campaign-healthcheck` **sem** `campaign_id`, configurar header:
   - `x-service-secret: <SERVICE_SHARED_SECRET>`  
   ou `Authorization: Bearer <SERVICE_ROLE_KEY>`
4. Botão “Tentar reativar” no front (`campaign_id` + JWT) **não** muda

## Não feito (propositadamente)

- AUD-007 (webhook grace → 401) — risco de silenciar inbound
- AUD-005/006 — unificação ampla

## Impacto possível

- Consultor com role `admin` (não super) perde UI Super Admin
- Chat pode falhar envio se a checagem DNC estiver fora (mensagem clara)
- Reaquecimento de lead DNC passa a ser bloqueado (desejado)
