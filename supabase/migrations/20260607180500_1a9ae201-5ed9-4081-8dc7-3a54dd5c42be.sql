CREATE OR REPLACE FUNCTION public.admin_hard_reset_phone(_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_digits text;
  v_local text;
  v_norm text;
  v_variants text[];
  v_jid_variants text[];
  v_ids uuid[];
  v_id_texts text[];
  v_consultant_ids uuid[];
  v_count int;
  v_deleted jsonb := '{}'::jsonb;
  v_quarantine_seconds int := 60;
  v_quarantine_until timestamptz;
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
  v_local := CASE WHEN v_digits LIKE '55%' THEN substring(v_digits from 3) ELSE v_digits END;

  v_variants := ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[
    v_digits, v_norm, v_local, '+' || v_norm, '0' || v_local
  ]) AS x WHERE x IS NOT NULL AND length(x) > 0);

  v_jid_variants := ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[
    v_norm  || '@s.whatsapp.net', v_norm  || '@c.us', v_norm  || '@lid',
    v_local || '@s.whatsapp.net', v_local || '@c.us', v_local || '@lid'
  ]) AS x WHERE x IS NOT NULL AND length(x) > 0);

  RAISE LOG 'admin_hard_reset_phone start phone=% digits=% variants=% jids=%', _phone, v_digits, v_variants, v_jid_variants;

  SELECT array_agg(DISTINCT id) INTO v_ids FROM (
    SELECT id FROM customers
     WHERE regexp_replace(coalesce(phone_whatsapp,''), '\D', '', 'g') = ANY(v_variants)
        OR regexp_replace(coalesce(phone_landline,''), '\D', '', 'g') = ANY(v_variants)
        OR regexp_replace(coalesce(customer_referred_by_phone,''), '\D', '', 'g') = ANY(v_variants)
        OR regexp_replace(coalesce(otp_test_phone,''), '\D', '', 'g') = ANY(v_variants)
    UNION
    SELECT customer_id AS id FROM bot_step_transitions
     WHERE regexp_replace(coalesce(phone,''), '\D', '', 'g') = ANY(v_variants) AND customer_id IS NOT NULL
    UNION
    SELECT customer_id AS id FROM ai_agent_logs
     WHERE regexp_replace(coalesce(phone,''), '\D', '', 'g') = ANY(v_variants) AND customer_id IS NOT NULL
    UNION
    SELECT customer_id AS id FROM bot_handoff_alerts
     WHERE regexp_replace(coalesce(phone,''), '\D', '', 'g') = ANY(v_variants) AND customer_id IS NOT NULL
    UNION
    SELECT customer_id AS id FROM crm_deals
     WHERE (remote_jid = ANY(v_jid_variants) OR regexp_replace(coalesce(remote_jid,''), '\D', '', 'g') = ANY(v_variants))
       AND customer_id IS NOT NULL
  ) s;
  IF v_ids IS NULL THEN v_ids := ARRAY[]::uuid[]; END IF;
  SELECT array_agg(x::text) INTO v_id_texts FROM unnest(v_ids) AS x;
  IF v_id_texts IS NULL THEN v_id_texts := ARRAY[]::text[]; END IF;

  SELECT array_agg(DISTINCT consultant_id) INTO v_consultant_ids
    FROM customers WHERE id = ANY(v_ids) AND consultant_id IS NOT NULL;
  IF v_consultant_ids IS NULL THEN v_consultant_ids := ARRAY[]::uuid[]; END IF;

  DELETE FROM customer_flow_state WHERE customer_id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('customer_flow_state', v_count);

  DELETE FROM customer_memory WHERE customer_id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('customer_memory', v_count);

  DELETE FROM customer_processing_lock WHERE customer_id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('customer_processing_lock', v_count);

  DELETE FROM whatsapp_message_buffer
   WHERE customer_id = ANY(v_ids)
      OR regexp_replace(coalesce(phone,''), '\D', '', 'g') = ANY(v_variants)
      OR remote_jid = ANY(v_jid_variants)
      OR regexp_replace(coalesce(remote_jid,''), '\D', '', 'g') = ANY(v_variants);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('whatsapp_message_buffer', v_count);

  DELETE FROM conversations WHERE customer_id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('conversations', v_count);

  DELETE FROM ai_slot_dispatch_log WHERE customer_id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('ai_slot_dispatch_log', v_count);

  DELETE FROM ai_decisions WHERE customer_id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('ai_decisions', v_count);

  DELETE FROM ai_agent_logs
   WHERE customer_id = ANY(v_ids)
      OR regexp_replace(coalesce(phone,''), '\D', '', 'g') = ANY(v_variants);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('ai_agent_logs', v_count);

  DELETE FROM bot_step_transitions
   WHERE customer_id = ANY(v_ids)
      OR regexp_replace(coalesce(phone,''), '\D', '', 'g') = ANY(v_variants);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('bot_step_transitions', v_count);

  DELETE FROM bot_handoff_alerts
   WHERE customer_id = ANY(v_ids)
      OR regexp_replace(coalesce(phone,''), '\D', '', 'g') = ANY(v_variants);
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

  DELETE FROM scheduled_messages
   WHERE remote_jid = ANY(v_jid_variants)
      OR regexp_replace(coalesce(remote_jid,''), '\D', '', 'g') = ANY(v_variants);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('scheduled_messages', v_count);

  DELETE FROM crm_auto_message_log
   WHERE remote_jid = ANY(v_jid_variants)
      OR regexp_replace(coalesce(remote_jid,''), '\D', '', 'g') = ANY(v_variants);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('crm_auto_message_log', v_count);

  DELETE FROM customer_tags
   WHERE remote_jid = ANY(v_jid_variants)
      OR regexp_replace(coalesce(remote_jid,''), '\D', '', 'g') = ANY(v_variants);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('customer_tags', v_count);

  DELETE FROM crm_deals
   WHERE customer_id = ANY(v_ids)
      OR remote_jid = ANY(v_jid_variants)
      OR regexp_replace(coalesce(remote_jid,''), '\D', '', 'g') = ANY(v_variants);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('crm_deals', v_count);

  DELETE FROM force_bot_phones WHERE regexp_replace(coalesce(phone_digits,''), '\D', '', 'g') = ANY(v_variants);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('force_bot_phones', v_count);

  DELETE FROM webhook_rate_limit WHERE regexp_replace(coalesce(phone,''), '\D', '', 'g') = ANY(v_variants);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('webhook_rate_limit', v_count);

  DELETE FROM ai_cooldown_state
   WHERE cooldown_key ILIKE '%' || v_local || '%'
      OR cooldown_key ILIKE '%' || v_norm  || '%';
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('ai_cooldown_state', v_count);

  DELETE FROM storage_migration_log
   WHERE customer_jid = ANY(v_jid_variants)
      OR regexp_replace(coalesce(customer_jid,''), '\D', '', 'g') = ANY(v_variants);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('storage_migration_log', v_count);

  BEGIN
    DELETE FROM bot_flow_rule_fires WHERE customer_id = ANY(v_ids);
    GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('bot_flow_rule_fires', v_count);
  EXCEPTION WHEN undefined_table OR undefined_column THEN v_deleted := v_deleted || jsonb_build_object('bot_flow_rule_fires', 0);
  END;

  BEGIN
    DELETE FROM campaign_match_log WHERE customer_id = ANY(v_ids);
    GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('campaign_match_log', v_count);
  EXCEPTION WHEN undefined_table OR undefined_column THEN v_deleted := v_deleted || jsonb_build_object('campaign_match_log', 0);
  END;

  BEGIN
    DELETE FROM capture_achievements
     WHERE metadata->>'customer_id' = ANY(v_id_texts)
        OR metadata->>'customerId' = ANY(v_id_texts)
        OR regexp_replace(coalesce(metadata->>'phone',''), '\D', '', 'g') = ANY(v_variants)
        OR regexp_replace(coalesce(metadata->>'phone_whatsapp',''), '\D', '', 'g') = ANY(v_variants);
    GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('capture_achievements', v_count);
  EXCEPTION WHEN undefined_table OR undefined_column THEN v_deleted := v_deleted || jsonb_build_object('capture_achievements', 0);
  END;

  BEGIN
    DELETE FROM referral_bonuses
     WHERE referrer_customer_id = ANY(v_ids) OR referred_customer_id = ANY(v_ids);
    GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('referral_bonuses', v_count);
  EXCEPTION WHEN undefined_table OR undefined_column THEN v_deleted := v_deleted || jsonb_build_object('referral_bonuses', 0);
  END;

  DELETE FROM customers WHERE id = ANY(v_ids)
     OR regexp_replace(coalesce(phone_whatsapp,''), '\D', '', 'g') = ANY(v_variants)
     OR regexp_replace(coalesce(phone_landline,''), '\D', '', 'g') = ANY(v_variants)
     OR regexp_replace(coalesce(customer_referred_by_phone,''), '\D', '', 'g') = ANY(v_variants)
     OR regexp_replace(coalesce(otp_test_phone,''), '\D', '', 'g') = ANY(v_variants);
  GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('customers', v_count);

  IF array_length(v_consultant_ids, 1) > 0 THEN
    DELETE FROM public.instance_send_counters
     WHERE day = (now() AT TIME ZONE 'UTC')::date
       AND instance_name IN (
         SELECT wi.instance_name FROM public.whatsapp_instances wi
          WHERE wi.consultant_id = ANY(v_consultant_ids)
       );
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object('instance_send_counters_today', v_count);
  ELSE
    v_deleted := v_deleted || jsonb_build_object('instance_send_counters_today', 0);
  END IF;

  v_quarantine_until := now() + make_interval(secs => v_quarantine_seconds);
  INSERT INTO public.phone_reset_quarantine (phone_digits, reset_at, quarantine_until, created_by)
    VALUES (v_norm, now(), v_quarantine_until, auth.uid())
  ON CONFLICT (phone_digits) DO UPDATE
    SET reset_at = EXCLUDED.reset_at,
        quarantine_until = EXCLUDED.quarantine_until,
        created_by = EXCLUDED.created_by;

  IF v_local <> v_norm THEN
    INSERT INTO public.phone_reset_quarantine (phone_digits, reset_at, quarantine_until, created_by)
      VALUES (v_local, now(), v_quarantine_until, auth.uid())
    ON CONFLICT (phone_digits) DO UPDATE
      SET reset_at = EXCLUDED.reset_at,
          quarantine_until = EXCLUDED.quarantine_until,
          created_by = EXCLUDED.created_by;
  END IF;

  BEGIN
    PERFORM public.log_admin_action(
      'admin_hard_reset_phone', 'phone', v_norm,
      jsonb_build_object(
        'deleted', v_deleted,
        'variants', v_variants,
        'customer_ids', v_ids,
        'consultant_ids', v_consultant_ids,
        'quarantine_until', v_quarantine_until
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'admin_hard_reset_phone audit log skipped: %', SQLERRM;
  END;

  RAISE LOG 'admin_hard_reset_phone done phone=% deleted=% quarantine_until=%', v_norm, v_deleted, v_quarantine_until;

  RETURN jsonb_build_object(
    'ok', true,
    'phone_digits', v_digits,
    'phone_local', v_local,
    'phone_normalized', v_norm,
    'variants', to_jsonb(v_variants),
    'remote_jids', to_jsonb(v_jid_variants),
    'customer_ids', to_jsonb(v_ids),
    'consultant_ids', to_jsonb(v_consultant_ids),
    'deleted', v_deleted,
    'quarantine_until', v_quarantine_until,
    'quarantine_seconds', v_quarantine_seconds
  );
END;
$function$;