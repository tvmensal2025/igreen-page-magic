-- Ads: os 3 crons abaixo ficaram de fora de 20260724180000_ads_cron_auth_headers
-- e chamam handlers que usam assertCronAuthStrict (fail-closed). Sem os headers,
-- tomariam 401 assim que as edge functions do hardening fossem deployadas:
--   * fb-cbo-to-abo                 → facebook-cbo-to-abo (sem fallback de UI)
--   * fb-mg-city-rotator            → facebook-mg-city-rotator
--   * facebook-retarget-sync-3x-day → facebook-retarget-sync
--
-- ADITIVO: só altera o command dos jobs existentes via cron.alter_job,
-- preservando schedule e active. Não cria job novo, não muda cadência e
-- NÃO liga ENFORCE_CRON_AUTH.
--
-- Padrão idêntico a 20260724161000_crm_auto_progress_cron_auth.sql.

DO $migration$
DECLARE
  v_job record;
BEGIN
  FOR v_job IN
    SELECT jobid, schedule, active
    FROM cron.job
    WHERE jobname = 'fb-cbo-to-abo'
  LOOP
    PERFORM cron.alter_job(
      job_id := v_job.jobid,
      schedule := v_job.schedule,
      command := $command$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/facebook-cbo-to-abo',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb
      || jsonb_build_object(
        'x-internal-secret', COALESCE(
          (SELECT trim(both '"' from value::text)
             FROM public.settings
            WHERE key = 'embed_internal_token'
            LIMIT 1),
          ''
        ),
        'x-service-secret', COALESCE(
          (SELECT trim(both '"' from value::text)
             FROM public.settings
            WHERE key = 'service_shared_secret'
            LIMIT 1),
          ''
        )
      ),
    body := '{}'::jsonb
  ) AS request_id;
      $command$,
      active := v_job.active
    );
  END LOOP;

  FOR v_job IN
    SELECT jobid, schedule, active
    FROM cron.job
    WHERE jobname = 'fb-mg-city-rotator'
  LOOP
    PERFORM cron.alter_job(
      job_id := v_job.jobid,
      schedule := v_job.schedule,
      command := $command$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/facebook-mg-city-rotator',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb
      || jsonb_build_object(
        'x-internal-secret', COALESCE(
          (SELECT trim(both '"' from value::text)
             FROM public.settings
            WHERE key = 'embed_internal_token'
            LIMIT 1),
          ''
        ),
        'x-service-secret', COALESCE(
          (SELECT trim(both '"' from value::text)
             FROM public.settings
            WHERE key = 'service_shared_secret'
            LIMIT 1),
          ''
        )
      ),
    body := '{"seed":false,"activate_next":true}'::jsonb
  ) AS request_id;
      $command$,
      active := v_job.active
    );
  END LOOP;

  FOR v_job IN
    SELECT jobid, schedule, active
    FROM cron.job
    WHERE jobname = 'facebook-retarget-sync-3x-day'
  LOOP
    PERFORM cron.alter_job(
      job_id := v_job.jobid,
      schedule := v_job.schedule,
      command := $command$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/facebook-retarget-sync',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb
      || jsonb_build_object(
        'x-internal-secret', COALESCE(
          (SELECT trim(both '"' from value::text)
             FROM public.settings
            WHERE key = 'embed_internal_token'
            LIMIT 1),
          ''
        ),
        'x-service-secret', COALESCE(
          (SELECT trim(both '"' from value::text)
             FROM public.settings
            WHERE key = 'service_shared_secret'
            LIMIT 1),
          ''
        )
      ),
    body := jsonb_build_object('triggered_at', now())
  ) AS request_id;
      $command$,
      active := v_job.active
    );
  END LOOP;
END
$migration$;
