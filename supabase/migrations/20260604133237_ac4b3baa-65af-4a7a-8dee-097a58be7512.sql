-- 1) Destravar imediatamente o lead 5511989000650 do consultor tvmensal01.
--    Ele ficou em bot_paused=humano_assumiu após reset que não removeu o handoff.
UPDATE public.customers
SET bot_paused = false,
    bot_paused_reason = NULL,
    bot_paused_at = NULL,
    bot_paused_until = NULL,
    assigned_human_id = NULL,
    conversation_step = NULL,
    capture_mode = 'auto',
    custom_step_retries = 0,
    custom_step_retries_step = NULL,
    last_custom_prompt_at = NULL,
    ai_followups_count = 0,
    chat_cleared_at = now()
WHERE id = '937defb9-e206-4779-9855-92753883cf08';

DELETE FROM public.ai_slot_dispatch_log
 WHERE customer_id = '937defb9-e206-4779-9855-92753883cf08';

-- 2) Tornar reset_lead_conversation defensivo: ANTES de tentar apagar o
--    customer, limpa handoff/pause/step. Assim, se a DELETE falhar por
--    qualquer FK/trigger, o lead já sai destravado e o bot recomeça do zero
--    na próxima mensagem (que era o que o toast já prometia).
CREATE OR REPLACE FUNCTION public.reset_lead_conversation(_consultant_id uuid, _customer_id uuid DEFAULT NULL::uuid, _remote_jid text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_customer_id uuid := _customer_id;
  v_phone_digits text;
  v_remote_jid text := _remote_jid;
  v_deleted jsonb := '{}'::jsonb;
  v_count int;
BEGIN
  IF auth.uid() IS DISTINCT FROM _consultant_id
     AND NOT public.has_role(auth.uid(), 'admin'::app_role)
     AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF v_remote_jid IS NOT NULL THEN
    v_phone_digits := regexp_replace(split_part(v_remote_jid, '@', 1), '\D', '', 'g');
    IF v_phone_digits IS NOT NULL AND length(v_phone_digits) >= 8 AND NOT v_phone_digits LIKE '55%' THEN
      v_phone_digits := '55' || v_phone_digits;
    END IF;
    v_remote_jid := v_phone_digits || '@s.whatsapp.net';
  END IF;

  IF v_customer_id IS NULL AND v_phone_digits IS NOT NULL THEN
    SELECT id INTO v_customer_id FROM customers
     WHERE consultant_id = _consultant_id
       AND regexp_replace(coalesce(phone_whatsapp,''), '\D', '', 'g') = v_phone_digits
     ORDER BY created_at DESC
     LIMIT 1;
  END IF;

  IF v_phone_digits IS NULL AND v_customer_id IS NOT NULL THEN
    SELECT regexp_replace(coalesce(phone_whatsapp,''), '\D', '', 'g')
      INTO v_phone_digits
      FROM customers WHERE id = v_customer_id;
  END IF;

  IF v_phone_digits IS NOT NULL AND length(v_phone_digits) >= 8 THEN
    INSERT INTO public.force_bot_phones (consultant_id, phone_digits)
      VALUES (_consultant_id, v_phone_digits)
      ON CONFLICT (consultant_id, phone_digits) DO UPDATE SET created_at = now();
  END IF;

  IF v_customer_id IS NULL THEN
    IF v_remote_jid IS NOT NULL THEN
      DELETE FROM scheduled_messages WHERE remote_jid = v_remote_jid;
      DELETE FROM crm_auto_message_log WHERE remote_jid = v_remote_jid;
      DELETE FROM crm_deals WHERE consultant_id = _consultant_id AND remote_jid = v_remote_jid;
    END IF;
    RETURN jsonb_build_object('ok', true, 'customer_id', null, 'note', 'no_customer');
  END IF;

  -- DEFENSIVO: zera handoff/pause/step ANTES de tentar deletar o customer.
  -- Se a DELETE FROM customers falhar (FK/trigger), o lead ainda sai
  -- destravado e o bot recomeça do zero na próxima mensagem.
  UPDATE public.customers
     SET bot_paused = false,
         bot_paused_reason = NULL,
         bot_paused_at = NULL,
         bot_paused_until = NULL,
         assigned_human_id = NULL,
         conversation_step = NULL,
         previous_conversation_step = NULL,
         capture_mode = 'auto',
         custom_step_retries = 0,
         custom_step_retries_step = NULL,
         last_custom_prompt_at = NULL,
         ai_followups_count = 0,
         chat_cleared_at = now()
   WHERE id = v_customer_id;

  DELETE FROM conversations WHERE customer_id = v_customer_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('conversations', v_count);

  DELETE FROM ai_slot_dispatch_log WHERE customer_id = v_customer_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('ai_slot_dispatch_log', v_count);

  DELETE FROM ai_decisions WHERE customer_id = v_customer_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('ai_decisions', v_count);

  DELETE FROM ai_agent_logs WHERE customer_id = v_customer_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('ai_agent_logs', v_count);

  DELETE FROM bot_step_transitions WHERE customer_id = v_customer_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('bot_step_transitions', v_count);

  DELETE FROM bot_handoff_alerts WHERE customer_id = v_customer_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('bot_handoff_alerts', v_count);

  DELETE FROM customer_memory WHERE customer_id = v_customer_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('customer_memory', v_count);

  DELETE FROM whatsapp_message_buffer WHERE customer_id = v_customer_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('whatsapp_message_buffer', v_count);

  IF v_phone_digits IS NOT NULL THEN
    DELETE FROM whatsapp_message_buffer
      WHERE regexp_replace(coalesce(phone,''), '\D', '', 'g') = v_phone_digits;
    GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('whatsapp_message_buffer_by_phone', v_count);
  END IF;

  DELETE FROM worker_phase_logs WHERE customer_id = v_customer_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('worker_phase_logs', v_count);

  DELETE FROM facebook_capi_events WHERE customer_id = v_customer_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('facebook_capi_events', v_count);

  DELETE FROM crm_deals WHERE customer_id = v_customer_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('crm_deals', v_count);

  IF v_remote_jid IS NOT NULL THEN
    DELETE FROM crm_deals WHERE consultant_id = _consultant_id AND remote_jid = v_remote_jid;
    GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('crm_deals_by_jid', v_count);

    DELETE FROM scheduled_messages WHERE remote_jid = v_remote_jid;
    GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('scheduled_messages', v_count);

    DELETE FROM crm_auto_message_log WHERE remote_jid = v_remote_jid;
    GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('crm_auto_message_log', v_count);
  END IF;

  DELETE FROM customer_flow_state WHERE customer_id = v_customer_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('customer_flow_state', v_count);

  BEGIN
    DELETE FROM customers WHERE id = v_customer_id;
    GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('customers', v_count);
  EXCEPTION WHEN OTHERS THEN
    -- FK/trigger impediu o DELETE. Tudo bem: o UPDATE defensivo acima já
    -- destravou o lead, então o bot recomeça do zero mesmo assim.
    v_deleted := v_deleted || jsonb_build_object('customers_delete_error', SQLERRM);
  END;

  RETURN jsonb_build_object('ok', true, 'customer_id', v_customer_id, 'deleted', v_deleted);
END;
$function$;