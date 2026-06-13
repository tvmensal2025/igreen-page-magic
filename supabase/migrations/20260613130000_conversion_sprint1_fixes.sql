-- Conversão Sprint 1 — correções: RPC com isolamento de tenant + policies idempotentes.
-- Complementa 20260613120000_conversion_phrase_catalog.sql sem reaplicá-la.

-- ─── 1) RPC count_inbound_messages: filtra por consultor dono ────────────────
-- Antes: SECURITY DEFINER contava mensagens de QUALQUER customer cujo UUID fosse
-- passado, permitindo a um consultor autenticado contar mensagens de leads de
-- outro consultor. Agora o resultado é restrito aos customers do próprio
-- consultor (auth.uid()) ou admin. service_role continua vendo tudo.
CREATE OR REPLACE FUNCTION public.count_inbound_messages(p_customer_ids uuid[])
RETURNS TABLE(customer_id uuid, cnt bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.customer_id, COUNT(*)::bigint
  FROM public.conversations c
  WHERE c.customer_id = ANY(p_customer_ids)
    AND c.message_direction = 'inbound'
    AND COALESCE(c.message_text, '') NOT LIKE '[__safety_ping__]%'
    AND EXISTS (
      SELECT 1 FROM public.customers cust
      WHERE cust.id = c.customer_id
        AND (
          cust.consultant_id = auth.uid()
          OR has_role(auth.uid(), 'admin'::app_role)
          OR auth.role() = 'service_role'
        )
    )
  GROUP BY c.customer_id;
$$;

GRANT EXECUTE ON FUNCTION public.count_inbound_messages(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_inbound_messages(uuid[]) TO service_role;

-- ─── 2) Policies idempotentes no catálogo de frases ──────────────────────────
-- A migration anterior usava CREATE POLICY sem DROP — reaplicar quebrava.
DROP POLICY IF EXISTS "Anyone reads system phrases" ON public.conversion_phrase_catalog;
CREATE POLICY "Anyone reads system phrases"
  ON public.conversion_phrase_catalog FOR SELECT TO authenticated
  USING (consultant_id IS NULL OR consultant_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Consultor manages own phrase overrides" ON public.conversion_phrase_catalog;
CREATE POLICY "Consultor manages own phrase overrides"
  ON public.conversion_phrase_catalog FOR ALL TO authenticated
  USING (consultant_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (consultant_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Service role manages conversion phrases" ON public.conversion_phrase_catalog;
CREATE POLICY "Service role manages conversion phrases"
  ON public.conversion_phrase_catalog FOR ALL TO service_role
  USING (true) WITH CHECK (true);
