-- A_CALL / A_CALL_RETRY: corpo sem "Olá" (runtime costura Olá+nome) + personalize_name.
UPDATE public.cadence_stage_config
SET message_text = 'Eu sou {{assistente}}, assistente virtual de {{consultor}}, da iGreen.' || E'\n\n' ||
  'Estou ligando sobre a ativação do seu benefício de economia na conta de energia.' || E'\n\n' ||
  'Você prefere continuar pelo WhatsApp ou prefere que eu explique agora em 30 segundos?',
  personalize_name = true,
  template_version = GREATEST(COALESCE(template_version, 1), 3),
  template_updated_at = now(),
  updated_at = now()
WHERE stage = 'A_CALL';

UPDATE public.cadence_stage_config
SET message_text = 'Eu sou {{assistente}}, assistente virtual de {{consultor}}, da iGreen.' || E'\n\n' ||
  'Estou ligando novamente sobre a ativação do seu benefício de economia na conta de energia.' || E'\n\n' ||
  'Se preferir, é só responder no WhatsApp que seguimos por lá.',
  personalize_name = true,
  template_version = GREATEST(COALESCE(template_version, 1), 3),
  template_updated_at = now(),
  updated_at = now()
WHERE stage = 'A_CALL_RETRY';
