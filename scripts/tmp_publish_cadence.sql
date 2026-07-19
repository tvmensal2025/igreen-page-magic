-- BLOQUEADO (2026-07-19): este SQL republicava o catálogo CURTO e sobrescreveu o save validado.
-- NÃO EXECUTAR. Use o painel Multicanal (publish da biblioteca ativa d2d5e712) ou um export fresco.
DO $$ BEGIN
  RAISE EXCEPTION 'tmp_publish bloqueado: NÃO republicar catálogo curto (incidente 2026-07-19). Biblioteca ativa deve permanecer o save validado.';
END $$;
-- Corpo original abaixo (inócuo após o RAISE):
BEGIN;
UPDATE bot_flow_steps SET updated_at = now(), message_text = $cad1$*Olá!* Para agilizar seu atendimento, informe seu *primeiro nome*.$cad1$ WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a1_ask_name';
UPDATE bot_flow_steps SET updated_at = now(), message_text = $cad2$Olá, *{{nome}}*!

Conseguimos ativar o seu benefício!

Para eu calcular a economia, me diga *quanto você paga por mês* na conta de energia.

Pode ser só o número — por exemplo: 350 ou 850,00.$cad2$ WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a2_text_ask_bill_value';
UPDATE bot_flow_steps SET updated_at = now(), message_text = $cad3$Perfeito, *{{nome}}*!

Com base no valor de *R$ {{valor_conta}}*, hoje você consegue economizar de *8% a 20%* todos os meses — cerca de *{{economia_range}}*.

*O que você prefere agora*?$cad3$, captures = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(COALESCE(captures, '[]'::jsonb)) e WHERE e->>'field' IS DISTINCT FROM '_buttons'), '[]'::jsonb) || jsonb_build_array(jsonb_build_object('field','_buttons','enabled',true,'value', $cad4$[{"id": "more_benefits", "title": "Saber mais benefício"}, {"id": "activate", "title": "Quero ativar"}, {"id": "human", "title": "Falar com humano"}]$cad4$::jsonb)) WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a3_explain_with_buttons';
UPDATE bot_flow_steps SET updated_at = now(), message_text = $cad5$Olá, *{{nome}}*!

📋 Vamos ativar seu benefício?

Toque em *Cadastrar* para continuar 👇$cad5$, captures = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(COALESCE(captures, '[]'::jsonb)) e WHERE e->>'field' IS DISTINCT FROM '_buttons'), '[]'::jsonb) || jsonb_build_array(jsonb_build_object('field','_buttons','enabled',true,'value', $cad6$[{"id": "register", "title": "Cadastrar"}, {"id": "human", "title": "Falar com humano"}]$cad6$::jsonb)) WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a5b_after_club_buttons';
UPDATE bot_flow_steps SET updated_at = now(), message_text = $cad7$✅ *Perfeito, {{nome}}!*

📸 *Agora me envie a foto da sua conta de luz*

• Página com o *valor* e os *dados da unidade*
• Foto *nítida*, sem reflexos
• Pode ser a fatura mais recente

Assim valido tudo automaticamente e seguimos com a ativação 💚$cad7$ WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a6_ask_bill_photo';
UPDATE bot_flow_steps SET updated_at = now(), message_text = $cad8$Olá, *{{nome}}*!

📄 *Próximo passo!*

Me envie a foto do seu *documento com foto*:

🪪 *CNH* → só a *frente*

🆔 *RG* → *frente e verso* (obrigatório)

Preciso das fotos *nítidas* para continuar seu cadastro ✅$cad8$ WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a7_ask_document';
UPDATE bot_flow_steps SET updated_at = now(), message_text = $cad9$Olá, *{{nome}}*!

📧 Qual é o seu *e-mail*?

É por ele que você acessa o app *iGreen Club* 📱

_(cashback, faturas e indicações)_$cad9$ WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a8_ask_email';
UPDATE bot_flow_steps SET updated_at = now(), message_text = $cad10$Olá, *{{nome}}*!

📱 Só confirmar:

O telefone deste WhatsApp é o melhor para contato?

*Número:* {{telefone}}$cad10$, captures = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(COALESCE(captures, '[]'::jsonb)) e WHERE e->>'field' IS DISTINCT FROM '_buttons'), '[]'::jsonb) || jsonb_build_array(jsonb_build_object('field','_buttons','enabled',true,'value', $cad11$[{"id": "phone_ok", "title": "Sim, este número"}, {"id": "phone_other", "title": "Quero outro"}, {"id": "human", "title": "Falar com humano"}]$cad11$::jsonb)) WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a9_confirm_phone';
UPDATE bot_flow_steps SET updated_at = now(), message_text = $cad12$Olá, *{{nome}}*!

🎉 *Pronto!*

Já temos todos os dados ✅

Vou enviar seu cadastro ao portal agora.

📲 Em seguida você recebe um *código OTP* — digite aqui no WhatsApp 👇

_(O link da validação facial só vem *depois* do OTP correto.)_$cad12$ WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a10_portal_otp_facial';
UPDATE bot_flow_steps SET updated_at = now(), message_text = $cad13$Olá, *{{nome}}*!

✅ *OTP confirmado!*

Último passo — abra o *link* 👇

{{link_facial}}

Toque em *Assinar documentos* e faça a *validação facial* para comprovar que é você 🪪$cad13$ WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a11_facial_link';
UPDATE bot_flow_steps SET updated_at = now(), message_text = $cad14$Olá, *{{nome}}*!

Combinado.

Vou transferir você para um atendente da equipe do Rafael. Em instantes alguém assume a conversa por aqui.$cad14$ WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a_human_handoff';
UPDATE bot_flow_steps SET fallback = COALESCE(fallback, '{}'::jsonb) || jsonb_build_object('mode','retry','max_retries',2,'then','humano','retry_text', $cad15$⚠️ Não consegui ler a conta. Por favor, envie uma *foto mais nítida e bem iluminada* (sem reflexos).

Dicas:
• Use boa iluminação
• Evite reflexos
• Foque nos dados principais$cad15$), updated_at = now() WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a6_ask_bill_photo';
UPDATE bot_flow_steps SET fallback = COALESCE(fallback, '{}'::jsonb) || jsonb_build_object('mode','retry','max_retries',2,'then','humano','retry_text', $cad16$⚠️ Não consegui ler o documento. Envie uma foto mais nítida do *VERSO* (ou da frente, se for CNH).

Dicas:
• Boa iluminação, sem reflexo
• Texto legível (nome, CPF, RG)$cad16$), updated_at = now() WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a7_ask_document';
UPDATE cadence_stage_config SET message_text = $cad17$Olá, *{{nome}}*! 👋

Aqui é o *Rafael Ferreira Dias*, da *iGreen*.

Você já demonstrou interesse em *reduzir sua conta de luz* — e agora temos uma novidade:

✅ Conseguimos iniciar sua análise *apenas com o valor médio da conta*. Sem foto, sem burocracia.

{{frase_disponibilidade}}

*Em qual faixa está sua conta hoje?*

_Para não receber mais contatos, responda SAIR._$cad17$, updated_at = now(), buttons = $cad18$[{"id": "bill_low", "title": "Até R$300"}, {"id": "bill_mid", "title": "R$300 a R$700"}, {"id": "bill_high", "title": "Acima de R$700"}]$cad18$::jsonb WHERE consultant_id IS NULL AND stage = 'COLD_1';
UPDATE cadence_stage_config SET message_text = $cad19${{tema_whatsapp}}$cad19$, updated_at = now(), buttons = $cad20$[{"id": "bill_low", "title": "Até R$300"}, {"id": "bill_mid", "title": "R$300 a R$700"}, {"id": "bill_high", "title": "Acima de R$700"}]$cad20$::jsonb WHERE consultant_id IS NULL AND stage = 'COLD_2';
UPDATE cadence_stage_config SET message_text = $cad21${{tema_sms}} https://wa.me/{{consultor_phone}}$cad21$, updated_at = now() WHERE consultant_id IS NULL AND stage = 'SMS_TEMA_2';
UPDATE cadence_stage_config SET message_text = $cad22$Olá, *{{nome}}*! 👋

Sem mensagem longa, sem foto: pra checar seu caso *basta 1 toque*.

*Qual faixa está sua conta hoje?*$cad22$, updated_at = now(), buttons = $cad23$[{"id": "bill_low", "title": "Até R$300"}, {"id": "bill_mid", "title": "R$300 a R$700"}, {"id": "bill_high", "title": "Acima de R$700"}]$cad23$::jsonb WHERE consultant_id IS NULL AND stage = 'COLD_3';
UPDATE cadence_stage_config SET message_text = $cad24${{tema_sms}} https://wa.me/{{consultor_phone}}$cad24$, updated_at = now() WHERE consultant_id IS NULL AND stage = 'SMS_TEMA_7';
UPDATE cadence_stage_config SET message_text = $cad25$Olá, *{{nome}}*.

Como não consegui falar com você, vou *pausar este ciclo* — sem excluir seu cadastro.

*Escolha abaixo* como prefere seguir (ou responda SAIR para não receber mais contatos):$cad25$, updated_at = now(), buttons = $cad26$[{"id": "analyze", "title": "Quero analisar"}, {"id": "call_me", "title": "Pode me ligar"}, {"id": "stop", "title": "Encerrar"}]$cad26$::jsonb WHERE consultant_id IS NULL AND stage = 'COLD_4';
UPDATE cadence_stage_config SET message_text = $cad27$Olá, {{nome}}.

Eu sou a Sofia, assistente virtual do Rafael, da iGreen Energia.

Você já demonstrou interesse em reduzir sua conta de luz e agora conseguimos iniciar a análise apenas com o valor médio da conta. Você prefere me passar o valor agora ou receber a explicação pelo WhatsApp?

Se demonstrar desconfiança: Entendo perfeitamente. Reforço que não pedimos Pix, depósito ou pagamento ao consultor para iniciar.

Se estiver ocupado: Sem problema. Fica melhor retornarmos hoje até as 18 horas ou amanhã pela manhã?$cad27$, updated_at = now() WHERE consultant_id IS NULL AND stage = 'CALL_1';
UPDATE cadence_stage_config SET message_text = $cad28$Olá, {{nome}}.

Eu sou a Sofia, assistente virtual do Rafael, da iGreen Energia.

Estou retornando com uma atualização diferente da que você já recebeu. Você prefere que eu explique rapidamente agora ou que eu deixe tudo organizado no WhatsApp para o Rafael?

Se estiver ocupado: Sem problema. Qual o melhor dia e horário para retornarmos?$cad28$, updated_at = now() WHERE consultant_id IS NULL AND stage = 'CALL_2';
UPDATE cadence_stage_config SET message_text = $cad29$Olá, {{nome}}.

Eu sou a Sofia, assistente virtual do Rafael, da iGreen Energia.

Estou concluindo esta sequência para não ficar insistindo. Você prefere manter sua análise disponível com o Rafael ou encerrar o atendimento? Para iniciar, precisamos apenas do valor médio ou de uma foto da conta.$cad29$, updated_at = now() WHERE consultant_id IS NULL AND stage = 'CALL_3';
UPDATE cadence_stage_config SET message_text = $cad30$Rafael | iGreen: Oi {{nome}}! Reabri sua analise. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.$cad30$, updated_at = now() WHERE consultant_id IS NULL AND stage = 'SMS_1';
UPDATE cadence_stage_config SET message_text = $cad31$Rafael | iGreen: Oi {{nome}}! Novidades e beneficios extras. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.$cad31$, updated_at = now() WHERE consultant_id IS NULL AND stage = 'SMS_2';
UPDATE cadence_stage_config SET message_text = $cad32$Olá, *{{nome}}*! 👋

Aqui é o *Rafael Ferreira Dias*, da *iGreen*.

Faz cerca de *1 mês* que falamos sobre *economia na conta de luz*.

✅ Sua *análise continua disponível* — iniciamos só com o *valor médio* da conta. Sem foto, sem burocracia.

{{frase_disponibilidade}}

*Em qual faixa está sua conta hoje?*

_Para não receber mais contatos, responda SAIR._$cad32$, updated_at = now(), buttons = $cad33$[{"id": "bill_low", "title": "Até R$300"}, {"id": "bill_mid", "title": "R$300 a R$700"}, {"id": "bill_high", "title": "Acima de R$700"}]$cad33$::jsonb WHERE consultant_id IS NULL AND stage = 'RECALL_60D';
UPDATE cadence_stage_config SET message_text = $cad34$Rafael | iGreen: Oi {{nome}}! Sua analise de economia segue disponivel. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.$cad34$, updated_at = now() WHERE consultant_id IS NULL AND stage = 'RECALL_60D_SMS';
UPDATE cadence_stage_config SET message_text = $cad35$Olá, {{nome}}.

Eu sou a Sofia, assistente virtual do Rafael, da iGreen Energia.

Faz cerca de um mês que falamos sobre economia na conta de luz. Sua análise continua disponível — só com o valor médio da conta, sem foto.

Você prefere continuar pelo WhatsApp ou que eu explique rapidamente agora?$cad35$, updated_at = now() WHERE consultant_id IS NULL AND stage = 'RECALL_60D_CALL';
UPDATE cadence_stage_config SET message_text = $cad36$Olá, *{{nome}}*! 👋

Aqui é o *Rafael Ferreira Dias*, da *iGreen*.

Faz cerca de *3 meses* desde nosso contato sobre *reduzir a conta de luz*.

✅ Posso *retomar sua análise de economia* agora — só com o valor médio da conta. Sem foto obrigatória.

{{frase_disponibilidade}}

*Em qual faixa está sua conta hoje?* 👇

_Para não receber mais contatos, responda SAIR._$cad36$, updated_at = now(), buttons = $cad37$[{"id": "bill_low", "title": "Até R$300"}, {"id": "bill_mid", "title": "R$300 a R$700"}, {"id": "bill_high", "title": "Acima de R$700"}]$cad37$::jsonb WHERE consultant_id IS NULL AND stage = 'RECALL_90D';
UPDATE cadence_stage_config SET message_text = $cad38$Rafael | iGreen: Oi {{nome}}! Ainda posso retomar sua analise da conta. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.$cad38$, updated_at = now() WHERE consultant_id IS NULL AND stage = 'RECALL_90D_SMS';
UPDATE cadence_stage_config SET message_text = $cad39$Olá, {{nome}}.

Eu sou a Sofia, assistente virtual do Rafael, da iGreen Energia.

Faz cerca de três meses que conversamos sobre economia na conta. Posso retomar sua análise só com o valor médio — sem burocracia.

Você prefere continuar pelo WhatsApp ou que eu explique agora?$cad39$, updated_at = now() WHERE consultant_id IS NULL AND stage = 'RECALL_90D_CALL';
UPDATE cadence_stage_config SET message_text = $cad40$Olá, *{{nome}}*! 👋

Aqui é o *Rafael Ferreira Dias*, da *iGreen*.

Faz cerca de *5 meses* que falamos sobre *economia na conta de luz*.

✅ Sua *análise continua disponível* — iniciamos só com o *valor médio*. Sem foto, sem burocracia.

{{frase_disponibilidade}}

*Em qual faixa está sua conta hoje?*

_Para não receber mais contatos, responda SAIR._$cad40$, updated_at = now(), buttons = $cad41$[{"id": "bill_low", "title": "Até R$300"}, {"id": "bill_mid", "title": "R$300 a R$700"}, {"id": "bill_high", "title": "Acima de R$700"}]$cad41$::jsonb WHERE consultant_id IS NULL AND stage = 'RECALL_5M';
UPDATE cadence_stage_config SET message_text = $cad42$Rafael | iGreen: Oi {{nome}}! Analise de economia ainda disponivel. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.$cad42$, updated_at = now() WHERE consultant_id IS NULL AND stage = 'RECALL_5M_SMS';
UPDATE cadence_stage_config SET message_text = $cad43$Olá, {{nome}}.

Eu sou a Sofia, assistente virtual do Rafael, da iGreen Energia.

Faz cerca de cinco meses que conversamos sobre economia na conta de luz. Se ainda fizer sentido, conseguimos retomar sua análise apenas com o valor médio da conta — sem foto e sem burocracia.

Você prefere continuar pelo WhatsApp ou que eu explique rapidamente agora?

Se estiver ocupado: Sem problema. Posso deixar tudo organizado no WhatsApp para o Rafael retornar quando for melhor para você.$cad43$, updated_at = now() WHERE consultant_id IS NULL AND stage = 'RECALL_5M_CALL';
UPDATE cadence_stage_config SET message_text = $cad44$Olá, *{{nome}}*! 👋

Aqui é o *Rafael Ferreira Dias*, da *iGreen*.

Faz cerca de *8 meses* desde nosso contato sobre *economia na conta*.

✅ Posso *retomar sua análise* agora — só com o valor médio. Sem foto obrigatória.

{{frase_disponibilidade}}

*Em qual faixa está sua conta hoje?*

_Para não receber mais contatos, responda SAIR._$cad44$, updated_at = now(), buttons = $cad45$[{"id": "bill_low", "title": "Até R$300"}, {"id": "bill_mid", "title": "R$300 a R$700"}, {"id": "bill_high", "title": "Acima de R$700"}]$cad45$::jsonb WHERE consultant_id IS NULL AND stage = 'RECALL_8M';
UPDATE cadence_stage_config SET message_text = $cad46$Rafael | iGreen: Oi {{nome}}! Novidades na economia de energia. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.$cad46$, updated_at = now() WHERE consultant_id IS NULL AND stage = 'RECALL_8M_SMS';
UPDATE cadence_stage_config SET message_text = $cad47$Olá, {{nome}}.

Eu sou a Sofia, assistente virtual do Rafael, da iGreen Energia.

Faz cerca de oito meses que falamos sobre economia na conta. Sua análise continua disponível com o valor médio.

Você prefere continuar pelo WhatsApp ou que eu explique agora?$cad47$, updated_at = now() WHERE consultant_id IS NULL AND stage = 'RECALL_8M_CALL';
UPDATE cadence_stage_config SET message_text = $cad48$Olá, *{{nome}}*! 👋

Aqui é o *Rafael Ferreira Dias*, da *iGreen*.

Faz cerca de *1 ano* desde nosso contato sobre economia na conta.

✅ Sua *análise de economia* continua disponível — basta o valor médio da conta.

{{frase_disponibilidade}}

*Em qual faixa está sua conta hoje?*

_Para não receber mais contatos, responda SAIR._$cad48$, updated_at = now(), buttons = $cad49$[{"id": "bill_low", "title": "Até R$300"}, {"id": "bill_mid", "title": "R$300 a R$700"}, {"id": "bill_high", "title": "Acima de R$700"}]$cad49$::jsonb WHERE consultant_id IS NULL AND stage = 'RECALL_12M';
UPDATE cadence_stage_config SET message_text = $cad50$Rafael | iGreen: Oi {{nome}}! Faz 1 ano — analise ainda disponivel. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.$cad50$, updated_at = now() WHERE consultant_id IS NULL AND stage = 'RECALL_12M_SMS';
UPDATE cadence_stage_config SET message_text = $cad51$Olá, {{nome}}.

Eu sou a Sofia, assistente virtual do Rafael, da iGreen Energia.

Faz cerca de um ano que conversamos sobre economia na conta de luz. Se ainda fizer sentido, retomamos sua análise só com o valor médio.

Você prefere continuar pelo WhatsApp ou que eu explique agora?$cad51$, updated_at = now() WHERE consultant_id IS NULL AND stage = 'RECALL_12M_CALL';
UPDATE cadence_stage_config SET message_text = $cad52$Olá, *{{nome}}*! 👋

Aqui é o *Rafael Ferreira Dias*, da *iGreen*.

Lembrete anual: sua *análise de economia na conta* continua disponível.

✅ Iniciamos só com o *valor médio*. Sem foto, sem burocracia.

{{frase_disponibilidade}}

*Em qual faixa está sua conta hoje?*

_Para não receber mais contatos, responda SAIR._$cad52$, updated_at = now(), buttons = $cad53$[{"id": "bill_low", "title": "Até R$300"}, {"id": "bill_mid", "title": "R$300 a R$700"}, {"id": "bill_high", "title": "Acima de R$700"}]$cad53$::jsonb WHERE consultant_id IS NULL AND stage = 'RECALL_YEARLY';
UPDATE cadence_stage_config SET message_text = $cad54$Rafael | iGreen: Oi {{nome}}! Lembrete anual da analise. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.$cad54$, updated_at = now() WHERE consultant_id IS NULL AND stage = 'RECALL_YEARLY_SMS';
UPDATE cadence_stage_config SET message_text = $cad55$Olá, {{nome}}.

Eu sou a Sofia, assistente virtual do Rafael, da iGreen Energia.

Este é o lembrete anual sobre economia na conta de luz. Sua análise continua disponível com o valor médio da conta.

Você prefere continuar pelo WhatsApp ou que eu explique agora?$cad55$, updated_at = now() WHERE consultant_id IS NULL AND stage = 'RECALL_YEARLY_CALL';
UPDATE ai_media_library SET active = false, updated_at = now() WHERE consultant_id = '0c2711ad-4836-41e6-afba-edd94f698ae3' AND slot_key = 'multichannel_cadence_v2' AND active = true;
INSERT INTO ai_media_library (consultant_id, slot_key, kind, label, url, text_content, active, send_order, is_draft, is_public, delay_before_ms, priority) VALUES ('0c2711ad-4836-41e6-afba-edd94f698ae3', 'multichannel_cadence_v2', 'text', 'Multicanal · biblioteca painel', 'about:blank', $cad56${"version": 2, "bodies": {"a1_ask_name": "*Olá!* Para agilizar seu atendimento, informe seu *primeiro nome*.", "a2_text_ask_bill_value": "Olá, *{{nome}}*!\n\nConseguimos ativar o seu benefício!\n\nPara eu calcular a economia, me diga *quanto você paga por mês* na conta de energia.\n\nPode ser só o número — por exemplo: 350 ou 850,00.", "a3_explain_with_buttons": "Perfeito, *{{nome}}*!\n\nCom base no valor de *R$ {{valor_conta}}*, hoje você consegue economizar de *8% a 20%* todos os meses — cerca de *{{economia_range}}*.\n\n*O que você prefere agora*?", "a5b_after_club_buttons": "Olá, *{{nome}}*!\n\n📋 Vamos ativar seu benefício?\n\nToque em *Cadastrar* para continuar 👇", "a6_ask_bill_photo": "✅ *Perfeito, {{nome}}!*\n\n📸 *Agora me envie a foto da sua conta de luz*\n\n• Página com o *valor* e os *dados da unidade*\n• Foto *nítida*, sem reflexos\n• Pode ser a fatura mais recente\n\nAssim valido tudo automaticamente e seguimos com a ativação 💚", "a7_ask_document": "Olá, *{{nome}}*!\n\n📄 *Próximo passo!*\n\nMe envie a foto do seu *documento com foto*:\n\n🪪 *CNH* → só a *frente*\n\n🆔 *RG* → *frente e verso* (obrigatório)\n\nPreciso das fotos *nítidas* para continuar seu cadastro ✅", "a8_ask_email": "Olá, *{{nome}}*!\n\n📧 Qual é o seu *e-mail*?\n\nÉ por ele que você acessa o app *iGreen Club* 📱\n\n_(cashback, faturas e indicações)_", "a9_confirm_phone": "Olá, *{{nome}}*!\n\n📱 Só confirmar:\n\nO telefone deste WhatsApp é o melhor para contato?\n\n*Número:* {{telefone}}", "a10_portal_otp_facial": "Olá, *{{nome}}*!\n\n🎉 *Pronto!*\n\nJá temos todos os dados ✅\n\nVou enviar seu cadastro ao portal agora.\n\n📲 Em seguida você recebe um *código OTP* — digite aqui no WhatsApp 👇\n\n_(O link da validação facial só vem *depois* do OTP correto.)_", "a11_facial_link": "Olá, *{{nome}}*!\n\n✅ *OTP confirmado!*\n\nÚltimo passo — abra o *link* 👇\n\n{{link_facial}}\n\nToque em *Assinar documentos* e faça a *validação facial* para comprovar que é você 🪪", "a_human_handoff": "Olá, *{{nome}}*!\n\nCombinado.\n\nVou transferir você para um atendente da equipe do Rafael. Em instantes alguém assume a conversa por aqui."}, "buttons": {"a3_explain_with_buttons": [{"id": "more_benefits", "title": "Saber mais benefício"}, {"id": "activate", "title": "Quero ativar"}, {"id": "human", "title": "Falar com humano"}], "a5b_after_club_buttons": [{"id": "register", "title": "Cadastrar"}, {"id": "human", "title": "Falar com humano"}], "a9_confirm_phone": [{"id": "phone_ok", "title": "Sim, este número"}, {"id": "phone_other", "title": "Quero outro"}, {"id": "human", "title": "Falar com humano"}]}, "audioClipIds": {}, "segmentBodies": {}, "segmentApproved": {}, "approved": {}, "audioUrls": {}, "updatedAt": "2026-07-19T18:22:07.745Z"}$cad56$, true, 0, false, false, 0, 0);
COMMIT;