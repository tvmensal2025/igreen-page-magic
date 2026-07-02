ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS signature_summary      JSONB,
  ADD COLUMN IF NOT EXISTS otp_status             TEXT,
  ADD COLUMN IF NOT EXISTS otp_status_checked_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS document_verify_status TEXT,
  ADD COLUMN IF NOT EXISTS document_verify_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_enriched_at       TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS customers_last_enriched_at_idx
  ON public.customers (last_enriched_at NULLS FIRST)
  WHERE portal2_idcliente IS NOT NULL;