-- Fecha EXECUTE anon/PUBLIC em triggers DEFINER.
-- A migration Lovable só fez REVOKE FROM anon; o grant default PUBLIC continuava.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prorettype = 'trigger'::regtype
      AND p.proname IN (
        'assign_pool_member_suffix',
        'cadence_ensure_state_from_customer',
        'cadence_on_inbound_message',
        'clear_attendance_auto_close_on_inbound',
        'enforce_consultant_id_is_auth_user',
        'enforce_customer_meta_ad_campaign_guard',
        'enforce_reserved_assistant_names',
        'guard_sale_stage_progress_identity',
        'pause_cadence_on_manual_send',
        'tg_lead_cadence_block_cliente'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC', r.proname, r.args);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM anon', r.proname, r.args);
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.%I(%s) TO postgres, service_role, authenticated',
      r.proname,
      r.args
    );
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.audit_flow_activate_rules(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_flow_activate_rules(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.audit_flow_activate_rules(uuid) TO authenticated, service_role;
