-- 1) Coluna sync_mode
ALTER TABLE public.bot_flows
  ADD COLUMN IF NOT EXISTS sync_mode text NOT NULL DEFAULT 'public';

ALTER TABLE public.bot_flows
  DROP CONSTRAINT IF EXISTS bot_flows_sync_mode_check;
ALTER TABLE public.bot_flows
  ADD CONSTRAINT bot_flows_sync_mode_check CHECK (sync_mode IN ('public','custom'));

-- Preserva edições atuais: fluxos de consultores já existentes ficam em custom
UPDATE public.bot_flows SET sync_mode = 'custom'
  WHERE consultant_id IS NOT NULL AND is_public = false AND sync_mode <> 'custom';

-- Template público é a fonte da verdade, sempre custom
UPDATE public.bot_flows SET sync_mode = 'custom'
  WHERE is_public = true AND sync_mode <> 'custom';

-- 2) RPC fork_flow_from_public: clona steps do público para o flow do consultor
CREATE OR REPLACE FUNCTION public.fork_flow_from_public(_consultant_id uuid, _variant text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_flow uuid;
  v_public_flow uuid;
  v_caller uuid := auth.uid();
  v_is_admin boolean := false;
  v_id_map jsonb := '{}'::jsonb;
  r record;
  new_id uuid;
  remapped_transitions jsonb;
  remapped_fallback jsonb;
  t jsonb;
  new_t jsonb;
BEGIN
  -- Autorização: o próprio consultor OU super admin
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  BEGIN
    SELECT public.is_super_admin(v_caller) INTO v_is_admin;
  EXCEPTION WHEN OTHERS THEN
    v_is_admin := false;
  END;
  IF NOT v_is_admin AND v_caller <> _consultant_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Encontra o fluxo do consultor (variante) e o público
  SELECT id INTO v_target_flow
    FROM public.bot_flows
    WHERE consultant_id = _consultant_id
      AND is_active = true
      AND variant = _variant
    ORDER BY created_at ASC
    LIMIT 1;
  IF v_target_flow IS NULL THEN
    RAISE EXCEPTION 'consultant_flow_not_found';
  END IF;

  SELECT id INTO v_public_flow
    FROM public.bot_flows
    WHERE is_public = true
      AND is_active = true
      AND variant = _variant
    LIMIT 1;
  IF v_public_flow IS NULL THEN
    RAISE EXCEPTION 'public_flow_not_found';
  END IF;

  -- Limpa steps antigos do consultor
  DELETE FROM public.bot_flow_steps WHERE flow_id = v_target_flow;

  -- Primeiro passe: gera novo UUID para cada step do público e monta o mapa
  FOR r IN
    SELECT id FROM public.bot_flow_steps WHERE flow_id = v_public_flow ORDER BY position
  LOOP
    new_id := gen_random_uuid();
    v_id_map := v_id_map || jsonb_build_object(r.id::text, new_id::text);
  END LOOP;

  -- Segundo passe: insere remapeando goto_step_id nas transitions e fallback
  FOR r IN
    SELECT * FROM public.bot_flow_steps WHERE flow_id = v_public_flow ORDER BY position
  LOOP
    new_id := (v_id_map ->> r.id::text)::uuid;

    -- Remapeia transitions
    remapped_transitions := COALESCE(r.transitions, '[]'::jsonb);
    IF jsonb_typeof(remapped_transitions) = 'array' THEN
      SELECT jsonb_agg(
        CASE
          WHEN (t->>'goto_step_id') IS NOT NULL AND (v_id_map ? (t->>'goto_step_id'))
            THEN t || jsonb_build_object('goto_step_id', (v_id_map ->> (t->>'goto_step_id')))
          ELSE t
        END
      )
      INTO remapped_transitions
      FROM jsonb_array_elements(COALESCE(r.transitions,'[]'::jsonb)) t;
      remapped_transitions := COALESCE(remapped_transitions, '[]'::jsonb);
    END IF;

    -- Remapeia fallback.goto_step_id
    remapped_fallback := r.fallback;
    IF remapped_fallback IS NOT NULL
       AND (remapped_fallback ? 'goto_step_id')
       AND (v_id_map ? (remapped_fallback->>'goto_step_id')) THEN
      remapped_fallback := remapped_fallback
        || jsonb_build_object('goto_step_id', (v_id_map ->> (remapped_fallback->>'goto_step_id')));
    END IF;

    INSERT INTO public.bot_flow_steps (
      id, flow_id, position, step_type, step_key, title, icon,
      message_text, slot_key, media_order,
      transitions, captures, fallback,
      is_active, auto_detect_doc_type, layout
    )
    VALUES (
      new_id, v_target_flow, r.position, r.step_type, r.step_key, r.title, r.icon,
      r.message_text, r.slot_key, r.media_order,
      COALESCE(remapped_transitions, '[]'::jsonb), COALESCE(r.captures, '[]'::jsonb), remapped_fallback,
      r.is_active, r.auto_detect_doc_type, r.layout
    );
  END LOOP;

  -- Marca o fluxo como custom
  UPDATE public.bot_flows
    SET sync_mode = 'custom', updated_at = now()
    WHERE id = v_target_flow;

  RETURN v_target_flow;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fork_flow_from_public(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fork_flow_from_public(uuid, text) TO service_role;