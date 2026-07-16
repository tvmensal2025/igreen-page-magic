# 04 — Inventário SQL — functions, triggers, policies, cron

**Método:** varredura regex estruturada em `supabase/migrations/*.sql` (ordem lexicográfica ≈ cronológica do prefixo timestamp).
**Migrations analisadas:** 722
**Data:** 2026-07-16

## Contagens brutas (ocorrências em migrations)

| Padrão | Ocorrências |
|---|---:|
| CREATE_FUNCTION | 277 |
| CREATE_PROCEDURE | 0 |
| CREATE_TRIGGER | 119 |
| CREATE_POLICY | 508 |
| ALTER_POLICY | 0 |
| CREATE_TABLE | 206 |
| ALTER_TABLE | 648 |
| GRANT | 322 |
| REVOKE | 79 |
| SECURITY_DEFINER | 253 |
| SECURITY_INVOKER | 3 |
| SEARCH_PATH | 194 |
| CRON_SCHEDULE | 72 |
| ENABLE_RLS | 207 |
| FORCE_RLS | 0 |
| NET_HTTP | 94 |

| Funções únicas (último nome visto) | 180 |
| SECURITY DEFINER sem search_path no chunk | 71 |
| cron.schedule nomeados | 72 |
| net.http_post referências | 70 |

## SECURITY DEFINER sem `search_path` detectado no corpo imediato

> Heurística de janela após CREATE FUNCTION; pode haver falso positivo se `SET search_path` estiver fora da janela. Confirmar na etapa 6.

| Migration | Função |
|---|---|
| 20260512022856_a7982ab0-8e46-4e91-bb77-4a1be36875b8.sql | `public.fb_trigger_lead` |
| 20260515164036_f56eb035-03e7-4c85-b0a2-bc008b287481.sql | `public.reset_lead_conversation` |
| 20260515170657_5124d6c0-4000-40e0-aa27-658b1bb3d6e6.sql | `public.reset_lead_conversation` |
| 20260515203403_b2199c6b-ced0-4c81-9cec-98cc01b3ca65.sql | `public.lint_bot_flow_consistency` |
| 20260515204820_a321d38b-d42e-46cd-ab2a-5f5ab92011fd.sql | `public.cleanup_bot_test_data` |
| 20260516043723_62756fce-2aa6-49cc-b9ea-9f525e816866.sql | `public.reset_lead_conversation` |
| 20260516045219_75af9beb-c2d7-4388-9b36-e5e2b51f2de7.sql | `public.reset_lead_conversation` |
| 20260516045935_6773f683-20a8-49ee-bb06-e5f71af276d2.sql | `public.reset_lead_conversation` |
| 20260516113650_e09b138b-a2d4-437d-aad4-bdcec2580d19.sql | `public.reset_lead_conversation` |
| 20260517180346_30d8a1c7-6779-4101-9600-f472de9b503e.sql | `public.create_postsale_deal_on_approval` |
| 20260517235238_00aa5d63-8038-4800-b92e-efe2b13851d1.sql | `public.enqueue_pending_inbound` |
| 20260517235238_00aa5d63-8038-4800-b92e-efe2b13851d1.sql | `public.clear_pending_inbound` |
| 20260518030253_bae9454d-dcf7-4e12-a506-73ee57db9d94.sql | `public.repair_bot_flow` |
| 20260518030425_037d5750-63b4-4fc8-9cda-ac13c1d335f4.sql | `public.repair_bot_flow` |
| 20260519135351_04bad528-a0ab-45ee-b700-01c915c9a2f4.sql | `public.auto_feedback_on_handoff` |
| 20260519140742_3b6eaf66-5640-40f8-ac35-b6ea9bdd3425.sql | `public.reset_lead_conversation` |
| 20260519153843_5086d002-a6e6-47be-8600-b2114299f19d.sql | `public.auto_feedback_on_handoff` |
| 20260519153843_5086d002-a6e6-47be-8600-b2114299f19d.sql | `public.reset_all_consultant_conversations` |
| 20260521010435_0001f667-562b-435e-9f4e-4f86435ca2d7.sql | `public.log_capture_event_if_new` |
| 20260521010435_0001f667-562b-435e-9f4e-4f86435ca2d7.sql | `public.customers_gamify_on_insert` |
| 20260521010435_0001f667-562b-435e-9f4e-4f86435ca2d7.sql | `public.customers_gamify_on_update` |
| 20260523123715_32f48765-89a4-458a-8475-347dfed8e7e8.sql | `public.seed_flow_d` |
| 20260523124632_a483497b-9106-47bd-bd0f-0bdac8565f18.sql | `public.seed_flow_d` |
| 20260523172910_6e05de4b-073d-406f-ad3f-e34069c5a9b7.sql | `public.try_log_media_send` |
| 20260525133458_b22398f7-af2a-4462-9fef-e39b10977a67.sql | `public.admin_unpause_global_bot` |
| 20260526104500_engine_v3_state_mirror.sql | `public.mirror_customer_flow_state_to_customers` |
| 20260526140000_referral_partners.sql | `public.get_referral_partner_metrics` |
| 20260528000100_reset_lead_cleanup_flow_state.sql | `public.reset_lead_conversation` |
| 20260528131927_35afbdd5-d026-4a8a-a4aa-0ae073c3784b.sql | `public.reset_lead_conversation` |
| 20260601030000_req2_seed_default_camila_flow_variant_d.sql | `public.seed_default_camila_flow` |
| 20260603140208_dced6c8e-3325-482f-b089-0ee8ae1ce007.sql | `public.seed_default_camila_flow` |
| 20260603225105_124251a0-2d85-4b68-b659-cb737ce08665.sql | `public.handle_new_consultant_signup` |
| 20260604125902_b68c61be-54f3-45d9-ae08-ddc19b31ffda.sql | `public.clone_superadmin_flow_d_steps` |
| 20260604125902_b68c61be-54f3-45d9-ae08-ddc19b31ffda.sql | `public.seed_default_camila_flow` |
| 20260604133237_ac4b3baa-65af-4a7a-8dee-097a58be7512.sql | `public.reset_lead_conversation` |
| 20260604134931_afb13ad1-bb63-467c-b17e-758f9d3f8168.sql | `public.seed_default_camila_flow` |
| 20260604222233_703dd9b5-f015-4d4c-a6ee-792f798558a5.sql | `public.check_send_quota` |
| 20260605023732_fd36d134-2b45-4d3b-a6e9-980088a477aa.sql | `public.admin_hard_reset_phone` |
| 20260605024209_8b2e949a-3082-45db-bf96-dd64cb61926a.sql | `public.admin_hard_reset_phone` |
| 20260605030637_71a63f61-1fbf-4785-ba81-f58c02e92c30.sql | `public.admin_hard_reset_phone_trace_counts` |
| 20260605031104_e0e2c084-3ae7-47e2-8b0a-4bf925d59b82.sql | `public.admin_hard_reset_phone_trace_counts` |
| 20260605054830_5e054e56-7b64-470c-9e72-815a6c30ee99.sql | `public.check_send_quota` |
| 20260605141030_ad7ddeac-4ba8-400a-b42a-3a8fc49b1125.sql | `public.fork_flow_from_public` |
| 20260605171047_7ec54e64-29fc-4b10-be06-14664f2aa6ec.sql | `public.admin_hard_reset_phone` |
| 20260606035434_94633ce4-5ac9-4242-82e3-a9f09b2681da.sql | `public.fork_flow_from_public` |
| 20260606035434_94633ce4-5ac9-4242-82e3-a9f09b2681da.sql | `public.sync_flow_from_public` |
| 20260607175337_34be38ea-685a-42f2-b872-8eff25710b81.sql | `public.admin_hard_reset_phone` |
| 20260607180500_1a9ae201-5ed9-4081-8dc7-3a54dd5c42be.sql | `public.admin_hard_reset_phone` |
| 20260608031130_539aef31-d996-45fa-b9ed-bf8f650b699e.sql | `public.recompute_pos_venda_stages` |
| 20260608031130_539aef31-d996-45fa-b9ed-bf8f650b699e.sql | `public.confirm_pending_classification` |
| 20260609075348_27e1c64b-e418-4e7a-bea8-d0b72933cbe3.sql | `public.ensure_bot_flow_variant` |
| 20260613110000_crm_pos_venda_unify.sql | `public.confirm_pending_classification` |
| 20260614120000_pos_venda_missing_signature.sql | `public.confirm_pending_classification` |
| 20260622072138_6918f801-ef30-4c10-b0ba-9cfc45cb86d1.sql | `public.log_silent_step_reset` |
| 20260704132721_379dad62-4a72-440f-8bad-0730086cbd1e.sql | `public.clone_bot_flow_as` |
| 20260704192352_41eb1509-c687-4ca0-937f-cd9f0c0c7b89.sql | `public.assign_flow_variant` |
| 20260707105310_0fa09977-a93b-45c9-b987-ed32f6c8cb1a.sql | `public.recompute_pos_venda_stages` |
| 20260709015812_3ceb3a7d-76ca-4bd6-8951-9c461da9f9cd.sql | `public.generate_campaign_tracking_protocol` |
| 20260709020044_c77846aa-30eb-4101-b53c-68d963de1533.sql | `public.rodizio_next` |
| 20260710194034_8ee33c92-544e-4bf9-8265-f4cd80b97abf.sql | `public.get_referral_partner_metrics` |
| 20260710194104_c0efe6ea-7ab7-4c48-a2bd-efd823bf5961.sql | `public.get_referral_partner_metrics` |
| 20260711184656_76948fcd-32fb-4469-94e0-398ccc4e5a0b.sql | `public.enforce_customer_meta_ad_campaign_guard` |
| 20260712213000_lint_loop_inbound_exempt_conversational.sql | `public.lint_bot_flow_consistency` |
| 20260713120000_rodizio_assign_atomic.sql | `public.rodizio_next` |
| 20260713120000_rodizio_assign_atomic.sql | `public.rodizio_assign_lead` |
| 20260714120000_manual_assign_pool_inactive_ok.sql | `public.enforce_customer_meta_ad_campaign_guard` |
| 20260714130000_harden_rodizio_end_to_end.sql | `public.configure_rodizio_pool` |
| 20260714130000_harden_rodizio_end_to_end.sql | `public.sync_pool_active_with_campaign` |
| 20260714130000_harden_rodizio_end_to_end.sql | `public.rodizio_next` |
| 20260714130000_harden_rodizio_end_to_end.sql | `public.rodizio_assign_lead` |
| 20260714130000_harden_rodizio_end_to_end.sql | `public.bind_customer_campaign` |

## Funções SQL (última definição por nome) — amostra completa de nomes

| Função | Última migration | Security | search_path |
|---|---|---|---|
| `public.activate_recovery_mode` | 20260603233147_9d679f54-89fa-4a58-a737-5dcf62c69895.sql | DEFINER | public |
| `public.admin_clear_ban` | 20260704221114_9c25b90e-c5e9-4c27-ac28-7ff72b175125.sql | DEFINER | public |
| `public.admin_clear_fatal_lock` | 20260604180058_bdd051fd-9fe2-4454-b6eb-f63f08ae5f3a.sql | DEFINER | public |
| `public.admin_cron_last_runs` | 20260711120314_7700bfc8-f9cd-4e83-8eba-4ddb77983719.sql | DEFINER | public, cron AS $$ |
| `public.admin_cron_list` | 20260711120314_7700bfc8-f9cd-4e83-8eba-4ddb77983719.sql | DEFINER | public, cron AS $$ |
| `public.admin_cron_reschedule` | 20260711120314_7700bfc8-f9cd-4e83-8eba-4ddb77983719.sql | DEFINER | public, cron AS $$ |
| `public.admin_cron_run_now` | 20260711120314_7700bfc8-f9cd-4e83-8eba-4ddb77983719.sql | DEFINER | public, cron AS $$ |
| `public.admin_cron_toggle` | 20260711120314_7700bfc8-f9cd-4e83-8eba-4ddb77983719.sql | DEFINER | public, cron AS $$ |
| `public.admin_hard_reset_phone` | 20260607180500_1a9ae201-5ed9-4081-8dc7-3a54dd5c42be.sql | DEFINER | —(não detectado) |
| `public.admin_hard_reset_phone_trace_counts` | 20260605031104_e0e2c084-3ae7-47e2-8b0a-4bf925d59b82.sql | DEFINER | —(não detectado) |
| `public.admin_mark_instance_banned` | 20260704221114_9c25b90e-c5e9-4c27-ac28-7ff72b175125.sql | DEFINER | public |
| `public.admin_unpause_global_bot` | 20260525133458_b22398f7-af2a-4462-9fef-e39b10977a67.sql | DEFINER | —(não detectado) |
| `public.ai_cooldown_check_and_set` | 20260522045128_23913903-c691-4c18-8dfb-9816d52d43fe.sql | DEFINER | public AS $$ |
| `public.apply_force_bot_on_customer_insert` | 20260528131927_35afbdd5-d026-4a8a-a4aa-0ae073c3784b.sql | DEFINER | public |
| `public.apply_referral_bonus` | 20260512113056_8219a36d-d5d2-41f7-9dc3-0a6ee6db13b4.sql | DEFINER | public |
| `public.assign_flow_variant` | 20260704192352_41eb1509-c687-4ca0-937f-cd9f0c0c7b89.sql | DEFINER | —(não detectado) |
| `public.assign_flow_variant_on_insert` | 20260608201601_4d796a0d-3654-43b7-9328-5d814230dede.sql | DEFINER | public |
| `public.assign_pool_member_suffix` | 20260709021448_2dc26529-50c2-44f5-b220-35d8035a8ecd.sql | DEFINER | public |
| `public.audio_library_increment_play` | 20260608125849_a71eb72b-f54b-457f-a553-f5841435f8fd.sql | DEFINER | public |
| `public.audio_library_set_updated_at` | 20260608125849_a71eb72b-f54b-457f-a553-f5841435f8fd.sql | DEFINER | public |
| `public.audit_flow_activate_rules` | 20260713031000_audit_flow_activate_rules.sql | DEFINER | public |
| `public.auto_feedback_on_handoff` | 20260519153843_5086d002-a6e6-47be-8600-b2114299f19d.sql | DEFINER | —(não detectado) |
| `public.auto_seed_faq_on_flow_create` | 20260613100000_auto_seed_faq_on_flow_create.sql | DEFINER | public |
| `public.bind_customer_campaign` | 20260714130000_harden_rodizio_end_to_end.sql | DEFINER | —(não detectado) |
| `public.bump_ad_template_usage_count` | 20260512104437_55a0c513-7a89-48cd-802f-25b03c4f1150.sql | DEFINER | public |
| `public.cadence_ensure_state_from_customer` | 20260711111546_0d031bcd-564e-4be7-9b3a-b02889025032.sql | DEFINER | public AS $$ |
| `public.cadence_on_inbound_message` | 20260711125150_af54b5b5-936d-417f-8baf-f36cadfec256.sql | DEFINER | public AS $$ |
| `public.campaign_templates_set_updated_at` | 20260604004045_2c3102b7-4c78-4bc3-892e-740d3db9a0a6.sql | ? | public AS $$ |
| `public.can_access_remote_support_topic` | 20260609120000_remote_support_realtime_authz.sql | DEFINER | public |
| `public.can_view_consultant` | 20260519171711_927f720c-3ee7-48d3-ac42-c814cfe6169f.sql | DEFINER | public |
| `public.check_consultant_phone_match` | 20260625235027_a06b6bd1-84fd-4621-bcc1-8b8612766a2e.sql | DEFINER | public |
| `public.check_send_quota` | 20260712233000_auditoria_agendamentos_claim_rastreio.sql | DEFINER | public |
| `public.claim_recon_job` | 20260706110900_177c7431-1987-483c-b738-d74d3559b042.sql | DEFINER | public |
| `public.claim_scheduled_messages` | 20260712233000_auditoria_agendamentos_claim_rastreio.sql | DEFINER | public |
| `public.claim_whapi_send_slot` | 20260713165235_whapi_send_throttle_claim_slot.sql | DEFINER | public |
| `public.classify_reactivation_outcomes` | 20260524000000_captacao_fluxo_d_conversao.sql | DEFINER | public |
| `public.cleanup_bot_test_data` | 20260515204820_a321d38b-d42e-46cd-ab2a-5f5ab92011fd.sql | DEFINER | —(não detectado) |
| `public.cleanup_webhook_artifacts` | 20260515134904_c86f0fed-4e59-4d4a-9c56-a726edad5687.sql | DEFINER | public |
| `public.clear_attendance_auto_close_on_inbound` | 20260713125415_09df73c8-0f86-435e-866d-0d0b1bc2d5c4.sql | DEFINER | public |
| `public.clear_pending_inbound` | 20260517235238_00aa5d63-8038-4800-b92e-efe2b13851d1.sql | DEFINER | —(não detectado) |
| `public.clear_recovery_mode` | 20260604180058_bdd051fd-9fe2-4454-b6eb-f63f08ae5f3a.sql | DEFINER | public |
| `public.clone_bot_flow_as` | 20260704132721_379dad62-4a72-440f-8bad-0730086cbd1e.sql | DEFINER | —(não detectado) |
| `public.clone_bot_flow_as_b` | 20260523114734_260f1b72-4a41-4bd5-bbaa-a871619735bd.sql | DEFINER | public AS |
| `public.clone_bot_flow_as_c` | 20260523114734_260f1b72-4a41-4bd5-bbaa-a871619735bd.sql | DEFINER | public AS |
| `public.clone_superadmin_flow_d_steps` | 20260604125902_b68c61be-54f3-45d9-ae08-ddc19b31ffda.sql | DEFINER | —(não detectado) |
| `public.compute_pos_venda_stage` | 20260707105310_0fa09977-a93b-45c9-b987-ed32f6c8cb1a.sql | ? | public |
| `public.configure_rodizio_pool` | 20260714130000_harden_rodizio_end_to_end.sql | DEFINER | —(não detectado) |
| `public.confirm_media_send` | 20260522045128_23913903-c691-4c18-8dfb-9816d52d43fe.sql | DEFINER | public AS $$ |
| `public.confirm_pending_classification` | 20260614120000_pos_venda_missing_signature.sql | DEFINER | —(não detectado) |
| `public.consume_gemini_token` | 20260522045128_23913903-c691-4c18-8dfb-9816d52d43fe.sql | DEFINER | public AS $$ |
| `public.count_captured_leads_by_channel` | 20260715170000_captacao_leads_list_perf.sql | DEFINER | public |
| `public.count_inbound_messages` | 20260613130000_conversion_sprint1_fixes.sql | DEFINER | public |
| `public.create_customer_flow_state` | 20260524101450_fc837599-9d92-46d8-b5e0-123ac93e9eb1.sql | DEFINER | public |
| `public.create_lead_deal_on_customer_insert` | 20260601220741_9b2a2c22-9015-41ca-84ad-9adbb41e89bd.sql | DEFINER | public |
| `public.create_postsale_deal_on_approval` | 20260517180346_30d8a1c7-6779-4101-9600-f472de9b503e.sql | DEFINER | —(não detectado) |
| `public.credit_consultant_wallet` | 20260512201054_5caaeb5f-f55b-4284-88b7-f9f9cc69c0a4.sql | DEFINER | public |
| `public.customers_default_capture_mode` | 20260521015457_ba923cfa-aad5-4cc9-bd18-8fd4335c330e.sql | DEFINER | public |
| `public.customers_gamify_on_insert` | 20260521010435_0001f667-562b-435e-9f4e-4f86435ca2d7.sql | DEFINER | —(não detectado) |
| `public.customers_gamify_on_update` | 20260521010435_0001f667-562b-435e-9f4e-4f86435ca2d7.sql | DEFINER | —(não detectado) |
| `public.debit_consultant_wallet` | 20260512201054_5caaeb5f-f55b-4284-88b7-f9f9cc69c0a4.sql | DEFINER | public |
| `public.enforce_customer_meta_ad_campaign_guard` | 20260714120000_manual_assign_pool_inactive_ok.sql | DEFINER | —(não detectado) |
| `public.enforce_do_not_contact_pause` | 20260715201000_enforce_dnc_block_rating_step.sql | ? | —(não detectado) |
| `public.enqueue_pending_inbound` | 20260517235238_00aa5d63-8038-4800-b92e-efe2b13851d1.sql | DEFINER | —(não detectado) |
| `public.ensure_bot_flow_variant` | 20260609075348_27e1c64b-e418-4e7a-bea8-d0b72933cbe3.sql | DEFINER | —(não detectado) |
| `public.ensure_igreen_connect_code` | 20260605235849_c979ebd3-8130-47d0-aa7f-1c942c92d505.sql | ? | public |
| `public.ensure_sale_stage_progress` | 20260618140000_sale_stage_templates_product_family.sql | DEFINER | public |
| `public.expire_overdue_proposals` | 20260614100000_proposals.sql | DEFINER | public |
| `public.fb_emit_capi` | 20260511161609_db786993-9de7-4f12-9202-2e7a29aab5a7.sql | DEFINER | public |
| `public.fb_sync_pixel_to_consultant` | 20260511161905_dfb85408-5ebe-4dcf-b302-315bf79cdca3.sql | DEFINER | public |
| `public.fb_trigger_complete_registration` | 20260511172000_b7364f0a-99f2-442f-8043-84156862ee36.sql | DEFINER | public |
| `public.fb_trigger_lead` | 20260512022856_a7982ab0-8e46-4e91-bb77-4a1be36875b8.sql | DEFINER | —(não detectado) |
| `public.fb_trigger_purchase` | 20260511161609_db786993-9de7-4f12-9202-2e7a29aab5a7.sql | DEFINER | public |
| `public.filter_dispatched_phones` | 20260715170000_captacao_leads_list_perf.sql | DEFINER | public |
| `public.flow_engine_housekeeping` | 20260526191041_15c7be29-53e6-4d09-a3e5-3afad5a29c3d.sql | DEFINER | public |
| `public.fork_ad_template` | 20260512132204_0ad55396-7253-4015-a849-79d87c31ce87.sql | DEFINER | public |
| `public.fork_flow_from_public` | 20260606035434_94633ce4-5ac9-4242-82e3-a9f09b2681da.sql | DEFINER | —(não detectado) |
| `public.fork_message_template` | 20260512132204_0ad55396-7253-4015-a849-79d87c31ce87.sql | DEFINER | public |
| `public.fork_public_ai_media` | 20260512205112_4a4f7771-ac95-4755-ad93-96c7f74bec50.sql | DEFINER | public |
| `public.funnel_step_rank` | 20260622072138_6918f801-ef30-4c10-b0ba-9cfc45cb86d1.sql | ? | —(não detectado) |
| `public.gen_partner_short_code` | 20260617012032_d0d166d1-50f7-48e7-94fd-c95332930e55.sql | ? | —(não detectado) |
| `public.gen_proposal_token` | 20260614140000_proposal_short_token.sql | ? | —(não detectado) |
| `public.generate_campaign_tracking_protocol` | 20260709021448_2dc26529-50c2-44f5-b220-35d8035a8ecd.sql | DEFINER | public |
| `public.generate_partner_protocol` | 20260709123000_partner_protocol_short_code.sql | DEFINER | public |
| `public.generate_partner_protocol_v2` | 20260710174454_934090b8-6708-4d86-915b-13e9a7db991c.sql | DEFINER | public |
| `public.get_coverage_summary` | 20260407141857_18a76dcc-1c1c-499c-8d60-294affb27a15.sql | DEFINER | 'public' |
| `public.get_managed_consultant_ids` | 20260519171711_927f720c-3ee7-48d3-ac42-c814cfe6169f.sql | DEFINER | public |
| `public.get_platform_pnl` | 20260512094429_4741a7e3-8daa-41b6-8486-55467b2a8c6b.sql | DEFINER | public |
| `public.get_referral_partner_analytics` | 20260527232032_0a177594-26ef-4d53-be79-a12d66916a84.sql | DEFINER | public |
| `public.get_referral_partner_metrics` | 20260710194104_c0efe6ea-7ab7-4c48-a2bd-efd823bf5961.sql | DEFINER | —(não detectado) |
| `public.get_team_consultant_ids` | 20260520161732_86bc8653-c04f-454b-9a31-36abff2b9fb3.sql | DEFINER | public |
| `public.handle_new_consultant_signup` | 20260603225105_124251a0-2d85-4b68-b659-cb737ce08665.sql | DEFINER | —(não detectado) |
| `public.has_role` | 20260401122003_8dfd23de-adaf-4df5-bebe-8b79c618fb60.sql | DEFINER | public AS $$ |
| `public.increment_ab_metric` | 20260515134904_c86f0fed-4e59-4d4a-9c56-a726edad5687.sql | DEFINER | public |
| `public.is_consultant_online` | 20260522180000_consultant_presence.sql | DEFINER | public |
| `public.is_fatal_locked` | 20260604180058_bdd051fd-9fe2-4454-b6eb-f63f08ae5f3a.sql | DEFINER | public |
| `public.is_super_admin` | 20260512132204_0ad55396-7253-4015-a849-79d87c31ce87.sql | DEFINER | public |
| `public.is_team_member` | 20260520161732_86bc8653-c04f-454b-9a31-36abff2b9fb3.sql | DEFINER | public |
| `public.lead_research_sweep_bump` | 20260715123000_lead_research_sweep_bump.sql | DEFINER | public |
| `public.lint_bot_flow_consistency` | 20260712213000_lint_loop_inbound_exempt_conversational.sql | DEFINER | —(não detectado) |
| `public.list_stuck_leads` | 20260524000000_captacao_fluxo_d_conversao.sql | DEFINER | public |
| `public.log_admin_action` | 20260417095057_f3facb48-217f-4579-b9ae-d328c8618b8a.sql | DEFINER | public |
| `public.log_capture_event_if_new` | 20260521010435_0001f667-562b-435e-9f4e-4f86435ca2d7.sql | DEFINER | —(não detectado) |
| `public.log_proposal_status_change` | 20260614100000_proposals.sql | DEFINER | public |
| `public.log_sale_status_change` | 20260614091000_sales.sql | DEFINER | public |
| `public.log_silent_step_reset` | 20260622072138_6918f801-ef30-4c10-b0ba-9cfc45cb86d1.sql | DEFINER | —(não detectado) |
| `public.mark_campaigns_pause_pending` | 20260604212119_88a1c9f2-2197-456b-a444-a620bb668a6f.sql | DEFINER | public |
| `public.mark_lead_needs_reclassify` | 20260613120000_conversion_phrase_catalog.sql | DEFINER | public |
| `public.match_campaigns_by_initial_message` | 20260524100000_captacao_fluxo_d_extensions.sql | DEFINER | public |
| `public.match_knowledge` | 20260606120023_f588b191-c7e7-47cd-888c-e277f732e172.sql | DEFINER | public |
| `public.match_winning` | 20260606120023_f588b191-c7e7-47cd-888c-e277f732e172.sql | DEFINER | public |
| `public.mirror_customer_flow_state_to_customers` | 20260526104500_engine_v3_state_mirror.sql | DEFINER | —(não detectado) |
| `public.next_campaign_protocol_number` | 20260709021448_2dc26529-50c2-44f5-b220-35d8035a8ecd.sql | DEFINER | public |
| `public.normalize_scheduled_voice_campaign` | 20260714144727_fix_voice_scheduled_campaigns.sql | ? | public |
| `public.pause_cadence_on_manual_send` | 20260714040203_7718c2fb-2bd7-4333-a1ae-6b67fcf827e0.sql | DEFINER | public |
| `public.pause_sending_now` | 20260603234827_c1d19c36-6a56-4b94-be8b-163edf6c1e85.sql | DEFINER | public |
| `public.prevent_non_lead_deals` | 20260525150020_2cd1ba5f-357d-4692-8411-371f80b857da.sql | DEFINER | public |
| `public.protect_consultants_approved` | 20260614080000_protect_consultants_approved_column.sql | DEFINER | public |
| `public.publish_flow_as_public` | 20260704170439_cd2a6081-d598-4e95-86ef-7b32427247f8.sql | DEFINER | public |
| `public.reactivation_outcome_by_step` | 20260613140000_conversion_sprint2.sql | DEFINER | public |
| `public.reactivation_outcome_stats` | 20260613140000_conversion_sprint2.sql | DEFINER | public |
| `public.recompute_pos_venda_stages` | 20260707105310_0fa09977-a93b-45c9-b987-ed32f6c8cb1a.sql | DEFINER | —(não detectado) |
| `public.reconcile_stuck_bulk_targets` | 20260712233000_auditoria_agendamentos_claim_rastreio.sql | DEFINER | public |
| `public.reconcile_stuck_scheduled_messages` | 20260712233000_auditoria_agendamentos_claim_rastreio.sql | DEFINER | public |
| `public.record_risk_signal` | 20260603233147_9d679f54-89fa-4a58-a737-5dcf62c69895.sql | DEFINER | public |
| `public.referral_partner_set_short_code` | 20260617012032_d0d166d1-50f7-48e7-94fd-c95332930e55.sql | ? | —(não detectado) |
| `public.refund_consultant_wallet` | 20260512094429_4741a7e3-8daa-41b6-8486-55467b2a8c6b.sql | DEFINER | public |
| `public.register_fatal_disconnect` | 20260604180058_bdd051fd-9fe2-4454-b6eb-f63f08ae5f3a.sql | DEFINER | public |
| `public.register_send` | 20260712233000_auditoria_agendamentos_claim_rastreio.sql | DEFINER | public |
| `public.release_customer_lock` | 20260522045128_23913903-c691-4c18-8dfb-9816d52d43fe.sql | DEFINER | public AS $$ |
| `public.release_customer_processing_lock` | 20260517232744_4ddd0c36-79d4-4d54-94c1-23038becd79b.sql | DEFINER | public |
| `public.remote_support_topic_session` | 20260609120000_remote_support_realtime_authz.sql | ? | public |
| `public.repair_bot_flow` | 20260518030425_037d5750-63b4-4fc8-9cda-ac13c1d335f4.sql | DEFINER | —(não detectado) |
| `public.reserve_media_send` | 20260522045128_23913903-c691-4c18-8dfb-9816d52d43fe.sql | DEFINER | public AS $$ |
| `public.reset_all_consultant_conversations` | 20260519153843_5086d002-a6e6-47be-8600-b2114299f19d.sql | DEFINER | —(não detectado) |
| `public.reset_consultant_analytics` | 20260518145925_7e6a12c2-cf5c-46d1-bab6-37cf97413b08.sql | DEFINER | public |
| `public.reset_lead_conversation` | 20260604133237_ac4b3baa-65af-4a7a-8dee-097a58be7512.sql | DEFINER | —(não detectado) |
| `public.rodizio_assign_lead` | 20260714130000_harden_rodizio_end_to_end.sql | DEFINER | —(não detectado) |
| `public.rodizio_next` | 20260714130000_harden_rodizio_end_to_end.sql | DEFINER | —(não detectado) |
| `public.seed_camila_flow_on_consultant_insert` | 20260515102705_ccba5f9f-2379-473c-b436-fa44c87191f0.sql | DEFINER | public |
| `public.seed_default_camila_flow` | 20260604134931_afb13ad1-bb63-467c-b17e-758f9d3f8168.sql | DEFINER | —(não detectado) |
| `public.seed_flow_d` | 20260523124632_a483497b-9106-47bd-bd0f-0bdac8565f18.sql | DEFINER | —(não detectado) |
| `public.seed_full_objection_pack` | 20260613100000_auto_seed_faq_on_flow_create.sql | DEFINER | public |
| `public.seed_igreen_faq_pack` | 20260601000800_seed_igreen_faq_pack.sql | DEFINER | public |
| `public.seed_objection_shortcut` | 20260518025236_481bcebe-2b84-4d20-a347-394cf55c7e1b.sql | DEFINER | public |
| `public.set_bot_messages_updated_at` | 20260515013320_45b6f597-956b-4939-98f6-d0f033e257f7.sql | ? | public |
| `public.set_customer_flow_variant` | 20260519005353_8aee2d25-38bf-40d6-8c0f-e36f19974013.sql | DEFINER | public |
| `public.set_default_capture_mode` | 20260521024948_675daccc-f483-4125-8acf-dfd8efb53db0.sql | DEFINER | public |
| `public.set_updated_at` | 20260606120023_f588b191-c7e7-47cd-888c-e277f732e172.sql | ? | —(não detectado) |
| `public.set_updated_at_simple` | 20260603233147_9d679f54-89fa-4a58-a737-5dcf62c69895.sql | ? | public AS $$ |
| `public.skip_insert_if_sandbox_customer` | 20260524110100_2203f6e0-f8b7-4be2-b4ac-ac2fc44bcf06.sql | DEFINER | public |
| `public.stamp_pos_venda_approved_at` | 20260613110000_crm_pos_venda_unify.sql | DEFINER | public |
| `public.stuck_leads_grouped_by_step` | 20260524000000_captacao_fluxo_d_conversao.sql | DEFINER | public |
| `public.sweep_orphan_media_reservations` | 20260524103256_a9f13f85-a871-4060-93e1-f38e70a58ced.sql | DEFINER | public |
| `public.sync_customer_flow_state` | 20260524101450_fc837599-9d92-46d8-b5e0-123ac93e9eb1.sql | DEFINER | public |
| `public.sync_customer_flow_state_to_customers` | 20260524110000_customer_flow_state_canonical.sql | ? | —(não detectado) |
| `public.sync_customers_flow_variant_on_consultant_change` | 20260707144233_a3ece776-6b7e-485a-8a1a-6e049e8da140.sql | DEFINER | public |
| `public.sync_data_nascimento_iso` | 20260630034619_5f826da8-ebed-4a9f-a12e-2d9ad7647602.sql | DEFINER | public |
| `public.sync_flow_from_public` | 20260606035434_94633ce4-5ac9-4242-82e3-a9f09b2681da.sql | DEFINER | —(não detectado) |
| `public.sync_pool_active_with_campaign` | 20260714130000_harden_rodizio_end_to_end.sql | DEFINER | —(não detectado) |
| `public.tg_captured_leads_touch` | 20260626163353_fix_captured_leads_touch_search_path.sql | INVOKER | public |
| `public.tg_ensure_sale_stage_progress` | 20260616155831_1d6fe630-f320-45cb-9af3-7629daa95c55.sql | DEFINER | public |
| `public.tg_igreen_endpoint_discovery_touch` | 20260701145602_ffbca27a-c59d-44ee-b758-94c099e942bd.sql | ? | public AS $$ |
| `public.tg_lead_cadence_state_updated_at` | 20260711030849_69ba9d0d-cecc-41bc-88cf-de12256f4dea.sql | ? | public AS $$ |
| `public.tg_lead_insights_touch` | 20260602083147_0a775987-2ada-4730-92b2-f3b41571e758.sql | ? | public AS $$ |
| `public.tg_touch_updated_at` | 20260711121714_aef9b056-9989-441c-9049-6086208dfcc2.sql | ? | public AS $$ |
| `public.touch_flow_variants_updated_at` | 20260606123656_797e35f3-2d11-4d6e-88c3-37635314594d.sql | ? | public AS $$ |
| `public.touch_remote_support_session` | 20260608154852_e5702106-af61-47c4-9668-c83348715e98.sql | ? | public |
| `public.tour_touch_updated_at` | 20260714031517_6b2874e0-83c9-47d9-9e73-34e1eebc497b.sql | ? | public |
| `public.trg_enqueue_knowledge_embed` | 20260606123656_797e35f3-2d11-4d6e-88c3-37635314594d.sql | DEFINER | public AS $$ |
| `public.try_acquire_customer_lock` | 20260522045128_23913903-c691-4c18-8dfb-9816d52d43fe.sql | DEFINER | public AS $$ |
| `public.try_acquire_rate_limit` | 20260522045128_23913903-c691-4c18-8dfb-9816d52d43fe.sql | DEFINER | public AS $$ |
| `public.try_acquire_reconnect_slot` | 20260603233147_9d679f54-89fa-4a58-a737-5dcf62c69895.sql | DEFINER | public |
| `public.try_lock_customer_processing` | 20260517232744_4ddd0c36-79d4-4d54-94c1-23038becd79b.sql | DEFINER | public |
| `public.try_lock_step_dispatch` | 20260605180543_197bdd5c-59b6-45be-ba22-6be6b838e6b3.sql | DEFINER | public |
| `public.try_log_media_send` | 20260523172910_6e05de4b-073d-406f-ad3f-e34069c5a9b7.sql | DEFINER | —(não detectado) |
| `public.update_consultant_pos_venda_media_updated_at` | 20260608235458_56496a48-4395-4873-a5a7-f251852e0e8a.sql | ? | public |
| `public.update_reactivation_outcome_on_inbound` | 20260524000000_captacao_fluxo_d_conversao.sql | DEFINER | public |
| `public.update_reactivation_outcome_on_step_change` | 20260524000000_captacao_fluxo_d_conversao.sql | DEFINER | public |
| `public.update_updated_at_column` | 20260522172941_db3bdbda-f30a-409c-8aeb-03c438321cdd.sql | ? | public AS $$ |
| `public.voice_touch_updated_at` | 20260710221533_6e03cf23-378d-4be5-81a2-bee0f5ef16fe.sql | ? | public AS $$ |

## Triggers

| Migration | Trigger |
|---|---|
| 20260608144340_af1c2cff-474e-4b83-ab70-2b6105603223.sql | `ad_bonus_tiers_updated_at` |
| 20260608125849_a71eb72b-f54b-457f-a553-f5841435f8fd.sql | `audio_library_updated_at` |
| 20260621174626_0bf2c0ac-d14f-4a8c-bc2d-1d5c3088199c.sql | `audit_silent_step_reset` |
| 20260514165453_e717a6d8-d56f-4652-87bb-410180b1a776.sql | `bot_flow_qa_updated` |
| 20260514163323_f5ad187b-4587-47e0-ac15-bc2d491a71df.sql | `bot_flow_steps_updated_at` |
| 20260514163323_f5ad187b-4587-47e0-ac15-bc2d491a71df.sql | `bot_flows_updated_at` |
| 20260626163336_captured_leads_and_consent.sql | `captured_leads_touch` |
| 20260512025857_204bea40-1668-404a-898f-f1d395c98184.sql | `consultant_ad_settings_updated_at` |
| 20260512025857_204bea40-1668-404a-898f-f1d395c98184.sql | `consultant_wallet_updated_at` |
| 20260613120000_conversion_phrase_catalog.sql | `conversations_mark_reclassify` |
| 20260524000000_captacao_fluxo_d_conversao.sql | `conversations_track_reactivation` |
| 20260524110000_customer_flow_state_canonical.sql | `customer_flow_state_updated_at` |
| 20260524000000_captacao_fluxo_d_conversao.sql | `customers_track_reactivation_advance` |
| 20260602083147_0a775987-2ada-4730-92b2-f3b41571e758.sql | `lead_insights_touch` |
| 20260603225105_124251a0-2d85-4b68-b659-cb737ce08665.sql | `on_auth_user_created_consultant` |
| 20260512162643_eff3eea1-5505-4212-85e3-3d1620bcf050.sql | `set_ai_agent_config_updated_at` |
| 20260512162643_eff3eea1-5505-4212-85e3-3d1620bcf050.sql | `set_ai_media_library_updated_at` |
| 20260614110000_consultant_commission_rules.sql | `set_commission_settings_updated_at` |
| 20260613120000_conversion_phrase_catalog.sql | `set_conversion_phrase_catalog_updated_at` |
| 20260329011234_652c743e-463b-455c-81e1-46e301ac7294.sql | `set_crm_deals_updated_at` |
| 20260614110000_consultant_commission_rules.sql | `set_entrada_rules_updated_at` |
| 20260614090000_products_catalog.sql | `set_products_updated_at` |
| 20260614100000_proposals.sql | `set_proposals_updated_at` |
| 20260524000000_captacao_fluxo_d_conversao.sql | `set_reactivation_templates_updated_at` |
| 20260614091000_sales.sql | `set_sales_updated_at` |
| 20260412000001_create_whatsapp_instances.sql | `set_whatsapp_instances_updated_at` |
| 20260714130000_harden_rodizio_end_to_end.sql | `sync_pool_active_with_campaign_trigger` |
| 20260706010024_bd3ded2a-1bc0-49e9-9cca-eaebc236c8e6.sql | `touch_updated_at` |
| 20260714031517_6b2874e0-83c9-47d9-9e73-34e1eebc497b.sql | `tour_articles_updated_at` |
| 20260714031517_6b2874e0-83c9-47d9-9e73-34e1eebc497b.sql | `tour_steps_updated_at` |
| 20260518120032_c8310e20-67eb-4fc7-a7b4-217ea1511b1e.sql | `trg_ad_image_library_updated_at` |
| 20260512104437_55a0c513-7a89-48cd-802f-25b03c4f1150.sql | `trg_ad_templates_updated_at` |
| 20260528131927_35afbdd5-d026-4a8a-a4aa-0ae073c3784b.sql | `trg_apply_force_bot_on_customer_insert` |
| 20260512113056_8219a36d-d5d2-41f7-9dc3-0a6ee6db13b4.sql | `trg_apply_referral_bonus` |
| 20260527225337_7e273787-4dac-4e79-8adb-ef7699666fb7.sql | `trg_assign_flow_variant` |
| 20260709021448_2dc26529-50c2-44f5-b220-35d8035a8ecd.sql | `trg_assign_pool_member_suffix` |
| 20260519135351_04bad528-a0ab-45ee-b700-01c915c9a2f4.sql | `trg_auto_feedback_on_handoff` |
| 20260613100000_auto_seed_faq_on_flow_create.sql | `trg_auto_seed_faq` |
| 20260711121714_aef9b056-9989-441c-9049-6086208dfcc2.sql | `trg_automation_toggles_updated` |
| 20260516024606_0076c8ea-8fd1-4845-8d52-3410a6468944.sql | `trg_bot_flow_rules_updated_at` |
| 20260515102705_ccba5f9f-2379-473c-b436-fa44c87191f0.sql | `trg_bot_flow_steps_updated_at` |
| 20260515102705_ccba5f9f-2379-473c-b436-fa44c87191f0.sql | `trg_bot_flows_updated_at` |
| 20260515013320_45b6f597-956b-4939-98f6-d0f033e257f7.sql | `trg_bot_messages_updated_at` |
| 20260603210318_725836f6-a510-47d6-91ad-594ab165b1c8.sql | `trg_bulk_campaigns_updated` |
| 20260512104437_55a0c513-7a89-48cd-802f-25b03c4f1150.sql | `trg_bump_ad_template_usage` |
| 20260711111546_0d031bcd-564e-4be7-9b3a-b02889025032.sql | `trg_cadence_ensure_state` |
| 20260711111546_0d031bcd-564e-4be7-9b3a-b02889025032.sql | `trg_cadence_on_inbound` |
| 20260604004045_2c3102b7-4c78-4bc3-892e-740d3db9a0a6.sql | `trg_campaign_templates_updated_at` |
| 20260713125415_09df73c8-0f86-435e-866d-0d0b1bc2d5c4.sql | `trg_clear_attendance_auto_close_on_inbound` |
| 20260608012323_65ae50ce-7301-41f5-a165-01a435d69b18.sql | `trg_consultant_network_updated_at` |
| 20260608235458_56496a48-4395-4873-a5a7-f251852e0e8a.sql | `trg_consultant_pos_venda_media_updated_at` |
| 20260711121714_aef9b056-9989-441c-9049-6086208dfcc2.sql | `trg_consultant_templates_updated` |
| 20260524101450_fc837599-9d92-46d8-b5e0-123ac93e9eb1.sql | `trg_create_customer_flow_state` |
| 20260601220741_9b2a2c22-9015-41ca-84ad-9adbb41e89bd.sql | `trg_create_lead_deal` |
| 20260513082043_d6ad47f0-88a4-4298-a965-a6ca0015fdf0.sql | `trg_create_postsale_deal` |
| 20260514102359_9ae39637-729a-4569-bfbf-5be40685241b.sql | `trg_customer_memory_updated_at` |
| 20260521015457_ba923cfa-aad5-4cc9-bd18-8fd4335c330e.sql | `trg_customers_default_capture_mode` |
| 20260521010435_0001f667-562b-435e-9f4e-4f86435ca2d7.sql | `trg_customers_gamify_insert` |
| 20260521010435_0001f667-562b-435e-9f4e-4f86435ca2d7.sql | `trg_customers_gamify_update` |
| 20260715160000_daily_reheat_kit_and_dispatch_gates.sql | `trg_daily_reheat_kit_updated` |
| 20260715150000_daily_reheat_phase0.sql | `trg_daily_reheat_queue_updated` |
| 20260715150000_daily_reheat_phase0.sql | `trg_daily_reheat_settings_updated` |
| 20260711175638_3c9f2207-5b2d-43ed-b180-5f292ff942e4.sql | `trg_enforce_customer_meta_ad_campaign_guard` |
| 20260715200000_enforce_do_not_contact_pause.sql | `trg_enforce_do_not_contact_pause` |
| 20260605235849_c979ebd3-8130-47d0-aa7f-1c942c92d505.sql | `trg_ensure_igreen_connect_code` |
| 20260511154041_ef5a52e3-47d2-49b6-9b3d-5ae18355d72c.sql | `trg_fb_campaigns_updated_at` |
| 20260511172000_b7364f0a-99f2-442f-8043-84156862ee36.sql | `trg_fb_complete_registration` |
| 20260511154041_ef5a52e3-47d2-49b6-9b3d-5ae18355d72c.sql | `trg_fb_connections_updated_at` |
| 20260511154041_ef5a52e3-47d2-49b6-9b3d-5ae18355d72c.sql | `trg_fb_creative_packs_updated_at` |
| 20260511161609_db786993-9de7-4f12-9202-2e7a29aab5a7.sql | `trg_fb_lead` |
| 20260511172000_b7364f0a-99f2-442f-8043-84156862ee36.sql | `trg_fb_lead_on_customer_insert` |
| 20260511161609_db786993-9de7-4f12-9202-2e7a29aab5a7.sql | `trg_fb_purchase` |
| 20260511172000_b7364f0a-99f2-442f-8043-84156862ee36.sql | `trg_fb_purchase_on_customer_active` |
| 20260511161905_dfb85408-5ebe-4dcf-b302-315bf79cdca3.sql | `trg_fb_sync_pixel` |
| 20260517025201_25fd62b9-dd69-471e-81d6-30cf0f050930.sql | `trg_flow_router_rules_updated_at` |
| 20260606123656_797e35f3-2d11-4d6e-88c3-37635314594d.sql | `trg_flow_variants_updated_at` |
| 20260701145602_ffbca27a-c59d-44ee-b758-94c099e942bd.sql | `trg_igreen_endpoint_discovery_touch` |
| 20260606123656_797e35f3-2d11-4d6e-88c3-37635314594d.sql | `trg_knowledge_enqueue_embed` |
| 20260711030849_69ba9d0d-cecc-41bc-88cf-de12256f4dea.sql | `trg_lcs_updated_at` |
| 20260514033150_400679d3-faae-4c33-856e-93d662231fc1.sql | `trg_learned_patterns_updated_at` |
| 20260614100000_proposals.sql | `trg_log_proposal_status_change` |
| 20260614091000_sales.sql | `trg_log_sale_status_change` |
| 20260604212119_88a1c9f2-2197-456b-a444-a620bb668a6f.sql | `trg_mark_campaigns_pause_pending` |
| 20260526104500_engine_v3_state_mirror.sql | `trg_mirror_customer_flow_state` |
| 20260714144727_fix_voice_scheduled_campaigns.sql | `trg_normalize_scheduled_voice_campaign` |
| 20260714040203_7718c2fb-2bd7-4333-a1ae-6b67fcf827e0.sql | `trg_pause_cadence_on_manual_send` |
| 20260525150020_2cd1ba5f-357d-4692-8411-371f80b857da.sql | `trg_prevent_non_lead_deals` |
| 20260614080000_protect_consultants_approved_column.sql | `trg_protect_consultants_approved` |
| 20260603233147_9d679f54-89fa-4a58-a737-5dcf62c69895.sql | `trg_reconnect_cooldowns_updated` |
| 20260615110000_referral_partner_short_code_trigger.sql | `trg_referral_partner_short_code` |
| 20260608154852_e5702106-af61-47c4-9668-c83348715e98.sql | `trg_remote_support_sessions_updated` |
| 20260616155721_af0f9ec1-bffa-4753-8320-3bdf656d0d6d.sql | `trg_sale_stage_progress_updated_at` |
| 20260616155721_af0f9ec1-bffa-4753-8320-3bdf656d0d6d.sql | `trg_sale_stage_templates_updated_at` |
| 20260616155831_1d6fe630-f320-45cb-9af3-7629daa95c55.sql | `trg_sales_ensure_stage_progress` |
| 20260515102705_ccba5f9f-2379-473c-b436-fa44c87191f0.sql | `trg_seed_camila_flow` |
| 20260603233147_9d679f54-89fa-4a58-a737-5dcf62c69895.sql | `trg_send_counters_updated` |
| 20260519005353_8aee2d25-38bf-40d6-8c0f-e36f19974013.sql | `trg_set_customer_flow_variant` |
| 20260524110100_2203f6e0-f8b7-4be2-b4ac-ac2fc44bcf06.sql | `trg_skip_sandbox_` |
| 20260513125047_5583e062-8c42-4ced-9846-c4779a11a264.sql | `trg_slots_updated_at` |
| 20260513102903_63b597d0-2923-461f-bc76-a699f39bf596.sql | `trg_smlog_updated_at` |
| 20260613110000_crm_pos_venda_unify.sql | `trg_stamp_pos_venda_approved_at` |
| 20260524110000_customer_flow_state_canonical.sql | `trg_sync_cfs_to_customers` |
| 20260524101450_fc837599-9d92-46d8-b5e0-123ac93e9eb1.sql | `trg_sync_customer_flow_state` |
| 20260524002443_dfeec792-037c-46f8-a719-910a5525a1f1.sql | `trg_sync_customers_flow_variant` |
| 20260630034619_5f826da8-ebed-4a9f-a12e-2d9ad7647602.sql | `trg_sync_data_nascimento_iso` |
| 20260710173617_000c7560-b356-4f87-9639-669045611069.sql | `trg_sync_pool_active_with_campaign` |
| 20260710000000_voice_dialer_module.sql | `trg_voice_campaigns_updated` |
| 20260710000000_voice_dialer_module.sql | `trg_voice_clips_updated` |
| 20260606120023_f588b191-c7e7-47cd-888c-e277f732e172.sql | `trg_winning_conv_updated_at` |
| 20260620111208_ab8dbf24-723f-479b-85b9-cf2ec3d689b1.sql | `trg_wmtr_updated_at` |
| 20260711111546_0d031bcd-564e-4be7-9b3a-b02889025032.sql | `update_cadence_stage_config_updated_at` |
| 20260608004713_35586b5c-a5f0-4cda-860a-746bbaf16cb1.sql | `update_igreen_extension_tokens_updated_at` |
| 20260706110506_fc2e0f5d-7d69-411f-83b0-aef9e5856c69.sql | `update_igreen_recon_queue_updated_at` |
| 20260714031517_6b2874e0-83c9-47d9-9e73-34e1eebc497b.sql | `user_tour_progress_updated_at` |
| 20260710221533_6e03cf23-378d-4be5-81a2-bee0f5ef16fe.sql | `voice_contact_bases_touch` |
| 20260522172941_db3bdbda-f30a-409c-8aeb-03c438321cdd.sql | `voice_name_clips_set_updated_at` |
| 20260710221533_6e03cf23-378d-4be5-81a2-bee0f5ef16fe.sql | `voice_sms_log_touch` |
| 20260522172941_db3bdbda-f30a-409c-8aeb-03c438321cdd.sql | `voice_templates_set_updated_at` |

## Policies (CREATE) — nomes únicos

Total nomes únicos de policy: **125**

| Policy |
|---|
| `Admin` |
| `Admins` |
| `All` |
| `Allow` |
| `Anon` |
| `Anyone` |
| `Assigned` |
| `Auth` |
| `Authenticated` |
| `Consultant` |
| `Consultants` |
| `Consultor` |
| `Delete` |
| `Insert` |
| `Leader` |
| `Manager` |
| `Only` |
| `Owner` |
| `Owners` |
| `Public` |
| `Read` |
| `Service` |
| `Super` |
| `Update` |
| `Users` |
| `admin` |
| `admin_read_bot_test_outbound` |
| `admin_read_bot_test_runs` |
| `admins` |
| `ai_costs` |
| `app_settings_read_authenticated` |
| `app_settings_read_public_flags` |
| `app_settings_read_super_admin` |
| `app_settings_update_super_admin` |
| `attachments_delete_owner_or_admin` |
| `attachments_insert_owner_or_admin` |
| `attachments_select_owner_or_admin` |
| `attachments_service_all` |
| `auth` |
| `authenticated` |
| `cadence_log_owner_or_admin_read` |
| `cadence_state_owner_or_admin` |
| `consultant` |
| `consultant-photos` |
| `consultant_presence_self_read` |
| `consultant_presence_self_update` |
| `consultant_presence_self_upsert` |
| `consultant_read_own_ad_spend` |
| `consultants` |
| `consultants_own_partners` |
| `delete` |
| `deny` |
| `insert` |
| `logs` |
| `manager` |
| `managers` |
| `owner_can_read_flow_state` |
| `progress_delete_admin` |
| `progress_insert_owner_or_admin` |
| `progress_select_owner_or_admin` |
| `progress_service_all` |
| `progress_update_owner_or_admin` |
| `protocol_seq_read_auth` |
| `read` |
| `remote_support` |
| `requester` |
| `rodizio_assignments_owner_select` |
| `rollout_alerts` |
| `rollout_audit` |
| `rollout_config` |
| `sales_attachments_delete` |
| `sales_attachments_insert` |
| `sales_attachments_select` |
| `sales_attachments_update` |
| `select` |
| `sem` |
| `service` |
| `service_role` |
| `service_role_all` |
| `service_role_full_access` |
| `service_role_full_flow_d_runs` |
| `service_role_full_health_snapshot` |
| `simulator_uploads_authenticated_write` |
| `simulator_uploads_owner_delete` |
| `simulator_uploads_owner_read` |
| `simulator_uploads_public_read` |
| `super` |
| `super_admin` |
| `super_admin_full_access` |
| `super_admin_read_ad_spend` |
| `super_admin_read_capture_diag` |
| `super_admin_read_flow_d_runs` |
| `super_admin_read_health_snapshot` |
| `super_admin_read_infra_metrics` |
| `super_admin_select_digest` |
| `templates_delete_admin` |
| `templates_insert_admin` |
| `templates_select_authenticated` |
| `templates_service_all` |
| `templates_update_admin` |
| `tour_articles` |
| `tour_progress` |
| `tour_steps` |
| `update` |
| `view` |
| `voice_contact_base_items` |
| `voice_contact_bases` |
| `voice_name_clips_delete_own` |
| `voice_name_clips_insert_own` |
| `voice_name_clips_select_own` |
| `voice_name_clips_update_own` |
| `voice_sms_log` |
| `voice_template_blocks_delete_own` |
| `voice_template_blocks_insert_own` |
| `voice_template_blocks_select_own` |
| `voice_template_blocks_update_own` |
| `voice_template_renders_delete_own` |
| `voice_template_renders_insert_own` |
| `voice_template_renders_select_own` |
| `voice_templates_delete_own` |
| `voice_templates_insert_own` |
| `voice_templates_select_own` |
| `voice_templates_update_own` |
| `whatsapp-media` |
| `winning_conv` |

## Tabelas CREATE TABLE (nomes)

Total nomes de tabela em CREATE: **192**

| Tabela | Última migration CREATE |
|---|---|
| `public.ad_account_managers` | 20260519171711_927f720c-3ee7-48d3-ac42-c814cfe6169f.sql |
| `public.ad_bonus_tiers` | 20260608144340_af1c2cff-474e-4b83-ab70-2b6105603223.sql |
| `public.ad_competitor_creatives` | 20260513085911_0efe22d7-cf76-4819-b304-edefe5ccb525.sql |
| `public.ad_creative_insights` | 20260513084747_783da854-38ed-4946-9daa-68da17e268c1.sql |
| `public.ad_creative_performance` | 20260513084747_783da854-38ed-4946-9daa-68da17e268c1.sql |
| `public.ad_generated_creatives` | 20260513093148_f9f81750-f255-48b2-a48c-d2dc98c59943.sql |
| `public.ad_image_library` | 20260518120032_c8310e20-67eb-4fc7-a7b4-217ea1511b1e.sql |
| `public.ad_image_validations` | 20260512134358_f62032cd-071e-4771-af56-cb489006f30c.sql |
| `public.ad_playbooks` | 20260513235821_fb8cdd4f-ae77-4315-aff6-f2baa309d73b.sql |
| `public.ad_recommendations` | 20260513084747_783da854-38ed-4946-9daa-68da17e268c1.sql |
| `public.ad_spend_daily` | 20260519170015_20f3d510-2f5f-46b7-8d2f-c4ad3278ba62.sql |
| `public.ad_template_usages` | 20260512104437_55a0c513-7a89-48cd-802f-25b03c4f1150.sql |
| `public.ad_templates` | 20260512104437_55a0c513-7a89-48cd-802f-25b03c4f1150.sql |
| `public.ad_video_library` | 20260603122019_6e297a31-9100-47fe-ab6b-e7f1653521b3.sql |
| `public.admin_audit_log` | 20260417095057_f3facb48-217f-4579-b9ae-d328c8618b8a.sql |
| `public.ai_agent_config` | 20260512162643_eff3eea1-5505-4212-85e3-3d1620bcf050.sql |
| `public.ai_agent_logs` | 20260512162643_eff3eea1-5505-4212-85e3-3d1620bcf050.sql |
| `public.ai_agent_slots` | 20260513125047_5583e062-8c42-4ced-9846-c4779a11a264.sql |
| `public.ai_cooldown_state` | 20260522045128_23913903-c691-4c18-8dfb-9816d52d43fe.sql |
| `public.ai_costs` | 20260524003714_296b483f-d702-4e88-bd22-9191af4c99ce.sql |
| `public.ai_decisions` | 20260512203336_0a23ab36-7e4e-4973-8f12-b42d9f130207.sql |
| `public.ai_knowledge_sections` | 20260408032106_21f4d78e-5448-4004-9dfc-449d6baa896c.sql |
| `public.ai_learned_patterns` | 20260514033150_400679d3-faae-4c33-856e-93d662231fc1.sql |
| `public.ai_learning_digest` | 20260514005752_04156f77-f439-4c9e-b19c-674d608d90e0.sql |
| `public.ai_media_library` | 20260512162643_eff3eea1-5505-4212-85e3-3d1620bcf050.sql |
| `public.ai_slot_dispatch_log` | 20260513125047_5583e062-8c42-4ced-9846-c4779a11a264.sql |
| `public.ai_usage_log` | 20260513235821_fb8cdd4f-ae77-4315-aff6-f2baa309d73b.sql |
| `public.ai_winning_conversations` | 20260606120023_f588b191-c7e7-47cd-888c-e277f732e172.sql |
| `public.app_settings` | 20260521114800_b75751cc-943f-44d7-9764-ece71aedf165.sql |
| `public.audio_library` | 20260608125849_a71eb72b-f54b-457f-a553-f5841435f8fd.sql |
| `public.audit_log` | 20260524000000_captacao_fluxo_d_conversao.sql |
| `public.automation_skip_log` | 20260712233000_auditoria_agendamentos_claim_rastreio.sql |
| `public.automation_toggles` | 20260711121714_aef9b056-9989-441c-9049-6086208dfcc2.sql |
| `public.bot_flow_audit_log` | 20260530104526_0dccbc4f-e3f1-4922-a965-8846b12086ed.sql |
| `public.bot_flow_qa` | 20260514165453_e717a6d8-d56f-4652-87bb-410180b1a776.sql |
| `public.bot_flow_qa_media` | 20260514165453_e717a6d8-d56f-4652-87bb-410180b1a776.sql |
| `public.bot_flow_qa_triggers` | 20260514165453_e717a6d8-d56f-4652-87bb-410180b1a776.sql |
| `public.bot_flow_rule_fires` | 20260516024606_0076c8ea-8fd1-4845-8d52-3410a6468944.sql |
| `public.bot_flow_rules` | 20260516024606_0076c8ea-8fd1-4845-8d52-3410a6468944.sql |
| `public.bot_flow_steps` | 20260514163323_f5ad187b-4587-47e0-ac15-bc2d491a71df.sql |
| `public.bot_flows` | 20260514163323_f5ad187b-4587-47e0-ac15-bc2d491a71df.sql |
| `public.bot_handoff_alerts` | 20260515134904_c86f0fed-4e59-4d4a-9c56-a726edad5687.sql |
| `public.bot_message_ab_results` | 20260515134904_c86f0fed-4e59-4d4a-9c56-a726edad5687.sql |
| `public.bot_messages` | 20260515013320_45b6f597-956b-4939-98f6-d0f033e257f7.sql |
| `public.bot_step_transitions` | 20260417095057_f3facb48-217f-4579-b9ae-d328c8618b8a.sql |
| `public.bot_test_outbound` | 20260515204820_a321d38b-d42e-46cd-ab2a-5f5ab92011fd.sql |
| `public.bot_test_runs` | 20260515204820_a321d38b-d42e-46cd-ab2a-5f5ab92011fd.sql |
| `public.br_municipios` | 20260715150000_create_br_municipios.sql |
| `public.bulk_campaign_targets` | 20260603210318_725836f6-a510-47d6-91ad-594ab165b1c8.sql |
| `public.bulk_campaigns` | 20260603210318_725836f6-a510-47d6-91ad-594ab165b1c8.sql |
| `public.cadence_action_log` | 20260711030849_69ba9d0d-cecc-41bc-88cf-de12256f4dea.sql |
| `public.cadence_stage_config` | 20260711111546_0d031bcd-564e-4be7-9b3a-b02889025032.sql |
| `public.campaign_match_log` | 20260524000000_captacao_fluxo_d_conversao.sql |
| `public.campaign_protocol_sequence` | 20260709021448_2dc26529-50c2-44f5-b220-35d8035a8ecd.sql |
| `public.campaign_templates` | 20260604004045_2c3102b7-4c78-4bc3-892e-740d3db9a0a6.sql |
| `public.capture_achievements` | 20260520013554_7d90cb3a-2bd0-4431-b369-6ca1332e238c.sql |
| `public.capture_diagnostics` | 20260519170015_20f3d510-2f5f-46b7-8d2f-c4ad3278ba62.sql |
| `public.capture_field_events` | 20260520013554_7d90cb3a-2bd0-4431-b369-6ca1332e238c.sql |
| `public.capture_field_suggestions` | 20260520014326_7627c9c9-bc5e-4ce4-b9cb-cff6fe47831d.sql |
| `public.capture_scoreboard` | 20260520013554_7d90cb3a-2bd0-4431-b369-6ca1332e238c.sql |
| `public.captured_leads` | 20260626163336_captured_leads_and_consent.sql |
| `public.consultant_ad_settings` | 20260512025857_204bea40-1668-404a-898f-f1d395c98184.sql |
| `public.consultant_commission_settings` | 20260614110000_consultant_commission_rules.sql |
| `public.consultant_entrada_rules` | 20260614110000_consultant_commission_rules.sql |
| `public.consultant_message_templates` | 20260711121714_aef9b056-9989-441c-9049-6086208dfcc2.sql |
| `public.consultant_network` | 20260608012323_65ae50ce-7301-41f5-a165-01a435d69b18.sql |
| `public.consultant_pos_venda_media` | 20260608235458_56496a48-4395-4873-a5a7-f251852e0e8a.sql |
| `public.consultant_presence` | 20260522180000_consultant_presence.sql |
| `public.consultant_wallet` | 20260512025857_204bea40-1668-404a-898f-f1d395c98184.sql |
| `public.consultants` | 20260326121425_6d1a39bb-6d7c-4085-9a8d-20a968d58560.sql |
| `public.contact_suppression_log` | 20260715190000_contact_suppression_log.sql |
| `public.conversion_phrase_catalog` | 20260613120000_conversion_phrase_catalog.sql |
| `public.crm_auto_message_log` | 20260406000749_e502fa45-f138-4dbd-a1ce-e989d2d253ad.sql |
| `public.crm_deals` | 20260329011234_652c743e-463b-455c-81e1-46e301ac7294.sql |
| `public.crm_page_events` | 20260410152448_3d4a5f77-fa56-40d3-9dd7-2a43bc1ef0c1.sql |
| `public.ctwa_clid_mapping` | 20260611000000_ctwa_clid_mapping.sql |
| `public.ctwa_referral_probe_log` | 20260711024820_63c0148c-c385-4b69-bd48-25196cfc790e.sql |
| `public.customer_auto_message_log` | 20260608034426_b8d864a1-7abc-4775-ae6e-15ed23e511d8.sql |
| `public.customer_flow_state` | 20260524110000_customer_flow_state_canonical.sql |
| `public.customer_memory` | 20260514102359_9ae39637-729a-4569-bfbf-5be40685241b.sql |
| `public.customer_processing_lock` | 20260522045128_23913903-c691-4c18-8dfb-9816d52d43fe.sql |
| `public.customer_tags` | 20260329011234_652c743e-463b-455c-81e1-46e301ac7294.sql |
| `public.daily_reheat_kit` | 20260715160000_daily_reheat_kit_and_dispatch_gates.sql |
| `public.daily_reheat_queue` | 20260715150000_daily_reheat_phase0.sql |
| `public.daily_reheat_runs` | 20260715150000_daily_reheat_phase0.sql |
| `public.daily_reheat_settings` | 20260715150000_daily_reheat_phase0.sql |
| `public.engine_logs` | 20260526013928_engine_v3_schema.sql |
| `public.facebook_ad_metrics_daily` | 20260528051412_d3eca129-2e37-47fd-ae04-db6e772a14a1.sql |
| `public.facebook_campaigns` | 20260511154041_ef5a52e3-47d2-49b6-9b3d-5ae18355d72c.sql |
| `public.facebook_capi_events` | 20260511154041_ef5a52e3-47d2-49b6-9b3d-5ae18355d72c.sql |
| `public.facebook_connections` | 20260511154041_ef5a52e3-47d2-49b6-9b3d-5ae18355d72c.sql |
| `public.facebook_creative_packs` | 20260511154041_ef5a52e3-47d2-49b6-9b3d-5ae18355d72c.sql |
| `public.facebook_metrics_daily` | 20260511154041_ef5a52e3-47d2-49b6-9b3d-5ae18355d72c.sql |
| `public.fb_city_cache` | 20260511235823_cc790621-bbec-43d0-9c92-0d40a468a340.sql |
| `public.flow_d_health_runs` | 20260527225337_7e273787-4dac-4e79-8adb-ef7699666fb7.sql |
| `public.flow_router_rules` | 20260517025201_25fd62b9-dd69-471e-81d6-30cf0f050930.sql |
| `public.flow_variants` | 20260606123656_797e35f3-2d11-4d6e-88c3-37635314594d.sql |
| `public.force_bot_phones` | 20260528131927_35afbdd5-d026-4a8a-a4aa-0ae073c3784b.sql |
| `public.gemini_quota_bucket` | 20260522045128_23913903-c691-4c18-8dfb-9816d52d43fe.sql |
| `public.holidays` | 20260601000100_business_hours_and_holidays.sql |
| `public.igreen_bulk_sync_state` | 20260706010024_bd3ded2a-1bc0-49e9-9cca-eaebc236c8e6.sql |
| `public.igreen_endpoint_discovery` | 20260701145602_ffbca27a-c59d-44ee-b758-94c099e942bd.sql |
| `public.igreen_extension_tokens` | 20260608004713_35586b5c-a5f0-4cda-860a-746bbaf16cb1.sql |
| `public.igreen_network_snapshots` | 20260706010024_bd3ded2a-1bc0-49e9-9cca-eaebc236c8e6.sql |
| `public.igreen_recon_queue` | 20260706110506_fc2e0f5d-7d69-411f-83b0-aef9e5856c69.sql |
| `public.igreen_recon_routes` | 20260706103138_05f7ab0c-efb8-4037-b18c-30e6ac99efe3.sql |
| `public.igreen_seguros_comissoes` | 20260706010024_bd3ded2a-1bc0-49e9-9cca-eaebc236c8e6.sql |
| `public.igreen_sync_runs` | 20260701204454_d6c833f6-12cd-4109-8aad-0aecae1a0692.sql |
| `public.igreen_telecom_comissoes` | 20260706010024_bd3ded2a-1bc0-49e9-9cca-eaebc236c8e6.sql |
| `public.igreen_telecom_faturas` | 20260706010024_bd3ded2a-1bc0-49e9-9cca-eaebc236c8e6.sql |
| `public.igreen_telecom_linhas` | 20260706010024_bd3ded2a-1bc0-49e9-9cca-eaebc236c8e6.sql |
| `public.inbound_media_failures` | 20260522045128_23913903-c691-4c18-8dfb-9816d52d43fe.sql |
| `public.inbound_media_retry` | 20260522045128_23913903-c691-4c18-8dfb-9816d52d43fe.sql |
| `public.infra_metrics` | 20260521125617_decf3d9a-e57b-40a7-9cfa-f8eae722ebd8.sql |
| `public.instance_reconnect_cooldowns` | 20260603233147_9d679f54-89fa-4a58-a737-5dcf62c69895.sql |
| `public.instance_risk_signals` | 20260603233147_9d679f54-89fa-4a58-a737-5dcf62c69895.sql |
| `public.instance_send_counters` | 20260603233147_9d679f54-89fa-4a58-a737-5dcf62c69895.sql |
| `public.kanban_stages` | 20260329014149_0ba38498-ab39-4124-9309-3f63c301e062.sql |
| `public.lead_cadence_state` | 20260711030849_69ba9d0d-cecc-41bc-88cf-de12256f4dea.sql |
| `public.lead_consent_log` | 20260626163336_captured_leads_and_consent.sql |
| `public.lead_insights` | 20260602083147_0a775987-2ada-4730-92b2-f3b41571e758.sql |
| `public.lead_research_sweep_cities` | 20260715120000_lead_research_sweep.sql |
| `public.lead_research_sweeps` | 20260715120000_lead_research_sweep.sql |
| `public.message_templates` | create_whatsapp_tables.sql |
| `public.network_members` | 20260407133545_28f31518-a478-4d5c-996b-392a833ca697.sql |
| `public.outbound_blocked_log` | 20260625235027_a06b6bd1-84fd-4621-bcc1-8b8612766a2e.sql |
| `public.outbound_message_log` | 20260522045128_23913903-c691-4c18-8dfb-9816d52d43fe.sql |
| `public.page_events` | 20260326180903_0cbdbe55-253b-448e-ae9d-6b1545e9b7e1.sql |
| `public.page_views` | 20260326171318_461fa13d-bb7f-41e1-9b40-f40988186b00.sql |
| `public.partner_protocol_seq` | 20260709093943_d8ecf44d-fe07-44d8-9900-69128c101752.sql |
| `public.pending_outbound_media` | 20260522045128_23913903-c691-4c18-8dfb-9816d52d43fe.sql |
| `public.phone_reset_quarantine` | 20260607175337_34be38ea-685a-42f2-b872-8eff25710b81.sql |
| `public.platform_facebook_account` | 20260512025857_204bea40-1668-404a-898f-f1d395c98184.sql |
| `public.platform_settings` | 20260512094429_4741a7e3-8daa-41b6-8486-55467b2a8c6b.sql |
| `public.proactive_touch_log` | 20260713140000_retention_orchestrator_foundation.sql |
| `public.production_health_snapshot` | 20260527225337_7e273787-4dac-4e79-8adb-ef7699666fb7.sql |
| `public.products` | 20260614090000_products_catalog.sql |
| `public.proposal_events` | 20260614100000_proposals.sql |
| `public.proposals` | 20260614100000_proposals.sql |
| `public.reactivation_sends` | 20260524000000_captacao_fluxo_d_conversao.sql |
| `public.reactivation_settings` | 20260613120000_conversion_phrase_catalog.sql |
| `public.reactivation_templates` | 20260524000000_captacao_fluxo_d_conversao.sql |
| `public.referral_bonuses` | 20260512113056_8219a36d-d5d2-41f7-9dc3-0a6ee6db13b4.sql |
| `public.referral_partners` | 20260526140000_referral_partners.sql |
| `public.remote_support_codes` | 20260608154852_e5702106-af61-47c4-9668-c83348715e98.sql |
| `public.remote_support_logs` | 20260608154852_e5702106-af61-47c4-9668-c83348715e98.sql |
| `public.remote_support_sessions` | 20260608154852_e5702106-af61-47c4-9668-c83348715e98.sql |
| `public.retention_settings` | 20260713140000_retention_orchestrator_foundation.sql |
| `public.rodizio_assignments` | 20260714130000_harden_rodizio_end_to_end.sql |
| `public.rollout_alerts` | 20260524104130_700ab26d-2ce2-45ec-9154-de6352d70e93.sql |
| `public.rollout_audit` | 20260524104130_700ab26d-2ce2-45ec-9154-de6352d70e93.sql |
| `public.rollout_config` | 20260524104130_700ab26d-2ce2-45ec-9154-de6352d70e93.sql |
| `public.sale_stage_attachments` | 20260616155721_af0f9ec1-bffa-4753-8320-3bdf656d0d6d.sql |
| `public.sale_stage_progress` | 20260616155721_af0f9ec1-bffa-4753-8320-3bdf656d0d6d.sql |
| `public.sale_stage_templates` | 20260616155721_af0f9ec1-bffa-4753-8320-3bdf656d0d6d.sql |
| `public.sale_status_history` | 20260614091000_sales.sql |
| `public.sales` | 20260614091000_sales.sql |
| `public.scheduled_messages` | 20260329011234_652c743e-463b-455c-81e1-46e301ac7294.sql |
| `public.settings` | 20260519124511_5733cb9f-d714-4221-b9ef-ba7b23c40861.sql |
| `public.silent_step_reset_log` | 20260621174626_0bf2c0ac-d14f-4a8c-bc2d-1d5c3088199c.sql |
| `public.solar_api_usage_log` | 20260624120000_solar_3d_module.sql |
| `public.solar_design_snapshots` | 20260624120000_solar_3d_module.sql |
| `public.solar_public_rate_limit` | 20260624120000_solar_3d_module.sql |
| `public.solar_roof_analyses` | 20260624120000_solar_3d_module.sql |
| `public.stage_auto_messages` | 20260403181326_2bccbe1d-7331-4b7d-8a23-7ce7da6d9301.sql |
| `public.storage_migration_log` | 20260513102903_63b597d0-2923-461f-bc76-a699f39bf596.sql |
| `public.tour_articles` | 20260714031517_6b2874e0-83c9-47d9-9e73-34e1eebc497b.sql |
| `public.tour_steps` | 20260714031517_6b2874e0-83c9-47d9-9e73-34e1eebc497b.sql |
| `public.user_roles` | 20260401122003_8dfd23de-adaf-4df5-bebe-8b79c618fb60.sql |
| `public.user_tour_progress` | 20260714031517_6b2874e0-83c9-47d9-9e73-34e1eebc497b.sql |
| `public.voice_audio_clips` | 20260710000000_voice_dialer_module.sql |
| `public.voice_call_logs` | 20260710000000_voice_dialer_module.sql |
| `public.voice_campaign_targets` | 20260710000000_voice_dialer_module.sql |
| `public.voice_campaigns` | 20260710000000_voice_dialer_module.sql |
| `public.voice_contact_base_items` | 20260710221533_6e03cf23-378d-4be5-81a2-bee0f5ef16fe.sql |
| `public.voice_contact_bases` | 20260710222137_47632922-279f-49ab-9448-b89383a51b6b.sql |
| `public.voice_dnc_list` | 20260710224115_cf9b7a7a-8629-4d03-b67d-81e5f0c18524.sql |
| `public.voice_name_clips` | 20260522172941_db3bdbda-f30a-409c-8aeb-03c438321cdd.sql |
| `public.voice_sms_log` | 20260710221533_6e03cf23-378d-4be5-81a2-bee0f5ef16fe.sql |
| `public.voice_template_blocks` | 20260522172941_db3bdbda-f30a-409c-8aeb-03c438321cdd.sql |
| `public.voice_template_renders` | 20260522172941_db3bdbda-f30a-409c-8aeb-03c438321cdd.sql |
| `public.voice_templates` | 20260522172941_db3bdbda-f30a-409c-8aeb-03c438321cdd.sql |
| `public.wallet_manual_topup_requests` | 20260620111208_ab8dbf24-723f-479b-85b9-cf2ec3d689b1.sql |
| `public.wallet_transactions` | 20260512025857_204bea40-1668-404a-898f-f1d395c98184.sql |
| `public.webhook_message_dedup` | 20260417095057_f3facb48-217f-4579-b9ae-d328c8618b8a.sql |
| `public.webhook_message_dedupe` | 20260516032122_afbae02b-8f0a-402a-ae2c-e18a6f9f3b68.sql |
| `public.webhook_rate_limit` | 20260522045128_23913903-c691-4c18-8dfb-9816d52d43fe.sql |
| `public.whapi_send_throttle` | 20260713165235_whapi_send_throttle_claim_slot.sql |
| `public.whatsapp_instances` | create_whatsapp_tables.sql |
| `public.whatsapp_message_buffer` | 20260515134904_c86f0fed-4e59-4d4a-9c56-a726edad5687.sql |
| `public.worker_phase_logs` | 20260418004119_fbc240d8-586c-4ad0-9db9-71fa6a4136c4.sql |
| `whatsapp_instances` | 20260412000001_create_whatsapp_instances.sql |

## cron.schedule

| Migration | Job name |
|---|---|
| 20260329015759_819014c5-5ab1-4955-af0d-917ca7623839.sql | `crm-auto-progress-daily` |
| 20260330155339_39b28533-a2d3-4520-8483-27f80b2fb6a6.sql | `sync-igreen-customers-daily` |
| 20260330164754_71ec10ee-b470-42dc-8330-bb3e4c9d2ad1.sql | `crm-auto-progress-daily` |
| 20260406022403_e190486c-e380-46d3-ae7e-0499c9d7df9c.sql | `send-scheduled-messages-every-5min` |
| 20260415033536_8b1fb686-52cf-473b-9588-0b86c6ba798f.sql | `sync-igreen-customers-daily` |
| 20260417095057_f3facb48-217f-4579-b9ae-d328c8618b8a.sql | `cleanup-webhook-dedup` |
| 20260417100933_8c761bc2-2a12-438a-aa7e-a0e91ca85f4b.sql | `recover-stuck-otp-daily` |
| 20260423172342_012c70ac-0392-43a0-8d16-49e3862c5224.sql | `bot-stuck-recovery-30min` |
| 20260423173256_b1a8e5c1-33ee-4a8e-9f30-e72fad3a5c39.sql | `bot-stuck-recovery-5min` |
| 20260511161609_db786993-9de7-4f12-9202-2e7a29aab5a7.sql | `fb-sync-metrics` |
| 20260511161609_db786993-9de7-4f12-9202-2e7a29aab5a7.sql | `fb-token-refresh` |
| 20260512102823_2a4bf52b-1d4d-4160-8a1f-bcf2379d7bc7.sql | `fb-sync-audiences-daily` |
| 20260512204100_a0a19ed6-c1aa-456b-83a2-08126dfa591d.sql | `ai-followup-cron-15min` |
| 20260513091617_7a883661-59bb-45f1-92b8-510efd7e7db0.sql | `ad-competitor-scraper-weekly` |
| 20260513091617_7a883661-59bb-45f1-92b8-510efd7e7db0.sql | `ad-creative-learner-daily` |
| 20260513091617_7a883661-59bb-45f1-92b8-510efd7e7db0.sql | `facebook-creative-rotator-daily` |
| 20260513103133_e743dd07-5625-464a-a5a3-cbfa293cabc7.sql | `migrate-storage-to-minio` |
| 20260514000734_4b13937d-b58e-4327-9be1-c64740956927.sql | `ai-closer-cron-every-10min` |
| 20260514010445_ad05e0af-e28a-4304-835f-82395c23bd3f.sql | `ai-daily-digest-09brt` |
| 20260514010445_ad05e0af-e28a-4304-835f-82395c23bd3f.sql | `ai-cpl-watchdog-4h` |
| 20260515134904_c86f0fed-4e59-4d4a-9c56-a726edad5687.sql | `cleanup-webhook-artifacts` |
| 20260515135332_18dabbf4-51a1-41ce-bbcc-ec8052ad09fa.sql | `bot-followup-checker-30min` |
| 20260516032122_afbae02b-8f0a-402a-ae2c-e18a6f9f3b68.sql | `cleanup-webhook-dedupe` |
| 20260518031604_13fa9b80-afb2-4b1b-a74a-288fa743e614.sql | `bot-loop-watchdog-15m` |
| 20260519134832_54e13a3a-1e80-441c-a8ea-19c7ed8ade14.sql | `ai-learn-feedback-daily` |
| 20260524103000_inbound_media_retry_cron.sql | `inbound-media-retry-cron-1min` |
| 20260524104130_700ab26d-2ce2-45ec-9154-de6352d70e93.sql | `flow-engine-rollout-tick` |
| 20260525154104_6667c15c-8076-41d8-afdf-8fb97c9b35bb.sql | `ocr-review-timeout-every-min` |
| 20260525164516_f33532d5-0b85-4931-b654-f43a8b8afaa2.sql | `pos-venda-bucket-cron-daily` |
| 20260526191041_15c7be29-53e6-4d09-a3e5-3afad5a29c3d.sql | `flow_engine_housekeeping_daily` |
| 20260527230716_c90cfe0c-dae4-4daf-9b6e-248e85717a15.sql | `production-health-snapshot-5min` |
| 20260527230716_c90cfe0c-dae4-4daf-9b6e-248e85717a15.sql | `instance-health-cron-10min` |
| 20260527230716_c90cfe0c-dae4-4daf-9b6e-248e85717a15.sql | `flow-d-health-cron-30min` |
| 20260528045032_3bacecbb-9b00-457d-bcb3-50cddb15a980.sql | `fb-sync-ad-creatives` |
| 20260528045409_078c6bc6-fd40-4e3d-a883-7be2d0be3d4e.sql | `fb-sync-ad-creatives` |
| 20260531133657_863a5ecb-8320-4ba6-a489-a5423adfc1df.sql | `minio-quota-check` |
| 20260531133657_863a5ecb-8320-4ba6-a489-a5423adfc1df.sql | `super-admin-alerts` |
| 20260531133657_863a5ecb-8320-4ba6-a489-a5423adfc1df.sql | `instance-health-cron` |
| 20260603215010_eaa15c55-e820-4126-8ead-19481a007813.sql | `bulk-scheduler-tick` |
| 20260613100200_faq_reengagement_nudge_cron.sql | `faq-reengagement-nudge-5min` |
| 20260613140000_conversion_sprint2.sql | `conversion-classifier-15min` |
| 20260613150000_conversion_classifier_daily.sql | `conversion-classifier-daily` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `bulk-scheduler-tick` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `inbound-media-retry-cron-1min` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `fb-token-refresh` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `bot-stuck-recovery-hourly` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `bot-followup-checker-daily` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `bot-loop-watchdog-hourly` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `ocr-review-timeout-every-5min` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `production-health-snapshot-hourly` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `instance-health-cron-30min` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `flow-d-health-cron-hourly` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `faq-reengagement-nudge-30min` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `ai-cpl-watchdog-daily` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `fb-sync-metrics-6h` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `fb-sync-ad-creatives-daily` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `minio-quota-check-daily` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `super-admin-alerts-hourly` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `conversion-classifier-daily` |
| 20260709150000_rodizio_quiet_hours_cron_10m.sql | `rodizio-metrics-10m` |
| 20260709153056_portal_otp_watchdog_cron_1m.sql | `portal-otp-watchdog-1m` |
| 20260710000000_voice_dialer_module.sql | `voice-dialer-tick` |
| 20260710010000_voice_dialer_cron_auth.sql | `voice-dialer-tick` |
| 20260710020000_voice_dialer_cron_secret.sql | `voice-dialer-tick` |
| 20260712234500_auditoria_agendamentos_pg_cron_jobs.sql | `process-followups-tick` |
| 20260712234500_auditoria_agendamentos_pg_cron_jobs.sql | `cadence-tick-5min` |
| 20260712234500_auditoria_agendamentos_pg_cron_jobs.sql | `reactivation-cron-hourly` |
| 20260712234500_auditoria_agendamentos_pg_cron_jobs.sql | `pos-venda-auto-progress-daily` |
| 20260712234500_auditoria_agendamentos_pg_cron_jobs.sql | `close-attendance-scheduled-5min` |
| 20260713100000_voice_dialer_cron_secret_from_settings.sql | `voice-dialer-tick` |
| 20260713140000_retention_orchestrator_foundation.sql | `speed-to-lead-check-5min` |
| 20260715150000_daily_reheat_phase0.sql | `daily-reheat-tick` |

## net.http_post (referências)

| Migration | URL / nota (truncada) |
|---|---|
| 20260330155339_39b28533-a2d3-4520-8483-27f80b2fb6a6.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/sync-igreen-customers` |
| 20260330164754_71ec10ee-b470-42dc-8330-bb3e4c9d2ad1.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/crm-auto-progress` |
| 20260330164754_71ec10ee-b470-42dc-8330-bb3e4c9d2ad1.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/crm-auto-progress` |
| 20260406022403_e190486c-e380-46d3-ae7e-0499c9d7df9c.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/send-scheduled-messages` |
| 20260415033536_8b1fb686-52cf-473b-9588-0b86c6ba798f.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/sync-igreen-customers` |
| 20260417100933_8c761bc2-2a12-438a-aa7e-a0e91ca85f4b.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/recover-stuck-otp` |
| 20260423172342_012c70ac-0392-43a0-8d16-49e3862c5224.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/bot-stuck-recovery` |
| 20260423173256_b1a8e5c1-33ee-4a8e-9f30-e72fad3a5c39.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/bot-stuck-recovery` |
| 20260511161609_db786993-9de7-4f12-9202-2e7a29aab5a7.sql | `(url dinâmica)` |
| 20260511161609_db786993-9de7-4f12-9202-2e7a29aab5a7.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/facebook-sync-metrics` |
| 20260511161609_db786993-9de7-4f12-9202-2e7a29aab5a7.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/facebook-token-refresh` |
| 20260512102823_2a4bf52b-1d4d-4160-8a1f-bcf2379d7bc7.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/facebook-sync-audiences` |
| 20260512204100_a0a19ed6-c1aa-456b-83a2-08126dfa591d.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/ai-followup-cron` |
| 20260513091617_7a883661-59bb-45f1-92b8-510efd7e7db0.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/ad-competitor-scraper` |
| 20260513091617_7a883661-59bb-45f1-92b8-510efd7e7db0.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/ad-creative-learner` |
| 20260513091617_7a883661-59bb-45f1-92b8-510efd7e7db0.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/facebook-creative-rotator` |
| 20260513103133_e743dd07-5625-464a-a5a3-cbfa293cabc7.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/migrate-supabase-to-minio` |
| 20260514000734_4b13937d-b58e-4327-9be1-c64740956927.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/ai-closer-cron` |
| 20260514010445_ad05e0af-e28a-4304-835f-82395c23bd3f.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/ai-daily-digest` |
| 20260514010445_ad05e0af-e28a-4304-835f-82395c23bd3f.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/ai-cpl-watchdog` |
| 20260515135332_18dabbf4-51a1-41ce-bbcc-ec8052ad09fa.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/bot-followup-checker` |
| 20260518031604_13fa9b80-afb2-4b1b-a74a-288fa743e614.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/bot-loop-watchdog` |
| 20260519134832_54e13a3a-1e80-441c-a8ea-19c7ed8ade14.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/ai-learn-feedback` |
| 20260524103000_inbound_media_retry_cron.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/inbound-media-retry-cron` |
| 20260524104130_700ab26d-2ce2-45ec-9154-de6352d70e93.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/flow-engine-rollout-cron` |
| 20260525154104_6667c15c-8076-41d8-afdf-8fb97c9b35bb.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/ocr-review-timeout` |
| 20260525164516_f33532d5-0b85-4931-b654-f43a8b8afaa2.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/pos-venda-bucket-cron` |
| 20260527230716_c90cfe0c-dae4-4daf-9b6e-248e85717a15.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/production-health-snapshot` |
| 20260527230716_c90cfe0c-dae4-4daf-9b6e-248e85717a15.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/instance-health-cron` |
| 20260527230716_c90cfe0c-dae4-4daf-9b6e-248e85717a15.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/flow-d-health-cron` |
| 20260528045032_3bacecbb-9b00-457d-bcb3-50cddb15a980.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/facebook-sync-ad-creatives` |
| 20260528045409_078c6bc6-fd40-4e3d-a883-7be2d0be3d4e.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/facebook-sync-ad-creatives` |
| 20260531133657_863a5ecb-8320-4ba6-a489-a5423adfc1df.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/minio-quota-check` |
| 20260531133657_863a5ecb-8320-4ba6-a489-a5423adfc1df.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/super-admin-alerts` |
| 20260531133657_863a5ecb-8320-4ba6-a489-a5423adfc1df.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/instance-health-cron` |
| 20260603215010_eaa15c55-e820-4126-8ead-19481a007813.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/bulk-scheduler` |
| 20260606123656_797e35f3-2d11-4d6e-88c3-37635314594d.sql | `(url dinâmica)` |
| 20260613100200_faq_reengagement_nudge_cron.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/faq-reengagement-nudge` |
| 20260613140000_conversion_sprint2.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/lead-temperature-classifie` |
| 20260613150000_conversion_classifier_daily.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/lead-temperature-classifie` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/bulk-scheduler` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/inbound-media-retry-cron` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/facebook-token-refresh` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/bot-stuck-recovery` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/bot-followup-checker` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/bot-loop-watchdog` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/ocr-review-timeout` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/production-health-snapshot` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/instance-health-cron` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/flow-d-health-cron` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/faq-reengagement-nudge` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/ai-cpl-watchdog` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/facebook-sync-metrics` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/facebook-sync-ad-creatives` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/minio-quota-check` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/super-admin-alerts` |
| 20260708014208_43f43fba-871a-4894-a2c5-6bf39731719a.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/lead-temperature-classifie` |
| 20260709150000_rodizio_quiet_hours_cron_10m.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/rodizio-metrics-broadcast` |
| 20260709153056_portal_otp_watchdog_cron_1m.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/portal-otp-watchdog` |
| 20260710000000_voice_dialer_module.sql | `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/voice-dialer-cron` |
| … | +10 |

## Observações

- Contagens são de **ocorrências em arquivos de migration**, não necessariamente estado final do banco remoto.
- Objetos podem ter sido recriados/dropados em migrations posteriores.
- Matriz RLS por tabela: etapa 6 (`07-banco-migrations-rls.md`).
- Também existe `cron_setup.sql` na raiz do repo (fora de migrations) — inventariado como legado/auxiliar.
