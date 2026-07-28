-- Palavras-chave dos banners do CONSULTOR (não parceiro).
-- Cada local/banner impresso pode ter uma keyword; o webhook grava
-- referral_keyword_matched sem precisar de referral_partner_id.
ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS banner_keywords text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.consultants.banner_keywords IS
  'Palavras-chave dos banners do consultor (locais). Rastreio sem parceiro.';
