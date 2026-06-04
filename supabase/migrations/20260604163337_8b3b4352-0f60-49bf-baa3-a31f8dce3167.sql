ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS external_message_id TEXT,
  ADD COLUMN IF NOT EXISTS delivery_status TEXT,
  ADD COLUMN IF NOT EXISTS delivery_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_error TEXT;

CREATE INDEX IF NOT EXISTS conversations_external_message_id_idx
  ON public.conversations (external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversations_delivery_status_idx
  ON public.conversations (delivery_status)
  WHERE delivery_status IS NOT NULL;