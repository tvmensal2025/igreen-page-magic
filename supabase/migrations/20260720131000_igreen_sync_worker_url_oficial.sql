-- URL oficial do worker de LEITURA (carteira/sync) — NÃO confundir com portal2.
-- Verificado ao vivo 2026-07-20: GET /health ok em igreen-worker-igreen.d9v63q.easypanel.host
-- Código: supabase/functions/_shared/igreen-sync-worker.ts

INSERT INTO public.settings (key, value) VALUES
  (
    'igreen_sync_worker_url',
    'https://igreen-worker-igreen.d9v63q.easypanel.host'
  ),
  (
    'igreen_sync_worker_official_note',
    'LEITURA escritório (carteira). Oficial EasyPanel 2026-07-20. NÃO usar portal2_worker_url nem club. Helper: _shared/igreen-sync-worker.ts'
  ),
  (
    'igreen_sync_worker_verified_at',
    '2026-07-20T13:10:00Z'
  )
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
