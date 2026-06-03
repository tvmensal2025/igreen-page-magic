
-- Kill switch: pausa envios por N horas (default 24h). Reutiliza recovery_mode_until.
CREATE OR REPLACE FUNCTION public.pause_sending_now(
  p_instance TEXT,
  p_hours INT DEFAULT 24
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_until TIMESTAMPTZ;
BEGIN
  SELECT consultant_id INTO v_owner
    FROM public.whatsapp_instances
    WHERE instance_name = p_instance;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'instance_not_found';
  END IF;
  IF auth.uid() IS DISTINCT FROM v_owner AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF p_hours IS NULL OR p_hours <= 0 OR p_hours > 720 THEN
    RAISE EXCEPTION 'invalid_hours';
  END IF;

  UPDATE public.whatsapp_instances
     SET recovery_mode_until = GREATEST(
           COALESCE(recovery_mode_until, now()),
           now() + make_interval(hours => p_hours)
         ),
         updated_at = now()
   WHERE instance_name = p_instance
   RETURNING recovery_mode_until INTO v_until;

  RETURN v_until;
END;
$$;
GRANT EXECUTE ON FUNCTION public.pause_sending_now(TEXT, INT) TO authenticated, service_role;

-- Sair do modo recuperação manualmente (após reconectar e confirmar saúde)
CREATE OR REPLACE FUNCTION public.clear_recovery_mode(p_instance TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_owner UUID;
BEGIN
  SELECT consultant_id INTO v_owner
    FROM public.whatsapp_instances
    WHERE instance_name = p_instance;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'instance_not_found';
  END IF;
  IF auth.uid() IS DISTINCT FROM v_owner AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  UPDATE public.whatsapp_instances
     SET recovery_mode_until = NULL,
         updated_at = now()
   WHERE instance_name = p_instance;

  -- Expira sinais críticos que estariam segurando o circuit breaker
  UPDATE public.instance_risk_signals
     SET expires_at = now()
   WHERE instance_name = p_instance
     AND signal_type = 'disconnect_fatal'
     AND expires_at > now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.clear_recovery_mode(TEXT) TO authenticated, service_role;
