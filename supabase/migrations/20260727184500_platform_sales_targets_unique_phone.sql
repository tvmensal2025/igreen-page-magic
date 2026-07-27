-- Unique alvo por campanha+telefone (piloto / anti-duplicata)
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_sales_targets_campaign_phone
  ON public.platform_sales_targets (campaign_id, phone);
