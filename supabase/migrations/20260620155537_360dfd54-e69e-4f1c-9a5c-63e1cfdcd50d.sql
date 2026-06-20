
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS origin_channel text,
  ADD COLUMN IF NOT EXISTS origin_instance_name text,
  ADD COLUMN IF NOT EXISTS origin_consultant_id uuid;

CREATE INDEX IF NOT EXISTS idx_customers_origin_instance ON public.customers(origin_instance_name);
CREATE INDEX IF NOT EXISTS idx_customers_origin_channel ON public.customers(origin_channel);

-- Backfill: leads existentes com consultor que tem instância evolution conhecida
UPDATE public.customers c
SET origin_channel = 'evolution',
    origin_instance_name = wi.instance_name,
    origin_consultant_id = c.consultant_id
FROM public.whatsapp_instances wi
WHERE c.consultant_id = wi.consultant_id
  AND c.origin_channel IS NULL;
