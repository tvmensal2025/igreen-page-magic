
CREATE OR REPLACE FUNCTION public.publish_flow_as_public(_flow_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_variant text;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas super-admin pode publicar fluxos públicos';
  END IF;

  SELECT variant INTO v_variant FROM public.bot_flows WHERE id = _flow_id;
  IF v_variant IS NULL THEN
    RAISE EXCEPTION 'Fluxo não encontrado';
  END IF;

  UPDATE public.bot_flows
     SET is_public = false
   WHERE variant = v_variant
     AND id <> _flow_id
     AND is_public = true;

  UPDATE public.bot_flows
     SET is_public = true, is_active = true
   WHERE id = _flow_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_flow_as_public(uuid) TO authenticated;
