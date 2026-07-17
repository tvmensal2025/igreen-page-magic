-- Texto livre no Estúdio de Áudio + rastreio da voz ElevenLabs usada.
-- Incremental: não apaga dados; só amplia o CHECK de kind e adiciona voice_id.

ALTER TABLE public.audio_library
  DROP CONSTRAINT IF EXISTS audio_library_kind_check;

ALTER TABLE public.audio_library
  ADD CONSTRAINT audio_library_kind_check
  CHECK (kind IN ('mutirao', 'comercio', 'livre'));

ALTER TABLE public.audio_library
  ADD COLUMN IF NOT EXISTS voice_id text;
