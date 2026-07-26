# 04 — Conformidade com `regras-duras.md`

Cada regra de `.kiro/steering/regras-duras.md` verificada contra código real hoje (2026-07-26).

**Legenda:** ✅ conforme · ⚠️ conforme com ressalva · ❌ violado (nenhum encontrado nesta auditoria).

---

## Idioma PT-BR ✅

Documentação e steering em pt-BR. Não instrumentado em código (é regra de comunicação do agente).

## Whapi = canal primário ✅

- `resolveConsultantOutboundChannel` (`_shared/channel-sender.ts`) usado por `send-scheduled-messages`, `bulk-scheduler`, `cadence-tick`.
- `whapiApi` em `src/services/whapiApi.ts`.
- `whatsapp_instances.needs_reconnect` **não** é gate no fluxo Whapi (confirmado em `whapi-webhook`).
- Agenda humana sem quiet hours de bot (confirmed em `send-scheduled-messages/AGENTS.md`).

## Cérebro × Grupo A ✅

- Funil Grupo A determinístico manda — `classifyCadastroInput` em `whapi-webhook`.
- Cérebro só laterais; opt-in `cerebro_ativo` default **off** (setting em `consultant_automation_prefs`).
- Cadência A/B/C = disparo; Cérebro = inbound resposta.
- Lead responde → pausa cadência ~72h (em `_shared/cadence-engine.ts`).

## Campanha/rodízio = UUID ✅

- `facebook_campaigns.id` (UUID) → `customers.source_campaign_id` → `rodizio_pools.campaign_id`.
- Ordem de resolução: AD ID → `fb_campaign_id` → `ctwa_clid` → protocolo → `initial_message` exact.
- Zero keyword/cidade como chave de rodízio.
- Protocolo `2026-####` nunca sai no WA (regra confirmada em `wa-webhook` steering).

**Amostragem empírica:** `rodizio_assignments`=28, `campaign_match_log`=306 (baseline). Coerente.

## CRM vs lead (não misturar) ✅

- Helper canônico: `src/lib/crmVsLeadAnalysis.ts` — lido nesta auditoria.
- `isCrmCadastroEmAnalise` verifica `portal_submitted_at` ou steps pós-portal.
- `isLeadCycleEligibleNotCrmAnalysis` bloqueia lead cycle se estiver em CRM análise.
- `isMetaCampanhaEmAnalise` isolado de customer.
- `isNuncaMaisContatar` cobre `do_not_contact=true` + `paused_reason IN (dnc, opt_out, dnc:*)`.

## Nome do cliente ✅

- Guard: `_shared/customer-display-name.ts::safeFirstNameForAddress`.
- Fontes seguras: `self_introduced`, `user_confirmed`, `ocr_*`, `manual`, `igreen_portal`.
- Fontes inseguras: `whatsapp_profile`, `unknown`, `cadence`, vazio.
- Ligação: `resolvePersonalizedCallAudio`.

## Nome do consultor ao lead ✅

- Helper: `_shared/consultant-public-label.ts::resolvePublicConsultantLabel`.
- `display_name || name` cru **não** usado nas edges críticas (`whapi-webhook`, `cadence-tick`, `bulk-scheduler`).

## Produção / kill switch ✅

- `app_settings.bot_global_enabled = true` (lido agora).
- `cadence_engine_enabled = true`.
- `isBotGloballyEnabled` importado em `whapi-webhook:28` e usado `:99`.
- Rollback em cascata documentado: `live_dispatch → daily_reheat → cadence_engine → bot_global`.
- Segundo cadeado `consultant_automation_prefs` — presente (`ConsultantAutomationPrefsModal`).

## Caps outreach A/B/C ✅

Estado real hoje (leitura direta de `daily_reheat_settings`):

| Cap | Valor | Regra |
|---|---:|---|
| A | ilimitado | inbound, bypass total |
| `cap_b` | **150** | reengajamento COLD/SMS/CALL/TEMA |
| `cap_c` | **50** | RECALL_* (60D…YEARLY) |
| `cap_global_outreach` | **200** | teto B+C anti-ban |
| `daily_whapi_cap` | 60 | legado, mantido |

- `stageGroup(stage)` implementado em `_shared/cadence-engine.ts`.
- Alertas 60/85/100% em `automation_skip_log` (`outreach_cap_{b|c|g}_{60|85|100}pct`).
- UI: `ColdCadenceCapCard` (3 barras).

**Cliente ≠ lead:** `isClienteProibidoCadenciaABC` importado em `cadence-tick:74` e aplicado em `:1120`. ✅

## Janelas horárias BRT ✅

**Duas janelas distintas confirmadas:**

- **Clamp geral** `clamp_to_business_window_brt` → Seg-Sex 08:00–20:00, Sáb 08:00–14:00, Dom fechado (empurra p/ 2ª 08:05).
- **Janela do reheat clássico** `daily_reheat_settings.window_start_brt / window_end_brt` → hoje **08:00–20:00** em prod. (Legado default = 09:00–18:30.)

⚠️ **Ressalva:** o valor prod (08–20) é o mesmo do clamp geral, então operacionalmente colide. Não é violação, mas vale documentar que na prática o reheat clássico está com janela **igual** ao clamp geral. Confirmado como intencional em `EVIDENCIA-PROD.md`.

## Portal / Club / Sync (workers distintos) ✅

- `dispatchPortalWorker` → `worker-portal-2` (Portal 1 morto 2026-06).
- `dispatchClubWorker` → `worker-club` (porta 3102, `club_*`).
- `igreen_sync_worker_url` → `worker-igreen-sync` (**≠** `portal2_worker_url` / `club_worker_url`).

Três workers separados no repo (confirmado por `ls`).

## Ads / Cérebro / rodízio ✅

- Sem protocolo/keyword no WA.
- Waste marker `AUTO_PERF_PAUSE:` (em `#ads-contraste`).
- Métricas reais ao parceiro via `notifyPartnerNewLead` (documentado em `parceiros-referral.md`).

## Tema ✅

- Modo forçado light globalmente em `ThemeContext.tsx` (última alteração da sessão anterior).
- `ThemeProvider` (`igreen-theme`), default light.
- Academy/`painel-elite`/ads seguem `html.dark`.

---

## Resumo

- **10/10 blocos de regras conformes.**
- 1 ressalva (janela reheat colidindo com clamp geral em prod) — intencional, não é violação.
- Nenhum ❌ nesta auditoria.
