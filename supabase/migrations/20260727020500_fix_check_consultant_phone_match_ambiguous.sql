-- Corrige 400 na RPC: RETURNS TABLE declara connected_phone/consultant_phone
-- e o corpo usava os mesmos nomes sem alias → coluna ambígua no PL/pgSQL.
CREATE OR REPLACE FUNCTION public.check_consultant_phone_match(_consultant_id uuid)
RETURNS TABLE(matched boolean, consultant_phone text, connected_phone text, verified_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c_phone text;
  i_phone text;
  is_match boolean := false;
  v_now timestamptz := now();
  v_verified timestamptz;
BEGIN
  SELECT regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')
    INTO c_phone
    FROM public.consultants c
    WHERE c.id = _consultant_id;

  SELECT regexp_replace(coalesce(wi.connected_phone, ''), '\D', '', 'g')
    INTO i_phone
    FROM public.whatsapp_instances wi
    WHERE wi.consultant_id = _consultant_id
      AND wi.connected_phone IS NOT NULL
    ORDER BY wi.updated_at DESC NULLS LAST
    LIMIT 1;

  IF c_phone IS NOT NULL AND c_phone <> '' AND i_phone IS NOT NULL AND i_phone <> '' THEN
    is_match := right(c_phone, 11) = right(i_phone, 11);
  END IF;

  IF is_match THEN
    UPDATE public.consultants
       SET phone_verified_at = v_now
     WHERE id = _consultant_id;
    v_verified := v_now;
  ELSE
    SELECT c.phone_verified_at INTO v_verified
      FROM public.consultants c
     WHERE c.id = _consultant_id;
  END IF;

  RETURN QUERY SELECT is_match, c_phone, i_phone, v_verified;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.check_consultant_phone_match(uuid) TO authenticated, service_role;
