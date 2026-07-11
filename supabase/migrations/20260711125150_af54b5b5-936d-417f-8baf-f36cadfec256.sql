
-- Auto-fechamento de atendimento após X min sem resposta
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS attendance_auto_close_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attendance_auto_close_source TEXT;

CREATE INDEX IF NOT EXISTS customers_attendance_auto_close_idx
  ON public.customers (attendance_auto_close_at)
  WHERE attendance_auto_close_at IS NOT NULL;

-- Extende trigger de inbound para cancelar o auto-close se o cliente responder.
CREATE OR REPLACE FUNCTION public.cadence_on_inbound_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.message_direction = 'inbound' AND NEW.customer_id IS NOT NULL THEN
    UPDATE public.lead_cadence_state
      SET stage = 'AI_QUALIFYING',
          last_response_at = now(),
          next_action_at = now() + interval '24 hours',
          paused_reason = NULL,
          paused_until = NULL
      WHERE customer_id = NEW.customer_id;

    -- Cancela auto-fechamento: cliente respondeu, não pode encerrar sozinho.
    UPDATE public.customers
       SET attendance_auto_close_at = NULL,
           attendance_auto_close_source = NULL
     WHERE id = NEW.customer_id
       AND attendance_auto_close_at IS NOT NULL;
  END IF;
  RETURN NEW;
END; $$;

-- Toggle universal do auto-fechamento (default OFF).
INSERT INTO public.automation_toggles (key, label, description, category, enabled) VALUES
  ('end_customer_attendance_auto', 'Fechar atendimento automático',
   'Fecha atendimento (envia pesquisa 1-5) para leads marcados sem resposta após X minutos.',
   'manual', false)
ON CONFLICT (key) DO NOTHING;
