-- Upsert do aviso de boleto (teste no card) precisa de UPDATE: sem esta policy
-- o segundo teste do mesmo cliente/mês bate em RLS e o clique não é rearmado.
DROP POLICY IF EXISTS "Consultants update own auto-message log" ON public.customer_auto_message_log;
CREATE POLICY "Consultants update own auto-message log"
  ON public.customer_auto_message_log FOR UPDATE TO authenticated
  USING (consultant_id = auth.uid())
  WITH CHECK (consultant_id = auth.uid());
