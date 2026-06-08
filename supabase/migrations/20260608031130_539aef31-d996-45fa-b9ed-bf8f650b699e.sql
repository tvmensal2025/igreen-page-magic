
-- 1. New columns
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS pos_venda_pending_stage text,
  ADD COLUMN IF NOT EXISTS pending_snoozed_until timestamptz;

-- 2. Cutoff in settings (idempotent)
INSERT INTO public.settings (key, value)
VALUES ('pos_venda_cutoff_at', to_jsonb(now()::text))
ON CONFLICT (key) DO NOTHING;

-- 3. Backfill ALL old igreen_sync customers into "espera" (manual=true so cron doesn't overwrite)
UPDATE public.customers
   SET pos_venda_stage = 'espera',
       pos_venda_manual = true,
       pos_venda_pending_stage = NULL,
       updated_at = now()
 WHERE customer_origin = 'igreen_sync'
   AND (pos_venda_stage IS NULL OR pos_venda_stage NOT IN ('espera'));

-- 4. Update recompute function: never touch customers in espera or with pending
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
       SET pos_venda_stage = public.compute_pos_venda_stage(c.portal_submitted_at, c.status, c.andamento_igreen),
           updated_at = now()
     WHERE c.customer_origin = 'igreen_sync'
       AND c.pos_venda_manual = false
       AND COALESCE(c.pos_venda_stage, '') <> 'espera'
       AND c.pos_venda_pending_stage IS NULL
       AND c.pos_venda_stage IS DISTINCT FROM public.compute_pos_venda_stage(c.portal_submitted_at, c.status, c.andamento_igreen)
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN v_count;
END;
$function$;

-- 5. RPC: confirm a pending classification from the popup
CREATE OR REPLACE FUNCTION public.confirm_pending_classification(
  _customer_id uuid,
  _action text  -- 'approve' | 'review' | 'snooze'
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

  -- Ownership check: must be owner or assigned consultant
  IF auth.uid() IS NOT NULL AND v_customer.consultant_id <> auth.uid() AND COALESCE(v_customer.assigned_consultant_id, '00000000-0000-0000-0000-000000000000'::uuid) <> auth.uid() THEN
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
    -- Keep in espera, clear pending so popup goes away. Consultor classifica manual.
    UPDATE public.customers
       SET pos_venda_pending_stage = NULL,
           pending_snoozed_until = NULL,
           updated_at = now()
     WHERE id = _customer_id;
    RETURN jsonb_build_object('ok', true, 'action', 'review');
  END IF;

  IF _action = 'approve' THEN
    v_target := COALESCE(v_customer.pos_venda_pending_stage, 'aprovado');
    UPDATE public.customers
       SET pos_venda_stage = v_target,
           pos_venda_manual = true,
           pos_venda_pending_stage = NULL,
           pending_snoozed_until = NULL,
           updated_at = now()
     WHERE id = _customer_id;
    RETURN jsonb_build_object('ok', true, 'action', 'approved', 'stage', v_target);
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'unknown_action');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.confirm_pending_classification(uuid, text) TO authenticated;
