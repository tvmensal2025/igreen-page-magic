-- ============================================================================
-- iGreen — Cron Setup (Super Admin Alerts + Health Checks)
-- ============================================================================
-- Como usar:
--   1. Abra o SQL Editor: https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl/sql/new
--   2. Cole TODO este arquivo
--   3. Clique em "Run"
--   4. A última query (SELECT * FROM cron.job) mostra os 3 jobs ativos
-- ============================================================================

-- 1) Extensões necessárias (instaladas no schema "extensions" do Supabase)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- 2) Remove jobs antigos (defensivo, ignora erro se não existirem)
DO $$
BEGIN
  PERFORM cron.unschedule('minio-quota-check');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('super-admin-alerts');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('instance-health-cron');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 3) Agenda os 3 jobs
SELECT cron.schedule(
  'minio-quota-check',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/minio-quota-check',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body    := jsonb_build_object('triggered_at', now())
  );
  $$
);

SELECT cron.schedule(
  'super-admin-alerts',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/super-admin-alerts',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body    := jsonb_build_object('triggered_at', now())
  );
  $$
);

SELECT cron.schedule(
  'instance-health-cron',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/instance-health-cron',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body    := jsonb_build_object('triggered_at', now())
  );
  $$
);

-- 4) Confirme os jobs registrados
SELECT jobid, schedule, jobname, active
FROM cron.job
WHERE jobname IN ('minio-quota-check', 'super-admin-alerts', 'instance-health-cron')
ORDER BY jobname;
