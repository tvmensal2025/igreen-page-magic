
-- Fix: column reference "t" is ambiguous + novo RPC sync_flow_from_public
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

-- Novo RPC: copia a estrutura do super admin para o consultor mantendo sync_mode='public'
CREATE OR REPLACE FUNCTION public.sync_flow_from_public(_consultant_id uuid, _variant text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target_flow uuid;
BEGIN
  v_target_flow := public.fork_flow_from_public(_consultant_id, _variant);
  UPDATE public.bot_flows
    SET sync_mode = 'public', updated_at = now()
    WHERE id = v_target_flow;
  RETURN v_target_flow;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.sync_flow_from_public(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_flow_from_public(uuid, text) TO service_role;
