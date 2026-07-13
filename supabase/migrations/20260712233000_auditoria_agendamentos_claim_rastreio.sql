-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORIA DE AGENDAMENTOS — correções de concorrência, rastreabilidade e timezone
--
-- 100% ADITIVA: só adiciona colunas anuláveis, índices, funções novas e seeds
-- de toggles (que nascem DESLIGADOS). Nenhuma tabela/coluna/função é removida.
--
-- Blocos:
--  1. scheduled_messages: colunas de autoria/tentativas/cancelamento + índice
--  2. claim_scheduled_messages(): claim atômico (FOR UPDATE SKIP LOCKED)
--     → dois workers nunca pegam a mesma mensagem
--  3. reconcile_stuck_scheduled_messages(): destrava 'processing' órfão
--  4. bulk_campaign_targets: claimed_at/claim_attempts + reconciliador
--  5. conversations: origin/sent_by para separar manual × automático no histórico
--  6. automation_skip_log: tabela própria para logs de "toggle desligado"
--     (o logSkipped antigo escrevia em cadence_action_log com colunas erradas
--     e falhava silenciosamente em 100% dos casos)
--  7. Toggles novos (nascem OFF): bot_followup_checker, faq_reengagement_nudge
--  8. check_send_quota/register_send: dia contábil em America/Sao_Paulo
--     (antes UTC → contador anti-ban resetava às 21h de Brasília)
--
-- REVERSÃO (se necessário): as colunas novas podem ser ignoradas (nullable),
-- as funções novas podem deixar de ser chamadas, e as funções substituídas
-- (check_send_quota/register_send) podem ser restauradas reaplicando
-- 20260704221114 e 20260603233147. Nada aqui apaga dados.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. scheduled_messages: rastreabilidade e suporte a claim ────────────────
ALTER TABLE public.scheduled_messages
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS canceled_by uuid;

COMMENT ON COLUMN public.scheduled_messages.created_by IS
  'Usuário que criou o agendamento (auth.uid() no momento do insert). Execução futura é automática, mas a criação é manual.';
COMMENT ON COLUMN public.scheduled_messages.processing_started_at IS
  'Quando um worker reivindicou esta mensagem (status=processing). Usado pelo reconciliador de registros presos.';
COMMENT ON COLUMN public.scheduled_messages.attempt_count IS
  'Tentativas de envio já consumidas. Máx 3 → status failed.';
COMMENT ON COLUMN public.scheduled_messages.canceled_at IS
  'Cancelamento preserva a linha (auditoria) em vez de DELETE.';

-- Cron busca por (status, scheduled_at) a cada minuto — índice parcial barato.
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_pending_due
  ON public.scheduled_messages (scheduled_at)
  WHERE status = 'pending';

-- ── 2. Claim atômico ────────────────────────────────────────────────────────
-- O worker chama esta RPC em vez de SELECT+UPDATE separados. FOR UPDATE SKIP
-- LOCKED garante que dois ticks/instâncias concorrentes nunca reivindicam a
-- mesma linha (dupla execução era possível no fluxo antigo).
CREATE OR REPLACE FUNCTION public.claim_scheduled_messages(p_limit integer DEFAULT 50)
RETURNS SETOF public.scheduled_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.scheduled_messages sm
     SET status = 'processing',
         processing_started_at = now()
   WHERE sm.id IN (
     SELECT s.id
       FROM public.scheduled_messages s
      WHERE s.status = 'pending'
        AND s.scheduled_at <= now()
      ORDER BY s.scheduled_at ASC
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
        FOR UPDATE SKIP LOCKED
   )
  RETURNING sm.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_scheduled_messages(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_scheduled_messages(integer) TO service_role;

-- ── 3. Reconciliador de mensagens presas em processing ─────────────────────
-- Se o worker morrer depois do claim e antes do update final, a linha ficaria
-- presa para sempre. Aqui: >15 min em processing → volta a pending (consome
-- tentativa) ou vira failed na 3ª tentativa.
CREATE OR REPLACE FUNCTION public.reconcile_stuck_scheduled_messages()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH stuck AS (
    UPDATE public.scheduled_messages
       SET status = CASE WHEN attempt_count + 1 >= 3 THEN 'failed' ELSE 'pending' END,
           attempt_count = attempt_count + 1,
           last_error = COALESCE(last_error, 'stuck_in_processing_recovered'),
           processing_started_at = NULL
     WHERE status = 'processing'
       AND processing_started_at IS NOT NULL
       AND processing_started_at < now() - interval '15 minutes'
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM stuck;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_stuck_scheduled_messages() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_stuck_scheduled_messages() TO service_role;

-- ── 4. bulk_campaign_targets: claim + reconciliador ─────────────────────────
ALTER TABLE public.bulk_campaign_targets
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_attempts integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.bulk_campaign_targets.claimed_at IS
  'Quando um worker marcou este alvo como sending. Alvo preso >20min é destravado pelo reconciliador.';

CREATE OR REPLACE FUNCTION public.reconcile_stuck_bulk_targets()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH stuck AS (
    UPDATE public.bulk_campaign_targets
       SET status = CASE WHEN claim_attempts + 1 >= 3 THEN 'failed' ELSE 'queued' END,
           claim_attempts = claim_attempts + 1,
           error = CASE WHEN claim_attempts + 1 >= 3 THEN 'stuck_in_sending_recovered' ELSE error END,
           claimed_at = NULL
     WHERE status = 'sending'
       AND claimed_at IS NOT NULL
       AND claimed_at < now() - interval '20 minutes'
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM stuck;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_stuck_bulk_targets() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_stuck_bulk_targets() TO service_role;

-- ── 5. conversations: separar manual × automático no histórico ─────────────
-- Colunas anuláveis (custo zero em tabela quente). Preenchidas daqui em diante:
--   origin: 'manual' | 'scheduled' | 'automation:<nome-do-cron>' | 'bot'
--   sent_by: auth.uid() de quem clicou (apenas envios manuais)
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS origin text,
  ADD COLUMN IF NOT EXISTS sent_by uuid;

COMMENT ON COLUMN public.conversations.origin IS
  'Origem do envio: manual (clique humano), scheduled (agendado), automation:<cron>, bot (resposta do fluxo). NULL = registro anterior à auditoria.';

-- ── 6. automation_skip_log: log correto de "pulei porque toggle está OFF" ──
CREATE TABLE IF NOT EXISTS public.automation_skip_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_skip_log_key
  ON public.automation_skip_log (key, created_at DESC);

GRANT SELECT ON public.automation_skip_log TO authenticated;
GRANT ALL ON public.automation_skip_log TO service_role;

ALTER TABLE public.automation_skip_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "admin read automation_skip_log"
    ON public.automation_skip_log FOR SELECT TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 7. Toggles novos (nascem OFF, como todos os demais da Central) ──────────
-- bot_followup_checker: antes pegava carona na chave process_followups —
--   impossível desligar um sem o outro.
-- faq_reengagement_nudge: cron enviava mensagem SEM NENHUM kill switch
--   (nem global nem granular). Agora tem toggle próprio.
INSERT INTO public.automation_toggles (key, label, description, category, enabled) VALUES
  ('bot_followup_checker', 'Follow-up 6h (bot sumido)', 'Cron que reengaja lead que sumiu há 6-48h. Antes compartilhava a chave process_followups.', 'ia', false),
  ('faq_reengagement_nudge', 'Nudge pós-FAQ (20min)', 'Cron que cutuca lead que ficou em silêncio 20min após tirar dúvida no FAQ. Antes rodava sem kill switch.', 'ia', false)
ON CONFLICT (key) DO NOTHING;

-- ── 8. Contador anti-ban: dia contábil em horário de Brasília ───────────────
-- Antes: (now() AT TIME ZONE 'UTC')::date → o "dia" virava às 21h BRT e o
-- limite diário de warmup resetava cedo demais (furo de até 3h no anti-ban).
-- Corpo idêntico à versão vigente (20260704221114), mudando apenas v_today.
CREATE OR REPLACE FUNCTION public.check_send_quota(p_instance text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst RECORD;
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
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

-- Mesma correção no registrador (era UTC, vira América/São Paulo).
CREATE OR REPLACE FUNCTION public.register_send(p_instance TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
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
