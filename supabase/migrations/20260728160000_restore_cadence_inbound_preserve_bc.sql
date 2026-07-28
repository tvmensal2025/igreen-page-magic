-- Restaura preserve B/C no inbound (P0).
--
-- 20260724160000_cadence_inbound_preserve_bc corrigiu o trigger para NÃO
-- apagar COLD_/SMS_/CALL_/RECALL_ antes do cadence-inbound-router TS.
-- 20260725230000_cliente_nunca_entra_cadencia_abc reescreveu a função com
-- o guard de cliente/carteira, mas voltou a forçar stage=AI_QUALIFYING —
-- apagando o fix. Evidência prod (2026-07-28): lead respondeu COLD_1 com
-- "Média de 600,00" e o log gravou prev_stage=AI_QUALIFYING / from_bc=false
-- → router pulou → não entrou no Grupo A.
--
-- Esta migration une os dois: guard de cliente + preserve B/C + fail-open.

CREATE OR REPLACE FUNCTION public.cadence_on_inbound_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
BEGIN
  IF NEW.message_direction = 'inbound' AND NEW.customer_id IS NOT NULL THEN
    BEGIN
      SELECT customer_origin, status, is_converted, pos_venda_stage,
             andamento_igreen, pos_venda_recadastro_at
        INTO c
        FROM public.customers
       WHERE id = NEW.customer_id;

      -- Cliente/carteira: não reabre jornada A/B/C.
      IF FOUND THEN
        IF c.customer_origin IN ('igreen_sync', 'igreen_extension') THEN
          RETURN NEW;
        END IF;
        IF COALESCE(c.is_converted, false)
           OR c.status IN ('approved','active','registered_igreen','cadastro_concluido','complete')
           OR (c.pos_venda_stage IS NOT NULL AND c.pos_venda_recadastro_at IS NULL)
           OR lower(trim(COALESCE(c.andamento_igreen,''))) IN (
                'ativo','aprovado','validado','licenciada','licenciado'
              ) THEN
          RETURN NEW;
        END IF;
      END IF;

      UPDATE public.lead_cadence_state
         SET stage = CASE
               -- Router TS precisa ver o estágio B/C (ou PAUSED já marcado B/C).
               WHEN stage::text ~ '^(COLD_|CALL_|SMS_|RECALL_|RETARGET_)'
                 OR stage::text = 'CLOSE_LOST'
                 OR (
                   stage::text = 'PAUSED'
                   AND (
                     COALESCE(paused_reason, '') ~ '^lead_responded:(COLD_|CALL_|SMS_|RECALL_|RETARGET_)'
                     OR paused_reason = 'lead_responded:CLOSE_LOST'
                   )
                 )
               THEN stage
               ELSE 'AI_QUALIFYING'
             END,
             last_response_at = now(),
             next_action_at = now() + interval '24 hours',
             paused_reason = CASE
               WHEN stage::text ~ '^(COLD_|CALL_|SMS_|RECALL_|RETARGET_)'
                 OR stage::text = 'CLOSE_LOST'
                 OR (
                   stage::text = 'PAUSED'
                   AND (
                     COALESCE(paused_reason, '') ~ '^lead_responded:(COLD_|CALL_|SMS_|RECALL_|RETARGET_)'
                     OR paused_reason = 'lead_responded:CLOSE_LOST'
                   )
                 )
               THEN paused_reason
               ELSE NULL
             END,
             paused_until = CASE
               WHEN stage::text ~ '^(COLD_|CALL_|SMS_|RECALL_|RETARGET_)'
                 OR stage::text = 'CLOSE_LOST'
                 OR (
                   stage::text = 'PAUSED'
                   AND (
                     COALESCE(paused_reason, '') ~ '^lead_responded:(COLD_|CALL_|SMS_|RECALL_|RETARGET_)'
                     OR paused_reason = 'lead_responded:CLOSE_LOST'
                   )
                 )
               THEN paused_until
               ELSE NULL
             END
       WHERE customer_id = NEW.customer_id
         AND stage IS DISTINCT FROM 'WON'::public.cadence_stage;

      -- Cliente respondeu: cancela auto-fechamento de atendimento humano.
      UPDATE public.customers
         SET attendance_auto_close_at = NULL,
             attendance_auto_close_source = NULL
       WHERE id = NEW.customer_id
         AND attendance_auto_close_at IS NOT NULL;

    EXCEPTION WHEN OTHERS THEN
      -- Fail-open: gravar a conversa > estado da cadência.
      RAISE WARNING '[cadence_on_inbound_message] ignorado para customer %: % (SQLSTATE %)',
        NEW.customer_id, SQLERRM, SQLSTATE;
    END;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.cadence_on_inbound_message() IS
  'Inbound: preserva estágio B/C para o cadence-inbound-router; não reabre cliente/WON; fail-open no INSERT.';
