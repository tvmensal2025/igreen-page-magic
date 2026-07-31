DROP POLICY IF EXISTS "Service role manages igreen accounts" ON public.igreen_portal_accounts;

REVOKE ALL ON public.igreen_portal_accounts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.igreen_portal_accounts TO authenticated;
GRANT ALL ON public.igreen_portal_accounts TO service_role;