-- Anti-duplicidade follow-ups + reconcile pending reativação
-- ADITIVA: sem apagar dados; sem desligar automações.

-- 1) Reativação: pending órfão (>20 min) → failed (libera unique inflight)
CREATE OR REPLACE FUNCTION public.reconcile_stale_reactivation_pending(
  p_stale_minutes integer DEFAULT 20
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_minutes integer := GREATEST(5, LEAST(COALESCE(p_stale_minutes, 20), 120));
BEGIN
  WITH stale AS (
    UPDATE public.reactivation_sends
       SET status = 'failed',
           error_reason = COALESCE(NULLIF(error_reason, ''), 'pending_stale_recovered')
     WHERE status = 'pending'
       AND sent_at < now() - make_interval(mins => v_minutes)
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM stale;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_stale_reactivation_pending(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_stale_reactivation_pending(integer) TO service_role;

COMMENT ON FUNCTION public.reconcile_stale_reactivation_pending(integer) IS
  'Libera reservas pending órfãs da reativação (worker morto após insert, antes do send).';

-- 2) Follow-ups: claim atômico por CAS de next_followup_at (SKIP LOCKED)
-- Empurra next_followup_at para lease de 15min; worker finaliza zerando/reagendando.
CREATE OR REPLACE FUNCTION public.claim_due_followups(p_limit integer DEFAULT 50)
RETURNS SETOF public.customers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
BEGIN
  RETURN QUERY
  UPDATE public.customers c
     SET next_followup_at = now() + interval '15 minutes'
   WHERE c.id IN (
     SELECT cu.id
       FROM public.customers cu
      WHERE cu.next_followup_at IS NOT NULL
        AND cu.next_followup_at <= now()
        AND cu.bot_paused = false
        AND cu.do_not_contact = false
        AND cu.assigned_human_id IS NULL
        AND (cu.bot_paused_until IS NULL OR cu.bot_paused_until <= now())
      ORDER BY cu.next_followup_at ASC
      LIMIT v_limit
        FOR UPDATE SKIP LOCKED
   )
  RETURNING c.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_followups(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_followups(integer) TO service_role;

COMMENT ON FUNCTION public.claim_due_followups(integer) IS
  'Reivindica leads com follow-up vencido (SKIP LOCKED). Lease 15min via next_followup_at.';
