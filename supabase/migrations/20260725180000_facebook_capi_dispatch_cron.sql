-- Agenda o despachante CAPI a cada 5 min.
-- Pré-requisito: automation_toggles.facebook_capi_dispatch = true (decisão humana).
-- Headers com x-internal-secret / x-service-secret (assertCronAuthStrict).

DO $$
BEGIN
  BEGIN PERFORM cron.unschedule('facebook-capi-dispatch-5min'); EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

SELECT cron.schedule(
  'facebook-capi-dispatch-5min',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/facebook-capi-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo',
      'x-internal-secret', COALESCE((SELECT trim(both '"' from value::text) FROM public.settings WHERE key = 'embed_internal_token' LIMIT 1), ''),
      'x-service-secret', COALESCE((SELECT trim(both '"' from value::text) FROM public.settings WHERE key = 'service_shared_secret' LIMIT 1), '')
    ),
    body := jsonb_build_object('triggered_at', now(), 'limit', 50)
  ) AS request_id;
  $cron$
);
