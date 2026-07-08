ALTER TABLE public.consultant_ad_settings
  ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_phone_number_display text,
  ADD COLUMN IF NOT EXISTS whatsapp_last_verified_at timestamptz;

COMMENT ON COLUMN public.consultant_ad_settings.whatsapp_phone_number_id IS 'ID imutável do número na WABA Meta. Fonte de verdade para CTWA.';
COMMENT ON COLUMN public.consultant_ad_settings.whatsapp_phone_number_display IS 'display_phone_number retornado pelo Meta (ex.: "+55 34 8431-4317").';