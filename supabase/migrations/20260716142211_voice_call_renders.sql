-- Ligação personalizada: corpo 1x + intro com nome (cache de renders).
-- Incremental: não apaga dados existentes.

ALTER TABLE public.voice_audio_clips
  ADD COLUMN IF NOT EXISTS voice_id text,
  ADD COLUMN IF NOT EXISTS model_id text,
  ADD COLUMN IF NOT EXISTS source_audio_library_id uuid,
  ADD COLUMN IF NOT EXISTS is_call_body boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.voice_audio_clips.is_call_body IS
  'Corpo de áudio exportado do Estúdio para costura com nome na discagem.';
COMMENT ON COLUMN public.voice_audio_clips.voice_id IS
  'ElevenLabs voice_id usado no corpo (intro deve usar a mesma voz).';
COMMENT ON COLUMN public.voice_audio_clips.model_id IS
  'ElevenLabs model_id (eleven_multilingual_v2 | eleven_v3).';

CREATE TABLE IF NOT EXISTS public.voice_call_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL,
  body_clip_id uuid NOT NULL REFERENCES public.voice_audio_clips(id) ON DELETE CASCADE,
  name_normalized text NOT NULL,
  display_name text,
  voice_id text NOT NULL,
  model_id text NOT NULL DEFAULT 'eleven_multilingual_v2',
  intro_audio_url text,
  final_audio_url text,
  velip_audio_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voice_call_renders_uniq
    UNIQUE (body_clip_id, name_normalized, voice_id, model_id)
);

CREATE INDEX IF NOT EXISTS voice_call_renders_consultant_idx
  ON public.voice_call_renders (consultant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS voice_call_renders_velip_idx
  ON public.voice_call_renders (velip_audio_id)
  WHERE velip_audio_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_call_renders TO authenticated;
GRANT ALL ON public.voice_call_renders TO service_role;

ALTER TABLE public.voice_call_renders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Consultants manage own voice_call_renders" ON public.voice_call_renders;
CREATE POLICY "Consultants manage own voice_call_renders"
  ON public.voice_call_renders FOR ALL
  USING (auth.uid() = consultant_id)
  WITH CHECK (auth.uid() = consultant_id);

DROP TRIGGER IF EXISTS trg_voice_call_renders_updated ON public.voice_call_renders;
CREATE TRIGGER trg_voice_call_renders_updated
  BEFORE UPDATE ON public.voice_call_renders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
