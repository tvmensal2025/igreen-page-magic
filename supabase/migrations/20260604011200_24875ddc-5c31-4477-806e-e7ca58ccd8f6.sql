-- Remove a tabela duplicada que foi criada por engano (havia infra completa em ad_templates + facebook_campaigns)
DROP TABLE IF EXISTS public.campaign_templates CASCADE;

-- Adiciona campo opcional para sugerir raio padrão (km) em templates ultra-locais
ALTER TABLE public.ad_templates
  ADD COLUMN IF NOT EXISTS default_radius_km integer;