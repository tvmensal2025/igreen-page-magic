
ALTER TABLE public.cadence_stage_config
  ADD COLUMN IF NOT EXISTS velip_audio_id text;

-- Seeds globais (consultant_id = NULL) para novos estágios da fase 3.
INSERT INTO public.cadence_stage_config (consultant_id, stage, enabled, delay_hours, message_text, media_type)
VALUES
  (NULL, 'CALL_1', true, 24,  'Olá {{nome}}, aqui é da equipe iGreen Energy. Vi seu interesse em reduzir a conta de luz e queria falar rapidinho com você. Se quiser continuar pelo WhatsApp, é só me responder por lá.', 'tts'),
  (NULL, 'SMS_1',  true, 48,  'Ola {{nome}}, aqui e a iGreen Energy. Ainda quer economizar na conta de luz? Responda pelo WhatsApp: wa.me/{{consultor_phone}}', 'sms'),
  (NULL, 'CALL_2', true, 48,  '{{nome}}, sou {{consultor}} da iGreen. Passei aqui rapidinho pra ver se voce ainda tem interesse em reduzir a conta de luz. Me chama no WhatsApp!', 'tts'),
  (NULL, 'SMS_2',  true, 96,  '{{nome}}, ultima chance de garantir sua reducao na conta de luz sem obra e sem instalacao. Fale conosco: wa.me/{{consultor_phone}}', 'sms'),
  (NULL, 'CALL_3', true, 168, '{{nome}}, essa e a ultima ligacao da iGreen sobre a reducao da sua conta de luz. Se quiser aproveitar, me responde no WhatsApp.', 'tts')
ON CONFLICT (consultant_id, stage) DO NOTHING;
