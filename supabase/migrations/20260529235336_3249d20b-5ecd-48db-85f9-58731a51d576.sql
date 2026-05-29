-- Grant SELECT on portal2_audit_traces so the captação UI can show the latest portal error.
-- Only consultors who own the related customer (or admins) can read it.

GRANT SELECT ON public.portal2_audit_traces TO authenticated;
GRANT ALL ON public.portal2_audit_traces TO service_role;

ALTER TABLE public.portal2_audit_traces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner reads portal audit traces" ON public.portal2_audit_traces;
CREATE POLICY "Owner reads portal audit traces"
ON public.portal2_audit_traces
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = portal2_audit_traces.customer_id
      AND (
        c.consultant_id = auth.uid()
        OR c.assigned_consultant_id = auth.uid()
        OR public.has_role(auth.uid(), 'admin'::public.app_role)
      )
  )
);