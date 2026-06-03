UPDATE public.bot_flow_steps
SET
  captures = '[
    {"enabled": true, "field": "_buttons", "value": [
      {"id": "cadastrar", "title": "✅ Cadastrar agora"},
      {"id": "nova_pergunta", "title": "💬 Fazer mais uma pergunta"},
      {"id": "humano", "title": "👤 Falar com Rafael"}
    ]},
    {"ai_answer": true, "enabled": true, "kind": "text", "name": "duvida_livre"}
  ]'::jsonb,
  transitions = '[
    {"goto_special": null, "goto_step_id": "58f0a7e2-16ce-4ee2-ad07-1466ce7e9f1f", "trigger_intent": "cadastrar", "trigger_phrases": ["cadastrar", "quero cadastrar"]},
    {"goto_special": "repeat", "goto_step_id": null, "trigger_intent": "nova_pergunta", "trigger_phrases": []},
    {"goto_special": "humano", "goto_step_id": null, "trigger_intent": "humano", "trigger_phrases": ["humano", "atendente", "rafael", "falar com rafael"]}
  ]'::jsonb,
  fallback = jsonb_set(
    jsonb_set(fallback, '{ai_prompt}', to_jsonb(replace(fallback->>'ai_prompt', 'Camila', 'Rafael'))),
    '{after_ai}', '"stay"'::jsonb
  ),
  updated_at = now()
WHERE id = '38c0d101-6492-4b1e-8229-c676c804161a';