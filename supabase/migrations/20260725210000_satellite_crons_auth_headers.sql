-- Hardening: crons satélite sem x-service/internal secret.
-- ADITIVO via cron.alter_job — preserva schedule/active.
-- Edges correspondentes passam a usar assertCronAuth (deploy separado).
--
-- Jobs JWT-only impossíveis de autenticar como cron anônimo:
--   conversion-classifier-daily → lead-temperature-classifier (session_required)
--   meta-ads-metrics-3h → meta-ads-metrics (getUser)
--   voice-dialer-health-30min → voice-dialer-health (resolveCaller JWT)
-- Estes são DESATIVADOS (active=false), não apagados.

DO $migration$
DECLARE
  v_job record;
  v_headers_suffix text := $hdr$
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
      )
$hdr$;
BEGIN
  -- 1) lead-research-sweep-1m
  FOR v_job IN
    SELECT jobid, schedule, active FROM cron.job WHERE jobname = 'lead-research-sweep-1m'
  LOOP
    PERFORM cron.alter_job(
      job_id := v_job.jobid,
      schedule := v_job.schedule,
      command := $command$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/lead-research-sweep-cron',
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

  -- 2) inbound-media-retry-10min
  FOR v_job IN
    SELECT jobid, schedule, active FROM cron.job WHERE jobname = 'inbound-media-retry-10min'
  LOOP
    PERFORM cron.alter_job(
      job_id := v_job.jobid,
      schedule := v_job.schedule,
      command := $command$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/inbound-media-retry-cron',
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

  -- 3) production-health-snapshot-hourly
  FOR v_job IN
    SELECT jobid, schedule, active FROM cron.job WHERE jobname = 'production-health-snapshot-hourly'
  LOOP
    PERFORM cron.alter_job(
      job_id := v_job.jobid,
      schedule := v_job.schedule,
      command := $command$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/production-health-snapshot',
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

  -- 4) speed-to-lead-check-5min
  FOR v_job IN
    SELECT jobid, schedule, active FROM cron.job WHERE jobname = 'speed-to-lead-check-5min'
  LOOP
    PERFORM cron.alter_job(
      job_id := v_job.jobid,
      schedule := v_job.schedule,
      command := $command$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/speed-to-lead-check',
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

  -- 5) recover-stuck-otp-daily
  FOR v_job IN
    SELECT jobid, schedule, active FROM cron.job WHERE jobname = 'recover-stuck-otp-daily'
  LOOP
    PERFORM cron.alter_job(
      job_id := v_job.jobid,
      schedule := v_job.schedule,
      command := $command$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/recover-stuck-otp',
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

  -- 6) voice-dialer-tick — já aceita x-service-secret; só pluga header
  FOR v_job IN
    SELECT jobid, schedule, active FROM cron.job WHERE jobname = 'voice-dialer-tick'
  LOOP
    PERFORM cron.alter_job(
      job_id := v_job.jobid,
      schedule := v_job.schedule,
      command := $command$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/voice-dialer-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo',
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

  -- 7) Desativar crons JWT-only (não apagar)
  FOR v_job IN
    SELECT jobid, schedule FROM cron.job
    WHERE jobname IN (
      'conversion-classifier-daily',
      'meta-ads-metrics-3h',
      'voice-dialer-health-30min'
    )
  LOOP
    PERFORM cron.alter_job(
      job_id := v_job.jobid,
      schedule := v_job.schedule,
      active := false
    );
  END LOOP;
END;
$migration$;
