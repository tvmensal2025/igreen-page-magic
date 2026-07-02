
-- ─── 1) Impede 2 pools ativas para a mesma campanha (Furo 1) ───────────────
CREATE UNIQUE INDEX IF NOT EXISTS rodizio_pools_active_campaign_uniq
  ON public.rodizio_pools (campaign_id)
  WHERE is_active = true AND campaign_id IS NOT NULL;

-- ─── 2) Fila de revisão manual em customers (Furo 1) ──────────────────────
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS needs_manual_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_review_reason text,
  ADD COLUMN IF NOT EXISTS manual_review_at timestamptz;

CREATE INDEX IF NOT EXISTS customers_manual_review_idx
  ON public.customers (consultant_id, manual_review_at DESC)
  WHERE needs_manual_review = true;

-- ─── 3) Rastreio do resultado do rodízio (Furo 3) ─────────────────────────
ALTER TABLE public.campaign_match_log
  ADD COLUMN IF NOT EXISTS rodizio_outcome text;

CREATE INDEX IF NOT EXISTS campaign_match_log_rodizio_outcome_idx
  ON public.campaign_match_log (created_at DESC)
  WHERE rodizio_outcome IS NOT NULL;
