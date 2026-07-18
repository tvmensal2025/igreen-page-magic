-- Consultor pode corrigir o histórico de mensagens automáticas (pós-venda e CRM).

GRANT DELETE, UPDATE ON public.customer_auto_message_log TO authenticated;
GRANT DELETE, UPDATE ON public.crm_auto_message_log TO authenticated;

DROP POLICY IF EXISTS "Consultants delete own customer auto-message log" ON public.customer_auto_message_log;
CREATE POLICY "Consultants delete own customer auto-message log"
ON public.customer_auto_message_log
FOR DELETE
TO authenticated
USING (consultant_id = auth.uid());

DROP POLICY IF EXISTS "Consultants update own customer auto-message log" ON public.customer_auto_message_log;
CREATE POLICY "Consultants update own customer auto-message log"
ON public.customer_auto_message_log
FOR UPDATE
TO authenticated
USING (consultant_id = auth.uid())
WITH CHECK (consultant_id = auth.uid());

DROP POLICY IF EXISTS "Consultants delete own crm auto-message log" ON public.crm_auto_message_log;
CREATE POLICY "Consultants delete own crm auto-message log"
ON public.crm_auto_message_log
FOR DELETE
TO authenticated
USING (consultant_id = auth.uid());

DROP POLICY IF EXISTS "Consultants update own crm auto-message log" ON public.crm_auto_message_log;
CREATE POLICY "Consultants update own crm auto-message log"
ON public.crm_auto_message_log
FOR UPDATE
TO authenticated
USING (consultant_id = auth.uid())
WITH CHECK (consultant_id = auth.uid());
