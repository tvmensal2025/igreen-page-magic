-- ============================================================================
-- Hard lock: sync / cliente NUNCA entra em A/B/C.
-- Causa raiz: trg_cadence_ensure_state criava GREETED em TODO insert
-- (incluindo igreen_sync). Ordem: journey_sync rodava antes → WON no-op
-- → ensure_state abria GREETED. Dashboard "Total de cadastros" = carteira.
-- ============================================================================

-- 1) Não criar estado de cadência para cliente/carteira.
CREATE OR REPLACE FUNCTION public.cadence_ensure_state_from_customer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_andamento text;
BEGIN
  -- Carteira iGreen (sync/extensão): só pós-venda + agenda.
  IF NEW.customer_origin IN ('igreen_sync', 'igreen_extension') THEN
    RETURN NEW;
  END IF;

  -- Já convertido / status de cliente.
  IF COALESCE(NEW.is_converted, false) = true THEN
    RETURN NEW;
  END IF;
  IF NEW.status IN (
    'approved', 'active', 'registered_igreen', 'cadastro_concluido', 'complete'
  ) THEN
    RETURN NEW;
  END IF;

  -- Já no funil pós-venda (exceto retentativa que zera pos_venda_stage).
  IF NEW.pos_venda_stage IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_andamento := lower(trim(COALESCE(NEW.andamento_igreen, '')));
  IF v_andamento IN ('ativo', 'aprovado', 'validado', 'licenciada', 'licenciado') THEN
    RETURN NEW;
  END IF;

  -- Lead puro: entra GREETED D+1.
  INSERT INTO public.lead_cadence_state (customer_id, consultant_id, stage, next_action_at)
  VALUES (NEW.id, NEW.consultant_id, 'GREETED', now() + interval '24 hours')
  ON CONFLICT (customer_id) DO NOTHING;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.cadence_ensure_state_from_customer() IS
  'Novo customer → cadência GREETED só se for LEAD. Sync/cliente nunca entra em A/B/C.';

-- 2) Cadeado no lead_cadence_state: qualquer INSERT/UPDATE que tente
--    colocar cliente em estágio ativo vira WON terminal.
CREATE OR REPLACE FUNCTION public.tg_lead_cadence_block_cliente()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
  v_andamento text;
  v_is_cliente boolean := false;
BEGIN
  -- Já WON e sem next → ok.
  IF NEW.stage = 'WON'::public.cadence_stage AND NEW.next_action_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    customer_origin,
    status,
    is_converted,
    pos_venda_stage,
    andamento_igreen,
    pos_venda_recadastro_at
  INTO c
  FROM public.customers
  WHERE id = NEW.customer_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Retentativa reabriu Grupo A.
  IF c.pos_venda_recadastro_at IS NOT NULL AND c.pos_venda_stage IS NULL THEN
    RETURN NEW;
  END IF;

  IF c.customer_origin IN ('igreen_sync', 'igreen_extension') THEN
    v_is_cliente := true;
  ELSIF COALESCE(c.is_converted, false) = true THEN
    v_is_cliente := true;
  ELSIF c.status IN (
    'approved', 'active', 'registered_igreen', 'cadastro_concluido', 'complete'
  ) THEN
    v_is_cliente := true;
  ELSIF c.pos_venda_stage IS NOT NULL THEN
    v_is_cliente := true;
  ELSE
    v_andamento := lower(trim(COALESCE(c.andamento_igreen, '')));
    IF v_andamento IN ('ativo', 'aprovado', 'validado', 'licenciada', 'licenciado') THEN
      v_is_cliente := true;
    END IF;
  END IF;

  IF v_is_cliente THEN
    NEW.stage := 'WON'::public.cadence_stage;
    NEW.next_action_at := NULL;
    NEW.paused_until := NULL;
    NEW.paused_reason := 'won:cliente_guard';
    NEW.won_at := COALESCE(NEW.won_at, now());
    NEW.claim_token := NULL;
    NEW.claimed_at := NULL;
    NEW.lease_expires_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_cadence_block_cliente ON public.lead_cadence_state;
CREATE TRIGGER trg_lead_cadence_block_cliente
  BEFORE INSERT OR UPDATE OF stage, next_action_at ON public.lead_cadence_state
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_lead_cadence_block_cliente();

COMMENT ON FUNCTION public.tg_lead_cadence_block_cliente() IS
  'Hard lock: cliente/sync nunca fica em A/B/C ativo — força WON.';

-- 3) Inbound não reabre WON / cliente.
CREATE OR REPLACE FUNCTION public.cadence_on_inbound_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
BEGIN
  IF NEW.message_direction = 'inbound' AND NEW.customer_id IS NOT NULL THEN
    SELECT customer_origin, status, is_converted, pos_venda_stage,
           andamento_igreen, pos_venda_recadastro_at
      INTO c
      FROM public.customers
     WHERE id = NEW.customer_id;

    -- Cliente/carteira: não mexe na jornada A/B/C.
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
       SET stage = 'AI_QUALIFYING',
           last_response_at = now(),
           next_action_at = now() + interval '24 hours',
           paused_reason = NULL,
           paused_until = NULL
     WHERE customer_id = NEW.customer_id
       AND stage IS DISTINCT FROM 'WON'::public.cadence_stage;
  END IF;
  RETURN NEW;
END;
$$;

-- 4) Reforço: qualquer cadence ativa residual de cliente → WON.
SELECT public.mark_journey_won(c.id, 'backfill_cliente_guard_v2')
FROM public.customers c
JOIN public.lead_cadence_state lcs ON lcs.customer_id = c.id
WHERE lcs.stage IS DISTINCT FROM 'WON'::public.cadence_stage
  AND (
    c.customer_origin IN ('igreen_sync', 'igreen_extension')
    OR c.is_converted = true
    OR c.status IN ('approved', 'active', 'registered_igreen', 'cadastro_concluido', 'complete')
    OR (c.pos_venda_stage IS NOT NULL AND c.pos_venda_recadastro_at IS NULL)
    OR lower(trim(COALESCE(c.andamento_igreen, ''))) IN (
      'ativo', 'aprovado', 'validado', 'licenciada', 'licenciado'
    )
  );
