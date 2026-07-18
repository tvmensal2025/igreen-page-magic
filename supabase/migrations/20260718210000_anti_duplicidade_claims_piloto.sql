-- ═══════════════════════════════════════════════════════════════════════════
-- Anti-duplicidade piloto (18/07/2026) — ADITIVA, sem desligar automações
--
-- 1) lead_cadence_state: claim_token/lease (RPC claim_due_cadence)
-- 2) daily_reheat_queue: claim_token + RPC claim_due_daily_reheat
-- 3) reactivation_sends: unique inflight (pending) por (customer, template)
-- 4) app_settings: cadence_audience_mode / cadence_allowed_ddds (piloto DDD 34)
--
-- Rollback lógico: Edge Functions deixam de chamar as RPCs; colunas ficam
-- anuláveis e inofensivas. Nada é apagado.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Cadência: colunas de claim ───────────────────────────────────────────
ALTER TABLE public.lead_cadence_state
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_attempts integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.lead_cadence_state.claim_token IS
  'Token do worker que reivindicou a linha; finalização deve casar o token.';
COMMENT ON COLUMN public.lead_cadence_state.lease_expires_at IS
  'Lease do claim. Após expirar, reconciliador ou novo claim pode recuperar.';

CREATE INDEX IF NOT EXISTS idx_lcs_claim_lease
  ON public.lead_cadence_state (lease_expires_at)
  WHERE claim_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_due_cadence(p_limit integer DEFAULT 100)
RETURNS SETOF public.lead_cadence_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 200));
BEGIN
  RETURN QUERY
  UPDATE public.lead_cadence_state lcs
     SET claim_token = gen_random_uuid(),
         claimed_at = now(),
         lease_expires_at = now() + interval '15 minutes',
         claim_attempts = COALESCE(lcs.claim_attempts, 0) + 1,
         -- Soft-lock: empurra next_action_at para o fim do lease se ainda estiver vencido,
         -- evitando SELECT legado sem RPC pegar a mesma linha.
         next_action_at = GREATEST(
           COALESCE(lcs.next_action_at, now()),
           now() + interval '15 minutes'
         )
   WHERE lcs.id IN (
     SELECT s.id
       FROM public.lead_cadence_state s
      WHERE s.next_action_at IS NOT NULL
        AND s.next_action_at <= now()
        AND s.stage::text IS DISTINCT FROM 'WON'
        AND (
          s.claim_token IS NULL
          OR s.lease_expires_at IS NULL
          OR s.lease_expires_at < now()
        )
      ORDER BY s.next_action_at ASC
      LIMIT v_limit
        FOR UPDATE SKIP LOCKED
   )
  RETURNING lcs.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_cadence(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_cadence(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.release_cadence_claim(
  p_id uuid,
  p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer := 0;
BEGIN
  UPDATE public.lead_cadence_state
     SET claim_token = NULL,
         claimed_at = NULL,
         lease_expires_at = NULL
   WHERE id = p_id
     AND claim_token = p_claim_token;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.release_cadence_claim(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_cadence_claim(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_stuck_cadence_claims()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH stuck AS (
    UPDATE public.lead_cadence_state
       SET claim_token = NULL,
           claimed_at = NULL,
           lease_expires_at = NULL,
           -- Reabre imediatamente se o lease morreu sem avanço de estágio.
           next_action_at = LEAST(COALESCE(next_action_at, now()), now())
     WHERE claim_token IS NOT NULL
       AND lease_expires_at IS NOT NULL
       AND lease_expires_at < now()
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM stuck;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_stuck_cadence_claims() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_stuck_cadence_claims() TO service_role;

-- ── 2. Daily reheat: claim_token + RPC ──────────────────────────────────────
ALTER TABLE public.daily_reheat_queue
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_attempts integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.claim_due_daily_reheat(
  p_cycle_date date,
  p_limit integer DEFAULT 40
)
RETURNS SETOF public.daily_reheat_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 40), 100));
BEGIN
  RETURN QUERY
  UPDATE public.daily_reheat_queue q
     SET status = 'claimed',
         claim_token = gen_random_uuid(),
         claimed_at = now(),
         lease_expires_at = now() + interval '20 minutes',
         claim_attempts = COALESCE(q.claim_attempts, 0) + 1,
         updated_at = now()
   WHERE q.id IN (
     SELECT d.id
       FROM public.daily_reheat_queue d
      WHERE d.cycle_date = p_cycle_date
        AND d.status = 'planned'
        AND d.next_action_at IS NOT NULL
        AND d.next_action_at <= now()
      ORDER BY d.next_action_at ASC
      LIMIT v_limit
        FOR UPDATE SKIP LOCKED
   )
  RETURNING q.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_daily_reheat(date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_daily_reheat(date, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_stuck_daily_reheat_claims()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH stuck AS (
    UPDATE public.daily_reheat_queue
       SET status = CASE WHEN COALESCE(claim_attempts, 0) >= 3 THEN 'blocked' ELSE 'planned' END,
           skip_reason = CASE
             WHEN COALESCE(claim_attempts, 0) >= 3 THEN COALESCE(skip_reason, 'stuck_claimed_max_attempts')
             ELSE COALESCE(skip_reason, 'stuck_claimed_recovered')
           END,
           claim_token = NULL,
           claimed_at = NULL,
           lease_expires_at = NULL,
           updated_at = now()
     WHERE status = 'claimed'
       AND claimed_at IS NOT NULL
       AND claimed_at < now() - interval '20 minutes'
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM stuck;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_stuck_daily_reheat_claims() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_stuck_daily_reheat_claims() TO service_role;

-- ── 3. Reativação: no máximo um pending por (customer, template) ────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_reactivation_sends_inflight
  ON public.reactivation_sends (customer_id, template_id)
  WHERE status = 'pending' AND template_id IS NOT NULL;

COMMENT ON INDEX public.uq_reactivation_sends_inflight IS
  'Impede dois workers de reservarem o mesmo (customer, template) antes do envio.';

-- ── 4. Público piloto DDD 34 (configurável; default enforced) ───────────────
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS cadence_audience_mode text NOT NULL DEFAULT 'enforced',
  ADD COLUMN IF NOT EXISTS cadence_allowed_ddds jsonb NOT NULL DEFAULT '["34"]'::jsonb;

COMMENT ON COLUMN public.app_settings.cadence_audience_mode IS
  'off | shadow | enforced — público da cadência por DDD.';
COMMENT ON COLUMN public.app_settings.cadence_allowed_ddds IS
  'Lista JSON de DDDs permitidos no piloto (ex.: ["34"]).';

UPDATE public.app_settings
   SET cadence_audience_mode = COALESCE(NULLIF(cadence_audience_mode, ''), 'enforced'),
       cadence_allowed_ddds = COALESCE(cadence_allowed_ddds, '["34"]'::jsonb)
 WHERE id = 'global';
