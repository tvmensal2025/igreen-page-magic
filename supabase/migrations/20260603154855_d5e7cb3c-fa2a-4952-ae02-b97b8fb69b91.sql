UPDATE bot_flow_steps
SET captures = '[{"enabled":true,"field":"_buttons","value":[{"id":"cadastrar","title":"✅ Quero me cadastrar"},{"id":"duvida","title":"💬 Tenho uma pergunta"},{"id":"humano","title":"👨‍💼 Falar com Rafael"}]}]'::jsonb,
    transitions = '[
      {"goto_special":null,"goto_step_id":"b1a53333-3333-4333-8333-000000000003","trigger_intent":"palavra_chave","trigger_phrases":["cadastrar","quero me cadastrar","quero cadastrar","cadastro","1","1.","1)","primeiro","primeira","um"]},
      {"goto_special":null,"goto_step_id":"38c0d101-6492-4b1e-8229-c676c804161a","trigger_intent":"palavra_chave","trigger_phrases":["duvida","dúvida","pergunta","tenho uma pergunta","tenho dúvida","2","2.","2)","segundo","segunda","dois"]},
      {"goto_special":"humano","goto_step_id":null,"trigger_intent":"palavra_chave","trigger_phrases":["humano","rafael","falar com rafael","3","3.","3)","terceiro","terceira","três","tres"]}
    ]'::jsonb
WHERE id = 'c87d76f8-f4d2-48ec-ac08-4ef0b3c92834';