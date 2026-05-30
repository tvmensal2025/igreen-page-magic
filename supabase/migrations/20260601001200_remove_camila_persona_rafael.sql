-- ============================================================================
-- Remove a persona "Camila" de TUDO que o lead vê / a IA usa → vira "Rafael"
-- ============================================================================
-- Decisão do produto: o nome "Camila" nunca deve aparecer para o lead nem ser
-- usado como identidade da IA. Persona única = Rafael.
--
-- Cobertura:
--   1. bot_flow_steps.message_text (textos enviados ao lead)
--   2. bot_flow_steps.fallback->>'ai_prompt' (prompt da IA de dúvidas)
--   3. bot_flow_qa.text_response (atalhos)
--   4. bot_messages.text (templates legados)
--   5. ai_knowledge_sections.content/title (base da IA)
--   6. ai_agent_config.persona_name / tone / system_prompt
--
-- Usa replace() para trocar só o nome, preservando o resto do conteúdo.
-- Idempotente: rodar de novo não altera nada (não há mais "Camila").

-- 1) Textos dos passos
UPDATE public.bot_flow_steps
   SET message_text = replace(replace(message_text, 'Camila', 'Rafael'), 'camila', 'Rafael')
 WHERE message_text ILIKE '%camila%';

-- 2) Prompt da IA de dúvidas (campo JSON fallback.ai_prompt)
UPDATE public.bot_flow_steps
   SET fallback = jsonb_set(
         fallback,
         '{ai_prompt}',
         to_jsonb(replace(replace(fallback->>'ai_prompt', 'Camila', 'Rafael'), 'camila', 'Rafael'))
       )
 WHERE (fallback->>'ai_prompt') ILIKE '%camila%';

-- 3) Atalhos rápidos (QA)
UPDATE public.bot_flow_qa
   SET text_response = replace(replace(text_response, 'Camila', 'Rafael'), 'camila', 'Rafael')
 WHERE text_response ILIKE '%camila%';

-- 4) Templates legados
UPDATE public.bot_messages
   SET text = replace(replace(text, 'Camila', 'Rafael'), 'camila', 'Rafael')
 WHERE text ILIKE '%camila%';

-- 5) Base de conhecimento da IA
UPDATE public.ai_knowledge_sections
   SET content = replace(replace(content, 'Camila', 'Rafael'), 'camila', 'Rafael'),
       title   = replace(replace(title,   'Camila', 'Rafael'), 'camila', 'Rafael')
 WHERE content ILIKE '%camila%' OR title ILIKE '%camila%';

-- 6) Config da IA (persona, tom, system prompt)
UPDATE public.ai_agent_config
   SET persona_name = CASE WHEN persona_name ILIKE '%camila%' THEN 'Rafael' ELSE persona_name END,
       tone = replace(replace(coalesce(tone,''), 'Camila', 'Rafael'), 'camila', 'Rafael'),
       system_prompt = replace(replace(coalesce(system_prompt,''), 'Camila', 'Rafael'), 'camila', 'Rafael'),
       step_prompts = (replace(replace(step_prompts::text, 'Camila', 'Rafael'), 'camila', 'Rafael'))::jsonb
 WHERE persona_name ILIKE '%camila%'
    OR coalesce(tone,'') ILIKE '%camila%'
    OR coalesce(system_prompt,'') ILIKE '%camila%'
    OR step_prompts::text ILIKE '%camila%';
