-- RLS estava ON sem policies → front lia default local e o UPDATE/UPSERT falhava.
DROP POLICY IF EXISTS boleto_notify_config_select_auth ON public.boleto_notify_config;
DROP POLICY IF EXISTS boleto_notify_config_update_auth ON public.boleto_notify_config;
DROP POLICY IF EXISTS boleto_notify_config_insert_auth ON public.boleto_notify_config;

CREATE POLICY boleto_notify_config_select_auth
  ON public.boleto_notify_config FOR SELECT TO authenticated
  USING (true);

CREATE POLICY boleto_notify_config_update_auth
  ON public.boleto_notify_config FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY boleto_notify_config_insert_auth
  ON public.boleto_notify_config FOR INSERT TO authenticated
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.boleto_notify_config TO authenticated;
