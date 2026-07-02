
DROP POLICY IF EXISTS "Authenticated read public knowledge" ON public.ai_knowledge_sections;
CREATE POLICY "Authenticated read public knowledge"
ON public.ai_knowledge_sections
FOR SELECT
TO authenticated
USING (
  (consultant_id = auth.uid())
  OR (consultant_id IS NULL AND is_active = true)
);

DROP POLICY IF EXISTS "Public read audio templates" ON public.message_templates;

ALTER VIEW public.consultants_public SET (security_invoker = on);

ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.funnel_step_rank(text) SET search_path = public;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
    WHERE n.nspname = 'public' AND p.prosecdef = true AND d.objid IS NULL
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "whatsapp-media public read by url" ON storage.objects;
