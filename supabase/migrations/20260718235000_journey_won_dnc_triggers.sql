-- ============================================================================
-- Onda 6 — Conversão encerra prospecção; DNC bloqueia todos os canais.
-- Aditiva e idempotente. Cobre TODOS os caminhos (UI, edge functions, SQL):
--   1. customers.is_converted=true  → mark_journey_won (WON terminal)
--   2. customers.status='approved'  → mark_journey_won
--   3. customers.do_not_contact=true → pausa jornada + suprime efeitos reservados
-- Nada é apagado; efeitos sending/sent/unknown NUNCA são cancelados aqui.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_customer_journey_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Conversão (manual na UI ou automática) → WON terminal na jornada.
  IF NEW.is_converted = true AND COALESCE(OLD.is_converted, false) = false THEN
    PERFORM public.mark_journey_won(NEW.id, 'is_converted');
  ELSIF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    PERFORM public.mark_journey_won(NEW.id, 'status_approved');
  END IF;

  -- DNC / pedido para parar → pausa terminal da cadência + suprime efeitos
  -- ainda apenas reservados. Nunca reaberto automaticamente.
  IF NEW.do_not_contact = true AND COALESCE(OLD.do_not_contact, false) = false THEN
    UPDATE public.lead_cadence_state
       SET stage            = 'PAUSED'::public.cadence_stage,
           paused_reason    = 'dnc',
           paused_until     = NULL,
           next_action_at   = NULL,   -- tick nunca seleciona next_action_at NULL
           claim_token      = NULL,
           claimed_at       = NULL,
           lease_expires_at = NULL
     WHERE customer_id = NEW.id
       AND stage IS DISTINCT FROM 'WON'::public.cadence_stage;

    UPDATE public.outbound_effects
       SET status = 'suppressed',
           error_code = 'dnc',
           updated_at = now()
     WHERE customer_id = NEW.id
       AND status = 'reserved';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_journey_sync ON public.customers;
CREATE TRIGGER trg_customer_journey_sync
AFTER UPDATE OF is_converted, status, do_not_contact ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.tg_customer_journey_sync();

COMMENT ON FUNCTION public.tg_customer_journey_sync() IS
  'Jornada A/B/C: conversão → WON; DNC → pausa terminal + supressão de efeitos reservados.';
