-- =============================================================================
-- Módulo isolado: Voice Dialer (PSTN via Twilio)
-- NÃO toca em bulk_campaigns, evolution-webhook, bot-flow, vendedora.
-- =============================================================================

-- Clipes de áudio gravados pelo consultor (~20s)
CREATE TABLE public.voice_audio_clips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL,
  name text NOT NULL DEFAULT 'Clipe de voz',
  audio_url text NOT NULL,
  duration_sec int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_audio_clips TO authenticated;
GRANT ALL ON public.voice_audio_clips TO service_role;

ALTER TABLE public.voice_audio_clips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Consultants manage own voice clips"
  ON public.voice_audio_clips FOR ALL
  USING (auth.uid() = consultant_id)
  WITH CHECK (auth.uid() = consultant_id);

CREATE INDEX idx_voice_clips_consultant ON public.voice_audio_clips(consultant_id, created_at DESC);

CREATE TRIGGER trg_voice_clips_updated
  BEFORE UPDATE ON public.voice_audio_clips
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Campanhas de ligação
CREATE TABLE public.voice_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL,
  name text NOT NULL DEFAULT 'Campanha de ligação',
  audio_clip_id uuid REFERENCES public.voice_audio_clips(id) ON DELETE SET NULL,
  audio_url text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  total int NOT NULL DEFAULT 0,
  dialed int NOT NULL DEFAULT 0,
  answered int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  scheduled_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_campaigns TO authenticated;
GRANT ALL ON public.voice_campaigns TO service_role;

ALTER TABLE public.voice_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Consultants manage own voice campaigns"
  ON public.voice_campaigns FOR ALL
  USING (auth.uid() = consultant_id)
  WITH CHECK (auth.uid() = consultant_id);

CREATE INDEX idx_voice_campaigns_consultant ON public.voice_campaigns(consultant_id, created_at DESC);
CREATE INDEX idx_voice_campaigns_status ON public.voice_campaigns(status, scheduled_at);

CREATE TRIGGER trg_voice_campaigns_updated
  BEFORE UPDATE ON public.voice_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Alvos da campanha
CREATE TABLE public.voice_campaign_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.voice_campaigns(id) ON DELETE CASCADE,
  customer_id uuid,
  phone text NOT NULL,
  name text,
  status text NOT NULL DEFAULT 'queued',
  twilio_sid text,
  answered_by text,
  error text,
  dialed_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_campaign_targets TO authenticated;
GRANT ALL ON public.voice_campaign_targets TO service_role;

ALTER TABLE public.voice_campaign_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Consultants manage own voice targets"
  ON public.voice_campaign_targets FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.voice_campaigns c
      WHERE c.id = campaign_id AND c.consultant_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.voice_campaigns c
      WHERE c.id = campaign_id AND c.consultant_id = auth.uid()
    )
  );

CREATE INDEX idx_voice_targets_campaign ON public.voice_campaign_targets(campaign_id, status);
CREATE INDEX idx_voice_targets_twilio ON public.voice_campaign_targets(twilio_sid) WHERE twilio_sid IS NOT NULL;

-- Logs detalhados por chamada
CREATE TABLE public.voice_call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES public.voice_campaigns(id) ON DELETE SET NULL,
  target_id uuid REFERENCES public.voice_campaign_targets(id) ON DELETE SET NULL,
  consultant_id uuid NOT NULL,
  twilio_sid text,
  to_phone text NOT NULL,
  from_phone text,
  status text,
  answered_by text,
  duration_sec int,
  price text,
  error text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.voice_call_logs TO authenticated;
GRANT ALL ON public.voice_call_logs TO service_role;

ALTER TABLE public.voice_call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Consultants read own voice call logs"
  ON public.voice_call_logs FOR SELECT
  USING (auth.uid() = consultant_id);

CREATE INDEX idx_voice_call_logs_consultant ON public.voice_call_logs(consultant_id, created_at DESC);
CREATE INDEX idx_voice_call_logs_sid ON public.voice_call_logs(twilio_sid) WHERE twilio_sid IS NOT NULL;

-- Cron: voice-dialer a cada 5 min
DO $mig$
BEGIN
  BEGIN
    PERFORM cron.unschedule('voice-dialer-tick');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END
$mig$;

-- Cron no padrão do projeto: apikey anon (edge aceita anon | service_role | x-service-secret).
SELECT cron.schedule(
  'voice-dialer-tick',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/voice-dialer-cron',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body := concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);
