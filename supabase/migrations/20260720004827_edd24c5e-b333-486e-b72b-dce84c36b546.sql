
-- Clamp next_action_at para janela útil BRT (Seg-Sex 08-20, Sáb 08-14, Dom off).
-- Domingos e horários fora da janela são empurrados para o próximo slot útil às 08:05.

CREATE OR REPLACE FUNCTION public.clamp_to_business_window_brt(ts timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  d_local timestamp;
  dow int;
  h int;
  m int;
  open_h int;
  close_h int;
  attempts int := 0;
BEGIN
  IF ts IS NULL THEN
    RETURN NULL;
  END IF;
  d_local := ts AT TIME ZONE 'America/Sao_Paulo';
  LOOP
    EXIT WHEN attempts > 8;
    attempts := attempts + 1;
    dow := EXTRACT(dow FROM d_local)::int;  -- 0=Sun..6=Sat
    h := EXTRACT(hour FROM d_local)::int;
    m := EXTRACT(minute FROM d_local)::int;

    IF dow = 0 THEN
      open_h := NULL; close_h := NULL;
    ELSIF dow = 6 THEN
      open_h := 8; close_h := 14;
    ELSE
      open_h := 8; close_h := 20;
    END IF;

    IF open_h IS NOT NULL THEN
      IF h < open_h THEN
        d_local := date_trunc('day', d_local) + make_interval(hours => open_h, mins => 5);
        RETURN d_local AT TIME ZONE 'America/Sao_Paulo';
      ELSIF h < close_h THEN
        RETURN d_local AT TIME ZONE 'America/Sao_Paulo';
      END IF;
    END IF;
    -- Avança para o próximo dia às 08:05 e revalida
    d_local := date_trunc('day', d_local) + interval '1 day' + interval '8 hours 5 minutes';
  END LOOP;
  RETURN d_local AT TIME ZONE 'America/Sao_Paulo';
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_lead_cadence_clamp_window()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.next_action_at IS NOT NULL THEN
    NEW.next_action_at := public.clamp_to_business_window_brt(NEW.next_action_at);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_cadence_clamp_window ON public.lead_cadence_state;
CREATE TRIGGER trg_lead_cadence_clamp_window
BEFORE INSERT OR UPDATE OF next_action_at ON public.lead_cadence_state
FOR EACH ROW EXECUTE FUNCTION public.tg_lead_cadence_clamp_window();

-- Normalizar registros existentes fora da janela (só quem tem next_action_at).
UPDATE public.lead_cadence_state
SET next_action_at = public.clamp_to_business_window_brt(next_action_at)
WHERE next_action_at IS NOT NULL
  AND next_action_at <> public.clamp_to_business_window_brt(next_action_at);

-- Mesmo tratamento para scheduled_messages pendentes (agenda manual + cadência).
CREATE OR REPLACE FUNCTION public.tg_scheduled_messages_clamp_window()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.scheduled_at IS NOT NULL AND COALESCE(NEW.status, 'pending') = 'pending' THEN
    NEW.scheduled_at := public.clamp_to_business_window_brt(NEW.scheduled_at);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scheduled_messages_clamp_window ON public.scheduled_messages;
CREATE TRIGGER trg_scheduled_messages_clamp_window
BEFORE INSERT OR UPDATE OF scheduled_at ON public.scheduled_messages
FOR EACH ROW EXECUTE FUNCTION public.tg_scheduled_messages_clamp_window();

UPDATE public.scheduled_messages
SET scheduled_at = public.clamp_to_business_window_brt(scheduled_at)
WHERE status = 'pending'
  AND scheduled_at IS NOT NULL
  AND scheduled_at <> public.clamp_to_business_window_brt(scheduled_at);
