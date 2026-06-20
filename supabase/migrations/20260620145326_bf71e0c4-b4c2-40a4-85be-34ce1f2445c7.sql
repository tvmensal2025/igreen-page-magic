ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS last_portal_dispatch_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_portal_dispatch_error text,
  ADD COLUMN IF NOT EXISTS last_otp_dispatch_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_otp_dispatch_error text,
  ADD COLUMN IF NOT EXISTS portal_retry_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_customers_otp_pending
  ON public.customers (otp_received_at)
  WHERE otp_code IS NOT NULL AND portal2_otp_validated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_customers_portal_pending
  ON public.customers (updated_at)
  WHERE portal2_idcliente IS NULL AND status IN ('cadastro_portal','portal_submitting','worker_offline','missing_documents');