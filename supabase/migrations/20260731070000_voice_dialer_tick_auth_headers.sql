-- voice-dialer-tick: realinha headers com o padrão satélite + secret dedicado.
-- Causa do 401: migration 20260725210000 passou a enviar só x-internal-secret /
-- x-service-secret, mas a edge só aceitava x-voice-dialer-cron-secret (e
-- SERVICE_SHARED_SECRET, que não existe em public.settings).
-- A edge agora também usa assertCronAuthStrict; este job manda os 3 headers.

DO $mig$
DECLARE
  v_job record;
BEGIN
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
      ),
      'x-voice-dialer-cron-secret', COALESCE(
        (SELECT trim(both '"' from value::text)
           FROM public.settings
          WHERE key = 'voice_dialer_cron_secret'
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
END
$mig$;
