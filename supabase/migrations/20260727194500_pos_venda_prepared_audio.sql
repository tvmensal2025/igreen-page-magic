-- Pós-venda: áudio pré-gerado por cliente/marco (TTS personalizado).
-- Usado pelo cron pos-venda-audio-prep; o auto-progress consome se saudacao_bucket bater.

CREATE TABLE IF NOT EXISTS public.pos_venda_prepared_audio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  stage_key text NOT NULL,
  audio_url text NOT NULL,
  spoken_text text NOT NULL,
  saudacao_bucket text NOT NULL CHECK (saudacao_bucket IN ('manha', 'tarde', 'noite')),
  planned_send_at timestamptz NOT NULL,
  prepared_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_venda_prepared_audio_customer_stage_uq UNIQUE (customer_id, stage_key)
);

CREATE INDEX IF NOT EXISTS pos_venda_prepared_audio_planned_idx
  ON public.pos_venda_prepared_audio (planned_send_at);

CREATE INDEX IF NOT EXISTS pos_venda_prepared_audio_consultant_idx
  ON public.pos_venda_prepared_audio (consultant_id);

ALTER TABLE public.pos_venda_prepared_audio ENABLE ROW LEVEL SECURITY;

-- Só service_role / backends (sem policy para authenticated) — igual logs internos.

COMMENT ON TABLE public.pos_venda_prepared_audio IS
  'TTS pós-venda pré-gerado (Olá nome + saudação slot + corpo). Consumido no envio se saudacao_bucket bater.';

-- Higiene: leftovers no kanban (texto placeholder sem {{saudacao}}) não devem apontar legacy.ogg
UPDATE public.kanban_stages
SET auto_message_media_url = NULL
WHERE stage_scope = 'pos_venda'
  AND auto_message_media_url IS NOT NULL;

-- Cron horário: prepara áudio mesmo fora da janela 08–20 (ex.: 05 min de cada hora).
DO $$
BEGIN
  BEGIN PERFORM cron.unschedule('pos-venda-audio-prep-hourly'); EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

SELECT cron.schedule(
  'pos-venda-audio-prep-hourly',
  '5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/pos-venda-audio-prep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo',
      'x-internal-secret', COALESCE((SELECT trim(both '"' from value::text) FROM public.settings WHERE key = 'embed_internal_token' LIMIT 1), ''),
      'x-service-secret', COALESCE((SELECT trim(both '"' from value::text) FROM public.settings WHERE key = 'service_shared_secret' LIMIT 1), '')
    ),
    body := jsonb_build_object('triggered_at', now(), 'limit', 40),
    timeout_milliseconds := 120000
  ) AS request_id;
  $cron$
);
