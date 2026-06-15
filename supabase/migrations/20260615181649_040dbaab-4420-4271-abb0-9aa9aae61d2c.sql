UPDATE public.customer_flow_state
SET status = 'ativo', pause_reason = NULL, updated_at = now()
WHERE pause_reason = 'empty_flow'
  AND status = 'paused_system'
  AND customer_id IN (SELECT id FROM public.customers WHERE upper(coalesce(flow_variant,'A')) = 'B');