
-- R2: índice único (flow_id, step_key)
CREATE UNIQUE INDEX IF NOT EXISTS bot_flow_steps_flow_step_key_unique
  ON public.bot_flow_steps (flow_id, step_key);

-- R1: marcar Fluxo A como template público da variante A
UPDATE public.bot_flows
SET is_public = true, updated_at = now()
WHERE id = '28acf20a-eaac-4548-8cf9-041781c41f56';
