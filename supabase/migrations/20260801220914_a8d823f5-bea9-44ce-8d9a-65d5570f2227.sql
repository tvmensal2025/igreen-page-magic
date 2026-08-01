-- 1. Forçar security_invoker em views do schema public (exceto exceções documentadas)
DO $$
DECLARE
    v_rec RECORD;
BEGIN
    FOR v_rec IN 
        SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'v'
        AND relname NOT IN ('consultants_public', 'platform_facebook_audience_status')
    LOOP
        EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v_rec.relname);
    END LOOP;
END $$;

-- 2. Garantir search_path em TODAS as funções SECURITY DEFINER no schema public (usando OID para desambiguação)
DO $$
DECLARE
    v_rec RECORD;
BEGIN
    FOR v_rec IN 
        SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
        FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.prosecdef = true
    LOOP
        EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = public', v_rec.proname, v_rec.args);
    END LOOP;
END $$;

-- 3. Políticas de segurança para tabelas com RLS habilitado mas sem políticas
DO $$
DECLARE
    v_tab RECORD;
BEGIN
    FOR v_tab IN 
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true
        AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
    LOOP
        EXECUTE format('CREATE POLICY "Admins can do everything" ON public.%I FOR ALL TO authenticated USING (has_role(auth.uid(), ''admin''))', v_tab.relname);
        EXECUTE format('GRANT ALL ON public.%I TO authenticated, service_role', v_tab.relname);
    END LOOP;
END $$;

-- 4. Revogar listagem anônima em buckets públicos
DROP POLICY IF EXISTS "consultant-photos auth list" ON storage.objects;
CREATE POLICY "consultant-photos auth list" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'consultant-photos');
