ALTER TABLE public.bot_flow_steps REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bot_flow_steps;