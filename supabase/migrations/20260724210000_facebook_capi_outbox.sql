-- CAPI (Conversions API) via outbox transacional.
--
-- PROBLEMAS DO FLUXO ANTERIOR
--  1. `fb_emit_capi` fazia `net.http_post` para a edge `facebook-capi` mandando
--     APENAS o `apikey` anon. A edge usa `resolveCaller`, que exige
--     `x-service-secret` ou JWT válido — logo devolvia 401. Todo evento vindo de
--     trigger (Lead, InitiateCheckout, Purchase) era descartado em silêncio.
--  2. O gate `facebook_connections.pixel_id IS NOT NULL` barrava consultores que
--     usam o pixel CENTRAL da plataforma (o modelo atual), e o SELECT sem LIMIT
--     ainda podia estourar com múltiplas linhas.
--  3. `net.http_post` é fire-and-forget: sem retry, sem registro de falha.
--  4. Na edge, o POST à Meta acontecia ANTES de persistir. Morrendo no meio, não
--     sobrava rastro; e o retorno era `ok:true` mesmo quando a Meta recusava.
--
-- SOLUÇÃO: outbox. O trigger só INSERE na fila, na MESMA transação do
-- `customers` — se a transação der rollback, não sobra evento fantasma. Um
-- despachante lê a fila e envia com retry/backoff usando SEMPRE o mesmo
-- `event_key` como `event_id` (a Meta deduplica por event_id, então repetir é
-- seguro e não infla conversão).
--
-- PII: a fila NÃO guarda e-mail/telefone em texto. Quando há `customer_id`, o
-- despachante lê e hasheia na hora do envio; chamadas diretas entregam
-- `hashed_user_data` já em SHA-256.
--
-- ADITIVO. Os triggers `trg_fb_lead` / `trg_fb_purchase` continuam existindo e
-- com a mesma assinatura de `fb_emit_capi` — só o corpo muda.

CREATE TABLE IF NOT EXISTS public.facebook_capi_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Chave estável do evento = `event_id` enviado à Meta. UNIQUE garante que o
  -- mesmo fato de negócio não entra duas vezes na fila.
  event_key text NOT NULL,
  consultant_id uuid NOT NULL,
  customer_id uuid,
  event_name text NOT NULL,
  value_numeric numeric,
  currency text NOT NULL DEFAULT 'BRL',
  -- Já hasheado (SHA-256). Nulo quando o despachante deve derivar de customer_id.
  hashed_user_data jsonb,
  -- Contexto sem PII: fbp, fbc, source_url, offline, offline_event_set_id...
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'dead')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  last_error text,
  fb_response jsonb,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT facebook_capi_outbox_event_key_unique UNIQUE (event_key)
);

-- Fila de trabalho: só o que está pendente e maduro.
CREATE INDEX IF NOT EXISTS facebook_capi_outbox_ready_idx
  ON public.facebook_capi_outbox (next_attempt_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS facebook_capi_outbox_dead_idx
  ON public.facebook_capi_outbox (created_at DESC)
  WHERE status = 'dead';

ALTER TABLE public.facebook_capi_outbox ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.facebook_capi_outbox IS
  'Fila de eventos CAPI. UNIQUE(event_key) = event_id estável; a Meta deduplica, então retry é seguro.';

-- ── Enfileira (idempotente) ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_facebook_capi_event(
  _event_key text,
  _consultant_id uuid,
  _event_name text,
  _customer_id uuid DEFAULT NULL,
  _value numeric DEFAULT NULL,
  _currency text DEFAULT 'BRL',
  _hashed_user_data jsonb DEFAULT NULL,
  _context jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
BEGIN
  IF _event_key IS NULL OR btrim(_event_key) = ''
     OR _consultant_id IS NULL
     OR _event_name IS NULL OR btrim(_event_name) = '' THEN
    RETURN jsonb_build_object('enqueued', false, 'reason', 'invalid_arguments');
  END IF;

  INSERT INTO public.facebook_capi_outbox (
    event_key, consultant_id, customer_id, event_name,
    value_numeric, currency, hashed_user_data, context
  ) VALUES (
    btrim(_event_key), _consultant_id, _customer_id, _event_name,
    _value, COALESCE(NULLIF(_currency, ''), 'BRL'),
    _hashed_user_data, COALESCE(_context, '{}'::jsonb)
  )
  ON CONFLICT (event_key) DO NOTHING
  RETURNING id INTO _id;

  IF _id IS NULL THEN
    -- Mesmo fato já enfileirado/enviado: resposta idempotente, não erro.
    RETURN jsonb_build_object('enqueued', false, 'reason', 'duplicate');
  END IF;
  RETURN jsonb_build_object('enqueued', true, 'reason', 'enqueued', 'id', _id);
END;
$$;

-- ── Reserva um lote para envio (lease + backoff) ───────────────────────────
CREATE OR REPLACE FUNCTION public.claim_facebook_capi_events(
  _limit integer DEFAULT 25,
  _lease_seconds integer DEFAULT 120
) RETURNS TABLE (
  id uuid,
  event_key text,
  consultant_id uuid,
  customer_id uuid,
  event_name text,
  value_numeric numeric,
  currency text,
  hashed_user_data jsonb,
  context jsonb,
  attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _lease interval := make_interval(
    secs => GREATEST(COALESCE(_lease_seconds, 120), 30)
  );
BEGIN
  RETURN QUERY
  WITH ready AS (
    SELECT o.id
      FROM public.facebook_capi_outbox o
     WHERE o.status = 'pending'
       AND o.next_attempt_at <= now()
       AND (o.locked_until IS NULL OR o.locked_until <= now())
     ORDER BY o.next_attempt_at
     LIMIT GREATEST(COALESCE(_limit, 25), 1)
     -- SKIP LOCKED: duas execuções do cron nunca pegam o mesmo evento.
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.facebook_capi_outbox o
     SET locked_until = now() + _lease,
         attempts = o.attempts + 1,
         updated_at = now()
    FROM ready
   WHERE o.id = ready.id
  RETURNING o.id, o.event_key, o.consultant_id, o.customer_id, o.event_name,
            o.value_numeric, o.currency, o.hashed_user_data, o.context,
            o.attempts;
END;
$$;

-- ── Confirma envio ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_facebook_capi_sent(
  _id uuid,
  _response jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.facebook_capi_outbox
     SET status = 'sent',
         locked_until = NULL,
         last_error = NULL,
         fb_response = COALESCE(_response, fb_response),
         sent_at = now(),
         updated_at = now()
   WHERE id = _id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Variante por chave: usada pelo envio inline da edge `facebook-capi`, que
-- conhece o `event_key` mas não o id da linha (pode já existir na fila).
CREATE OR REPLACE FUNCTION public.mark_facebook_capi_sent_by_key(
  _event_key text,
  _response jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.facebook_capi_outbox
     SET status = 'sent',
         locked_until = NULL,
         last_error = NULL,
         fb_response = COALESCE(_response, fb_response),
         sent_at = now(),
         updated_at = now()
   WHERE event_key = btrim(COALESCE(_event_key, ''))
     AND status <> 'sent';
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── Registra falha com backoff exponencial; vira 'dead' no teto ────────────
CREATE OR REPLACE FUNCTION public.mark_facebook_capi_failed(
  _id uuid,
  _error text,
  _response jsonb DEFAULT NULL,
  _max_attempts integer DEFAULT 6
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _attempts integer;
  _dead boolean;
  _delay interval;
BEGIN
  SELECT attempts INTO _attempts
    FROM public.facebook_capi_outbox WHERE id = _id;
  IF _attempts IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  _dead := _attempts >= GREATEST(COALESCE(_max_attempts, 6), 1);
  -- 2^n minutos, com teto de 6h: erro transitório da Meta não vira tempestade.
  _delay := make_interval(
    mins => LEAST(power(2, LEAST(_attempts, 8))::int, 360)
  );

  UPDATE public.facebook_capi_outbox
     SET status = CASE WHEN _dead THEN 'dead' ELSE 'pending' END,
         locked_until = NULL,
         next_attempt_at = CASE WHEN _dead THEN next_attempt_at
                                ELSE now() + _delay END,
         last_error = left(COALESCE(_error, 'erro desconhecido'), 2000),
         fb_response = COALESCE(_response, fb_response),
         updated_at = now()
   WHERE id = _id;

  RETURN jsonb_build_object('ok', true, 'dead', _dead, 'attempts', _attempts);
END;
$$;

-- ── `fb_emit_capi`: mesma assinatura, agora só enfileira ───────────────────
-- Os triggers existentes (trg_fb_lead, trg_fb_purchase) seguem intactos.
CREATE OR REPLACE FUNCTION public.fb_emit_capi(
  _consultant_id uuid,
  _event_name text,
  _customer_id uuid DEFAULT NULL,
  _email text DEFAULT NULL,
  _phone text DEFAULT NULL,
  _value numeric DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _key text;
BEGIN
  IF _consultant_id IS NULL OR _event_name IS NULL THEN RETURN; END IF;

  -- Chave estável por (evento, cliente). Sem cliente, cai no dia + consultor:
  -- evita enxurrada de eventos idênticos por reprocessamento.
  _key := CASE
    WHEN _customer_id IS NOT NULL
      THEN _event_name || ':' || _customer_id::text
    ELSE _event_name || ':' || _consultant_id::text || ':' ||
         to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')
  END;

  -- NÃO grava e-mail/telefone: o despachante lê de `customers` no envio.
  PERFORM public.enqueue_facebook_capi_event(
    _key,
    _consultant_id,
    _event_name,
    _customer_id,
    _value,
    'BRL',
    NULL,
    jsonb_build_object('source', 'db_trigger')
  );
END;
$$;

COMMENT ON FUNCTION public.fb_emit_capi(uuid, text, uuid, text, text, numeric) IS
  'Enfileira evento CAPI no outbox (mesma transação do trigger). Não faz HTTP.';

-- ── Toggle do despachante: nasce DESLIGADO ────────────────────────────────
-- Regra do projeto: motor novo não entra ligado. Ligar é decisão humana.
INSERT INTO public.automation_toggles (key, label, description, category, enabled)
VALUES (
  'facebook_capi_dispatch',
  'Despachante CAPI (fila de conversões Meta)',
  'Envia os eventos da fila facebook_capi_outbox para a Meta com retry e backoff. Desligado por padrão.',
  'ads',
  false
)
ON CONFLICT (key) DO NOTHING;

-- ── Permissões: service_role apenas ───────────────────────────────────────
REVOKE ALL ON FUNCTION public.enqueue_facebook_capi_event(text, uuid, text, uuid, numeric, text, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_facebook_capi_event(text, uuid, text, uuid, numeric, text, jsonb, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_facebook_capi_event(text, uuid, text, uuid, numeric, text, jsonb, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.claim_facebook_capi_events(integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_facebook_capi_events(integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_facebook_capi_events(integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.mark_facebook_capi_sent(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_facebook_capi_sent(uuid, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_facebook_capi_sent(uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.mark_facebook_capi_sent_by_key(text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_facebook_capi_sent_by_key(text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_facebook_capi_sent_by_key(text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.mark_facebook_capi_failed(uuid, text, jsonb, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_facebook_capi_failed(uuid, text, jsonb, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_facebook_capi_failed(uuid, text, jsonb, integer) TO service_role;
