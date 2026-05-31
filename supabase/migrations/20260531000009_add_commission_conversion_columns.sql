-- Colunas de conversão/comissão usadas por CommissionPanel e WhatsAppClientsPage.
-- Sem elas, as queries do painel de Comissões falham e tudo aparece zerado.
--
-- NOTA DE VERSIONAMENTO: o timestamp deste arquivo (20260531000009) casa
-- com a versão já registrada em supabase_migrations.schema_migrations
-- (aplicada em produção). Mantê-los idênticos evita que `supabase db push`
-- trate esta migration como nova e a re-aplique, duplicando o histórico.
-- Esta migration CONSOLIDA e SUPERA a antiga 20260522210000_commission_tracking
-- (que nunca foi aplicada nesta base e tinha definições divergentes).

-- customers: marcação de conversão + taxa de comissão por lead
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS is_converted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS converted_at timestamptz,
  ADD COLUMN IF NOT EXISTS commission_rate smallint;

-- facebook_campaigns: % de comissão padrão da campanha
ALTER TABLE public.facebook_campaigns
  ADD COLUMN IF NOT EXISTS commission_rate smallint;

-- Validação dos valores permitidos (1..100). NULL = não definido.
ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_commission_rate_chk;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_commission_rate_chk
  CHECK (commission_rate IS NULL OR (commission_rate BETWEEN 1 AND 100));

ALTER TABLE public.facebook_campaigns
  DROP CONSTRAINT IF EXISTS facebook_campaigns_commission_rate_chk;
ALTER TABLE public.facebook_campaigns
  ADD CONSTRAINT facebook_campaigns_commission_rate_chk
  CHECK (commission_rate IS NULL OR (commission_rate BETWEEN 1 AND 100));

-- Índice para o filtro de convertidos por consultor
CREATE INDEX IF NOT EXISTS idx_customers_converted
  ON public.customers (consultant_id)
  WHERE is_converted = true;

COMMENT ON COLUMN public.customers.is_converted IS 'Lead marcado como convertido (virou cliente) manualmente na aba Leads/WhatsApp.';
COMMENT ON COLUMN public.customers.converted_at IS 'Quando o lead foi marcado como convertido.';
COMMENT ON COLUMN public.customers.commission_rate IS 'Taxa de comissão (%) específica deste lead. Sobrepõe a da campanha.';
COMMENT ON COLUMN public.facebook_campaigns.commission_rate IS 'Taxa de comissão padrão (%) da campanha, usada no painel de Comissões.';
