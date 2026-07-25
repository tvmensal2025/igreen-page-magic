---
inclusion: auto
name: helpers-canonicos
description: Helpers canônicos _shared e src/lib para reusar. Use antes de reinventar lógica.
---

# Helpers canônicos — reusar, não reimplementar

## Edge `supabase/functions/_shared/`

| Path | Exports | Quando |
|---|---|---|
| `bot/global-flag.ts` | `isBotGloballyEnabled` | Kill switch antes de automação |
| `customer-display-name.ts` | `safeFirstNameForAddress`, `isAddressableNameSource`… | Saudação/TTS com nome |
| `consultant-public-label.ts` | `resolvePublicConsultantLabel` | Nome consultor ao lead |
| `automation-gate.ts` | `isAutomationEnabled`, `logSkipped` | Toggle + skip log |
| `consultant-automation-prefs.ts` | `getConsultantAutomationPrefs`, `isConsultantAutoAllowed`, `stageGroupToPack` | Opt-in por painel (A/B/C, PV, lembretes) |
| `cadence-engine.ts` | `STAGE_MAP`, `computeNextActionAt`, `stageGroup` (A/B/C) | Estágios A/B/C |
| `cadence-inbound-router.ts` | `resolveCadenceInboundRoute`, `applyCadenceInboundRoute` | Inbound na cadência |
| `cron-auth.ts` | `assertCronAuth` | Crons |
| `caller-auth.ts` | `resolveCaller`, `assertOwnership` | UI JWT + posse |
| `cors.ts` | `buildCors` | CORS allowlist |
| `webhook-auth.ts` | verify origem WA | Webhooks Whapi/Evolution |
| `channel-sender.ts` | `resolveConsultantOutboundChannel` | Canal outbound |
| `channels/whapi.ts` | adapter Whapi | Canal primário |
| `channels/evolution.ts` | adapter Evolution | Legado |
| `portal-worker.ts` | `dispatchPortalWorker` | Cadastro Portal 2 |
| `club-worker.ts` | `dispatchClubWorker` | Club |
| `igreen-sync-worker.ts` | resolve URL sync | Carteira iGreen (≠ portal) |
| `deterministic-campaign-resolver.ts` | Meta → UUID campanha | Atribuição CTWA |
| `cerebro/` | `responderComCerebro`, `processarTurno` | IA chat produção |
| `fluxo-b-ia/` | agent simulador | Admin dryRun |
| `daily-reheat/` | `planDailyReheat`, `canLiveDispatch` | Reheat |
| `voice-dialer/` | `resolvePersonalizedCallAudio`, Velip | Voz/SMS |
| `minio-upload.ts` / `media-storage.ts` | upload SigV4 + fallback Storage | Mídia (não data-URL no DB) |
| `engine/` + `dispatcher/` | `runEngine`, `executeActions` | Flow engine v3 |
| `brain-*.ts` / `campaign-waste-guard.ts` | escala + waste | Cérebro MG |
| `validate-campaign-activation.ts` | saldo wallet | Criar campanha Ads |

## Front `src/lib/`

| Path | Quando |
|---|---|
| `crmVsLeadAnalysis.ts` | Separar pizza A / CRM / Meta / bloqueado |
| `customerDisplayName.ts` | Nome lead na UI (espelho edge) |
| `consultantPublicLabel.ts` | Label consultor na UI |
| `consultantAutomationPrefs.ts` | Opt-in automações do painel (espelho edge) |
| `phone.ts` | Normalizar/validar telefone BR |
| `cycleEligibility.ts` | Elegibilidade ciclo/pizza |

Espelhos obrigatórios edge↔UI: nome cliente e nome consultor. Estenda o canônico; não copie lógica.
