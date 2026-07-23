-- Escala automática de budget por campanha (Cérebro por anúncio).
-- Default false: campanhas existentes NÃO ligam sozinhas.

ALTER TABLE public.facebook_campaigns
  ADD COLUMN IF NOT EXISTS brain_scale_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS brain_scale_step_pct integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS brain_scale_max_budget_cents integer NOT NULL DEFAULT 50000,
  ADD COLUMN IF NOT EXISTS brain_scale_target_cpl_cents integer NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS brain_scale_last_at timestamptz NULL;

ALTER TABLE public.facebook_campaigns
  DROP CONSTRAINT IF EXISTS facebook_campaigns_brain_scale_step_pct_check;
ALTER TABLE public.facebook_campaigns
  ADD CONSTRAINT facebook_campaigns_brain_scale_step_pct_check
  CHECK (brain_scale_step_pct >= 15 AND brain_scale_step_pct <= 30);

ALTER TABLE public.facebook_campaigns
  DROP CONSTRAINT IF EXISTS facebook_campaigns_brain_scale_max_budget_check;
ALTER TABLE public.facebook_campaigns
  ADD CONSTRAINT facebook_campaigns_brain_scale_max_budget_check
  CHECK (brain_scale_max_budget_cents >= 517 AND brain_scale_max_budget_cents <= 50000);

ALTER TABLE public.facebook_campaigns
  DROP CONSTRAINT IF EXISTS facebook_campaigns_brain_scale_target_cpl_check;
ALTER TABLE public.facebook_campaigns
  ADD CONSTRAINT facebook_campaigns_brain_scale_target_cpl_check
  CHECK (brain_scale_target_cpl_cents >= 50 AND brain_scale_target_cpl_cents <= 2000);

CREATE INDEX IF NOT EXISTS idx_fb_campaigns_brain_scale_enabled
  ON public.facebook_campaigns (consultant_id)
  WHERE brain_scale_enabled = true;
