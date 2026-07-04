CREATE OR REPLACE FUNCTION public.publish_flow_as_public(_flow_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_variant text;
  v_owner uuid;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas super-admin pode publicar fluxos públicos';
  END IF;

  SELECT variant, consultant_id INTO v_variant, v_owner
    FROM public.bot_flows WHERE id = _flow_id;
  IF v_variant IS NULL THEN
    RAISE EXCEPTION 'Fluxo não encontrado';
  END IF;

  -- Remove flag public de outros fluxos da mesma variante
  UPDATE public.bot_flows
     SET is_public = false
   WHERE variant = v_variant
     AND id <> _flow_id
     AND is_public = true;

  -- Marca o fluxo escolhido como público e ativo
  UPDATE public.bot_flows
     SET is_public = true, is_active = true
   WHERE id = _flow_id;

  -- Força TODOS os consultores (exceto o dono do público) a sync_mode='public'
  -- para essa variante, garantindo que recebam a mesma estrutura e mídias.
  UPDATE public.bot_flows
     SET sync_mode = 'public', updated_at = now()
   WHERE variant = v_variant
     AND id <> _flow_id
     AND consultant_id IS NOT NULL
     AND consultant_id <> COALESCE(v_owner, '00000000-0000-0000-0000-000000000000'::uuid)
     AND sync_mode <> 'public';
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_flow_as_public(uuid) TO authenticated;