-- automation_toggles: permitir manage também para super_admin
-- (antes só has_role admin — super_admin sozinho não conseguia ligar toggles)

DROP POLICY IF EXISTS "admin manage automation_toggles" ON public.automation_toggles;

CREATE POLICY "admin manage automation_toggles"
  ON public.automation_toggles FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.is_super_admin(auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.is_super_admin(auth.uid())
  );
