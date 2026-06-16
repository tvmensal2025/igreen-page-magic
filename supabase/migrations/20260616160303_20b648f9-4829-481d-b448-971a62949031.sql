-- Helper: extract sale_id (first path segment) from object name
-- Caminho: <sale_id>/<sale_stage_id>/<filename>

CREATE POLICY "sales_attachments_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'sales-attachments' AND (
      public.has_role(auth.uid(), 'admin')
      OR public.is_super_admin(auth.uid())
      OR (
        split_part(name, '/', 1) ~ '^[0-9a-f-]{36}$'
        AND (split_part(name, '/', 1))::uuid IN (
          SELECT s.id FROM public.sales s WHERE s.consultant_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "sales_attachments_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'sales-attachments' AND (
      public.has_role(auth.uid(), 'admin')
      OR public.is_super_admin(auth.uid())
      OR (
        split_part(name, '/', 1) ~ '^[0-9a-f-]{36}$'
        AND (split_part(name, '/', 1))::uuid IN (
          SELECT s.id FROM public.sales s WHERE s.consultant_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "sales_attachments_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'sales-attachments' AND (
      public.has_role(auth.uid(), 'admin')
      OR public.is_super_admin(auth.uid())
      OR (
        split_part(name, '/', 1) ~ '^[0-9a-f-]{36}$'
        AND (split_part(name, '/', 1))::uuid IN (
          SELECT s.id FROM public.sales s WHERE s.consultant_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "sales_attachments_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'sales-attachments' AND (
      public.has_role(auth.uid(), 'admin')
      OR public.is_super_admin(auth.uid())
      OR (
        split_part(name, '/', 1) ~ '^[0-9a-f-]{36}$'
        AND (split_part(name, '/', 1))::uuid IN (
          SELECT s.id FROM public.sales s WHERE s.consultant_id = auth.uid()
        )
      )
    )
  );