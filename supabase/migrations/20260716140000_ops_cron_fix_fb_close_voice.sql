-- Ops pós-hardening (2026-07-16): corrigir gaps fora do escopo onda3.
-- ADITIVO: unschedule duplicata/morto + reagendar canônicos com headers.
-- NÃO liga ENFORCE_*.

-- 1) Duplicata: duas jobs → mesma EF a cada 5min
DO $$ BEGIN PERFORM cron.unschedule('close-attendance-scheduled-every-5min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- 2) Cron morto: voice-dashboard-metrics exige JWT de consultor (só UI)
DO $$ BEGIN PERFORM cron.unschedule('voice-dashboard-metrics-15min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- 3) Reagendar canônicos com x-internal-secret (embed_internal_token)
DO $$ BEGIN PERFORM cron.unschedule('fb-campaign-healthcheck'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('close-attendance-scheduled-5min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'fb-campaign-healthcheck',
  '15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/facebook-campaign-healthcheck',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo',
      'x-internal-secret', COALESCE((SELECT trim(both '"' from value::text) FROM public.settings WHERE key = 'embed_internal_token' LIMIT 1), ''),
      'x-service-secret', COALESCE((SELECT trim(both '"' from value::text) FROM public.settings WHERE key = 'service_shared_secret' LIMIT 1), '')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'close-attendance-scheduled-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/close-attendance-scheduled',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo',
      'x-internal-secret', COALESCE((SELECT trim(both '"' from value::text) FROM public.settings WHERE key = 'embed_internal_token' LIMIT 1), ''),
      'x-service-secret', COALESCE((SELECT trim(both '"' from value::text) FROM public.settings WHERE key = 'service_shared_secret' LIMIT 1), '')
    ),
    body := concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);
