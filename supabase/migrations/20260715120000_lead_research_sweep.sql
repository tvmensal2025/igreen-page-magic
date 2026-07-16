-- Fila de varredura automática cidade a cidade (pesquisa B2B → captured_leads).
-- Só grava leads. NÃO dispara WhatsApp.

CREATE TABLE IF NOT EXISTS public.lead_research_sweeps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  uf char(2) NOT NULL,
  category text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'paused', 'done', 'cancelled')),
  total_cities int NOT NULL DEFAULT 0,
  done_cities int NOT NULL DEFAULT 0,
  found_phones int NOT NULL DEFAULT 0,
  ingested int NOT NULL DEFAULT 0,
  deduped int NOT NULL DEFAULT 0,
  errors int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lead_research_sweep_cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sweep_id uuid NOT NULL REFERENCES public.lead_research_sweeps(id) ON DELETE CASCADE,
  city text NOT NULL,
  uf char(2) NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'empty', 'error')),
  found int NOT NULL DEFAULT 0,
  ingested int NOT NULL DEFAULT 0,
  deduped int NOT NULL DEFAULT 0,
  skipped int NOT NULL DEFAULT 0,
  error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sweep_cities_pending
  ON public.lead_research_sweep_cities (status, sweep_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_sweep_cities_sweep
  ON public.lead_research_sweep_cities (sweep_id, status);

ALTER TABLE public.lead_research_sweeps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_research_sweep_cities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner read sweeps" ON public.lead_research_sweeps;
CREATE POLICY "Owner read sweeps"
  ON public.lead_research_sweeps FOR SELECT TO authenticated
  USING (consultant_id = auth.uid() OR public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Owner read sweep cities" ON public.lead_research_sweep_cities;
CREATE POLICY "Owner read sweep cities"
  ON public.lead_research_sweep_cities FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.lead_research_sweeps s
      WHERE s.id = sweep_id
        AND (s.consultant_id = auth.uid() OR public.is_super_admin(auth.uid()))
    )
  );

COMMENT ON TABLE public.lead_research_sweeps IS
  'Job de varredura automática UF cidade a cidade (OSM → captured_leads).';
