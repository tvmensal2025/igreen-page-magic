
-- ════════════════════════════════════════════════════════════════════
-- 1) is_public em voice_templates + RLS
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE public.voice_templates
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

DROP POLICY IF EXISTS "Authenticated read public voice templates" ON public.voice_templates;
CREATE POLICY "Authenticated read public voice templates"
  ON public.voice_templates
  FOR SELECT
  TO authenticated
  USING (is_public = true);

-- Garante que o owner ainda gerencia
DROP POLICY IF EXISTS "voice_templates_select_own" ON public.voice_templates;
CREATE POLICY "voice_templates_select_own"
  ON public.voice_templates
  FOR SELECT
  TO authenticated
  USING (consultant_id = auth.uid() OR is_public = true);

-- ════════════════════════════════════════════════════════════════════
-- 2) Backfill: todas as mídias do superadmin (rafael.ids) viram públicas
-- ════════════════════════════════════════════════════════════════════
UPDATE public.ai_media_library
   SET is_public = true
 WHERE consultant_id = '0c2711ad-4836-41e6-afba-edd94f698ae3'
   AND COALESCE(is_public, false) = false;

-- ════════════════════════════════════════════════════════════════════
-- 3) Helper: clona o Fluxo D do superadmin para outro consultor
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.clone_superadmin_flow_d_steps(
  _target_flow_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_template_consultant uuid := '0c2711ad-4836-41e6-afba-edd94f698ae3';
  v_template_flow uuid;
  v_id_map jsonb := '{}'::jsonb;
  v_rec record;
  v_new_id uuid;
  v_count integer := 0;
  v_transitions jsonb;
  v_t jsonb;
  v_new_transitions jsonb;
  v_goto uuid;
  v_mapped text;
BEGIN
  -- Acha o fluxo D ativo do superadmin
  SELECT id INTO v_template_flow
    FROM public.bot_flows
   WHERE consultant_id = v_template_consultant
     AND variant = 'D'
     AND is_active = true
   ORDER BY created_at ASC
   LIMIT 1;

  IF v_template_flow IS NULL THEN
    RAISE NOTICE 'Template flow D not found for superadmin';
    RETURN 0;
  END IF;

  -- Pass 1: cria mapa old_id -> new_id
  FOR v_rec IN
    SELECT id FROM public.bot_flow_steps
     WHERE flow_id = v_template_flow
     ORDER BY position
  LOOP
    v_new_id := gen_random_uuid();
    v_id_map := v_id_map || jsonb_build_object(v_rec.id::text, v_new_id::text);
  END LOOP;

  -- Pass 2: insere passos com transitions reescritas
  FOR v_rec IN
    SELECT * FROM public.bot_flow_steps
     WHERE flow_id = v_template_flow
     ORDER BY position
  LOOP
    v_new_id := (v_id_map->>(v_rec.id::text))::uuid;

    -- Reescreve goto_step_id dentro de transitions (jsonb array)
    v_new_transitions := '[]'::jsonb;
    IF v_rec.transitions IS NOT NULL AND jsonb_typeof(v_rec.transitions) = 'array' THEN
      FOR v_t IN SELECT jsonb_array_elements(v_rec.transitions)
      LOOP
        IF v_t ? 'goto_step_id' AND v_t->>'goto_step_id' IS NOT NULL THEN
          v_mapped := v_id_map->>(v_t->>'goto_step_id');
          IF v_mapped IS NOT NULL THEN
            v_t := jsonb_set(v_t, '{goto_step_id}', to_jsonb(v_mapped));
          END IF;
        END IF;
        v_new_transitions := v_new_transitions || v_t;
      END LOOP;
    END IF;

    INSERT INTO public.bot_flow_steps (
      id, flow_id, position, step_type, step_key, title, summary, icon,
      message_text, slot_key, media_order, transitions, captures, fallback,
      layout, text_delay_ms, wait_for, wait_seconds, condition_text,
      auto_detect_doc_type, persuasive_text,
      respect_business_hours, pause_on_weekend, pause_on_holiday,
      business_hour_start, business_hour_end, is_active
    ) VALUES (
      v_new_id, _target_flow_id, v_rec.position, v_rec.step_type, v_rec.step_key,
      v_rec.title, v_rec.summary, v_rec.icon, v_rec.message_text, v_rec.slot_key,
      v_rec.media_order, v_new_transitions, v_rec.captures, v_rec.fallback,
      v_rec.layout, v_rec.text_delay_ms, v_rec.wait_for, v_rec.wait_seconds,
      v_rec.condition_text, v_rec.auto_detect_doc_type, v_rec.persuasive_text,
      v_rec.respect_business_hours, v_rec.pause_on_weekend, v_rec.pause_on_holiday,
      v_rec.business_hour_start, v_rec.business_hour_end, v_rec.is_active
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 4) Reescreve seed_default_camila_flow para usar o template do superadmin
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.seed_default_camila_flow(_consultant_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_template_consultant uuid := '0c2711ad-4836-41e6-afba-edd94f698ae3';
  v_flow_id uuid;
  v_step_count int;
  v_template_steps int;
BEGIN
  -- Não roda no próprio template
  IF _consultant_id = v_template_consultant THEN
    SELECT id INTO v_flow_id
      FROM public.bot_flows
     WHERE consultant_id = _consultant_id AND variant = 'D' AND is_active = true
     ORDER BY created_at ASC LIMIT 1;
    RETURN v_flow_id;
  END IF;

  -- Reutiliza fluxo D existente se já tiver
  SELECT id INTO v_flow_id
    FROM public.bot_flows
   WHERE consultant_id = _consultant_id
     AND is_active = true
     AND variant = 'D'
   ORDER BY created_at ASC
   LIMIT 1;

  IF v_flow_id IS NULL THEN
    INSERT INTO public.bot_flows (consultant_id, name, variant, is_active, strict_mode)
    VALUES (_consultant_id, 'Fluxo Padrão (D)', 'D', true, false)
    RETURNING id INTO v_flow_id;
  END IF;

  -- Se já tem passos, não sobrescreve
  SELECT count(*) INTO v_step_count FROM public.bot_flow_steps WHERE flow_id = v_flow_id;
  IF v_step_count > 0 THEN RETURN v_flow_id; END IF;

  -- Verifica template
  SELECT count(*) INTO v_template_steps
    FROM public.bot_flow_steps bs
    JOIN public.bot_flows bf ON bf.id = bs.flow_id
   WHERE bf.consultant_id = v_template_consultant
     AND bf.variant = 'D'
     AND bf.is_active = true;

  IF v_template_steps > 0 THEN
    PERFORM public.clone_superadmin_flow_d_steps(v_flow_id);
  END IF;

  RETURN v_flow_id;
END;
$function$;

-- ════════════════════════════════════════════════════════════════════
-- 5) Backfill tvmensal01: substitui os 6 passos antigos pelos 16 do template
-- ════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_tvmensal_flow uuid := 'b539a8a2-3ba2-4d36-9d7b-0f3d3df129b3';
  v_tvmensal_consultant uuid := '953f7e48-509b-4069-9822-bdad9902be09';
  v_old_step_keys text[];
  v_inserted int;
BEGIN
  -- Coleta step_keys antigos para reset dos leads
  SELECT array_agg(step_key) INTO v_old_step_keys
    FROM public.bot_flow_steps WHERE flow_id = v_tvmensal_flow;

  -- Apaga passos antigos
  DELETE FROM public.bot_flow_steps WHERE flow_id = v_tvmensal_flow;

  -- Clona o template
  v_inserted := public.clone_superadmin_flow_d_steps(v_tvmensal_flow);

  -- Renomeia o fluxo
  UPDATE public.bot_flows
     SET name = 'Fluxo Padrão (D)', updated_at = now()
   WHERE id = v_tvmensal_flow;

  -- Reset de leads que estavam nos passos antigos
  IF v_old_step_keys IS NOT NULL AND array_length(v_old_step_keys, 1) > 0 THEN
    UPDATE public.customers
       SET conversation_step = NULL,
           updated_at = now()
     WHERE consultant_id = v_tvmensal_consultant
       AND conversation_step = ANY(v_old_step_keys);
  END IF;

  RAISE NOTICE 'tvmensal01 backfill: % steps inserted', v_inserted;
END $$;
