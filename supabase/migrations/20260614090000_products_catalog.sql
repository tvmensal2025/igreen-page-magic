-- ============================================================
-- Bloco A — Catálogo de Produtos (fundação multiproduto)
-- 2026-06-14
-- ============================================================
--
-- Transforma os "produtos Conexão" (hoje hardcoded em
-- src/data/conexaoProducts.ts) em entidade de banco. Cada produto
-- carrega sua família, regra de pontuação (kWh-equivalente) e regra
-- de comissão, além do conteúdo da landing (JSONB) para renderização
-- dinâmica em ConexaoProductPage.
--
-- Coexiste com customers.tipo_produto: o catálogo é a fonte canônica
-- de produtos; a coluna do cliente vira FK lógica via slug.

-- ─── 1) Enum de família de produto ───────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.product_family AS ENUM (
    'energia',   -- Green, Solar, Livre (assinatura/desconto na luz)
    'placas',    -- venda + instalação fotovoltaica
    'telecom',   -- chip/eSIM
    'seguros',   -- proteção veicular
    'club',      -- clube de benefícios (PF/PJ)
    'expansao'   -- oportunidade de licenciamento
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ─── 2) Tabela products ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  brand_name      TEXT NOT NULL,
  family          public.product_family NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  sort_order      INT NOT NULL DEFAULT 100,

  -- Regra de pontuação: como a venda converte em kWh-equivalente para
  -- o plano de carreira. Ex.: { "mode": "contracted_kwh", "multiplier": 1 }
  -- telecom: { "mode": "fixed_per_unit", "kwh_per_unit": 200 }
  -- placas:  { "mode": "proposal_kwh", "multiplier": 4, "validity_months": 12 }
  scoring_rule    JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Regra de comissão (espelha o manual iGreen). Mantida flexível por produto.
  -- Ex.: { "type": "recurring_percent", "max_percent": 4 }
  -- telecom: { "type": "fixed", "own": 7, "chip_activation": 10 }
  commission_rule JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Conteúdo da landing (hero, seções) — migrado de conexaoProducts.ts
  landing_content JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_family ON public.products (family) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_products_active_sort ON public.products (sort_order) WHERE is_active = true;

COMMENT ON TABLE public.products IS 'Catálogo canônico de produtos iGreen (energia, placas, telecom, seguros, club, expansão).';
COMMENT ON COLUMN public.products.scoring_rule IS 'Regra de pontuação kWh-equivalente para o plano de carreira (JSONB).';
COMMENT ON COLUMN public.products.commission_rule IS 'Regra de comissão por produto, espelhando o manual iGreen (JSONB).';
COMMENT ON COLUMN public.products.landing_content IS 'Conteúdo da landing page (hero + seções), migrado de conexaoProducts.ts.';

-- ─── 3) RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Leitura pública (landing pages são acessadas por visitantes anônimos)
DROP POLICY IF EXISTS "Anyone reads active products" ON public.products;
CREATE POLICY "Anyone reads active products"
  ON public.products FOR SELECT
  TO anon, authenticated
  USING (is_active = true OR has_role(auth.uid(), 'admin'::app_role));

-- Apenas admin escreve no catálogo
DROP POLICY IF EXISTS "Admin manages products" ON public.products;
CREATE POLICY "Admin manages products"
  ON public.products FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Service role manages products" ON public.products;
CREATE POLICY "Service role manages products"
  ON public.products FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT ON public.products TO anon, authenticated;
GRANT ALL ON public.products TO service_role;

-- ─── 4) Trigger updated_at ───────────────────────────────────────────
DROP TRIGGER IF EXISTS set_products_updated_at ON public.products;
CREATE TRIGGER set_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 5) Seed dos 9 produtos Conexão (idempotente por slug) ───────────
-- Pontuação/comissão conforme manuais iGreen (qualificação-igreen,
-- manual-conexao-placas, manual-conexao-igreen-telecom). landing_content
-- é preenchido pelo seed da aplicação (scripts/seed-products) a partir de
-- conexaoProducts.ts para evitar duplicar o conteúdo extenso aqui.
INSERT INTO public.products (slug, name, brand_name, family, sort_order, scoring_rule, commission_rule)
SELECT * FROM (VALUES
  ('conexao-green',   'Conexão Green',   'iGreen Energy',         'energia'::public.product_family, 10,
    '{"mode":"contracted_kwh","multiplier":1}'::jsonb,
    '{"type":"recurring_percent","max_percent":4}'::jsonb),
  ('conexao-solar',   'Conexão Solar',   'iGreen Energy',         'energia'::public.product_family, 20,
    '{"mode":"proposal_kwh","multiplier":1}'::jsonb,
    '{"type":"recurring_percent","max_percent":4}'::jsonb),
  ('conexao-livre',   'Conexão Livre',   'iGreen Energy',         'energia'::public.product_family, 30,
    '{"mode":"contracted_kwh","multiplier":1}'::jsonb,
    '{"type":"recurring_percent","max_percent":4}'::jsonb),
  ('conexao-placas',  'Conexão Placas',  'iGreen Energy',         'placas'::public.product_family,  40,
    '{"mode":"proposal_kwh","multiplier":4,"validity_months":12}'::jsonb,
    '{"type":"royalties_percent","max_percent":1.5}'::jsonb),
  ('conexao-telecom', 'Conexão Telecom', 'iGreen Telecom',        'telecom'::public.product_family, 50,
    '{"mode":"fixed_per_unit","kwh_per_unit":200,"only_portability":true}'::jsonb,
    '{"type":"fixed","own":7,"indirect":1,"chip_activation":10,"chip_activation_from_unit":6}'::jsonb),
  ('conexao-seguros', 'Conexão Seguros', 'iGreen Seguros',        'seguros'::public.product_family, 60,
    '{"mode":"none"}'::jsonb,
    '{"type":"per_policy"}'::jsonb),
  ('conexao-club',    'Conexão Club',    'iGreen Club',           'club'::public.product_family,    70,
    '{"mode":"none"}'::jsonb,
    '{"type":"none"}'::jsonb),
  ('conexao-club-pj', 'Conexão Club PJ', 'iGreen Club Empresas',  'club'::public.product_family,    80,
    '{"mode":"none"}'::jsonb,
    '{"type":"none"}'::jsonb),
  ('conexao-expansao','Conexão Expansão','iGreen Energy',         'expansao'::public.product_family,90,
    '{"mode":"none"}'::jsonb,
    '{"type":"recruitment","direct_bonus":300}'::jsonb)
) AS v(slug, name, brand_name, family, sort_order, scoring_rule, commission_rule)
WHERE NOT EXISTS (
  SELECT 1 FROM public.products p WHERE p.slug = v.slug
);
