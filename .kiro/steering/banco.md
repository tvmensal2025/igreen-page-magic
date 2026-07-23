---
inclusion: always
---

# Banco — tabelas críticas

Types: `src/integrations/supabase/types.ts`. Chat = `conversations` (não existe `messages`). Dedup = `webhook_message_dedup`.

## customers (núcleo)
- Identidade: `id`, `consultant_id`→consultants, `phone_whatsapp`, `name`, `name_source`
- Bot: `conversation_step`, `bot_paused*`, `bot_force_enabled`, `fluxo_b_state|variant`, `welcome_sent_at`
- DNC: `do_not_contact`
- Campanha: `source_campaign_id`→facebook_campaigns, `source_ad_id`, `ctwa_clid`, `tracking_protocol`, `referral_partner_id`→referral_partners
- Portal: `portal_submitted_at`, `otp_*`, `facial_*`, `assinatura_*`, `portal2_*`, `last_portal_dispatch_*`
- Club: `club_status|payload|response|error*`
- `status=pending` é **ambíguo** — classificar com step + portal + DNC

## Cadência / automação
| Tabela | Chaves |
|---|---|
| `lead_cadence_state` | `stage` (enum A/B/C), `next_action_at`, `paused_reason`, claim/lease |
| `cadence_action_log` / `cadence_stage_config` / `cadence_theme_config` | log + overrides |
| `app_settings` | id=`global`: `bot_global_enabled`, `cadence_engine_enabled`, `fluxo_b_persona` |
| `automation_toggles` | `key`, `enabled` |
| `daily_reheat_settings` | `enabled`, `live_dispatch_enabled`, `daily_whapi_cap`, `pilot_consultant_ids`, janela BRT |
| `daily_reheat_queue` / `runs` / `kit` | fila reheat |

## Meta / rodízio
- `facebook_campaigns`: UUID PK, `fb_campaign_id`, `fb_ad_ids`, `initial_message`, `tracking_protocol`, brain_scale_*
- `rodizio_pools`: `campaign_id`→campaigns, `phones[]`, `counter`, `is_enabled`
- `rodizio_pool_members`, `rodizio_assignments`, `ctwa_clid_mapping`, `campaign_match_log`

## WA / outbound
`whatsapp_instances` (Evolution ≠ health Whapi), `conversations`, `outbound_message_log`, `scheduled_messages`, `whapi_send_throttle`, `bot_flows`/`bot_flow_steps`/`bot_flow_qa*`

## Portal / iGreen / voz
`portal2_audit_traces`, `capture_field_events`, família `igreen_*`, `voice_campaigns`/`voice_call_logs`/`voice_dnc_list`/`voice_audio_clips`

## consultants
`name` (às vezes slug), `display_name`, `cerebro_ativo`, `portal_kind`, `ai_persona_fluxo_b*`, URLs cadastro/club, credenciais portal

## Query patterns
- Front: Supabase client + RLS; ownership via `consultant_id`
- Edge: `admin-client` service_role + `assertOwnership` quando JWT
- Rodízio sempre por UUID; reheat/cadência respeitam toggles + bot_global
