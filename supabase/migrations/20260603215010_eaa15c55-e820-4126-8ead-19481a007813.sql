CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove agendamento antigo se existir (idempotente)
DO $$
BEGIN
  PERFORM cron.unschedule('bulk-scheduler-tick');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Agenda execução a cada 1 minuto
SELECT cron.schedule(
  'bulk-scheduler-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/bulk-scheduler',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body := jsonb_build_object('tick_at', now())
  );
  $$
);