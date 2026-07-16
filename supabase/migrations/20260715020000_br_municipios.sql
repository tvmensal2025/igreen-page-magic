-- Catálogo completo de municípios brasileiros (IBGE Localidades).
-- Fonte: https://servicodados.ibge.gov.br/api/v1/localidades/municipios
-- Separado de fb_city_cache (que guarda chave Meta Ads).

CREATE TABLE IF NOT EXISTS public.br_municipios (
  ibge_code integer PRIMARY KEY,
  name text NOT NULL,
  name_normalized text NOT NULL,
  uf char(2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_br_municipios_name_prefix
  ON public.br_municipios (name_normalized text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_br_municipios_uf ON public.br_municipios (uf);
CREATE INDEX IF NOT EXISTS idx_br_municipios_uf_name
  ON public.br_municipios (uf, name_normalized text_pattern_ops);

ALTER TABLE public.br_municipios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read br_municipios" ON public.br_municipios;
CREATE POLICY "Authenticated read br_municipios"
  ON public.br_municipios FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE public.br_municipios IS
  'Catálogo IBGE de municípios BR (~5571). Autocomplete B2B/captação.';
