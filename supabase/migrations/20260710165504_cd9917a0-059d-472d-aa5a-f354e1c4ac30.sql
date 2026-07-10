-- Add outcome/attribution/lost_reason to sales
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS outcome text CHECK (outcome IN ('won','lost')),
  ADD COLUMN IF NOT EXISTS source_kind text CHECK (source_kind IN ('campaign','partner','organic')),
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS lost_reason text;

-- Backfill historicals: fechado => won ; perdido => lost
UPDATE public.sales SET outcome='won'  WHERE outcome IS NULL AND status='fechado';
UPDATE public.sales SET outcome='lost' WHERE outcome IS NULL AND status='perdido';

CREATE INDEX IF NOT EXISTS idx_sales_outcome ON public.sales(outcome);
CREATE INDEX IF NOT EXISTS idx_sales_source ON public.sales(source_kind, source_id);