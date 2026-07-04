-- Anon precisa executar has_role() porque policy "Anyone reads active products" a chama.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO anon;