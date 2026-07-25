-- P0-1: inbound não pode apagar o estágio B/C antes do router TypeScript.
-- Mantém o trigger existente e substitui somente sua função, de forma aditiva.
--
-- A contabilidade de cadência roda dentro de BEGIN/EXCEPTION porque o trigger é
-- AFTER INSERT em conversations: qualquer erro aqui (lock timeout, deadlock com
-- o cadence-tick, coluna alterada por migration futura) abortaria o INSERT e a
-- mensagem do lead seria perdida. Falhar aberto preserva a mensagem e registra
-- WARNING; o estado da cadência é reconciliado no próximo tick.
CREATE OR REPLACE FUNCTION public.cadence_on_inbound_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.message_direction = 'inbound' AND NEW.customer_id IS NOT NULL THEN
    BEGIN
      UPDATE public.lead_cadence_state
         SET stage = CASE
               -- O router precisa enxergar o estágio B/C ou a ponte Meta original.
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
             -- Conserva o adiamento anti-race até o hook TS pausar/rotear o estado.
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
       WHERE customer_id = NEW.customer_id;

      -- Cliente respondeu: atendimento humano não pode ser encerrado pelo timer.
      UPDATE public.customers
         SET attendance_auto_close_at = NULL,
             attendance_auto_close_source = NULL
       WHERE id = NEW.customer_id
         AND attendance_auto_close_at IS NOT NULL;

    EXCEPTION WHEN OTHERS THEN
      -- Fail-open deliberado: gravar a conversa é mais importante que o estado
      -- da cadência. O tick seguinte reprocessa o lead pelo next_action_at.
      RAISE WARNING '[cadence_on_inbound_message] ignorado para customer %: % (SQLSTATE %)',
        NEW.customer_id, SQLERRM, SQLSTATE;
    END;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.cadence_on_inbound_message() IS
  'Atualiza resposta inbound sem apagar estágios B/C/Meta antes do cadence-inbound-router. Falha aberta: nunca rejeita o INSERT da mensagem.';
