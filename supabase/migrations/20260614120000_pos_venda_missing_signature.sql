-- ============================================================
-- Pós-Venda — ação "Falta assinatura" no modal de confirmação
-- 2026-06-14
-- ============================================================
-- Consultor classifica cliente que ainda não assinou: permanece em
-- espera (sem esteira 30/60/90), status awaiting_signature, sai da fila
-- do popup até assinar e ser validado depois.

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

  -- Cliente ainda não assinou: não entra na esteira temporal nem conta como aprovado.
  IF _action = 'missing_signature' THEN
    UPDATE public.customers
       SET status = 'awaiting_signature',
           pos_venda_stage = 'espera',
           pos_venda_manual = true,
           pos_venda_pending_stage = NULL,
           pending_snoozed_until = NULL,
           pos_venda_approved_at = NULL,
           pos_venda_reason = 'Falta assinatura',
           updated_at = now()
     WHERE id = _customer_id;
    RETURN jsonb_build_object('ok', true, 'action', 'missing_signature');
  END IF;

  IF _action = 'approve' THEN
    v_target := COALESCE(v_customer.pos_venda_pending_stage, 'aprovado');
    -- Se estava marcado como falta assinatura, só aprova de fato quando for aprovado.
    IF v_target = 'falta_assinatura' THEN
      v_target := 'aprovado';
    END IF;
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
