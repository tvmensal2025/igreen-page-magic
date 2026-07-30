-- Limiar de alerta: timestamp do último disparo (dedup 24h) + cron.
ALTER TABLE public.referral_partners
  ADD COLUMN IF NOT EXISTS banner_alert_last_at timestamptz NULL;

COMMENT ON COLUMN public.referral_partners.banner_alert_last_at IS
  'Último alerta WA do limiar banner_alert_threshold (dedup ~24h).';

-- Cron a cada 15 min → edge partner-banner-alerts-cron
DO $$
BEGIN
  BEGIN PERFORM cron.unschedule('partner-banner-alerts-15min'); EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

SELECT cron.schedule(
  'partner-banner-alerts-15min',
  '*/15 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/partner-banner-alerts-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo',
      'x-internal-secret', COALESCE((SELECT trim(both '"' from value::text) FROM public.settings WHERE key = 'embed_internal_token' LIMIT 1), ''),
      'x-service-secret', COALESCE((SELECT trim(both '"' from value::text) FROM public.settings WHERE key = 'service_shared_secret' LIMIT 1), '')
    ),
    body := jsonb_build_object('triggered_at', now())
  ) AS request_id;
  $cron$
);
