-- ============================================================
-- Bloco B — Vendas como entidade própria (multiproduto)
-- 2026-06-14
-- ============================================================
--
-- Separa "venda" de "lead/cliente". Hoje conversão é um estado dentro de
-- customers (is_converted), pensado só para energia. Aqui cada venda de
-- qualquer produto (energia, telecom, seguros, placas...) vira uma linha
-- própria com seu pipeline, valor, pontos kWh-equivalente e dados de
-- captura específicos da família (JSONB).
--
-- Coexiste com o fluxo atual: leads seguem em customers/crm_deals; quando
-- viram venda de um produto, ganham uma linha em sales. Não altera nada do
-- pipeline de energia existente.

-- ─── 1) Enum de status de venda ──────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.sale_status AS ENUM (
    'lead',         -- interesse registrado, sem dados de captura
    'capturing',    -- coletando dados (formulário/OCR)
    'submitted',    -- enviada ao portal/fornecedor
    'active',       -- ativa/aprovada (gera pontos e comissão)
    'rejected',     -- reprovada
    'cancelled'     -- cancelada pelo cliente
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ─── 2) Tabela sales ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sales (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id   UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  customer_id     UUID REFERENCES public.customers(id) ON DELETE SET NULL,

  status          public.sale_status NOT NULL DEFAULT 'lead',

  -- Valor monetário da venda (mensalidade do plano, valor da apólice, etc).
  amount          NUMERIC(12,2),
  -- Pontos kWh-equivalente gerados, calculados a partir do scoring_rule do produto.
  points_kwh      NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Dados de captura específicos da família (validados por Zod no front):
  -- telecom: { plano, portabilidade, numero, tipo_chip }
  -- seguros: { placa, modelo, ano, plano }
  -- placas:  { consumo, tipo_imovel, financiamento }
  capture_data    JSONB NOT NULL DEFAULT '{}'::jsonb,

  notes           TEXT,

  submitted_at    TIMESTAMPTZ,
  activated_at    TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_consultant ON public.sales (consultant_id);
CREATE INDEX IF NOT EXISTS idx_sales_product ON public.sales (product_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON public.sales (customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_consultant_status ON public.sales (consultant_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_active ON public.sales (consultant_id) WHERE status = 'active';

COMMENT ON TABLE public.sales IS 'Vendas multiproduto. Cada linha é uma venda de um produto do catálogo por um consultor.';
COMMENT ON COLUMN public.sales.points_kwh IS 'Pontos kWh-equivalente gerados (calculado via products.scoring_rule).';
COMMENT ON COLUMN public.sales.capture_data IS 'Dados de captura específicos da família do produto (JSONB validado no front).';

-- ─── 3) sale_status_history (auditoria do pipeline) ──────────────────
CREATE TABLE IF NOT EXISTS public.sale_status_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id       UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  from_status   public.sale_status,
  to_status     public.sale_status NOT NULL,
  changed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sale_status_history_sale ON public.sale_status_history (sale_id, created_at);

COMMENT ON TABLE public.sale_status_history IS 'Histórico de mudanças de status de cada venda (auditoria do pipeline).';

-- ─── 4) RLS sales ────────────────────────────────────────────────────
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Consultor manages own sales" ON public.sales;
CREATE POLICY "Consultor manages own sales"
  ON public.sales FOR ALL
  TO authenticated
  USING (consultant_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (consultant_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Service role manages sales" ON public.sales;
CREATE POLICY "Service role manages sales"
  ON public.sales FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO authenticated;
GRANT ALL ON public.sales TO service_role;

-- ─── 5) RLS sale_status_history ──────────────────────────────────────
ALTER TABLE public.sale_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Consultor reads own sale history" ON public.sale_status_history;
CREATE POLICY "Consultor reads own sale history"
  ON public.sale_status_history FOR SELECT
  TO authenticated
  USING (
    sale_id IN (SELECT id FROM public.sales WHERE consultant_id = auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "Service role manages sale history" ON public.sale_status_history;
CREATE POLICY "Service role manages sale history"
  ON public.sale_status_history FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT ON public.sale_status_history TO authenticated;
GRANT ALL ON public.sale_status_history TO service_role;

-- ─── 6) Trigger updated_at ───────────────────────────────────────────
DROP TRIGGER IF EXISTS set_sales_updated_at ON public.sales;
CREATE TRIGGER set_sales_updated_at
  BEFORE UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 7) Trigger: registra histórico + carimba marcos temporais ───────
CREATE OR REPLACE FUNCTION public.log_sale_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.sale_status_history (sale_id, from_status, to_status, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, auth.uid());

    -- Carimba marcos temporais conforme o status alcançado.
    IF NEW.status = 'submitted' AND NEW.submitted_at IS NULL THEN
      NEW.submitted_at := now();
    END IF;
    IF NEW.status = 'active' AND NEW.activated_at IS NULL THEN
      NEW.activated_at := now();
    END IF;
    IF NEW.status IN ('rejected', 'cancelled') AND NEW.closed_at IS NULL THEN
      NEW.closed_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_sale_status_change ON public.sales;
CREATE TRIGGER trg_log_sale_status_change
  BEFORE UPDATE OF status ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.log_sale_status_change();
