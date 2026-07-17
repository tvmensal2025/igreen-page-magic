-- Liga os pontos de chamada: clip Sofia na cadência + make_call no fluxo.
-- Incremental — não remove colunas nem liga toggles.

-- 1) Cadência CALL_*: clip canônico + personalização de nome
ALTER TABLE public.cadence_stage_config
  ADD COLUMN IF NOT EXISTS voice_audio_clip_id uuid
    REFERENCES public.voice_audio_clips(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS personalize_name boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cadence_stage_config.voice_audio_clip_id IS
  'Clip Sofia (voice_audio_clips) para CALL_*. Preferir sobre velip_audio_id legado.';
COMMENT ON COLUMN public.cadence_stage_config.personalize_name IS
  'Se true, costura intro Olá,{Nome}. via ElevenLabs + corpo antes de discar (cache voice_call_renders).';

CREATE INDEX IF NOT EXISTS cadence_stage_config_voice_clip_idx
  ON public.cadence_stage_config (voice_audio_clip_id)
  WHERE voice_audio_clip_id IS NOT NULL;

-- 2) Passo make_call no construtor: clip + personalize
ALTER TABLE public.bot_flow_steps
  ADD COLUMN IF NOT EXISTS voice_audio_clip_id uuid
    REFERENCES public.voice_audio_clips(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS personalize_name boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.bot_flow_steps.voice_audio_clip_id IS
  'Clip Sofia para step_type=make_call. Runtime fail-closed até bot_flow_make_call ON.';
COMMENT ON COLUMN public.bot_flow_steps.personalize_name IS
  'Personalizar ligação do passo make_call com intro Olá,{Nome}.';

CREATE INDEX IF NOT EXISTS bot_flow_steps_voice_clip_idx
  ON public.bot_flow_steps (voice_audio_clip_id)
  WHERE voice_audio_clip_id IS NOT NULL;

-- 3) Kill switch make_call no fluxo (default OFF)
INSERT INTO public.automation_toggles (key, label, description, category, enabled) VALUES
  (
    'bot_flow_make_call',
    'Fluxo — passo Ligação (make_call)',
    'Permite o passo make_call enfileirar ligação real (Sofia/Velip). Com OFF só dry-run (log would_make_call). Exige também bot_global_enabled.',
    'voz',
    false
  )
ON CONFLICT (key) DO NOTHING;
