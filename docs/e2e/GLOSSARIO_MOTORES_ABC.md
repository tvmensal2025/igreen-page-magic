# Glossário + motores — TestSprite / E2E (fonte da verdade)

Data: 2026-07-22  
Regra: **não misturar** nomes parecidos. Um plano errado aqui gera FAIL/BLOCKED eternos.

## 1) Três “mundos” distintos

| Nome na operação | O que é | NÃO é |
|---|---|---|
| **Grupo A** (pizza A) | Lead **quente** no WhatsApp: welcome → qualificação → portal. Escada de silêncio: `GREETED` → `A_NUDGE` → `A_SMS` → `A_CALL` → `A_CALL_RETRY` → `COLD_1` | `flow_variant='A'` (embora o canônico atual force A) |
| **Grupo B** (onda fria) | Cadência “Zero Lead Perdido” `COLD_*` / `SMS_*` / `CALL_*` (≈ D+1…D10) | `flow_variant='B'` / `fluxo-b-ai` / vendedora (legado conversacional) |
| **Grupo C** (recall) | Escada longa `RECALL_60D`…`RECALL_YEARLY` (WA→SMS→call por marco) | Meta “campanha em análise” |
| **Daily reheat** | Motor **separado** com filas A (novo) e B (frio) do dia | Não é o mesmo que Grupo A/B da cadência |
| **flow_variant** | Variante do funil visual/Sofia. Canônico: **sempre A** em leads novos | Não escolhe Grupo A/B/C da `cadence-tick` |

## 2) Motores que o plano deve conhecer

| Motor | Toggle | Dry-run / preview | Canal |
|---|---|---|---|
| `cadence-tick` | `cadence_engine` | **sem** dryRun uniforme — só sandbox/allowlist | Whapi + SMS/voz Velip + Meta |
| `process-followups` | `process_followups` | sem dryRun | Whapi preferencial |
| `daily-reheat-cron` | `daily_reheat` + settings + `live_dispatch_enabled` + `bot_global` | `{ "dryRun": true }` / preview | Whapi/áudio/Velip |
| `send-scheduled-messages` | `send_scheduled_messages` | agenda manual | Whapi/Evolution legado |
| `faq-reengagement-nudge` | `faq_reengagement_nudge` | — | Whapi |
| `bot-stuck-recovery` | `bot_stuck_recovery` | — | Evolution-only (dívida) |
| `reactivation-cron` | `reactivation_cron` | legado | Evolution-only |
| `speed-to-lead-check` | `speed_to_lead_sla` | **não envia** | alerta |
| `fluxo-b-ai` | — | `dryRun` padrão | simulação vendedora |
| Simulador `/flow-simulate-run` | — | telefone `5500000…` + `is_sandbox` | `bot_test_outbound` |

## 3) Cadeados (nunca desligar em massa por causa de TestSprite)

1. `app_settings.bot_global_enabled`
2. `automation_toggles.<motor>`
3. `customers.do_not_contact` / `voice_dnc_list`
4. `bot_paused` / handoff humano
5. Quiet hours / janela comercial
6. **Opt-in E2E:** `E2E_STRICT_OUTBOUND=true` + `E2E_OUTBOUND_ALLOWLIST`

Com `E2E_STRICT_OUTBOUND`, `assertBotOutboundAllowed` só libera:
- `5500000…` (mock sandbox), ou
- `5511989000650` / `5511973125846` (live allowlist)

## 4) O que TestSprite UI cobre vs o que é dryRun/script

**UI / TestSprite (este plano FE):** login, shell admin, Captação/Bloqueado, WhatsApp composer, CRM, motor/fluxos **páginas**, landing `/cadastro` QR+wa.me, páginas públicas.

**NÃO pedir no TestSprite UI:**
- Enviar WhatsApp a lead real
- Form Nome/CPF em `/cadastro`
- Coluna “Bloqueado” no Kanban CRM
- hrefs `/admin/motor` no DOM do dashboard (usar abas/`?tab=`)
- Disparar `cadence-tick` live sem allowlist

**Camada dryRun (script/edge):** `fluxo-b-ai` dryRun, `daily-reheat-cron` dryRun, skill vendedora E2E, simulador `5500000`.

**Camada live allowlist (só os 2 fones):** 1 smoke curto com `is_sandbox=true` + gate strict ligado nas edges.

## 5) Fixtures canônicas

Ver `FIXTURES_E2E.md`.
