-- Agenda portal-otp-watchdog a cada 1 minuto.
-- Garante: re-dispatch de cadastro preso, replay de OTP, envio de link facial
-- só após OTP validado, e sync quando a iGreen já concluiu o contrato.

DO $$ BEGIN
  PERFORM cron.unschedule('portal-otp-watchdog-1m');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'portal-otp-watchdog-1m',
  '* * * * *',
  $$
  SELECT net.http_post(
    url:='https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/portal-otp-watchdog',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body:=concat('{"trigger":"cron","time":"', now(), '"}')::jsonb
  ) AS request_id;
  $$
);
