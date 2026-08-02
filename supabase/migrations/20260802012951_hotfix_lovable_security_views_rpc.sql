-- Hotfix pós-Lovable (2026-08-02): restaura exceções documentadas + fecha P0.
-- Evidência:
-- 1) 20260801220949 forçou security_invoker=true em TODAS as views, inclusive
--    consultants_public e platform_facebook_audience_status (exceções DEFINER).
--    Context7/Supabase: security_invoker=true faz a view obedecer RLS da base.
--    platform_facebook_account só tem policy admin → consultor comum lê 0 linhas
--    em platform_facebook_audience_status (MetaAudiencePanel quebrado).
-- 2) cleanup_customer_duplicates / audit_duplicate_leads_in_cadence nasceram com
--    EXECUTE para anon (default PUBLIC) — DNC em massa / vazamento de nomes.
-- 3) Índice uq_lead_cadence_state_customer é redundante com
--    lead_cadence_state_customer_id_key (já único em customer_id).

-- 1) Restaurar DEFINER intencional nas 2 views públicas/Ads
ALTER VIEW public.consultants_public SET (security_invoker = false);
ALTER VIEW public.platform_facebook_audience_status SET (security_invoker = false);

COMMENT ON VIEW public.consultants_public IS
  'LP pública via RPC get_public_consultant. SECURITY DEFINER intencional (invoker=off). Lint 0010 = exceção documentada. Restaurado 2026-08-02.';
COMMENT ON VIEW public.platform_facebook_audience_status IS
  'Status audience sem token. SECURITY DEFINER intencional (consultor autenticado lê sem ser admin da tabela base). Restaurado 2026-08-02.';

-- 2) Fechar P0: RPCs destrutivas / de auditoria global só service_role
REVOKE ALL ON FUNCTION public.cleanup_customer_duplicates(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_customer_duplicates(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.cleanup_customer_duplicates(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_customer_duplicates(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.audit_duplicate_leads_in_cadence() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_duplicate_leads_in_cadence() FROM anon;
REVOKE ALL ON FUNCTION public.audit_duplicate_leads_in_cadence() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.audit_duplicate_leads_in_cadence() TO service_role;

-- 3) Remover índice único duplicado (mantém lead_cadence_state_customer_id_key)
DROP INDEX IF EXISTS public.uq_lead_cadence_state_customer;
