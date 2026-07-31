-- 1) Consultor público por licença (exato ou prefixo único) — sem listagem em massa
CREATE OR REPLACE FUNCTION public.get_public_consultant(_license text)
RETURNS SETOF public.consultants_public
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_license text := lower(btrim(coalesce(_license, '')));
  v_count int;
BEGIN
  IF v_license = '' OR length(v_license) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT * FROM public.consultants_public c
  WHERE lower(c.license) = v_license
  LIMIT 1;
  IF FOUND THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.consultants_public c
  WHERE lower(c.license) LIKE v_license || '-%';

  IF v_count = 1 THEN
    RETURN QUERY
    SELECT * FROM public.consultants_public c
    WHERE lower(c.license) LIKE v_license || '-%'
    LIMIT 1;
  END IF;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_consultant(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_consultant(text) TO anon, authenticated, service_role;

-- 2) Telefone da instancia WhatsApp de UM consultor
CREATE OR REPLACE FUNCTION public.get_public_instance_phone(_consultant_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.connected_phone
  FROM public.whatsapp_instances w
  WHERE w.consultant_id = _consultant_id
    AND w.connected_phone IS NOT NULL
  ORDER BY w.updated_at DESC NULLS LAST
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_instance_phone(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_instance_phone(uuid) TO anon, authenticated, service_role;

-- 3) Fecha a varredura anonima das views
DROP POLICY IF EXISTS "Anon read connected instances" ON public.whatsapp_instances;
REVOKE SELECT ON public.whatsapp_instances_public FROM anon;
REVOKE SELECT ON public.consultants_public FROM anon;