-- ============================================================================
-- Fix Fluxo D — botão "Quero cadastrar" do passo d_duvidas pulava a conta de luz
-- ============================================================================
-- Problema: no banco vivo, a transição "cadastrar" de d_duvidas estava como
-- `goto_special: "cadastro"`. O engine (conversational/index.ts → resolveTransition)
-- resolve "cadastro" para o primeiro step ativo do tipo `capture_documento`,
-- ou seja, pulava DIRETO para d_pedir_documento (#5), sem nunca pedir a conta
-- de luz (#2) nem mostrar a simulação (#4). Resultado: leads concluíam o
-- cadastro sem electricity_bill_value nem a foto da conta.
--
-- Esta migration restaura a correção pretendida (ver 20260530092334), que foi
-- revertida por uma edição manual em /admin/fluxos: "Quero cadastrar" deve ir
-- para d_pedir_conta (#2) → garante a ordem conta → simulação → documento.
--
-- IDs dos steps (flow_id = 320bf22c-e383-4f53-a3c0-b88b89b02558):
--   d_pedir_conta      = 279d3926-5363-403f-af5d-5201e2014598
--   d_pedir_documento  = 58f0a7e2-16ce-4ee2-ad07-1466ce7e9f1f
--   d_duvidas          = 38c0d101-6492-4b1e-8229-c676c804161a
-- Idempotente: reescreve o array transitions por completo.

UPDATE public.bot_flow_steps
SET transitions = '[
  {"goto_special": null, "goto_step_id": "279d3926-5363-403f-af5d-5201e2014598", "trigger_intent": "palavra_chave", "trigger_phrases": ["Quero cadastrar", "cadastrar"]},
  {"goto_special": null, "goto_step_id": "279d3926-5363-403f-af5d-5201e2014598", "trigger_intent": "palavra_chave", "trigger_phrases": ["Quero simular", "simular"]},
  {"goto_special": "humano", "goto_step_id": null, "trigger_intent": "palavra_chave", "trigger_phrases": ["Falar com Rafael", "humano", "atendente"]}
]'::jsonb
WHERE id = '38c0d101-6492-4b1e-8229-c676c804161a'
  AND flow_id = '320bf22c-e383-4f53-a3c0-b88b89b02558';
