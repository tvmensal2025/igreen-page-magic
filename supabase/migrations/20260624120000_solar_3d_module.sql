-- =============================================================================
-- Módulo Solar 3D + IA — tabelas isoladas (Conexão Placas)
-- =============================================================================

ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS solar_3d_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS solar_public_widget_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.consultants.solar_3d_enabled IS
  'Habilita ferramenta de análise remota de telhado (Google Solar API).';

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS solar_snapshot_id UUID;

-- FK adicionada após criar snapshots
-- ─── solar_roof_analyses ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.solar_roof_analyses (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id       UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  customer_id         UUID REFERENCES public.customers(id) ON DELETE SET NULL,

  address_text        TEXT,
  latitude            DOUBLE PRECISION NOT NULL,
  longitude           DOUBLE PRECISION NOT NULL,
  cache_key           TEXT NOT NULL,

  building_insights   JSONB NOT NULL,
  data_layers         JSONB,
  imagery_quality     TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (imagery_quality IN ('HIGH', 'MEDIUM', 'BASE', 'UNKNOWN')),
  imagery_date        DATE,

  max_panels          INTEGER,
  panel_watts         INTEGER,
  max_yearly_kwh      NUMERIC(12, 2),

  source              TEXT NOT NULL DEFAULT 'google_solar_api',
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_solar_analyses_consultant
  ON public.solar_roof_analyses (consultant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_solar_analyses_customer
  ON public.solar_roof_analyses (customer_id);
CREATE INDEX IF NOT EXISTS idx_solar_analyses_cache
  ON public.solar_roof_analyses (consultant_id, cache_key);

-- ─── solar_design_snapshots ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.solar_design_snapshots (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id             UUID NOT NULL REFERENCES public.solar_roof_analyses(id) ON DELETE CASCADE,
  consultant_id           UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,

  panels_count            INTEGER NOT NULL,
  system_kwp              NUMERIC(8, 2) NOT NULL,
  yearly_energy_kwh       NUMERIC(12, 2),
  monthly_savings_cents   INTEGER,

  roof_segments             JSONB NOT NULL DEFAULT '[]'::jsonb,
  panel_positions           JSONB NOT NULL DEFAULT '[]'::jsonb,
  preview_image_path        TEXT,
  manual_sketch             JSONB,
  sales_blurb               TEXT,

  label                   TEXT,
  is_primary              BOOLEAN NOT NULL DEFAULT true,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.proposals
  DROP CONSTRAINT IF EXISTS proposals_solar_snapshot_id_fkey;
ALTER TABLE public.proposals
  ADD CONSTRAINT proposals_solar_snapshot_id_fkey
  FOREIGN KEY (solar_snapshot_id) REFERENCES public.solar_design_snapshots(id) ON DELETE SET NULL;

-- ─── solar_api_usage_log ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.solar_api_usage_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id UUID REFERENCES public.consultants(id) ON DELETE SET NULL,
  endpoint      TEXT NOT NULL,
  cache_hit     BOOLEAN NOT NULL DEFAULT false,
  latency_ms    INTEGER,
  error_code    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── rate limit captação pública ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.solar_public_rate_limit (
  ip_hash     TEXT NOT NULL,
  day         DATE NOT NULL DEFAULT CURRENT_DATE,
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, day)
);

-- ─── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.solar_roof_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solar_design_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solar_api_usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solar_public_rate_limit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Consultor manages own solar analyses" ON public.solar_roof_analyses;
CREATE POLICY "Consultor manages own solar analyses"
  ON public.solar_roof_analyses FOR ALL TO authenticated
  USING (consultant_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (consultant_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Service role solar analyses" ON public.solar_roof_analyses;
CREATE POLICY "Service role solar analyses"
  ON public.solar_roof_analyses FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Consultor manages own solar snapshots" ON public.solar_design_snapshots;
CREATE POLICY "Consultor manages own solar snapshots"
  ON public.solar_design_snapshots FOR ALL TO authenticated
  USING (consultant_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (consultant_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Service role solar snapshots" ON public.solar_design_snapshots;
CREATE POLICY "Service role solar snapshots"
  ON public.solar_design_snapshots FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin reads solar api log" ON public.solar_api_usage_log;
CREATE POLICY "Admin reads solar api log"
  ON public.solar_api_usage_log FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Service role solar api log" ON public.solar_api_usage_log;
CREATE POLICY "Service role solar api log"
  ON public.solar_api_usage_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role solar rate limit" ON public.solar_public_rate_limit;
CREATE POLICY "Service role solar rate limit"
  ON public.solar_public_rate_limit FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.solar_roof_analyses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solar_design_snapshots TO authenticated;
GRANT SELECT ON public.solar_api_usage_log TO authenticated;
GRANT ALL ON public.solar_roof_analyses TO service_role;
GRANT ALL ON public.solar_design_snapshots TO service_role;
GRANT ALL ON public.solar_api_usage_log TO service_role;
GRANT ALL ON public.solar_public_rate_limit TO service_role;
