-- Templates
CREATE POLICY "templates_select_authenticated"
  ON public.sale_stage_templates FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "templates_insert_admin"
  ON public.sale_stage_templates FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_super_admin(auth.uid()));

CREATE POLICY "templates_update_admin"
  ON public.sale_stage_templates FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_super_admin(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_super_admin(auth.uid()));

CREATE POLICY "templates_delete_admin"
  ON public.sale_stage_templates FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_super_admin(auth.uid()));

CREATE POLICY "templates_service_all"
  ON public.sale_stage_templates FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- Progress
CREATE POLICY "progress_select_owner_or_admin"
  ON public.sale_stage_progress FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.is_super_admin(auth.uid())
    OR sale_id IN (SELECT s.id FROM public.sales s WHERE s.consultant_id = auth.uid())
  );

CREATE POLICY "progress_insert_owner_or_admin"
  ON public.sale_stage_progress FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.is_super_admin(auth.uid())
    OR sale_id IN (SELECT s.id FROM public.sales s WHERE s.consultant_id = auth.uid())
  );

CREATE POLICY "progress_update_owner_or_admin"
  ON public.sale_stage_progress FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.is_super_admin(auth.uid())
    OR sale_id IN (SELECT s.id FROM public.sales s WHERE s.consultant_id = auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.is_super_admin(auth.uid())
    OR sale_id IN (SELECT s.id FROM public.sales s WHERE s.consultant_id = auth.uid())
  );

CREATE POLICY "progress_delete_admin"
  ON public.sale_stage_progress FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_super_admin(auth.uid()));

CREATE POLICY "progress_service_all"
  ON public.sale_stage_progress FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- Attachments
CREATE POLICY "attachments_select_owner_or_admin"
  ON public.sale_stage_attachments FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.is_super_admin(auth.uid())
    OR sale_stage_id IN (
      SELECT p.id FROM public.sale_stage_progress p
      JOIN public.sales s ON s.id = p.sale_id
      WHERE s.consultant_id = auth.uid()
    )
  );

CREATE POLICY "attachments_insert_owner_or_admin"
  ON public.sale_stage_attachments FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.is_super_admin(auth.uid())
    OR sale_stage_id IN (
      SELECT p.id FROM public.sale_stage_progress p
      JOIN public.sales s ON s.id = p.sale_id
      WHERE s.consultant_id = auth.uid()
    )
  );

CREATE POLICY "attachments_delete_owner_or_admin"
  ON public.sale_stage_attachments FOR DELETE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.is_super_admin(auth.uid())
    OR sale_stage_id IN (
      SELECT p.id FROM public.sale_stage_progress p
      JOIN public.sales s ON s.id = p.sale_id
      WHERE s.consultant_id = auth.uid()
    )
  );

CREATE POLICY "attachments_service_all"
  ON public.sale_stage_attachments FOR ALL
  TO service_role USING (true) WITH CHECK (true);