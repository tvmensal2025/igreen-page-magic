-- Fecha buraco de retry infinito em outbound_effects.
-- Teto na retomada: failed_retryable < 5; released (soft-defer) < 15.
-- Ao estourar → failed_final (não reabre). Mesma assinatura da RPC.

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
  v_status text;
  -- failed_retryable = falha/ACK reopen (spam real). released = soft-defer/anti-ban (sem envio).
  c_max_retryable constant integer := 5;
  c_max_released constant integer := 15;
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

  -- Retomada atômica com teto por status.
  UPDATE public.outbound_effects e
     SET status        = 'reserved',
         reserved_at   = now(),
         attempt_count = e.attempt_count + 1,
         run_id        = COALESCE(p_run_id, e.run_id),
         claim_id      = COALESCE(p_claim_id, e.claim_id),
         error_code    = NULL,
         updated_at    = now()
   WHERE e.idempotency_key = trim(p_idempotency_key)
     AND (
       (e.status = 'failed_retryable' AND e.attempt_count < c_max_retryable)
       OR (e.status = 'released' AND e.attempt_count < c_max_released)
     )
  RETURNING e.id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, true, 'reserved'::text;
    RETURN;
  END IF;

  -- Estourou o teto em estado retomável → fecha como failed_final.
  UPDATE public.outbound_effects e
     SET status     = 'failed_final',
         error_code = COALESCE(e.error_code, 'max_attempts'),
         updated_at = now()
   WHERE e.idempotency_key = trim(p_idempotency_key)
     AND e.status IN ('released', 'failed_retryable')
     AND (
       (e.status = 'failed_retryable' AND e.attempt_count >= c_max_retryable)
       OR (e.status = 'released' AND e.attempt_count >= c_max_released)
     )
  RETURNING e.id, e.status INTO v_id, v_status;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, false, 'failed_final'::text;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT e.id, false, e.status
      FROM public.outbound_effects e
     WHERE e.idempotency_key = trim(p_idempotency_key);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_outbound_effect(text, text, text, uuid, uuid, uuid, text, integer, text, text, text, text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_outbound_effect(text, text, text, uuid, uuid, uuid, text, integer, text, text, text, text, text, uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.reserve_outbound_effect(text, text, text, uuid, uuid, uuid, text, integer, text, text, text, text, text, uuid, text, text) IS
  'Reserva efeito outbound. Retomada: failed_retryable<5, released<15; estouro → failed_final.';

-- Cura linhas já inflamadas (não reenviam na próxima reserva).
UPDATE public.outbound_effects
   SET status = 'failed_final',
       error_code = COALESCE(error_code, 'max_attempts_heal'),
       updated_at = now()
 WHERE status IN ('released', 'failed_retryable')
   AND (
     (status = 'failed_retryable' AND attempt_count >= 5)
     OR (status = 'released' AND attempt_count >= 15)
   );
