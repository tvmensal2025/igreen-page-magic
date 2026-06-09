-- Expande variante de A-E para A-Z no CHECK de bot_flows
ALTER TABLE public.bot_flows DROP CONSTRAINT IF EXISTS bot_flows_variant_check;
ALTER TABLE public.bot_flows
  ADD CONSTRAINT bot_flows_variant_check
  CHECK (variant ~ '^[A-Z]$');

-- Atualiza validação dentro da função ensure_bot_flow_variant
CREATE OR REPLACE FUNCTION public.ensure_bot_flow_variant(_consultant_id uuid, _variant text, _source_variant text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF _variant !~ '^[A-Z]$' THEN
    RAISE EXCEPTION 'Variante inválida: %', _variant;
  END IF;

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

      remapped_captures := COALESCE(r.captures, '[]'::jsonb);

      INSERT INTO public.bot_flow_steps (
        id, flow_id, position, step_type, step_key, title, summary, icon,
        message_text, text_delay_ms, slot_key, transitions, captures, fallback,
        is_active, auto_detect_doc_type, layout
      )
      VALUES (
        new_id, v_flow_id, r.position, r.step_type, r.step_key, r.title, r.summary, r.icon,
        r.message_text, r.text_delay_ms, r.slot_key, remapped_transitions, remapped_captures, remapped_fallback,
        r.is_active, r.auto_detect_doc_type, r.layout
      );
    END LOOP;
  END IF;

  RETURN v_flow_id;
END;
$function$;