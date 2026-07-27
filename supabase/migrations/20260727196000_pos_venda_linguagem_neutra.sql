-- Pós-venda: linguagem neutra (sem marcado masculino/feminino no cliente).
-- Ex.: "fique tranquilo" / "bem-vindo" / "obrigado" / "será informado".

-- 1) Padrão institucional
UPDATE public.pos_venda_default_media
SET message_text = replace(replace(replace(replace(replace(replace(replace(
  message_text,
  'fique tranquilo', 'não se preocupe'),
  'Seja muito bem-vindo à iGreen.', 'É uma alegria ter você na iGreen.'),
  'Muito obrigado pela confiança.', 'Agradecemos muito pela confiança.'),
  'Muito obrigado pela compreensão.', 'Agradecemos pela compreensão.'),
  'Obrigado pela confiança.', 'Agradecemos pela confiança.'),
  'você será informado', 'avisaremos você'),
  'ser reconhecido por isso', 'receber reconhecimento por isso'),
  updated_at = now()
WHERE message_text IS NOT NULL
  AND (
    message_text ILIKE '%fique tranquilo%'
    OR message_text ILIKE '%bem-vindo%'
    OR message_text ILIKE '%obrigado%'
    OR message_text ILIKE '%será informado%'
    OR message_text ILIKE '%reconhecido por isso%'
  );

-- 2) Mensagens dos consultores (kanban pós-venda)
UPDATE public.stage_auto_messages sam
SET message_text = replace(replace(replace(replace(replace(replace(replace(
  sam.message_text,
  'fique tranquilo', 'não se preocupe'),
  'Seja muito bem-vindo à iGreen.', 'É uma alegria ter você na iGreen.'),
  'Muito obrigado pela confiança.', 'Agradecemos muito pela confiança.'),
  'Muito obrigado pela compreensão.', 'Agradecemos pela compreensão.'),
  'Obrigado pela confiança.', 'Agradecemos pela confiança.'),
  'você será informado', 'avisaremos você'),
  'ser reconhecido por isso', 'receber reconhecimento por isso')
FROM public.kanban_stages ks
WHERE sam.stage_id = ks.id
  AND ks.stage_scope = 'pos_venda'
  AND sam.message_text IS NOT NULL
  AND (
    sam.message_text ILIKE '%fique tranquilo%'
    OR sam.message_text ILIKE '%bem-vindo%'
    OR sam.message_text ILIKE '%obrigado%'
    OR sam.message_text ILIKE '%será informado%'
    OR sam.message_text ILIKE '%reconhecido por isso%'
  );

-- 3) Kanban legacy (coluna auto_message_text)
UPDATE public.kanban_stages
SET auto_message_text = replace(replace(replace(replace(replace(replace(replace(
  auto_message_text,
  'fique tranquilo', 'não se preocupe'),
  'Seja muito bem-vindo à iGreen.', 'É uma alegria ter você na iGreen.'),
  'Muito obrigado pela confiança.', 'Agradecemos muito pela confiança.'),
  'Muito obrigado pela compreensão.', 'Agradecemos pela compreensão.'),
  'Obrigado pela confiança.', 'Agradecemos pela confiança.'),
  'você será informado', 'avisaremos você'),
  'ser reconhecido por isso', 'receber reconhecimento por isso')
WHERE stage_scope = 'pos_venda'
  AND auto_message_text IS NOT NULL
  AND (
    auto_message_text ILIKE '%fique tranquilo%'
    OR auto_message_text ILIKE '%bem-vindo%'
    OR auto_message_text ILIKE '%obrigado%'
    OR auto_message_text ILIKE '%será informado%'
    OR auto_message_text ILIKE '%reconhecido por isso%'
  );

-- 4) Invalidida TTS já gerado com o texto antigo (força regenerar no próximo prep/envio)
DELETE FROM public.pos_venda_prepared_audio
WHERE spoken_text ILIKE '%fique tranquilo%'
   OR spoken_text ILIKE '%bem-vindo%'
   OR spoken_text ILIKE '%Obrigado pela%'
   OR spoken_text ILIKE '%Muito obrigado%'
   OR spoken_text ILIKE '%será informado%'
   OR spoken_text ILIKE '%reconhecido por isso%';

UPDATE public.ai_media_library
SET active = false, updated_at = now()
WHERE slot_key LIKE 'pv_tts_%'
  AND active = true
  AND (
    coalesce(transcript, '') ILIKE '%fique tranquilo%'
    OR coalesce(transcript, '') ILIKE '%bem-vindo%'
    OR coalesce(transcript, '') ILIKE '%Obrigado pela%'
    OR coalesce(transcript, '') ILIKE '%Muito obrigado%'
    OR coalesce(transcript, '') ILIKE '%será informado%'
    OR coalesce(transcript, '') ILIKE '%reconhecido por isso%'
  );
