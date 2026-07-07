
-- =========================================================================
-- 1) Mapa de deduplicação: dup_id -> canonical_id
-- =========================================================================
CREATE TEMP TABLE _igreen_dedupe_map ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    id, consultant_id, igreen_code,
    ROW_NUMBER() OVER (
      PARTITION BY consultant_id, igreen_code
      ORDER BY
        (phone_whatsapp LIKE 'sem_celular_%')::int ASC,
        created_at ASC,
        id ASC
    ) AS rn
  FROM public.customers
  WHERE customer_origin = 'igreen_sync' AND igreen_code IS NOT NULL
),
canon AS (
  SELECT consultant_id, igreen_code, id AS canonical_id
  FROM ranked WHERE rn = 1
)
SELECT r.id AS dup_id, c.canonical_id
FROM ranked r
JOIN canon c ON c.consultant_id = r.consultant_id AND c.igreen_code = r.igreen_code
WHERE r.rn > 1;

-- =========================================================================
-- 2) Tabelas com customer_id como PK/UNIQUE: descartar rows das dups
--    (elas eram placeholders sem fluxo útil; a canônica mantém o histórico).
-- =========================================================================
DELETE FROM public.customer_flow_state
 WHERE customer_id IN (SELECT dup_id FROM _igreen_dedupe_map);

DELETE FROM public.lead_insights
 WHERE customer_id IN (SELECT dup_id FROM _igreen_dedupe_map);

-- =========================================================================
-- 3) Reassocia FKs restantes (todas com customer_id não-único) para a canônica.
-- =========================================================================
DO $$
DECLARE
  tbl text;
  child_tables text[] := ARRAY[
    'conversations', 'crm_deals', 'ai_decisions',
    'capture_field_suggestions', 'engine_logs',
    'portal2_audit_traces', 'reactivation_sends',
    'sales', 'proposals', 'solar_roof_analyses', 'captured_leads',
    'igreen_customer_boletos', 'igreen_customer_devolutivas'
  ];
BEGIN
  FOREACH tbl IN ARRAY child_tables LOOP
    EXECUTE format(
      'UPDATE public.%I t SET customer_id = m.canonical_id
       FROM _igreen_dedupe_map m
       WHERE t.customer_id = m.dup_id',
      tbl
    );
  END LOOP;
END $$;

-- =========================================================================
-- 4) Remove as linhas duplicadas de customers.
-- =========================================================================
DELETE FROM public.customers c
USING _igreen_dedupe_map m
WHERE c.id = m.dup_id;

-- =========================================================================
-- 5) Índice único parcial — impede regressão.
-- =========================================================================
CREATE UNIQUE INDEX IF NOT EXISTS customers_igreen_code_per_consultant
  ON public.customers (consultant_id, igreen_code)
  WHERE igreen_code IS NOT NULL AND customer_origin = 'igreen_sync';
