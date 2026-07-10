-- Endurece voice-dialer-tick: header secreto dedicado (não usa anon key pública).
-- Pré-requisito: secret VOICE_DIALER_CRON_SECRET nas Edge Functions
--   (mesmo valor do header abaixo).

DO $mig$
BEGIN
  BEGIN
    PERFORM cron.unschedule('voice-dialer-tick');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END
$mig$;

SELECT cron.schedule(
  'voice-dialer-tick',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/voice-dialer-cron',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo", "x-voice-dialer-cron-secret": "a43fc92eb23b0a7382d74f55ad846607cab3af4140d427e3a1f263b61a38a48d"}'::jsonb,
    body := concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);
