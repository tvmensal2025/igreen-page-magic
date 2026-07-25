---
inclusion: auto
name: mapa-tarefas
description: Mapa tarefa comum -> arquivos exatos a editar. Use quando o usuário pedir uma mudança concreta e você precisar decidir rápido onde mexer.
---

# Mapa de tarefas — o que o usuário pede × onde editar

Este arquivo existe para eliminar dúvida "onde mexo?". Se a tarefa está aqui, siga estes caminhos exatos.

## Cadência A/B/C (motor Zero Lead Perdido)

| Tarefa | Onde |
|---|---|
| Editar texto/áudio de um stage (Voz, SMS, WhatsApp) | UI `/admin/textos` → grava em `cadence_stage_config.message_text` via `syncCadenceLibraryToStageConfig` (`src/lib/syncCadenceToBotFlow.ts`). Fonte da verdade no código: `src/lib/multichannelCadenceTexts.ts` |
| Mudar cap diário B / C / global | Colunas `cap_b`, `cap_c`, `cap_global_outreach` em `daily_reheat_settings` (edite pela UI `ColdCadenceCapCard` ou SQL). Consumido em `supabase/functions/cadence-tick/index.ts` |
| Adicionar novo stage | `_shared/cadence-engine.ts` (`STAGE_MAP` + `stageGroup`) + migration em `cadence_stage_config` + revisar `cadence-inbound-router.ts` |
| Mudar janela horária de envio | Trava `clamp_to_business_window_brt` em migration. **Duas janelas distintas:** (1) clamp geral = Seg–Sex 08:00–20:00, Sáb 08:00–14:00, Dom fechado (empurra p/ 2ª 08:05); (2) `daily_reheat_settings.window_start_brt/end_brt` (default 09:00–18:30) usada só pelo reheat clássico. |
| Pausar/despausar cadência | `app_settings.cadence_engine_enabled` + `automation_toggles(key='cadence_engine')` |
| Investigar “por que não enviou” | **`#erros-operacionais`** + `automation_skip_log` (cap, DNC, quiet, prefs, canal morto) + logs `cadence-tick` (`boot`/`guards_ok`/`done`/`fatal`) |
| Velip sem crédito / SMS não chega / ligação IK | `#erros-operacionais` §1 + `#voz-sms` · painel Velip · `voice_sms_log` / `voice_call_logs` |
| IA parou / OCR falhou / handoff | `#erros-operacionais` §2–3 + `#wa-webhook` · `ai_decisions` · `bot_paused_reason` |
| Easy Panel / worker offline / Sync WAF | `#erros-operacionais` §3 · health Portal2/Club/Sync (URLs separadas) |
| Site não abre / cron 401 / edge 500 | `#erros-operacionais` §4 + `#security-auth` `#deploy` |
| Quero alerta WA quando falhar (sem eu lembrar) | edge `super-admin-alerts` + `_shared/superadmin-alert.ts` · `#erros-operacionais` §0b · `app_settings.super_admin_phone` |
| Auditoria final completa (Opus/Kiro) | `#auditoria-final-opus` · `.cursor/commands/auditoria-final-plataforma.md` · `docs/PROMPT-AUDITORIA-FINAL-OPUS.md` |
| Auditoria design + velocidade (cores, botões, páginas, Web Vitals) | `#auditoria-design-velocidade` · `.cursor/commands/auditoria-design-velocidade.md` · `docs/PROMPT-AUDITORIA-DESIGN-VELOCIDADE-OPUS.md` |

## WhatsApp (Whapi primário, Evolution legado)

| Tarefa | Onde |
|---|---|
| Enviar via canal outbound | `_shared/channel-sender.ts` → `resolveConsultantOutboundChannel` |
| Adapter Whapi | `_shared/channels/whapi.ts` (health = `AUTH`) |
| Adapter Evolution | `_shared/channels/evolution.ts` (legado — não é falha se `needs_reconnect`) |
| Webhook inbound | `whapi-webhook` (primário) / `evolution-webhook` |
| Dedupe evento | `webhook_message_dedup` via `_shared/bot/dedupe.ts` |
| Throttle anti-ban | `whapi-throttle.ts` + RPC `claim_whapi_send_slot` |
| Kill switch geral | `app_settings.bot_global_enabled` + `_shared/bot/global-flag.ts` |

## Meta / rodízio / atribuição

| Tarefa | Onde |
|---|---|
| Atribuir campanha a lead | `_shared/deterministic-campaign-resolver.ts` (ordem: `ad_id → fb_campaign_id → ctwa_clid → protocol → initial_message exact`) |
| Rodízio de parceiro por campanha | RPC atômica `rodizio_assign_lead` + wizard `RodizioBlock.tsx`. Detalhe em `#rodizio-parceiros-campanha` |
| Notificar parceiro | `_shared/notify-consultant.ts` `notifyPartnerNewLead` + edge `notify-partner-leads-batch` |
| Lead Ads webhook | edge `meta-leadads-webhook` (precisa `PAGE_ACCESS_TOKEN`) |
| Métricas anúncio | `useAdMetrics.ts` + `AdMetricsCards.tsx` (CTWA reporta conversas, não `meta_lead_actions`) |
| Waste guard | `_shared/campaign-waste-guard.ts` (`AUTO_PERF_PAUSE:`) |

## Parceiros indicadores (keyword + short_code)

| Tarefa | Onde |
|---|---|
| Cadastrar/editar parceiro | UI `src/components/admin/parceiros/*` + hook `useReferralPartners` |
| Bloquear keyword genérica | `GENERIC_KEYWORD_BLOCKLIST` em `qrPhrase.ts` (front) — Deno usa mesma normalização |
| Frase do QR / marcador `#R{code}` | `qrPhrase.ts` + espelho `_shared/qr-phrase.ts` (editar SEMPRE juntos; `qrPhraseParity.test.ts` trava) |
| Rota `/r/{licenca}/{code}` | edge `qr-redirect` |
| Matching no webhook (short_code → keyword) | `_shared/keyword-matcher.ts` + blocos em `whapi-webhook` e `evolution-webhook` (paridade) |
| Detalhe canônico | `#parceiros-referral` |


## Portal 2 (cadastro iGreen)

| Tarefa | Onde |
|---|---|
| Disparar cadastro | edge `finalize-capture` → `_shared/portal-worker.ts` `dispatchPortalWorker` → worker Node `worker-portal-2/` |
| Callback OTP/facial/assinatura | edge `worker-callback` |
| Submeter OTP | edge `submit-otp` (+ watchdog / recover) |
| Colunas de estado | `customers.portal_submitted_at`, `otp_*`, `facial_*`, `assinatura_*`, `portal2_*` |
| Steps CRM | `portal_submitting` → `aguardando_otp` → facial → assinatura → `cadastro_em_analise` → `complete` |

## Club iGreen

| Tarefa | Onde |
|---|---|
| Disparar Club | edge `finalize-club` → `_shared/club-worker.ts` `dispatchClubWorker` → `worker-club/` |
| Validar payload | `worker-club/club-normalize.mjs` |
| Colunas de estado | `customers.club_*` |
| Rodar dryRun | default; live requer `ALLOW_LIVE_CLUB_POST` |

## Voz / SMS (Velip)

| Tarefa | Onde |
|---|---|
| Enfileirar chamada | edge `voice-dialer-enqueue` |
| Enviar SMS | edge `voice-sms-send` |
| Webhook Velip | edge `voice-dialer-webhook` (auto-DNC em `IK/EK/CK/BK` + 2× `UNDELIV` em 72h) |
| Áudio personalizado | `_shared/voice-dialer/` → `resolvePersonalizedCallAudio` |
| DNC voz | `voice_dnc_list` + `customers.do_not_contact` |
| Painel números inválidos | `src/components/admin/InvalidPhonesPanel.tsx` |
| Cross-channel suppression | `checkPhoneDeadForChannel` em `supabase/functions/cadence-tick/index.ts` |

## Nomes seguros (cliente/consultor)

| Tarefa | Onde |
|---|---|
| Primeiro nome cliente (edge) | `_shared/customer-display-name.ts` → `safeFirstNameForAddress` |
| Nome cliente (UI) | `src/lib/customerDisplayName.ts` |
| Label consultor ao lead (edge) | `_shared/consultant-public-label.ts` → `resolvePublicConsultantLabel` |
| Label consultor (UI) | `src/lib/consultantPublicLabel.ts` |

## CRM vs Lead vs Meta em análise

| Tarefa | Onde |
|---|---|
| Classificar bucket do lead | `src/lib/crmVsLeadAnalysis.ts` (`isLeadCycleEligibleNotCrmAnalysis`, `isCrmCadastroEmAnalise`, `isMetaCampanhaEmAnalise`, `isNuncaMaisContatar`) |
| Elegibilidade da Pizza / ciclo | `src/lib/cycleEligibility.ts` |
| Painel de agendamentos | `src/pages/AdminAgendamentos*` + `src/lib/agendamentosHub.ts` |

## Mídia

| Tarefa | Onde |
|---|---|
| Upload áudio/imagem/vídeo | `_shared/minio-upload.ts` (SigV4) + fallback `_shared/media-storage.ts` |
| Nunca | data-URL gigante em coluna do Postgres |

## Wallet / Stripe

| Tarefa | Onde |
|---|---|
| Recarga / débito | edges `wallet-*` |
| Ativar campanha (checa saldo) | `_shared/validate-campaign-activation.ts` |

## Tema / UI

| Tarefa | Onde |
|---|---|
| Cores / tokens | `src/index.css` (Verde iGreen, `#464C5B` texto) |
| Tema dual | `src/contexts/ThemeContext.tsx` (chave `igreen-theme`) |
| Forçar desktop no mobile | `src/components/layout/ForceDesktopLayout.tsx` |
| Rotas | `src/App.tsx` + `.kiro/steering/rotas-ui.md` |

## Auth de edges

| Tipo | Helper |
|---|---|
| Cron / pg_cron | `_shared/cron-auth.ts` → `assertCronAuth` |
| UI consultor (JWT) | `_shared/caller-auth.ts` → `resolveCaller` + `assertOwnership` |
| Webhook WA | `_shared/webhook-auth.ts` |
| CORS | `_shared/cors.ts` → `buildCors(req)` |

## Se a tarefa não está aqui

1. Pergunte-se: qual **domínio** é? (ver árvore em `AGENTS.md`)
2. Carregue o steering do domínio + `#helpers-canonicos` + `#banco`.
3. Antes de criar arquivo novo, procure helper existente com `rg` na pasta canônica.
4. Se descobrir um caminho útil e recorrente, **adicione-o a este arquivo** na mesma PR.
