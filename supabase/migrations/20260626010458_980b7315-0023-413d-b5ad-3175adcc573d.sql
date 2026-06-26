DROP VIEW IF EXISTS public.whatsapp_instances_public;

CREATE VIEW public.whatsapp_instances_public
WITH (security_invoker=on) AS
SELECT
  consultant_id,
  instance_name,
  connected_phone
FROM public.whatsapp_instances
WHERE connected_phone IS NOT NULL;

GRANT SELECT ON public.whatsapp_instances_public TO anon, authenticated;