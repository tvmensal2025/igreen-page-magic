---
inclusion: always
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
