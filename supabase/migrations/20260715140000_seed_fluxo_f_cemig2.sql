-- Fluxo F "CEMIG 2" para o superadmin (rafael).
-- NÃO adiciona F em active_variants — não recebe leads até ligar no /admin/fluxos.
-- Ordem: nome → gasto → como funciona → CTA → (não|conta→doc→email→tel→finalizar)

DO $$
DECLARE
  v_consultant uuid := '0c2711ad-4836-41e6-afba-edd94f698ae3';
  v_flow_id uuid;
  s_nome uuid := gen_random_uuid();
  s_gasto uuid := gen_random_uuid();
  s_explica uuid := gen_random_uuid();
  s_cta uuid := gen_random_uuid();
  s_nao uuid := gen_random_uuid();
  s_conta uuid := gen_random_uuid();
  s_doc uuid := gen_random_uuid();
  s_email uuid := gen_random_uuid();
  s_tel uuid := gen_random_uuid();
  s_fim uuid := gen_random_uuid();
BEGIN
  -- Se já existir F ativo deste consultor, não duplica
  SELECT id INTO v_flow_id
  FROM public.bot_flows
  WHERE consultant_id = v_consultant
    AND variant = 'F'
    AND is_active = true
  LIMIT 1;

  IF v_flow_id IS NOT NULL THEN
    RAISE NOTICE 'Fluxo F já existe (%) — pulando criação', v_flow_id;
    RETURN;
  END IF;

  INSERT INTO public.bot_flows (
    consultant_id, name, variant, is_active, is_public, sync_mode, strict_mode
  ) VALUES (
    v_consultant, 'CEMIG 2', 'F', true, false, 'custom', false
  )
  RETURNING id INTO v_flow_id;

  -- 1) Nome
  INSERT INTO public.bot_flow_steps (
    id, flow_id, position, step_type, step_key, slot_key, title, summary, icon,
    message_text, captures, fallback, transitions, media_order
  ) VALUES (
    s_nome, v_flow_id, 1, 'capture_name', 'f_pedir_nome', 'f_pedir_nome',
    'Pedir nome', 'Salva o nome do lead', 'user',
    E'Olá! Me chamo *Rafael* e vou iniciar o seu atendimento.\n\nQual o *seu nome* pra eu adicionar aqui?',
    '[{"field":"name","enabled":true}]'::jsonb,
    jsonb_build_object('mode', 'goto', 'goto_step_id', s_gasto::text),
    '[]'::jsonb,
    '["text"]'::jsonb
  );

  -- 2) Gasto mensal (valor digitado)
  INSERT INTO public.bot_flow_steps (
    id, flow_id, position, step_type, step_key, slot_key, title, summary, icon,
    message_text, captures, fallback, transitions, media_order
  ) VALUES (
    s_gasto, v_flow_id, 2, 'message', 'f_pedir_gasto', 'f_pedir_gasto',
    'Gasto de energia', 'Salva electricity_bill_value', 'msg',
    E'Prazer, *{{nome}}*!\n\nMe diz: quanto você gasta *mais ou menos* de energia por mês?\n\n_(ex: 250, 300, 450)_',
    '[{"field":"electricity_bill_value","enabled":true}]'::jsonb,
    jsonb_build_object('mode', 'goto', 'goto_step_id', s_explica::text),
    '[]'::jsonb,
    '["text"]'::jsonb
  );

  -- 3) Explicação rápida
  INSERT INTO public.bot_flow_steps (
    id, flow_id, position, step_type, step_key, slot_key, title, summary, icon,
    message_text, captures, fallback, transitions, media_order
  ) VALUES (
    s_explica, v_flow_id, 3, 'message', 'f_como_funciona', 'f_como_funciona',
    'Como funciona', 'Explicação rápida do projeto', 'sparkle',
    E'Show! Com conta em torno de *{{valor_conta}}*, dá pra olhar um desconto bom.\n\n*Como funciona (bem rápido):*\n• Você continua com a mesma distribuidora (luz na tomada igual)\n• Entra num projeto de energia limpa\n• A economia aparece na fatura, *sem obra* e *sem instalação*\n\nÉ regulamentado e já são centenas de milhares de pessoas no Brasil.',
    '[]'::jsonb,
    jsonb_build_object('mode', 'goto', 'goto_step_id', s_cta::text),
    '[{"trigger_intent":"default","trigger_phrases":[],"goto_step_id":"' || s_cta::text || '","goto_special":null}]'::jsonb,
    '["text"]'::jsonb
  );

  -- 4) CTA cadastrar
  INSERT INTO public.bot_flow_steps (
    id, flow_id, position, step_type, step_key, slot_key, title, summary, icon,
    message_text, captures, fallback, transitions, media_order
  ) VALUES (
    s_cta, v_flow_id, 4, 'message', 'f_vamos_cadastrar', 'f_vamos_cadastrar',
    'Vamos cadastrar?', 'Porta de decisão', 'msg',
    E'Faz sentido pra você?\n\n*Vamos cadastrar?* É grátis e leva poucos minutos.',
    jsonb_build_array(
      jsonb_build_object(
        'field', '_buttons',
        'enabled', true,
        'value', jsonb_build_array(
          jsonb_build_object('id', 'sim_cadastrar', 'title', 'Sim, vamos'),
          jsonb_build_object('id', 'nao_agora', 'title', 'Agora não')
        )
      )
    ),
    '{"mode":"repeat"}'::jsonb,
    jsonb_build_array(
      jsonb_build_object(
        'trigger_intent', 'palavra_chave',
        'trigger_phrases', jsonb_build_array('sim', 'vamos', 'quero', 'cadastrar', 'sim vamos', 'sim, vamos'),
        'goto_step_id', s_conta::text,
        'goto_special', null
      ),
      jsonb_build_object(
        'trigger_intent', 'palavra_chave',
        'trigger_phrases', jsonb_build_array('não', 'nao', 'agora não', 'agora nao', 'depois'),
        'goto_step_id', s_nao::text,
        'goto_special', null
      )
    ),
    '["text"]'::jsonb
  );

  -- 4b) Não agora
  INSERT INTO public.bot_flow_steps (
    id, flow_id, position, step_type, step_key, slot_key, title, summary, icon,
    message_text, captures, fallback, transitions, media_order
  ) VALUES (
    s_nao, v_flow_id, 5, 'message', 'f_nao_obrigado', 'f_nao_obrigado',
    'Agora não', 'Saída leve sem pressão', 'msg',
    E'Sem problema, *{{nome}}*!\n\nQualquer dúvida sobre a conta de luz, é só me chamar por aqui.',
    '[]'::jsonb,
    '{"mode":"repeat"}'::jsonb,
    '[]'::jsonb,
    '["text"]'::jsonb
  );

  -- 5) Conta (foto)
  INSERT INTO public.bot_flow_steps (
    id, flow_id, position, step_type, step_key, slot_key, title, summary, icon,
    message_text, captures, fallback, transitions, media_order, auto_detect_doc_type
  ) VALUES (
    s_conta, v_flow_id, 6, 'capture_conta', 'f_pedir_conta', 'f_pedir_conta',
    'Foto da conta', 'Captura fatura de energia', 'file',
    E'Perfeito! 🙌\n\nMe envia uma *foto da sua conta de luz* (fatura do mês atual), bem legível.',
    '[]'::jsonb,
    jsonb_build_object('mode', 'goto', 'goto_step_id', s_doc::text, 'success_goto_step_id', s_doc::text),
    '[]'::jsonb,
    '["text"]'::jsonb,
    true
  );

  -- 6) Documento
  INSERT INTO public.bot_flow_steps (
    id, flow_id, position, step_type, step_key, slot_key, title, summary, icon,
    message_text, captures, fallback, transitions, media_order, auto_detect_doc_type
  ) VALUES (
    s_doc, v_flow_id, 7, 'capture_documento', 'f_pedir_documento', 'f_pedir_documento',
    'Documento', 'RG ou CNH', 'file',
    E'Show!\n\nAgora me manda a *foto do documento* (RG ou CNH), frente legível.',
    '[]'::jsonb,
    jsonb_build_object('mode', 'goto', 'goto_step_id', s_email::text, 'success_goto_step_id', s_email::text),
    '[]'::jsonb,
    '["text"]'::jsonb,
    true
  );

  -- 7) E-mail
  INSERT INTO public.bot_flow_steps (
    id, flow_id, position, step_type, step_key, slot_key, title, summary, icon,
    message_text, captures, fallback, transitions, media_order
  ) VALUES (
    s_email, v_flow_id, 8, 'capture_email', 'f_pedir_email', 'f_pedir_email',
    'E-mail', 'E-mail para o portal', 'msg',
    E'Falta pouco!\n\nMe passa seu *melhor e-mail* pra finalizar o cadastro no portal.',
    '[]'::jsonb,
    jsonb_build_object('mode', 'goto', 'goto_step_id', s_tel::text, 'success_goto_step_id', s_tel::text),
    '[]'::jsonb,
    '["text"]'::jsonb
  );

  -- 8) Confirmar telefone (não pede do zero)
  INSERT INTO public.bot_flow_steps (
    id, flow_id, position, step_type, step_key, slot_key, title, summary, icon,
    message_text, captures, fallback, transitions, media_order
  ) VALUES (
    s_tel, v_flow_id, 9, 'confirm_phone', 'f_confirmar_telefone', 'f_confirmar_telefone',
    'Confirmar WhatsApp', 'Confirma o número do Zap', 'msg',
    E'Confirma seu *telefone de contato*?\n\nSe for *este mesmo WhatsApp*, responde *sim*.\nSe for outro, me manda o número com DDD.',
    '[]'::jsonb,
    jsonb_build_object('mode', 'goto', 'goto_step_id', s_fim::text, 'success_goto_step_id', s_fim::text),
    '[]'::jsonb,
    '["text"]'::jsonb
  );

  -- 9) Finalizar
  INSERT INTO public.bot_flow_steps (
    id, flow_id, position, step_type, step_key, slot_key, title, summary, icon,
    message_text, captures, fallback, transitions, media_order
  ) VALUES (
    s_fim, v_flow_id, 10, 'finalizar_cadastro', 'f_finalizar', 'f_finalizar',
    'Finalizar cadastro', 'Envia ao portal iGreen', 'sparkle',
    E'Tudo certo, *{{nome}}*!\n\nEstou enviando seu cadastro pro *portal da iGreen* agora.\n\nEm instantes você recebe a confirmação por aqui.',
    '[]'::jsonb,
    '{"mode":"repeat"}'::jsonb,
    '[]'::jsonb,
    '["text"]'::jsonb
  );

  -- Wire button ids → transitions also via button id matching (phrases cover text)
  UPDATE public.bot_flow_steps
  SET transitions = transitions || jsonb_build_array(
    jsonb_build_object(
      'trigger_intent', 'palavra_chave',
      'trigger_phrases', jsonb_build_array('sim_cadastrar'),
      'goto_step_id', s_conta::text,
      'goto_special', null
    ),
    jsonb_build_object(
      'trigger_intent', 'palavra_chave',
      'trigger_phrases', jsonb_build_array('nao_agora'),
      'goto_step_id', s_nao::text,
      'goto_special', null
    )
  )
  WHERE id = s_cta;

  RAISE NOTICE 'Fluxo F CEMIG 2 criado: %', v_flow_id;
END $$;
