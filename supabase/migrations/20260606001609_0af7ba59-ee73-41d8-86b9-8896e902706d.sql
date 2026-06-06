-- Recria as policies que estavam atribuídas ao role {public} restringindo-as ao role {authenticated}.

DROP POLICY IF EXISTS "Assigned consultant select customers" ON public.customers;
CREATE POLICY "Assigned consultant select customers"
  ON public.customers FOR SELECT
  TO authenticated
  USING (assigned_consultant_id = auth.uid());

DROP POLICY IF EXISTS "Assigned consultant update customers" ON public.customers;
CREATE POLICY "Assigned consultant update customers"
  ON public.customers FOR UPDATE
  TO authenticated
  USING (assigned_consultant_id = auth.uid())
  WITH CHECK (assigned_consultant_id = auth.uid());

DROP POLICY IF EXISTS "managers can read customers" ON public.customers;
CREATE POLICY "managers can read customers"
  ON public.customers FOR SELECT
  TO authenticated
  USING (can_view_consultant(auth.uid(), consultant_id));