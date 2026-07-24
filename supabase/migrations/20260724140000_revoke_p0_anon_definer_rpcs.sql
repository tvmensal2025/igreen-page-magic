-- P0: fechar RPCs SECURITY DEFINER que o advisor marcou como executáveis por anon.
-- Callers reais usam service_role:
--   admin-cron-status (edge) → admin_cron_*
--   send-scheduled-messages → claim_scheduled_messages
-- Migrations antigas já REVOKE FROM PUBLIC + GRANT service_role, mas anon/authenticated
-- voltaram a ter EXECUTE (provável recreate / default privileges).

REVOKE ALL ON FUNCTION public.admin_cron_list() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_cron_last_runs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_cron_run_now(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_cron_toggle(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_cron_reschedule(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_scheduled_messages(integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_cron_list() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_cron_last_runs() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_cron_run_now(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_cron_toggle(text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_cron_reschedule(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_scheduled_messages(integer) TO service_role;

COMMENT ON FUNCTION public.admin_cron_run_now(text) IS
  'Só service_role (edge admin-cron-status). 2026-07-24 P0 revoke anon/authenticated.';
COMMENT ON FUNCTION public.claim_scheduled_messages(integer) IS
  'Só service_role (send-scheduled-messages). 2026-07-24 P0 revoke anon/authenticated.';
