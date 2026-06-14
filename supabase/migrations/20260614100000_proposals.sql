-- ============================================================
-- Orçamentos/Propostas — entidade própria com página pública
-- 2026-06-14
-- ============================================================
--
-- Um orçamento (proposal) tem vida própria: o consultor monta, envia por um
-- link público (public_token), o destinatário visualiza e responde (aceitar /
-- recusar / contrapropor com anexo). A VENDA (sales) só nasce quando o cliente
-- ACEITA — por isso proposals é separado de sales, não um status dele.
--
-- Segurança: a página pública NÃO acessa esta tabela direto. Toda leitura/
-- resposta passa por edge functions com service_role, identificando a proposta
-- só pelo public_token. RLS aqui cobre apenas o lado do consultor (autenticado).

-- ─── 1) Enums ────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.proposal_status AS ENUM (
    'draft',      -- rascunho, ainda não enviado
    'sent',       -- enviado ao destinatário (link ativo)
    'viewed',     -- destinatário abriu a página
    'accepted',   -- aceito → gera sale
    'rejected',   -- recusado
    'countered',  -- contraproposta do destinatário aguardando consultor
    'expired'     -- passou da validade
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE public.proposal_event_type AS ENUM (
    'created',
    'sent',
    'viewed',
    'accepted',
    'rejected',
    'countered',   -- contraproposta (com anexo opcional)
    'consultant_reply', -- consultor responde a uma contraproposta (nova rodada)
    'expired'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ─── 2) Tabela proposals ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proposals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Token público opaco usado na URL /proposta/:token. Nunca expõe o id interno.
  public_token      TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(18), 'hex'),

  consultant_id     UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  product_id        UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,

  -- Destinatário: ou um cliente da base, ou um contato avulso (nome + telefone).
  customer_id       UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  recipient_name    TEXT,
  recipient_phone   TEXT,

  status            public.proposal_status NOT NULL DEFAULT 'draft',

  -- Valor principal e detalhamento (montado pelo catálogo comercial no front).
  amount            NUMERIC(12,2),
  amount_period     TEXT NOT NULL DEFAULT 'month' CHECK (amount_period IN ('month', 'once')),
  discount          NUMERIC(12,2),
  line_items        JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Mensagem do consultor exibida na proposta.
  message           TEXT,

  -- Validade (prazo). Após esta data a proposta vira 'expired'.
  valid_until       TIMESTAMPTZ,

  -- Marcos temporais.
  sent_at           TIMESTAMPTZ,
  viewed_at         TIMESTAMPTZ,
  responded_at      TIMESTAMPTZ,

  -- Venda criada ao aceitar (liga proposta → sale).
  sale_id           UUID REFERENCES public.sales(id) ON DELETE SET NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Garante que há um destinatário: cliente da base OU contato avulso.
  CONSTRAINT proposals_recipient_chk CHECK (
    customer_id IS NOT NULL OR (recipient_phone IS NOT NULL AND recipient_name IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_proposals_consultant ON public.proposals (consultant_id, status);
CREATE INDEX IF NOT EXISTS idx_proposals_product ON public.proposals (product_id);
CREATE INDEX IF NOT EXISTS idx_proposals_customer ON public.proposals (customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_proposals_token ON public.proposals (public_token);
CREATE INDEX IF NOT EXISTS idx_proposals_valid_until ON public.proposals (valid_until)
  WHERE status IN ('sent', 'viewed', 'countered');

COMMENT ON TABLE public.proposals IS 'Orçamentos/propostas. A venda (sales) só nasce quando o destinatário aceita.';
COMMENT ON COLUMN public.proposals.public_token IS 'Token opaco da URL pública /proposta/:token. Acesso só via edge function.';
COMMENT ON COLUMN public.proposals.line_items IS 'Detalhamento do orçamento (label/value) montado pelo catálogo comercial.';

-- ─── 3) Tabela proposal_events (auditoria + rodadas de negociação) ───
CREATE TABLE IF NOT EXISTS public.proposal_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id     UUID NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  type            public.proposal_event_type NOT NULL,
  -- Quem gerou o evento: o consultor (autenticado) ou o destinatário (público).
  actor           TEXT NOT NULL DEFAULT 'recipient' CHECK (actor IN ('consultant', 'recipient', 'system')),
  note            TEXT,
  -- Contraproposta: anexo enviado pelo destinatário + valor proposto por ele.
  attachment_url  TEXT,
  counter_amount  NUMERIC(12,2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proposal_events_proposal ON public.proposal_events (proposal_id, created_at);

COMMENT ON TABLE public.proposal_events IS 'Histórico/rodadas de uma proposta: enviado, visto, aceito, recusado, contraproposta (com anexo).';

-- ─── 4) RLS proposals (apenas lado consultor; público usa edge function) ─
ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Consultor manages own proposals" ON public.proposals;
CREATE POLICY "Consultor manages own proposals"
  ON public.proposals FOR ALL
  TO authenticated
  USING (consultant_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (consultant_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Service role manages proposals" ON public.proposals;
CREATE POLICY "Service role manages proposals"
  ON public.proposals FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proposals TO authenticated;
GRANT ALL ON public.proposals TO service_role;

-- ─── 5) RLS proposal_events ──────────────────────────────────────────
ALTER TABLE public.proposal_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Consultor reads own proposal events" ON public.proposal_events;
CREATE POLICY "Consultor reads own proposal events"
  ON public.proposal_events FOR SELECT
  TO authenticated
  USING (
    proposal_id IN (SELECT id FROM public.proposals WHERE consultant_id = auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "Service role manages proposal events" ON public.proposal_events;
CREATE POLICY "Service role manages proposal events"
  ON public.proposal_events FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT ON public.proposal_events TO authenticated;
GRANT ALL ON public.proposal_events TO service_role;

-- ─── 6) Trigger updated_at ───────────────────────────────────────────
DROP TRIGGER IF EXISTS set_proposals_updated_at ON public.proposals;
CREATE TRIGGER set_proposals_updated_at
  BEFORE UPDATE ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 7) Trigger: carimba marcos + registra eventos de status ─────────
CREATE OR REPLACE FUNCTION public.log_proposal_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'sent' AND NEW.sent_at IS NULL THEN
      NEW.sent_at := now();
    END IF;
    IF NEW.status = 'viewed' AND NEW.viewed_at IS NULL THEN
      NEW.viewed_at := now();
    END IF;
    IF NEW.status IN ('accepted', 'rejected', 'countered') THEN
      NEW.responded_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_proposal_status_change ON public.proposals;
CREATE TRIGGER trg_log_proposal_status_change
  BEFORE UPDATE OF status ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.log_proposal_status_change();

-- ─── 8) RPC: expira propostas vencidas (chamada por cron/no acesso) ──
CREATE OR REPLACE FUNCTION public.expire_overdue_proposals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH upd AS (
    UPDATE public.proposals
       SET status = 'expired', updated_at = now()
     WHERE status IN ('sent', 'viewed', 'countered')
       AND valid_until IS NOT NULL
       AND valid_until < now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_overdue_proposals() TO authenticated, service_role;
