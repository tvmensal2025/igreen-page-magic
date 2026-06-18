-- Versão com vinheta (já aplicada em produção; migration idempotente para ambientes locais)
ALTER TABLE public.audio_library
  ADD COLUMN IF NOT EXISTS audio_url_vinheta TEXT;
