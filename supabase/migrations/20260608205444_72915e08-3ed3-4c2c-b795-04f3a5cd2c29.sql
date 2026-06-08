-- Atualiza ensure_bot_flow_variant para clonar todos os campos relevantes e remapear todas as refs de step ids.
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
  remapped_captures jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Sessão expirada. Faça login novamente.';
  END IF;

  BEGIN
    SELECT public.is_super_admin(v_caller) INTO v_is_admin;
  EXCEPTION WHEN OTHERS THEN
    v_is_admin := false;
  END;

  IF NOT v_is_admin AND v_caller <> _consultant_id THEN
    RAISE EXCEPTION 'Sem permissão para criar variantes deste consultor.';
  END IF;

  IF _variant NOT IN ('A','B','C','D','E') THEN
    RAISE EXCEPTION 'Variante inválida: %', _variant;
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

  -- Fonte para clonar passos
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

      -- Remapeia transitions[].goto_step_id
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

      -- Remapeia fallback.goto_step_id, fallback.success_goto_step_id e fallback.failure_goto_step_id
      remapped_fallback := r.fallback;
      IF remapped_fallback IS NOT NULL THEN
        IF (remapped_fallback ? 'goto_step_id') AND (v_id_map ? (remapped_fallback->>'goto_step_id')) THEN
          remapped_fallback := remapped_fallback
            || jsonb_build_object('goto_step_id', (v_id_map ->> (remapped_fallback->>'goto_step_id')));
        END IF;
        IF (remapped_fallback ? 'success_goto_step_id') AND (v_id_map ? (remapped_fallback->>'success_goto_step_id')) THEN
          remapped_fallback := remapped_fallback
            || jsonb_build_object('success_goto_step_id', (v_id_map ->> (remapped_fallback->>'success_goto_step_id')));
        END IF;
        IF (remapped_fallback ? 'failure_goto_step_id') AND (v_id_map ? (remapped_fallback->>'failure_goto_step_id')) THEN
          remapped_fallback := remapped_fallback
            || jsonb_build_object('failure_goto_step_id', (v_id_map ->> (remapped_fallback->>'failure_goto_step_id')));
        END IF;
      END IF;

      -- Remapeia captures[].goto_step_id se houver
      remapped_captures := COALESCE(r.captures, '[]'::jsonb);
      IF jsonb_typeof(remapped_captures) = 'array' THEN
        SELECT jsonb_agg(
          CASE
            WHEN (c->>'goto_step_id') IS NOT NULL AND (v_id_map ? (c->>'goto_step_id'))
              THEN c || jsonb_build_object('goto_step_id', (v_id_map ->> (c->>'goto_step_id')))
            ELSE c
          END
        )
        INTO remapped_captures
        FROM jsonb_array_elements(COALESCE(r.captures,'[]'::jsonb)) AS c;
        remapped_captures := COALESCE(remapped_captures, '[]'::jsonb);
      END IF;

      INSERT INTO public.bot_flow_steps (
        id, flow_id, position, step_type, step_key, title, summary, icon,
        message_text, slot_key, media_order, text_delay_ms, persuasive_text,
        transitions, captures, fallback,
        is_active, auto_detect_doc_type, layout,
        wait_for, wait_seconds, condition_text,
        respect_business_hours, pause_on_weekend, pause_on_holiday,
        business_hour_start, business_hour_end
      ) VALUES (
        new_id, v_flow_id, r.position, r.step_type, r.step_key, r.title, r.summary, r.icon,
        r.message_text, r.slot_key, r.media_order, r.text_delay_ms, r.persuasive_text,
        COALESCE(remapped_transitions, '[]'::jsonb),
        COALESCE(remapped_captures, '[]'::jsonb),
        remapped_fallback,
        r.is_active, r.auto_detect_doc_type, r.layout,
        r.wait_for, r.wait_seconds, r.condition_text,
        r.respect_business_hours, r.pause_on_weekend, r.pause_on_holiday,
        r.business_hour_start, r.business_hour_end
      );
    END LOOP;
  END IF;

  RETURN v_flow_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_bot_flow_variant(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_bot_flow_variant(uuid, text, text) TO service_role;

-- Reparo idempotente: limpa refs de fallback.success_goto_step_id / failure_goto_step_id
-- em bot_flow_steps de fluxos NÃO públicos onde o id alvo não existe no mesmo flow.
-- Tenta primeiro casar pelo step_key do alvo no flow correto; se não achar, remove a chave.
DO $repair$
DECLARE
  s record;
  fb jsonb;
  target_id text;
  target_key text;
  matched_id uuid;
  changed boolean;
BEGIN
  FOR s IN
    SELECT st.id, st.flow_id, st.fallback
      FROM public.bot_flow_steps st
      JOIN public.bot_flows bf ON bf.id = st.flow_id
     WHERE COALESCE(bf.is_public, false) = false
       AND st.fallback IS NOT NULL
       AND (st.fallback ? 'success_goto_step_id' OR st.fallback ? 'failure_goto_step_id')
  LOOP
    fb := s.fallback;
    changed := false;

    FOREACH target_id IN ARRAY ARRAY[
      COALESCE(fb->>'success_goto_step_id',''),
      COALESCE(fb->>'failure_goto_step_id','')
    ] LOOP
      CONTINUE WHEN target_id = '';
    END LOOP;

    -- success_goto_step_id
    IF fb ? 'success_goto_step_id' THEN
      target_id := fb->>'success_goto_step_id';
      IF target_id IS NOT NULL AND target_id <> '' THEN
        IF NOT EXISTS (SELECT 1 FROM public.bot_flow_steps WHERE id::text = target_id AND flow_id = s.flow_id) THEN
          -- tenta casar por step_key
          SELECT step_key INTO target_key FROM public.bot_flow_steps WHERE id::text = target_id LIMIT 1;
          matched_id := NULL;
          IF target_key IS NOT NULL THEN
            SELECT id INTO matched_id
              FROM public.bot_flow_steps
             WHERE flow_id = s.flow_id AND step_key = target_key
             LIMIT 1;
          END IF;
          IF matched_id IS NOT NULL THEN
            fb := fb || jsonb_build_object('success_goto_step_id', matched_id::text);
          ELSE
            fb := fb - 'success_goto_step_id';
          END IF;
          changed := true;
        END IF;
      END IF;
    END IF;

    -- failure_goto_step_id
    IF fb ? 'failure_goto_step_id' THEN
      target_id := fb->>'failure_goto_step_id';
      IF target_id IS NOT NULL AND target_id <> '' THEN
        IF NOT EXISTS (SELECT 1 FROM public.bot_flow_steps WHERE id::text = target_id AND flow_id = s.flow_id) THEN
          SELECT step_key INTO target_key FROM public.bot_flow_steps WHERE id::text = target_id LIMIT 1;
          matched_id := NULL;
          IF target_key IS NOT NULL THEN
            SELECT id INTO matched_id
              FROM public.bot_flow_steps
             WHERE flow_id = s.flow_id AND step_key = target_key
             LIMIT 1;
          END IF;
          IF matched_id IS NOT NULL THEN
            fb := fb || jsonb_build_object('failure_goto_step_id', matched_id::text);
          ELSE
            fb := fb - 'failure_goto_step_id';
          END IF;
          changed := true;
        END IF;
      END IF;
    END IF;

    IF changed THEN
      UPDATE public.bot_flow_steps SET fallback = fb WHERE id = s.id;
    END IF;
  END LOOP;
END
$repair$;