ALTER VIEW public.consultants_public SET (security_invoker = off);
GRANT SELECT ON public.consultants_public TO anon, authenticated;