-- Rafael (superadmin Whapi): leads legados origin=evolution com Evolution
-- needs_reconnect quebram faq/pós-venda sem failover. Realinha para Whapi.
UPDATE public.customers c
SET
  origin_channel = 'whapi',
  origin_instance_name = 'whapi-superadmin',
  origin_consultant_id = COALESCE(c.origin_consultant_id, c.consultant_id),
  updated_at = now()
FROM public.settings s
WHERE s.key = 'superadmin_consultant_id'
  AND trim(both '"' from s.value::text) = c.consultant_id::text
  AND c.origin_channel = 'evolution';
