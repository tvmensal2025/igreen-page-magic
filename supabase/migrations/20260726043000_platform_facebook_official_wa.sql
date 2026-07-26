-- Número WhatsApp oficial da plataforma (CTWA) — implantado via SuperAdmin.
-- Página/Pixel/Ad Account continuam nas colunas existentes; aqui só o WA Cloud.

ALTER TABLE public.platform_facebook_account
  ADD COLUMN IF NOT EXISTS waba_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_destination_number text,
  ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_phone_number_display text,
  ADD COLUMN IF NOT EXISTS whatsapp_registered_at timestamptz;

COMMENT ON COLUMN public.platform_facebook_account.waba_id IS
  'WABA Cloud API usada para o número oficial CTWA da plataforma';
COMMENT ON COLUMN public.platform_facebook_account.whatsapp_phone_number_id IS
  'phone_number_id Meta (numérico) do número oficial CTWA';
COMMENT ON COLUMN public.platform_facebook_account.whatsapp_destination_number IS
  'Dígitos E.164 sem + (ex.: 5534999999999) do número oficial CTWA';
