
-- Correções no Fluxo D (Rafael Ferreira)
-- 1) #3 d_como_funciona: remove transition default duplicada, usa fallback goto
-- 2) #8 d_duvidas: substitui botão self-loop "Tenho outra dúvida" → "Quero cadastrar" indo para #5

-- #3 d_como_funciona: transitions limpas + fallback goto #8
UPDATE public.bot_flow_steps
SET
  transitions = '[
    {"trigger_intent":"palavra_chave","trigger_phrases":["Quero simular","simular"],"goto_step_id":"279d3926-5363-403f-af5d-5201e2014598","goto_special":null},
    {"trigger_intent":"palavra_chave","trigger_phrases":["Ainda tenho duvida","duvida","dúvida"],"goto_step_id":"38c0d101-6492-4b1e-8229-c676c804161a","goto_special":null},
    {"trigger_intent":"palavra_chave","trigger_phrases":["Falar com Rafael","humano","atendente"],"goto_step_id":null,"goto_special":"humano"}
  ]'::jsonb,
  fallback = '{"mode":"goto","goto_step_id":"38c0d101-6492-4b1e-8229-c676c804161a"}'::jsonb
WHERE id = 'c87d76f8-f4d2-48ec-ac08-4ef0b3c92834';

-- #8 d_duvidas: troca botão "outra" (self-loop) por "cadastrar" → #5 d_pedir_documento
UPDATE public.bot_flow_steps
SET
  captures = '[
    {"enabled":true,"field":"_buttons","value":[
      {"id":"simular","title":"Quero simular"},
      {"id":"cadastrar","title":"Quero cadastrar"},
      {"id":"humano","title":"Falar com Rafael"}
    ]},
    {"ai_answer":true,"enabled":true,"kind":"text","name":"duvida_livre"}
  ]'::jsonb,
  transitions = '[
    {"trigger_intent":"palavra_chave","trigger_phrases":["Quero simular","simular"],"goto_step_id":"279d3926-5363-403f-af5d-5201e2014598","goto_special":null},
    {"trigger_intent":"palavra_chave","trigger_phrases":["Quero cadastrar","cadastrar"],"goto_step_id":"58f0a7e2-16ce-4ee2-ad07-1466ce7e9f1f","goto_special":null},
    {"trigger_intent":"palavra_chave","trigger_phrases":["Falar com Rafael","humano","atendente"],"goto_step_id":null,"goto_special":"humano"}
  ]'::jsonb
WHERE id = '38c0d101-6492-4b1e-8229-c676c804161a';
