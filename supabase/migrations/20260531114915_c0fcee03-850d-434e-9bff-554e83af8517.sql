DO $$
DECLARE
  keep_id uuid := '0c2711ad-4836-41e6-afba-edd94f698ae3';
  keep_txt text := '0c2711ad-4836-41e6-afba-edd94f698ae3';
  tbl text;
  tables_to_clean text[] := ARRAY[
    'bot_step_transitions','bot_handoff_alerts','bot_flow_audit_log',
    'ai_agent_logs','ai_slot_dispatch_log','ai_usage_log','crm_auto_message_log',
    'outbound_message_log','facebook_capi_events','crm_page_events','capture_field_events',
    'storage_migration_log','inbound_media_failures','inbound_media_retry',
    'ai_media_library','ai_agent_config','ai_agent_slots','consultant_ad_settings',
    'scheduled_messages','stage_auto_messages','force_bot_phones','bot_test_runs',
    'bot_test_outbound','page_events','page_views','capture_diagnostics',
    'ad_spend_daily','ad_account_managers','ai_costs','rollout_audit','rollout_alerts',
    'referral_partners','production_health_snapshot','flow_router_rules'
  ];
  cnt int;
BEGIN
  FOREACH tbl IN ARRAY tables_to_clean LOOP
    BEGIN
      -- cast ambos lados para text — funciona pra uuid e pra text
      EXECUTE format('DELETE FROM public.%I WHERE consultant_id IS NOT NULL AND consultant_id::text <> $1', tbl)
        USING keep_txt;
      GET DIAGNOSTICS cnt = ROW_COUNT;
      IF cnt > 0 THEN RAISE NOTICE '% : %', tbl, cnt; END IF;
    EXCEPTION 
      WHEN undefined_column OR undefined_table THEN RAISE NOTICE 'pulado %', tbl;
      WHEN OTHERS THEN RAISE NOTICE 'erro % em %: %', SQLSTATE, tbl, SQLERRM;
    END;
  END LOOP;

  BEGIN
    DELETE FROM public.engine_logs WHERE payload->>'consultant_id' IS NOT NULL AND payload->>'consultant_id' <> keep_txt;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- conversations e customer_flow_state via customers
  BEGIN
    DELETE FROM public.conversations 
     WHERE customer_id IN (SELECT id FROM public.customers WHERE 
       (consultant_id IS NULL OR consultant_id <> keep_id) OR
       (assigned_consultant_id IS NOT NULL AND assigned_consultant_id <> keep_id));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    DELETE FROM public.customer_flow_state 
     WHERE customer_id IN (SELECT id FROM public.customers WHERE 
       (consultant_id IS NULL OR consultant_id <> keep_id) OR
       (assigned_consultant_id IS NOT NULL AND assigned_consultant_id <> keep_id));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- caches transientes
  BEGIN DELETE FROM public.webhook_message_dedup; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM public.whatsapp_message_buffer; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM public.pending_outbound_media; EXCEPTION WHEN OTHERS THEN NULL; END;

  -- customers
  DELETE FROM public.customers 
   WHERE (consultant_id IS NULL OR consultant_id <> keep_id)
      OR (assigned_consultant_id IS NOT NULL AND assigned_consultant_id <> keep_id)
      OR (customer_referred_by_consultant_id IS NOT NULL AND customer_referred_by_consultant_id <> keep_id);
  GET DIAGNOSTICS cnt = ROW_COUNT; RAISE NOTICE 'customers: %', cnt;

  -- whatsapp instances
  BEGIN DELETE FROM public.whatsapp_instances WHERE consultant_id <> keep_id; EXCEPTION WHEN OTHERS THEN NULL; END;

  -- bot flows
  BEGIN DELETE FROM public.bot_flow_steps WHERE flow_id IN (SELECT id FROM public.bot_flows WHERE consultant_id <> keep_id); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM public.bot_flow_qa WHERE flow_id IN (SELECT id FROM public.bot_flows WHERE consultant_id <> keep_id); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM public.bot_flows WHERE consultant_id <> keep_id; EXCEPTION WHEN OTHERS THEN NULL; END;

  -- refs NO ACTION
  BEGIN
    UPDATE public.customers SET customer_referred_by_consultant_id = NULL 
     WHERE customer_referred_by_consultant_id IS NOT NULL AND customer_referred_by_consultant_id <> keep_id;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- user_roles dos testes
  BEGIN DELETE FROM public.user_roles WHERE user_id IN (SELECT id FROM public.consultants WHERE id <> keep_id); EXCEPTION WHEN OTHERS THEN NULL; END;

  -- finalmente consultores
  DELETE FROM public.consultants WHERE id <> keep_id;
  GET DIAGNOSTICS cnt = ROW_COUNT; RAISE NOTICE 'CONSULTORES: %', cnt;
END $$;

SELECT 
  (SELECT count(*) FROM consultants) AS consultores,
  (SELECT count(*) FROM customers) AS customers,
  (SELECT count(*) FROM conversations) AS conversations,
  (SELECT count(*) FROM whatsapp_instances) AS whatsapp_instances,
  (SELECT count(*) FROM bot_flows) AS bot_flows;