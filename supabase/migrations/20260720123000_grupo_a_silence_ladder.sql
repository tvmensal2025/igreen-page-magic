-- Grupo A: escada de silêncio antes do B (cutucada → SMS → call → retry).
-- Alinha pizza: não pular direto de GREETED para COLD_1.
-- Enum precisa existir antes de INSERT em cadence_stage_config / updates em lead_cadence_state.
ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'A_NUDGE';
ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'A_SMS';
ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'A_CALL';
ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'A_CALL_RETRY';

INSERT INTO public.automation_toggles (key, label, description, category, enabled)
VALUES
  ('cadence_a_nudge', 'Grupo A — cutucada Zap', 'Cutucada WhatsApp após silêncio no Grupo A', 'cadencia', true),
  ('cadence_a_sms', 'Grupo A — SMS silêncio', 'SMS após cutucada sem resposta no Grupo A', 'cadencia', true),
  ('cadence_a_call', 'Grupo A — ligação + retry', 'Ligação e retry antes de entrar no Grupo B', 'cadencia', true)
ON CONFLICT (key) DO UPDATE
SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  updated_at = now();

-- Templates: global (consultant_id null)
INSERT INTO public.cadence_stage_config (consultant_id, stage, enabled, delay_hours, message_text)
VALUES
  (NULL, 'A_NUDGE', true, 0,
   E'Oi {{nome}}, aqui é da *iGreen*.\n\nVi que sua simulação da conta de luz ficou pendente. Posso retomar de onde paramos — é só responder por aqui.'),
  (NULL, 'A_SMS', true, 2,
   E'Sofia | iGreen: Oi {{nome}}! Ative seu beneficio no WhatsApp: https://wa.me/{{consultor_phone}}'),
  (NULL, 'A_CALL', true, 2,
   E'Olá! Eu sou a Sofia, assistente virtual do {{consultor}}, da iGreen.\n\nEstou ligando sobre a ativação do seu benefício de economia na conta de energia.\n\nVocê prefere continuar pelo WhatsApp ou prefere que eu explique agora em 30 segundos?'),
  (NULL, 'A_CALL_RETRY', true, 0.5,
   E'Olá! Eu sou a Sofia, assistente virtual do {{consultor}}, da iGreen.\n\nEstou ligando novamente sobre a ativação do seu benefício de economia na conta de energia.\n\nSe preferir, é só responder no WhatsApp que seguimos por lá.')
ON CONFLICT (stage) WHERE consultant_id IS NULL DO UPDATE
SET
  enabled = true,
  delay_hours = EXCLUDED.delay_hours,
  message_text = COALESCE(NULLIF(public.cadence_stage_config.message_text, ''), EXCLUDED.message_text),
  updated_at = now();

-- Áudio Sofia: herda clip do CALL_1 global se existir
UPDATE public.cadence_stage_config a
SET voice_audio_clip_id = c.voice_audio_clip_id,
    updated_at = now()
FROM public.cadence_stage_config c
WHERE a.consultant_id IS NULL
  AND a.stage IN ('A_CALL', 'A_CALL_RETRY')
  AND c.consultant_id IS NULL
  AND c.stage = 'CALL_1'
  AND c.voice_audio_clip_id IS NOT NULL
  AND a.voice_audio_clip_id IS NULL;

-- Por consultor (quem já tem COLD_1)
INSERT INTO public.cadence_stage_config (
  consultant_id, stage, enabled, delay_hours, message_text, voice_audio_clip_id
)
SELECT
  c.consultant_id,
  v.stage,
  true,
  v.delay_hours,
  v.message_text,
  CASE
    WHEN v.stage IN ('A_CALL', 'A_CALL_RETRY') THEN call1.voice_audio_clip_id
    ELSE NULL
  END
FROM (SELECT DISTINCT consultant_id FROM public.cadence_stage_config WHERE stage = 'COLD_1' AND consultant_id IS NOT NULL) c
CROSS JOIN (
  VALUES
    ('A_NUDGE', 0::numeric, E'Oi {{nome}}, aqui é da *iGreen*.\n\nVi que sua simulação da conta de luz ficou pendente. Posso retomar de onde paramos — é só responder por aqui.'),
    ('A_SMS', 2::numeric, E'Sofia | iGreen: Oi {{nome}}! Ative seu beneficio no WhatsApp: https://wa.me/{{consultor_phone}}'),
    ('A_CALL', 2::numeric, E'Olá! Eu sou a Sofia, assistente virtual do {{consultor}}, da iGreen.\n\nEstou ligando sobre a ativação do seu benefício de economia na conta de energia.\n\nVocê prefere continuar pelo WhatsApp ou prefere que eu explique agora em 30 segundos?'),
    ('A_CALL_RETRY', 0.5::numeric, E'Olá! Eu sou a Sofia, assistente virtual do {{consultor}}, da iGreen.\n\nEstou ligando novamente sobre a ativação do seu benefício de economia na conta de energia.\n\nSe preferir, é só responder no WhatsApp que seguimos por lá.')
) AS v(stage, delay_hours, message_text)
LEFT JOIN public.cadence_stage_config call1
  ON call1.consultant_id = c.consultant_id AND call1.stage = 'CALL_1'
ON CONFLICT (consultant_id, stage) DO UPDATE
SET
  enabled = true,
  delay_hours = EXCLUDED.delay_hours,
  message_text = COALESCE(NULLIF(public.cadence_stage_config.message_text, ''), EXCLUDED.message_text),
  voice_audio_clip_id = COALESCE(public.cadence_stage_config.voice_audio_clip_id, EXCLUDED.voice_audio_clip_id),
  updated_at = now();
