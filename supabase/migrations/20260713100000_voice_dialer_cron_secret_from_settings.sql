-- B8 fix: remove secret hardcoded do job voice-dialer-tick.
-- O secret passa a ser lido de public.settings (key = voice_dialer_cron_secret),
-- no mesmo padrão de process-followups → embed_internal_token.
--
-- Migração ADITIVA: não apaga a migration antiga; só re-agenda o cron.
-- Extrai o valor atual do job (se existir) para settings, sem regravar o
-- segredo no source deste arquivo.

DO $extract$
DECLARE
  existing_cmd text;
  extracted text;
BEGIN
  SELECT j.command INTO existing_cmd
  FROM cron.job j
  WHERE j.jobname = 'voice-dialer-tick'
  LIMIT 1;

  IF existing_cmd IS NOT NULL THEN
    extracted := (regexp_match(existing_cmd, 'x-voice-dialer-cron-secret"\s*:\s*"([a-fA-F0-9]+)"'))[1];
  END IF;

  IF extracted IS NOT NULL AND length(extracted) >= 16 THEN
    INSERT INTO public.settings (key, value)
    VALUES ('voice_dialer_cron_secret', extracted)
    ON CONFLICT (key) DO NOTHING;
  END IF;
END
$extract$;

DO $mig$
BEGIN
  BEGIN
    PERFORM cron.unschedule('voice-dialer-tick');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END
$mig$;

SELECT cron.schedule(
  'voice-dialer-tick',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/voice-dialer-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo',
      'x-voice-dialer-cron-secret', COALESCE(
        (
          SELECT trim(both '"' from value)
          FROM public.settings
          WHERE key = 'voice_dialer_cron_secret'
          LIMIT 1
        ),
        ''
      )
    ),
    body := concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

COMMENT ON TABLE public.settings IS
  'Flags/config. voice_dialer_cron_secret deve coincidir com o Edge secret VOICE_DIALER_CRON_SECRET.';
