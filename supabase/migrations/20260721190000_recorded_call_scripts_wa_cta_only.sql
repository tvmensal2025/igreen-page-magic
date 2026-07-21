-- Ligação GRAVADA: só CTA WhatsApp (sem perguntas / ramificações).
-- Textos + desanexa clips antigos (áudio interativo) até regenerar no Multicanal.

UPDATE cadence_stage_config SET message_text = 'Olá, {{nome}}!

Eu sou a {{assistente}}, assistente virtual {{do_da_consultor}} {{consultor}}, {{gestor_a}} da iGreen.

Estou ligando sobre a ativação do seu benefício de economia na conta de energia.

Por favor, responda no WhatsApp do {{consultor}} que eu continuo o atendimento por lá.', updated_at = now() WHERE stage = 'A_CALL';

UPDATE cadence_stage_config SET message_text = 'Olá, {{nome}}!

Eu sou a {{assistente}}, assistente virtual {{do_da_consultor}} {{consultor}}, {{gestor_a}} da iGreen.

Estou ligando novamente sobre a ativação do seu benefício de economia na conta de energia.

Por favor, responda no WhatsApp do {{consultor}} que eu continuo o atendimento por lá.', updated_at = now() WHERE stage = 'A_CALL_RETRY';

UPDATE cadence_stage_config SET message_text = 'Olá, {{nome}}!

Eu sou a {{assistente}}, assistente virtual {{do_da_consultor}} {{consultor}}, {{gestor_a}} da iGreen.

Você já demonstrou interesse em reduzir sua conta de luz. Agora conseguimos iniciar a análise apenas com o valor médio da conta.

Por favor, responda no WhatsApp do {{consultor}} que eu continuo o atendimento por lá.', updated_at = now() WHERE stage = 'CALL_1';

UPDATE cadence_stage_config SET message_text = 'Olá, {{nome}}!

Eu sou a {{assistente}}, assistente virtual {{do_da_consultor}} {{consultor}}, {{gestor_a}} da iGreen.

Estou retornando com uma atualização sobre a economia na conta de luz.

Por favor, responda no WhatsApp do {{consultor}} que eu continuo o atendimento por lá.', updated_at = now() WHERE stage = 'CALL_2';

UPDATE cadence_stage_config SET message_text = 'Olá, {{nome}}!

Eu sou a {{assistente}}, assistente virtual {{do_da_consultor}} {{consultor}}, {{gestor_a}} da iGreen.

Estou concluindo esta sequência para não ficar insistindo. Sua análise continua disponível — basta o valor médio ou uma foto da conta.

Por favor, responda no WhatsApp do {{consultor}} que eu continuo o atendimento por lá.', updated_at = now() WHERE stage = 'CALL_3';

UPDATE cadence_stage_config SET message_text = 'Olá, {{nome}}!

Eu sou a {{assistente}}, assistente virtual {{do_da_consultor}} {{consultor}}, {{gestor_a}} da iGreen.

Faz cerca de um mês que falamos sobre economia na conta de luz. Sua análise continua disponível — só com o valor médio da conta, sem foto.

Por favor, responda no WhatsApp do {{consultor}} que eu continuo o atendimento por lá.', updated_at = now() WHERE stage = 'RECALL_60D_CALL';

UPDATE cadence_stage_config SET message_text = 'Olá, {{nome}}!

Eu sou a {{assistente}}, assistente virtual {{do_da_consultor}} {{consultor}}, {{gestor_a}} da iGreen.

Faz cerca de três meses que conversamos sobre economia na conta. Posso retomar sua análise só com o valor médio — sem burocracia.

Por favor, responda no WhatsApp do {{consultor}} que eu continuo o atendimento por lá.', updated_at = now() WHERE stage = 'RECALL_90D_CALL';

UPDATE cadence_stage_config SET message_text = 'Olá, {{nome}}!

Eu sou a {{assistente}}, assistente virtual {{do_da_consultor}} {{consultor}}, {{gestor_a}} da iGreen.

Faz cerca de cinco meses que conversamos sobre economia na conta de luz. Sua análise continua disponível — só com o valor médio da conta, sem foto.

Por favor, responda no WhatsApp do {{consultor}} que eu continuo o atendimento por lá.', updated_at = now() WHERE stage = 'RECALL_5M_CALL';

UPDATE cadence_stage_config SET message_text = 'Olá, {{nome}}!

Eu sou a {{assistente}}, assistente virtual {{do_da_consultor}} {{consultor}}, {{gestor_a}} da iGreen.

Faz cerca de oito meses que falamos sobre economia na conta. Sua análise continua disponível com o valor médio.

Por favor, responda no WhatsApp do {{consultor}} que eu continuo o atendimento por lá.', updated_at = now() WHERE stage = 'RECALL_8M_CALL';

UPDATE cadence_stage_config SET message_text = 'Olá, {{nome}}!

Eu sou a {{assistente}}, assistente virtual {{do_da_consultor}} {{consultor}}, {{gestor_a}} da iGreen.

Faz cerca de um ano que conversamos sobre economia na conta de luz. Sua análise continua disponível — só com o valor médio.

Por favor, responda no WhatsApp do {{consultor}} que eu continuo o atendimento por lá.', updated_at = now() WHERE stage = 'RECALL_12M_CALL';

UPDATE cadence_stage_config SET message_text = 'Olá, {{nome}}!

Eu sou a {{assistente}}, assistente virtual {{do_da_consultor}} {{consultor}}, {{gestor_a}} da iGreen.

Este é o lembrete anual sobre economia na conta de luz. Sua análise continua disponível com o valor médio da conta.

Por favor, responda no WhatsApp do {{consultor}} que eu continuo o atendimento por lá.', updated_at = now() WHERE stage = 'RECALL_YEARLY_CALL';

-- Clips antigos ainda falam o roteiro interativo. Sem áudio novo = motor não disca
-- (sofia_required_no_audio) até regenerar no Multicanal.
UPDATE cadence_stage_config
SET voice_audio_clip_id = null, updated_at = now()
WHERE stage IN (
  'A_CALL', 'A_CALL_RETRY', 'CALL_1', 'CALL_2', 'CALL_3',
  'RECALL_60D_CALL', 'RECALL_90D_CALL', 'RECALL_5M_CALL',
  'RECALL_8M_CALL', 'RECALL_12M_CALL', 'RECALL_YEARLY_CALL'
);
