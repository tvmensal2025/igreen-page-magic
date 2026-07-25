-- ============================================================================
-- Trava: CLIENTE não recebe cadência A/B/C (só pós-venda + agendamento).
-- Expande tg_customer_journey_sync + backfill de jornadas ativas indevidas.
-- Idempotente. Não apaga nada.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_customer_journey_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text := NULL;
  v_andamento text;
  v_old_andamento text;
BEGIN
  -- Recadastro pós-venda (UPDATE): voltou a lead — não forçar WON neste UPDATE.
  IF TG_OP = 'UPDATE'
     AND NEW.pos_venda_recadastro_at IS NOT NULL
     AND (OLD.pos_venda_recadastro_at IS DISTINCT FROM NEW.pos_venda_recadastro_at)
     AND NEW.pos_venda_stage IS NULL
     AND COALESCE(NEW.customer_origin, '') IN ('whatsapp_lead', 'manual') THEN
    NULL; -- só DNC abaixo
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.is_converted = true THEN
      v_reason := 'is_converted';
    ELSIF NEW.status IN ('approved', 'active', 'registered_igreen', 'cadastro_concluido', 'complete') THEN
      v_reason := 'cliente_status_' || NEW.status;
    ELSIF NEW.customer_origin IN ('igreen_sync', 'igreen_extension') THEN
      v_reason := 'cliente_carteira';
    ELSIF NEW.pos_venda_stage IS NOT NULL THEN
      v_reason := 'cliente_pos_venda';
    ELSE
      v_andamento := lower(trim(COALESCE(NEW.andamento_igreen, '')));
      IF v_andamento IN ('ativo', 'aprovado', 'validado', 'licenciada', 'licenciado') THEN
        v_reason := 'cliente_andamento';
      END IF;
    END IF;
  ELSE
    -- UPDATE
    IF NEW.is_converted = true AND COALESCE(OLD.is_converted, false) = false THEN
      v_reason := 'is_converted';
    ELSIF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
      v_reason := 'status_approved';
    ELSIF NEW.status IN ('active', 'registered_igreen', 'cadastro_concluido', 'complete')
      AND OLD.status IS DISTINCT FROM NEW.status THEN
      v_reason := 'cliente_status_' || NEW.status;
    ELSIF NEW.customer_origin IN ('igreen_sync', 'igreen_extension')
      AND OLD.customer_origin IS DISTINCT FROM NEW.customer_origin THEN
      v_reason := 'cliente_carteira';
    ELSIF NEW.pos_venda_stage IS NOT NULL
      AND OLD.pos_venda_stage IS DISTINCT FROM NEW.pos_venda_stage THEN
      v_reason := 'cliente_pos_venda';
    ELSE
      v_andamento := lower(trim(COALESCE(NEW.andamento_igreen, '')));
      v_old_andamento := lower(trim(COALESCE(OLD.andamento_igreen, '')));
      IF v_andamento IN ('ativo', 'aprovado', 'validado', 'licenciada', 'licenciado')
         AND v_old_andamento IS DISTINCT FROM v_andamento THEN
        v_reason := 'cliente_andamento';
      END IF;
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    PERFORM public.mark_journey_won(NEW.id, v_reason);
  END IF;

  -- DNC / pedido para parar → pausa terminal da cadência + suprime efeitos
  -- ainda apenas reservados. Nunca reaberto automaticamente.
  IF NEW.do_not_contact = true
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.do_not_contact, false) = false) THEN
    UPDATE public.lead_cadence_state
       SET stage            = 'PAUSED'::public.cadence_stage,
           paused_reason    = 'dnc',
           paused_until     = NULL,
           next_action_at   = NULL,
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
AFTER INSERT OR UPDATE OF is_converted, status, do_not_contact,
  customer_origin, pos_venda_stage, andamento_igreen, pos_venda_recadastro_at
ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.tg_customer_journey_sync();

COMMENT ON FUNCTION public.tg_customer_journey_sync() IS
  'Jornada A/B/C: cliente (carteira/aprovado/pos_venda/andamento) → WON; DNC → pausa; recadastro não força WON.';

-- Backfill: clientes ainda em A/B/C ativo → WON (sem apagar histórico).
SELECT public.mark_journey_won(c.id, 'backfill_cliente_abc')
FROM public.customers c
JOIN public.lead_cadence_state lcs ON lcs.customer_id = c.id
WHERE lcs.stage IS DISTINCT FROM 'WON'::public.cadence_stage
  AND lcs.next_action_at IS NOT NULL
  AND (
    c.customer_origin IN ('igreen_sync', 'igreen_extension')
    OR c.is_converted = true
    OR c.status IN ('approved', 'active', 'registered_igreen', 'cadastro_concluido', 'complete')
    OR (c.pos_venda_stage IS NOT NULL AND c.pos_venda_recadastro_at IS NULL)
    OR lower(trim(COALESCE(c.andamento_igreen, ''))) IN (
      'ativo', 'aprovado', 'validado', 'licenciada', 'licenciado'
    )
  );
