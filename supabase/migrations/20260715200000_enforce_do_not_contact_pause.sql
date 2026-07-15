-- Hard gate: com do_not_contact=true, ninguém pode zerar bot_paused
-- (fluxo de nota, start attendance, webhooks, etc. tentavam bot_paused=false).

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
        WHEN OLD.bot_paused_reason IN ('opt_out', 'complaint') THEN OLD.bot_paused_reason
        ELSE 'opt_out'
      END;
    END IF;

    IF NEW.bot_paused_at IS NULL THEN
      NEW.bot_paused_at := COALESCE(OLD.bot_paused_at, now());
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_do_not_contact_pause ON public.customers;

CREATE TRIGGER trg_enforce_do_not_contact_pause
  BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_do_not_contact_pause();

COMMENT ON FUNCTION public.enforce_do_not_contact_pause() IS
  'Garante bot_paused=true enquanto do_not_contact=true (nunca mais contatar).';

-- Corrige leads já em opt-out com bot_paused=false (ex.: pós-nota de atendimento).
UPDATE public.customers
SET bot_paused = true,
    bot_paused_reason = COALESCE(NULLIF(bot_paused_reason, ''), 'opt_out'),
    bot_paused_at = COALESCE(bot_paused_at, now()),
    bot_force_enabled = false,
    bot_paused_until = NULL
WHERE do_not_contact = true
  AND (bot_paused IS DISTINCT FROM true OR bot_force_enabled IS TRUE);
