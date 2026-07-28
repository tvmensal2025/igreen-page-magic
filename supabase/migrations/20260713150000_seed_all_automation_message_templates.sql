-- ═══════════════════════════════════════════════════════════════════════════
-- Seeds: TODOS os textos de automação/atendimento editáveis via
-- consultant_message_templates. Nascem ativos; envio ainda depende dos toggles.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.consultant_message_templates
  (consultant_id, template_key, label, description, category, text_content, variables)
VALUES
  -- Atendimento
  (NULL, 'attendance_ask_name', 'Atendimento — pedir nome',
   'Após iniciar atendimento (se não usar template start_attendance completo).',
   'atendimento',
   E'Para começarmos, me conta seu *nome completo*?',
   '["nome","consultor","protocolo"]'::jsonb),

  (NULL, 'attendance_closing', 'Atendimento — encerramento',
   'Mensagem ao finalizar o atendimento (antes da pesquisa).',
   'atendimento',
   E'✅ *Atendimento finalizado*\n\nFoi um prazer te atender!\nSe precisar de algo, estamos por aqui.',
   '["nome","consultor","protocolo"]'::jsonb),

  (NULL, 'attendance_rating_prompt', 'Atendimento — pesquisa 1 a 5',
   'Pede a nota do atendimento.',
   'atendimento',
   E'⭐ Como você avalia o atendimento de hoje?\n\nResponda com um número de *1* a *5*:\n\n*1* — Muito ruim\n*2* — Ruim\n*3* — Regular\n*4* — Bom\n*5* — Excelente',
   '[]'::jsonb),

  (NULL, 'attendance_rating_thanks', 'Atendimento — agradecimento da nota',
   'Após o cliente avaliar. Use {{nota}}.',
   'atendimento',
   E'Obrigado pela avaliação *{{nota}}/5*!\n\nSua opinião nos ajuda a melhorar cada vez mais.\nFoi um prazer te atender — qualquer coisa, é só chamar!',
   '["nota","nome"]'::jsonb),

  (NULL, 'attendance_rating_retry', 'Atendimento — pedir nota de novo',
   'Quando a resposta da pesquisa não é 1–5.',
   'atendimento',
   E'Pra eu registrar certinho, responde só com um número de *1* a *5*:\n\n*1* — Muito ruim\n*2* — Ruim\n*3* — Regular\n*4* — Bom\n*5* — Excelente',
   '[]'::jsonb),

  (NULL, 'attendance_rating_media_hint', 'Atendimento — arquivo na pesquisa',
   'Quando o cliente manda mídia no passo da nota.',
   'atendimento',
   E'Recebi seu arquivo.\n\nPra finalizar, me responde só com a *nota* de *1* a *5* do atendimento:\n\n*1* — Muito ruim\n*2* — Ruim\n*3* — Regular\n*4* — Bom\n*5* — Excelente',
   '[]'::jsonb),

  (NULL, 'attendance_protocol_block', 'Atendimento — bloco protocolo',
   'Bloco “Atendimento iniciado” + chamado. Variáveis: {{consultor}}, {{protocolo}}.',
   'atendimento',
   E'✅ *Atendimento iniciado*\n\nAqui é {{o_a_consultor}} *{{consultor}}* da *iGreen*.\n\n📋 *Protocolo:* {{protocolo}}',
   '["consultor","protocolo","nome"]'::jsonb),

  -- Postpone / adiamento
  (NULL, 'postpone_confirm', 'Adiamento — confirmação',
   'Quando o lead diz “mando amanhã / mais tarde”. Variáveis: {{nome}}, {{quando}}, {{o_que}}.',
   'ia',
   E'Combinado, {{nome}}sem pressa!\n\nFico no aguardo d{{artigo}} {{o_que}} *{{quando}}*. Qualquer dúvida é só me chamar por aqui.',
   '["nome","quando","o_que","artigo"]'::jsonb),

  -- Watchdog
  (NULL, 'watchdog_orphan_tip', 'Watchdog — step órfão',
   'Aviso ao lead quando o fluxo detecta step inválido.',
   'ia',
   E'Estou te encaminhando para um consultor humano para continuar seu atendimento. Em breve alguém te responde por aqui.',
   '["nome"]'::jsonb),

  (NULL, 'watchdog_loop_tip', 'Watchdog — loop detectado',
   'Aviso ao lead quando há loop de mensagens.',
   'ia',
   E'Vou te passar para um consultor humano para te atender melhor. Em breve alguém te responde por aqui.',
   '["nome"]'::jsonb),

  -- Parceiro (alinhar notify-consultant ao DB)
  (NULL, 'partner_step_notification', 'Parceiro — avanço de etapa',
   'Aviso ao parceiro quando o indicado avança no fluxo.',
   'parceiros',
   E'📍 *Acompanhamento do indicado*\n\n👤 {{nome}}\n📱 {{telefone}}\n📌 Etapa {{etapa}} de {{total}}: *{{nome_etapa}}*',
   '["nome","telefone","etapa","total","nome_etapa"]'::jsonb),

  -- Cross-sell (sombra / futuro)
  (NULL, 'cross_sell_hint', 'Cross-sell — hint energia→telecom/seguro',
   'Sugestão de outros produtos (só se cross_sell_bot ligado e sombra OFF).',
   'pos-venda',
   E'Além da energia, você também pode ter *Telefonia* e *Seguro Auto* com condições especiais da iGreen. Se quiser, posso detalhar.',
   '["nome"]'::jsonb)

ON CONFLICT (consultant_id, template_key) DO NOTHING;

-- Garante que seeds anteriores de retenção existam (idempotente)
INSERT INTO public.consultant_message_templates
  (consultant_id, template_key, label, description, category, text_content, variables)
VALUES
  (NULL, 'bot_followup_sumiu', 'Follow-up quem sumiu (6–48h)',
   'Cron bot-followup-checker.', 'ia',
   E'Oi {{nome}}, aqui é da *iGreen*.\n\nVi que sua simulação da conta de luz ficou pendente. Posso retomar de onde paramos — é só responder por aqui.',
   '["nome"]'::jsonb),
  (NULL, 'faq_reengagement_nudge', 'Nudge pós-FAQ (±20 min)',
   'Cron faq-reengagement-nudge.', 'ia',
   E'{{nome}}, qualquer outra dúvida, é só perguntar. Estou por aqui.',
   '["nome"]'::jsonb),
  (NULL, 'speed_to_lead_alert', 'Alerta interno SLA speed-to-lead',
   'Só painel — não vai ao cliente.', 'ia',
   E'Lead {{nome}} ({{telefone}}) sem 1ª resposta há mais de {{minutos}} min. Priorize o atendimento.',
   '["nome","telefone","minutos"]'::jsonb)
ON CONFLICT (consultant_id, template_key) DO NOTHING;
