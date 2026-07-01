ALTER TABLE public.igreen_consultant_metrics
  ADD COLUMN IF NOT EXISTS cashback_seguros_saldo numeric,
  ADD COLUMN IF NOT EXISTS painel_onboarding_json jsonb,
  ADD COLUMN IF NOT EXISTS painel_inativos_json jsonb,
  ADD COLUMN IF NOT EXISTS painel_ranking_json jsonb,
  ADD COLUMN IF NOT EXISTS telecom_resumo_json jsonb,
  ADD COLUMN IF NOT EXISTS seguros_resumo_json jsonb;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS possui_placas boolean;

ALTER TABLE public.igreen_automation_settings
  ADD COLUMN IF NOT EXISTS last_sync_customers timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_boletos timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_devolutivas timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_metrics timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_network timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_telecom timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_seguros timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_cashback timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_painel_rede timestamptz;