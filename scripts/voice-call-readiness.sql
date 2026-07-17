-- Checklist de prontidão das ligações Sofia (READ-ONLY).
-- Não dispara ligação, não chama ElevenLabs, não sobe áudio.
-- Uso: rodar no SQL Editor do Supabase (ou psql) e revisar gaps.

-- 1) Kill switches (devem estar OFF até validação explícita)
SELECT key, enabled, label, category
FROM public.automation_toggles
WHERE key IN (
  'cadence_engine',
  'cadence_call_1', 'cadence_call_2', 'cadence_call_3',
  'daily_reheat',
  'bot_flow_make_call'
)
ORDER BY key;

SELECT id, bot_global_enabled, cadence_engine_enabled
FROM public.app_settings
WHERE id = 'global';

SELECT id, enabled, live_dispatch_enabled
FROM public.daily_reheat_settings
WHERE id = 'global';

-- 2) Clips de corpo de ligação sem upload Velip
SELECT id, consultant_id, name, is_call_body, voice_id,
       (velip_audio_id IS NOT NULL) AS on_velip,
       updated_at
FROM public.voice_audio_clips
WHERE is_call_body IS TRUE
   OR voice_id = 'EJV7H2baGt5ab95tOoSG'
ORDER BY updated_at DESC
LIMIT 100;

SELECT count(*) FILTER (WHERE is_call_body AND velip_audio_id IS NULL) AS call_bodies_missing_velip,
       count(*) FILTER (WHERE is_call_body AND velip_audio_id IS NOT NULL) AS call_bodies_ready
FROM public.voice_audio_clips;

-- 3) Estágios CALL_* sem clip e sem velip_audio_id
SELECT consultant_id, stage, enabled,
       voice_audio_clip_id, personalize_name, velip_audio_id
FROM public.cadence_stage_config
WHERE stage IN ('CALL_1', 'CALL_2', 'CALL_3')
ORDER BY consultant_id NULLS FIRST, stage;

SELECT stage, consultant_id
FROM public.cadence_stage_config
WHERE stage IN ('CALL_1', 'CALL_2', 'CALL_3')
  AND voice_audio_clip_id IS NULL
  AND (velip_audio_id IS NULL OR btrim(velip_audio_id) = '');

-- 4) Passos make_call sem clip Sofia
SELECT f.consultant_id, f.variant, f.name AS flow_name,
       s.step_key, s.title, s.is_active,
       s.voice_audio_clip_id, s.personalize_name
FROM public.bot_flow_steps s
JOIN public.bot_flows f ON f.id = s.flow_id
WHERE s.step_type = 'make_call'
ORDER BY f.consultant_id, f.variant, s.position;

SELECT count(*) AS make_call_steps_missing_clip
FROM public.bot_flow_steps
WHERE step_type = 'make_call'
  AND voice_audio_clip_id IS NULL;

-- 5) Daily reheat kit: consultores sem clip de 1ª ligação
SELECT consultant_id, voice_audio_clip_id, voice_audio_clip_id_retry, personalize_name
FROM public.daily_reheat_kit
WHERE voice_audio_clip_id IS NULL;
