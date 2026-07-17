-- daily-reheat: next_action_at + cron deixa de forçar dryRun eterno
-- Live continua protegido pelos cadeados (toggle + enabled + live_dispatch + bot_global).

ALTER TABLE public.daily_reheat_queue
  ADD COLUMN IF NOT EXISTS next_action_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_daily_reheat_queue_due
  ON public.daily_reheat_queue (cycle_date, status, next_action_at);

COMMENT ON COLUMN public.daily_reheat_queue.next_action_at IS
  'Quando o passo atual fica due para o cron (máquina de estados A/B).';

-- Cron: sem dryRun:true fixo — envio só se cadeados ON no código da edge.
DO $$ BEGIN PERFORM cron.unschedule('daily-reheat-tick'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'daily-reheat-tick',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/daily-reheat-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo',
      'x-internal-secret', COALESCE(
        (SELECT trim(both '"' from value::text) FROM public.settings WHERE key = 'embed_internal_token' LIMIT 1),
        ''
      )
    ),
    body := jsonb_build_object('time', now()::text)
  ) AS request_id;
  $$
);
