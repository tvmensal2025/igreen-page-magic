UPDATE public.bot_flow_steps
SET fallback = jsonb_set(COALESCE(fallback, '{}'::jsonb), '{mode}', '"ai"')
WHERE step_key = 'd_welcome';