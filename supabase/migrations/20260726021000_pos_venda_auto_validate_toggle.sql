-- Toggle: validar pós-venda sozinho (sem clicar Validar).
-- Default OFF — consultor continua clicando até ligar.

ALTER TABLE public.consultant_automation_prefs
  ADD COLUMN IF NOT EXISTS pos_venda_auto_validate boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.consultant_automation_prefs.pos_venda_auto_validate IS
  'Quando true, pendências aprovado/reprovado do sync são confirmadas sozinhas (com data iGreen). falta_assinatura/devolutiva continuam manuais.';

-- Processa a fila de validação para consultores com o toggle ON.
-- Seguro: service_role (cron) processa todos; authenticated só o próprio.
CREATE OR REPLACE FUNCTION public.auto_confirm_pending_pos_venda(
  _consultant_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row record;
  v_action text;
  v_result jsonb;
  v_approved int := 0;
  v_rejected int := 0;
  v_errors int := 0;
  v_skipped int := 0;
BEGIN
  -- authenticated só pode processar a si mesmo
  IF v_uid IS NOT NULL THEN
    IF _consultant_id IS NOT NULL AND _consultant_id <> v_uid THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
    _consultant_id := v_uid;
  END IF;

  FOR v_row IN
    SELECT c.id, c.pos_venda_pending_stage, c.consultant_id, c.assigned_consultant_id
      FROM public.customers c
      JOIN public.consultant_automation_prefs p
        ON p.consultant_id = COALESCE(c.assigned_consultant_id, c.consultant_id)
     WHERE c.customer_origin = 'igreen_sync'
       AND c.pos_venda_invalid = false
       AND c.pos_venda_pending_stage IN ('aprovado', 'reprovado')
       AND (c.pending_snoozed_until IS NULL OR c.pending_snoozed_until < now())
       AND p.pos_venda_auto_validate = true
       AND (_consultant_id IS NULL
            OR c.consultant_id = _consultant_id
            OR c.assigned_consultant_id = _consultant_id)
  LOOP
    BEGIN
      IF v_row.pos_venda_pending_stage = 'aprovado' THEN
        v_action := 'approve';
      ELSE
        v_action := 'reject_pending';
      END IF;

      v_result := public.confirm_pending_classification(v_row.id, v_action, NULL);

      IF COALESCE((v_result->>'ok')::boolean, false) THEN
        IF v_action = 'approve' THEN
          v_approved := v_approved + 1;
        ELSE
          v_rejected := v_rejected + 1;
        END IF;
      ELSE
        v_errors := v_errors + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
    END;
  END LOOP;

  -- Conta o que ficou de fora (falta assinatura / devolutiva) só p/ telemetria
  SELECT count(*)::int INTO v_skipped
    FROM public.customers c
    JOIN public.consultant_automation_prefs p
      ON p.consultant_id = COALESCE(c.assigned_consultant_id, c.consultant_id)
   WHERE c.customer_origin = 'igreen_sync'
     AND c.pos_venda_invalid = false
     AND c.pos_venda_pending_stage IN ('falta_assinatura', 'devolutiva', 'devolutiva_aberta')
     AND p.pos_venda_auto_validate = true
     AND (_consultant_id IS NULL
          OR c.consultant_id = _consultant_id
          OR c.assigned_consultant_id = _consultant_id);

  RETURN jsonb_build_object(
    'ok', true,
    'approved', v_approved,
    'rejected', v_rejected,
    'errors', v_errors,
    'left_manual', v_skipped
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_confirm_pending_pos_venda(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_confirm_pending_pos_venda(uuid) TO authenticated, service_role;
