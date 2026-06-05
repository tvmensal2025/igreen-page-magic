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
  v_fatals_6h INT;
BEGIN
  SELECT instance_name, status, recovery_mode_until, warmup_started_at, created_at,
         manual_review_required, fatal_lock_until
    INTO v_inst
    FROM public.whatsapp_instances
    WHERE instance_name = p_instance;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'instance_not_found');
  END IF;

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

  IF v_fatals_6h >= 1 AND COALESCE(v_inst.status, '') IS DISTINCT FROM 'connected' THEN
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
  -- 🚀 2026-06-05: min_interval reduzido drasticamente (antes 60s/45s/35s/25s/18s).
  -- Era o principal causador de latência percebida no fluxo D (bloqueios de 30-45s
  -- entre msgs consecutivas dentro do mesmo turno do bot). Cap diário e signals
  -- (reconnects/failures/fatals) continuam protegendo. Reversão simples: rerun com
  -- valores antigos.
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