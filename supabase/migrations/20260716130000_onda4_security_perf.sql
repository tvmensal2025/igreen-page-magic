-- Onda 4 — segurança residual (AUD-015/016) + índice performance flush
-- ADITIVA: REPLACE function + DROP/CREATE policies + índice parcial.
-- Context7/Supabase: SECURITY DEFINER deve fixar search_path (preferível '').

-- ── AUD-015: SECURITY DEFINER sem search_path ─────────────────────────────
CREATE OR REPLACE FUNCTION public.get_referral_partner_metrics()
RETURNS TABLE(partner_id UUID, partner_nome TEXT, lead_count BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    rp.id AS partner_id,
    rp.nome AS partner_nome,
    COUNT(c.id) AS lead_count
  FROM public.referral_partners rp
  LEFT JOIN public.customers c ON c.referral_partner_id = rp.id
  WHERE rp.consultant_id = (SELECT auth.uid())
    AND rp.is_active = true
  GROUP BY rp.id, rp.nome
  ORDER BY lead_count DESC;
$$;

-- ── AUD-016: daily_reheat_queue não deve ser legível por qualquer auth ─────
DROP POLICY IF EXISTS "auth read daily_reheat_queue" ON public.daily_reheat_queue;
CREATE POLICY "consultant read own daily_reheat_queue"
  ON public.daily_reheat_queue FOR SELECT TO authenticated
  USING (
    consultant_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

-- runs: agregados operacionais — só admin
DROP POLICY IF EXISTS "auth read daily_reheat_runs" ON public.daily_reheat_runs;
CREATE POLICY "admin read daily_reheat_runs"
  ON public.daily_reheat_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ── Performance: fila de mídia pendente (cron flush) ──────────────────────
CREATE INDEX IF NOT EXISTS pending_outbound_media_due_partial_idx
  ON public.pending_outbound_media (scheduled_for)
  WHERE succeeded_at IS NULL;
