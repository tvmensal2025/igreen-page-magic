
-- ============================================================
-- A. Desativar 2 passos inalcançáveis (cada UPDATE por ID único)
-- ============================================================
UPDATE bot_flow_steps SET is_active = false
WHERE id = '7a85cc99-6fdf-4e5c-8752-d51b92e9bd09'; -- d_handoff

UPDATE bot_flow_steps SET is_active = false
WHERE id = 'dc43c090-62e8-4429-bc7d-d5e2230c2a26'; -- d_como_funciona_copy_in3s

-- ============================================================
-- B. Helper inline: remove phrases curtas problemáticas das transitions
--    de UM passo específico. Cada UPDATE escopado por id único.
--    Lista removida: um, dois, tres, três, como
-- ============================================================

-- d_welcome
UPDATE bot_flow_steps SET transitions = (
  SELECT jsonb_agg(
    jsonb_set(
      t,
      '{trigger_phrases}',
      COALESCE(
        (SELECT jsonb_agg(p) FROM jsonb_array_elements_text(t->'trigger_phrases') p
         WHERE lower(p) NOT IN ('um','dois','tres','três','como')),
        '[]'::jsonb
      )
    )
  )
  FROM jsonb_array_elements(transitions) t
)
WHERE id = 'aee7b26c-7669-448b-9def-77dc8466b039';

-- d_como_funciona
UPDATE bot_flow_steps SET transitions = (
  SELECT jsonb_agg(
    jsonb_set(
      t,
      '{trigger_phrases}',
      COALESCE(
        (SELECT jsonb_agg(p) FROM jsonb_array_elements_text(t->'trigger_phrases') p
         WHERE lower(p) NOT IN ('um','dois','tres','três','como')),
        '[]'::jsonb
      )
    )
  )
  FROM jsonb_array_elements(transitions) t
)
WHERE id = 'c87d76f8-f4d2-48ec-ac08-4ef0b3c92834';

-- d_resultado
UPDATE bot_flow_steps SET transitions = (
  SELECT jsonb_agg(
    jsonb_set(
      t,
      '{trigger_phrases}',
      COALESCE(
        (SELECT jsonb_agg(p) FROM jsonb_array_elements_text(t->'trigger_phrases') p
         WHERE lower(p) NOT IN ('um','dois','tres','três','como')),
        '[]'::jsonb
      )
    )
  )
  FROM jsonb_array_elements(transitions) t
)
WHERE id = '4df1f90a-0248-4df0-9473-4c910f1b22bd';

-- d_simular_resultado
UPDATE bot_flow_steps SET transitions = (
  SELECT jsonb_agg(
    jsonb_set(
      t,
      '{trigger_phrases}',
      COALESCE(
        (SELECT jsonb_agg(p) FROM jsonb_array_elements_text(t->'trigger_phrases') p
         WHERE lower(p) NOT IN ('um','dois','tres','três','como')),
        '[]'::jsonb
      )
    )
  )
  FROM jsonb_array_elements(transitions) t
)
WHERE id = 'b1a52222-2222-4222-8222-000000000002';

-- d_escolher_simulacao
UPDATE bot_flow_steps SET transitions = (
  SELECT jsonb_agg(
    jsonb_set(
      t,
      '{trigger_phrases}',
      COALESCE(
        (SELECT jsonb_agg(p) FROM jsonb_array_elements_text(t->'trigger_phrases') p
         WHERE lower(p) NOT IN ('um','dois','tres','três','como')),
        '[]'::jsonb
      )
    )
  )
  FROM jsonb_array_elements(transitions) t
)
WHERE id = 'b1a53333-3333-4333-8333-000000000003';

-- d_como_funciona_copy_qwpu
UPDATE bot_flow_steps SET transitions = (
  SELECT jsonb_agg(
    jsonb_set(
      t,
      '{trigger_phrases}',
      COALESCE(
        (SELECT jsonb_agg(p) FROM jsonb_array_elements_text(t->'trigger_phrases') p
         WHERE lower(p) NOT IN ('um','dois','tres','três','como')),
        '[]'::jsonb
      )
    )
  )
  FROM jsonb_array_elements(transitions) t
)
WHERE id = '26b106c7-2679-42cb-b7f6-9392e4049f6d';

-- ============================================================
-- C. Corrigir typo do botão Cadastrar em d_como_funciona_copy_qwpu
--    (apenas captures[0].value[0].title, sem tocar trigger_phrases)
-- ============================================================
UPDATE bot_flow_steps
SET captures = jsonb_set(captures, '{0,value,0,title}', '"✅ Continuar Cadastro"')
WHERE id = '26b106c7-2679-42cb-b7f6-9392e4049f6d';
