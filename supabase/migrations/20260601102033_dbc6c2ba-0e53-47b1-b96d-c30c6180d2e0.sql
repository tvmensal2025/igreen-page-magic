
-- 1. Create new intermediate step d_escolher_simulacao
INSERT INTO public.bot_flow_steps (id, flow_id, step_key, position, step_type, message_text, transitions, captures, is_active)
SELECT
  'b1a53333-3333-4333-8333-000000000003'::uuid,
  flow_id,
  'd_escolher_simulacao',
  17,
  step_type,
  E'Show! 🙌 Você prefere qual tipo de simulação?\n\n📸 *Simulação completa* — me manda a foto da conta de luz e eu calculo o valor exato.\n\n💡 *Simulação rápida* — me diz só o valor médio da conta e eu já te dou uma prévia.',
  '[
    {"goto_special": null, "goto_step_id": "279d3926-5363-403f-af5d-5201e2014598", "trigger_intent": "palavra_chave", "trigger_phrases": ["simular_completa","completa","foto","conta"]},
    {"goto_special": null, "goto_step_id": "b1a51111-1111-4111-8111-000000000001", "trigger_intent": "palavra_chave", "trigger_phrases": ["simular_rapida","rapida","rápida","valor","só o valor","so o valor"]}
  ]'::jsonb,
  '[{"enabled": true, "field": "_buttons", "value": [
    {"id": "simular_completa", "title": "📸 Simulação completa"},
    {"id": "simular_rapida", "title": "💡 Simulação rápida"}
  ]}]'::jsonb,
  true
FROM public.bot_flow_steps
WHERE id = 'aee7b26c-7669-448b-9def-77dc8466b039'::uuid
ON CONFLICT (id) DO UPDATE SET
  message_text = EXCLUDED.message_text,
  transitions = EXCLUDED.transitions,
  captures = EXCLUDED.captures,
  step_key = EXCLUDED.step_key,
  is_active = true,
  updated_at = now();

-- 2. Update d_welcome back to original 3 buttons
UPDATE public.bot_flow_steps
SET
  message_text = E'Olá, seja muito *Bem-Vindo(a)*! 😊\n\nSou a assistente virtual do *{{representante}}* e vou te mostrar se a sua conta de luz tem perfil pra *economizar todo mês* com a iGreen 💚\n\nComo posso te ajudar?',
  captures = '[{"enabled": true, "field": "_buttons", "value": [
    {"id": "quero_simular", "title": "💚 Quero simular"},
    {"id": "como", "title": "🤔 Como funciona"},
    {"id": "humano", "title": "👨‍💼 Falar com Rafael"}
  ]}]'::jsonb,
  transitions = '[
    {"goto_special": null, "goto_step_id": "b1a53333-3333-4333-8333-000000000003", "trigger_intent": "palavra_chave", "trigger_phrases": ["quero_simular","simular","quero simular","simulação","simulacao"]},
    {"goto_special": null, "goto_step_id": "c87d76f8-f4d2-48ec-ac08-4ef0b3c92834", "trigger_intent": "palavra_chave", "trigger_phrases": ["como","como funciona"]},
    {"goto_special": "humano", "goto_step_id": null, "trigger_intent": "palavra_chave", "trigger_phrases": ["humano","rafael","atendente","falar"]}
  ]'::jsonb,
  updated_at = now()
WHERE id = 'aee7b26c-7669-448b-9def-77dc8466b039'::uuid;

-- 3. Update d_simular_resultado: new text + 3 buttons mirroring d_como_funciona
UPDATE public.bot_flow_steps
SET
  message_text = E'Olha que ótimo! 👀✨🎉\n\n💡 Sua conta hoje: *R$ {{valor_conta}}*\n\n💚 Economia estimada: *{{economia_range}}* por mês\n\nE o melhor:\n\n✅ Sem investimento\n✅ Sem obra\n✅ Sem instalação\n✅ *Mesma* distribuidora\n\nBora cadastrar? É *gratuito* e *sem fidelidade*. 🚀',
  captures = '[{"enabled": true, "field": "_buttons", "value": [
    {"id": "cadastrar", "title": "Continuar Cadastro"},
    {"id": "duvida", "title": "Ainda tenho dúvida"},
    {"id": "humano", "title": "Falar com Rafael"}
  ]}]'::jsonb,
  transitions = '[
    {"goto_special": null, "goto_step_id": "279d3926-5363-403f-af5d-5201e2014598", "trigger_intent": "palavra_chave", "trigger_phrases": ["cadastrar"]},
    {"goto_special": null, "goto_step_id": "38c0d101-6492-4b1e-8229-c676c804161a", "trigger_intent": "palavra_chave", "trigger_phrases": ["duvida","dúvida"]},
    {"goto_special": "humano", "goto_step_id": null, "trigger_intent": "palavra_chave", "trigger_phrases": ["humano","rafael","falar"]}
  ]'::jsonb,
  updated_at = now()
WHERE id = 'b1a52222-2222-4222-8222-000000000002'::uuid;
