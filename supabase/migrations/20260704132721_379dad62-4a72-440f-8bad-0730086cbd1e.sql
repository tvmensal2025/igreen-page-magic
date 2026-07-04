
-- 1) Atualiza clone_bot_flow_as para aceitar 'M' (compat com fluxo antigo)
CREATE OR REPLACE FUNCTION public.clone_bot_flow_as(_consultant_id uuid, _variant text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _src_flow_id uuid;
  _new_flow_id uuid;
BEGIN
  IF _variant NOT IN ('B','C','D','E','M') THEN
    RAISE EXCEPTION 'Variante invalida: %', _variant;
  END IF;

  SELECT id INTO _src_flow_id
  FROM public.bot_flows
  WHERE consultant_id = _consultant_id
    AND is_active = true
    AND variant = 'A'
  ORDER BY created_at ASC
  LIMIT 1;

  IF _src_flow_id IS NULL THEN
    RAISE EXCEPTION 'Fluxo A nao encontrado para o consultor';
  END IF;

  DELETE FROM public.bot_flows
  WHERE consultant_id = _consultant_id AND variant = _variant;

  INSERT INTO public.bot_flows (consultant_id, name, is_active, variant)
  SELECT consultant_id,
         name || ' (' || _variant || ')',
         true,
         _variant
  FROM public.bot_flows
  WHERE id = _src_flow_id
  RETURNING id INTO _new_flow_id;

  INSERT INTO public.bot_flow_steps (
    flow_id, position, step_key, step_type, message_text,
    is_active, transitions
  )
  SELECT _new_flow_id, position, step_key, step_type, message_text,
         is_active, transitions
  FROM public.bot_flow_steps
  WHERE flow_id = _src_flow_id;

  RETURN _new_flow_id;
END;
$function$;

-- 2) Clona o Fluxo D público (id 320bf22c-...) como novo Fluxo MG público (variant='M')
DO $$
DECLARE
  v_src_flow_id uuid := '320bf22c-e383-4f53-a3c0-b88b89b02558';
  v_new_flow_id uuid;
  v_src_consultant uuid;
  v_id_map jsonb := '{}'::jsonb;
  r record;
  new_id uuid;
  remapped_transitions jsonb;
  remapped_fallback jsonb;
  remapped_captures jsonb;
BEGIN
  -- Idempotência: se já existe MG público ativo, não recria
  IF EXISTS (SELECT 1 FROM public.bot_flows WHERE variant='M' AND is_public=true AND is_active=true) THEN
    RAISE NOTICE 'Fluxo MG público já existe, pulando clone';
    RETURN;
  END IF;

  SELECT consultant_id INTO v_src_consultant FROM public.bot_flows WHERE id = v_src_flow_id;
  IF v_src_consultant IS NULL THEN
    RAISE EXCEPTION 'Fluxo D fonte não encontrado';
  END IF;

  INSERT INTO public.bot_flows (consultant_id, name, variant, is_active, strict_mode, is_public, sync_mode)
  SELECT consultant_id, 'Fluxo MG', 'M', true, strict_mode, true, 'custom'
  FROM public.bot_flows WHERE id = v_src_flow_id
  RETURNING id INTO v_new_flow_id;

  -- Mapeia IDs antigos para novos
  FOR r IN SELECT id FROM public.bot_flow_steps WHERE flow_id = v_src_flow_id ORDER BY position LOOP
    v_id_map := v_id_map || jsonb_build_object(r.id::text, gen_random_uuid()::text);
  END LOOP;

  -- Insere steps clonados com transitions/fallback remapeados
  FOR r IN SELECT * FROM public.bot_flow_steps WHERE flow_id = v_src_flow_id ORDER BY position LOOP
    new_id := (v_id_map ->> r.id::text)::uuid;

    remapped_transitions := COALESCE(r.transitions, '[]'::jsonb);
    IF jsonb_typeof(remapped_transitions) = 'array' THEN
      SELECT COALESCE(jsonb_agg(
        CASE
          WHEN (tr->>'goto_step_id') IS NOT NULL AND (v_id_map ? (tr->>'goto_step_id'))
            THEN tr || jsonb_build_object('goto_step_id', (v_id_map ->> (tr->>'goto_step_id')))
          ELSE tr
        END
      ), '[]'::jsonb)
      INTO remapped_transitions
      FROM jsonb_array_elements(COALESCE(r.transitions,'[]'::jsonb)) AS tr;
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
      new_id, v_new_flow_id, r.position, r.step_type, r.step_key, r.title, r.summary, r.icon,
      r.message_text, r.text_delay_ms, r.slot_key, remapped_transitions, remapped_captures, remapped_fallback,
      r.is_active, r.auto_detect_doc_type, r.layout
    );
  END LOOP;

  RAISE NOTICE 'Fluxo MG criado: %', v_new_flow_id;
END $$;
