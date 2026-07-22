-- Waste guard: a cada 30 min (antes 1x/dia e só recomendava).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fb-auto-pause') THEN
    PERFORM cron.unschedule('fb-auto-pause');
  END IF;
END $$;

SELECT cron.schedule(
  'fb-auto-pause',
  '*/30 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/facebook-auto-pause',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body := '{}'::jsonb
  );
  $cron$
);
