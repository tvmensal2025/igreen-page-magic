-- Hotfix 2026-08-08: handoff → Grupo C gravava next_action_at=now e disparava
-- RECALL_60D no mesmo dia. Quem JÁ recebeu o WA de RECALL_60D hoje (BRT) NÃO
-- pode seguir SMS/ligação do marco. Avança para RECALL_90D com +30 dias.
-- Cobre Dulce/Laura e qualquer outra vítima do mesmo bug hoje.

WITH victims AS (
  SELECT DISTINCT lcs.customer_id
  FROM public.lead_cadence_state lcs
  INNER JOIN public.cadence_action_log cal
    ON cal.customer_id = lcs.customer_id
  WHERE cal.stage = 'RECALL_60D'
    AND cal.channel = 'whatsapp'
    AND cal.status IN ('sent', 'queued')
    AND cal.created_at >= ((timezone('America/Sao_Paulo', now()))::date AT TIME ZONE 'America/Sao_Paulo')
    AND lcs.stage IN ('RECALL_60D', 'RECALL_60D_SMS', 'RECALL_60D_CALL')
),
moved AS (
  UPDATE public.lead_cadence_state lcs
  SET
    stage = 'RECALL_90D',
    next_action_at = now() + interval '30 days',
    stage_entered_at = now(),
    paused_reason = null,
    paused_until = null,
    claim_token = null,
    claimed_at = null,
    lease_expires_at = null,
    updated_at = now()
  FROM victims v
  WHERE lcs.customer_id = v.customer_id
  RETURNING lcs.customer_id
)
UPDATE public.outbound_effects oe
SET
  status = 'released',
  error_code = 'hotfix_handoff_c_same_day',
  updated_at = now()
WHERE oe.customer_id IN (SELECT customer_id FROM moved)
  AND oe.status IN ('reserved', 'failed_retryable')
  AND oe.reserved_at >= ((timezone('America/Sao_Paulo', now()))::date AT TIME ZONE 'America/Sao_Paulo')
  AND (
    oe.stage IN ('RECALL_60D', 'RECALL_60D_SMS', 'RECALL_60D_CALL')
    OR oe.idempotency_key ILIKE '%RECALL_60D%'
  );
