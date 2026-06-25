-- Desativação formal do Portal 1 (worker-portal/, Playwright).
-- Todos os cadastros já são despachados ao Portal 2 (worker-portal-2).
-- Remove o setting legado para evitar fallback acidental em código futuro.
DELETE FROM public.settings WHERE key = 'portal_worker_url';