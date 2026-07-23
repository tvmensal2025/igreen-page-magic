-- pos-venda-auto-progress usa assertCronAuth; crons ainda só mandavam apikey.
-- Alinha headers com cadence/followups para permitir ENFORCE_CRON_AUTH=true sem 401.

SELECT cron.alter_job(
  110,
  schedule := '0 10 * * *',
  command := $cmd$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/pos-venda-auto-progress',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo',
      'x-internal-secret', COALESCE((SELECT trim(both '"' from value::text) FROM public.settings WHERE key = 'embed_internal_token' LIMIT 1), ''),
      'x-service-secret', COALESCE((SELECT trim(both '"' from value::text) FROM public.settings WHERE key = 'service_shared_secret' LIMIT 1), '')
    ),
    body := concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $cmd$
);

SELECT cron.alter_job(
  50,
  schedule := '15 * * * *',
  command := $cmd$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/pos-venda-auto-progress',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo',
      'x-internal-secret', COALESCE((SELECT trim(both '"' from value::text) FROM public.settings WHERE key = 'embed_internal_token' LIMIT 1), ''),
      'x-service-secret', COALESCE((SELECT trim(both '"' from value::text) FROM public.settings WHERE key = 'service_shared_secret' LIMIT 1), '')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $cmd$
);
