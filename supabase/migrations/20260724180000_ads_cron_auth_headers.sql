-- Ads: reagenda os crons que hoje mandam SÓ `apikey` para também enviarem
-- `x-internal-secret` / `x-service-secret`, no mesmo padrão já usado em
-- 20260716120000_onda3_cron_auth_headers.sql e 20260716140000_ops_cron_fix.
--
-- POR QUE: os handlers de Ads passaram a usar `assertCronAuthStrict`
-- (`_shared/cron-auth.ts`), que NÃO aceita os ramos de grace/legacy. Sem estes
-- headers, estes jobs voltariam 401 e o Ads pararia em cascata:
--   * fb-sync-metrics-6h        → débito da carteira + aplicação do teto
--   * fb-token-refresh-daily    → token expira em ≤7 dias e TODAS as campanhas param
--   * fb-auto-pause             → waste guard
--   * fb-sync-ad-creatives      → sincronismo de criativos
--   * ad-creative-learner       → aprendizado de copy
--   * ad-competitor-scraper     → concorrência
--   * facebook-creative-rotator → rotação de criativo
--
-- ADITIVO: só faz unschedule/schedule dos nomes canônicos abaixo. Não apaga
-- nenhum outro job, não altera cadência e NÃO liga ENFORCE_CRON_AUTH.
--
-- PRÉ-REQUISITO antes de aplicar em produção: `settings.embed_internal_token`
-- precisa existir e não estar vazio (o mesmo valor lido pelo assertCronAuth).
-- Se `settings.service_shared_secret` não existir, o header vai vazio e a
-- autenticação recai no internal token — por isso os dois são enviados.

DO $$
DECLARE
  v_internal text;
BEGIN
  SELECT trim(both '"' from value::text) INTO v_internal
  FROM public.settings WHERE key = 'embed_internal_token' LIMIT 1;

  IF v_internal IS NULL OR v_internal = '' THEN
    RAISE EXCEPTION
      'settings.embed_internal_token ausente/vazio: configure antes, senão os crons de Ads voltam 401';
  END IF;
END $$;

-- ── Unschedule dos nomes canônicos (recriados abaixo com headers) ──────────
-- Os nomes abaixo são os que estão REALMENTE agendados hoje (auditados nas
-- migrations anteriores). Usar nome diferente criaria um job DUPLICADO em vez
-- de substituir o antigo — foi o caso do token refresh, cujo job se chama
-- `fb-token-refresh` (e não `-daily`).
DO $$ BEGIN PERFORM cron.unschedule('fb-auto-pause'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('fb-sync-metrics-6h'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('fb-sync-ad-creatives-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('fb-token-refresh'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('ad-creative-learner-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('ad-competitor-scraper-weekly'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('facebook-creative-rotator-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Aliases legados: já foram aposentados por migrations anteriores, mas se
-- algum tiver sobrevivido em produção ele mandaria só `apikey` e tomaria 401.
DO $$ BEGIN PERFORM cron.unschedule('fb-sync-metrics'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('fb-sync-ad-creatives'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('fb-token-refresh-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('facebook-creative-rotator-12h'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Waste guard: a cada 30 min (mantém cadência de 20260722220000).
SELECT cron.schedule(
  'fb-auto-pause',
  '*/30 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/facebook-auto-pause',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo',
      'x-internal-secret', COALESCE((SELECT trim(both '"' from value::text) FROM public.settings WHERE key = 'embed_internal_token' LIMIT 1), ''),
      'x-service-secret', COALESCE((SELECT trim(both '"' from value::text) FROM public.settings WHERE key = 'service_shared_secret' LIMIT 1), '')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $cron$
);

-- Métricas + débito da carteira: a cada 6h (mantém cadência de 20260708014208).
SELECT cron.schedule(
  'fb-sync-metrics-6h',
  '0 */6 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/facebook-sync-metrics',
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

-- Sync de criativos: diário 04:00 BRT (07:00 UTC).
SELECT cron.schedule(
  'fb-sync-ad-creatives-daily',
  '0 7 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/facebook-sync-ad-creatives',
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

-- Renovação de token da conta-mãe: diário 06:00 UTC (cadência preservada de
-- 20260708014208). Se falhar, TUDO para em ≤7 dias.
SELECT cron.schedule(
  'fb-token-refresh',
  '0 6 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/facebook-token-refresh',
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

-- Aprendizado de copy: diário 07:00 UTC (cadência preservada).
SELECT cron.schedule(
  'ad-creative-learner-daily',
  '0 7 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/ad-creative-learner',
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

-- Concorrência (Ad Library): segunda 06:00 UTC (cadência preservada).
SELECT cron.schedule(
  'ad-competitor-scraper-weekly',
  '0 6 * * 1',
  $cron$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/ad-competitor-scraper',
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

-- Rotação de criativo: diário 08:00 UTC (cadência preservada; o job de 12h foi aposentado em 20260625104735).
SELECT cron.schedule(
  'facebook-creative-rotator-daily',
  '0 8 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/facebook-creative-rotator',
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
