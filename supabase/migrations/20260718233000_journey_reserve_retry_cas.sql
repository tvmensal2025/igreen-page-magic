-- ============================================================================
-- Jornada A/B/C — retomada atômica de efeitos released/failed_retryable
-- Aditiva: CREATE OR REPLACE mantendo a MESMA assinatura e retorno da RPC
-- criada em 20260718230000_journey_abc_core.sql (sem overload).
-- Mudança: se o efeito já existe em estado retomável (released ou
-- failed_retryable), o banco faz o CAS (status=reserved, attempt_count+1)
-- e devolve acquired=true para exatamente UM worker.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reserve_outbound_effect(
  p_idempotency_key text,
  p_engine_key text,
  p_channel text,
  p_customer_id uuid DEFAULT NULL,
  p_consultant_id uuid DEFAULT NULL,
  p_journey_id uuid DEFAULT NULL,
  p_stage text DEFAULT NULL,
  p_stage_sequence integer DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_template_key text DEFAULT NULL,
  p_template_version text DEFAULT NULL,
  p_payload_hash text DEFAULT NULL,
  p_destination_hash text DEFAULT NULL,
  p_run_id uuid DEFAULT NULL,
  p_claim_id text DEFAULT NULL,
  p_action_key text DEFAULT NULL
)
RETURNS TABLE (effect_id uuid, acquired boolean, current_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency_key required';
  END IF;

  INSERT INTO public.outbound_effects (
    idempotency_key, engine_key, action_key, channel, customer_id, consultant_id,
    journey_id, stage, stage_sequence, provider, template_key, template_version,
    payload_hash, destination_hash, run_id, claim_id, status, attempt_count
  ) VALUES (
    trim(p_idempotency_key), p_engine_key, p_action_key, p_channel, p_customer_id,
    p_consultant_id, p_journey_id, p_stage, p_stage_sequence, p_provider,
    p_template_key, p_template_version, p_payload_hash, p_destination_hash,
    p_run_id, p_claim_id, 'reserved', 1
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, true, 'reserved'::text;
    RETURN;
  END IF;

  -- Efeito já existe: retomada atômica APENAS de estados retomáveis.
  -- O WHERE por status garante que somente um worker vence o UPDATE.
  UPDATE public.outbound_effects e
     SET status        = 'reserved',
         reserved_at   = now(),
         attempt_count = e.attempt_count + 1,
         run_id        = COALESCE(p_run_id, e.run_id),
         claim_id      = COALESCE(p_claim_id, e.claim_id),
         error_code    = NULL,
         updated_at    = now()
   WHERE e.idempotency_key = trim(p_idempotency_key)
     AND e.status IN ('released', 'failed_retryable')
  RETURNING e.id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, true, 'reserved'::text;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT e.id, false, e.status
      FROM public.outbound_effects e
     WHERE e.idempotency_key = trim(p_idempotency_key);
END;
$$;

-- Grants inalterados (mesma assinatura), reafirmados por segurança.
REVOKE ALL ON FUNCTION public.reserve_outbound_effect(text, text, text, uuid, uuid, uuid, text, integer, text, text, text, text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_outbound_effect(text, text, text, uuid, uuid, uuid, text, integer, text, text, text, text, text, uuid, text, text) TO service_role;
