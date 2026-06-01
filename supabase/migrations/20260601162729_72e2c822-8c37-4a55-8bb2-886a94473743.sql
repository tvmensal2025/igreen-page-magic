UPDATE bot_flow_steps
SET
  fallback = '{"mode":"repeat"}'::jsonb,
  transitions = '[
    {"goto_special":null,"goto_step_id":"279d3926-5363-403f-af5d-5201e2014598","trigger_intent":"palavra_chave","trigger_phrases":["simular_completa","completa","foto","conta","simulacao completa","simulação completa","quero completa","foto da conta","mandar conta"]},
    {"goto_special":null,"goto_step_id":"b1a51111-1111-4111-8111-000000000001","trigger_intent":"palavra_chave","trigger_phrases":["simular_rapida","rapida","rápida","valor","só o valor","so o valor","simulacao rapida","simulação rápida","rapido","rápido","quero rapida","quero rápida"]}
  ]'::jsonb,
  updated_at = now()
WHERE id = 'b1a53333-3333-4333-8333-000000000003';