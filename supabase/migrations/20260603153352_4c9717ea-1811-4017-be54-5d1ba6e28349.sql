
-- d_welcome: copy nova (Opção 1) + botão "como" com emoji 🎥
UPDATE public.bot_flow_steps
SET message_text = E'Oi, {{nome}}! 👋\n\nVi que você se interessou em *reduzir a conta de luz em até 20%* — sem obra, sem instalação, na mesma distribuidora. 💚\n\nEm 2 minutos eu te mostro *quanto você economiza por mês*. Posso começar? 👇',
    captures = '[{"enabled":true,"field":"_buttons","value":[
      {"id":"quero_simular","title":"💚 Quero simular"},
      {"id":"como","title":"🎥 Como funciona"},
      {"id":"humano","title":"👨‍💼 Falar com Rafael"}
    ]}]'::jsonb,
    updated_at = now()
WHERE id = 'aee7b26c-7669-448b-9def-77dc8466b039';

-- d_resultado: botão "duvida" passa a apontar pra d_como_funciona (vídeo)
UPDATE public.bot_flow_steps
SET captures = '[{"enabled":true,"field":"_buttons","value":[
      {"id":"cadastrar","title":"✅ Quero me cadastrar"},
      {"id":"duvida","title":"🎥 Como funciona"},
      {"id":"humano","title":"👨‍💼 Falar com Rafael"}
    ]}]'::jsonb,
    transitions = '[
      {"goto_special":null,"goto_step_id":"58f0a7e2-16ce-4ee2-ad07-1466ce7e9f1f","trigger_intent":"palavra_chave","trigger_phrases":["1","um","primeiro","primeira","1.","1)","cadastrar","quero me cadastrar"]},
      {"goto_special":null,"goto_step_id":"c87d76f8-f4d2-48ec-ac08-4ef0b3c92834","trigger_intent":"palavra_chave","trigger_phrases":["2","dois","segundo","segunda","2.","2)","duvida","como","como funciona","video","vídeo"]},
      {"goto_special":"humano","goto_step_id":null,"trigger_intent":"palavra_chave","trigger_phrases":["3","tres","três","terceiro","terceira","3.","3)","humano","atendente","rafael","falar com rafael"]}
    ]'::jsonb,
    updated_at = now()
WHERE id = '4df1f90a-0248-4df0-9473-4c910f1b22bd';

-- d_simular_resultado: consertar swap + alinhar com d_resultado
UPDATE public.bot_flow_steps
SET captures = '[{"enabled":true,"field":"_buttons","value":[
      {"id":"cadastrar","title":"✅ Quero me cadastrar"},
      {"id":"duvida","title":"🎥 Como funciona"},
      {"id":"humano","title":"👨‍💼 Falar com Rafael"}
    ]}]'::jsonb,
    transitions = '[
      {"goto_special":null,"goto_step_id":"58f0a7e2-16ce-4ee2-ad07-1466ce7e9f1f","trigger_intent":"palavra_chave","trigger_phrases":["1","um","primeiro","primeira","1.","1)","cadastrar","quero me cadastrar"]},
      {"goto_special":null,"goto_step_id":"c87d76f8-f4d2-48ec-ac08-4ef0b3c92834","trigger_intent":"palavra_chave","trigger_phrases":["2","dois","segundo","segunda","2.","2)","duvida","como","como funciona","video","vídeo"]},
      {"goto_special":"humano","goto_step_id":null,"trigger_intent":"palavra_chave","trigger_phrases":["3","tres","três","terceiro","terceira","3.","3)","humano","atendente","rafael","falar com rafael"]}
    ]'::jsonb,
    updated_at = now()
WHERE id = 'b1a52222-2222-4222-8222-000000000002';

-- d_duvidas: vira fallback de texto livre (sem botão), AI responde
UPDATE public.bot_flow_steps
SET message_text = E'{{nome}}, manda sua *pergunta* aqui que eu te respondo na hora 💬\n\n_(ou digite *cadastrar* pra continuar, ou *humano* pra falar com o Rafael)_',
    captures = '[{"ai_answer":true,"enabled":true,"kind":"text","name":"duvida_livre"}]'::jsonb,
    transitions = '[
      {"goto_special":null,"goto_step_id":"58f0a7e2-16ce-4ee2-ad07-1466ce7e9f1f","trigger_intent":"palavra_chave","trigger_phrases":["cadastrar","quero cadastrar","quero me cadastrar","continuar","prosseguir"]},
      {"goto_special":null,"goto_step_id":"b1a53333-3333-4333-8333-000000000003","trigger_intent":"palavra_chave","trigger_phrases":["simular","quero simular","simulação","simulacao"]},
      {"goto_special":"humano","goto_step_id":null,"trigger_intent":"palavra_chave","trigger_phrases":["humano","atendente","rafael","falar com rafael","pessoa"]}
    ]'::jsonb,
    updated_at = now()
WHERE id = '38c0d101-6492-4b1e-8229-c676c804161a';
