
-- ============================================================
-- Plano B — Hard-lock pós-desconexão fatal (403/401/440/...)
-- ============================================================

ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS manual_review_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS fatal_disconnect_reason INTEGER,
  ADD COLUMN IF NOT EXISTS fatal_disconnect_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fatal_lock_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fatal_lock_cleared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fatal_lock_cleared_by UUID,
  ADD COLUMN IF NOT EXISTS fatal_lock_clear_reason TEXT;

-- Helper: instância está sob trava fatal ativa?
CREATE OR REPLACE FUNCTION public.is_fatal_locked(p_instance TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT manual_review_required
       FROM public.whatsapp_instances
       WHERE instance_name = p_instance), FALSE)
  OR COALESCE(
    (SELECT fatal_lock_until > now()
       FROM public.whatsapp_instances
       WHERE instance_name = p_instance), FALSE);
$$;
GRANT EXECUTE ON FUNCTION public.is_fatal_locked(TEXT) TO authenticated, service_role;

-- Registra uma desconexão fatal de forma idempotente
CREATE OR REPLACE FUNCTION public.register_fatal_disconnect(
  p_instance TEXT,
  p_reason INTEGER,
  p_lock_hours INTEGER DEFAULT 336
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.whatsapp_instances
     SET manual_review_required = TRUE,
         fatal_disconnect_reason = p_reason,
         fatal_disconnect_at = COALESCE(fatal_disconnect_at, now()),
         fatal_lock_until = GREATEST(
           COALESCE(fatal_lock_until, now()),
           now() + make_interval(hours => p_lock_hours)
         ),
         status = 'needs_reconnect',
         recovery_mode_until = GREATEST(
           COALESCE(recovery_mode_until, now()),
           now() + make_interval(hours => p_lock_hours)
         ),
         updated_at = now()
   WHERE instance_name = p_instance;
END;
$$;
GRANT EXECUTE ON FUNCTION public.register_fatal_disconnect(TEXT, INTEGER, INTEGER) TO service_role;

-- Refaz clear_recovery_mode: agora RECUSA se houver trava fatal ativa,
-- exceto para super_admin. Isso evita que o consultor destrave envios
-- automáticos enquanto o número ainda está em revisão pelo WhatsApp.
CREATE OR REPLACE FUNCTION public.clear_recovery_mode(p_instance TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_fatal_lock TIMESTAMPTZ;
  v_manual BOOLEAN;
  v_is_admin BOOLEAN;
BEGIN
  SELECT consultant_id, fatal_lock_until, manual_review_required
    INTO v_owner, v_fatal_lock, v_manual
    FROM public.whatsapp_instances
    WHERE instance_name = p_instance;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'instance_not_found';
  END IF;

  v_is_admin := public.is_super_admin(auth.uid());

  IF auth.uid() IS DISTINCT FROM v_owner AND NOT v_is_admin THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Bloqueia liberação se ainda há trava fatal ativa e quem chama não é super_admin
  IF NOT v_is_admin
     AND ((v_fatal_lock IS NOT NULL AND v_fatal_lock > now())
          OR COALESCE(v_manual, FALSE)) THEN
    RAISE EXCEPTION 'fatal_lock_active_admin_required';
  END IF;

  UPDATE public.whatsapp_instances
     SET recovery_mode_until = NULL,
         updated_at = now()
   WHERE instance_name = p_instance;

  -- Só expira sinais fatais se quem chama é admin (caso geral) OU se a
  -- trava fatal já expirou naturalmente.
  IF v_is_admin OR v_fatal_lock IS NULL OR v_fatal_lock <= now() THEN
    UPDATE public.instance_risk_signals
       SET expires_at = now()
     WHERE instance_name = p_instance
       AND signal_type = 'disconnect_fatal'
       AND expires_at > now();
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.clear_recovery_mode(TEXT) TO authenticated, service_role;

-- Liberação explícita por super admin, registrada com motivo
CREATE OR REPLACE FUNCTION public.admin_clear_fatal_lock(
  p_instance TEXT,
  p_reason TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  UPDATE public.whatsapp_instances
     SET manual_review_required = FALSE,
         fatal_lock_until = NULL,
         fatal_lock_cleared_at = now(),
         fatal_lock_cleared_by = auth.uid(),
         fatal_lock_clear_reason = p_reason,
         recovery_mode_until = NULL,
         updated_at = now()
   WHERE instance_name = p_instance;

  UPDATE public.instance_risk_signals
     SET expires_at = now()
   WHERE instance_name = p_instance
     AND signal_type = 'disconnect_fatal'
     AND expires_at > now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_clear_fatal_lock(TEXT, TEXT) TO authenticated, service_role;

-- Atualiza check_send_quota para considerar manual_review_required também
CREATE OR REPLACE FUNCTION public.check_send_quota(
  p_instance TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inst RECORD;
  v_today DATE := (now() AT TIME ZONE 'UTC')::date;
  v_warmup_day INT;
  v_cap INT;
  v_min_interval_ms INT;
  v_sent INT;
  v_last_send TIMESTAMPTZ;
  v_reconnects_6h INT;
  v_failures_6h INT;
  v_fatals_6h INT;
BEGIN
  SELECT instance_name, recovery_mode_until, warmup_started_at, created_at,
         manual_review_required, fatal_lock_until
    INTO v_inst
    FROM public.whatsapp_instances
    WHERE instance_name = p_instance;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'instance_not_found');
  END IF;

  -- Hard-lock fatal: bloqueia tudo, separado de recovery normal
  IF COALESCE(v_inst.manual_review_required, FALSE)
     OR (v_inst.fatal_lock_until IS NOT NULL AND v_inst.fatal_lock_until > now()) THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'fatal_lock_manual_review',
      'until', v_inst.fatal_lock_until
    );
  END IF;

  IF v_inst.recovery_mode_until IS NOT NULL AND v_inst.recovery_mode_until > now() THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'recovery_mode',
      'until', v_inst.recovery_mode_until
    );
  END IF;

  SELECT
    count(*) FILTER (WHERE signal_type = 'reconnect'),
    count(*) FILTER (WHERE signal_type = 'send_failure'),
    count(*) FILTER (WHERE signal_type = 'disconnect_fatal')
  INTO v_reconnects_6h, v_failures_6h, v_fatals_6h
  FROM public.instance_risk_signals
  WHERE instance_name = p_instance
    AND expires_at > now();

  IF v_fatals_6h >= 1 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'fatal_disconnect_pending_confirmation');
  END IF;
  IF v_reconnects_6h >= 3 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'too_many_reconnects');
  END IF;
  IF v_failures_6h >= 10 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'too_many_send_failures');
  END IF;

  v_warmup_day := GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (now() - COALESCE(v_inst.warmup_started_at, v_inst.created_at, now()))) / 86400)::INT + 1);

  v_cap := CASE
    WHEN v_warmup_day = 1 THEN 20
    WHEN v_warmup_day = 2 THEN 40
    WHEN v_warmup_day = 3 THEN 80
    WHEN v_warmup_day = 4 THEN 110
    WHEN v_warmup_day <= 6 THEN 150
    WHEN v_warmup_day <= 8 THEN 250
    WHEN v_warmup_day <= 10 THEN 350
    WHEN v_warmup_day <= 13 THEN 450
    ELSE 600
  END;
  v_min_interval_ms := CASE
    WHEN v_warmup_day = 1 THEN 60000
    WHEN v_warmup_day <= 3 THEN 45000
    WHEN v_warmup_day <= 6 THEN 35000
    WHEN v_warmup_day <= 10 THEN 25000
    ELSE 18000
  END;

  SELECT sent_count, last_send_at INTO v_sent, v_last_send
    FROM public.instance_send_counters
    WHERE instance_name = p_instance AND day = v_today;
  v_sent := COALESCE(v_sent, 0);

  IF v_sent >= v_cap THEN
    RETURN jsonb_build_object(
      'allowed', false, 'reason', 'daily_cap_reached',
      'warmup_day', v_warmup_day, 'cap', v_cap, 'sent', v_sent
    );
  END IF;

  IF v_last_send IS NOT NULL AND v_last_send + make_interval(secs => v_min_interval_ms / 1000.0) > now() THEN
    RETURN jsonb_build_object(
      'allowed', false, 'reason', 'min_interval_not_elapsed',
      'warmup_day', v_warmup_day, 'min_interval_ms', v_min_interval_ms,
      'next_allowed_at', v_last_send + make_interval(secs => v_min_interval_ms / 1000.0)
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'warmup_day', v_warmup_day,
    'cap', v_cap,
    'sent', v_sent,
    'remaining', v_cap - v_sent,
    'min_interval_ms', v_min_interval_ms
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.check_send_quota(TEXT) TO service_role, authenticated;

-- Marca a instância 953f7e48509b (que sofreu o 403 agora) com a trava fatal
-- explícita, para o estado novo já refletir o incidente real.
UPDATE public.whatsapp_instances
   SET manual_review_required = TRUE,
       fatal_disconnect_reason = COALESCE(fatal_disconnect_reason, 403),
       fatal_disconnect_at = COALESCE(fatal_disconnect_at, now()),
       fatal_lock_until = GREATEST(
         COALESCE(fatal_lock_until, now()),
         COALESCE(recovery_mode_until, now() + interval '14 days')
       ),
       updated_at = now()
 WHERE instance_name = 'igreen-953f7e48509b';
