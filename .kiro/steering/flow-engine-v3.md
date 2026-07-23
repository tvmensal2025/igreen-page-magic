---
inclusion: fileMatch
fileMatchPattern:
  - "supabase/functions/_shared/engine/**"
  - "supabase/functions/_shared/dispatcher/**"
  - "supabase/functions/_shared/feature-flag.ts"
  - "supabase/functions/migrate-engine-v3/**"
  - "supabase/functions/flow-engine-*-cron/**"
  - ".kiro/specs/flow-engine-v3-rewrite/**"
  - "mem/whatsapp/flow-engine-v3-rollout.md"
---

# Flow Engine V3 — motor de turnos WA

`tick(state, input) → EngineResult` + estado em `customer_flow_state`. Spec: `.kiro/specs/flow-engine-v3-rewrite/`.

## Onde
- Núcleo: `_shared/engine/` (`router`, `webhook-entry`, `runner`, `loader`, `decision`, `variants/*`)
- Side-effects **só** em `_shared/dispatcher/`
- Flags consultor: `flow_engine_v3` ∈ {off,dark,canary,on} **ou** `use_engine_v3=true`
- Gate nos webhooks: `runEngineV3IfEnabled` (`engine/webhook-hook.ts`) em whapi/evolution
- Ops: `migrate-engine-v3?dryRun=true`, `flow-engine-v3-rollout-cron`
- Tabelas: `customer_flow_state`, `engine_logs`

## FAÇA
Entrar via webhook-entry · erro → handoff seguro (não cair no legado às cegas) · dryRun antes de live  
Rollback: `flow_engine_v3='off'` + `use_engine_v3=false`

## NÃO FAÇA
Ligar `on` global sem pedido · side-effect fora do dispatcher · confundir `dark` (sombra) com `on` · apagar state/logs
