UPDATE bot_flow_steps 
SET step_key = 'd_simular_pedir_conta', 
    updated_at = now() 
WHERE id = 'bc7a1652-ccef-4366-a7d1-8bf1cda01536';

UPDATE bot_flow_steps 
SET transitions = '[
  {"goto_step_id": "38c0d101-6492-4b1e-8229-c676c804161a", "trigger_intent": "palavra_chave", "trigger_phrases": ["duvida", "dúvida"]},
  {"goto_special": "humano", "goto_step_id": null, "trigger_intent": "palavra_chave", "trigger_phrases": ["humano", "rafael", "falar"]},
  {"goto_step_id": "bc7a1652-ccef-4366-a7d1-8bf1cda01536", "trigger_intent": "palavra_chave", "trigger_phrases": ["continuar", "cadastrar"]},
  {"goto_step_id": "bc7a1652-ccef-4366-a7d1-8bf1cda01536", "trigger_intent": "default", "trigger_phrases": []}
]'::jsonb,
    updated_at = now()
WHERE id = 'b1a52222-2222-4222-8222-000000000002';