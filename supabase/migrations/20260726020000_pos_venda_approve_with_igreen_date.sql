-- Pós-venda: ao validar, usa data iGreen (cadastro/ativo/validado) como
-- pos_venda_approved_at e calcula o bucket D30–D210 automaticamente.
-- Assim o consultor não precisa “olhar” nem jogar manualmente em 30/60/90…
-- Áudio/imagem já existem em pos_venda_default_media; só falta a data.

-- 1) Resolve a melhor data de referência (nunca no futuro).
CREATE OR REPLACE FUNCTION public.resolve_pos_venda_reference_at(
  _data_cadastro_igreen date,
  _data_ativo_igreen date,
  _data_validado_igreen date,
  _data_cadastro text,
  _data_ativo text,
  _data_validado text,
  _portal_submitted_at timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (timezone('America/Sao_Paulo', now()))::date;
  v_d date;
  v_txt text;
  v_candidates date[] := ARRAY[]::date[];
BEGIN
  -- Esteira pós-venda: ativo (quando virou cliente) > validado > cadastro.
  -- Cadastro às vezes é reprocessamento recente e “zeraria” os dias.
  IF _data_ativo_igreen IS NOT NULL AND _data_ativo_igreen <= v_today THEN
    v_candidates := array_append(v_candidates, _data_ativo_igreen);
  END IF;
  IF _data_validado_igreen IS NOT NULL AND _data_validado_igreen <= v_today THEN
    v_candidates := array_append(v_candidates, _data_validado_igreen);
  END IF;
  IF _data_cadastro_igreen IS NOT NULL AND _data_cadastro_igreen <= v_today THEN
    v_candidates := array_append(v_candidates, _data_cadastro_igreen);
  END IF;

  FOREACH v_txt IN ARRAY ARRAY[_data_ativo, _data_validado, _data_cadastro]
  LOOP
    IF v_txt IS NULL OR btrim(v_txt) = '' THEN CONTINUE; END IF;
    BEGIN
      -- ISO yyyy-mm-dd ou yyyy-mm-ddTHH:MM…
      IF v_txt ~ '^\d{4}-\d{2}-\d{2}' THEN
        v_d := substring(v_txt from 1 for 10)::date;
      -- BR dd/mm/yyyy
      ELSIF v_txt ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN
        v_d := to_date(v_txt, 'DD/MM/YYYY');
      ELSE
        v_d := NULL;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_d := NULL;
    END;
    IF v_d IS NOT NULL AND v_d <= v_today THEN
      v_candidates := array_append(v_candidates, v_d);
    END IF;
  END LOOP;

  -- Preferência: ativo → validado → cadastro (ordem de inserção acima).
  IF array_length(v_candidates, 1) IS NOT NULL AND array_length(v_candidates, 1) >= 1 THEN
    RETURN (v_candidates[1]::timestamp AT TIME ZONE 'America/Sao_Paulo');
  END IF;

  IF _portal_submitted_at IS NOT NULL
     AND (_portal_submitted_at AT TIME ZONE 'America/Sao_Paulo')::date <= v_today THEN
    RETURN _portal_submitted_at;
  END IF;

  RETURN now();
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_pos_venda_reference_at(date, date, date, text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_pos_venda_reference_at(date, date, date, text, text, text, timestamptz) TO authenticated, service_role;

-- 2) Marca marcos anteriores como skipped (hub + auto-progress não reenviam).
CREATE OR REPLACE FUNCTION public.pos_venda_mark_prior_stages_skipped(
  _customer_id uuid,
  _consultant_id uuid,
  _current_stage text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order text[] := ARRAY[
    'aprovado','d30','d60','d90','d120','d150','d180','d210'
  ];
  v_idx int;
  v_stage text;
  v_key text;
  i int;
BEGIN
  v_idx := array_position(v_order, _current_stage);
  IF v_idx IS NULL OR v_idx <= 1 THEN
    RETURN;
  END IF;

  FOR i IN 1..(v_idx - 1) LOOP
    v_stage := v_order[i];
    v_key := 'pv_' || v_stage;
    INSERT INTO public.customer_auto_message_log (
      customer_id, consultant_id, stage_key, remote_jid, customer_name,
      message_preview, status
    )
    VALUES (
      _customer_id, _consultant_id, v_key, 'skipped@local', NULL,
      'skipped_backfill_from_igreen_date', 'skipped_prior'
    )
    ON CONFLICT (customer_id, stage_key) DO NOTHING;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.pos_venda_mark_prior_stages_skipped(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_venda_mark_prior_stages_skipped(uuid, uuid, text) TO service_role;

-- 3) confirm_pending_classification: approve usa data iGreen + bucket automático.
--    _force_stage opcional (dropdown avançado na UI).
DROP FUNCTION IF EXISTS public.confirm_pending_classification(uuid, text);
CREATE OR REPLACE FUNCTION public.confirm_pending_classification(
  _customer_id uuid,
  _action text,
  _force_stage text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_target text;
  v_ref timestamptz;
  v_computed text;
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

  IF _action = 'defer_devolutiva' THEN
    UPDATE public.customers
       SET pos_venda_pending_stage = 'devolutiva_aberta',
           pos_venda_stage = 'espera',
           pos_venda_manual = true,
           pending_snoozed_until = NULL,
           pos_venda_approved_at = NULL,
           pos_venda_reason = 'Devolutiva em aberto',
           updated_at = now()
     WHERE id = _customer_id;
    RETURN jsonb_build_object('ok', true, 'action', 'devolutiva_aberta');
  END IF;

  IF _action = 'reject_pending' THEN
    UPDATE public.customers
       SET pos_venda_stage = 'reprovado',
           pos_venda_manual = true,
           pos_venda_pending_stage = NULL,
           pending_snoozed_until = NULL,
           pos_venda_approved_at = NULL,
           pos_venda_rejected_at = COALESCE(pos_venda_rejected_at, now()),
           pos_venda_reason = 'Reclassificado como reprovado',
           updated_at = now()
     WHERE id = _customer_id;
    RETURN jsonb_build_object('ok', true, 'action', 'rejected', 'stage', 'reprovado');
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
    -- Data canônica da esteira = cadastro/ativo/validado iGreen (não "agora").
    v_ref := public.resolve_pos_venda_reference_at(
      v_customer.data_cadastro_igreen,
      v_customer.data_ativo_igreen,
      v_customer.data_validado_igreen,
      v_customer.data_cadastro,
      v_customer.data_ativo,
      v_customer.data_validado,
      v_customer.portal_submitted_at
    );

    v_computed := public.compute_pos_venda_stage(v_ref, v_customer.status, v_customer.andamento_igreen);
    IF v_computed = 'reprovado' THEN
      v_computed := 'aprovado'; -- consultor está aprovando explicitamente
    END IF;
    IF v_computed = 'espera' THEN
      v_computed := 'aprovado';
    END IF;

    -- Força manual (dropdown) só se for bucket da esteira aprovada.
    IF _force_stage IS NOT NULL AND _force_stage IN (
      'aprovado','d30','d60','d90','d120','d150','d180','d210'
    ) THEN
      v_target := _force_stage;
    ELSE
      v_target := v_computed;
    END IF;

    UPDATE public.customers
       SET pos_venda_stage = v_target,
           pos_venda_manual = true,
           pos_venda_pending_stage = NULL,
           pending_snoozed_until = NULL,
           pos_venda_rejected_at = NULL,
           pos_venda_approved_at = COALESCE(pos_venda_approved_at, v_ref),
           updated_at = now()
     WHERE id = _customer_id;

    PERFORM public.pos_venda_mark_prior_stages_skipped(
      _customer_id,
      COALESCE(v_customer.assigned_consultant_id, v_customer.consultant_id),
      v_target
    );

    RETURN jsonb_build_object(
      'ok', true,
      'action', 'approved',
      'stage', v_target,
      'approved_at', v_ref,
      'computed_stage', v_computed
    );
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'unknown_action');
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_pending_classification(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_pending_classification(uuid, text, text) TO authenticated, service_role;

-- 4) Backfill: preenche data_cadastro_igreen a partir do texto quando possível.
UPDATE public.customers
   SET data_cadastro_igreen = CASE
         WHEN data_cadastro ~ '^\d{4}-\d{2}-\d{2}' THEN substring(data_cadastro from 1 for 10)::date
         WHEN data_cadastro ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN to_date(data_cadastro, 'DD/MM/YYYY')
         ELSE data_cadastro_igreen
       END
 WHERE customer_origin = 'igreen_sync'
   AND data_cadastro_igreen IS NULL
   AND data_cadastro IS NOT NULL
   AND btrim(data_cadastro) <> '';
