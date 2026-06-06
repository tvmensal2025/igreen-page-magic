-- =====================================================
-- igreen-sync-worker: settings de URL e secret
-- Consumido pela edge function sync-igreen-customers
-- para localizar o worker Playwright na VPS (Easypanel).
--
-- IMPORTANTE: após o deploy no Easypanel, atualize
-- igreen_sync_worker_secret com o valor real do WORKER_TOKEN.
--
-- Easypanel config:
--   Source:     Github (tvmensal2025/igreen-official-portal, main)
--   Build Path: worker-igreen-sync
--   Port:       3102
--   Domain:     igreen-sync.d9v83a.easypanel.host
--   Env:
--     PORT=3102
--     NODE_ENV=production
--     PLAYWRIGHT_HEADLESS=true
--     WORKER_TOKEN=<segredo longo — gerado com: openssl rand -hex 32>
--     SESSION_TTL_MS=1800000
--     MAX_SESSIONS=20
-- =====================================================

INSERT INTO public.settings (key, value) VALUES
  ('igreen_sync_worker_url',    'https://igreen-worker-igreen.d9v63q.easypanel.host'),
  ('igreen_sync_worker_secret', 'igreen_sync_w0rk3r_s3cr3t_2026_x9k2p')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
