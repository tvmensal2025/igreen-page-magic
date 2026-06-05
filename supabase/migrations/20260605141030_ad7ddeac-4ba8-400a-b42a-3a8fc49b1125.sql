-- Frente 2: Patch fork_flow_from_public para remapear success_goto_step_id
CREATE OR REPLACE FUNCTION public.fork_flow_from_public(_consultant_id uuid, _variant text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  DELETE FROM public.bot_flow_steps WHERE flow_id = v_target_flow;

  FOR r IN
    SELECT id FROM public.bot_flow_steps WHERE flow_id = v_public_flow ORDER BY position
  LOOP
    new_id := gen_random_uuid();
    v_id_map := v_id_map || jsonb_build_object(r.id::text, new_id::text);
  END LOOP;

  FOR r IN
    SELECT * FROM public.bot_flow_steps WHERE flow_id = v_public_flow ORDER BY position
  LOOP
    new_id := (v_id_map ->> r.id::text)::uuid;

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

    remapped_fallback := r.fallback;
    IF remapped_fallback IS NOT NULL
       AND (remapped_fallback ? 'goto_step_id')
       AND (v_id_map ? (remapped_fallback->>'goto_step_id')) THEN
      remapped_fallback := remapped_fallback
        || jsonb_build_object('goto_step_id', (v_id_map ->> (remapped_fallback->>'goto_step_id')));
    END IF;
    IF remapped_fallback IS NOT NULL
       AND (remapped_fallback ? 'success_goto_step_id')
       AND (v_id_map ? (remapped_fallback->>'success_goto_step_id')) THEN
      remapped_fallback := remapped_fallback
        || jsonb_build_object('success_goto_step_id', (v_id_map ->> (remapped_fallback->>'success_goto_step_id')));
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

  UPDATE public.bot_flows
    SET sync_mode = 'custom', updated_at = now()
    WHERE id = v_target_flow;

  RETURN v_target_flow;
END;
$function$;

-- Frente 1: Saneamento de fallback.goto_step_id e fallback.success_goto_step_id quebrados
DO $saneamento$
DECLARE
  s record;
  public_step record;
  matching_id uuid;
  new_fallback jsonb;
  broken_key text;
  fixed_count int := 0;
  removed_count int := 0;
BEGIN
  FOR s IN
    SELECT bfs.id, bfs.flow_id, bfs.step_key, bfs.fallback
    FROM public.bot_flow_steps bfs
    WHERE bfs.fallback IS NOT NULL
      AND (bfs.fallback ? 'goto_step_id' OR bfs.fallback ? 'success_goto_step_id')
  LOOP
    new_fallback := s.fallback;

    FOREACH broken_key IN ARRAY ARRAY['goto_step_id','success_goto_step_id']
    LOOP
      IF NOT (new_fallback ? broken_key) THEN
        CONTINUE;
      END IF;

      -- Já válido dentro do mesmo flow? pula.
      IF EXISTS (
        SELECT 1 FROM public.bot_flow_steps
        WHERE flow_id = s.flow_id
          AND id::text = (new_fallback->>broken_key)
      ) THEN
        CONTINUE;
      END IF;

      -- Procura o step original (em qualquer flow) pelo UUID quebrado para obter step_key
      SELECT step_key INTO public_step
      FROM public.bot_flow_steps
      WHERE id::text = (new_fallback->>broken_key)
      LIMIT 1;

      IF public_step.step_key IS NOT NULL THEN
        SELECT id INTO matching_id
        FROM public.bot_flow_steps
        WHERE flow_id = s.flow_id
          AND step_key = public_step.step_key
        LIMIT 1;
      ELSE
        matching_id := NULL;
      END IF;

      IF matching_id IS NOT NULL THEN
        new_fallback := new_fallback || jsonb_build_object(broken_key, matching_id::text);
        fixed_count := fixed_count + 1;
        RAISE NOTICE 'Fixed % on step % (flow %): -> %', broken_key, s.step_key, s.flow_id, matching_id;
      ELSE
        new_fallback := new_fallback - broken_key;
        removed_count := removed_count + 1;
        RAISE NOTICE 'Removed broken % on step % (flow %)', broken_key, s.step_key, s.flow_id;
      END IF;
    END LOOP;

    IF new_fallback IS DISTINCT FROM s.fallback THEN
      UPDATE public.bot_flow_steps SET fallback = new_fallback WHERE id = s.id;
    END IF;
  END LOOP;

  RAISE NOTICE 'Saneamento concluído: % corrigidos, % removidos', fixed_count, removed_count;
END
$saneamento$;