# 02 — Inventário de funções — Backend (Edge Functions + _shared)

**Método:** AST via TypeScript Compiler API (parse de Deno TS).
**Escopo:** `supabase/functions/**/*.{ts,tsx,js,jsx,mjs,cjs}`
**Data:** 2026-07-16

## Resumo

| Métrica | Valor |
|---|---:|
| Arquivos varridos | 535 |
| Funções catalogadas | 2188 |
| Export named | 708 |
| Internas | 1480 |
| Async | 646 |
| Funções com verify_jwt no config.toml | 71 |
| verify_jwt=false | 59 |
| verify_jwt=true | 12 |

## Top diretórios por quantidade de funções

| Diretório | Funções |
|---|---:|
| _shared/cerebro | 278 |
| evolution-webhook | 146 |
| _shared/bot | 110 |
| _shared/engine | 100 |
| whapi-webhook | 100 |
| sync-igreen-customers | 51 |
| _shared/solar | 49 |
| _shared/voice-dialer | 46 |
| bot-e2e-runner | 42 |
| _shared/channels | 32 |
| _shared/daily-reheat | 21 |
| _shared/notify-consultant.ts | 21 |
| _shared/channel-sender.ts | 19 |
| manual-step-send | 19 |
| _shared/whapi-api.ts | 17 |
| whapi-proxy | 17 |
| _shared/attendance-flow.ts | 16 |
| _shared/conversation-helpers.ts | 16 |
| _shared/evolution-api.ts | 16 |
| _shared/captation | 15 |
| _shared/conversion | 15 |
| _shared/portal-correction.ts | 15 |
| lead-research | 15 |
| _shared/grounding.ts | 14 |
| _shared/idempotency_test.ts | 14 |
| evolution-proxy | 13 |
| facebook-create-campaign | 13 |
| _shared/captureExtractors.ts | 12 |
| _shared/evolution-api_idempotency_test.ts | 12 |
| _shared/flow-templates | 12 |
| _shared/test-mode.ts | 12 |
| ad-creative-builder | 12 |
| lead-research-sweep-cron | 12 |
| _shared/campaign-tracking.ts | 11 |
| _shared/format-reply.ts | 11 |
| _shared/ocr.ts | 11 |
| _shared/postpone-intent.ts | 11 |
| _shared/feature-flag.ts | 10 |
| _shared/flow-router.ts | 10 |
| _shared/minio-upload.ts | 10 |
| _shared/resolve-waba-phone.ts | 10 |
| _shared/rodizio-metrics-format.ts | 10 |
| cadence-tick | 10 |
| _shared/ai-config.ts | 9 |
| _shared/fb-crypto.ts | 9 |
| _shared/fb-graph.ts | 9 |
| _shared/gemini.ts | 9 |
| ai-agent-router | 9 |
| upload-documents-minio | 9 |
| upload-media | 9 |

## Edge handlers `index.ts` (pontos de entrada HTTP)

Arquivos `index.ts` de função: **155**

| Função | verify_jwt | Funções no arquivo | Com service_role | Com fetch | Banco (amostra) |
|---|---|---:|---|---|---|
| ad-competitor-scraper | (default/não listado) | 4 | nao | sim | - |
| ad-creative-builder | true | 12 | nao | nao | ad_creative_insights, ad_competitor_creatives, ad_playbooks |
| ad-creative-learner | (default/não listado) | 4 | nao | nao | facebook_campaigns, facebook_creative_packs, facebook_ad_metrics_daily, ad_creative_performance, ad_creative_insights, ad_recommendations |
| ad-creative-qa | false | 1 | nao | sim | - |
| ad-image-validator | (default/não listado) | 1 | nao | nao | - |
| ad-initial-message | true | 6 | nao | nao | facebook_campaigns |
| ad-video-captions | (default/não listado) | 3 | nao | nao | - |
| admin-recompute-lead-attribution | (default/não listado) | 3 | nao | nao | facebook_campaigns |
| admin-reset-password | (default/não listado) | 2 | nao | nao | - |
| admin-resync-waba-phones | (default/não listado) | 1 | nao | nao | - |
| admin-send-material | (default/não listado) | 1 | nao | nao | - |
| ai-agent-router | false | 9 | nao | nao | ai_agent_logs |
| ai-daily-digest | (default/não listado) | 1 | nao | nao | - |
| ai-generate-step-text | (default/não listado) | 1 | nao | nao | - |
| ai-resize-image | (default/não listado) | 1 | nao | nao | - |
| ai-transcribe-media | false | 2 | nao | nao | - |
| assign-lead-manual | (default/não listado) | 1 | nao | nao | - |
| audio-transcode-ogg | (default/não listado) | 2 | nao | nao | - |
| bot-audit-runner | (default/não listado) | 8 | nao | nao | customers, bot_step_transitions, rpc:lint_bot_flow_consistency |
| bot-e2e-runner | (default/não listado) | 13 | sim | sim | customers, conversations, bot_handoff_alerts, bot_flows, bot_flow_steps, bot_test_outbound |
| bot-health-intel | (default/não listado) | 5 | sim | sim | customers, conversations, bot_step_transitions, bot_handoff_alerts, ad_creative_insights, ad_competitor_creatives |
| bulk-scheduler | (default/não listado) | 4 | nao | sim | - |
| cadence-tick | (default/não listado) | 10 | nao | nao | cadence_stage_config, cadence_action_log, customers, referral_partners, consultants, voice_sms_log |
| captacao-backfill-ctwa | (default/não listado) | 2 | nao | nao | - |
| captacao-intel | (default/não listado) | 6 | sim | sim | page_views, customers, crm_deals, bot_handoff_alerts, ad_creative_insights, ad_creative_performance |
| capture-extract | false | 1 | nao | nao | - |
| close-attendance-scheduled | (default/não listado) | 1 | nao | nao | - |
| close-capture-and-register-sale | (default/não listado) | 1 | nao | nao | - |
| crm-auto-progress | (default/não listado) | 1 | nao | nao | - |
| ctwa-status | false | 1 | nao | nao | - |
| customer-takeover | (default/não listado) | 1 | nao | nao | - |
| daily-reheat-cron | false | 1 | nao | nao | - |
| dev-fire-all-steps | (default/não listado) | 2 | nao | sim | customers |
| embed-knowledge | false | 3 | nao | sim | - |
| end-customer-attendance | (default/não listado) | 1 | nao | nao | - |
| evolution-instance-reconnect | (default/não listado) | 1 | nao | nao | - |
| evolution-proxy | (default/não listado) | 13 | nao | sim | - |
| evolution-webhook | false | 3 | nao | nao | - |
| facebook-auto-fix-whatsapp | (default/não listado) | 1 | nao | nao | - |
| facebook-balance-check | (default/não listado) | 2 | nao | nao | - |
| facebook-balance-reconcile | false | 2 | nao | nao | - |
| facebook-campaign-healthcheck | false | 2 | nao | nao | facebook_campaigns |
| facebook-campaign-status | false | 1 | nao | nao | - |
| facebook-capi | false | 2 | nao | nao | - |
| facebook-create-campaign | true | 8 | nao | nao | - |
| facebook-delete-campaign | (default/não listado) | 1 | nao | nao | - |
| facebook-detect-waba | (default/não listado) | 1 | nao | nao | - |
| facebook-diagnose-page | (default/não listado) | 3 | nao | sim | - |
| facebook-diagnose-pixels | (default/não listado) | 1 | nao | sim | - |
| facebook-extend-campaign | (default/não listado) | 3 | nao | sim | - |
| facebook-list-assets | true | 1 | nao | sim | - |
| facebook-oauth-callback | false | 3 | nao | sim | - |
| facebook-oauth-start | true | 2 | nao | nao | - |
| facebook-platform-balance | (default/não listado) | 2 | nao | nao | - |
| facebook-platform-sync-all | (default/não listado) | 1 | nao | nao | - |
| facebook-preflight-check | (default/não listado) | 1 | nao | nao | - |
| facebook-realign-lifetime | (default/não listado) | 4 | nao | nao | - |
| facebook-repair-campaign-tracking | (default/não listado) | 3 | nao | nao | user_roles |
| facebook-retarget-sync | (default/não listado) | 3 | nao | nao | - |
| facebook-search-cities | true | 1 | nao | nao | - |
| facebook-select-assets | true | 3 | nao | nao | - |
| facebook-sync-ad-creatives | (default/não listado) | 4 | nao | nao | - |
| facebook-sync-audiences | (default/não listado) | 1 | nao | nao | - |
| facebook-sync-metrics | false | 3 | nao | nao | consultant_wallet, facebook_metrics_daily |
| facebook-toggle-campaign | (default/não listado) | 3 | nao | sim | - |
| facebook-update-campaign-rodizio | (default/não listado) | 2 | nao | nao | - |
| facebook-update-campaign-targeting | (default/não listado) | 2 | nao | nao | - |
| finalize-capture | (default/não listado) | 2 | nao | sim | settings, whatsapp_instances |
| finalize-club | false | 1 | nao | nao | - |
| flow-ai-rewrite | (default/não listado) | 2 | nao | nao | - |
| flow-d-health-cron | (default/não listado) | 1 | nao | nao | customers, bot_handoff_alerts |
| flow-engine-rollout-cron | false | 1 | nao | nao | - |
| flow-engine-v3-rollout-cron | false | 3 | nao | nao | - |
| flow-from-template | (default/não listado) | 1 | nao | nao | - |
| flow-simulate-reset | (default/não listado) | 3 | nao | nao | - |
| flow-simulate-run | (default/não listado) | 5 | nao | nao | bot_flows, bot_flow_steps |
| flow-spreadsheet-review | true | 2 | nao | nao | - |
| flow-step-suggest | (default/não listado) | 1 | nao | nao | - |
| fluxo-b-ai | (default/não listado) | 1 | nao | nao | - |
| generate-tour-content | (default/não listado) | 2 | nao | sim | - |
| igreen-chat | (default/não listado) | 1 | sim | nao | ai_knowledge_sections, tour_articles, settings, customers, rpc:get_coverage_summary |
| igreen-endpoint-probe | (default/não listado) | 1 | nao | nao | settings |
| inbound-media-retry-cron | false | 1 | nao | nao | - |
| lead-intake | false | 1 | nao | nao | - |
| lead-research-sweep-cron | false | 12 | sim | sim | lead_research_sweeps, rpc:lead_research_sweep_bump, lead_research_sweep_cities |
| lead-research-sweep | true | 1 | nao | nao | - |
| lead-research | true | 15 | nao | sim | - |
| lead-temperature-classifier | false | 7 | nao | sim | consultants, conversion_phrase_catalog, customers, lead_insights, conversations |
| leads-to-campaign | true | 1 | nao | nao | - |
| manual-step-send | (default/não listado) | 19 | nao | nao | bot_flows, bot_flow_steps, conversations, ai_media_library |
| marcar-conversa-vencedora | false | 1 | nao | nao | - |
| meta-ads-import | (default/não listado) | 1 | nao | sim | - |
| meta-ads-metrics | (default/não listado) | 1 | nao | nao | - |
| meta-leadads-webhook | false | 8 | nao | nao | facebook_campaigns |
| migrate-engine-v3 | false | 3 | nao | nao | customer_flow_state |
| migrate-supabase-to-minio | (default/não listado) | 6 | nao | nao | messages, storage_migration_log, consultants, message_templates |
| minio-quota-check | (default/não listado) | 6 | nao | sim | infra_metrics, app_settings |
| notify-partner-leads-batch | false | 5 | nao | nao | - |
| notify-superadmin-signup | false | 1 | nao | nao | - |
| outbound-media-flush-cron | false | 3 | nao | nao | pending_outbound_media, evolution_instances |
| portal-otp-watchdog | (default/não listado) | 8 | nao | sim | customers, bot_handoff_alerts, consultants, conversations |
| portal2-ai-audit | false | 1 | nao | nao | - |
| pos-venda-auto-progress | (default/não listado) | 2 | nao | nao | customers, customer_auto_message_log, kanban_stages, stage_auto_messages |
| probe-igreen-detail | (default/não listado) | 1 | nao | nao | settings |
| process-followups | false | 3 | nao | nao | customers |
| proposal-public-get | false | 1 | nao | nao | - |
| proposal-respond | false | 6 | nao | nao | - |
| qr-redirect | false | 3 | nao | nao | - |
| reactivation-cron | false | 6 | sim | nao | rpc:classify_reactivation_outcomes, reactivation_templates, reactivation_settings, evolution_instances, whatsapp_instances, reactivation_sends |
| reactivation-send | (default/não listado) | 3 | nao | nao | whatsapp_instances, reactivation_sends |
| recon-igreen-endpoints | (default/não listado) | 1 | nao | sim | - |
| recon-igreen-worker | (default/não listado) | 1 | nao | sim | - |
| recover-stuck-otp | false | 1 | nao | sim | - |
| reprocess-capture | (default/não listado) | 7 | nao | sim | - |
| resend-portal-link | (default/não listado) | 1 | nao | nao | - |
| rodizio-metrics-broadcast | false | 6 | nao | nao | rodizio_assignments |
| send-scheduled-messages | (default/não listado) | 1 | nao | nao | scheduled_messages |
| sim-upload-pdf | (default/não listado) | 1 | nao | nao | - |
| solar-design-get | false | 1 | nao | nao | - |
| solar-design-public | false | 1 | nao | nao | - |
| solar-geocode | false | 1 | nao | nao | - |
| solar-hd-probe | false | 1 | nao | nao | - |
| solar-roof-analyze | false | 1 | nao | nao | - |
| solar-roof-context | false | 1 | nao | nao | - |
| solar-roof-hd | false | 3 | nao | nao | - |
| solar-roof-image | false | 3 | nao | nao | - |
| solar-roof-public | false | 2 | nao | nao | - |
| speed-to-lead-check | false | 1 | nao | nao | - |
| spy-igreen-spa | (default/não listado) | 1 | nao | nao | settings |
| start-customer-attendance | (default/não listado) | 2 | nao | nao | - |
| submit-otp | (default/não listado) | 1 | nao | nao | - |
| super-admin-alerts | (default/não listado) | 1 | nao | sim | infra_metrics, app_settings |
| support-chat | (default/não listado) | 1 | nao | nao | - |
| sync-igreen-customers | (default/não listado) | 51 | nao | sim | settings, igreen_sync_runs, igreen_automation_settings, consultants, igreen_portal_accounts, rpc:recompute_pos_venda_stages |
| tiktok-leadgen-webhook | false | 4 | nao | nao | - |
| update-lead-origin | (default/não listado) | 1 | nao | nao | - |
| upload-ad-photo | (default/não listado) | 1 | nao | nao | - |
| upload-documents-minio | false | 9 | nao | sim | - |
| upload-media | (default/não listado) | 9 | nao | sim | user_roles |
| voice-campaign-control | (default/não listado) | 1 | nao | nao | - |
| voice-contact-base | (default/não listado) | 1 | nao | nao | - |
| voice-dashboard-metrics | (default/não listado) | 1 | nao | nao | - |
| voice-dialer-cron | false | 1 | nao | nao | - |
| voice-dialer-enqueue | (default/não listado) | 4 | nao | sim | voice_audio_clips, voice_campaigns |
| voice-dialer-health | false | 6 | sim | nao | voice_call_logs, voice_sms_log |
| voice-dialer-webhook | false | 4 | nao | nao | voice_campaign_targets, voice_campaigns |
| voice-sms-send | (default/não listado) | 4 | nao | nao | - |
| voice-template-stitch | (default/não listado) | 5 | nao | sim | voice_name_clips |
| wallet-create-topup | (default/não listado) | 1 | nao | nao | - |
| wallet-manual-credit | (default/não listado) | 1 | nao | nao | - |
| whapi-admin | (default/não listado) | 1 | nao | nao | - |
| whapi-history-backfill | (default/não listado) | 8 | nao | sim | settings, customers, conversations |
| whapi-proxy | (default/não listado) | 17 | nao | sim | - |
| whapi-webhook | false | 6 | nao | nao | customers, conversations, rpc:increment_ab_metric |
| worker-callback | (default/não listado) | 1 | nao | sim | - |

## Funções com `verify_jwt = false` (prioridade de auditoria)

| Função | Presente no disco |
|---|---|
| ad-creative-qa | sim |
| ai-agent-router | sim |
| ai-transcribe-media | sim |
| capture-extract | sim |
| ctwa-status | sim |
| daily-reheat-cron | sim |
| embed-knowledge | sim |
| evolution-webhook | sim |
| facebook-auto-pause | sim |
| facebook-balance-reconcile | sim |
| facebook-campaign-healthcheck | sim |
| facebook-campaign-status | sim |
| facebook-capi | sim |
| facebook-cbo-to-abo | sim |
| facebook-oauth-callback | sim |
| facebook-sync-metrics | sim |
| facebook-token-refresh | sim |
| faq-reengagement-nudge | sim |
| finalize-club | sim |
| flow-d-stuck-watchdog | sim |
| flow-engine-rollout-cron | sim |
| flow-engine-v3-rollout-cron | sim |
| igreen-ingest-customers | sim |
| inbound-media-retry-cron | sim |
| lead-intake | sim |
| lead-research-sweep-cron | sim |
| lead-temperature-classifier | sim |
| marcar-conversa-vencedora | sim |
| meta-leadads-webhook | sim |
| migrate-engine-v3 | sim |
| notify-partner-leads-batch | sim |
| notify-superadmin-signup | sim |
| outbound-media-flush-cron | sim |
| portal-offline-retry | sim |
| portal2-ai-audit | sim |
| process-followups | sim |
| proposal-public-get | sim |
| proposal-respond | sim |
| qr-redirect | sim |
| reactivation-cron | sim |
| recover-stuck-otp | sim |
| rodizio-metrics-broadcast | sim |
| solar-design-get | sim |
| solar-design-public | sim |
| solar-geocode | sim |
| solar-hd-probe | sim |
| solar-roof-analyze | sim |
| solar-roof-context | sim |
| solar-roof-hd | sim |
| solar-roof-image | sim |
| solar-roof-public | sim |
| speed-to-lead-check | sim |
| tiktok-leadgen-webhook | sim |
| upload-documents-minio | sim |
| voice-dialer-cron | sim |
| voice-dialer-health | sim |
| voice-dialer-webhook | sim |
| wallet-stripe-webhook | sim |
| whapi-webhook | sim |

## _shared — exports de maior impacto (amostra)

| Arquivo | Nome | Linhas | Async | Deps | Banco |
|---|---|---|---|---|---|
| supabase/functions/_shared/admin-client.ts | getAdminClient | 23-38 | nao | service_role_client | - |
| supabase/functions/_shared/ai-answer.ts | generateAiAnswer | 175-245 | sim | supabase.from\|ai | settings |
| supabase/functions/_shared/ai-button-intent.ts | matchButtonIntent | 23-127 | sim | fetch\|ai\|external_messaging_or_ads | - |
| supabase/functions/_shared/ai-config.ts | pickModel | 231-248 | nao | ai | - |
| supabase/functions/_shared/ai-config.ts | getGlobalAiSettings | 284-312 | sim | supabase.from\|ai | settings |
| supabase/functions/_shared/ai-config.ts | getConsultantAiProfile | 326-352 | sim | supabase.from | consultants |
| supabase/functions/_shared/ai-config.ts | getConsultantAiProvider | 362-383 | sim | supabase.from\|ai | consultants |
| supabase/functions/_shared/ai-cost-tracker.ts | trackAIUsage | 37-75 | sim | supabase.from | ai_costs |
| supabase/functions/_shared/ai-cost-tracker.ts | logAIDecision | 77-117 | sim | supabase.from | ai_decisions |
| supabase/functions/_shared/ai-decisions.ts | logAiDecision | 40-71 | nao | supabase.from | ai_decisions |
| supabase/functions/_shared/ai-faq-answerer.ts | answerFaqWithAI | 129-302 | sim | supabase.from\|ai | ai_knowledge_sections |
| supabase/functions/_shared/ai-gateway.ts | aiChat | 42-95 | sim | fetch\|ai | - |
| supabase/functions/_shared/ai-gateway.ts | aiChatCascade | 121-138 | sim | ai | - |
| supabase/functions/_shared/ai-gateway.ts | aiMultimodal | 142-164 | sim | ai | - |
| supabase/functions/_shared/ai-orchestrator.ts | runOrchestrator | 227-327 | sim | ai | - |
| supabase/functions/_shared/ai-summary.ts | maybeUpdateSummary | 28-79 | sim | supabase.from | customers |
| supabase/functions/_shared/anti-ban.ts | checkSendQuota | 32-74 | sim | supabase.from\|supabase.rpc\|external_messaging_or_ads | whatsapp_instances,instance_risk_signals,rpc:check_send_quota |
| supabase/functions/_shared/anti-ban.ts | registerSend | 76-82 | sim | supabase.rpc | rpc:register_send |
| supabase/functions/_shared/attendance-channel-env.ts | loadChannelEnv | 9-29 | sim | supabase.from\|external_messaging_or_ads | settings |
| supabase/functions/_shared/attendance-flow.ts | sendWelcomeHeader | 207-441 | sim | supabase.from\|external_messaging_or_ads | customers,referral_partners,conversations |
| supabase/functions/_shared/attendance-flow.ts | sendAttendanceRatingRequest | 443-603 | sim | supabase.from\|external_messaging_or_ads | customers,conversations |
| supabase/functions/_shared/attendance-flow.ts | tryInterceptAttendanceRating | 699-876 | sim | supabase.from | customers,conversations |
| supabase/functions/_shared/audio-transcript.ts | ensureAudioTranscript | 26-74 | sim | supabase.from\|service_role_client\|fetch | ai_media_library |
| supabase/functions/_shared/audit.ts | logStepTransition | 14-46 | sim | supabase.from | bot_step_transitions |
| supabase/functions/_shared/automation-gate.ts | isAutomationEnabled | 13-30 | sim | supabase.from | automation_toggles |
| supabase/functions/_shared/automation-gate.ts | logSkipped | 32-50 | sim | supabase.from | automation_skip_log |
| supabase/functions/_shared/automation-templates.ts | loadAutomationTemplate | 12-52 | sim | supabase.from | consultant_message_templates |
| supabase/functions/_shared/bot/ai-cooldown.ts | aiInCooldownPersistent | 37-58 | sim | supabase.from | ai_cooldown_state |
| supabase/functions/_shared/bot/ai-cooldown.ts | setAiCooldownPersistent | 64-79 | sim | supabase.rpc | rpc:ai_cooldown_check_and_set |
| supabase/functions/_shared/bot/cadastro-fixes.ts | looksLikeSpamBlast | 60-72 | nao | external_messaging_or_ads | - |
| supabase/functions/_shared/bot/conversational-templates.ts | getTemplate | 105-127 | sim | supabase.from | bot_messages |
| supabase/functions/_shared/bot/dedupe.ts | checkAndMarkProcessed | 45-92 | sim | supabase.from | webhook_message_dedup |
| supabase/functions/_shared/bot/global-flag.ts | isBotGloballyEnabled | 17-32 | sim | supabase.from | app_settings |
| supabase/functions/_shared/bot/global-flag.ts | isResolverStrictMode | 42-56 | sim | supabase.from | app_settings |
| supabase/functions/_shared/bot/intent-classifier.ts | classifyIntent | 158-219 | sim | ai | - |
| supabase/functions/_shared/bot/orchestrator-gate.ts | hasActiveCustomFlow | 23-46 | sim | supabase.from | bot_flows |
| supabase/functions/_shared/bot/paused.ts | isPausedByPhone | 42-58 | sim | supabase.from\|external_messaging_or_ads | customers |
| supabase/functions/_shared/bot/paused.ts | isConsultantAIDisabled | 70-88 | sim | supabase.from | ai_agent_config |
| supabase/functions/_shared/bot/pending-inbound.ts | claimPendingInbound | 25-80 | sim | supabase.from\|supabase.rpc | customers,conversations,rpc:clear_pending_inbound |
| supabase/functions/_shared/bot/reemit-buttons.ts | reemitStepButtons | 52-194 | sim | supabase.from\|external_messaging_or_ads | bot_flows,bot_flow_steps,conversations |
| supabase/functions/_shared/bot/step-goal.ts | goalFromStepRow | 99-131 | nao | external_messaging_or_ads | - |
| supabase/functions/_shared/bot/step-goal.ts | resolveStepReentry | 136-175 | sim | supabase.from | bot_flow_steps |
| supabase/functions/_shared/cadence-hooks.ts | ensureCadenceState | 16-41 | sim | supabase.from | lead_cadence_state |
| supabase/functions/_shared/cadence-hooks.ts | onLeadInboundResponse | 47-99 | sim | supabase.from | lead_cadence_state,cadence_action_log,customers,ai_slot_dispatch_log |
| supabase/functions/_shared/cadence-hooks.ts | onCallAnsweredPauseCadence | 105-126 | sim | supabase.from | lead_cadence_state |
| supabase/functions/_shared/caller-auth.ts | resolveCaller | 86-132 | sim | supabase.rpc\|service_role_client | rpc:has_role |
| supabase/functions/_shared/caller-auth.ts | assertOwnership | 149-193 | sim | supabase.from | customers |
| supabase/functions/_shared/campaign-tracking.ts | ensureCampaignTrackingProtocol | 94-115 | sim | supabase.rpc | rpc:generate_campaign_tracking_protocol |
| supabase/functions/_shared/campaign-tracking.ts | resolveCampaignByTrackingProtocol | 117-141 | sim | supabase.from | facebook_campaigns |
| supabase/functions/_shared/captation/consent.ts | logConsent | 28-50 | sim | supabase.from | lead_consent_log |
| supabase/functions/_shared/captation/flow-d-alerts.ts | recordFlowDAlert | 40-75 | sim | supabase.from | bot_handoff_alerts |
| supabase/functions/_shared/captation/lead-ingest.ts | ingestLead | 100-200 | sim | supabase.from | captured_leads |
| supabase/functions/_shared/captation/lead-source.ts | tagLeadSource | 38-149 | sim | supabase.from | customers,campaign_match_log |
| supabase/functions/_shared/captation/mirror-customer.ts | mirrorCustomerToCaptation | 16-81 | sim | supabase.from\|external_messaging_or_ads | customers,captured_leads |
| supabase/functions/_shared/cerebro/comum/gateway.ts | chat | 74-102 | sim | ai | - |
| supabase/functions/_shared/cerebro/comum/gateway.ts | embed | 148-166 | sim | fetch\|ai | - |
| supabase/functions/_shared/cerebro/comum/rag.ts | buscarContexto | 6-64 | sim | supabase.rpc | rpc:match_knowledge,rpc:match_winning |
| supabase/functions/_shared/cerebro/estado.ts | lerEstado | 59-98 | sim | supabase.from | customers |
| supabase/functions/_shared/cerebro/estado.ts | atualizarEstado | 368-434 | sim | supabase.from | customer_flow_state |
| supabase/functions/_shared/cerebro/followup-hook.ts | executarFollowupCerebro | 151-198 | sim | external_messaging_or_ads | - |
| supabase/functions/_shared/cerebro/index.ts | variantBLivreSemPassos | 389-419 | sim | supabase.from | customers |
| supabase/functions/_shared/cerebro/registro-decisao.ts | registrarDecisaoSombra | 181-252 | sim | supabase.from | ai_decisions |
| supabase/functions/_shared/cerebro/resposta-hook.ts | lerNumerosTeste | 129-153 | sim | supabase.from | rollout_config |
| supabase/functions/_shared/cerebro/resposta-hook.ts | responderComCerebro | 382-533 | sim | supabase.from\|external_messaging_or_ads | ai_decisions |
| supabase/functions/_shared/cerebro/sombra-hook.ts | executarCerebroSombra | 226-291 | sim | external_messaging_or_ads | - |
| supabase/functions/_shared/channel-sender.ts | resolveChannel | 25-58 | sim | supabase.from\|external_messaging_or_ads | whatsapp_instances |
| supabase/functions/_shared/channel-sender.ts | resolveChannelForCustomer | 83-162 | sim | supabase.from\|external_messaging_or_ads | customers,whatsapp_instances |
| supabase/functions/_shared/channel-sender.ts | sendStageAutoMessages | 397-446 | sim | supabase.from | stage_auto_messages |
| supabase/functions/_shared/channel-sender.ts | toJid | 465-469 | nao | external_messaging_or_ads | - |
| supabase/functions/_shared/channels/evolution.ts | createEvolutionAdapter | 77-221 | nao | external_messaging_or_ads | - |
| supabase/functions/_shared/channels/index.ts | getAdapter | 41-46 | nao | external_messaging_or_ads | - |
| supabase/functions/_shared/channels/whapi.ts | createWhapiAdapter | 58-204 | nao | external_messaging_or_ads | - |
| supabase/functions/_shared/club-worker.ts | resolveClubWorker | 31-55 | sim | supabase.from | settings |
| supabase/functions/_shared/club-worker.ts | buildClubDadosFromCustomer | 78-97 | nao | external_messaging_or_ads | - |
| supabase/functions/_shared/club-worker.ts | dispatchClubWorker | 103-166 | sim | supabase.from\|external_messaging_or_ads | customers |
| supabase/functions/_shared/clubValidation.ts | validateForClub | 130-223 | nao | external_messaging_or_ads | - |
| supabase/functions/_shared/consultant-template.ts | resolveConsultantMessage | 15-59 | sim | supabase.from | consultant_message_templates |
| supabase/functions/_shared/contact-suppression.ts | assertCanContact | 38-113 | sim | supabase.from\|external_messaging_or_ads | customers,voice_dnc_list |
| supabase/functions/_shared/contact-suppression.ts | applyCustomerSuppression | 116-176 | sim | supabase.from | customers,voice_dnc_list,captured_leads,contact_suppression_log |
| supabase/functions/_shared/conversation-helpers.ts | getReplyForStep | 145-177 | nao | external_messaging_or_ads | - |
| supabase/functions/_shared/conversation-helpers.ts | resetLeadIdentity | 201-249 | sim | supabase.from | customers |
| supabase/functions/_shared/conversation-helpers.ts | shouldSkipAsk | 278-354 | nao | external_messaging_or_ads | - |
| supabase/functions/_shared/conversation-helpers.ts | hasBillData | 436-444 | nao | external_messaging_or_ads | - |
| supabase/functions/_shared/crm-stage-sync.ts | syncDealStageFromStep | 97-145 | sim | supabase.from | crm_deals |
| supabase/functions/_shared/cron-pause-batch.ts | filterSendableCustomers | 33-86 | sim | supabase.from | customer_flow_state |
| supabase/functions/_shared/ctwa-referral-probe.ts | findReferralPaths | 36-91 | nao | external_messaging_or_ads | - |
| supabase/functions/_shared/ctwa-referral-probe.ts | logReferralProbe | 94-132 | sim | supabase.from | ctwa_referral_probe_log |
| supabase/functions/_shared/ctwa-url-extractor.ts | resolveCampaignByAdIdInUrl | 29-69 | sim | supabase.from | facebook_campaigns |
| supabase/functions/_shared/customer-flow-state.ts | loadFlowState | 52-117 | sim | supabase.from\|external_messaging_or_ads\|storage | customer_flow_state |
| supabase/functions/_shared/customer-flow-state.ts | persistFlowState | 145-184 | sim | supabase.from | customer_flow_state |
| supabase/functions/_shared/customer-lock.ts | withCustomerLock | 80-209 | sim | supabase.rpc | rpc:try_acquire_customer_lock,rpc:release_customer_lock |
| supabase/functions/_shared/customer-pause-filter.ts | checkCustomerCanSend | 31-80 | sim | supabase.from | customers |
| supabase/functions/_shared/daily-reheat/dispatch.ts | loadCycleKit | 81-100 | sim | supabase.from | daily_reheat_kit,voice_audio_clips |
| supabase/functions/_shared/daily-reheat/dispatch.ts | dispatchPlans | 382-427 | sim | supabase.from | daily_reheat_queue |
| supabase/functions/_shared/daily-reheat/plan.ts | loadDailyReheatSettings | 106-131 | sim | supabase.from\|external_messaging_or_ads | daily_reheat_settings |
| supabase/functions/_shared/daily-reheat/plan.ts | planDailyReheat | 152-350 | sim | supabase.from\|external_messaging_or_ads | customers,daily_reheat_queue,proactive_touch_log,voice_dnc_list |
| supabase/functions/_shared/detect-doc-type.ts | detectDocumentTypeDetailed | 250-305 | sim | ai | - |
| supabase/functions/_shared/deterministic-campaign-resolver.ts | campaignContainsAdId | 132-150 | sim | supabase.from | facebook_campaigns |
| supabase/functions/_shared/deterministic-campaign-resolver.ts | resolveCampaignFromStrongMeta | 153-194 | sim | supabase.from | facebook_campaigns,ctwa_clid_mapping |
| supabase/functions/_shared/dispatcher/index.ts | executeActions | 104-328 | sim | supabase.from\|external_messaging_or_ads | conversations,bot_test_outbound,customer_flow_state |
| supabase/functions/_shared/engine/__tests__/arb.ts | arbCustomerSnapshot | 288-340 | nao | external_messaging_or_ads | - |
| supabase/functions/_shared/engine/decision.ts | readKillSwitch | 198-297 | sim | supabase.from | consultants |
| supabase/functions/_shared/engine/decision.ts | readProdMode | 305-357 | sim | supabase.from | app_settings |
| supabase/functions/_shared/engine/loader.ts | loadContext | 64-448 | sim | supabase.from\|external_messaging_or_ads\|storage | customers,bot_flows,bot_flow_steps,consultants,ai_media_library |
| supabase/functions/_shared/engine/router.ts | isEngineV3Enabled | 38-70 | sim | supabase.from | consultants |
| supabase/functions/_shared/engine/webhook-entry.ts | runUnifiedEngineWebhookEntry | 289-452 | sim | supabase.from | customers,consultants,engine_logs |
| supabase/functions/_shared/engine/webhook-hook.ts | runEngineV3IfEnabled | 79-215 | sim | supabase.from\|external_messaging_or_ads | engine_logs |
| supabase/functions/_shared/evolution-api.ts | createEvolutionSender | 81-605 | nao | service_role_client\|fetch\|external_messaging_or_ads\|storage | - |
| supabase/functions/_shared/evolution-api.ts | parseEvolutionMessage | 614-731 | nao | external_messaging_or_ads | - |
| supabase/functions/_shared/fb-graph.ts | adminClient | 13-15 | nao | service_role_client | - |
| supabase/functions/_shared/fb-graph.ts | authConsultant | 17-39 | sim | service_role_client | - |
| supabase/functions/_shared/fb-graph.ts | loadConnection | 41-77 | sim | supabase.from\|external_messaging_or_ads | facebook_connections |
| supabase/functions/_shared/fb-graph.ts | loadPlatformAccount | 83-105 | sim | supabase.from | platform_facebook_account |
| supabase/functions/_shared/fb-graph.ts | loadConsultantAdSettings | 111-157 | sim | supabase.from\|external_messaging_or_ads | consultant_ad_settings,whatsapp_instances,consultants |
| supabase/functions/_shared/fb-graph.ts | loadCampaignConnection | 163-184 | sim | external_messaging_or_ads | - |
| supabase/functions/_shared/fb-graph.ts | getOrCreateWallet | 189-214 | sim | supabase.from | consultant_wallet |
| supabase/functions/_shared/feature-flag.ts | getFlowReliabilityV2 | 53-86 | sim | supabase.from | consultants |
| supabase/functions/_shared/feature-flag.ts | getFlowEngineV3 | 146-178 | sim | supabase.from | consultants |
| supabase/functions/_shared/feature-flag.ts | isCerebroAtivo | 203-230 | sim | supabase.from | consultants |
| supabase/functions/_shared/flow-templates/engine.ts | generateFlowFromTemplate | 55-226 | nao | external_messaging_or_ads | - |
| supabase/functions/_shared/fluxo-b-ia/agent.ts | processarTurnoFluxoB | 64-365 | sim | supabase.from\|ai\|external_messaging_or_ads | customers,consultants,conversations,app_settings |
| supabase/functions/_shared/fluxo-b-ia/faq-direct.ts | buscarRespostaDiretaFaq | 85-170 | sim | supabase.from | bot_flows,bot_flow_qa,bot_flow_qa_triggers |
| supabase/functions/_shared/gemini.ts | geminiGenerate | 141-413 | sim | supabase.rpc\|service_role_client\|fetch\|ai | rpc:consume_gemini_token |
| supabase/functions/_shared/gemini.ts | geminiText | 416-426 | sim | ai | - |
| supabase/functions/_shared/gemini.ts | geminiMultimodal | 429-463 | sim | ai | - |
| supabase/functions/_shared/gemini.ts | geminiEmbed | 466-483 | sim | fetch\|ai | - |
| supabase/functions/_shared/idempotency.ts | acquireOutboundSlot | 115-175 | sim | supabase.from\|external_messaging_or_ads | outbound_message_log |
| supabase/functions/_shared/idempotency.ts | recordOutboundResult | 182-207 | sim | supabase.from\|external_messaging_or_ads | outbound_message_log |
| supabase/functions/_shared/igreen-automation.ts | enqueueProactiveWaCandidates | 29-123 | sim | supabase.from | bot_handoff_alerts |
| supabase/functions/_shared/image-capture-step.ts | resolveImageCaptureStep | 32-73 | sim | supabase.from | bot_flows,bot_flow_steps |
| supabase/functions/_shared/image-capture-step.ts | resolveCaptureRedirectStep | 88-114 | sim | supabase.from | bot_flow_steps |
| supabase/functions/_shared/image-validator.ts | validateAdImage | 45-122 | sim | fetch\|ai\|storage | - |
| supabase/functions/_shared/knowledge-lookup.ts | lookupKnowledge | 104-173 | sim | supabase.from | bot_flows,bot_flow_qa,bot_flow_qa_triggers,ai_knowledge_sections |
| supabase/functions/_shared/lead-attribution.ts | attributeLeadSource | 36-122 | sim | external_messaging_or_ads | - |
| supabase/functions/_shared/log-redact.ts | summarizeWebhookBody | 51-77 | nao | external_messaging_or_ads | - |
| supabase/functions/_shared/lovable-gateway.ts | tryLovableGateway | 104-193 | sim | fetch\|ai | - |
| supabase/functions/_shared/media-dedupe.ts | reserveMediaSlot | 33-62 | sim | supabase.rpc | rpc:reserve_media_send |
| supabase/functions/_shared/media-dedupe.ts | confirmMediaSlot | 65-80 | sim | supabase.rpc | rpc:confirm_media_send |
| supabase/functions/_shared/media-dedupe.ts | canSendMediaOnce | 88-121 | sim | supabase.from | ai_slot_dispatch_log |
| supabase/functions/_shared/media-storage.ts | uploadMediaUnified | 63-128 | sim | supabase.from\|service_role_client\|external_messaging_or_ads\|storage | whatsapp-media |
| supabase/functions/_shared/minio-upload.ts | uploadBytesToMinio | 85-171 | sim | fetch\|storage | - |
| supabase/functions/_shared/minio-upload.ts | uploadToMinioPath | 186-239 | sim | fetch\|storage | - |
| supabase/functions/_shared/multi-field-extractor.ts | buildMultiFieldPatch | 87-129 | nao | external_messaging_or_ads | - |
| supabase/functions/_shared/notify-consultant.ts | notifyConsultant | 15-72 | sim | supabase.from\|fetch\|external_messaging_or_ads | consultants,whatsapp_instances |
| supabase/functions/_shared/notify-consultant.ts | sendRawToNumber | 94-169 | sim | supabase.from\|fetch\|external_messaging_or_ads | settings,whatsapp_instances |
| supabase/functions/_shared/notify-consultant.ts | notifyNewLead | 238-276 | sim | supabase.from\|external_messaging_or_ads | consultants |
| supabase/functions/_shared/notify-consultant.ts | notifyHandoff | 279-314 | sim | external_messaging_or_ads | - |
| supabase/functions/_shared/notify-consultant.ts | notifyClientReplyWhilePaused | 351-392 | sim | external_messaging_or_ads | - |
| supabase/functions/_shared/notify-consultant.ts | notifyInboundWhileBotOff | 398-436 | sim | external_messaging_or_ads | - |
| supabase/functions/_shared/notify-consultant.ts | notifyPartnerNewLead | 531-636 | sim | supabase.from\|external_messaging_or_ads | customers |
| supabase/functions/_shared/notify-consultant.ts | notifyPartnerStep | 649-732 | sim | supabase.from\|external_messaging_or_ads | customers |
| supabase/functions/_shared/notify-consultant.ts | notifySuperAdminUnmatchedLead | 740-791 | sim | supabase.from\|external_messaging_or_ads | outbound_message_log |
| supabase/functions/_shared/notify-consultant.ts | notifyOwnerManualReview | 798-853 | sim | supabase.from\|external_messaging_or_ads | outbound_message_log |
| supabase/functions/_shared/ocr.ts | baixarImagem | 72-156 | sim | ai\|external_messaging_or_ads\|storage | - |
| supabase/functions/_shared/ocr.ts | ocrContaEnergia | 159-346 | sim | ai\|external_messaging_or_ads | - |
| supabase/functions/_shared/ocr.ts | ocrDocumento | 453-555 | sim | ai\|external_messaging_or_ads | - |
| supabase/functions/_shared/ocr.ts | ocrCpfFocado | 562-608 | sim | ai | - |
| supabase/functions/_shared/ocr.ts | ocrRgFocado | 630-673 | sim | ai | - |
| supabase/functions/_shared/ocr.ts | ocrNomeFocado | 675-704 | sim | ai | - |
| supabase/functions/_shared/ocr.ts | ocrNascimentoFocado | 706-742 | sim | ai | - |
| supabase/functions/_shared/ocr.ts | ocrDocumentoFrenteVerso | 751-880 | sim | ai | - |
| supabase/functions/_shared/openai.ts | openaiChat | 29-80 | sim | fetch\|ai | - |
| supabase/functions/_shared/pending-outbound-media.ts | enqueueOutboundTail | 79-131 | sim | supabase.from | pending_outbound_media |
| supabase/functions/_shared/performance/metrics.ts | recordStepTransition | 21-47 | sim | supabase.from | bot_step_transitions |
| supabase/functions/_shared/pick-flow-variant.ts | getFlowAbMode | 18-34 | sim | supabase.from | settings |
| supabase/functions/_shared/portal-phone.ts | resolvePortalWhatsapp | 67-82 | nao | external_messaging_or_ads | - |
| supabase/functions/_shared/portal-worker.ts | resolveWorker | 43-74 | sim | supabase.from | settings,customers |
| supabase/functions/_shared/portal-worker.ts | buildPortal2Payload | 127-247 | sim | supabase.from\|external_messaging_or_ads | customers |
| supabase/functions/_shared/portal-worker.ts | dispatchPortalWorker | 249-360 | sim | supabase.from | customers |
| supabase/functions/_shared/portalValidation.ts | validateForPortal | 102-236 | nao | external_messaging_or_ads | - |
| supabase/functions/_shared/proactive-send-guard.ts | canSendProactive | 35-97 | sim | supabase.from\|external_messaging_or_ads | consultants,whatsapp_instances |
| supabase/functions/_shared/proactive-send-guard.ts | logProactiveBlock | 100-114 | sim | supabase.from | outbound_blocked_log |
| supabase/functions/_shared/protocol.ts | assignProtocolToCustomer | 23-90 | sim | supabase.from\|supabase.rpc | customers,referral_partners,rpc:generate_partner_protocol_v2 |
| supabase/functions/_shared/reconcile-strong-meta.ts | reconcileStrongMetaCampaign | 28-126 | sim | supabase.from | customers,campaign_match_log |
| supabase/functions/_shared/render-vars.ts | renderTemplateVars | 77-161 | nao | external_messaging_or_ads | - |
| supabase/functions/_shared/resolve-flow.ts | resolveFlowId | 20-91 | sim | supabase.from | bot_flows |
| supabase/functions/_shared/resolve-flow.ts | resolveMediaOwnerId | 106-145 | sim | supabase.from | bot_flows |
| supabase/functions/_shared/resolve-waba-phone.ts | resolveWabaPhone | 197-499 | sim | supabase.from\|external_messaging_or_ads | platform_facebook_account,consultant_ad_settings |
| supabase/functions/_shared/retention-orchestrator.ts | loadRetentionSettings | 41-65 | sim | supabase.from | retention_settings |
| supabase/functions/_shared/retention-orchestrator.ts | canProactiveTouch | 78-116 | sim | supabase.from | proactive_touch_log |

_Total shared exports com I/O: 214_

## Webhooks e bots (evolution / whapi)

### evolution-webhook — 146 funções (16 exportadas)

| Arquivo | Nome | Linhas | Tipo | Async | Deps |
|---|---|---|---|---|---|
| supabase/functions/evolution-webhook/_helpers.ts | uploadMediaToMinio | 8-24 | webhook | sim | storage |
| supabase/functions/evolution-webhook/_helpers.ts | isRateLimited | 31-43 | webhook | nao | - |
| supabase/functions/evolution-webhook/_helpers.ts | canReconnect | 51-70 | webhook | sim | supabase.rpc |
| supabase/functions/evolution-webhook/_helpers.ts | classifyDisconnect | 93-100 | webhook | nao | - |
| supabase/functions/evolution-webhook/_helpers.ts | recordRiskSignal | 103-121 | webhook | sim | supabase.rpc |
| supabase/functions/evolution-webhook/_helpers.ts | activateRecoveryMode | 124-134 | webhook | sim | supabase.rpc |
| supabase/functions/evolution-webhook/handlers/bot-flow.ts | checkHolderMatch | 460-470 | webhook | nao | - |
| supabase/functions/evolution-webhook/handlers/bot-flow.ts | runBotFlow | 663-6286 | webhook | sim | supabase.from\|supabase.rpc\|service_role_client\|fetch\|ai\|external_messaging_or_ads\|storage |
| supabase/functions/evolution-webhook/handlers/connection.ts | handleConnectionUpdate | 22-221 | webhook | sim | supabase.from\|external_messaging_or_ads |
| supabase/functions/evolution-webhook/handlers/conversational/index.ts | phraseMatchesMessage | 159-173 | webhook | nao | - |
| supabase/functions/evolution-webhook/handlers/conversational/index.ts | matchQA | 175-255 | webhook | sim | supabase.from\|external_messaging_or_ads |
| supabase/functions/evolution-webhook/handlers/conversational/index.ts | appendButtonsToText | 279-306 | webhook | nao | - |
| supabase/functions/evolution-webhook/handlers/conversational/index.ts | runConversationalFlow | 791-2815 | webhook | sim | supabase.from\|supabase.rpc\|ai\|external_messaging_or_ads\|storage |
| supabase/functions/evolution-webhook/handlers/conversational/intent-classifier.ts | classifyIntent | 12-24 | webhook | sim | ai\|external_messaging_or_ads |
| supabase/functions/evolution-webhook/handlers/otp-intercept.ts | tryInterceptOtp | 29-181 | webhook | sim | supabase.from\|external_messaging_or_ads |
| supabase/functions/evolution-webhook/recreate-instance.ts | recreateInstance | 44-191 | webhook | sim | supabase.from\|external_messaging_or_ads |

### whapi-webhook — 100 funções (9 exportadas)

| Arquivo | Nome | Linhas | Tipo | Async | Deps |
|---|---|---|---|---|---|
| supabase/functions/whapi-webhook/_helpers.ts | uploadMediaToMinio | 8-24 | webhook | sim | storage |
| supabase/functions/whapi-webhook/_helpers.ts | isRateLimited | 31-43 | webhook | nao | - |
| supabase/functions/whapi-webhook/_helpers.ts | canReconnect | 50-61 | webhook | sim | supabase.rpc |
| supabase/functions/whapi-webhook/handlers/bot-flow.ts | checkHolderMatch | 449-459 | webhook | nao | - |
| supabase/functions/whapi-webhook/handlers/bot-flow.ts | runBotFlow | 644-6586 | webhook | sim | supabase.from\|service_role_client\|fetch\|ai\|external_messaging_or_ads\|storage |
| supabase/functions/whapi-webhook/handlers/conversational/index.ts | phraseMatchesMessage | 192-218 | webhook | nao | - |
| supabase/functions/whapi-webhook/handlers/conversational/index.ts | matchQA | 220-293 | webhook | sim | supabase.from |
| supabase/functions/whapi-webhook/handlers/conversational/index.ts | runConversationalFlow | 830-2978 | webhook | sim | supabase.from\|supabase.rpc\|ai\|external_messaging_or_ads\|storage |
| supabase/functions/whapi-webhook/handlers/conversational/intent-classifier.ts | classifyIntent | 12-24 | webhook | sim | ai\|external_messaging_or_ads |

## Limitações

- Deno `import` URLs não resolvem tipos; inventário é estrutural (AST), não type-checked.
- Handlers anônimos em `Deno.serve(async (req) => …)` aparecem como `<anonymous>`/`<anon>`.
- Call graph e authz real: etapas 7–8.
