# Fechamento 100% — execução única

## Etapa 1 — Deletar migração obsoleta
`rm supabase/migrations/20260522180100_flow_reliability_v2_rollout.sql`

Motivo: autopilot (`flow-engine-rollout-cron`) é dono autoritativo da flag desde 24/mai. Aplicar essa migração brigaria com o autopilot — reverteria em 6h.

## Etapa 2 — Deploy de 2 edge functions
`supabase--deploy_edge_functions(["ai-agent-router", "evolution-webhook"])`

`_shared/gemini.ts` é puxado junto (shared).

- **ai-agent-router**: catch `GeminiQuotaExhausted` + audit log (hoje vira exception silenciosa)
- **evolution-webhook**: bloco 6.0 SIM/OK paridade com Whapi

## Etapa 3 — Validar via logs
Checar `ai-agent-router` e `evolution-webhook` por boot errors. Critério: zero erro de boot.

## Etapa 4 — Atualizar `docs/archive/KIRO_AUDIT.md`
- Mover "Mudanças pendentes" → "Aplicadas em 31/mai"
- Anotar: migração 20260522180100 deletada (obsoleta — autopilot é dono)
- Anotar achado em aberto: `v_flow_engine_health` mistura janelas (paused_total all-time ÷ turns_24h) → gate sempre vermelho. Não bloqueia bot, mas impede promoção a `on`. Spec própria se quiser ativar v2.

## Fora do escopo (consciente)
- Forçar consultores pra `on` — autopilot reverte
- Trigger BEFORE INSERT → `on` — contradiz seed_dark
- Seed gemini_quota_bucket — criação lazy já existe
- Consertar v_flow_engine_health — não bloqueia, merece spec
- Hardening de segurança — você decidiu não fazer
