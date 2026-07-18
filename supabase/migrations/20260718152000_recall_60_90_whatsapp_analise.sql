-- Recalls 60d/90d: WhatsApp com convite à análise (SMS sozinho é raso demais).
-- Canal do motor vem do STAGE_MAP (código); aqui atualizamos textos + labels dos toggles.
-- Não liga automação: enabled dos estágios/toggles permanece como está.

UPDATE public.cadence_stage_config
SET
  message_text = E'Olá, *{{nome}}*! 👋\n\nAqui é o *Rafael Ferreira Dias*, da *iGreen*.\n\nFaz cerca de *2 meses* que falamos sobre *economia na conta de luz*.\n\n✅ Sua *análise continua disponível* — e agora fica ainda mais simples: iniciamos só com o *valor médio* da conta. Sem foto, sem burocracia.\n\n{{frase_disponibilidade}}\n\n*Em qual faixa está sua conta hoje?*\n\n_Para não receber mais contatos, responda SAIR._',
  media_type = 'text',
  updated_at = now()
WHERE consultant_id IS NULL AND stage = 'RECALL_60D';

UPDATE public.cadence_stage_config
SET
  message_text = E'Olá, *{{nome}}*! 👋\n\nAqui é o *Rafael Ferreira Dias*, da *iGreen*.\n\nFaz cerca de *3 meses* desde nosso contato sobre *reduzir a conta de luz*.\n\n✅ Posso *retomar sua análise de economia* agora — só com o valor médio da conta. Sem foto obrigatória, sem burocracia.\n\n{{frase_disponibilidade}}\n\n*Em qual faixa está sua conta hoje?* 👇\n\n_Para não receber mais contatos, responda SAIR._',
  media_type = 'text',
  updated_at = now()
WHERE consultant_id IS NULL AND stage = 'RECALL_90D';

UPDATE public.automation_toggles
SET
  label = 'Recall 60 dias (WhatsApp análise)',
  description = '1 toque WhatsApp ~60d com convite à análise + faixa. Não é SMS.'
WHERE key = 'cadence_recall_60d';

UPDATE public.automation_toggles
SET
  label = 'Recall 90 dias (WhatsApp análise)',
  description = '1 toque WhatsApp ~90d com convite à análise + faixa.'
WHERE key = 'cadence_recall_90d';
