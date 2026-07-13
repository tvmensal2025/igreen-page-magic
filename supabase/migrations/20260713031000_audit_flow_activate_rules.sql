-- ============================================================================
-- Auditoria READ-ONLY das regras Ativar/Cadastrar vs Simular (F16)
-- ============================================================================
-- NÃO altera nenhum dado. Apenas LISTA violações da regra de ouro em qualquer
-- fluxo (atual ou futuro):
--
--   R1. Transition com gatilho ativar/cadastrar apontando para conta de
--       SIMULAÇÃO (conta cujo caminho leva a "resultado", não a documento)
--       ou para o seletor de simulação.
--   R2. Transition ativar/cadastrar apontando DIRETO para documento quando
--       o fluxo tem conta de CADASTRO (pulo da foto da conta — o motor
--       corrige em runtime, mas o grafo deve apontar certo).
--
-- Uso (Super Admin / SQL editor):
--   SELECT * FROM public.audit_flow_activate_rules();          -- todos os fluxos ativos
--   SELECT * FROM public.audit_flow_activate_rules('<flow_id>'); -- um fluxo
--
-- O motor (flow-activate-routing.ts) continua corrigindo em runtime mesmo se
-- esta auditoria apontar problema — esta função serve para ENXERGAR e corrigir
-- o grafo na origem, principalmente após criar/clonar fluxos novos.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.audit_flow_activate_rules(_flow_id uuid DEFAULT NULL)
RETURNS TABLE (
  flow_id uuid,
  flow_name text,
  step_id uuid,
  step_key text,
  rule text,
  problem text,
  dest_step_key text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH flows AS (
    SELECT f.id, f.name
    FROM bot_flows f
    WHERE f.is_active = true
      AND (_flow_id IS NULL OR f.id = _flow_id)
  ),
  steps AS (
    SELECT s.id, s.flow_id, s.step_key, s.step_type, s.is_active,
           COALESCE(s.transitions, '[]'::jsonb) AS transitions,
           s.fallback
    FROM bot_flow_steps s
    JOIN flows f ON f.id = s.flow_id
  ),
  -- Saídas de cada passo (success_goto, goto, transitions) — espelha o motor
  edges AS (
    SELECT s.id AS from_id, s.flow_id,
           (s.fallback->>'success_goto_step_id')::uuid AS to_id
    FROM steps s
    WHERE (s.fallback->>'success_goto_step_id') IS NOT NULL
    UNION ALL
    SELECT s.id, s.flow_id, (s.fallback->>'goto_step_id')::uuid
    FROM steps s
    WHERE s.fallback->>'mode' = 'goto' AND (s.fallback->>'goto_step_id') IS NOT NULL
    UNION ALL
    SELECT s.id, s.flow_id, (tr->>'goto_step_id')::uuid
    FROM steps s, jsonb_array_elements(s.transitions) AS tr
    WHERE (tr->>'goto_step_id') IS NOT NULL
  ),
  -- Conta de CADASTRO: capture_conta cujo próximo passo (1 nível) é documento
  conta_cadastro AS (
    SELECT DISTINCT s.id, s.flow_id
    FROM steps s
    JOIN edges e ON e.from_id = s.id
    JOIN steps n ON n.id = e.to_id AND n.flow_id = s.flow_id
    WHERE s.step_type = 'capture_conta' AND s.is_active
      AND (n.step_type = 'capture_documento' OR n.step_key ILIKE '%documento%')
  ),
  -- Transitions com gatilho ativar/cadastrar
  activate_edges AS (
    SELECT s.flow_id, s.id AS step_id, s.step_key,
           (tr->>'goto_step_id')::uuid AS dest_id
    FROM steps s, jsonb_array_elements(s.transitions) AS tr
    WHERE s.is_active
      AND (tr->>'goto_step_id') IS NOT NULL
      AND (
        (tr->>'trigger_intent') ~* '(ativar|cadastr)'
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(tr->'trigger_phrases','[]'::jsonb)) p
          WHERE p ~* '(ativar|cadastr)'
        )
      )
  )
  -- R1: ativar/cadastrar → seletor de simulação OU conta de simulação
  SELECT ae.flow_id, f.name, ae.step_id, ae.step_key,
         'R1_activate_to_sim'::text,
         'Ativar/cadastrar aponta para caminho de SIMULAÇÃO'::text,
         d.step_key
  FROM activate_edges ae
  JOIN flows f ON f.id = ae.flow_id
  JOIN steps d ON d.id = ae.dest_id AND d.flow_id = ae.flow_id
  WHERE d.step_key ~* '(escolher_simulacao|simular_valor)'
     OR (
       d.step_type = 'capture_conta'
       AND d.id NOT IN (SELECT cc.id FROM conta_cadastro cc WHERE cc.flow_id = ae.flow_id)
     )
  UNION ALL
  -- R2: ativar/cadastrar → documento DIRETO com conta de cadastro disponível
  SELECT ae.flow_id, f.name, ae.step_id, ae.step_key,
         'R2_activate_skips_conta'::text,
         'Ativar/cadastrar pula a conta de cadastro e vai direto ao documento'::text,
         d.step_key
  FROM activate_edges ae
  JOIN flows f ON f.id = ae.flow_id
  JOIN steps d ON d.id = ae.dest_id AND d.flow_id = ae.flow_id
  WHERE (d.step_type = 'capture_documento' OR d.step_key ILIKE '%pedir_documento%')
    AND EXISTS (SELECT 1 FROM conta_cadastro cc WHERE cc.flow_id = ae.flow_id);
$$;

-- Apenas leitura; seguro conceder a authenticated (admins usam no painel/SQL)
GRANT EXECUTE ON FUNCTION public.audit_flow_activate_rules(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.audit_flow_activate_rules(uuid) TO service_role;

COMMENT ON FUNCTION public.audit_flow_activate_rules(uuid) IS
  'Auditoria read-only F16: lista transitions ativar/cadastrar que apontam para simulação (R1) ou pulam a conta de cadastro (R2). Não altera dados. Vale para qualquer fluxo, atual ou futuro.';
