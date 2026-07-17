-- Programação do ciclo: clip da 2ª ligação + personalizar nome (aditivo).
-- Não liga live_dispatch. Colunas atuais permanecem.

ALTER TABLE public.daily_reheat_kit
  ADD COLUMN IF NOT EXISTS voice_audio_clip_id_retry uuid
    REFERENCES public.voice_audio_clips(id) ON DELETE SET NULL;

ALTER TABLE public.daily_reheat_kit
  ADD COLUMN IF NOT EXISTS personalize_name boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.daily_reheat_kit.voice_audio_clip_id_retry IS
  'Clip da 2ª ligação (retry). Se NULL, reusa voice_audio_clip_id.';

COMMENT ON COLUMN public.daily_reheat_kit.personalize_name IS
  'Se true, costura Olá {Nome} + corpo via voice-call-stitch antes de discar.';
