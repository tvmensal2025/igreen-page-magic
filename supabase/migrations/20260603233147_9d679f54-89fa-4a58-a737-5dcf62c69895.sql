
-- ============================================================
-- Plano A anti-ban: cooldowns + warmup + circuit breaker
-- ============================================================

-- 1) Cooldowns de reconexão (persistente, substitui Map em memória)
CREATE TABLE IF NOT EXISTS public.instance_reconnect_cooldowns (
  instance_name TEXT PRIMARY KEY,
  next_allowed_at TIMESTAMPTZ NOT NULL,
  reason TEXT,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.instance_reconnect_cooldowns TO service_role;
ALTER TABLE public.instance_reconnect_cooldowns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access reconnect cooldowns"
  ON public.instance_reconnect_cooldowns FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2) Contadores diários de envio (warmup)
CREATE TABLE IF NOT EXISTS public.instance_send_counters (
  instance_name TEXT NOT NULL,
  day DATE NOT NULL,
  sent_count INT NOT NULL DEFAULT 0,
  first_send_at TIMESTAMPTZ,
  last_send_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_name, day)
);
GRANT ALL ON public.instance_send_counters TO service_role;
GRANT SELECT ON public.instance_send_counters TO authenticated;
ALTER TABLE public.instance_send_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access send counters"
  ON public.instance_send_counters FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "consultants read own counters"
  ON public.instance_send_counters FOR SELECT TO authenticated
  USING (instance_name IN (
    SELECT instance_name FROM public.whatsapp_instances WHERE consultant_id = auth.uid()
  ));

-- 3) Sinais de risco (circuit breaker)
CREATE TABLE IF NOT EXISTS public.instance_risk_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_name TEXT NOT NULL,
  signal_type TEXT NOT NULL, -- 'reconnect','send_failure','disconnect_fatal','disconnect_transient'
  severity TEXT NOT NULL DEFAULT 'low', -- 'low','medium','high','critical'
  metadata JSONB,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '6 hours',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_risk_signals_instance_time
  ON public.instance_risk_signals(instance_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_signals_expires
  ON public.instance_risk_signals(expires_at);
GRANT ALL ON public.instance_risk_signals TO service_role;
GRANT SELECT ON public.instance_risk_signals TO authenticated;
ALTER TABLE public.instance_risk_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access risk signals"
  ON public.instance_risk_signals FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "consultants read own risk signals"
  ON public.instance_risk_signals FOR SELECT TO authenticated
  USING (instance_name IN (
    SELECT instance_name FROM public.whatsapp_instances WHERE consultant_id = auth.uid()
  ));

-- 4) Modo recuperação na instância
ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS recovery_mode_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warmup_started_at TIMESTAMPTZ;

-- ============================================================
-- RPCs
-- ============================================================

-- A) Cooldown de reconexão: tenta adquirir slot. Retorna true se pode reconectar agora.
CREATE OR REPLACE FUNCTION public.try_acquire_reconnect_slot(
  p_instance TEXT,
  p_cooldown_ms INT DEFAULT 600000  -- 10 minutos
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_next TIMESTAMPTZ;
BEGIN
  SELECT next_allowed_at INTO v_next
    FROM public.instance_reconnect_cooldowns
    WHERE instance_name = p_instance
    FOR UPDATE;

  IF v_next IS NOT NULL AND v_next > v_now THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.instance_reconnect_cooldowns
    (instance_name, next_allowed_at, attempts, updated_at)
  VALUES
    (p_instance, v_now + make_interval(secs => p_cooldown_ms / 1000.0), 1, v_now)
  ON CONFLICT (instance_name) DO UPDATE
    SET next_allowed_at = EXCLUDED.next_allowed_at,
        attempts = public.instance_reconnect_cooldowns.attempts + 1,
        updated_at = v_now;
  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.try_acquire_reconnect_slot(TEXT, INT) TO service_role;

-- B) Registrar sinal de risco
CREATE OR REPLACE FUNCTION public.record_risk_signal(
  p_instance TEXT,
  p_signal_type TEXT,
  p_severity TEXT DEFAULT 'low',
  p_metadata JSONB DEFAULT NULL,
  p_ttl_hours INT DEFAULT 6
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.instance_risk_signals
    (instance_name, signal_type, severity, metadata, expires_at)
  VALUES
    (p_instance, p_signal_type, p_severity, p_metadata,
     now() + make_interval(hours => p_ttl_hours))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_risk_signal(TEXT, TEXT, TEXT, JSONB, INT) TO service_role;

-- C) Verifica cota de envio respeitando warmup, recovery mode e circuit breaker
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
  SELECT instance_name, recovery_mode_until, warmup_started_at, created_at
    INTO v_inst
    FROM public.whatsapp_instances
    WHERE instance_name = p_instance;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'instance_not_found');
  END IF;

  -- Recovery mode trava tudo
  IF v_inst.recovery_mode_until IS NOT NULL AND v_inst.recovery_mode_until > now() THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'recovery_mode',
      'until', v_inst.recovery_mode_until
    );
  END IF;

  -- Circuit breaker: olha sinais ativos
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

  -- Calcula dia de warmup (1-based)
  v_warmup_day := GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (now() - COALESCE(v_inst.warmup_started_at, v_inst.created_at, now()))) / 86400)::INT + 1);

  -- Ramp: D1=20, D2=40, D3=80, D5=150, D8=250, D11=400, D14+=600
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
  -- Intervalo mínimo: D1=60s → D14=18s
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

-- D) Registra envio (incrementa contador)
CREATE OR REPLACE FUNCTION public.register_send(p_instance TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_today DATE := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  INSERT INTO public.instance_send_counters
    (instance_name, day, sent_count, first_send_at, last_send_at)
  VALUES (p_instance, v_today, 1, now(), now())
  ON CONFLICT (instance_name, day) DO UPDATE
    SET sent_count = public.instance_send_counters.sent_count + 1,
        last_send_at = now(),
        first_send_at = COALESCE(public.instance_send_counters.first_send_at, now()),
        updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.register_send(TEXT) TO service_role;

-- E) Ativa modo recuperação (kill switch + pós-incidente)
CREATE OR REPLACE FUNCTION public.activate_recovery_mode(
  p_instance TEXT,
  p_hours INT DEFAULT 336  -- 14 dias
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.whatsapp_instances
    SET recovery_mode_until = GREATEST(
          COALESCE(recovery_mode_until, now()),
          now() + make_interval(hours => p_hours)
        ),
        updated_at = now()
    WHERE instance_name = p_instance;
END;
$$;
GRANT EXECUTE ON FUNCTION public.activate_recovery_mode(TEXT, INT) TO service_role;

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at_simple() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_reconnect_cooldowns_updated ON public.instance_reconnect_cooldowns;
CREATE TRIGGER trg_reconnect_cooldowns_updated
  BEFORE UPDATE ON public.instance_reconnect_cooldowns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_simple();

DROP TRIGGER IF EXISTS trg_send_counters_updated ON public.instance_send_counters;
CREATE TRIGGER trg_send_counters_updated
  BEFORE UPDATE ON public.instance_send_counters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_simple();
