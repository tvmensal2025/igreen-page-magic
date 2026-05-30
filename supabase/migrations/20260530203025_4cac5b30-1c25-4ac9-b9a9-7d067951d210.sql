
-- 1) Coluna is_public em bot_flows
ALTER TABLE public.bot_flows
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;

-- 2) Índice parcial: 1 fluxo público por variante
CREATE UNIQUE INDEX IF NOT EXISTS uq_bot_flows_public_per_variant
  ON public.bot_flows (variant) WHERE is_public = true;

-- 3) Marca o Fluxo D do superadmin como público
UPDATE public.bot_flows
  SET is_public = true
  WHERE id = '320bf22c-e383-4f53-a3c0-b88b89b02558';

-- 4) Todos os consultores não-superadmin com active_variants = {D}
UPDATE public.consultants
  SET active_variants = ARRAY['D']
  WHERE id <> '0c2711ad-4836-41e6-afba-edd94f698ae3';
