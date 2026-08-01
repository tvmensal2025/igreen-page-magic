-- Duração do arquivo de áudio/vídeo (segundos). WhatsApp informa played/read,
-- mas não tempo parcial de escuta — só confirmação binária via webhook Whapi/Evolution.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS media_duration_sec integer;

COMMENT ON COLUMN public.conversations.media_duration_sec IS
  'Duração do arquivo outbound em segundos (áudio/vídeo). Preenchido no envio ou reconciliação Whapi GET /messages/{id}.';
