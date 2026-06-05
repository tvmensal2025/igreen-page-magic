CREATE OR REPLACE FUNCTION public.admin_hard_reset_phone(_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits text;
  v_norm   text;
  v_jid    text;
  v_ids    uuid[];
  v_count  int;
  v_deleted jsonb := '{}'::jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role)
     AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  v_digits := regexp_replace(coalesce(_phone,''), '\D', '', 'g');
  IF v_digits IS NULL OR length(v_digits) < 8 THEN
    RAISE EXCEPTION 'invalid_phone';
  END IF;

  v_norm := CASE WHEN v_digits LIKE '55%' THEN v_digits ELSE '55' || v_digits END;
  v_jid  := v_norm || '@s.whatsapp.net';

  -- 1) IDs de customers atuais + IDs antigos referenciados em logs por telefone
  SELECT array_agg(DISTINCT id) INTO v_ids FROM (
    SELECT id FROM customers
     WHERE regexp_replace(coalesce(phone_whatsapp,''), '\D', '', 'g') IN (v_digits, v_norm)
        OR regexp_replace(coalesce(phone_landline,''), '\D', '', 'g') IN (v_digits, v_norm)
    UNION
    SELECT customer_id AS id FROM bot_step_transitions
     WHERE regexp_replace(coalesce(phone,''), '\D', '', 'g') IN (v_digits, v_norm)
       AND customer_id IS NOT NULL
    UNION
    SELECT customer_id AS id FROM ai_agent_logs
     WHERE regexp_replace(coalesce(phone,''), '\D', '', 'g') IN (v_digits, v_norm)
       AND customer_id IS NOT NULL
  ) s;
  IF v_ids IS NULL THEN v_ids := ARRAY[]::uuid[]; END IF;

  -- 2) Apaga por customer_id
  DELETE FROM customer_flow_state WHERE customer_id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('customer_flow_state', v_count);

  DELETE FROM customer_memory WHERE customer_id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('customer_memory', v_count);

  DELETE FROM customer_processing_lock WHERE customer_id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('customer_processing_lock', v_count);

  DELETE FROM whatsapp_message_buffer
   WHERE customer_id = ANY(v_ids)
      OR regexp_replace(coalesce(phone,''), '\D', '', 'g') IN (v_digits, v_norm)
      OR remote_jid = v_jid;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('whatsapp_message_buffer', v_count);

  DELETE FROM conversations WHERE customer_id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('conversations', v_count);

  DELETE FROM ai_slot_dispatch_log WHERE customer_id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('ai_slot_dispatch_log', v_count);

  DELETE FROM ai_decisions WHERE customer_id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('ai_decisions', v_count);

  DELETE FROM ai_agent_logs
   WHERE customer_id = ANY(v_ids)
      OR regexp_replace(coalesce(phone,''), '\D', '', 'g') IN (v_digits, v_norm);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('ai_agent_logs', v_count);

  DELETE FROM bot_step_transitions
   WHERE customer_id = ANY(v_ids)
      OR regexp_replace(coalesce(phone,''), '\D', '', 'g') IN (v_digits, v_norm);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('bot_step_transitions', v_count);

  DELETE FROM bot_handoff_alerts
   WHERE customer_id = ANY(v_ids)
      OR regexp_replace(coalesce(phone,''), '\D', '', 'g') IN (v_digits, v_norm);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('bot_handoff_alerts', v_count);

  DELETE FROM ai_usage_log WHERE customer_id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('ai_usage_log', v_count);

  DELETE FROM capture_field_events WHERE customer_id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('capture_field_events', v_count);

  DELETE FROM capture_field_suggestions WHERE customer_id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('capture_field_suggestions', v_count);

  DELETE FROM inbound_media_failures WHERE customer_id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('inbound_media_failures', v_count);

  DELETE FROM inbound_media_retry WHERE customer_id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('inbound_media_retry', v_count);

  DELETE FROM lead_insights WHERE customer_id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('lead_insights', v_count);

  DELETE FROM outbound_message_log WHERE customer_id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('outbound_message_log', v_count);

  DELETE FROM pending_outbound_media WHERE customer_id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('pending_outbound_media', v_count);

  DELETE FROM portal2_audit_traces WHERE customer_id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('portal2_audit_traces', v_count);

  DELETE FROM worker_phase_logs WHERE customer_id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('worker_phase_logs', v_count);

  DELETE FROM facebook_capi_events WHERE customer_id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('facebook_capi_events', v_count);

  DELETE FROM engine_logs WHERE customer_id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('engine_logs', v_count);

  -- 3) Apaga por remote_jid / phone
  DELETE FROM scheduled_messages WHERE remote_jid = v_jid;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('scheduled_messages', v_count);

  DELETE FROM crm_auto_message_log WHERE remote_jid = v_jid;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('crm_auto_message_log', v_count);

  DELETE FROM customer_tags WHERE remote_jid = v_jid;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('customer_tags', v_count);

  DELETE FROM crm_deals WHERE customer_id = ANY(v_ids) OR remote_jid = v_jid;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('crm_deals', v_count);

  -- 4) Tira do force_bot_phones (se houver)
  DELETE FROM force_bot_phones WHERE phone_digits IN (v_digits, v_norm);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('force_bot_phones', v_count);

  -- 5) Por fim, apaga os customers
  BEGIN
    DELETE FROM customers WHERE id = ANY(v_ids);
    GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('customers', v_count);
  EXCEPTION WHEN OTHERS THEN
    v_deleted := v_deleted || jsonb_build_object('customers_delete_error', SQLERRM);
  END;

  -- 6) Audit log
  BEGIN
    PERFORM public.log_admin_action(
      'admin_hard_reset_phone',
      'phone',
      v_norm,
      v_deleted
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'phone_digits', v_digits,
    'phone_normalized', v_norm,
    'remote_jid', v_jid,
    'customer_ids', to_jsonb(v_ids),
    'deleted', v_deleted
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_hard_reset_phone(text) TO authenticated;