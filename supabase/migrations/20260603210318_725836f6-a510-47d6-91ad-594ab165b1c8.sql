
CREATE TABLE public.bulk_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL,
  name text NOT NULL DEFAULT 'Disparo',
  message_text text,
  media_url text,
  media_type text,
  media_filename text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  total int NOT NULL DEFAULT 0,
  sent int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  scheduled_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bulk_campaigns TO authenticated;
GRANT ALL ON public.bulk_campaigns TO service_role;

ALTER TABLE public.bulk_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Consultants manage own campaigns"
  ON public.bulk_campaigns FOR ALL
  USING (auth.uid() = consultant_id)
  WITH CHECK (auth.uid() = consultant_id);

CREATE INDEX idx_bulk_campaigns_consultant ON public.bulk_campaigns(consultant_id, created_at DESC);

CREATE TRIGGER trg_bulk_campaigns_updated
  BEFORE UPDATE ON public.bulk_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.bulk_campaign_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.bulk_campaigns(id) ON DELETE CASCADE,
  phone text NOT NULL,
  name text,
  vars jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  final_message text,
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bulk_campaign_targets TO authenticated;
GRANT ALL ON public.bulk_campaign_targets TO service_role;

ALTER TABLE public.bulk_campaign_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Consultants manage own targets"
  ON public.bulk_campaign_targets FOR ALL
  USING (EXISTS (SELECT 1 FROM public.bulk_campaigns c WHERE c.id = campaign_id AND c.consultant_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.bulk_campaigns c WHERE c.id = campaign_id AND c.consultant_id = auth.uid()));

CREATE INDEX idx_bulk_targets_campaign ON public.bulk_campaign_targets(campaign_id, status);
