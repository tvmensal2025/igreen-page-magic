-- BLOQUEADO (2026-07-19): este SQL republicava o catálogo CURTO e sobrescreveu o save validado.
-- NÃO EXECUTAR. Use o painel Multicanal (publish da biblioteca ativa d2d5e712) ou um export fresco.
DO $$ BEGIN
  RAISE EXCEPTION 'tmp_publish bloqueado: NÃO republicar catálogo curto (incidente 2026-07-19). Biblioteca ativa deve permanecer o save validado.';
END $$;
-- Corpo original abaixo (inócuo após o RAISE):
BEGIN;
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
COMMIT;