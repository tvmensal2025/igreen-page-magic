-- A: cadastro público de consultor (policy anon INSERT já existe; faltava o GRANT)
GRANT INSERT ON public.consultants TO anon;

-- B: remover acesso anônimo à view de status de audiência do Facebook
REVOKE ALL ON public.platform_facebook_audience_status FROM anon;
GRANT SELECT ON public.platform_facebook_audience_status TO authenticated;
GRANT ALL ON public.platform_facebook_audience_status TO service_role;