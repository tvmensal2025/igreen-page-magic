
-- 1) bot_flow_qa: add is_public + read policy for global QAs
ALTER TABLE public.bot_flow_qa
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_bot_flow_qa_is_public ON public.bot_flow_qa(is_public) WHERE is_public = true;

DROP POLICY IF EXISTS "Authenticated read public qa" ON public.bot_flow_qa;
CREATE POLICY "Authenticated read public qa"
  ON public.bot_flow_qa FOR SELECT
  TO authenticated
  USING (is_public = true);

-- Allow reading triggers + media of public QAs
DROP POLICY IF EXISTS "Authenticated read public qa triggers" ON public.bot_flow_qa_triggers;
CREATE POLICY "Authenticated read public qa triggers"
  ON public.bot_flow_qa_triggers FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bot_flow_qa q WHERE q.id = bot_flow_qa_triggers.qa_id AND q.is_public = true));

DROP POLICY IF EXISTS "Authenticated read public qa media" ON public.bot_flow_qa_media;
CREATE POLICY "Authenticated read public qa media"
  ON public.bot_flow_qa_media FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bot_flow_qa q WHERE q.id = bot_flow_qa_media.qa_id AND q.is_public = true));

-- Backfill: mark all QAs of super-admin flows as public (so consultants see them)
UPDATE public.bot_flow_qa q
SET is_public = true
WHERE is_public = false
  AND EXISTS (
    SELECT 1 FROM public.bot_flows f
    WHERE f.id = q.flow_id
      AND public.is_super_admin(f.consultant_id)
  );

-- 2) ai_knowledge_sections: allow authenticated to read global rows
DROP POLICY IF EXISTS "Authenticated read public knowledge" ON public.ai_knowledge_sections;
CREATE POLICY "Authenticated read public knowledge"
  ON public.ai_knowledge_sections FOR SELECT
  TO authenticated
  USING (consultant_id IS NULL OR consultant_id = auth.uid() OR is_active = true);

-- Ensure grants
GRANT SELECT ON public.bot_flow_qa TO authenticated;
GRANT SELECT ON public.bot_flow_qa_triggers TO authenticated;
GRANT SELECT ON public.bot_flow_qa_media TO authenticated;
GRANT SELECT ON public.ai_knowledge_sections TO authenticated;
