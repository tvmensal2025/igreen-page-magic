-- Garante job voice-dialer-tick no padrão apikey anon (idempotente).
-- A edge voice-dialer-cron valida apikey anon | Bearer service_role | x-service-secret.

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
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body := concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);
