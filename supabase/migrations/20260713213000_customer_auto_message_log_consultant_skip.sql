-- Permite ao consultor marcar envio pós-venda como pulado (some da fila "Próximos envios").
-- Idempotente via UNIQUE (customer_id, stage_key) — o motor trata como já processado.

GRANT INSERT ON public.customer_auto_message_log TO authenticated;

DROP POLICY IF EXISTS "Consultants insert own auto-message skip" ON public.customer_auto_message_log;
CREATE POLICY "Consultants insert own auto-message skip"
ON public.customer_auto_message_log
FOR INSERT
TO authenticated
WITH CHECK (consultant_id = auth.uid());
