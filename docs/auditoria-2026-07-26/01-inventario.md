# 01 — Inventário real (2026-07-26)

## Contagens

| Item | Hoje | Baseline `EVIDENCIA-PROD.md` (2026-07-24) | Δ |
|---|---:|---:|---:|
| Edge functions (pastas locais) | **213** | 210 | +3 |
| Migrations SQL | **846** | 823 | +23 |
| `_shared/*.ts` | **423** | 382 | +41 |
| Steering `.md` em `.kiro/steering/` | **43** | 37+ | +6 |
| Arquivos TS/TSX em `src/` | **979** | ~n/a | — |
| Components `whatsapp/*.tsx` | **77** | 77–81 | 0 |
| Testes (`*.test.ts[x]`) em `src/` | **77** | n/a | — |
| Workers | 3 (`club`, `igreen-sync`, `portal-2`) | 3 | 0 |
| `verify_jwt = false` em `config.toml` | **90** | ~60 (auditoria completa 2026-07-16) | +30 |

> Δ positivo esperado (evolução normal). Um `EVIDENCIA-PROD.md` desatualizado é P2, ver `09-drift-doc-vs-codigo.md`.

## Números do banco (produção, hoje)

| Tabela | Rows | Nota |
|---|---:|---|
| `customers` | 1278 | +8 vs baseline |
| `customers` origem `igreen_sync` | 1115 | igual |
| `customers.do_not_contact=true` | 21 | +1 |
| `lead_cadence_state` | 235 | +9 (ciclo vivo) |
| `conversations` | 2991 | +170 |
| `outbound_message_log` | 1329 | +34 |
| `webhook_message_dedup` | 1412 | +49 |
| `voice_call_logs` | 718 | +33 |
| `voice_sms_log` | 52 | +23 |
| `voice_dnc_list` | 28 | +2 |
| `rodizio_assignments` | 28 | igual |
| `scheduled_messages` pending | 0 | agenda vazia (fila de motor está clean) |
| `automation_skip_log` últimos 7d | 33 | ↓ forte vs baseline (era 3500+) |

**Interpretação `skips 7d`:** queda drástica indica que os últimos ajustes (destravar leads, corrigir caps) reduziram muito o volume de skips. Top hoje: `retention_orchestrator` (32) + `facebook_capi_dispatch` (1). Nenhum skip de `cadence_engine` ou `bulk_campaigns_runner` nos últimos 7 dias — motor rodando sem gate travando.

## Distribuição de `lead_cadence_state` por stage (agora)

```
COLD_1          75    ← reengajamento B
AI_QUALIFYING   58    ← Grupo A
PAUSED          46    ← handoff + segurança (ver dialog)
WON             32    ← clientes convertidos
COLD_2           5
A_NUDGE          5
GREETED          3
A_CALL           2
CALL_1           2
SMS_2            2
SMS_TEMA_2       1
SMS_1            1
A_SMS            1
A_CALL_RETRY     1
CALL_2           1
```

Total no ciclo: **235**. Coerente com operação normal (sem picos anômalos).

## Flags e caps (leitura direta hoje)

```
app_settings.id=global
  bot_global_enabled     = true
  cadence_engine_enabled = true

daily_reheat_settings.id=global
  enabled                = true
  live_dispatch_enabled  = true
  cap_b                  = 150
  cap_c                  = 50
  cap_global_outreach    = 200
  daily_whapi_cap        = 60      ← legado, mantido
  window_start_brt       = 08:00
  window_end_brt         = 20:00
```

Bate 100% com `.kiro/steering/regras-duras.md`.

## God-files (Top 20 por linhas, exclui `types.ts` gerado)

| LOC | Arquivo |
|---:|---|
| 7012 | `supabase/functions/whapi-webhook/handlers/bot-flow.ts` |
| 6737 | `supabase/functions/evolution-webhook/handlers/bot-flow.ts` |
| 3661 | `supabase/functions/evolution-webhook/index.ts` |
| 3626 | `supabase/functions/whapi-webhook/handlers/conversational/index.ts` |
| 3505 | `supabase/functions/whapi-webhook/index.ts` |
| 3455 | `supabase/functions/evolution-webhook/handlers/conversational/index.ts` |
| 2996 | `src/lib/multichannelCadenceTexts.ts` |
| 2591 | `supabase/functions/sync-igreen-customers/index.ts` |
| 2565 | `src/components/admin/voz/MultichannelTextsPanel.tsx` |
| 2431 | `supabase/functions/facebook-create-campaign/index.ts` |
| 2349 | `src/components/admin/ReheatCyclePizza.tsx` |
| 2250 | `src/components/admin/flow-builder/FlowDiagram.tsx` |
| 1977 | `supabase/functions/bot-e2e-runner/v3-scenarios.ts` |
| 1939 | `src/components/admin/AudioStudio.tsx` |
| 1910 | `src/components/whatsapp/AgendamentosHub.tsx` |
| 1870 | `src/components/admin/voz/VoiceCampaignWizardDialog.tsx` |
| 1817 | `src/components/captacao/CaptureLeadList.tsx` |
| 1704 | `src/pages/SuperAdminRemoteSupport.tsx` |
| 1696 | `supabase/functions/cadence-tick/index.ts` |
| 1570 | `src/components/whatsapp/ChatView.tsx` |

Total LOC do sample: **403.729** (inclui `types.ts` gerado, 14711).

Análise qualitativa em `02-codigo.md`.
