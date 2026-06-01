BEGIN;

-- 1) Novo step: d_simular_valor
INSERT INTO public.bot_flow_steps (
  id, flow_id, position, step_type, slot_key, step_key,
  message_text, wait_for, captures, transitions, fallback,
  title, is_active
) VALUES (
  'b1a51111-1111-4111-8111-000000000001'::uuid,
  '320bf22c-e383-4f53-a3c0-b88b89b02558'::uuid,
  15,
  'message',
  'passo_d_simular_valor',
  'd_simular_valor',
  E'Show! 💡\n\nMe manda só o *valor médio* da sua conta de luz por mês (ex: *300*). Pode escrever só o número que eu já te dou a prévia da economia. ✨',
  'reply',
  '[{"field": "electricity_bill_value", "enabled": true}]'::jsonb,
  jsonb_build_array(
    jsonb_build_object(
      'goto_special', NULL,
      'goto_step_id', 'b1a52222-2222-4222-8222-000000000002',
      'trigger_intent', 'default',
      'trigger_phrases', '[]'::jsonb
    )
  ),
  jsonb_build_object('mode','goto','goto_step_id','b1a52222-2222-4222-8222-000000000002'),
  'Simulação rápida — valor',
  true
)
ON CONFLICT (id) DO UPDATE SET
  message_text = EXCLUDED.message_text,
  captures     = EXCLUDED.captures,
  transitions  = EXCLUDED.transitions,
  fallback     = EXCLUDED.fallback,
  is_active    = true,
  updated_at   = now();

-- 2) Novo step: d_simular_resultado
INSERT INTO public.bot_flow_steps (
  id, flow_id, position, step_type, slot_key, step_key,
  message_text, wait_for, captures, transitions, fallback,
  title, is_active
) VALUES (
  'b1a52222-2222-4222-8222-000000000002'::uuid,
  '320bf22c-e383-4f53-a3c0-b88b89b02558'::uuid,
  16,
  'message',
  'passo_d_simular_resultado',
  'd_simular_resultado',
  E'Olha que ótimo, *{{nome}}*! 👀✨\n\nCom uma conta de cerca de *R$ {{valor_conta}}/mês*, você economiza aproximadamente *{{economia_mensal}}* todo mês com a iGreen — *até 20% de desconto garantido em contrato*. 💚\n\nBora cadastrar? É *gratuito* e *sem fidelidade*.',
  'reply',
  jsonb_build_array(
    jsonb_build_object(
      'field','_buttons',
      'enabled',true,
      'value', jsonb_build_array(
        jsonb_build_object('id','quero_cadastrar','title','✅ Quero me cadastrar')
      )
    )
  ),
  jsonb_build_array(
    jsonb_build_object(
      'goto_special', NULL,
      'goto_step_id', '279d3926-5363-403f-af5d-5201e2014598',
      'trigger_intent', 'palavra_chave',
      'trigger_phrases', jsonb_build_array('quero_cadastrar','cadastrar','quero','sim','bora','vamos','beleza')
    ),
    jsonb_build_object(
      'goto_special', NULL,
      'goto_step_id', '279d3926-5363-403f-af5d-5201e2014598',
      'trigger_intent', 'default',
      'trigger_phrases', '[]'::jsonb
    )
  ),
  jsonb_build_object('mode','goto','goto_step_id','279d3926-5363-403f-af5d-5201e2014598'),
  'Resultado da simulação',
  true
)
ON CONFLICT (id) DO UPDATE SET
  message_text = EXCLUDED.message_text,
  captures     = EXCLUDED.captures,
  transitions  = EXCLUDED.transitions,
  fallback     = EXCLUDED.fallback,
  is_active    = true,
  updated_at   = now();

-- 3) Atualizar d_welcome: texto + 3 botões + transições
UPDATE public.bot_flow_steps
SET
  message_text = E'Olá, seja muito *Bem-Vindo(a)*! 😊\n\nSou a assistente virtual do *{{representante}}* e vou te mostrar se a sua conta de luz tem perfil pra *economizar todo mês* com a iGreen 💚\n\nComo você prefere começar?\n\n📸 *Simulação completa* — me manda a foto da conta de luz e eu calculo o valor exato.\n💡 *Simulação rápida* — me diz só o valor médio da conta e eu já te dou uma prévia.',
  captures = jsonb_build_array(
    jsonb_build_object(
      'field','_buttons',
      'enabled', true,
      'value', jsonb_build_array(
        jsonb_build_object('id','simular_completa','title','📸 Conta completa'),
        jsonb_build_object('id','simular_valor','title','💡 Só o valor'),
        jsonb_build_object('id','como','title','🤔 Como funciona')
      )
    )
  ),
  transitions = jsonb_build_array(
    jsonb_build_object(
      'goto_special', NULL,
      'goto_step_id', '279d3926-5363-403f-af5d-5201e2014598',
      'trigger_intent', 'palavra_chave',
      'trigger_phrases', jsonb_build_array('simular_completa','completa','foto','conta','simular')
    ),
    jsonb_build_object(
      'goto_special', NULL,
      'goto_step_id', 'b1a51111-1111-4111-8111-000000000001',
      'trigger_intent', 'palavra_chave',
      'trigger_phrases', jsonb_build_array('simular_valor','valor','rapida','rápida','só o valor','so o valor')
    ),
    jsonb_build_object(
      'goto_special', NULL,
      'goto_step_id', 'c87d76f8-f4d2-48ec-ac08-4ef0b3c92834',
      'trigger_intent', 'palavra_chave',
      'trigger_phrases', jsonb_build_array('como','como funciona')
    ),
    jsonb_build_object(
      'goto_special', 'humano',
      'goto_step_id', NULL,
      'trigger_intent', 'palavra_chave',
      'trigger_phrases', jsonb_build_array('humano','rafael','atendente','falar')
    )
  ),
  updated_at = now()
WHERE id = 'aee7b26c-7669-448b-9def-77dc8466b039';

COMMIT;