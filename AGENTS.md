---
inclusion: always
---

# AGENTS.md — cérebro do Kiro (sempre incluso)

Você **não** tem `.cursor/rules` do Cursor. Sua memória é **este arquivo** + `.kiro/steering/*` com `inclusion: always`. Responda em **pt-BR**. Antes de editar: leia `regras-duras`, `armadilhas`, `helpers-canonicos`.

## Protocolo
1. Domínio? WA | cadência | portal | Meta/rodízio | CRM | voz | front
2. Reuse helper canônico — não reinvente
3. Não apague migrations/toggles/guardas
4. Não ligue massa/motor novo sem pedido
5. Envio real → preferir `dryRun`

## 12 proibições
1. `needs_reconnect` ≠ Zap offline → **Whapi**
2. Não misture lead/CRM/Meta “em análise” → `crmVsLeadAnalysis.ts`
3. Não classifique só por `status=pending`
4. Rodízio = UUID `source_campaign_id`, não cidade
5. Sem “📋 Protocolo” no WA
6. Sem chamar lead com `whatsapp_profile`
7. Sem `display_name||name` slug do consultor
8. Só Portal 2 (`dispatchPortalWorker`)
9. Agenda humana sem quiet hours
10. Sem `_shared/vendedora/` → `cerebro/` + `fluxo-b-ia/`
11. Chat = `conversations` (não `messages`)
12. UI: “bloqueado”, não “DNC”

## Kill switch
`app_settings.bot_global_enabled` → `isBotGloballyEnabled` → UI `BotGlobalKillSwitch`  
Rollback: live_dispatch → daily_reheat.enabled → cadence_engine → bot_global

## Onde olhar
| Caso | Onde |
|---|---|
| Inbound WA | `whapi-webhook` |
| Cadência | `cadence-tick` + `cadence-engine.ts` |
| Reheat | `daily-reheat-cron` |
| Portal/OTP | `finalize-capture`, `submit-otp`, `worker-callback` |
| Club | `finalize-club` + `worker-club/` |
| Campanha | `deterministic-campaign-resolver.ts` |
| IA chat | `cerebro/` (prod) / `fluxo-b-ai` (sim) |
| Voz | `voice-dialer-*` |

## Pack steering
`product` `tech` `structure` `projeto` `banco` `edge-functions` `fluxos` `convencoes` `regras-duras` `armadilhas` `helpers-canonicos` `rotas-ui` `idioma` `deploy` + `portal2-fluxo-canonico` (fileMatch)
