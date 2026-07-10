
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS capture_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS capture_closed_by uuid;

CREATE INDEX IF NOT EXISTS idx_customers_capture_closed_at
  ON public.customers (consultant_id, capture_closed_at)
  WHERE capture_closed_at IS NOT NULL;
