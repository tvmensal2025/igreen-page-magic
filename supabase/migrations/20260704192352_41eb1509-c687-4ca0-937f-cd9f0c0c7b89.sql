CREATE OR REPLACE FUNCTION public.assign_flow_variant(_consultant_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _active text[];
  _available text[];
  _counter int;
  _idx int;
BEGIN
  SELECT active_variants INTO _active
  FROM public.consultants
  WHERE id = _consultant_id;

  IF _active IS NULL OR array_length(_active, 1) IS NULL THEN
    RETURN 'A';
  END IF;

  -- Aceita variantes que tenham fluxo próprio do consultor OU fluxo público
  -- ativo (caso do Fluxo M/MG, que só o Super Admin edita mas todos usam).
  SELECT COALESCE(array_agg(v ORDER BY v), ARRAY[]::text[])
  INTO _available
  FROM unnest(_active) AS v
  WHERE EXISTS (
    SELECT 1 FROM public.bot_flows bf
    WHERE bf.is_active = true
      AND bf.variant = v
      AND (bf.consultant_id = _consultant_id OR bf.is_public = true)
  );

  IF _available IS NULL OR array_length(_available, 1) IS NULL THEN
    RETURN 'A';
  END IF;

  IF array_length(_available, 1) = 1 THEN
    RETURN _available[1];
  END IF;

  SELECT COUNT(*)::int INTO _counter
  FROM public.customers
  WHERE consultant_id = _consultant_id;

  _idx := (_counter % array_length(_available, 1)) + 1;
  RETURN _available[_idx];
END;
$function$;