-- Saga idempotente da publicação humana de campanha (facebook-create-campaign).
--
-- PROBLEMA: a função cria, em sequência e SEM chave de idempotência,
--   campanha → adset → criativos/anúncios → linha em facebook_campaigns → ativação
-- Só no penúltimo passo o objeto passa a existir no nosso banco. Consequências
-- observadas nesse desenho:
--   * timeout na UI + clique de novo = SEGUNDA campanha real na Meta, gastando;
--   * falha ao persistir depois dos objetos criados = campanha órfã na Meta,
--     invisível para o portal (sem teto, sem waste guard, sem pausa por saldo).
--
-- SOLUÇÃO: reservar a intenção ANTES de tocar na Meta.
--   * `client_request_id` UNIQUE = a mesma intenção nunca publica duas vezes.
--   * lease (`locked_until`) = requisição concorrente recebe "em andamento",
--     não uma nova campanha.
--   * estágios = se cair no meio, sabemos exatamente o que já existe na Meta.
--   * `requires_reconciliation` = marca o caso "existe na Meta, não no portal"
--     para revisão humana em vez de deixar gasto invisível.
--
-- ADITIVO: cria tabela e funções novas. Não altera nada existente.

CREATE TABLE IF NOT EXISTS public.ad_publish_sagas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Chave de idempotência ponta a ponta (enviada ou derivada do payload).
  client_request_id text NOT NULL,
  consultant_id uuid NOT NULL,
  -- Hash canônico do payload: detecta reuso da mesma chave com outro conteúdo.
  request_hash text,
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'failed')),
  stage text NOT NULL DEFAULT 'claimed',
  -- Objetos já criados na Meta, preenchidos conforme a saga avança.
  fb_campaign_id text,
  fb_adset_ids text[] NOT NULL DEFAULT '{}',
  fb_ad_ids text[] NOT NULL DEFAULT '{}',
  campaign_row_id uuid,
  -- Resposta final, devolvida em replay sem recriar nada na Meta.
  result jsonb,
  last_error text,
  -- true = existe objeto na Meta sem par no portal. Exige olho humano.
  requires_reconciliation boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT ad_publish_sagas_client_request_id_key UNIQUE (client_request_id)
);

CREATE INDEX IF NOT EXISTS ad_publish_sagas_consultant_idx
  ON public.ad_publish_sagas (consultant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ad_publish_sagas_reconciliation_idx
  ON public.ad_publish_sagas (requires_reconciliation)
  WHERE requires_reconciliation;

ALTER TABLE public.ad_publish_sagas ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ad_publish_sagas IS
  'Saga de publicação de campanha. UNIQUE(client_request_id) impede publicar a mesma intenção duas vezes.';

-- ── Reserva a intenção antes de qualquer chamada à Meta ─────────────────────
CREATE OR REPLACE FUNCTION public.claim_ad_publish_saga(
  _client_request_id text,
  _consultant_id uuid,
  _request_hash text DEFAULT NULL,
  _lease_seconds integer DEFAULT 300
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _saga public.ad_publish_sagas;
  _lease interval := make_interval(secs => GREATEST(COALESCE(_lease_seconds, 300), 30));
BEGIN
  IF _client_request_id IS NULL OR btrim(_client_request_id) = '' THEN
    RETURN jsonb_build_object('outcome', 'invalid_request_id');
  END IF;
  IF _consultant_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid_consultant');
  END IF;

  -- Serializa tentativas simultâneas com a MESMA chave.
  PERFORM pg_advisory_xact_lock(hashtextextended(_client_request_id, 0));

  SELECT * INTO _saga FROM public.ad_publish_sagas
   WHERE client_request_id = _client_request_id
     FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.ad_publish_sagas (
      client_request_id, consultant_id, request_hash,
      status, stage, attempts, locked_until
    ) VALUES (
      _client_request_id, _consultant_id, _request_hash,
      'in_progress', 'claimed', 1, now() + _lease
    ) RETURNING * INTO _saga;

    RETURN jsonb_build_object(
      'outcome', 'claimed',
      'saga_id', _saga.id,
      'stage', _saga.stage,
      'attempts', _saga.attempts
    );
  END IF;

  -- Dono diferente reusando a chave: nunca deixa vazar entre consultores.
  IF _saga.consultant_id <> _consultant_id THEN
    RETURN jsonb_build_object('outcome', 'owner_mismatch', 'saga_id', _saga.id);
  END IF;

  -- Mesma chave com payload diferente é erro do chamador, não idempotência.
  IF _request_hash IS NOT NULL AND _saga.request_hash IS NOT NULL
     AND _saga.request_hash <> _request_hash THEN
    RETURN jsonb_build_object('outcome', 'payload_mismatch', 'saga_id', _saga.id);
  END IF;

  -- Já terminou: devolve o MESMO resultado, sem tocar na Meta de novo.
  IF _saga.status = 'completed' THEN
    RETURN jsonb_build_object(
      'outcome', 'already_completed',
      'saga_id', _saga.id,
      'stage', _saga.stage,
      'result', COALESCE(_saga.result, '{}'::jsonb)
    );
  END IF;

  -- Lease vivo: outra execução está publicando agora.
  IF _saga.status = 'in_progress'
     AND _saga.locked_until IS NOT NULL
     AND _saga.locked_until > now() THEN
    RETURN jsonb_build_object(
      'outcome', 'in_flight',
      'saga_id', _saga.id,
      'stage', _saga.stage,
      'locked_until', _saga.locked_until
    );
  END IF;

  -- Saga anterior morreu no meio. Se já existe objeto na Meta, NÃO reabre:
  -- publicar de novo criaria campanha duplicada gastando dinheiro.
  IF _saga.fb_campaign_id IS NOT NULL THEN
    UPDATE public.ad_publish_sagas
       SET requires_reconciliation = true,
           status = 'failed',
           locked_until = NULL,
           updated_at = now()
     WHERE id = _saga.id;
    RETURN jsonb_build_object(
      'outcome', 'requires_reconciliation',
      'saga_id', _saga.id,
      'stage', _saga.stage,
      'fb_campaign_id', _saga.fb_campaign_id
    );
  END IF;

  -- Morreu antes de criar qualquer coisa na Meta: pode tentar de novo.
  UPDATE public.ad_publish_sagas
     SET status = 'in_progress',
         attempts = _saga.attempts + 1,
         locked_until = now() + _lease,
         last_error = NULL,
         updated_at = now()
   WHERE id = _saga.id
   RETURNING * INTO _saga;

  RETURN jsonb_build_object(
    'outcome', 'reclaimed',
    'saga_id', _saga.id,
    'stage', _saga.stage,
    'attempts', _saga.attempts
  );
END;
$$;

-- ── Registra avanço de estágio (renova o lease) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.record_ad_publish_stage(
  _saga_id uuid,
  _stage text,
  _fb_campaign_id text DEFAULT NULL,
  _fb_adset_ids text[] DEFAULT NULL,
  _fb_ad_ids text[] DEFAULT NULL,
  _campaign_row_id uuid DEFAULT NULL,
  _lease_seconds integer DEFAULT 300
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _updated public.ad_publish_sagas;
BEGIN
  UPDATE public.ad_publish_sagas
     SET stage = COALESCE(NULLIF(btrim(_stage), ''), stage),
         fb_campaign_id = COALESCE(_fb_campaign_id, fb_campaign_id),
         fb_adset_ids = COALESCE(_fb_adset_ids, fb_adset_ids),
         fb_ad_ids = COALESCE(_fb_ad_ids, fb_ad_ids),
         campaign_row_id = COALESCE(_campaign_row_id, campaign_row_id),
         locked_until = now() + make_interval(
           secs => GREATEST(COALESCE(_lease_seconds, 300), 30)
         ),
         updated_at = now()
   WHERE id = _saga_id
   RETURNING * INTO _updated;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'saga_not_found');
  END IF;
  RETURN jsonb_build_object('recorded', true, 'stage', _updated.stage);
END;
$$;

-- ── Encerramento com sucesso ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_ad_publish_saga(
  _saga_id uuid,
  _result jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.ad_publish_sagas
     SET status = 'completed',
         stage = 'completed',
         result = COALESCE(_result, '{}'::jsonb),
         requires_reconciliation = false,
         locked_until = NULL,
         completed_at = now(),
         updated_at = now()
   WHERE id = _saga_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('completed', false, 'reason', 'saga_not_found');
  END IF;
  RETURN jsonb_build_object('completed', true);
END;
$$;

-- ── Encerramento com falha ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fail_ad_publish_saga(
  _saga_id uuid,
  _error text,
  _requires_reconciliation boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _needs boolean;
BEGIN
  SELECT COALESCE(
           _requires_reconciliation,
           -- Sem indicação explícita: se já existe objeto na Meta, precisa de
           -- revisão humana, porque pode haver gasto fora do controle do portal.
           fb_campaign_id IS NOT NULL
         )
    INTO _needs
    FROM public.ad_publish_sagas
   WHERE id = _saga_id;

  IF _needs IS NULL THEN
    RETURN jsonb_build_object('failed', false, 'reason', 'saga_not_found');
  END IF;

  UPDATE public.ad_publish_sagas
     SET status = 'failed',
         last_error = left(COALESCE(_error, 'erro desconhecido'), 2000),
         requires_reconciliation = _needs,
         locked_until = NULL,
         updated_at = now()
   WHERE id = _saga_id;

  RETURN jsonb_build_object('failed', true, 'requires_reconciliation', _needs);
END;
$$;

COMMENT ON FUNCTION public.claim_ad_publish_saga(text, uuid, text, integer) IS
  'INTERNAL: service_role only (facebook-create-campaign). Reserva a intenção de publicar antes de chamar a Meta.';

-- ── Permissões: service_role apenas ───────────────────────────────────────
REVOKE ALL ON FUNCTION public.claim_ad_publish_saga(text, uuid, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_ad_publish_saga(text, uuid, text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ad_publish_saga(text, uuid, text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.record_ad_publish_stage(uuid, text, text, text[], text[], uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_ad_publish_stage(uuid, text, text, text[], text[], uuid, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ad_publish_stage(uuid, text, text, text[], text[], uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.complete_ad_publish_saga(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_ad_publish_saga(uuid, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_ad_publish_saga(uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.fail_ad_publish_saga(uuid, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fail_ad_publish_saga(uuid, text, boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_ad_publish_saga(uuid, text, boolean) TO service_role;
