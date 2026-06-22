
-- ============================================================
-- Pacote 1: Visibilidade de reset silencioso (corrige trigger)
-- ------------------------------------------------------------
-- POR QUÊ:
-- O trigger anterior só logava quando OLD era step nominal (aguardando_/ask_/
-- confirmando_/capture_/editing_) E NEW era UUID de fluxo. Na prática, o reset
-- silencioso real é regressão DENTRO do funil (ex: confirmando_dados_doc →
-- aguardando_conta, ou UUID-de-fluxo-avançado → aguardando_conta). Resultado:
-- silent_step_reset_log ficou vazio mesmo com clientes voltando ao começo,
-- e estávamos "consertando no escuro".
--
-- O QUE MUDA:
-- 1. Cria public.funnel_step_rank(text) → atribui posição ordinal a cada step
--    conhecido do funil de cadastro. UUID/flow:UUID = 200 (deep flow).
--    Steps fora do funil (corrigir_*, editing_*, portal_done) = NULL = ignora.
-- 2. Reescreve log_silent_step_reset para logar QUALQUER transição em que
--    new_rank < old_rank (regressão de funil), exceto quando há
--    bot_step_transitions recente (=mudança legítima do engine).
--
-- SEGURANÇA:
-- - Trigger continua com EXCEPTION WHEN OTHERS → RETURN NEW (nunca bloqueia).
-- - Só LE bot_step_transitions e INSERE em silent_step_reset_log.
-- - Não altera dado do customer.
-- ============================================================

CREATE OR REPLACE FUNCTION public.funnel_step_rank(step text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE step
    WHEN 'welcome'                  THEN 10
    WHEN 'ask_quero_cadastrar'      THEN 20
    WHEN 'aguardando_conta'         THEN 30
    WHEN 'processando_ocr_conta'    THEN 35
    WHEN 'confirmando_dados_conta'  THEN 40
    WHEN 'ask_tipo_documento'       THEN 45
    WHEN 'aguardando_doc_auto'      THEN 50
    WHEN 'processando_ocr_doc'      THEN 55
    WHEN 'confirmando_dados_doc'    THEN 60
    WHEN 'aguardando_doc_verso'     THEN 70
    WHEN 'confirmar_titularidade'   THEN 75
    WHEN 'ask_finalizar'            THEN 90
    WHEN 'aguardando_finalizar'     THEN 95
    WHEN 'portal_submitting'        THEN 100
    ELSE
      CASE
        -- UUID puro ou flow:UUID = passo profundo do motor de fluxos
        WHEN step ~ '^(flow:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 200
        ELSE NULL
      END
  END
$$;

CREATE OR REPLACE FUNCTION public.log_silent_step_reset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  recent_trans int;
  old_rank int;
  new_rank int;
BEGIN
  IF OLD.conversation_step IS NULL OR NEW.conversation_step IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.conversation_step = NEW.conversation_step THEN
    RETURN NEW;
  END IF;

  old_rank := public.funnel_step_rank(OLD.conversation_step);
  new_rank := public.funnel_step_rank(NEW.conversation_step);

  -- Só nos interessa regressão dentro do funil conhecido.
  IF old_rank IS NULL OR new_rank IS NULL OR new_rank >= old_rank THEN
    RETURN NEW;
  END IF;

  -- Se há transição legítima registrada nos últimos 10s, é mudança intencional
  -- do motor (engine) — não é reset silencioso.
  SELECT count(*) INTO recent_trans
  FROM public.bot_step_transitions
  WHERE customer_id = NEW.id
    AND created_at > now() - interval '10 seconds'
    AND (from_step = OLD.conversation_step OR to_step = NEW.conversation_step);

  IF recent_trans > 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.silent_step_reset_log (customer_id, from_step, to_step, txid, app_name)
  VALUES (
    NEW.id,
    OLD.conversation_step,
    NEW.conversation_step,
    txid_current(),
    current_setting('application_name', true)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;
