-- ctwa_clid_mapping: mapeia o ctwa_clid (ID do clique no anúncio CTWA) para a
-- campanha exata. Permite atribuir leads de Click-to-WhatsApp à campanha certa
-- de cada consultor com 100% de precisão (método forte usado nos webhooks).
--
-- A migration original (20260524000000_captacao_fluxo_d_conversao.sql) tinha
-- esta tabela, mas não foi aplicada no banco de produção. Recriamos aqui de
-- forma idempotente.
CREATE TABLE IF NOT EXISTS public.ctwa_clid_mapping (
  ctwa_clid    TEXT PRIMARY KEY CHECK (char_length(ctwa_clid) BETWEEN 1 AND 255),
  campaign_id  UUID NOT NULL REFERENCES public.facebook_campaigns(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ctwa_mapping_campaign
  ON public.ctwa_clid_mapping (campaign_id);

ALTER TABLE public.ctwa_clid_mapping ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Consultor manages own ctwa mapping" ON public.ctwa_clid_mapping;
CREATE POLICY "Consultor manages own ctwa mapping"
  ON public.ctwa_clid_mapping
  FOR ALL TO authenticated
  USING (
    campaign_id IN (SELECT id FROM public.facebook_campaigns WHERE consultant_id = auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    campaign_id IN (SELECT id FROM public.facebook_campaigns WHERE consultant_id = auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "Service role manages ctwa mapping" ON public.ctwa_clid_mapping;
CREATE POLICY "Service role manages ctwa mapping"
  ON public.ctwa_clid_mapping FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.ctwa_clid_mapping IS
  'Mapping ctwa_clid → campaign_id. Permite atribuir leads a campanhas Meta com 100% precisão.';
