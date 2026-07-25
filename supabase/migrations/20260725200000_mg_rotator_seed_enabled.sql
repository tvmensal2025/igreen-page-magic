-- Seed controlado no cron MG (piloto): 1 cidade/tick via seed_explorer (full).
-- consultant_id do piloto no body — multi-consultor entra via auto-pause tick.

DO $$
DECLARE
  v_job RECORD;
BEGIN
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
    body := '{"seed":true,"activate_next":true,"consultant_id":"0c2711ad-4836-41e6-afba-edd94f698ae3"}'::jsonb
  ) AS request_id;
      $command$,
      active := v_job.active
    );
  END LOOP;
END $$;
