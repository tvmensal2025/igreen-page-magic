-- Seeds: textos WA/SMS/CALL da escada longa (enabled = false).
-- Depende dos enums RECALL_*_SMS / RECALL_*_CALL.

-- Marcos principais passam a ser WhatsApp (análise)
UPDATE public.cadence_stage_config
SET message_text = E'Olá, *{{nome}}*! 👋\n\nAqui é o *Rafael Ferreira Dias*, da *iGreen*.\n\nFaz cerca de *5 meses* que falamos sobre *economia na conta de luz*.\n\n✅ Sua *análise continua disponível* — iniciamos só com o *valor médio* da conta. Sem foto, sem burocracia.\n\n{{frase_disponibilidade}}\n\n*Em qual faixa está sua conta hoje?*\n\n_Para não receber mais contatos, responda SAIR._',
    media_type = 'text', updated_at = now()
WHERE consultant_id IS NULL AND stage = 'RECALL_5M';

UPDATE public.cadence_stage_config
SET message_text = E'Olá, *{{nome}}*! 👋\n\nAqui é o *Rafael Ferreira Dias*, da *iGreen*.\n\nFaz cerca de *8 meses* desde nosso contato sobre *economia na conta*.\n\n✅ Posso *retomar sua análise* agora — só com o valor médio. Sem foto obrigatória.\n\n{{frase_disponibilidade}}\n\n*Em qual faixa está sua conta hoje?*\n\n_Para não receber mais contatos, responda SAIR._',
    media_type = 'text', updated_at = now()
WHERE consultant_id IS NULL AND stage = 'RECALL_8M';

UPDATE public.cadence_stage_config
SET message_text = E'Olá, *{{nome}}*! 👋\n\nAqui é o *Rafael Ferreira Dias*, da *iGreen*.\n\nFaz cerca de *1 ano* desde nosso contato sobre economia na conta.\n\n✅ Sua *análise de economia* continua disponível — basta o valor médio da conta.\n\n{{frase_disponibilidade}}\n\n*Em qual faixa está sua conta hoje?*\n\n_Para não receber mais contatos, responda SAIR._',
    media_type = 'text', updated_at = now()
WHERE consultant_id IS NULL AND stage = 'RECALL_12M';

UPDATE public.cadence_stage_config
SET message_text = E'Olá, *{{nome}}*! 👋\n\nAqui é o *Rafael Ferreira Dias*, da *iGreen*.\n\nLembrete anual: sua *análise de economia na conta* continua disponível.\n\n✅ Iniciamos só com o *valor médio*. Sem foto, sem burocracia.\n\n{{frase_disponibilidade}}\n\n*Em qual faixa está sua conta hoje?*\n\n_Para não receber mais contatos, responda SAIR._',
    media_type = 'text', updated_at = now()
WHERE consultant_id IS NULL AND stage = 'RECALL_YEARLY';

INSERT INTO public.cadence_stage_config (consultant_id, stage, enabled, delay_hours, message_text, media_type)
SELECT NULL, v.stage::public.cadence_stage, false, v.delay_hours, v.message_text, 'text'
FROM (VALUES
  ('RECALL_60D_SMS', 2,
   'Rafael | iGreen: {{nome}}, sua analise de economia segue disponivel. Abra: wa.me/{{consultor_phone}} SAIR encerra.'),
  ('RECALL_60D_CALL', 4,
   'Ligação Sofia — recall 60 dias (análise).'),
  ('RECALL_90D_SMS', 2,
   'Rafael | iGreen: {{nome}}, ainda posso retomar sua analise da conta. Abra: wa.me/{{consultor_phone}} SAIR encerra.'),
  ('RECALL_90D_CALL', 4,
   'Ligação Sofia — recall 90 dias (análise).'),
  ('RECALL_5M_SMS', 2,
   'Rafael | iGreen: {{nome}}, analise de economia ainda disponivel. Abra: wa.me/{{consultor_phone}} SAIR encerra.'),
  ('RECALL_5M_CALL', 4,
   'Ligação Sofia — recall 5 meses (análise).'),
  ('RECALL_8M_SMS', 2,
   'Rafael | iGreen: {{nome}}, novidades na economia de energia. Abra: wa.me/{{consultor_phone}} SAIR encerra.'),
  ('RECALL_8M_CALL', 4,
   'Ligação Sofia — recall 8 meses (análise).'),
  ('RECALL_12M_SMS', 2,
   'Rafael | iGreen: {{nome}}, faz 1 ano — analise ainda disponivel. Abra: wa.me/{{consultor_phone}} SAIR encerra.'),
  ('RECALL_12M_CALL', 4,
   'Ligação Sofia — recall 12 meses (análise).'),
  ('RECALL_YEARLY_SMS', 2,
   'Rafael | iGreen: {{nome}}, lembrete anual da analise. Abra: wa.me/{{consultor_phone}} SAIR encerra.'),
  ('RECALL_YEARLY_CALL', 4,
   'Ligação Sofia — recall anual (análise).')
) AS v(stage, delay_hours, message_text)
WHERE NOT EXISTS (
  SELECT 1 FROM public.cadence_stage_config c
  WHERE c.consultant_id IS NULL AND c.stage::text = v.stage
);

UPDATE public.automation_toggles
SET description = 'Marco longo: WA análise → SMS se silêncio → ligação se silêncio (~60d).'
WHERE key = 'cadence_recall_60d';
UPDATE public.automation_toggles
SET description = 'Marco longo: WA análise → SMS se silêncio → ligação se silêncio (~90d).'
WHERE key = 'cadence_recall_90d';
UPDATE public.automation_toggles
SET description = 'Marco longo: WA análise → SMS se silêncio → ligação se silêncio (~5m).'
WHERE key = 'cadence_recall_5m';
UPDATE public.automation_toggles
SET description = 'Marco longo: WA análise → SMS se silêncio → ligação se silêncio (~8m).'
WHERE key = 'cadence_recall_8m';
UPDATE public.automation_toggles
SET description = 'Marco longo: WA análise → SMS se silêncio → ligação se silêncio (~12m).'
WHERE key = 'cadence_recall_12m';
UPDATE public.automation_toggles
SET description = 'Marco longo anual: WA análise → SMS se silêncio → ligação se silêncio.'
WHERE key = 'cadence_recall_yearly';
