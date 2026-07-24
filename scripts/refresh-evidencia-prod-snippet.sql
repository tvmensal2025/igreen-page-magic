-- Snapshot read-only da evidência de produção.
-- Execute via MCP Supabase (execute_sql) ou psql com uma conexão de leitura.
-- Não altera schema nem dados; mantenha o bloco em transação READ ONLY.

BEGIN TRANSACTION READ ONLY;

-- Customers.
SELECT
  count(*) AS customers,
  count(*) FILTER (WHERE do_not_contact) AS bloqueados,
  count(*) FILTER (WHERE portal_submitted_at IS NOT NULL) AS portal_submitted
FROM public.customers;

-- Gates e caps efetivos.
SELECT
  id,
  bot_global_enabled,
  cadence_engine_enabled,
  bot_engine_production_mode,
  cadence_window,
  updated_at
FROM public.app_settings
WHERE id = 'global';

SELECT
  id,
  enabled,
  live_dispatch_enabled,
  cap_b,
  cap_c,
  cap_global_outreach,
  daily_whapi_cap,
  window_start_brt,
  window_end_brt,
  weekdays_only,
  updated_at
FROM public.daily_reheat_settings
WHERE id = 'global';

-- Views: security_invoker aparece em reloptions quando configurado.
SELECT
  n.nspname AS schema,
  c.relname AS view_name,
  coalesce(array_to_string(c.reloptions, ', '), '') AS reloptions
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind = 'v'
  AND n.nspname = 'public'
ORDER BY c.relname;

-- Voz: totais, distribuição de status e bloqueios.
SELECT 'voice_call_logs' AS source, count(*) AS total FROM public.voice_call_logs
UNION ALL SELECT 'voice_sms_log', count(*) FROM public.voice_sms_log
UNION ALL SELECT 'voice_campaigns', count(*) FROM public.voice_campaigns
UNION ALL SELECT 'voice_dnc_list', count(*) FROM public.voice_dnc_list
ORDER BY source;

SELECT coalesce(status, '(null)') AS status, count(*) AS total
FROM public.voice_call_logs
GROUP BY status
ORDER BY total DESC, status;

SELECT coalesce(reason, '(null)') AS reason, count(*) AS total
FROM public.voice_dnc_list
GROUP BY reason
ORDER BY total DESC, reason;

COMMIT;
