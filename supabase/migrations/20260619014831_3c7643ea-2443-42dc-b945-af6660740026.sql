
CREATE INDEX IF NOT EXISTS idx_conversations_customer_created_desc
  ON public.conversations (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_customer_created_range
  ON public.conversations (customer_id, created_at);

CREATE INDEX IF NOT EXISTS idx_customers_consultant_id
  ON public.customers (consultant_id);

CREATE INDEX IF NOT EXISTS idx_customers_consultant_created
  ON public.customers (consultant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customers_status_updated
  ON public.customers (status, updated_at);

CREATE INDEX IF NOT EXISTS idx_phs_captured_at
  ON public.production_health_snapshot (captured_at);

CREATE INDEX IF NOT EXISTS idx_storage_migration_bucket_status
  ON public.storage_migration_log (source_bucket, status);

CREATE INDEX IF NOT EXISTS idx_crm_deals_consultant_id
  ON public.crm_deals (consultant_id);
