
UPDATE public.bot_flow_steps
SET
  transitions = '[
    {"goto_special": null, "goto_step_id": "279d3926-5363-403f-af5d-5201e2014598", "trigger_intent": "palavra_chave", "trigger_phrases": ["Quero cadastrar","cadastrar"]},
    {"goto_special": null, "goto_step_id": "b1a53333-3333-4333-8333-000000000003", "trigger_intent": "palavra_chave", "trigger_phrases": ["Quero simular","simular"]},
    {"goto_special": "humano", "goto_step_id": null, "trigger_intent": "palavra_chave", "trigger_phrases": ["Falar com Rafael","humano","atendente"]}
  ]'::jsonb,
  updated_at = now()
WHERE id = '38c0d101-6492-4b1e-8229-c676c804161a'::uuid;
