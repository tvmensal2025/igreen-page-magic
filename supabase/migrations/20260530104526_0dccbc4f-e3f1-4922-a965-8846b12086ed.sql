CREATE TABLE public.bot_flow_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  flow_id UUID NOT NULL,
  step_id UUID,
  consultant_id UUID,
  action TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  before JSONB,
  after JSONB,
  summary TEXT,
  user_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_bot_flow_audit_log_flow ON public.bot_flow_audit_log(flow_id, created_at DESC);
CREATE INDEX idx_bot_flow_audit_log_step ON public.bot_flow_audit_log(step_id, created_at DESC);

GRANT SELECT, INSERT ON public.bot_flow_audit_log TO authenticated;
GRANT ALL ON public.bot_flow_audit_log TO service_role;

ALTER TABLE public.bot_flow_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view audit logs of their flows"
ON public.bot_flow_audit_log
FOR SELECT
TO authenticated
USING (
  consultant_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.bot_flows f
    WHERE f.id = bot_flow_audit_log.flow_id
      AND f.consultant_id = auth.uid()
  )
  OR public.is_super_admin(auth.uid())
);

CREATE POLICY "Owners can insert audit logs of their flows"
ON public.bot_flow_audit_log
FOR INSERT
TO authenticated
WITH CHECK (
  consultant_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.bot_flows f
    WHERE f.id = bot_flow_audit_log.flow_id
      AND f.consultant_id = auth.uid()
  )
  OR public.is_super_admin(auth.uid())
);