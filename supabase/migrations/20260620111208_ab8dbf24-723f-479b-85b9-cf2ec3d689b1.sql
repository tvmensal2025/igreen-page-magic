
CREATE TABLE public.wallet_manual_topup_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_by uuid NOT NULL,
  created_by_role text NOT NULL CHECK (created_by_role IN ('consultant','super_admin')),
  note text,
  approved_by uuid,
  approved_at timestamptz,
  rejection_reason text,
  wallet_transaction_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wmtr_consultant ON public.wallet_manual_topup_requests(consultant_id, created_at DESC);
CREATE INDEX idx_wmtr_pending ON public.wallet_manual_topup_requests(status) WHERE status = 'pending';

GRANT SELECT, INSERT, UPDATE ON public.wallet_manual_topup_requests TO authenticated;
GRANT ALL ON public.wallet_manual_topup_requests TO service_role;

ALTER TABLE public.wallet_manual_topup_requests ENABLE ROW LEVEL SECURITY;

-- Consultor vê os próprios; admin vê todos
CREATE POLICY "select own or admin" ON public.wallet_manual_topup_requests
  FOR SELECT TO authenticated
  USING (
    consultant_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

-- Consultor cria pedido pra si mesmo; admin cria pra qualquer um
CREATE POLICY "insert own or admin" ON public.wallet_manual_topup_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    (consultant_id = auth.uid() AND created_by = auth.uid() AND created_by_role = 'consultant')
    OR (public.has_role(auth.uid(), 'admin') AND created_by = auth.uid() AND created_by_role = 'super_admin')
  );

-- Apenas admin aprova/rejeita
CREATE POLICY "update admin only" ON public.wallet_manual_topup_requests
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_wmtr_updated_at
  BEFORE UPDATE ON public.wallet_manual_topup_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
