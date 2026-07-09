
CREATE INDEX IF NOT EXISTS customers_phone_norm_idx
  ON public.customers ((regexp_replace(coalesce(phone_whatsapp,''),'\D','','g')));

CREATE INDEX IF NOT EXISTS captured_leads_phone_norm_idx
  ON public.captured_leads ((regexp_replace(coalesce(phone,''),'\D','','g')));

CREATE INDEX IF NOT EXISTS captured_leads_orphan_idx
  ON public.captured_leads (created_at DESC)
  WHERE customer_id IS NULL;
