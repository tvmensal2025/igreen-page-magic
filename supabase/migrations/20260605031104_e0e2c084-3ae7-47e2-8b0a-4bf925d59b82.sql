CREATE OR REPLACE FUNCTION public.admin_hard_reset_phone_trace_counts(_phone text)
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
  v_customer_ids uuid[];
  v_counts jsonb := '{}'::jsonb;
  v_count int;
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
    v_digits,
    v_norm,
    v_local,
    '+' || v_norm,
    '0' || v_local
  ]) AS x WHERE x IS NOT NULL AND length(x) > 0);

  v_jid_variants := ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[
    v_norm || '@s.whatsapp.net',
    v_norm || '@c.us',
    v_norm || '@lid',
    v_local || '@s.whatsapp.net',
    v_local || '@c.us',
    v_local || '@lid'
  ]) AS x WHERE x IS NOT NULL AND length(x) > 0);

  SELECT array_agg(DISTINCT id) INTO v_customer_ids
  FROM customers
  WHERE regexp_replace(coalesce(phone_whatsapp,''), '\D', '', 'g') = ANY(v_variants)
     OR regexp_replace(coalesce(phone_landline,''), '\D', '', 'g') = ANY(v_variants)
     OR regexp_replace(coalesce(customer_referred_by_phone,''), '\D', '', 'g') = ANY(v_variants)
     OR regexp_replace(coalesce(otp_test_phone,''), '\D', '', 'g') = ANY(v_variants);
  IF v_customer_ids IS NULL THEN v_customer_ids := ARRAY[]::uuid[]; END IF;

  SELECT count(*) INTO v_count FROM customers WHERE id = ANY(v_customer_ids)
     OR regexp_replace(coalesce(phone_whatsapp,''), '\D', '', 'g') = ANY(v_variants)
     OR regexp_replace(coalesce(phone_landline,''), '\D', '', 'g') = ANY(v_variants)
     OR regexp_replace(coalesce(customer_referred_by_phone,''), '\D', '', 'g') = ANY(v_variants)
     OR regexp_replace(coalesce(otp_test_phone,''), '\D', '', 'g') = ANY(v_variants);
  v_counts := v_counts || jsonb_build_object('customers', v_count);

  SELECT count(*) INTO v_count FROM conversations WHERE customer_id = ANY(v_customer_ids);
  v_counts := v_counts || jsonb_build_object('conversations', v_count);

  SELECT count(*) INTO v_count FROM ai_agent_logs WHERE customer_id = ANY(v_customer_ids) OR regexp_replace(coalesce(phone,''), '\D', '', 'g') = ANY(v_variants);
  v_counts := v_counts || jsonb_build_object('ai_agent_logs', v_count);

  SELECT count(*) INTO v_count FROM bot_handoff_alerts WHERE customer_id = ANY(v_customer_ids) OR regexp_replace(coalesce(phone,''), '\D', '', 'g') = ANY(v_variants);
  v_counts := v_counts || jsonb_build_object('bot_handoff_alerts', v_count);

  SELECT count(*) INTO v_count FROM bot_step_transitions WHERE customer_id = ANY(v_customer_ids) OR regexp_replace(coalesce(phone,''), '\D', '', 'g') = ANY(v_variants);
  v_counts := v_counts || jsonb_build_object('bot_step_transitions', v_count);

  SELECT count(*) INTO v_count FROM crm_deals WHERE customer_id = ANY(v_customer_ids) OR remote_jid = ANY(v_jid_variants) OR regexp_replace(coalesce(remote_jid,''), '\D', '', 'g') = ANY(v_variants);
  v_counts := v_counts || jsonb_build_object('crm_deals', v_count);

  SELECT count(*) INTO v_count FROM whatsapp_message_buffer WHERE customer_id = ANY(v_customer_ids) OR regexp_replace(coalesce(phone,''), '\D', '', 'g') = ANY(v_variants) OR remote_jid = ANY(v_jid_variants) OR regexp_replace(coalesce(remote_jid,''), '\D', '', 'g') = ANY(v_variants);
  v_counts := v_counts || jsonb_build_object('whatsapp_message_buffer', v_count);

  SELECT count(*) INTO v_count FROM scheduled_messages WHERE remote_jid = ANY(v_jid_variants) OR regexp_replace(coalesce(remote_jid,''), '\D', '', 'g') = ANY(v_variants);
  v_counts := v_counts || jsonb_build_object('scheduled_messages', v_count);

  SELECT count(*) INTO v_count FROM customer_tags WHERE remote_jid = ANY(v_jid_variants) OR regexp_replace(coalesce(remote_jid,''), '\D', '', 'g') = ANY(v_variants);
  v_counts := v_counts || jsonb_build_object('customer_tags', v_count);

  SELECT count(*) INTO v_count FROM crm_auto_message_log WHERE remote_jid = ANY(v_jid_variants) OR regexp_replace(coalesce(remote_jid,''), '\D', '', 'g') = ANY(v_variants);
  v_counts := v_counts || jsonb_build_object('crm_auto_message_log', v_count);

  SELECT count(*) INTO v_count FROM webhook_rate_limit WHERE regexp_replace(coalesce(phone,''), '\D', '', 'g') = ANY(v_variants);
  v_counts := v_counts || jsonb_build_object('webhook_rate_limit', v_count);

  SELECT count(*) INTO v_count FROM ai_cooldown_state WHERE cooldown_key ILIKE '%' || v_local || '%' OR cooldown_key ILIKE '%' || v_norm || '%';
  v_counts := v_counts || jsonb_build_object('ai_cooldown_state', v_count);

  SELECT count(*) INTO v_count FROM force_bot_phones WHERE regexp_replace(coalesce(phone_digits,''), '\D', '', 'g') = ANY(v_variants);
  v_counts := v_counts || jsonb_build_object('force_bot_phones', v_count);

  SELECT count(*) INTO v_count FROM storage_migration_log WHERE customer_jid = ANY(v_jid_variants) OR regexp_replace(coalesce(customer_jid,''), '\D', '', 'g') = ANY(v_variants);
  v_counts := v_counts || jsonb_build_object('storage_migration_log', v_count);

  RETURN jsonb_build_object(
    'phone_normalized', v_norm,
    'phone_local', v_local,
    'variants', to_jsonb(v_variants),
    'remote_jids', to_jsonb(v_jid_variants),
    'customer_ids', to_jsonb(v_customer_ids),
    'counts', v_counts
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_hard_reset_phone_trace_counts(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_hard_reset_phone_trace_counts(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_hard_reset_phone_trace_counts(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_hard_reset_phone_trace_counts(text) TO service_role;