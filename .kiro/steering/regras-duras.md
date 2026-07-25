---
inclusion: always
name: regras-duras
description: Regras invioláveis FAÇA/NÃO FAÇA.
---

# REGRAS DURAS

Espelho das `.cursor/rules/*.mdc`. Imperativo — modelo fraco: obedeça sem reinterpretar.

## Idioma PT-BR
- FAÇA: responder e raciocinar em português (Brasil).
- NÃO FAÇA: espanhol/inglês na resposta (exceto APIs, código, logs).

## WhatsApp = Whapi (não Evolution)
- FAÇA: canal primário **Whapi**; health = `AUTH` (`whapi-webhook`, `whapiApi`).
- FAÇA: hub `instance_name=whapi-superadmin` quando `isWhapi`.
- NÃO FAÇA: pedir reconnect Evolution por `whatsapp_instances.needs_reconnect`.
- FAÇA: agenda (`send-scheduled-messages`) e Disparo PRO (`bulk-scheduler`) via `resolveConsultantOutboundChannel`; agenda **sem** quiet hours.

## Cérebro × Grupo A (conversa WA)
- FAÇA: funil de cadastro do **Grupo A** (determinístico) manda nos passos (conta/doc/portal). Evidência: `fluxo-a-bypass` + `classifyCadastroInput` em `whapi-webhook`.
- FAÇA: Cérebro só nas laterais — dúvida livre, fora do cadastro, ou cliente carteira. Opt-in `cerebro_ativo` (**default `off`**). Modal: `CEREBRO_OPT_IN` / Mensagens automáticas. 1º ack sugere Cérebro OFF.
- FAÇA: lembrar — cadência A/B/C = **disparo**; Cérebro = **resposta** inbound; lead responde → pausa cadência ~72h.
- FAÇA: teste só com `cerebro_numeros_teste` e **esvaziar** depois; não ligar Cérebro em massa sem pedido.
- NÃO FAÇA: tratar `cerebro_ativo=on` como “IA conduz o Grupo A inteiro”.
- NÃO FAÇA: Cérebro no lugar do OCR/portal/passo esperado; confundir com Cérebro Ads/MG.
- Detalhe: `#cerebro-fluxo-b` (always) · armadilha #36 · `#wa-webhook` item 10 · rule `cerebro-vs-grupo-a`.

## Campanha / rodízio = UUID
- FAÇA: `facebook_campaigns.id` → `customers.source_campaign_id` → `rodizio_pools.campaign_id`.
- FAÇA ordem: AD ID → `fb_campaign_id` → `ctwa_clid`; fallback: protocolo → `initial_message` exact.
- NÃO FAÇA: keyword/cidade; appendar “📋 Protocolo” no WA; protocolo `2026-####` só no banco.

## CRM vs lead (nunca misturar)
- Helpers: `src/lib/crmVsLeadAnalysis.ts`
- Lead em conversa = pizza A (NEW|GREETED|AI_QUALIFYING) → `isLeadCycleEligibleNotCrmAnalysis`
- CRM cadastro em análise = `portal_submitted_at` / steps pós-portal → `isCrmCadastroEmAnalise`
- Meta = `isMetaCampanhaEmAnalise`; bloqueado = `isNuncaMaisContatar`
- NÃO FAÇA: classificar só por `status=pending`; UI sem sigla DNC.

## Nome do cliente
- Guard: `_shared/customer-display-name.ts` — na dúvida **só o corpo**.
- OK: `self_introduced`, `user_confirmed`, `ocr_*`, `manual`, `igreen_portal`
- NÃO: `whatsapp_profile`, `unknown`, `cadence`, vazio
- Ligação: `resolvePersonalizedCallAudio`

## Nome do consultor ao lead
- `_shared/consultant-public-label.ts` — nunca slug/login.
- NÃO FAÇA: `display_name || name` cru.

## Produção / kill switch
- NÃO FAÇA: apagar migrations/guardas/toggles/funções.
- NÃO FAÇA: ligar massa/motor novo sem pedido; E2E → `dryRun`.
- Kill: `app_settings.bot_global_enabled` + `isBotGloballyEnabled`; UI `BotGlobalKillSwitch`.
- Rollback: `live_dispatch_enabled` → `daily_reheat.enabled` → `cadence_engine` → `bot_global_enabled`.
- FAÇA: segundo cadeado por painel `consultant_automation_prefs` (A/B/C, pós-venda, lembretes). **Global ON ≠ consultor ON.**
## Caps outreach A/B/C (cadence-tick)
- **A = ilimitado** (inbound/em conversa; bypass total, não conta no global).
- **B = `daily_reheat_settings.cap_b`** (default 150, **cap fixo configurável — NÃO é ramp**) — reengajamento (COLD/SMS/CALL/TEMA).
- **C = `daily_reheat_settings.cap_c`** (default 50) — RECALL_* (60D…YEARLY, incl. `_SMS`/`_CALL`).
- **Global B+C = `daily_reheat_settings.cap_global_outreach`** (default 200) — teto anti-ban somado.
- Excedeu → **adia** para próxima manhã BRT (nunca descarta o lead).
- Classificação: `stageGroup(stage)` em `_shared/cadence-engine.ts`.
- Alertas 60 / 85 / 100 % em `automation_skip_log` (`outreach_cap_{b|c|g}_{60|85|100}pct`); UI: `ColdCadenceCapCard` (3 barras).
- `daily_whapi_cap` = legado, mantido só para retrocompat do reheat clássico.
- **CLIENTE ≠ lead:** carteira (`igreen_sync`/`igreen_extension`), `is_converted`, status aprovado/registered/complete, `pos_venda_stage` ou andamento ativo → **proibido A/B/C**. Só pós-venda + agendamento. Helper: `_shared/cliente-cadence-guard.ts` / `src/lib/clienteCadenceGuard.ts`.

## Janelas horárias BRT (duas, distintas)
- **Clamp geral** (`clamp_to_business_window_brt`, aplicado pelo motor a todo agendamento): Seg–Sex 08:00–20:00, **Sáb 08:00–14:00**, **Dom fechado** (empurra p/ 2ª-feira 08:05).
- **Janela do reheat clássico** (`daily_reheat_settings.window_start_brt` / `window_end_brt`): default **09:00–18:30**, usada só pelo daily-reheat legado — independente do clamp geral.
- Não simplificar como “08–20h”; sempre citar Sáb/Dom e a janela própria do reheat.


## Portal / Club / Sync (workers distintos)
- Detalhes sob demanda: `#portal2-fluxo-canonico` · `#club-api-oficial` · `#igreen-sync-oficial`
- Portal: `dispatchPortalWorker` → worker-portal-2 (Portal 1 morto)
- Club: `dispatchClubWorker` (3102, `club_*`) ≠ portal
- Sync: `igreen_sync_worker_url` ≠ `portal2_worker_url` / `club_worker_url`

## Ads / Cérebro / rodízio
- Detalhes: `#cerebro-mg-e-rodizio` · `#ads-contraste`
- Sem protocolo/keyword no WA; waste `AUTO_PERF_PAUSE:`; métricas reais ao parceiro

## Tema
- Dual light/dark via `ThemeProvider` (`igreen-theme`); default light; Academy/`painel-elite`/ads seguem `html.dark`.
