-- Cobrança de gasto Meta: idempotente e transacional.
--
-- PROBLEMA (fluxo anterior, em `facebook-sync-metrics`):
--   1) lê `facebook_metrics_daily.synced_to_wallet_cents`  (transação A)
--   2) calcula delta no JS
--   3) chama `debit_consultant_wallet`                     (transação B)
--   4) grava o novo checkpoint no upsert                   (transação C)
-- Como B e C são transações distintas, dois modos de falha cobram em dobro:
--   * a função morre entre 3 e 4 → o checkpoint fica velho e o próximo ciclo
--     debita o MESMO delta de novo;
--   * duas execuções concorrentes (cron de 6h + botão "Sincronizar" da UI)
--     leem o mesmo `synced_to_wallet_cents` e ambas debitam.
--
-- SOLUÇÃO: uma única transação que trava a linha do dia, recalcula o delta
-- internamente, registra a observação com chave única (a garantia de
-- "cobra uma vez só"), debita e avança o checkpoint. Se qualquer passo falhar,
-- TUDO volta atrás — inclusive a observação — então o retry é seguro.
--
-- ADITIVO: só cria tabelas/funções novas. Não altera nem remove nada existente.
-- `debit_consultant_wallet` continua sendo a única porta de débito da carteira.

-- ── Observações de gasto: uma linha por (campanha, dia, gasto observado) ────
CREATE TABLE IF NOT EXISTS public.campaign_spend_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.facebook_campaigns(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL,
  metric_date date NOT NULL,
  -- Gasto ACUMULADO do dia informado pela Meta nesta leitura.
  observed_spend_cents bigint NOT NULL CHECK (observed_spend_cents >= 0),
  -- Checkpoint que existia antes desta cobrança.
  previous_synced_cents bigint NOT NULL DEFAULT 0,
  delta_spend_cents bigint NOT NULL CHECK (delta_spend_cents > 0),
  fee_cents bigint NOT NULL DEFAULT 0,
  charged_cents bigint NOT NULL CHECK (charged_cents > 0),
  balance_after_cents bigint,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  charged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- ESTA é a garantia de idempotência financeira: a mesma leitura da Meta
  -- (mesmo dia, mesmo acumulado) nunca gera uma segunda cobrança.
  CONSTRAINT campaign_spend_observations_unique_observation
    UNIQUE (campaign_id, metric_date, observed_spend_cents)
);

CREATE INDEX IF NOT EXISTS campaign_spend_observations_consultant_idx
  ON public.campaign_spend_observations (consultant_id, metric_date DESC);

ALTER TABLE public.campaign_spend_observations ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.campaign_spend_observations IS
  'Trilha de cobrança de gasto Meta. UNIQUE(campaign_id, metric_date, observed_spend_cents) impede cobrança dupla.';

-- ── Log de reconciliação: 1 linha por dia, para revisão humana ──────────────
CREATE TABLE IF NOT EXISTS public.ads_spend_reconciliation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciled_date date NOT NULL,
  meta_lifetime_cents bigint NOT NULL DEFAULT 0,
  system_lifetime_cents bigint NOT NULL DEFAULT 0,
  delta_cents bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'BRL',
  requires_review boolean NOT NULL DEFAULT false,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ads_spend_reconciliation_log_unique_date UNIQUE (reconciled_date)
);

ALTER TABLE public.ads_spend_reconciliation_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ads_spend_reconciliation_log IS
  'Divergência diária Meta vs sistema. Só registra para revisão — nunca ajusta carteira automaticamente.';

-- ── RPC transacional de cobrança ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.debit_campaign_spend_observation(
  _campaign_id uuid,
  _metric_date date,
  _observed_spend_cents bigint,
  _fee_percent numeric DEFAULT 0,
  _activity_label text DEFAULT NULL,
  _metadata jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _consultant_id uuid;
  _previous bigint;
  _delta bigint;
  _charged bigint;
  _fee bigint;
  _observation_id uuid;
  _balance bigint;
  _description text;
  _meta jsonb := COALESCE(_metadata, '{}'::jsonb);
BEGIN
  IF _campaign_id IS NULL OR _metric_date IS NULL THEN
    RETURN jsonb_build_object('charged', false, 'reason', 'invalid_arguments');
  END IF;
  IF _observed_spend_cents IS NULL OR _observed_spend_cents < 0 THEN
    RETURN jsonb_build_object('charged', false, 'reason', 'invalid_observation');
  END IF;

  SELECT consultant_id INTO _consultant_id
    FROM public.facebook_campaigns
   WHERE id = _campaign_id;
  IF _consultant_id IS NULL THEN
    RETURN jsonb_build_object('charged', false, 'reason', 'campaign_not_found');
  END IF;

  -- Serializa cron de 6h e clique manual sobre a mesma campanha/dia. O lock é
  -- por transação: cai sozinho no commit/rollback.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(_campaign_id::text || ':' || _metric_date::text, 0)
  );

  -- Garante a linha do dia para poder travá-la (todas as outras colunas têm default).
  INSERT INTO public.facebook_metrics_daily (campaign_id, date)
  VALUES (_campaign_id, _metric_date)
  ON CONFLICT (campaign_id, date) DO NOTHING;

  SELECT COALESCE(synced_to_wallet_cents, 0) INTO _previous
    FROM public.facebook_metrics_daily
   WHERE campaign_id = _campaign_id AND date = _metric_date
     FOR UPDATE;

  _delta := _observed_spend_cents - COALESCE(_previous, 0);
  IF _delta <= 0 THEN
    -- Meta revisou o gasto para baixo (ou nada novo). Nunca estorna sozinho e
    -- nunca abaixa o checkpoint — abaixar reabriria a porta da cobrança dupla.
    RETURN jsonb_build_object(
      'charged', false,
      'reason', 'no_delta',
      'delta_spend_cents', 0,
      'synced_to_wallet_cents', COALESCE(_previous, 0)
    );
  END IF;

  _charged := round(_delta * (1 + COALESCE(_fee_percent, 0)))::bigint;
  IF _charged < _delta THEN
    _charged := _delta; -- taxa nunca reduz o valor bruto
  END IF;
  _fee := _charged - _delta;

  INSERT INTO public.campaign_spend_observations (
    campaign_id, consultant_id, metric_date, observed_spend_cents,
    previous_synced_cents, delta_spend_cents, fee_cents, charged_cents, metadata
  ) VALUES (
    _campaign_id, _consultant_id, _metric_date, _observed_spend_cents,
    COALESCE(_previous, 0), _delta, _fee, _charged, _meta
  )
  ON CONFLICT (campaign_id, metric_date, observed_spend_cents) DO NOTHING
  RETURNING id INTO _observation_id;

  IF _observation_id IS NULL THEN
    -- Já cobrado por outra execução. Resposta idempotente, não erro.
    RETURN jsonb_build_object(
      'charged', false,
      'reason', 'duplicate_observation',
      'synced_to_wallet_cents', COALESCE(_previous, 0)
    );
  END IF;

  _description := 'Campanha • '
    || to_char(_metric_date, 'DD/MM') || ' '
    || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI')
    || ' • Meta R$ ' || to_char(_delta / 100.0, 'FM999999990.00')
    || ' + taxa R$ ' || to_char(_fee / 100.0, 'FM999999990.00')
    || ' = R$ ' || to_char(_charged / 100.0, 'FM999999990.00')
    || ' • ' || COALESCE(NULLIF(_activity_label, ''), 'sem novas interações');

  -- Mesma porta de débito de sempre, agora dentro da MESMA transação do checkpoint.
  _balance := public.debit_consultant_wallet(
    _consultant_id,
    _charged,
    _campaign_id,
    _description,
    _meta || jsonb_build_object(
      'date', _metric_date,
      'gross_meta_cents', _delta,
      'platform_fee_cents', _fee,
      'fee_percent', COALESCE(_fee_percent, 0),
      'observation_id', _observation_id,
      'synced_at', now()
    ),
    _delta
  );

  UPDATE public.facebook_metrics_daily
     SET synced_to_wallet_cents = _observed_spend_cents,
         platform_fee_cents = COALESCE(platform_fee_cents, 0) + _fee,
         updated_at = now()
   WHERE campaign_id = _campaign_id AND date = _metric_date;

  UPDATE public.campaign_spend_observations
     SET balance_after_cents = _balance,
         charged_at = now()
   WHERE id = _observation_id;

  RETURN jsonb_build_object(
    'charged', true,
    'reason', 'charged',
    'delta_spend_cents', _delta,
    'fee_cents', _fee,
    'charged_cents', _charged,
    'synced_to_wallet_cents', _observed_spend_cents,
    'balance_after_cents', _balance,
    'observation_id', _observation_id
  );
END;
$$;

COMMENT ON FUNCTION public.debit_campaign_spend_observation(uuid, date, bigint, numeric, text, jsonb) IS
  'INTERNAL: service_role only (facebook-sync-metrics). Cobrança idempotente e transacional do gasto Meta.';

-- ── Registro idempotente da reconciliação diária ────────────────────────────
CREATE OR REPLACE FUNCTION public.record_ads_spend_reconciliation(
  _reconciled_date date,
  _meta_lifetime_cents bigint,
  _system_lifetime_cents bigint,
  _currency text DEFAULT 'BRL',
  _review_threshold_cents bigint DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _delta bigint := COALESCE(_meta_lifetime_cents, 0) - COALESCE(_system_lifetime_cents, 0);
  _requires_review boolean := abs(
    COALESCE(_meta_lifetime_cents, 0) - COALESCE(_system_lifetime_cents, 0)
  ) >= GREATEST(COALESCE(_review_threshold_cents, 50), 0);
  _inserted boolean := false;
BEGIN
  INSERT INTO public.ads_spend_reconciliation_log (
    reconciled_date, meta_lifetime_cents, system_lifetime_cents,
    delta_cents, currency, requires_review
  ) VALUES (
    COALESCE(_reconciled_date, (now() AT TIME ZONE 'America/Sao_Paulo')::date),
    COALESCE(_meta_lifetime_cents, 0),
    COALESCE(_system_lifetime_cents, 0),
    _delta,
    COALESCE(NULLIF(_currency, ''), 'BRL'),
    _requires_review
  )
  ON CONFLICT (reconciled_date) DO UPDATE
     SET meta_lifetime_cents = EXCLUDED.meta_lifetime_cents,
         system_lifetime_cents = EXCLUDED.system_lifetime_cents,
         delta_cents = EXCLUDED.delta_cents,
         currency = EXCLUDED.currency,
         requires_review = EXCLUDED.requires_review;
  _inserted := true;

  RETURN jsonb_build_object(
    'recorded', _inserted,
    'delta_cents', _delta,
    'requires_review', _requires_review
  );
END;
$$;

COMMENT ON FUNCTION public.record_ads_spend_reconciliation(date, bigint, bigint, text, bigint) IS
  'INTERNAL: service_role only (facebook-balance-reconcile). Registra divergência do dia; não mexe em carteira.';

-- ── Permissões: service_role apenas ────────────────────────────────────────
REVOKE ALL ON FUNCTION public.debit_campaign_spend_observation(uuid, date, bigint, numeric, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.debit_campaign_spend_observation(uuid, date, bigint, numeric, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debit_campaign_spend_observation(uuid, date, bigint, numeric, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.record_ads_spend_reconciliation(date, bigint, bigint, text, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_ads_spend_reconciliation(date, bigint, bigint, text, bigint) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ads_spend_reconciliation(date, bigint, bigint, text, bigint) TO service_role;
