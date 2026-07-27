-- Pós-venda: completar linguagem neutra + recriar áudios agendados.
-- NÃO altera {{saudacao}} / {{nome}} (variáveis preservadas).

-- 1) "amigo" → neutro
UPDATE public.pos_venda_default_media
SET message_text = replace(replace(
  message_text,
  'familiar, amigo, vizinho ou colega', 'familiar, alguém próximo, vizinho ou colega'),
  'ajudar um amigo ou familiar', 'ajudar alguém próximo'),
  updated_at = now()
WHERE message_text IS NOT NULL
  AND (
    message_text ILIKE '%familiar, amigo, vizinho%'
    OR message_text ILIKE '%ajudar um amigo ou familiar%'
  );

UPDATE public.stage_auto_messages sam
SET message_text = replace(replace(
  sam.message_text,
  'familiar, amigo, vizinho ou colega', 'familiar, alguém próximo, vizinho ou colega'),
  'ajudar um amigo ou familiar', 'ajudar alguém próximo')
FROM public.kanban_stages ks
WHERE sam.stage_id = ks.id
  AND ks.stage_scope = 'pos_venda'
  AND sam.message_text IS NOT NULL
  AND (
    sam.message_text ILIKE '%familiar, amigo, vizinho%'
    OR sam.message_text ILIKE '%ajudar um amigo ou familiar%'
  );

UPDATE public.kanban_stages
SET auto_message_text = replace(replace(
  auto_message_text,
  'familiar, amigo, vizinho ou colega', 'familiar, alguém próximo, vizinho ou colega'),
  'ajudar um amigo ou familiar', 'ajudar alguém próximo')
WHERE stage_scope = 'pos_venda'
  AND auto_message_text IS NOT NULL
  AND (
    auto_message_text ILIKE '%familiar, amigo, vizinho%'
    OR auto_message_text ILIKE '%ajudar um amigo ou familiar%'
  );

-- 2) Rede de segurança: qualquer residual masculino clássico (idempotente)
UPDATE public.pos_venda_default_media
SET message_text = replace(replace(replace(replace(replace(replace(replace(
  message_text,
  'fique tranquilo', 'não se preocupe'),
  'fique tranquila', 'não se preocupe'),
  'Seja muito bem-vindo à iGreen.', 'É uma alegria ter você na iGreen.'),
  'Seja muito bem-vinda à iGreen.', 'É uma alegria ter você na iGreen.'),
  'Muito obrigado pela confiança.', 'Agradecemos muito pela confiança.'),
  'Muito obrigado pela compreensão.', 'Agradecemos pela compreensão.'),
  'Obrigado pela confiança.', 'Agradecemos pela confiança.'),
  updated_at = now()
WHERE message_text IS NOT NULL
  AND message_text ~* '(fique tranquil[oa]|bem-vind[oa] à iGreen|Obrigado pela)';

UPDATE public.pos_venda_default_media
SET message_text = replace(replace(
  message_text,
  'você será informado', 'avisaremos você'),
  'você será informada', 'avisaremos você'),
  updated_at = now()
WHERE message_text IS NOT NULL
  AND message_text ~* 'você será informad[oa]';

UPDATE public.stage_auto_messages sam
SET message_text = replace(replace(replace(replace(replace(replace(replace(replace(replace(
  sam.message_text,
  'fique tranquilo', 'não se preocupe'),
  'fique tranquila', 'não se preocupe'),
  'Seja muito bem-vindo à iGreen.', 'É uma alegria ter você na iGreen.'),
  'Seja muito bem-vinda à iGreen.', 'É uma alegria ter você na iGreen.'),
  'Muito obrigado pela confiança.', 'Agradecemos muito pela confiança.'),
  'Muito obrigado pela compreensão.', 'Agradecemos pela compreensão.'),
  'Obrigado pela confiança.', 'Agradecemos pela confiança.'),
  'você será informado', 'avisaremos você'),
  'você será informada', 'avisaremos você')
FROM public.kanban_stages ks
WHERE sam.stage_id = ks.id
  AND ks.stage_scope = 'pos_venda'
  AND sam.message_text IS NOT NULL
  AND sam.message_text ~* '(fique tranquil[oa]|bem-vind[oa]|Obrigado pela|você será informad[oa])';

-- 3) Recriar: apaga TODOS os áudios pré-gerados e caches TTS do pós-venda
--    (próximo prep/envio regenera com texto neutro + {{saudacao}} atual)
DELETE FROM public.pos_venda_prepared_audio;

UPDATE public.ai_media_library
SET active = false, updated_at = now()
WHERE slot_key LIKE 'pv_tts_%'
  AND active = true;
