-- Amplia enforce_do_not_contact_pause: também impede reentrada no passo de nota 1–5
-- (o intercept de avaliação no webhook roda ANTES do check de bot_paused).

CREATE OR REPLACE FUNCTION public.enforce_do_not_contact_pause()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.do_not_contact, false) = true THEN
    NEW.bot_paused := true;
    NEW.bot_force_enabled := false;
    NEW.bot_paused_until := NULL;

    IF NEW.bot_paused_reason IS NULL
       OR NEW.bot_paused_reason NOT IN ('opt_out', 'complaint') THEN
      NEW.bot_paused_reason := CASE
        WHEN TG_OP = 'UPDATE' AND OLD.bot_paused_reason IN ('opt_out', 'complaint') THEN OLD.bot_paused_reason
        ELSE 'opt_out'
      END;
    END IF;

    IF NEW.bot_paused_at IS NULL THEN
      NEW.bot_paused_at := CASE
        WHEN TG_OP = 'UPDATE' THEN COALESCE(OLD.bot_paused_at, now())
        ELSE now()
      END;
    END IF;

    IF NEW.conversation_step IS NOT NULL AND (
         NEW.conversation_step = 'aguardando_avaliacao_atendimento'
         OR NEW.conversation_step ILIKE '%aguardando_avaliacao%'
       ) THEN
      NEW.conversation_step := 'atendimento_finalizado';
      NEW.attendance_rating_requested_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
