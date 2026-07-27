-- Demo pós-venda no Zap (venda plataforma): estado do menu numerado por alvo.
ALTER TABLE public.platform_sales_targets
  ADD COLUMN IF NOT EXISTS demo_flow_state text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS demo_last_stage text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'platform_sales_targets_demo_flow_state_check'
  ) THEN
    ALTER TABLE public.platform_sales_targets
      ADD CONSTRAINT platform_sales_targets_demo_flow_state_check
      CHECK (demo_flow_state IN ('idle', 'cta_sent', 'menu', 'done'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_platform_sales_targets_demo_phone
  ON public.platform_sales_targets (phone, demo_flow_state)
  WHERE demo_flow_state <> 'idle';
