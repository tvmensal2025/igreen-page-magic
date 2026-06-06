
-- ============= flow_variants =============
CREATE TABLE IF NOT EXISTS public.flow_variants (
  id text PRIMARY KEY,
  fluxo text NOT NULL,
  nome text NOT NULL,
  descricao text,
  weight integer NOT NULL DEFAULT 50,
  is_active boolean NOT NULL DEFAULT true,
  consultant_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.flow_variants TO authenticated;
GRANT ALL ON public.flow_variants TO service_role;

ALTER TABLE public.flow_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage flow_variants"
  ON public.flow_variants FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated read flow_variants"
  ON public.flow_variants FOR SELECT
  TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.touch_flow_variants_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_flow_variants_updated_at ON public.flow_variants;
CREATE TRIGGER trg_flow_variants_updated_at
  BEFORE UPDATE ON public.flow_variants
  FOR EACH ROW EXECUTE FUNCTION public.touch_flow_variants_updated_at();

-- Seed inicial — Fluxo B com duas variantes (mantém A/B atual)
INSERT INTO public.flow_variants (id, fluxo, nome, descricao, weight, is_active)
VALUES
  ('b.v1',     'B', 'Vendedora v1', 'Pipeline modular (perfilador→planner→RAG→writer→crítico) com fechamento automático.', 50, true),
  ('b.legacy', 'B', 'Legacy',       'Implementação anterior do Fluxo B (prompt único). Baseline para comparação.', 50, true)
ON CONFLICT (id) DO NOTHING;

-- ============= customers: variant_id + followup_hook =============
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS variant_id text,
  ADD COLUMN IF NOT EXISTS followup_hook text;

-- Backfill: quem já tinha fluxo_b_variant ganha o variant_id correspondente
UPDATE public.customers
  SET variant_id = CASE
    WHEN lower(coalesce(fluxo_b_variant,'')) = 'v1' THEN 'b.v1'
    WHEN lower(coalesce(fluxo_b_variant,'')) = 'legacy' THEN 'b.legacy'
    ELSE variant_id
  END
  WHERE variant_id IS NULL AND fluxo_b_variant IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_variant_id ON public.customers(variant_id);

-- ============= Trigger embeddings automáticos =============
-- Usa pg_net pra POSTar na edge function. Token = service role; a edge aceita.
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.trg_enqueue_knowledge_embed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  -- Só dispara se o conteúdo relevante mudou
  IF TG_OP = 'UPDATE' AND
     NEW.title IS NOT DISTINCT FROM OLD.title AND
     NEW.content IS NOT DISTINCT FROM OLD.content AND
     NEW.is_active IS NOT DISTINCT FROM OLD.is_active
  THEN
    RETURN NEW;
  END IF;

  -- Marca como pendente — UI mostra badge "processando"
  NEW.embedding := NULL;
  NEW.embedding_updated_at := NULL;

  -- Tenta despachar via pg_net (best-effort; backfill cobre falhas)
  BEGIN
    SELECT value INTO v_url FROM public.settings WHERE key = 'supabase_url';
    SELECT value INTO v_key FROM public.settings WHERE key = 'embed_internal_token';
    IF v_url IS NULL THEN v_url := 'https://zlzasfhcxcznaprrragl.supabase.co'; END IF;
    IF v_key IS NOT NULL THEN
      PERFORM net.http_post(
        url := v_url || '/functions/v1/embed-knowledge',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'x-internal-secret', v_key
        ),
        body := jsonb_build_object('id', NEW.id, 'table', 'ai_knowledge_sections')
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- não bloqueia o INSERT/UPDATE
    NULL;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_knowledge_enqueue_embed ON public.ai_knowledge_sections;
CREATE TRIGGER trg_knowledge_enqueue_embed
  BEFORE INSERT OR UPDATE OF title, content, is_active
  ON public.ai_knowledge_sections
  FOR EACH ROW EXECUTE FUNCTION public.trg_enqueue_knowledge_embed();
