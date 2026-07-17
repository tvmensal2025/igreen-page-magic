-- Protege Fluxo C Sofia Multicanal contra sync_bot_flow_c_from_a (clone A→C).
-- Não reexecuta sync em massa — só atualiza a função com a guarda Sofia.

CREATE OR REPLACE FUNCTION public.sync_bot_flow_c_from_a(_consultant_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean := false;
  v_a_flow public.bot_flows%ROWTYPE;
  v_c_flow public.bot_flows%ROWTYPE;
  v_step_map jsonb := '{}'::jsonb;
  v_customer_step_map jsonb := '{}'::jsonb;
  v_qa_map jsonb := '{}'::jsonb;
  r record;
BEGIN
  IF v_caller IS NOT NULL THEN
    BEGIN
      SELECT public.is_super_admin(v_caller) INTO v_is_admin;
    EXCEPTION WHEN OTHERS THEN
      v_is_admin := false;
    END;

    IF NOT v_is_admin AND v_caller <> _consultant_id THEN
      RAISE EXCEPTION 'Sem permissão para sincronizar o Fluxo C deste consultor.';
    END IF;
  ELSIF current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
    RAISE EXCEPTION 'Sessão expirada. Faça login novamente.';
  END IF;

  SELECT * INTO v_a_flow
  FROM public.bot_flows
  WHERE consultant_id = _consultant_id
    AND variant = 'A'
    AND is_active = true
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_a_flow.id IS NULL THEN
    RAISE EXCEPTION 'Fluxo A ativo não encontrado para o consultor %.', _consultant_id;
  END IF;

  SELECT * INTO v_c_flow
  FROM public.bot_flows
  WHERE consultant_id = _consultant_id
    AND variant = 'C'
    AND is_active = true
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_c_flow.id IS NULL THEN
    INSERT INTO public.bot_flows (
      consultant_id, name, is_active, strict_mode, variant, is_public, sync_mode
    ) VALUES (
      _consultant_id, v_a_flow.name || ' (C)', true,
      v_a_flow.strict_mode, 'C', false, 'custom'
    )
    RETURNING * INTO v_c_flow;
  ELSE
    -- NÃO sobrescrever Sofia Multicanal (Grupo A / 10 passos) com clone do Fluxo A.
    -- C é a variante oficial da Sofia; sync A→C só vale para C clone legado.
    IF v_c_flow.name ILIKE '%sofia%'
       OR EXISTS (
         SELECT 1 FROM public.bot_flow_steps s
         WHERE s.flow_id = v_c_flow.id
           AND s.is_active = true
           AND s.step_key IN ('a1_ask_name', 'a3_explain_with_buttons', 'a10_portal_otp_facial')
       )
    THEN
      RAISE NOTICE
        'sync_bot_flow_c_from_a: pulando consultor % — Fluxo C é Sofia Multicanal (%)',
        _consultant_id, v_c_flow.id;
      RETURN v_c_flow.id;
    END IF;

    UPDATE public.bot_flows
    SET name = v_a_flow.name || ' (C)',
        strict_mode = v_a_flow.strict_mode,
        sync_mode = 'custom',
        updated_at = now()
    WHERE id = v_c_flow.id;
  END IF;

  -- Guarda o passo equivalente de clientes em andamento antes de recriar o C.
  SELECT COALESCE(
    jsonb_object_agg(cfs.customer_id::text, a_step.id::text),
    '{}'::jsonb
  )
  INTO v_customer_step_map
  FROM public.customer_flow_state cfs
  JOIN public.bot_flow_steps old_c_step
    ON old_c_step.id = cfs.current_step_id
   AND old_c_step.flow_id = v_c_flow.id
  JOIN public.bot_flow_steps a_step
    ON a_step.flow_id = v_a_flow.id
   AND (
     (old_c_step.step_key IS NOT NULL AND a_step.step_key = old_c_step.step_key)
     OR (old_c_step.step_key IS NULL AND a_step.position = old_c_step.position)
   );

  -- Apaga somente a configuração do C. O registro do fluxo permanece estável.
  DELETE FROM public.bot_flow_qa WHERE flow_id = v_c_flow.id;
  DELETE FROM public.bot_flow_steps WHERE flow_id = v_c_flow.id;

  -- Cada passo recebe UUID próprio; todas as referências JSONB serão remapeadas.
  SELECT COALESCE(
    jsonb_object_agg(id::text, gen_random_uuid()::text),
    '{}'::jsonb
  )
  INTO v_step_map
  FROM public.bot_flow_steps
  WHERE flow_id = v_a_flow.id;

  INSERT INTO public.bot_flow_steps (
    id, flow_id, position, step_type, step_key, title, summary, icon,
    message_text, persuasive_text, text_delay_ms, slot_key, media_order,
    wait_for, wait_seconds, condition_text, transitions, captures, fallback,
    is_active, auto_detect_doc_type, layout,
    respect_business_hours, business_hour_start, business_hour_end,
    pause_on_weekend, pause_on_holiday, transitions_backup_pre_v2
  )
  SELECT
    (v_step_map ->> s.id::text)::uuid,
    v_c_flow.id,
    s.position, s.step_type, s.step_key, s.title, s.summary, s.icon,
    s.message_text, s.persuasive_text, s.text_delay_ms, s.slot_key, s.media_order,
    s.wait_for, s.wait_seconds, s.condition_text,
    public.remap_bot_flow_step_refs(COALESCE(s.transitions, '[]'::jsonb), v_step_map),
    public.remap_bot_flow_step_refs(COALESCE(s.captures, '[]'::jsonb), v_step_map),
    public.remap_bot_flow_step_refs(COALESCE(s.fallback, '{}'::jsonb), v_step_map),
    s.is_active, s.auto_detect_doc_type, s.layout,
    s.respect_business_hours, s.business_hour_start, s.business_hour_end,
    s.pause_on_weekend, s.pause_on_holiday,
    CASE WHEN s.transitions_backup_pre_v2 IS NULL THEN NULL
         ELSE public.remap_bot_flow_step_refs(s.transitions_backup_pre_v2, v_step_map)
    END
  FROM public.bot_flow_steps s
  WHERE s.flow_id = v_a_flow.id
  ORDER BY s.position;

  -- Copia também a inteligência de perguntas/respostas do Fluxo A.
  SELECT COALESCE(
    jsonb_object_agg(id::text, gen_random_uuid()::text),
    '{}'::jsonb
  )
  INTO v_qa_map
  FROM public.bot_flow_qa
  WHERE flow_id = v_a_flow.id;

  INSERT INTO public.bot_flow_qa (
    id, flow_id, position, intent_name, is_opening, is_closing,
    text_response, is_public, embedding, embedding_updated_at
  )
  SELECT
    (v_qa_map ->> q.id::text)::uuid,
    v_c_flow.id, q.position, q.intent_name, q.is_opening, q.is_closing,
    q.text_response, false, q.embedding, q.embedding_updated_at
  FROM public.bot_flow_qa q
  WHERE q.flow_id = v_a_flow.id
  ORDER BY q.position;

  INSERT INTO public.bot_flow_qa_triggers (qa_id, phrase)
  SELECT (v_qa_map ->> t.qa_id::text)::uuid, t.phrase
  FROM public.bot_flow_qa_triggers t
  WHERE v_qa_map ? t.qa_id::text;

  INSERT INTO public.bot_flow_qa_media (
    qa_id, position, media_kind, media_id, slot_key
  )
  SELECT
    (v_qa_map ->> m.qa_id::text)::uuid,
    m.position, m.media_kind, m.media_id, m.slot_key
  FROM public.bot_flow_qa_media m
  WHERE v_qa_map ? m.qa_id::text;

  -- Reaponta clientes ativos para o UUID novo do mesmo passo lógico.
  UPDATE public.customer_flow_state cfs
  SET current_step_id = (v_step_map ->> (entry.value #>> '{}'))::uuid,
      updated_at = now()
  FROM jsonb_each(v_customer_step_map) AS entry(key, value)
  WHERE cfs.customer_id = entry.key::uuid
    AND v_step_map ? (entry.value #>> '{}');

  RETURN v_c_flow.id;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_bot_flow_c_from_a(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_bot_flow_c_from_a(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_bot_flow_c_from_a(uuid) TO service_role;

COMMENT ON FUNCTION public.sync_bot_flow_c_from_a(uuid) IS
  'Clona Fluxo A → C. Não altera C quando já é Sofia Multicanal (nome/step_keys a1/a3/a10).';
