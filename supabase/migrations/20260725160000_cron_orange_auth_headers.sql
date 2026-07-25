-- Crons “laranja”: alinhar headers de auth (x-internal + x-service) via
-- cron.alter_job (sem UPDATE direto em cron.job — permission denied).
-- Não desliga jobs; não cria novos; não mexe em schedule/active.
-- Edge functions correspondentes já usam assertCronAuth + config.toml verify_jwt=false.

DO $migration$
DECLARE
  v_job record;
  v_fn text;
  v_map jsonb := jsonb_build_object(
    'ai-cpl-watchdog-daily', 'ai-cpl-watchdog',
    'crm-auto-progress-daily', 'crm-auto-progress',
    'flow-d-health-cron-hourly', 'flow-d-health-cron',
    'instance-health-cron-hourly', 'instance-health-cron',
    'minio-quota-check-daily', 'minio-quota-check',
    'pos-venda-bucket-cron-daily', 'pos-venda-bucket-cron'
  );
  v_key text;
BEGIN
  FOR v_key, v_fn IN SELECT * FROM jsonb_each_text(v_map)
  LOOP
    FOR v_job IN
      SELECT jobid, schedule, active, command
      FROM cron.job
      WHERE jobname = v_key
    LOOP
      IF v_job.command ILIKE '%x-internal-secret%' THEN
        CONTINUE;
      END IF;

      PERFORM cron.alter_job(
        job_id := v_job.jobid,
        schedule := v_job.schedule,
        command := format(
          $command$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/%s',
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
    body := concat('{"time": "', now(), '"}')::jsonb,
    timeout_milliseconds := 60000
  ) AS request_id;
          $command$,
          v_fn
        ),
        active := v_job.active
      );
    END LOOP;
  END LOOP;
END
$migration$;
