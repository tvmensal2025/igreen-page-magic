
-- Helper: unschedule sem quebrar se não existir
DO $mig$
DECLARE
  v_jobs text[] := ARRAY[
    'ad-competitor-scraper-weekly',
    'ad-creative-learner-daily',
    'ai-daily-digest-09brt',
    'ai-learn-feedback-daily',
    'ai-followup-cron-15min',
    'facebook-creative-rotator-daily',
    'fb-sync-audiences-daily',
    'sync-igreen-customers-daily',
    'flow-engine-rollout-tick',
    'migrate-storage-to-minio',
    'cleanup-webhook-artifacts',
    'cleanup-webhook-dedup',
    'cleanup-webhook-dedupe',
    'bot-stuck-recovery-5min',
    'bot-stuck-recovery-30min',
    'bot-followup-checker-30min',
    'bot-loop-watchdog-15m',
    'ocr-review-timeout-every-min',
    'production-health-snapshot-5min',
    'instance-health-cron',
    'instance-health-cron-10min',
    'flow-d-health-cron-30min',
    'faq-reengagement-nudge-5min',
    'ai-cpl-watchdog-4h',
    'conversion-classifier-15min',
    'conversion-classifier-daily',
    'fb-sync-metrics',
    'fb-sync-ad-creatives',
    'minio-quota-check',
    'super-admin-alerts',
    'bulk-scheduler-tick',
    'inbound-media-retry-cron-1min',
    'fb-token-refresh'
  ];
  v_job text;
BEGIN
  FOREACH v_job IN ARRAY v_jobs LOOP
    BEGIN
      PERFORM cron.unschedule(v_job);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END
$mig$;

-- Base URL e apikey usados por todos os novos net.http_post
-- (mesmo padrão das migrations anteriores do projeto)

-- === GRUPO 1: essenciais reduzidos ===

-- send-scheduled-messages fica igual (já é 5min, não mexemos)

-- bulk-scheduler: 1min -> 5min
SELECT cron.schedule(
  'bulk-scheduler-tick',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url:='https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/bulk-scheduler',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body:=concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

-- inbound-media-retry: 1min -> 3min
SELECT cron.schedule(
  'inbound-media-retry-cron-1min',
  '*/3 * * * *',
  $$
  SELECT net.http_post(
    url:='https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/inbound-media-retry-cron',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body:=concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

-- fb-token-refresh: diário 03:00 BRT (06:00 UTC)
SELECT cron.schedule(
  'fb-token-refresh',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url:='https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/facebook-token-refresh',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body:=concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

-- === GRUPO 2: reduzidos ===

-- bot-stuck-recovery: unifica em 1×/hora
SELECT cron.schedule(
  'bot-stuck-recovery-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url:='https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/bot-stuck-recovery',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body:=concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

-- bot-followup-checker: 1×/dia 09:00 BRT (12:00 UTC)
SELECT cron.schedule(
  'bot-followup-checker-daily',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url:='https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/bot-followup-checker',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body:=concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

-- bot-loop-watchdog: 1×/hora
SELECT cron.schedule(
  'bot-loop-watchdog-hourly',
  '5 * * * *',
  $$
  SELECT net.http_post(
    url:='https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/bot-loop-watchdog',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body:=concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

-- ocr-review-timeout: 1min -> 5min
SELECT cron.schedule(
  'ocr-review-timeout-every-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url:='https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/ocr-review-timeout',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body:=concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

-- production-health-snapshot: 5min -> 1×/hora
SELECT cron.schedule(
  'production-health-snapshot-hourly',
  '10 * * * *',
  $$
  SELECT net.http_post(
    url:='https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/production-health-snapshot',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body:=concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

-- instance-health: 30min
SELECT cron.schedule(
  'instance-health-cron-30min',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url:='https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/instance-health-cron',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body:=concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

-- flow-d-health-cron: 30min -> 1×/hora
SELECT cron.schedule(
  'flow-d-health-cron-hourly',
  '15 * * * *',
  $$
  SELECT net.http_post(
    url:='https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/flow-d-health-cron',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body:=concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

-- faq-reengagement-nudge: 5min -> 30min
SELECT cron.schedule(
  'faq-reengagement-nudge-30min',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url:='https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/faq-reengagement-nudge',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body:=concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

-- ai-cpl-watchdog: 4h -> 1×/dia 08:00 BRT (11:00 UTC)
SELECT cron.schedule(
  'ai-cpl-watchdog-daily',
  '0 11 * * *',
  $$
  SELECT net.http_post(
    url:='https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/ai-cpl-watchdog',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body:=concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

-- fb-sync-metrics: 6h
SELECT cron.schedule(
  'fb-sync-metrics-6h',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url:='https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/facebook-sync-metrics',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body:=concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

-- fb-sync-ad-creatives: diário 04:00 BRT (07:00 UTC)
SELECT cron.schedule(
  'fb-sync-ad-creatives-daily',
  '0 7 * * *',
  $$
  SELECT net.http_post(
    url:='https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/facebook-sync-ad-creatives',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body:=concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

-- minio-quota-check: 1×/dia 07:00 BRT (10:00 UTC)
SELECT cron.schedule(
  'minio-quota-check-daily',
  '0 10 * * *',
  $$
  SELECT net.http_post(
    url:='https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/minio-quota-check',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body:=concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

-- super-admin-alerts: 1×/hora
SELECT cron.schedule(
  'super-admin-alerts-hourly',
  '20 * * * *',
  $$
  SELECT net.http_post(
    url:='https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/super-admin-alerts',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body:=concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

-- conversion-classifier: só diário 03:00 BRT (06:00 UTC)
SELECT cron.schedule(
  'conversion-classifier-daily',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url:='https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/lead-temperature-classifier',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body:=concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

-- cleanup consolidado: 1×/dia 02:00 BRT (05:00 UTC)
-- Deixa como job único que chama uma função existente; se houver múltiplas,
-- podemos executar sequencialmente depois. Por ora deixa unschedulado o antigo.
