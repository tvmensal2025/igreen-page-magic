---
inclusion: manual
name: glossario
description: Siglas e termos internos do projeto iGreen. Consulte quando um termo do usuário for ambíguo.
---

# Glossário — termos internos iGreen

Ordem alfabética. Se um termo do usuário não está aqui e é ambíguo, **pergunte** antes de codar.

## A / B / C (grupos de cadência)
Motor Zero Lead Perdido classifica cada `lead_cadence_state.stage` em um grupo:
- **A — inbound / em conversa** (`NEW`, `GREETED`, `AI_QUALIFYING`, `A_NUDGE`, `A_SMS`, `A_CALL`, `A_CALL_RETRY`). **Sem teto** de envio; o lead falou com você.
- **B — reengajamento frio** (`COLD_1..4`, `SMS_*`, `CALL_*`, temas). Teto `cap_b` (default 150/dia).
- **C — recall longo prazo** (`RECALL_60D`, `RECALL_YEARLY`, incl. `_SMS`/`_CALL`). Teto `cap_c` (default 50/dia).
- **Global B+C:** `cap_global_outreach` (default 200/dia) como teto anti-ban somado.
Classificação em `_shared/cadence-engine.ts` via `stageGroup(stage)`.

## Cérebro
Módulo de IA de produção que responde no WhatsApp: `_shared/cerebro/resposta-hook.ts` → `responderComCerebro`. Também mora aqui a escala de campanhas Meta (`_shared/brain-*.ts`). Não confundir com o **Simulador Fluxo B** (dryRun em `_shared/fluxo-b-ia/`).

**Com o Grupo A:** o funil de cadastro organizado (passos determinísticos) **manda**. O Cérebro **não substitui** essa trilha — responde dúvida livre / fora do passo / carteira. Opt-in: `consultants.cerebro_ativo` (default `off`, modal Mensagens automáticas). Canônico: `#cerebro-fluxo-b`.

## Cadence Tick
Cron que roda o motor A/B/C: edge `cadence-tick`. Consome `lead_cadence_state`, aplica gates (kill switch, toggle, janela BRT, DNC, cross-channel dead, cap A/B/C/global) e dispara Voz/SMS/WhatsApp/Meta audience.

## Cap
Teto diário. **Não** confundir com throttle instantâneo do Whapi. Ver `cap_b`, `cap_c`, `cap_global_outreach` em `daily_reheat_settings`.

## CTWA (Click-To-WhatsApp)
Anúncio Meta cujo destino é abrir conversa no WhatsApp. Reporta “conversas iniciadas” em vez de `meta_lead_actions` — trate isso em `useAdMetrics.ts`.

## `ctwa_clid`
Identificador Meta anexado ao clique CTWA. Mapeia clique → anúncio em `ctwa_clid_mapping`; usado pelo `deterministic-campaign-resolver`.

## Disparo PRO
Broadcast do consultor a partir de base própria. Edge `bulk-scheduler` + `bulk_campaigns` / `bulk_campaign_targets`. Passa pelo `resolveConsultantOutboundChannel`.

## DNC (Do Not Contact)
Lead marcado como “nunca mais contatar”. Coluna `customers.do_not_contact` + `voice_dnc_list`. **Na UI diga “bloqueado” / “nunca mais contatar”**, nunca “DNC” (helper `isNuncaMaisContatar`).

## Evolution
API WhatsApp legado. Ainda existe (`_shared/channels/evolution.ts`), mas **não** é canal primário. `whatsapp_instances.needs_reconnect` no Evolution **não** significa que o Zap do consultor caiu — o canal ativo é Whapi.

## Fluxo B / Multicanal
Conversa da IA Sofia com o lead que respondeu. Edita textos/áudios em `/admin/textos` → grava em `cadence_stage_config`. Não confundir com o **Motor de Cadência** (`/admin/motor`) que dispara para quem **não** respondeu.

## Fluxo D
Health-check de webhooks e conectividade (`flow_d_health_runs`).

## iGreen (grafia de voz)
Pronúncia forçada nos áudios TTS como “**iGrín**”. Ver ajuste fonético em `tts-ptbr-anchor.ts` e `wa-audio-stitch.ts`.

## Journey Runs
Snapshot da jornada canônica A/B/C por lead (`journey_runs`). Usado para timeline e auditoria.

## Kill Switch
`app_settings.bot_global_enabled`. Consultado por `isBotGloballyEnabled` (`_shared/bot/global-flag.ts`); UI `BotGlobalKillSwitch`. Ordem de rollback: `live_dispatch` → `daily_reheat.enabled` → `cadence_engine` → `bot_global`.

## Motor v3 (Flow Engine v3)
Motor de fluxo de bot novo. Só entra em modo `on` explícito por consultor. Detalhes em `#flow-engine-v3`.

## OTP (Portal)
One-Time Password que o portal iGreen exige no cadastro. Fluxo: `finalize-capture` → worker portal envia OTP → cliente digita no WhatsApp → `submit-otp` → segue para facial.

## Pizza
Visualização dos leads ativos por grupo A/B/C na UI (`ReheatCyclePizza`, `AdminCiclo`). Usa `cycleEligibility.ts`.

## Portal 1 vs Portal 2
**Portal 1** (Playwright direto no site iGreen) foi **descontinuado em 2026-06**. **Portal 2** é a API oficial iGreen consumida por `worker-portal-2/`. Sempre use `dispatchPortalWorker`.

## Pós-venda WA
Sequência automatizada **D30→D210** (+ saudação aprovado/reprovado + **retentativa** após 60d) em `pos_venda_*`, edge `pos-venda-auto-progress`. **Não** é a esteira multiproduto (`sales` / `sale_stage_*`). Não depende de `bot_global_enabled` — usa toggle `pos_venda_auto_messages` + validação manual.

## Protocolo `2026-####`
Identificador interno do lead. Fica **só no banco/admin**; **nunca** appendar em mensagem WA.

## Rodízio
Distribuição de leads entre parceiros por campanha (UUID). `rodizio_pools` + RPC atômica. Não usar cidade/keyword/texto.

## Sofia
Nome público da IA que fala com o lead (Cérebro + Fluxo B). Voz feminina TTS padrão; existe voz masculina para Rafael (aprovadas em `src/lib/multichannelApprovedAudios.ts`).

## Superadmin (`instance_name=whapi-superadmin`)
Instância Whapi central usada quando `isWhapi` no hub. Não é conta de consultor comum.

## Sync (carteira iGreen)
Worker Playwright separado (`worker-igreen-sync/`) que sincroniza consumo/comissão. Endpoint em `igreen_sync_worker_url`. **Não** confundir com `portal2_worker_url` ou `club_worker_url`.

## Takeover humano
Consultor assume a conversa: `customer-takeover`, `start-customer-attendance`, `end-customer-attendance`. Pausa o bot com timeout de 24h (`humano_assumiu_whatsapp`).

## Velip
Provedor de voz/SMS. Erros críticos `IK/EK/CK/BK` (número inexistente) e 2×`UNDELIV`/72h em SMS acionam auto-DNC no `voice-dialer-webhook`.

## Waste Guard (`AUTO_PERF_PAUSE:`)
Pausa automática de anúncio Meta que gasta sem gerar lead qualificado. `_shared/campaign-waste-guard.ts`.

## Whapi
Canal WhatsApp **primário**. Health check = `AUTH`. Adapter em `_shared/channels/whapi.ts`.

## Zero Lead Perdido
Nome de negócio do motor de cadência A/B/C. Implementação: `_shared/cadence-engine.ts` + `cadence-tick`.
