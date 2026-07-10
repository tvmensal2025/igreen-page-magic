
ALTER TABLE public.voice_campaign_targets
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS voice_campaign_targets_status_idx
  ON public.voice_campaign_targets(campaign_id, status);

CREATE INDEX IF NOT EXISTS voice_campaign_targets_velip_call_id_idx
  ON public.voice_campaign_targets(velip_call_id) WHERE velip_call_id IS NOT NULL;

ALTER TABLE public.voice_template_renders
  ADD COLUMN IF NOT EXISTS velip_audio_id TEXT,
  ADD COLUMN IF NOT EXISTS velip_uploaded_at TIMESTAMPTZ;
