-- ═══════════════════════════════════════════════════════════════════════════
-- Jornada A/B/C — núcleo canônico (PLANO_CORRECAO_AUTOMACOES_SEM_DESLIGAR)
--
-- ADITIVA e idempotente. Não remove tabelas, colunas, flags nem crons.
-- Rollback lógico: Edge Functions param de usar as RPCs; estruturas ficam.
--
-- 1) automation_runs        — observabilidade por execução de motor
-- 2) outbound_effects       — autoridade de efeito externo (idempotência)
-- 3) automation_dead_letter — falhas definitivas visíveis e recuperáveis
-- 4) lead_cadence_state     — colunas de jornada canônica (journey/versão/seq)
-- 5) reserve_proactive_touch — orquestrador ATÔMICO entre motores
-- 6) voice_webhook_events   — dedup de callback Velip + CAS de transição
-- 7) voice_campaigns.logical_key — make_call idempotente
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. automation_runs ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.automation_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engine_key    text NOT NULL,
  trigger_kind  text NOT NULL DEFAULT 'cron'
    CHECK (trigger_kind IN ('cron','manual','retry','reconcile','shadow','webhook')),
  mode          text NOT NULL DEFAULT 'enforced'
    CHECK (mode IN ('shadow','canary','enforced')),
  auth_reason   text,
  worker_id     text,
  status        text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','completed','partial','failed','aborted')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  heartbeat_at  timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  scanned       integer NOT NULL DEFAULT 0,
  claimed       integer NOT NULL DEFAULT 0,
  sent          integer NOT NULL DEFAULT 0,
  skipped       integer NOT NULL DEFAULT 0,
  failed        integer NOT NULL DEFAULT 0,
  unknown       integer NOT NULL DEFAULT 0,
  dead_lettered integer NOT NULL DEFAULT 0,
  error_code    text,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_engine_started
  ON public.automation_runs (engine_key, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_status_heartbeat
  ON public.automation_runs (status, heartbeat_at)
  WHERE status = 'running';

ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='automation_runs' AND policyname='automation_runs_admin_read'
  ) THEN
    CREATE POLICY automation_runs_admin_read ON public.automation_runs
      FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(), 'admin'::public.app_role));
  END IF;
END $$;

-- ── 2. outbound_effects — autoridade de efeito externo ─────────────────────
CREATE TABLE IF NOT EXISTS public.outbound_effects (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key     text NOT NULL UNIQUE,
  engine_key          text NOT NULL,
  action_key          text,
  journey_id          uuid,
  customer_id         uuid,
  consultant_id       uuid,
  stage               text,
  stage_sequence      integer,
  channel             text NOT NULL
    CHECK (channel IN ('whatsapp','sms','voice','meta_audience','notification','email','system')),
  provider            text,
  destination_hash    text,
  payload_hash        text,
  template_key        text,
  template_version    text,
  status              text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved','sending','sent','delivered','suppressed',
                      'failed_retryable','failed_final','unknown','released')),
  provider_request_id text,
  provider_message_id text,
  provider_status     text,
  attempt_count       integer NOT NULL DEFAULT 0,
  run_id              uuid,
  claim_id            text,
  error_code          text,
  reserved_at         timestamptz NOT NULL DEFAULT now(),
  sending_at          timestamptz,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  next_reconcile_at   timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  meta                jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_outbound_effects_customer
  ON public.outbound_effects (customer_id, reserved_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_effects_engine_status
  ON public.outbound_effects (engine_key, status);
CREATE INDEX IF NOT EXISTS idx_outbound_effects_pending
  ON public.outbound_effects (reserved_at)
  WHERE status IN ('reserved','sending','unknown');

ALTER TABLE public.outbound_effects ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='outbound_effects' AND policyname='outbound_effects_admin_read'
  ) THEN
    CREATE POLICY outbound_effects_admin_read ON public.outbound_effects
      FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(), 'admin'::public.app_role));
  END IF;
END $$;

-- ── 3. automation_dead_letter ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.automation_dead_letter (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engine_key      text NOT NULL,
  logical_key     text,
  effect_id       uuid,
  customer_id     uuid,
  reason_code     text NOT NULL,
  attempts        integer NOT NULL DEFAULT 0,
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at  timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','reviewing','requeued','resolved','discarded')),
  resolved_by     uuid,
  resolved_at     timestamptz,
  resolution_note text,
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_open
  ON public.automation_dead_letter (engine_key, status)
  WHERE status IN ('open','reviewing');

ALTER TABLE public.automation_dead_letter ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='automation_dead_letter' AND policyname='automation_dead_letter_admin_read'
  ) THEN
    CREATE POLICY automation_dead_letter_admin_read ON public.automation_dead_letter
      FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(), 'admin'::public.app_role));
  END IF;
END $$;

-- ── 4. Jornada canônica em lead_cadence_state ──────────────────────────────
-- A tabela JÁ garante 1 linha por cliente (UNIQUE customer_id) — é a jornada.
ALTER TABLE public.lead_cadence_state
  ADD COLUMN IF NOT EXISTS journey_version   integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS journey_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS stage_entered_at  timestamptz,
  ADD COLUMN IF NOT EXISTS stage_sequence    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS won_at            timestamptz,
  ADD COLUMN IF NOT EXISTS last_effect_id    uuid,
  ADD COLUMN IF NOT EXISTS timezone          text NOT NULL DEFAULT 'America/Sao_Paulo';

UPDATE public.lead_cadence_state
   SET journey_started_at = COALESCE(journey_started_at, created_at),
       stage_entered_at   = COALESCE(stage_entered_at, updated_at)
 WHERE journey_started_at IS NULL OR stage_entered_at IS NULL;

-- Grupo canônico por estágio (A = entrada/atendimento; B = onda curta;
-- R = remarketing entre B e C; C = relacionamento longo; W = convertido).
CREATE OR REPLACE FUNCTION public.cadence_stage_group(p_stage text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_stage IN ('NEW','GREETED','AI_QUALIFYING','PAUSED') THEN 'A'
    WHEN p_stage IN ('COLD_1','COLD_2','COLD_3','COLD_4',
                     'CALL_1','CALL_2','CALL_3',
                     'SMS_1','SMS_2','SMS_TEMA_2','SMS_TEMA_7') THEN 'B'
    WHEN p_stage IN ('CLOSE_LOST','RETARGET_META','RETARGET_ADS_15D') THEN 'R'
    WHEN p_stage LIKE 'RECALL_%' THEN 'C'
    WHEN p_stage = 'WON' THEN 'W'
    ELSE '?'
  END;
$$;

-- stage_entered_at / stage_sequence avançam automaticamente na transição.
CREATE OR REPLACE FUNCTION public.tg_lead_cadence_stage_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.stage_entered_at := now();
    NEW.stage_sequence   := COALESCE(OLD.stage_sequence, 0) + 1;
    IF NEW.stage = 'WON' AND NEW.won_at IS NULL THEN
      NEW.won_at := now();
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_cadence_stage_transition ON public.lead_cadence_state;
CREATE TRIGGER trg_lead_cadence_stage_transition
  BEFORE UPDATE ON public.lead_cadence_state
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_lead_cadence_stage_transition();

-- WON é terminal para prospecção: nenhuma automação reabre sem journey_version novo.
CREATE OR REPLACE FUNCTION public.mark_journey_won(
  p_customer_id uuid,
  p_source text DEFAULT 'unknown'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated boolean := false;
BEGIN
  UPDATE public.lead_cadence_state
     SET stage           = 'WON',
         won_at          = COALESCE(won_at, now()),
         next_action_at  = NULL,
         paused_until    = NULL,
         paused_reason   = 'won:' || COALESCE(NULLIF(p_source, ''), 'unknown'),
         claim_token     = NULL,
         claimed_at      = NULL,
         lease_expires_at = NULL
   WHERE customer_id = p_customer_id
     AND stage IS DISTINCT FROM 'WON'::public.cadence_stage;
  v_updated := FOUND;

  -- Cancela efeitos apenas reservados (nunca sending/sent/unknown).
  UPDATE public.outbound_effects
     SET status = 'suppressed',
         error_code = 'journey_won',
         updated_at = now()
   WHERE customer_id = p_customer_id
     AND status = 'reserved';

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_journey_won(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_journey_won(uuid, text) TO service_role;

-- Inbound do cliente: pausa jornada, invalida claim em voo e suprime efeitos
-- ainda não enviados. Efeito 'sending'/'unknown' NUNCA é cancelado aqui.
CREATE OR REPLACE FUNCTION public.on_journey_inbound(
  p_customer_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Invalida claim da cadência em voo: o worker não consegue mais concluir
  -- (finish exige token) e o estado PAUSED definido pelo webhook prevalece.
  UPDATE public.lead_cadence_state
     SET claim_token = NULL,
         claimed_at = NULL,
         lease_expires_at = NULL,
         last_response_at = now()
   WHERE customer_id = p_customer_id;

  UPDATE public.outbound_effects
     SET status = 'suppressed',
         error_code = 'inbound_response',
         updated_at = now()
   WHERE customer_id = p_customer_id
     AND status = 'reserved';
END;
$$;

REVOKE ALL ON FUNCTION public.on_journey_inbound(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.on_journey_inbound(uuid) TO service_role;

-- ── 5. RPCs de runs e efeitos ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_automation_run(
  p_engine_key text,
  p_trigger_kind text DEFAULT 'cron',
  p_mode text DEFAULT 'enforced',
  p_auth_reason text DEFAULT NULL,
  p_worker_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.automation_runs (engine_key, trigger_kind, mode, auth_reason, worker_id)
  VALUES (p_engine_key, COALESCE(p_trigger_kind, 'cron'), COALESCE(p_mode, 'enforced'),
          p_auth_reason, p_worker_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_automation_run(
  p_run_id uuid,
  p_status text DEFAULT 'completed',
  p_counters jsonb DEFAULT '{}'::jsonb,
  p_error_code text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.automation_runs
     SET status       = COALESCE(p_status, 'completed'),
         finished_at  = now(),
         heartbeat_at = now(),
         scanned      = COALESCE((p_counters->>'scanned')::int, scanned),
         claimed      = COALESCE((p_counters->>'claimed')::int, claimed),
         sent         = COALESCE((p_counters->>'sent')::int, sent),
         skipped      = COALESCE((p_counters->>'skipped')::int, skipped),
         failed       = COALESCE((p_counters->>'failed')::int, failed),
         unknown      = COALESCE((p_counters->>'unknown')::int, unknown),
         dead_lettered = COALESCE((p_counters->>'dead_lettered')::int, dead_lettered),
         error_code   = COALESCE(p_error_code, error_code)
   WHERE id = p_run_id;
END;
$$;

-- Reserva atômica de efeito externo. Fail-closed no caller: erro => NÃO enviar.
-- acquired=true  → este worker é dono; pode chamar o provedor.
-- acquired=false → efeito já existe; devolve status atual para decisão.
CREATE OR REPLACE FUNCTION public.reserve_outbound_effect(
  p_idempotency_key text,
  p_engine_key text,
  p_channel text,
  p_customer_id uuid DEFAULT NULL,
  p_consultant_id uuid DEFAULT NULL,
  p_journey_id uuid DEFAULT NULL,
  p_stage text DEFAULT NULL,
  p_stage_sequence integer DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_template_key text DEFAULT NULL,
  p_template_version text DEFAULT NULL,
  p_payload_hash text DEFAULT NULL,
  p_destination_hash text DEFAULT NULL,
  p_run_id uuid DEFAULT NULL,
  p_claim_id text DEFAULT NULL,
  p_action_key text DEFAULT NULL
)
RETURNS TABLE (effect_id uuid, acquired boolean, current_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency_key required';
  END IF;

  INSERT INTO public.outbound_effects (
    idempotency_key, engine_key, action_key, channel, customer_id, consultant_id,
    journey_id, stage, stage_sequence, provider, template_key, template_version,
    payload_hash, destination_hash, run_id, claim_id, status, attempt_count
  ) VALUES (
    trim(p_idempotency_key), p_engine_key, p_action_key, p_channel, p_customer_id,
    p_consultant_id, p_journey_id, p_stage, p_stage_sequence, p_provider,
    p_template_key, p_template_version, p_payload_hash, p_destination_hash,
    p_run_id, p_claim_id, 'reserved', 1
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, true, 'reserved'::text;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT e.id, false, e.status
      FROM public.outbound_effects e
     WHERE e.idempotency_key = trim(p_idempotency_key);
END;
$$;

-- Transição CAS do efeito: só aplica a partir dos status esperados.
CREATE OR REPLACE FUNCTION public.finish_outbound_effect(
  p_effect_id uuid,
  p_to_status text,
  p_from_status text[] DEFAULT ARRAY['reserved','sending'],
  p_provider_request_id text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL,
  p_provider_status text DEFAULT NULL,
  p_error_code text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.outbound_effects
     SET status              = p_to_status,
         provider_request_id = COALESCE(p_provider_request_id, provider_request_id),
         provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
         provider_status     = COALESCE(p_provider_status, provider_status),
         error_code          = COALESCE(p_error_code, error_code),
         sending_at          = CASE WHEN p_to_status = 'sending' THEN now() ELSE sending_at END,
         sent_at             = CASE WHEN p_to_status IN ('sent','delivered') AND sent_at IS NULL THEN now() ELSE sent_at END,
         delivered_at        = CASE WHEN p_to_status = 'delivered' THEN now() ELSE delivered_at END,
         updated_at          = now()
   WHERE id = p_effect_id
     AND status = ANY (p_from_status);
  RETURN FOUND;
END;
$$;

-- Reconciliador: reserved velho sem envio → released (pode re-tentar com a
-- MESMA chave? Não: released mantém a linha; retry usa attempt_count).
-- sending velho → unknown (nunca repetir cegamente).
CREATE OR REPLACE FUNCTION public.reconcile_stale_outbound_effects(
  p_reserved_minutes integer DEFAULT 30,
  p_sending_minutes integer DEFAULT 30
)
RETURNS TABLE (released_count integer, unknown_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_released integer := 0;
  v_unknown integer := 0;
BEGIN
  UPDATE public.outbound_effects
     SET status = 'released', error_code = COALESCE(error_code, 'stale_reserved'), updated_at = now()
   WHERE status = 'reserved'
     AND reserved_at < now() - make_interval(mins => GREATEST(p_reserved_minutes, 5));
  GET DIAGNOSTICS v_released = ROW_COUNT;

  UPDATE public.outbound_effects
     SET status = 'unknown', error_code = COALESCE(error_code, 'stale_sending'),
         next_reconcile_at = now() + interval '30 minutes', updated_at = now()
   WHERE status = 'sending'
     AND sending_at < now() - make_interval(mins => GREATEST(p_sending_minutes, 5));
  GET DIAGNOSTICS v_unknown = ROW_COUNT;

  RETURN QUERY SELECT v_released, v_unknown;
END;
$$;

REVOKE ALL ON FUNCTION public.start_automation_run(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_automation_run(uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_outbound_effect(text, text, text, uuid, uuid, uuid, text, integer, text, text, text, text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_outbound_effect(uuid, text, text[], text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_stale_outbound_effects(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_automation_run(text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_automation_run(uuid, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_outbound_effect(text, text, text, uuid, uuid, uuid, text, integer, text, text, text, text, text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_outbound_effect(uuid, text, text[], text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_stale_outbound_effects(integer, integer) TO service_role;

-- ── 6. Orquestrador atômico ────────────────────────────────────────────────
-- Estende proactive_touch_log (aditivo): linhas legadas = status 'done'.
ALTER TABLE public.proactive_touch_log
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'done'
    CHECK (status IN ('reserved','done','released')),
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_proactive_touch_reserved
  ON public.proactive_touch_log (customer_id, status, lease_expires_at)
  WHERE status = 'reserved';

-- Reserva atômica: bloqueia a decisão por cliente (advisory xact lock),
-- avalia cooldown + prioridade + reservas ativas NA MESMA transação e
-- insere a reserva antes de permitir. Erro SQL => caller trata como bloqueio.
CREATE OR REPLACE FUNCTION public.reserve_proactive_touch(
  p_customer_id uuid,
  p_source_key text,
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  allowed boolean,
  reservation_id bigint,
  claim_token uuid,
  blocked_by text,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean := false;
  v_cooldown_hours numeric := 6;
  v_priority text[] := ARRAY[
    'process_followups','bot_stuck_recovery','faq_reengagement_nudge',
    'bot_followup_checker','cadence_engine','reactivation_cron',
    'portal_abandon_sequence'
  ];
  v_my_pri integer;
  v_other record;
  v_other_pri integer;
  v_res_id bigint;
  v_token uuid := gen_random_uuid();
BEGIN
  IF p_customer_id IS NULL OR COALESCE(trim(p_source_key), '') = '' THEN
    RETURN QUERY SELECT false, NULL::bigint, NULL::uuid, NULL::text, 'invalid_args'::text;
    RETURN;
  END IF;

  -- Serializa a decisão por cliente.
  PERFORM pg_advisory_xact_lock(hashtext('proactive_touch:' || p_customer_id::text));

  SELECT COALESCE(t.enabled, false) INTO v_enabled
    FROM public.automation_toggles t WHERE t.key = 'retention_orchestrator';

  -- priority_order é jsonb (array de strings) em retention_settings.
  SELECT COALESCE(rs.orchestrator_cooldown_hours, 6),
         COALESCE(
           (SELECT array_agg(x.v ORDER BY x.ord)
              FROM jsonb_array_elements_text(rs.priority_order) WITH ORDINALITY AS x(v, ord)
             WHERE jsonb_typeof(rs.priority_order) = 'array'),
           v_priority
         )
    INTO v_cooldown_hours, v_priority
    FROM public.retention_settings rs WHERE rs.id = 'global';

  -- Expira reservas velhas deste cliente (lease vencido → released).
  UPDATE public.proactive_touch_log
     SET status = 'released'
   WHERE customer_id = p_customer_id
     AND status = 'reserved'
     AND lease_expires_at IS NOT NULL
     AND lease_expires_at < now();

  IF v_enabled THEN
    v_my_pri := COALESCE(array_position(v_priority, p_source_key), 999);

    FOR v_other IN
      SELECT source_key, status
        FROM public.proactive_touch_log
       WHERE customer_id = p_customer_id
         AND (
           (status = 'reserved')
           OR (status = 'done' AND created_at > now() - make_interval(hours => v_cooldown_hours::int))
         )
       ORDER BY created_at DESC
       LIMIT 8
    LOOP
      -- Mesmo source segue: a própria máquina (com claim por linha) controla
      -- o ritmo dos seus estágios; bloquear a si mesma travaria a jornada.
      CONTINUE WHEN v_other.source_key = p_source_key;
      v_other_pri := COALESCE(array_position(v_priority, v_other.source_key), 999);
      IF v_other_pri <= v_my_pri THEN
        RETURN QUERY SELECT false, NULL::bigint, NULL::uuid,
          v_other.source_key,
          CASE WHEN v_other.status = 'reserved'
               THEN 'blocked_by_active_reservation'
               ELSE 'blocked_by_recent_touch' END;
        RETURN;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.proactive_touch_log (customer_id, source_key, meta, status, claim_token, lease_expires_at)
  VALUES (p_customer_id, p_source_key,
          COALESCE(p_meta, '{}'::jsonb) || jsonb_build_object('orchestrator_enabled', v_enabled),
          'reserved', v_token, now() + interval '15 minutes')
  RETURNING id INTO v_res_id;

  RETURN QUERY SELECT true, v_res_id, v_token, NULL::text,
    CASE WHEN v_enabled THEN 'reserved' ELSE 'reserved_orchestrator_off' END;
END;
$$;

-- Finaliza a reserva: 'done' (efeito saiu) ou 'released' (nada enviado).
CREATE OR REPLACE FUNCTION public.finish_proactive_touch(
  p_reservation_id bigint,
  p_claim_token uuid,
  p_outcome text DEFAULT 'done'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.proactive_touch_log
     SET status = CASE WHEN p_outcome = 'done' THEN 'done' ELSE 'released' END,
         lease_expires_at = NULL
   WHERE id = p_reservation_id
     AND claim_token = p_claim_token
     AND status = 'reserved';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_proactive_touch(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_proactive_touch(bigint, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_proactive_touch(uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_proactive_touch(bigint, uuid, text) TO service_role;

-- ── 7. Voz: dedup de callback + fallback SMS único + make_call idempotente ─
CREATE TABLE IF NOT EXISTS public.voice_webhook_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    text NOT NULL DEFAULT 'velip',
  event_hash  text NOT NULL UNIQUE,
  event_kind  text,
  target_id   uuid,
  campaign_id uuid,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voice_webhook_events_target
  ON public.voice_webhook_events (target_id, created_at DESC);

ALTER TABLE public.voice_webhook_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.voice_campaign_targets
  ADD COLUMN IF NOT EXISTS fallback_sms_at timestamptz,
  ADD COLUMN IF NOT EXISTS fallback_sms_effect_id uuid;

ALTER TABLE public.voice_campaigns
  ADD COLUMN IF NOT EXISTS logical_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_campaigns_logical_key
  ON public.voice_campaigns (logical_key)
  WHERE logical_key IS NOT NULL;

-- make_call idempotente: campanha + target na MESMA transação; conflito
-- na logical_key devolve a campanha existente (existed=true).
CREATE OR REPLACE FUNCTION public.enqueue_single_voice_campaign(
  p_logical_key text,
  p_consultant_id uuid,
  p_customer_id uuid,
  p_phone text,
  p_name text,
  p_campaign_name text,
  p_audio_clip_id uuid,
  p_audio_url text,
  p_config jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (campaign_id uuid, existed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF COALESCE(trim(p_logical_key), '') = '' THEN
    RAISE EXCEPTION 'logical_key required';
  END IF;

  INSERT INTO public.voice_campaigns (
    consultant_id, name, status, dispatch_kind, audio_clip_id, audio_url,
    velip_mode, config, total, dialed, answered, failed, started_at, logical_key
  ) VALUES (
    p_consultant_id, p_campaign_name, 'running', 'audio', p_audio_clip_id, p_audio_url,
    'single', COALESCE(p_config, '{}'::jsonb), 1, 0, 0, 0, now(), trim(p_logical_key)
  )
  ON CONFLICT (logical_key) WHERE logical_key IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN QUERY
      SELECT c.id, true FROM public.voice_campaigns c
       WHERE c.logical_key = trim(p_logical_key);
    RETURN;
  END IF;

  INSERT INTO public.voice_campaign_targets (campaign_id, customer_id, phone, name, status)
  VALUES (v_id, p_customer_id, p_phone, p_name, 'queued');

  RETURN QUERY SELECT v_id, false;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_single_voice_campaign(text, uuid, uuid, text, text, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_single_voice_campaign(text, uuid, uuid, text, text, text, uuid, text, jsonb) TO service_role;

-- ── Aceite (consultas de verificação pós-migration) ─────────────────────────
-- select count(*) from public.outbound_effects;                       -- 0 ok
-- select public.cadence_stage_group('COLD_1');                        -- 'B'
-- select has_function_privilege('anon','public.reserve_outbound_effect(text,text,text,uuid,uuid,uuid,text,integer,text,text,text,text,text,uuid,text,text)','EXECUTE'); -- false
