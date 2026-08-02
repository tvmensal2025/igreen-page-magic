/**
 * Prevenção de duplicidade em produção (02/08/2026) - Correção V2.
 */

-- 1. Limpeza de lead_cadence_state (mantém a linha mais recente por customer_id)
WITH ranked_lcs AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY customer_id
      ORDER BY next_action_at DESC NULLS LAST, created_at DESC NULLS LAST, id
    ) AS rn
  FROM public.lead_cadence_state
)
DELETE FROM public.lead_cadence_state lcs
USING ranked_lcs r
WHERE lcs.id = r.id
  AND r.rn > 1;

-- 2. Índice ÚNICO para impedir duplicidade de estado por cliente
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_lead_cadence_state_customer') THEN
    CREATE UNIQUE INDEX uq_lead_cadence_state_customer ON public.lead_cadence_state (customer_id);
  END IF;
END $$;

-- 3. Função para auditar nomes repetidos que estão na cadência
CREATE OR REPLACE FUNCTION public.audit_duplicate_leads_in_cadence()
RETURNS TABLE (
  consultant_id uuid,
  name text,
  occurrences bigint,
  customer_ids uuid[]
) 
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    c.consultant_id, 
    c.name, 
    COUNT(*) as occurrences,
    array_agg(c.id) as customer_ids
  FROM public.customers c
  JOIN public.lead_cadence_state lcs ON lcs.customer_id = c.id
  WHERE c.name IS NOT NULL 
    AND c.name <> ''
    AND lcs.stage::text <> 'WON'
  GROUP BY c.consultant_id, c.name
  HAVING COUNT(*) > 1;
$$;

GRANT EXECUTE ON FUNCTION public.audit_duplicate_leads_in_cadence() TO authenticated;
GRANT EXECUTE ON FUNCTION public.audit_duplicate_leads_in_cadence() TO service_role;

-- 4. Trava de idempotência no log de disparos (usando idempotency_key e result_status)
-- Nota: outbound_message_log usa idempotency_key como trava primária.
-- O índice uq_lead_cadence_state_customer já é a trava principal para A/B/C.
