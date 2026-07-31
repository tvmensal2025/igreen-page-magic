DROP POLICY IF EXISTS "Anon read public consultant fields" ON public.consultants;
REVOKE SELECT ON public.consultants FROM anon;