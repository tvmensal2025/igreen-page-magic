
-- 1) Liga conversational_flow_enabled para tvmensal01 (raiz do problema)
UPDATE public.consultants
   SET conversational_flow_enabled = true
 WHERE id = '953f7e48-509b-4069-9822-bdad9902be09';

-- 2) Zera o estado do customer 937defb9 (que ficou em 'qualificacao' do legado)
UPDATE public.customers
   SET conversation_step = NULL,
       previous_conversation_step = NULL,
       custom_step_retries = 0,
       custom_step_retries_step = NULL,
       last_custom_prompt_at = NULL,
       ai_followups_count = 0,
       chat_cleared_at = now()
 WHERE id = '937defb9-e206-4779-9855-92753883cf08';

DELETE FROM public.ai_slot_dispatch_log
 WHERE customer_id = '937defb9-e206-4779-9855-92753883cf08';

DELETE FROM public.customer_flow_state
 WHERE customer_id = '937defb9-e206-4779-9855-92753883cf08';

-- 3) Patch da função de seed: novos consultores já nascem com a flag ligada
CREATE OR REPLACE FUNCTION public.seed_default_camila_flow(_consultant_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_template_consultant uuid := '0c2711ad-4836-41e6-afba-edd94f698ae3';
  v_flow_id uuid;
  v_step_count int;
  v_template_steps int;
BEGIN
  -- Não roda no próprio template
  IF _consultant_id = v_template_consultant THEN
    SELECT id INTO v_flow_id
      FROM public.bot_flows
     WHERE consultant_id = _consultant_id AND variant = 'D' AND is_active = true
     ORDER BY created_at ASC LIMIT 1;
    RETURN v_flow_id;
  END IF;

  -- Garante que o motor conversational (DB-driven) esteja ligado para este consultor.
  -- Sem essa flag, o evolution-webhook cai no engine 'sys' legado e nunca executa
  -- os bot_flow_steps do fluxo D (root cause do bug 2026-06-04: tvmensal01 ficou
  -- com fluxo D clonado mas conversational_flow_enabled=false → bot respondia
  -- com welcome→qualificacao hardcoded em vez do d_welcome).
  UPDATE public.consultants
     SET conversational_flow_enabled = true
   WHERE id = _consultant_id
     AND conversational_flow_enabled IS DISTINCT FROM true;

  -- Reutiliza fluxo D existente se já tiver
  SELECT id INTO v_flow_id
    FROM public.bot_flows
   WHERE consultant_id = _consultant_id
     AND is_active = true
     AND variant = 'D'
   ORDER BY created_at ASC
   LIMIT 1;

  IF v_flow_id IS NULL THEN
    INSERT INTO public.bot_flows (consultant_id, name, variant, is_active, strict_mode)
    VALUES (_consultant_id, 'Fluxo Padrão (D)', 'D', true, false)
    RETURNING id INTO v_flow_id;
  END IF;

  -- Se já tem passos, não sobrescreve
  SELECT count(*) INTO v_step_count FROM public.bot_flow_steps WHERE flow_id = v_flow_id;
  IF v_step_count > 0 THEN RETURN v_flow_id; END IF;

  -- Verifica template
  SELECT count(*) INTO v_template_steps
    FROM public.bot_flow_steps bs
    JOIN public.bot_flows bf ON bf.id = bs.flow_id
   WHERE bf.consultant_id = v_template_consultant
     AND bf.variant = 'D'
     AND bf.is_active = true;

  IF v_template_steps > 0 THEN
    PERFORM public.clone_superadmin_flow_d_steps(v_flow_id);
  END IF;

  RETURN v_flow_id;
END;
$function$;
