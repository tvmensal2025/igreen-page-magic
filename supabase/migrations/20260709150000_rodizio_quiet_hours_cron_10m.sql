-- Quiet hours configuráveis por pool (padrão: não envia de 21h às 09h BRT)
-- + cron de métricas a cada 10 min (antes 2h, quebrava intervalo 30/60).

ALTER TABLE public.rodizio_pools
  ADD COLUMN IF NOT EXISTS metrics_quiet_start_hour int NOT NULL DEFAULT 21
    CHECK (metrics_quiet_start_hour >= 0 AND metrics_quiet_start_hour <= 23),
  ADD COLUMN IF NOT EXISTS metrics_quiet_end_hour int NOT NULL DEFAULT 9
    CHECK (metrics_quiet_end_hour >= 0 AND metrics_quiet_end_hour <= 23);

COMMENT ON COLUMN public.rodizio_pools.metrics_quiet_start_hour IS
  'Hora BRT (0-23) em que começa o silêncio das atualizações de métricas. Ex: 21 = para de enviar às 21h.';
COMMENT ON COLUMN public.rodizio_pools.metrics_quiet_end_hour IS
  'Hora BRT (0-23) em que termina o silêncio. Ex: 9 = volta a enviar a partir das 09h. Se start=end, quiet hours desligado.';

DO $$ BEGIN
  PERFORM cron.unschedule('rodizio-metrics-2h');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  PERFORM cron.unschedule('rodizio-metrics-10m');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'rodizio-metrics-10m',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url:='https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/rodizio-metrics-broadcast',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body:=concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);
