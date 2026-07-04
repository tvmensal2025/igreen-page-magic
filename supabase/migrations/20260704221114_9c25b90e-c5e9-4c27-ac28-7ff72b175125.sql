
-- 1) check_send_quota: remove os dois gatilhos automáticos que travavam a instância
--    após um simples connection.close (fatal_lock_until vindo de register_fatal_disconnect
--    e signal_type='disconnect_fatal'). manual_review_required continua bloqueando,
--    mas agora só é setado pela nova RPC admin_mark_instance_banned (ação humana).
CREATE OR REPLACE FUNCTION public.check_send_quota(p_instance text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
BEGIN
  SELECT instance_name, status, recovery_mode_until, warmup_started_at, created_at,
         manual_review_required
    INTO v_inst
    FROM public.whatsapp_instances
    WHERE instance_name = p_instance;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'instance_not_found');
  END IF;

  -- 🚫 Ban confirmado por humano (super admin marcou manualmente).
  -- Nunca setado automaticamente por connection.close.
  IF COALESCE(v_inst.manual_review_required, FALSE) THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'manual_ban_review'
    );
  END IF;

  IF v_inst.recovery_mode_until IS NOT NULL AND v_inst.recovery_mode_until > now() THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'recovery_mode',
      'until', v_inst.recovery_mode_until
    );
  END IF;

  -- Circuit breakers por sinais recentes (mantidos, exceto disconnect_fatal
  -- que passou a ser tratado como transient).
  SELECT
    count(*) FILTER (WHERE signal_type = 'reconnect'),
    count(*) FILTER (WHERE signal_type = 'send_failure')
  INTO v_reconnects_6h, v_failures_6h
  FROM public.instance_risk_signals
  WHERE instance_name = p_instance
    AND expires_at > now();

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
    WHEN v_warmup_day = 1 THEN 8000
    WHEN v_warmup_day <= 3 THEN 5000
    WHEN v_warmup_day <= 6 THEN 4000
    WHEN v_warmup_day <= 10 THEN 3000
    ELSE 3000
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
$function$;

-- 2) Marcar manualmente como banida (super admin) — sem prazo fixo.
CREATE OR REPLACE FUNCTION public.admin_mark_instance_banned(
  p_instance TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  UPDATE public.whatsapp_instances
     SET manual_review_required = TRUE,
         status = 'needs_reconnect',
         updated_at = now()
   WHERE instance_name = p_instance;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'instance_not_found');
  END IF;

  BEGIN
    INSERT INTO public.admin_audit_log (actor_user_id, action, entity_type, entity_id, details)
    VALUES (auth.uid(), 'instance_marked_banned', 'whatsapp_instance', p_instance,
            jsonb_build_object('note', p_note));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mark_instance_banned(TEXT, TEXT) TO authenticated, service_role;

-- 3) Destravar manualmente uma instância banida ou com lock legado.
CREATE OR REPLACE FUNCTION public.admin_clear_ban(
  p_instance TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  UPDATE public.whatsapp_instances
     SET manual_review_required = FALSE,
         fatal_lock_until = NULL,
         recovery_mode_until = NULL,
         status = CASE WHEN status = 'connected' THEN 'connected' ELSE 'needs_reconnect' END,
         updated_at = now()
   WHERE instance_name = p_instance;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'instance_not_found');
  END IF;

  DELETE FROM public.instance_risk_signals
   WHERE instance_name = p_instance
     AND signal_type = 'disconnect_fatal';

  BEGIN
    INSERT INTO public.admin_audit_log (actor_user_id, action, entity_type, entity_id, details)
    VALUES (auth.uid(), 'instance_ban_cleared', 'whatsapp_instance', p_instance,
            jsonb_build_object('note', p_note));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_clear_ban(TEXT, TEXT) TO authenticated, service_role;
