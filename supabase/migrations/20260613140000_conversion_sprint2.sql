-- Conversão Sprint 2: stats de outcome (tenant-safe) + cron de classificação por regras.
-- Complementa as migrations 20260613120000 e 20260613130000.

-- ─── 1) RPC reactivation_outcome_stats: resultados do reaquecimento ──────────
-- Agrega reactivation_sends por outcome para o consultor logado (ou admin).
-- SECURITY DEFINER com filtro explícito por auth.uid() — mesma lição do
-- count_inbound_messages: nunca confiar só no UUID passado.
CREATE OR REPLACE FUNCTION public.reactivation_outcome_stats(
  p_consultant_id uuid DEFAULT NULL,
  p_since timestamptz DEFAULT NULL
)
RETURNS TABLE(
  total            bigint,
  sent             bigint,
  failed           bigint,
  responded        bigint,
  advanced         bigint,
  abandoned        bigint,
  pending_outcome  bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped AS (
    SELECT rs.*
    FROM public.reactivation_sends rs
    WHERE (
        -- Só vê os próprios envios, admin vê tudo, service_role idem.
        rs.consultant_id = auth.uid()
        OR has_role(auth.uid(), 'admin'::app_role)
        OR auth.role() = 'service_role'
      )
      AND (p_consultant_id IS NULL OR rs.consultant_id = p_consultant_id)
      AND (p_since IS NULL OR rs.sent_at >= p_since)
  )
  SELECT
    COUNT(*)::bigint                                                   AS total,
    COUNT(*) FILTER (WHERE status = 'sent')::bigint                    AS sent,
    COUNT(*) FILTER (WHERE status = 'failed')::bigint                  AS failed,
    COUNT(*) FILTER (WHERE outcome = 'responded')::bigint              AS responded,
    COUNT(*) FILTER (WHERE outcome = 'advanced')::bigint               AS advanced,
    COUNT(*) FILTER (WHERE outcome = 'abandoned')::bigint              AS abandoned,
    COUNT(*) FILTER (WHERE outcome IS NULL AND status = 'sent')::bigint AS pending_outcome
  FROM scoped;
$$;

GRANT EXECUTE ON FUNCTION public.reactivation_outcome_stats(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reactivation_outcome_stats(uuid, timestamptz) TO service_role;

-- ─── 2) RPC reactivation_outcome_by_step: resultado por etapa do funil ───────
-- Permite identificar quais etapas convertem melhor após reaquecimento.
CREATE OR REPLACE FUNCTION public.reactivation_outcome_by_step(
  p_consultant_id uuid DEFAULT NULL,
  p_since timestamptz DEFAULT NULL
)
RETURNS TABLE(
  conversation_step text,
  total             bigint,
  responded         bigint,
  advanced          bigint,
  abandoned         bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(rs.conversation_step, 'desconhecido') AS conversation_step,
    COUNT(*)::bigint                                          AS total,
    COUNT(*) FILTER (WHERE rs.outcome = 'responded')::bigint  AS responded,
    COUNT(*) FILTER (WHERE rs.outcome = 'advanced')::bigint   AS advanced,
    COUNT(*) FILTER (WHERE rs.outcome = 'abandoned')::bigint  AS abandoned
  FROM public.reactivation_sends rs
  WHERE (
      rs.consultant_id = auth.uid()
      OR has_role(auth.uid(), 'admin'::app_role)
      OR auth.role() = 'service_role'
    )
    AND (p_consultant_id IS NULL OR rs.consultant_id = p_consultant_id)
    AND (p_since IS NULL OR rs.sent_at >= p_since)
  GROUP BY COALESCE(rs.conversation_step, 'desconhecido')
  ORDER BY total DESC;
$$;

GRANT EXECUTE ON FUNCTION public.reactivation_outcome_by_step(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reactivation_outcome_by_step(uuid, timestamptz) TO service_role;

-- ─── 3) Cron: classificação por regras (0 tokens) a cada 15 min ──────────────
-- Processa leads com needs_reclassify=true entre TODOS os consultores. Seguro
-- porque o scope global só aplica regras determinísticas (sem chamar IA).
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'conversion-classifier-15min') THEN
    PERFORM cron.unschedule('conversion-classifier-15min');
  END IF;
END $$;

SELECT cron.schedule(
  'conversion-classifier-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/lead-temperature-classifier',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body := '{"scope":"needs_reclassify_global"}'::jsonb
  ) AS request_id;
  $$
);
