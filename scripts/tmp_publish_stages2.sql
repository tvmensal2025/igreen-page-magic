-- BLOQUEADO (2026-07-19): este SQL republicava o catálogo CURTO e sobrescreveu o save validado.
-- NÃO EXECUTAR. Use o painel Multicanal (publish da biblioteca ativa d2d5e712) ou um export fresco.
DO $$ BEGIN
  RAISE EXCEPTION 'tmp_publish bloqueado: NÃO republicar catálogo curto (incidente 2026-07-19). Biblioteca ativa deve permanecer o save validado.';
END $$;
-- Corpo original abaixo (inócuo após o RAISE):
BEGIN;
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
COMMIT;