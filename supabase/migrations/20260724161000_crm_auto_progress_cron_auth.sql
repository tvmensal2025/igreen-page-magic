-- P1-6: crm-auto-progress passou a exigir assertCronAuth na edge.
-- Esta migration só ACRESCENTA os headers de segredo ao job já existente.
--
-- Decisões de segurança desta versão:
--  * O job é selecionado por jobname; schedule e active atuais são preservados.
--  * O header Authorization/anon e o body seguem IDÊNTICOS aos de hoje, então o
--    gateway continua aceitando a chamada exatamente como já aceita. Nenhuma
--    mudança de verify_jwt é necessária e a ordem entre deploy e migration deixa
--    de importar.
--  * Os segredos são lidos de public.settings em tempo de execução; nenhum
--    segredo novo entra no arquivo.
--  * Enquanto ENFORCE_CRON_AUTH estiver desligado, assertCronAuth opera em modo
--    grace, portanto o job funciona antes e depois desta migration.

DO $migration$
DECLARE
  v_job record;
BEGIN
  FOR v_job IN
    SELECT jobid, schedule, active
    FROM cron.job
    WHERE jobname = 'crm-auto-progress-daily'
  LOOP
    PERFORM cron.alter_job(
      job_id := v_job.jobid,
      schedule := v_job.schedule,
      command := $command$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/crm-auto-progress',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb
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
    body := '{"source": "cron"}'::jsonb
  ) AS request_id;
      $command$,
      active := v_job.active
    );
  END LOOP;
END
$migration$;
