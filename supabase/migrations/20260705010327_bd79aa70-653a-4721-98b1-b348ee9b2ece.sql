GRANT SELECT ON public.bot_flows TO authenticated;
GRANT SELECT ON public.bot_flow_steps TO authenticated;
GRANT SELECT ON public.flow_template_submissions TO authenticated;
GRANT ALL ON public.bot_flows TO service_role;
GRANT ALL ON public.bot_flow_steps TO service_role;
GRANT ALL ON public.flow_template_submissions TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'bot_flows'
      AND policyname = 'Authenticated users can view public flow models'
  ) THEN
    CREATE POLICY "Authenticated users can view public flow models"
    ON public.bot_flows
    FOR SELECT
    TO authenticated
    USING (is_public = true AND is_active = true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'bot_flow_steps'
      AND policyname = 'Authenticated users can view public flow model steps'
  ) THEN
    CREATE POLICY "Authenticated users can view public flow model steps"
    ON public.bot_flow_steps
    FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.bot_flows f
        WHERE f.id = bot_flow_steps.flow_id
          AND f.is_public = true
          AND f.is_active = true
      )
    );
  END IF;
END $$;