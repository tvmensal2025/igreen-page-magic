-- Cobrança plataforma: SMS R$0,10 + voz R$0,10/30s (ceil) — idempotente.
-- Welcome R$1,00 na 1ª criação da wallet. Não altera debit_consultant_wallet.

-- ── Observações de uso (voz/SMS) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_usage_billing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('sms', 'voice')),
  provider_ref text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  duration_sec integer,
  blocks integer,
  balance_after_cents bigint,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  charged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_usage_billing_unique_ref UNIQUE (kind, provider_ref)
);

CREATE INDEX IF NOT EXISTS platform_usage_billing_consultant_idx
  ON public.platform_usage_billing (consultant_id, created_at DESC);

ALTER TABLE public.platform_usage_billing ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.platform_usage_billing IS
  'Cobrança iGreen Fone (SMS/voz). UNIQUE(kind, provider_ref) impede cobrança dupla.';

-- ── Dedup alerta saldo baixo (1 aviso / 24h por consultor) ──────────────────
CREATE TABLE IF NOT EXISTS public.platform_low_balance_alerts (
  consultant_id uuid PRIMARY KEY,
  last_notified_at timestamptz NOT NULL DEFAULT now(),
  last_balance_cents bigint,
  last_debt_cents bigint,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_low_balance_alerts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.platform_low_balance_alerts IS
  'Último alerta de crédito SMS/ligação zerado — evita spam WhatsApp ao consultor.';

-- ── Seed welcome R$1,00 só na 1ª criação ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_consultant_wallet(_consultant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _inserted uuid;
  _balance bigint;
  _debt bigint;
BEGIN
  IF _consultant_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_consultant');
  END IF;

  INSERT INTO public.consultant_wallet (consultant_id, balance_cents, total_topped_up_cents)
  VALUES (_consultant_id, 100, 100)
  ON CONFLICT (consultant_id) DO NOTHING
  RETURNING consultant_id INTO _inserted;

  IF _inserted IS NOT NULL THEN
    INSERT INTO public.wallet_transactions
      (consultant_id, type, amount_cents, balance_after_cents, description, metadata)
    VALUES (
      _consultant_id,
      'adjustment',
      100,
      100,
      'Crédito inicial — SMS e ligação (iGreen Fone)',
      jsonb_build_object('reason', 'welcome_credit', 'channel', 'platform')
    );
  END IF;

  SELECT balance_cents, COALESCE(debt_cents, 0)
    INTO _balance, _debt
    FROM public.consultant_wallet
   WHERE consultant_id = _consultant_id;

  RETURN jsonb_build_object(
    'ok', true,
    'welcome', _inserted IS NOT NULL,
    'balance_cents', COALESCE(_balance, 0),
    'debt_cents', COALESCE(_debt, 0)
  );
END;
$$;

COMMENT ON FUNCTION public.ensure_consultant_wallet(uuid) IS
  'INTERNAL: cria wallet com R$1,00 de boas-vindas só na 1ª vez (service_role).';

-- ── RPC cobrança idempotente voz/SMS ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.debit_platform_usage_observation(
  _consultant_id uuid,
  _kind text,
  _provider_ref text,
  _amount_cents bigint,
  _description text DEFAULT NULL,
  _metadata jsonb DEFAULT NULL,
  _duration_sec integer DEFAULT NULL,
  _blocks integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _observation_id uuid;
  _balance bigint;
  _debt bigint;
  _meta jsonb := COALESCE(_metadata, '{}'::jsonb);
  _desc text;
BEGIN
  IF _consultant_id IS NULL OR _provider_ref IS NULL OR length(trim(_provider_ref)) = 0 THEN
    RETURN jsonb_build_object('charged', false, 'reason', 'invalid_arguments');
  END IF;
  IF _kind IS NULL OR _kind NOT IN ('sms', 'voice') THEN
    RETURN jsonb_build_object('charged', false, 'reason', 'invalid_kind');
  END IF;
  IF _amount_cents IS NULL OR _amount_cents <= 0 THEN
    RETURN jsonb_build_object('charged', false, 'reason', 'invalid_amount');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(_kind || ':' || _provider_ref, 0)
  );

  -- Garante welcome antes do débito (evita wallet 0 criada pelo debit genérico).
  PERFORM public.ensure_consultant_wallet(_consultant_id);

  INSERT INTO public.platform_usage_billing (
    consultant_id, kind, provider_ref, amount_cents, duration_sec, blocks, metadata
  ) VALUES (
    _consultant_id, _kind, trim(_provider_ref), _amount_cents,
    _duration_sec, _blocks, _meta
  )
  ON CONFLICT (kind, provider_ref) DO NOTHING
  RETURNING id INTO _observation_id;

  IF _observation_id IS NULL THEN
    SELECT balance_cents, COALESCE(debt_cents, 0)
      INTO _balance, _debt
      FROM public.consultant_wallet
     WHERE consultant_id = _consultant_id;
    RETURN jsonb_build_object(
      'charged', false,
      'reason', 'duplicate_observation',
      'balance_after_cents', COALESCE(_balance, 0),
      'debt_cents', COALESCE(_debt, 0)
    );
  END IF;

  _desc := COALESCE(
    NULLIF(trim(_description), ''),
    CASE
      WHEN _kind = 'sms' THEN 'SMS iGreen Fone'
      ELSE 'Ligação iGreen Fone'
    END
  );

  _balance := public.debit_consultant_wallet(
    _consultant_id,
    _amount_cents,
    NULL,
    _desc,
    _meta || jsonb_build_object(
      'channel', _kind,
      'observation_id', _observation_id,
      'provider_ref', trim(_provider_ref),
      'duration_sec', _duration_sec,
      'blocks', _blocks
    ),
    NULL
  );

  SELECT COALESCE(debt_cents, 0) INTO _debt
    FROM public.consultant_wallet
   WHERE consultant_id = _consultant_id;

  UPDATE public.platform_usage_billing
     SET balance_after_cents = _balance,
         charged_at = now()
   WHERE id = _observation_id;

  RETURN jsonb_build_object(
    'charged', true,
    'reason', 'charged',
    'charged_cents', _amount_cents,
    'balance_after_cents', _balance,
    'debt_cents', COALESCE(_debt, 0),
    'observation_id', _observation_id,
    'low_balance', (COALESCE(_balance, 0) <= 0 OR COALESCE(_debt, 0) > 0)
  );
END;
$$;

COMMENT ON FUNCTION public.debit_platform_usage_observation(uuid, text, text, bigint, text, jsonb, integer, integer) IS
  'INTERNAL: service_role. Cobrança idempotente SMS/voz (iGreen Fone).';

-- Claim alerta saldo baixo (true = pode notificar agora)
CREATE OR REPLACE FUNCTION public.claim_platform_low_balance_alert(
  _consultant_id uuid,
  _balance_cents bigint DEFAULT 0,
  _debt_cents bigint DEFAULT 0,
  _cooldown_hours integer DEFAULT 24
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _claimed boolean := false;
BEGIN
  IF _consultant_id IS NULL THEN RETURN false; END IF;

  INSERT INTO public.platform_low_balance_alerts (
    consultant_id, last_notified_at, last_balance_cents, last_debt_cents, updated_at
  ) VALUES (
    _consultant_id, now(), _balance_cents, _debt_cents, now()
  )
  ON CONFLICT (consultant_id) DO UPDATE
    SET last_notified_at = now(),
        last_balance_cents = EXCLUDED.last_balance_cents,
        last_debt_cents = EXCLUDED.last_debt_cents,
        updated_at = now()
  WHERE public.platform_low_balance_alerts.last_notified_at
        <= now() - make_interval(hours => GREATEST(1, COALESCE(_cooldown_hours, 24)))
  RETURNING true INTO _claimed;

  RETURN COALESCE(_claimed, false);
END;
$$;

COMMENT ON FUNCTION public.claim_platform_low_balance_alert(uuid, bigint, bigint, integer) IS
  'INTERNAL: true se pode avisar o consultor (cooldown 24h, atômico).';

REVOKE ALL ON FUNCTION public.ensure_consultant_wallet(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debit_platform_usage_observation(uuid, text, text, bigint, text, jsonb, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_platform_low_balance_alert(uuid, bigint, bigint, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ensure_consultant_wallet(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.debit_platform_usage_observation(uuid, text, text, bigint, text, jsonb, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_platform_low_balance_alert(uuid, bigint, bigint, integer) TO service_role;
