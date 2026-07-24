---
inclusion: auto
name: fluxos
description: Jornadas CTWA, cadência A/B/C, portal, club, reheat, voz. Use em bugs de fluxo de negócio.
---

# Fluxos de negócio críticos

## 1) Lead Meta/CTWA → WhatsApp → Bot

1. Clique CTWA / Lead Ads / landing (`lead-intake`, `meta-leadads-webhook`)
2. Atribuição campanha (`_shared/deterministic-campaign-resolver.ts`): **ad_id → fb_campaign_id → ctwa_clid → protocol → exact_message**
3. Grava `customers.source_campaign_id` (UUID de `facebook_campaigns`)
4. Rodízio: `rodizio_pools` por `campaign_id` → parceiro em `referral_partners`; aviso `notify-partner-leads-batch`
5. Inbound: **whapi-webhook** (primário) ou evolution-webhook → bot-flow / Cérebro (`responderComCerebro`)
6. Protocolo `2026-####` existe só no banco — **não** appendar na mensagem WA

## 2) Cadência Zero Lead Perdido (autoflow)

Estado: `lead_cadence_state`. Engine: `_shared/cadence-engine.ts` (`STAGE_MAP`). Cron: **cadence-tick**.

| Grupo | Stages (resumo) |
|---|---|
| **A** (em conversa) | `NEW` → `GREETED`/`AI_QUALIFYING` → `A_NUDGE` → `A_SMS` → `A_CALL` → `A_CALL_RETRY` → `COLD_1` |
| **B** (frio) | `COLD_1…4` + `SMS_*` / `CALL_*` / temas |
| **C** (recall) | `CLOSE_LOST` → Meta retarget → `RECALL_60D`…`RECALL_YEARLY` (loop) |

- Canais: whatsapp | sms | voice (Velip) | meta_audience | system
- Inbound B/C → volta A: `cadence-inbound-router` (whapi/evolution)
- Gates: `isBotGloballyEnabled`, `isAutomationEnabled("cadence_engine")`, `app_settings.cadence_engine_enabled`, toggles por stage, janela, DNC, nome seguro
- **Caps outreach**: `stageGroup(stage)` (A=∞, B=`cap_b`, C=`cap_c`, Global B+C=`cap_global_outreach` em `daily_reheat_settings`); contagem via `countOutreachTouchesToday` (`cadence_action_log` do dia BRT). Excedeu → adia p/ próxima manhã BRT; alertas em `automation_skip_log` (60/85/100 %).
- Terminais: `PAUSED`, `WON`

## 3) Três “em análise” — nunca misturar

Helpers: `src/lib/crmVsLeadAnalysis.ts`

| Bucket | Sinais | Onde mora |
|---|---|---|
| Lead em conversa (pizza A) | cadence NEW/GREETED/AI_QUALIFYING; sem portal | Ciclo/captura |
| CRM cadastro em análise | `portal_submitted_at` ou steps `cadastro_em_analise`, `aguardando_otp`, `aguardando_facial`, … | Kanban CRM |
| Meta campanha em análise | `pending_review` / `in_review` | Ads — zero relação com customer |
| Bloqueado | `do_not_contact` ou pausa `dnc`/`opt_out` | Fora de envios |

`status=pending` é ambíguo — não classificar só por ele.

## 4) Portal iGreen (cadastro)

1. Ficha completa (OCR `capture-extract` / manual)
2. **finalize-capture** → `dispatchPortalWorker` → **worker-portal-2** (Portal 1 descontinuado)
3. Callbacks: **worker-callback** (`otp_required`, facial, assinatura…)
4. OTP: **submit-otp** (+ watchdog/recover)
5. Steps CRM: `portal_submitting` → `aguardando_otp` → facial/assinatura → `cadastro_em_analise` / `complete`
6. Canônico: `.kiro/steering/portal2-fluxo-canonico.md` + `docs/portal-api/`

## 5) Club iGreen

Separado do portal: **finalize-club** → `validateForClub` → **worker-club**. Colunas `customers.club_*`.

## 6) Reaquecimento / follow-up / agenda

- **daily-reheat-cron** + `_shared/daily-reheat/{plan,dispatch,cycle}.ts`
  - Cadeados: toggle `daily_reheat` + `daily_reheat_settings.enabled` + `live_dispatch_enabled` + bot_global
- Follow-up: `process-followups`, `bot-followup-checker`, `faq-reengagement-nudge`
- Agenda humana: `scheduled_messages` → **send-scheduled-messages** (Whapi ok; sem quiet hours de bot)

## 7) Fluxo B / Cérebro

- Produção inbound: `_shared/cerebro/resposta-hook.ts` (`responderComCerebro`)
- Simulador admin: **fluxo-b-ai** → `_shared/fluxo-b-ia/` (dryRun)
- Estado: `customers.fluxo_b_state` / `fluxo_b_variant`; `app_settings.fluxo_b_persona`
- Pasta `_shared/vendedora/` não existe mais (legado em `.agents/skills/vendedora-e2e-conversations/`)

## 8) Voice dialer (Velip)

- Enqueue/cron/webhook: `voice-dialer-*`; SMS: `voice-sms-send`
- Cadência/reheat disparam os mesmos helpers (`playAudioFile`, `resolvePersonalizedCallAudio`)
- DNC voz: `voice_dnc_list` + `customers.do_not_contact`

## 9) Atendimento humano

- **start-customer-attendance** / **end-customer-attendance** / **customer-takeover**
- Envio manual: chat UI, **manual-step-send**
- Pós-venda: **pos-venda-auto-progress** (D30–D210 + retentativa; Whapi primeiro)

## Kill switch (emergência)

`app_settings.bot_global_enabled` → UI `BotGlobalKillSwitch`. Rollback: live_dispatch → daily_reheat.enabled → cadence_engine → bot_global.
