-- Destrava leitura anônima das superfícies públicas de consultor.
-- Views usam security_invoker=on, então anon precisa de SELECT no base + policy.

-- 1) consultants_public + colunas expostas em consultants
GRANT SELECT ON public.consultants_public TO anon, authenticated;
GRANT SELECT (id, license, name, phone, cadastro_url, photo_url, igreen_id,
              licenciada_cadastro_url, facebook_pixel_id, google_analytics_id,
              created_at, referred_by)
  ON public.consultants TO anon;
GRANT SELECT ON public.consultants TO authenticated;

DROP POLICY IF EXISTS "Anon read public consultant fields" ON public.consultants;
CREATE POLICY "Anon read public consultant fields"
  ON public.consultants FOR SELECT TO anon
  USING (license IS NOT NULL AND license <> '');

-- 2) whatsapp_instances_public (colunas: consultant_id, instance_name, connected_phone)
GRANT SELECT ON public.whatsapp_instances_public TO anon, authenticated;
GRANT SELECT (consultant_id, instance_name, connected_phone)
  ON public.whatsapp_instances TO anon;

DROP POLICY IF EXISTS "Anon read connected instances" ON public.whatsapp_instances;
CREATE POLICY "Anon read connected instances"
  ON public.whatsapp_instances FOR SELECT TO anon
  USING (connected_phone IS NOT NULL);

-- 3) products — grant explicito (policy anon já existe)
GRANT SELECT ON public.products TO anon, authenticated;

-- 4) page_views — grant insert (policy anon já existe)
GRANT INSERT ON public.page_views TO anon, authenticated;