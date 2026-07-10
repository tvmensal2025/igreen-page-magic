
ALTER TABLE public.voice_audio_clips
  ADD COLUMN IF NOT EXISTS velip_audio_id text,
  ADD COLUMN IF NOT EXISTS velip_uploaded_at timestamptz;

ALTER TABLE public.voice_templates
  ADD COLUMN IF NOT EXISTS velip_audio_id text,
  ADD COLUMN IF NOT EXISTS velip_uploaded_at timestamptz;

ALTER TABLE public.voice_campaigns
  ADD COLUMN IF NOT EXISTS velip_campaign_id text,
  ADD COLUMN IF NOT EXISTS velip_mode text NOT NULL DEFAULT 'single';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'voice_campaigns_velip_mode_chk'
  ) THEN
    ALTER TABLE public.voice_campaigns
      ADD CONSTRAINT voice_campaigns_velip_mode_chk
      CHECK (velip_mode IN ('single','batch'));
  END IF;
END $$;

ALTER TABLE public.voice_campaign_targets
  ADD COLUMN IF NOT EXISTS velip_call_id text,
  ADD COLUMN IF NOT EXISTS velip_status text,
  ADD COLUMN IF NOT EXISTS velip_cost numeric(10,4),
  ADD COLUMN IF NOT EXISTS velip_saldo_after numeric(12,4);

ALTER TABLE public.voice_call_logs
  ADD COLUMN IF NOT EXISTS velip_call_id text,
  ADD COLUMN IF NOT EXISTS velip_status text,
  ADD COLUMN IF NOT EXISTS velip_cost numeric(10,4),
  ADD COLUMN IF NOT EXISTS velip_saldo_after numeric(12,4),
  ADD COLUMN IF NOT EXISTS velip_time_sec integer,
  ADD COLUMN IF NOT EXISTS velip_dtmf jsonb,
  ADD COLUMN IF NOT EXISTS velip_raw jsonb;

CREATE INDEX IF NOT EXISTS voice_targets_velip_call_id_idx
  ON public.voice_campaign_targets(velip_call_id);
CREATE INDEX IF NOT EXISTS voice_call_logs_velip_call_id_idx
  ON public.voice_call_logs(velip_call_id);
