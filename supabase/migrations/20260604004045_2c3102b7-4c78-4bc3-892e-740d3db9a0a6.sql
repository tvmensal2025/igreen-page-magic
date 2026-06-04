CREATE TABLE public.campaign_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id UUID NOT NULL,
  name TEXT NOT NULL,
  anchor_city TEXT NOT NULL DEFAULT '',
  radius_km INTEGER NOT NULL DEFAULT 100,
  age_min INTEGER NOT NULL DEFAULT 28,
  age_max INTEGER NOT NULL DEFAULT 65,
  interests TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  daily_budget_brl NUMERIC(10,2) NOT NULL DEFAULT 50,
  creative_title TEXT NOT NULL DEFAULT '',
  copy_text TEXT NOT NULL DEFAULT '',
  video_url TEXT NOT NULL DEFAULT '',
  destination_url TEXT NOT NULL DEFAULT 'https://igreen.cloud/',
  utm_campaign TEXT NOT NULL DEFAULT '',
  observations TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_templates TO authenticated;
GRANT ALL ON public.campaign_templates TO service_role;

ALTER TABLE public.campaign_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Consultor gerencia seus próprios templates"
  ON public.campaign_templates
  FOR ALL
  TO authenticated
  USING (auth.uid() = consultant_id)
  WITH CHECK (auth.uid() = consultant_id);

CREATE OR REPLACE FUNCTION public.campaign_templates_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_campaign_templates_updated_at
  BEFORE UPDATE ON public.campaign_templates
  FOR EACH ROW EXECUTE FUNCTION public.campaign_templates_set_updated_at();

CREATE INDEX idx_campaign_templates_consultant ON public.campaign_templates(consultant_id, created_at DESC);