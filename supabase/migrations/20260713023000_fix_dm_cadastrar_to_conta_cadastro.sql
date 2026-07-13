-- =============================================================================
-- Fluxo D + M: cadastrar/ativar em d_como_funciona e d_duvidas
-- → SEMPRE d_simular_pedir_conta (conta de CADASTRO → documento).
--
-- NÃO usa UUID fixo (M tem IDs diferentes). Resolve destino por step_key
-- dentro do mesmo flow_id.
--
-- Problemas que corrige (sem apagar passos):
--   d_como_funciona: cadastrar → d_pedir_conta (SIMULAÇÃO) ❌
--   d_duvidas:       cadastrar → d_pedir_documento (pula conta) ❌
-- =============================================================================

DO $$
DECLARE
  r RECORD;
  dest_id text;
  new_transitions jsonb;
  tr jsonb;
  phrase text;
  is_cadastro boolean;
  rebuilt jsonb := '[]'::jsonb;
BEGIN
  FOR r IN
    SELECT s.id AS step_id, s.flow_id, s.step_key, s.transitions
    FROM public.bot_flow_steps s
    JOIN public.bot_flows f ON f.id = s.flow_id
    WHERE s.step_key IN ('d_como_funciona', 'd_duvidas')
      AND s.is_active IS DISTINCT FROM false
      AND f.is_active IS DISTINCT FROM false
      AND COALESCE(f.variant, '') IN ('D', 'M')
  LOOP
    SELECT id::text INTO dest_id
    FROM public.bot_flow_steps
    WHERE flow_id = r.flow_id
      AND step_key = 'd_simular_pedir_conta'
      AND is_active IS DISTINCT FROM false
    LIMIT 1;

    IF dest_id IS NULL THEN
      RAISE NOTICE 'flow % sem d_simular_pedir_conta — pulando step %', r.flow_id, r.step_key;
      CONTINUE;
    END IF;

    rebuilt := '[]'::jsonb;
    FOR tr IN SELECT * FROM jsonb_array_elements(COALESCE(r.transitions, '[]'::jsonb))
    LOOP
      is_cadastro := false;

      IF lower(COALESCE(tr->>'trigger_intent', '')) IN ('cadastrar', 'cadastro') THEN
        is_cadastro := true;
      END IF;

      IF tr ? 'trigger_phrases' AND jsonb_typeof(tr->'trigger_phrases') = 'array' THEN
        FOR phrase IN SELECT jsonb_array_elements_text(tr->'trigger_phrases')
        LOOP
          IF lower(phrase) ~ 'cadastr|ativar|continuar\s+cadastro' THEN
            is_cadastro := true;
          END IF;
        END LOOP;
      END IF;

      IF is_cadastro THEN
        tr := tr
          || jsonb_build_object('goto_step_id', dest_id)
          || jsonb_build_object('goto_special', null);
      END IF;

      rebuilt := rebuilt || jsonb_build_array(tr);
    END LOOP;

    UPDATE public.bot_flow_steps
    SET transitions = rebuilt,
        updated_at = now()
    WHERE id = r.step_id;

    RAISE NOTICE 'fixed % (flow %) cadastrar→d_simular_pedir_conta=%', r.step_key, r.flow_id, dest_id;
  END LOOP;
END $$;
