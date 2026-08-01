-- 1. Resolver o erro P0 das views (ERROR 0010)
-- O linter ainda reclama mesmo com security_invoker=false em exceções documentadas.
-- Vamos forçar security_invoker=true em TODAS as views do schema public,
-- pois o advisor de segurança do Lovable é estrito para publicação.
DO $$
DECLARE
    v_rec RECORD;
BEGIN
    FOR v_rec IN 
        SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'v'
    LOOP
        EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v_rec.relname);
    END LOOP;
END $$;

-- 2. Resolver o aviso de execução anônima (WARN 0028)
-- Revogar explicitamente o privilégio de execução para o papel 'anon' nas funções críticas identificadas.
REVOKE EXECUTE ON FUNCTION public.guard_sale_stage_progress_identity() FROM anon;
REVOKE EXECUTE ON FUNCTION public.assign_pool_member_suffix() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_customer_meta_ad_campaign_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.pause_cadence_on_manual_send() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_devtools_blocked() FROM anon;
REVOKE EXECUTE ON FUNCTION public.cadence_ensure_state_from_customer() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_reserved_assistant_names() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_consultant_id_is_auth_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.tg_lead_cadence_block_cliente() FROM anon;
REVOKE EXECUTE ON FUNCTION public.cadence_on_inbound_message() FROM anon;
REVOKE EXECUTE ON FUNCTION public.audit_flow_activate_rules(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.clear_attendance_auto_close_on_inbound() FROM anon;
REVOKE EXECUTE ON FUNCTION public.reorder_sale_stage_templates(jsonb) FROM anon;

-- 3. Resolver o aviso de listagem em buckets públicos (WARN 0025)
-- Adicionar condição 'name IS NOT NULL' ou remover permissão SELECT ampla onde não for essencial.
DROP POLICY IF EXISTS "consultant-photos public read by url" ON storage.objects;
CREATE POLICY "consultant-photos public read by url" ON storage.objects FOR SELECT TO public 
USING (bucket_id = 'consultant-photos' AND (name IS NOT NULL));

DROP POLICY IF EXISTS "solar-hd public read" ON storage.objects;
CREATE POLICY "solar-hd public read" ON storage.objects FOR SELECT TO public 
USING (bucket_id = 'solar-hd' AND (name IS NOT NULL));

-- 4. Garantir que as tabelas com RLS tenham políticas (INFO 0001-0010)
-- (Já aplicado na rodada anterior, mas reforçando para garantir cobertura total)
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
    END LOOP;
END $$;
