-- Aviso "boleto chegou" → iGreen Club (config editável + toggle + cron horário).
-- Copy voltada ao leigo: NÃO usar a palavra "PDF" em textos padrão ao cliente.

ALTER TABLE public.igreen_automation_settings
  ADD COLUMN IF NOT EXISTS auto_wa_boleto_chegou boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.igreen_automation_settings.auto_wa_boleto_chegou IS
  'Opt-in: avisar cliente no WhatsApp quando boleto do mês chegar (áudio+texto Club). Default OFF.';

CREATE TABLE IF NOT EXISTS public.boleto_notify_config (
  id text PRIMARY KEY DEFAULT 'global',
  sync_enabled boolean NOT NULL DEFAULT true,
  cron_hour_brt smallint NOT NULL DEFAULT 8
    CHECK (cron_hour_brt >= 0 AND cron_hour_brt <= 23),
  cron_daily boolean NOT NULL DEFAULT true,
  audio_script text NOT NULL DEFAULT '',
  wa_text text NOT NULL DEFAULT '',
  button_boleto_label text NOT NULL DEFAULT 'Receber boleto',
  button_enabled boolean NOT NULL DEFAULT true,
  doc_caption text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.boleto_notify_config IS
  'Textos/horário do aviso de boleto (editável na UI). id=global. Sem palavra PDF ao cliente.';

-- Seed defaults (leigo: "boleto", não "PDF")
INSERT INTO public.boleto_notify_config (
  id, sync_enabled, cron_hour_brt, cron_daily,
  audio_script, wa_text, button_boleto_label, button_enabled, doc_caption
) VALUES (
  'global',
  true,
  8,
  true,
  $audio${{saudacao}} seu boleto de energia do mês já está ativo e disponível. Pode ficar tranquilo: é o boleto normal da iGreen. O melhor lugar para conferir é o aplicativo iGreen Club — lá você vê a fatura e ainda aproveita descontos em farmácias, restaurantes, cinemas e milhares de parceiros. Abre o app, confere com calma, e se tiver dúvida, responde aqui.$audio$,
  $wa${{saudacao}}seu boleto de *{{mes}}* já está disponível 💚

Valor: *R$ {{valor}}*
Vencimento: *{{vencimento}}*

Ele está no aplicativo *iGreen Club* — é o lugar oficial para ver a fatura e os descontos (farmácia e parceiros).

👉 Acesse o app:
{{link_club}}

Se quiser o boleto aqui no Zap, toque em *Receber boleto* (ou digite *1*).$wa$,
  'Receber boleto',
  true,
  'Segue seu boleto. O lugar oficial continua no app iGreen Club 👆'
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.boleto_notify_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS boleto_notify_config_select_auth ON public.boleto_notify_config;
CREATE POLICY boleto_notify_config_select_auth
  ON public.boleto_notify_config FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS boleto_notify_config_update_auth ON public.boleto_notify_config;
CREATE POLICY boleto_notify_config_update_auth
  ON public.boleto_notify_config FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- Tick horário: a edge decide se a hora BRT bate com cron_hour_brt (editável).
DO $$
BEGIN
  BEGIN PERFORM cron.unschedule('igreen-boleto-notify-hourly'); EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

SELECT cron.schedule(
  'igreen-boleto-notify-hourly',
  '5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/igreen-boleto-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo',
      'x-internal-secret', COALESCE((SELECT trim(both '"' from value::text) FROM public.settings WHERE key = 'embed_internal_token' LIMIT 1), ''),
      'x-service-secret', COALESCE((SELECT trim(both '"' from value::text) FROM public.settings WHERE key = 'service_shared_secret' LIMIT 1), '')
    ),
    body := jsonb_build_object('action', 'tick', 'triggered_at', now(), 'dryRun', false),
    timeout_milliseconds := 120000
  ) AS request_id;
  $cron$
);
