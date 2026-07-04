CREATE UNIQUE INDEX IF NOT EXISTS conversations_whapi_hist_uniq
  ON public.conversations (external_message_id)
  WHERE external_message_id LIKE 'whapi_hist:%';