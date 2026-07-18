-- Zero Lead Perdido v5 gaps — parte 2: seeds SMS tema + COLD_2 placeholder + toggles OFF.

-- Dia 2 WA: motor resolve {{tema_whatsapp}} via picker (não envia placeholder literal).
UPDATE public.cadence_stage_config
SET message_text = '{{tema_whatsapp}}', updated_at = now()
WHERE consultant_id IS NULL AND stage = 'COLD_2';

-- enabled=true no config; kill switch real = automation_toggles (default OFF).
INSERT INTO public.cadence_stage_config (consultant_id, stage, enabled, delay_hours, message_text, media_type)
SELECT NULL, v.stage::public.cadence_stage, true, v.delay_hours, v.message_text, 'text'
FROM (VALUES
  ('SMS_TEMA_2', 2,
   '{{tema_sms}}'),
  ('SMS_TEMA_7', 2,
   '{{tema_sms}}')
) AS v(stage, delay_hours, message_text)
WHERE NOT EXISTS (
  SELECT 1 FROM public.cadence_stage_config c
  WHERE c.consultant_id IS NULL AND c.stage::text = v.stage
);

INSERT INTO public.automation_toggles (key, label, description, category, enabled)
VALUES
  ('cadence_sms_tema_2', 'SMS tema Dia 2', 'SMS temático ~2h após WA Dia 2, só se silêncio.', 'cadencia', false),
  ('cadence_sms_tema_7', 'SMS tema Dia 7', 'SMS temático ~2h após WA Dia 7, só se silêncio.', 'cadencia', false)
ON CONFLICT (key) DO NOTHING;
