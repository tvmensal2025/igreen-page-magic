-- Zero Lead Perdido v5 — parte 2: delays onda curta + seeds recall + toggles OFF.

UPDATE public.cadence_stage_config SET delay_hours = 0,    updated_at = now() WHERE consultant_id IS NULL AND stage = 'COLD_1';
UPDATE public.cadence_stage_config SET delay_hours = 2,    updated_at = now() WHERE consultant_id IS NULL AND stage = 'SMS_1';
UPDATE public.cadence_stage_config SET delay_hours = 4,    updated_at = now() WHERE consultant_id IS NULL AND stage = 'CALL_1';
UPDATE public.cadence_stage_config SET delay_hours = 18,   updated_at = now() WHERE consultant_id IS NULL AND stage = 'COLD_2';
UPDATE public.cadence_stage_config SET delay_hours = 48,   updated_at = now() WHERE consultant_id IS NULL AND stage = 'CALL_2';
UPDATE public.cadence_stage_config SET delay_hours = 48,   updated_at = now() WHERE consultant_id IS NULL AND stage = 'SMS_2';
UPDATE public.cadence_stage_config SET delay_hours = 24,   updated_at = now() WHERE consultant_id IS NULL AND stage = 'COLD_3';
UPDATE public.cadence_stage_config SET delay_hours = 72,   updated_at = now() WHERE consultant_id IS NULL AND stage = 'CALL_3';
UPDATE public.cadence_stage_config SET delay_hours = 2,    updated_at = now() WHERE consultant_id IS NULL AND stage = 'COLD_4';

INSERT INTO public.cadence_stage_config (consultant_id, stage, enabled, delay_hours, message_text, media_type)
SELECT NULL, v.stage::public.cadence_stage, false, v.delay_hours, v.message_text, 'text'
FROM (VALUES
  ('RETARGET_ADS_15D', 336,
   'Remarketing Meta ~15d após onda curta (sem WhatsApp).'),
  ('RECALL_60D', 1080,
   'Rafael | iGreen: {{nome}}, ainda posso te ajudar com a conta de luz. Abra: wa.me/{{consultor_phone}} SAIR encerra.'),
  ('RECALL_90D', 720,
   'Olá, *{{nome}}*! Passando para lembrar: sua análise de economia na conta continua disponível. _SAIR encerra._'),
  ('RECALL_5M', 1440,
   'Ligação Sofia — recall 5 meses.'),
  ('RECALL_8M', 2160,
   'Rafael | iGreen: {{nome}}, novidades na economia de energia. Abra: wa.me/{{consultor_phone}} SAIR encerra.'),
  ('RECALL_12M', 2880,
   'Olá, *{{nome}}*! Faz cerca de *1 ano* desde nosso contato sobre economia na conta. Se fizer sentido, responda por aqui. _SAIR encerra._'),
  ('RECALL_YEARLY', 8760,
   'Rafael | iGreen: {{nome}}, lembrete anual da analise. Abra: wa.me/{{consultor_phone}} SAIR encerra.')
) AS v(stage, delay_hours, message_text)
WHERE NOT EXISTS (
  SELECT 1 FROM public.cadence_stage_config c
  WHERE c.consultant_id IS NULL AND c.stage::text = v.stage
);

INSERT INTO public.automation_toggles (key, label, description, category, enabled)
VALUES
  ('cadence_retarget_ads_15d', 'Remarketing ads ~15d', 'Público Meta ~15 dias após fim da onda curta.', 'cadencia', false),
  ('cadence_recall_60d', 'Recall 60 dias', '1 toque SMS ~60d.', 'cadencia', false),
  ('cadence_recall_90d', 'Recall 90 dias', '1 toque WA ~90d.', 'cadencia', false),
  ('cadence_recall_5m', 'Recall 5 meses', '1 ligação ~5 meses.', 'cadencia', false),
  ('cadence_recall_8m', 'Recall 8 meses', '1 SMS ~8 meses.', 'cadencia', false),
  ('cadence_recall_12m', 'Recall 12 meses', 'Lembrete anual WA.', 'cadencia', false),
  ('cadence_recall_yearly', 'Recall yearly loop', '1 toque/ano após 12m.', 'cadencia', false)
ON CONFLICT (key) DO NOTHING;
