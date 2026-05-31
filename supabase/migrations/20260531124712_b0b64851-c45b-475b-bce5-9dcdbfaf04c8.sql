-- Auditoria 2026-05-31: corrigir views SECURITY DEFINER e RLS faltando

-- 1) Converte views para SECURITY INVOKER (rodam com permissão de quem consulta, respeita RLS)
ALTER VIEW public.v_flow_engine_health SET (security_invoker = on);
ALTER VIEW public.whatsapp_instances_public SET (security_invoker = on);
ALTER VIEW public.v_bot_engine_health SET (security_invoker = on);
ALTER VIEW public.v_ai_agent_health SET (security_invoker = on);
ALTER VIEW public.customer_memory_active SET (security_invoker = on);

-- 2) RLS sem policy em _deleted_customers_backup → restringir a super_admin
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='_deleted_customers_backup') THEN
    EXECUTE 'REVOKE ALL ON public._deleted_customers_backup FROM anon, authenticated';
    EXECUTE 'GRANT ALL ON public._deleted_customers_backup TO service_role';
    EXECUTE $p$DROP POLICY IF EXISTS "super_admin_full_access" ON public._deleted_customers_backup$p$;
    EXECUTE $p$CREATE POLICY "super_admin_full_access" ON public._deleted_customers_backup FOR ALL TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()))$p$;
  END IF;
END$$;