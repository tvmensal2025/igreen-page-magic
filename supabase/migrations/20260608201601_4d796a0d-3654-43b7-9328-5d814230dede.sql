
-- 1) RPC: garante a existência do bot_flow para uma variante específica (A-E),
--    sem depender de "próxima livre". Clona do template público quando existir;
--    senão clona da variante fonte/atual do consultor; senão cria vazio.
CREATE OR REPLACE FUNCTION public.ensure_bot_flow_variant(
  _consultant_id uuid,
  _variant text,
  _source_variant text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean := false;
  v_flow_id uuid;
  v_public_flow uuid;
  v_src_flow uuid;
  v_consultant_name text;
  v_id_map jsonb := '{}'::jsonb;
  r record;
  new_id uuid;
  remapped_transitions jsonb;
  remapped_fallback jsonb;
BEGIN
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

  IF _variant NOT IN ('A','B','C','D','E') THEN
    RAISE EXCEPTION 'invalid_variant: %', _variant;
  END IF;

  -- Já existe? Retorna.
  SELECT id INTO v_flow_id
    FROM public.bot_flows
   WHERE consultant_id = _consultant_id
     AND is_active = true
     AND variant = _variant
   ORDER BY created_at ASC LIMIT 1;
  IF v_flow_id IS NOT NULL THEN
    RETURN v_flow_id;
  END IF;

  SELECT name INTO v_consultant_name FROM public.consultants WHERE id = _consultant_id;

  INSERT INTO public.bot_flows (consultant_id, name, variant, is_active, strict_mode, sync_mode)
  VALUES (
    _consultant_id,
    COALESCE('Fluxo de ' || v_consultant_name, 'Fluxo') || ' (' || _variant || ')',
    _variant, true, false, 'custom'
  )
  RETURNING id INTO v_flow_id;

  -- Procura fonte para clonar passos:
  --   1) template público da mesma variante
  --   2) variante fonte informada pelo caller
  --   3) qualquer variante existente do próprio consultor
  SELECT id INTO v_public_flow
    FROM public.bot_flows
   WHERE is_public = true AND is_active = true AND variant = _variant
   LIMIT 1;

  IF v_public_flow IS NOT NULL THEN
    v_src_flow := v_public_flow;
  ELSIF _source_variant IS NOT NULL THEN
    SELECT id INTO v_src_flow
      FROM public.bot_flows
     WHERE consultant_id = _consultant_id
       AND is_active = true
       AND variant = _source_variant
     ORDER BY created_at ASC LIMIT 1;
  END IF;

  IF v_src_flow IS NULL THEN
    SELECT id INTO v_src_flow
      FROM public.bot_flows
     WHERE consultant_id = _consultant_id
       AND is_active = true
       AND id <> v_flow_id
     ORDER BY created_at ASC LIMIT 1;
  END IF;

  IF v_src_flow IS NOT NULL THEN
    -- Mapa de novos UUIDs
    FOR r IN SELECT id FROM public.bot_flow_steps WHERE flow_id = v_src_flow ORDER BY position LOOP
      v_id_map := v_id_map || jsonb_build_object(r.id::text, gen_random_uuid()::text);
    END LOOP;

    FOR r IN SELECT * FROM public.bot_flow_steps WHERE flow_id = v_src_flow ORDER BY position LOOP
      new_id := (v_id_map ->> r.id::text)::uuid;
      remapped_transitions := COALESCE(r.transitions, '[]'::jsonb);
      IF jsonb_typeof(remapped_transitions) = 'array' THEN
        SELECT jsonb_agg(
          CASE
            WHEN (tr->>'goto_step_id') IS NOT NULL AND (v_id_map ? (tr->>'goto_step_id'))
              THEN tr || jsonb_build_object('goto_step_id', (v_id_map ->> (tr->>'goto_step_id')))
            ELSE tr
          END
        )
        INTO remapped_transitions
        FROM jsonb_array_elements(COALESCE(r.transitions,'[]'::jsonb)) AS tr;
        remapped_transitions := COALESCE(remapped_transitions, '[]'::jsonb);
      END IF;
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
      ) VALUES (
        new_id, v_flow_id, r.position, r.step_type, r.step_key, r.title, r.icon,
        r.message_text, r.slot_key, r.media_order,
        COALESCE(remapped_transitions, '[]'::jsonb), COALESCE(r.captures, '[]'::jsonb), remapped_fallback,
        r.is_active, r.auto_detect_doc_type, r.layout
      );
    END LOOP;
  END IF;

  RETURN v_flow_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_bot_flow_variant(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_bot_flow_variant(uuid, text, text) TO service_role;

-- 2) Round-robin: somente variantes ativas QUE TÊM bot_flow existente entram no sorteio.
CREATE OR REPLACE FUNCTION public.assign_flow_variant_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active TEXT[];
  v_available TEXT[];
  v_count BIGINT;
  v_idx INT;
BEGIN
  IF NEW.flow_variant IS NOT NULL AND NEW.flow_variant <> '' THEN
    RETURN NEW;
  END IF;

  SELECT active_variants INTO v_active
    FROM public.consultants WHERE id = NEW.consultant_id;

  IF v_active IS NULL OR array_length(v_active, 1) IS NULL THEN
    NEW.flow_variant := 'A';
    RETURN NEW;
  END IF;

  -- Mantém apenas variantes que têm bot_flow existente/ativo
  SELECT COALESCE(array_agg(upper(v) ORDER BY upper(v)), ARRAY[]::text[])
    INTO v_available
   FROM unnest(v_active) AS v
   WHERE EXISTS (
     SELECT 1 FROM public.bot_flows bf
      WHERE bf.consultant_id = NEW.consultant_id
        AND bf.is_active = true
        AND bf.variant = upper(v)
   );

  IF v_available IS NULL OR array_length(v_available, 1) IS NULL THEN
    -- Fallback: qualquer fluxo ativo do consultor
    SELECT COALESCE(array_agg(DISTINCT bf.variant ORDER BY bf.variant), ARRAY[]::text[])
      INTO v_available
     FROM public.bot_flows bf
     WHERE bf.consultant_id = NEW.consultant_id AND bf.is_active = true;
  END IF;

  IF v_available IS NULL OR array_length(v_available, 1) IS NULL THEN
    NEW.flow_variant := 'A';
    RETURN NEW;
  END IF;

  IF array_length(v_available, 1) = 1 THEN
    NEW.flow_variant := v_available[1];
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM public.customers
   WHERE consultant_id = NEW.consultant_id
     AND COALESCE(is_test_lead, false) = false;

  v_idx := (v_count % array_length(v_available, 1)) + 1;
  NEW.flow_variant := v_available[v_idx];
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_flow_variant_on_insert() FROM PUBLIC, anon, authenticated;
