-- 1) ai_knowledge_sections: remover SELECT público
-- Admins continuam podendo gerenciar via policy "Admins manage knowledge"
-- Edge functions usam service_role (bypass RLS)
DROP POLICY IF EXISTS "Public read knowledge" ON public.ai_knowledge_sections;
REVOKE SELECT ON public.ai_knowledge_sections FROM anon;

-- 2) app_settings: restringir SELECT a super admins apenas
-- Edge functions usam service_role; frontend só consome via páginas superadmin.
DROP POLICY IF EXISTS app_settings_read_public_flags ON public.app_settings;
-- app_settings_read_super_admin já existe e cobre leitura de super admins.