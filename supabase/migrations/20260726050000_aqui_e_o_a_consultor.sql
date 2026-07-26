-- Apresentação WA: "Aqui é o/a *{{consultor}}*" (nunca "Aqui é consultor" sem artigo).
-- Só textos; áudios/TTS não entram aqui.
-- {{o_a_consultor}} resolve em runtime (o | a) via consultants.gender.

-- cadence_stage_config (A_NUDGE, COLD_*, RECALL_*)
UPDATE public.cadence_stage_config
SET message_text = replace(message_text, 'Aqui é *{{consultor}}*', 'Aqui é {{o_a_consultor}} *{{consultor}}*'),
    updated_at = now()
WHERE message_text LIKE '%Aqui é *{{consultor}}*%'
  AND message_text NOT LIKE '%Aqui é {{o_a_consultor}} *{{consultor}}*%';

UPDATE public.cadence_stage_config
SET message_text = replace(message_text, 'Aqui é *{{representante}}*', 'Aqui é {{o_a_consultor}} *{{representante}}*'),
    updated_at = now()
WHERE message_text LIKE '%Aqui é *{{representante}}*%'
  AND message_text NOT LIKE '%Aqui é {{o_a_consultor}} *{{representante}}*%';

-- Temas rotativos (COLD_2…)
UPDATE public.cadence_theme_config
SET wa_text = replace(wa_text, 'Aqui é *{{consultor}}*', 'Aqui é {{o_a_consultor}} *{{consultor}}*'),
    updated_at = now()
WHERE wa_text LIKE '%Aqui é *{{consultor}}*%'
  AND wa_text NOT LIKE '%Aqui é {{o_a_consultor}} *{{consultor}}*%';

-- Follow-up "sumiu" (bot_followup_checker)
UPDATE public.consultant_message_templates
SET text_content = replace(text_content, 'Aqui é *{{consultor}}*', 'Aqui é {{o_a_consultor}} *{{consultor}}*'),
    updated_at = now()
WHERE text_content LIKE '%Aqui é *{{consultor}}*%'
  AND text_content NOT LIKE '%Aqui é {{o_a_consultor}} *{{consultor}}*%';

-- Fluxo A1 / steps ativos
UPDATE public.bot_flow_steps
SET message_text = replace(message_text, 'Aqui é *{{representante}}*', 'Aqui é {{o_a_consultor}} *{{representante}}*'),
    updated_at = now()
WHERE message_text LIKE '%Aqui é *{{representante}}*%'
  AND message_text NOT LIKE '%Aqui é {{o_a_consultor}} *{{representante}}*%';

UPDATE public.bot_flow_steps
SET message_text = replace(message_text, 'Aqui é *{{consultor}}*', 'Aqui é {{o_a_consultor}} *{{consultor}}*'),
    updated_at = now()
WHERE message_text LIKE '%Aqui é *{{consultor}}*%'
  AND message_text NOT LIKE '%Aqui é {{o_a_consultor}} *{{consultor}}*%';
