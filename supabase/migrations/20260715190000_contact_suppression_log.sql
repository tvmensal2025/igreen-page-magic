-- Auditoria de opt-out / "nunca mais contatar" (reclamação, pedido, jurídico).
-- Reusa customers.do_not_contact + voice_dnc_list; este log só registra quem/quando/motivo.

CREATE TABLE IF NOT EXISTS public.contact_suppression_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  consultant_id UUID NOT NULL,
  phone TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'complaint',
  channel TEXT NOT NULL DEFAULT 'admin_ui',
  actor_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_suppression_log_customer
  ON public.contact_suppression_log (customer_id);

CREATE INDEX IF NOT EXISTS idx_contact_suppression_log_consultant
  ON public.contact_suppression_log (consultant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_suppression_log_phone
  ON public.contact_suppression_log (consultant_id, phone);

GRANT SELECT, INSERT ON public.contact_suppression_log TO authenticated;
GRANT ALL ON public.contact_suppression_log TO service_role;

ALTER TABLE public.contact_suppression_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consultants read own suppression log"
  ON public.contact_suppression_log
  FOR SELECT
  USING (auth.uid() = consultant_id);

CREATE POLICY "consultants insert own suppression log"
  ON public.contact_suppression_log
  FOR INSERT
  WITH CHECK (auth.uid() = consultant_id);

COMMENT ON TABLE public.contact_suppression_log IS
  'Auditoria de nunca-mais-contatar (reclamação/opt-out). Fonte da verdade de bloqueio: customers.do_not_contact + voice_dnc_list.';
