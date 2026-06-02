
-- Tipo enum para temperatura
DO $$ BEGIN
  CREATE TYPE public.lead_temperature AS ENUM ('hot','warm','cold','dead','objection','rescue');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Cache de análise IA por lead
CREATE TABLE IF NOT EXISTS public.lead_insights (
  customer_id UUID PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
  consultant_id UUID NOT NULL,
  temperature public.lead_temperature NOT NULL DEFAULT 'cold',
  loss_reason TEXT,
  main_doubt TEXT,
  main_objection TEXT,
  summary TEXT,
  next_action TEXT,
  next_msg_draft TEXT,
  next_msg_template_shortcut TEXT,
  conversion_chance INTEGER CHECK (conversion_chance BETWEEN 0 AND 100),
  signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_used TEXT,
  tokens_used INTEGER,
  classified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  messages_count_at_classify INTEGER,
  needs_reclassify BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_insights_consultant_temp ON public.lead_insights(consultant_id, temperature);
CREATE INDEX IF NOT EXISTS idx_lead_insights_classified ON public.lead_insights(classified_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_insights_needs_reclass ON public.lead_insights(needs_reclassify) WHERE needs_reclassify = true;

-- GRANTs (obrigatório no public schema)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_insights TO authenticated;
GRANT ALL ON public.lead_insights TO service_role;

-- RLS
ALTER TABLE public.lead_insights ENABLE ROW LEVEL SECURITY;

-- Consultor lê os insights dos seus próprios clientes
CREATE POLICY "consultant reads own insights"
ON public.lead_insights FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = lead_insights.customer_id
      AND c.consultant_id = auth.uid()
  )
);

-- Edge function (service_role) gerencia inserts/updates. Nada do client escreve.

-- Trigger pra atualizar updated_at
CREATE OR REPLACE FUNCTION public.tg_lead_insights_touch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS lead_insights_touch ON public.lead_insights;
CREATE TRIGGER lead_insights_touch
BEFORE UPDATE ON public.lead_insights
FOR EACH ROW EXECUTE FUNCTION public.tg_lead_insights_touch();
