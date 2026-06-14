-- Unifica marco temporal do pós-venda: pos_venda_approved_at (canônico) com
-- fallback portal_submitted_at. Alinha SQL cron (recompute) com edge/UI.

-- 1) Coluna canônica (pode já existir em produção via types gerados)
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS pos_venda_approved_at timestamptz;

-- 2) Backfill: quem já está na esteira temporal herda portal_submitted_at
UPDATE public.customers
   SET pos_venda_approved_at = portal_submitted_at,
       updated_at = now()
 WHERE customer_origin = 'igreen_sync'
   AND pos_venda_approved_at IS NULL
   AND portal_submitted_at IS NOT NULL
   AND pos_venda_stage IN ('aprovado', 'd30', 'd60', 'd90', 'd120');

-- 3) compute_pos_venda_stage: primeiro arg = data de referência para d30–d120
CREATE OR REPLACE FUNCTION public.compute_pos_venda_stage(
  _reference_at timestamptz,
  _status text,
  _andamento text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _status IN ('rejected','cancelled','canceled') THEN 'reprovado'
    WHEN _andamento IS NOT NULL AND _andamento ~* 'reprov|cancel' THEN 'reprovado'
    WHEN _reference_at IS NULL THEN 'espera'
    WHEN now() - _reference_at >= interval '120 days' THEN 'd120'
    WHEN now() - _reference_at >= interval '90 days'  THEN 'd90'
    WHEN now() - _reference_at >= interval '60 days'  THEN 'd60'
    WHEN now() - _reference_at >= interval '30 days'  THEN 'd30'
    ELSE 'aprovado'
  END;
$$;

-- 4) recompute usa COALESCE(aprovado, portal) — mesma regra do edge cron
CREATE OR REPLACE FUNCTION public.recompute_pos_venda_stages()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  WITH upd AS (
    UPDATE public.customers c
       SET pos_venda_stage = public.compute_pos_venda_stage(
             COALESCE(c.pos_venda_approved_at, c.portal_submitted_at),
             c.status,
             c.andamento_igreen
           ),
           updated_at = now()
     WHERE c.customer_origin = 'igreen_sync'
       AND c.pos_venda_manual = false
       AND COALESCE(c.pos_venda_stage, '') <> 'espera'
       AND c.pos_venda_pending_stage IS NULL
       AND c.pos_venda_stage IS DISTINCT FROM public.compute_pos_venda_stage(
             COALESCE(c.pos_venda_approved_at, c.portal_submitted_at),
             c.status,
             c.andamento_igreen
           )
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN v_count;
END;
$function$;

-- 5) Trigger: stamp pos_venda_approved_at ao entrar em aprovado
CREATE OR REPLACE FUNCTION public.stamp_pos_venda_approved_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.pos_venda_stage = 'aprovado'
     AND (OLD.pos_venda_stage IS DISTINCT FROM 'aprovado')
     AND NEW.pos_venda_approved_at IS NULL THEN
    NEW.pos_venda_approved_at := now();
  END IF;

  IF NEW.pos_venda_stage = 'reprovado'
     AND (OLD.pos_venda_stage IS DISTINCT FROM 'reprovado') THEN
    NEW.pos_venda_approved_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_pos_venda_approved_at ON public.customers;
CREATE TRIGGER trg_stamp_pos_venda_approved_at
  BEFORE UPDATE OF pos_venda_stage ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_pos_venda_approved_at();

-- 6) RPC approve: garante pos_venda_approved_at ao classificar aprovado
CREATE OR REPLACE FUNCTION public.confirm_pending_classification(
  _customer_id uuid,
  _action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_target text;
BEGIN
  SELECT * INTO v_customer FROM public.customers WHERE id = _customer_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF auth.uid() IS NOT NULL
     AND v_customer.consultant_id <> auth.uid()
     AND COALESCE(v_customer.assigned_consultant_id, '00000000-0000-0000-0000-000000000000'::uuid) <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF _action = 'snooze' THEN
    UPDATE public.customers
       SET pending_snoozed_until = now() + interval '24 hours',
           updated_at = now()
     WHERE id = _customer_id;
    RETURN jsonb_build_object('ok', true, 'action', 'snoozed');
  END IF;

  IF _action = 'review' THEN
    UPDATE public.customers
       SET pos_venda_pending_stage = NULL,
           pending_snoozed_until = NULL,
           updated_at = now()
     WHERE id = _customer_id;
    RETURN jsonb_build_object('ok', true, 'action', 'review');
  END IF;

  IF _action = 'invalidate' THEN
    UPDATE public.customers
       SET pos_venda_invalid = true,
           pos_venda_pending_stage = NULL,
           pending_snoozed_until = NULL,
           updated_at = now()
     WHERE id = _customer_id;
    RETURN jsonb_build_object('ok', true, 'action', 'invalidated');
  END IF;

  IF _action = 'approve' THEN
    v_target := COALESCE(v_customer.pos_venda_pending_stage, 'aprovado');
    UPDATE public.customers
       SET pos_venda_stage = v_target,
           pos_venda_manual = true,
           pos_venda_pending_stage = NULL,
           pending_snoozed_until = NULL,
           pos_venda_approved_at = CASE
             WHEN v_target = 'aprovado' AND pos_venda_approved_at IS NULL THEN now()
             ELSE pos_venda_approved_at
           END,
           updated_at = now()
     WHERE id = _customer_id;
    RETURN jsonb_build_object('ok', true, 'action', 'approved', 'stage', v_target);
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'unknown_action');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.confirm_pending_classification(uuid, text) TO authenticated;
