-- Mantém o Fluxo C como cópia funcional exata do Fluxo A.
-- Corrige a clonagem antiga, que omitia 19 campos e preservava IDs do fluxo fonte.

CREATE OR REPLACE FUNCTION public.remap_bot_flow_step_refs(
  _value jsonb,
  _id_map jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public
AS $$
DECLARE
  v_type text := jsonb_typeof(_value);
  v_result jsonb;
BEGIN
  IF v_type = 'string' AND _id_map ? (_value #>> '{}') THEN
    RETURN to_jsonb(_id_map ->> (_value #>> '{}'));
  END IF;

  IF v_type = 'array' THEN
    SELECT COALESCE(
      jsonb_agg(public.remap_bot_flow_step_refs(item, _id_map) ORDER BY ord),
      '[]'::jsonb
    )
    INTO v_result
    FROM jsonb_array_elements(_value) WITH ORDINALITY AS e(item, ord);
    RETURN v_result;
  END IF;

  IF v_type = 'object' THEN
    SELECT COALESCE(
      jsonb_object_agg(key, public.remap_bot_flow_step_refs(value, _id_map)),
      '{}'::jsonb
    )
    INTO v_result
    FROM jsonb_each(_value);
    RETURN v_result;
  END IF;

  RETURN _value;
END;
$$;

REVOKE ALL ON FUNCTION public.remap_bot_flow_step_refs(jsonb, jsonb) FROM PUBLIC;
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
-- Compatibilidade: a RPC genérica também usa a sincronização completa no C.
CREATE OR REPLACE FUNCTION public.clone_bot_flow_as(_consultant_id uuid, _variant text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src_flow_id uuid;
  v_new_flow_id uuid;
BEGIN
  IF _variant = 'C' THEN
    RETURN public.sync_bot_flow_c_from_a(_consultant_id);
  END IF;

  IF _variant NOT IN ('B', 'D', 'E', 'M') THEN
    RAISE EXCEPTION 'Variante inválida: %', _variant;
  END IF;

  SELECT id INTO v_src_flow_id
  FROM public.bot_flows
  WHERE consultant_id = _consultant_id
    AND is_active = true
    AND variant = 'A'
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_src_flow_id IS NULL THEN
    RAISE EXCEPTION 'Fluxo A não encontrado para o consultor';
  END IF;

  DELETE FROM public.bot_flows
  WHERE consultant_id = _consultant_id AND variant = _variant;

  INSERT INTO public.bot_flows (consultant_id, name, is_active, variant)
  SELECT consultant_id, name || ' (' || _variant || ')', true, _variant
  FROM public.bot_flows
  WHERE id = v_src_flow_id
  RETURNING id INTO v_new_flow_id;

  INSERT INTO public.bot_flow_steps (
    flow_id, position, step_key, step_type, message_text, is_active, transitions
  )
  SELECT
    v_new_flow_id, position, step_key, step_type, message_text, is_active, transitions
  FROM public.bot_flow_steps
  WHERE flow_id = v_src_flow_id;

  RETURN v_new_flow_id;
END;
$$;

-- Compatibilidade: qualquer criação futura do C usa a sincronização completa.
CREATE OR REPLACE FUNCTION public.clone_bot_flow_as_c(_consultant_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.sync_bot_flow_c_from_a(_consultant_id);
$$;

REVOKE ALL ON FUNCTION public.clone_bot_flow_as_c(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clone_bot_flow_as_c(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clone_bot_flow_as_c(uuid) TO service_role;

-- Corrige agora todos os Fluxos C já existentes que possuem Fluxo A ativo.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT a.consultant_id
    FROM public.bot_flows a
    JOIN public.bot_flows c
      ON c.consultant_id = a.consultant_id
     AND c.variant = 'C'
     AND c.is_active = true
    WHERE a.variant = 'A'
      AND a.is_active = true
  LOOP
    PERFORM public.sync_bot_flow_c_from_a(r.consultant_id);
  END LOOP;
END;
$$;

-- Falha a migration se algum C sincronizado não ficar equivalente ao A.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT
      a.consultant_id,
      a.id AS a_id,
      c.id AS c_id,
      (SELECT count(*) FROM public.bot_flow_steps WHERE flow_id = a.id) AS a_steps,
      (SELECT count(*) FROM public.bot_flow_steps WHERE flow_id = c.id) AS c_steps,
      (SELECT count(*) FROM public.bot_flow_qa WHERE flow_id = a.id) AS a_qa,
      (SELECT count(*) FROM public.bot_flow_qa WHERE flow_id = c.id) AS c_qa
    FROM public.bot_flows a
    JOIN public.bot_flows c
      ON c.consultant_id = a.consultant_id
     AND c.variant = 'C'
     AND c.is_active = true
    WHERE a.variant = 'A'
      AND a.is_active = true
  LOOP
    IF r.a_steps <> r.c_steps OR r.a_qa <> r.c_qa THEN
      RAISE EXCEPTION
        'Fluxo C divergente após sincronização: consultor %, passos A/C %/%, QAs A/C %/%',
        r.consultant_id, r.a_steps, r.c_steps, r.a_qa, r.c_qa;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.bot_flow_steps s
      CROSS JOIN LATERAL jsonb_path_query(
        jsonb_build_array(s.transitions, s.captures, s.fallback),
        'strict $.** ? (@.type() == "string")'
      ) AS ref(value)
      WHERE s.flow_id = r.c_id
        AND EXISTS (
          SELECT 1
          FROM public.bot_flow_steps a_step
          WHERE a_step.flow_id = r.a_id
            AND to_jsonb(a_step.id::text) = ref.value
        )
    ) THEN
      RAISE EXCEPTION
        'Fluxo C do consultor % ainda referencia IDs internos do Fluxo A.',
        r.consultant_id;
    END IF;
  END LOOP;
END;
$$;
