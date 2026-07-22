-- Cache do wa_id real (Whapi check phones).
-- phone_whatsapp continua sendo o número da operadora (SMS/voz, com 9º dígito).
-- whatsapp_chat_id é o JID canônico do WhatsApp (pode ser SEM o 9).

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS whatsapp_chat_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_chat_id_checked_at timestamptz;

COMMENT ON COLUMN public.customers.whatsapp_chat_id IS
  'Dígitos do wa_id Whapi (chat real). Pode diferir de phone_whatsapp no BR (9º dígito).';
COMMENT ON COLUMN public.customers.whatsapp_chat_id_checked_at IS
  'Quando whatsapp_chat_id foi resolvido via Whapi POST /contacts.';

CREATE INDEX IF NOT EXISTS customers_whatsapp_chat_id_idx
  ON public.customers (whatsapp_chat_id)
  WHERE whatsapp_chat_id IS NOT NULL;
