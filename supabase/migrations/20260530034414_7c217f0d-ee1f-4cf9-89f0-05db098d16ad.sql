UPDATE public.bot_flow_steps
SET captures = '[{"enabled":true,"field":"_buttons","value":[{"id":"simular","title":"Quero simular"},{"id":"duvida","title":"Ainda tenho dúvida"},{"id":"humano","title":"Falar com Rafael"}]}]'::jsonb
WHERE id = 'c87d76f8-f4d2-48ec-ac08-4ef0b3c92834';