-- Multicanal publish: super_admin pode gravar configs GLOBAIS
-- (consultant_id IS NULL) em temas e stages. Antes só tinham write own;
-- stages exigiam role admin (SA puro falhava).

-- ─── cadence_theme_config ───────────────────────────────────────────────
DROP POLICY IF EXISTS cadence_theme_config_write_own ON public.cadence_theme_config;
DROP POLICY IF EXISTS cadence_theme_config_write_superadmin ON public.cadence_theme_config;

CREATE POLICY cadence_theme_config_write_own ON public.cadence_theme_config
  FOR ALL TO authenticated
  USING (consultant_id = auth.uid())
  WITH CHECK (consultant_id = auth.uid());

CREATE POLICY cadence_theme_config_write_superadmin ON public.cadence_theme_config
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (
    public.is_super_admin(auth.uid())
    AND (consultant_id IS NULL OR consultant_id = auth.uid())
  );

-- ─── cadence_stage_config ───────────────────────────────────────────────
DROP POLICY IF EXISTS "consultant manages own cadence_stage_config"
  ON public.cadence_stage_config;

CREATE POLICY "consultant manages own cadence_stage_config"
  ON public.cadence_stage_config
  FOR ALL TO authenticated
  USING (
    consultant_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.is_super_admin(auth.uid())
  )
  WITH CHECK (
    consultant_id = auth.uid()
    OR (
      consultant_id IS NULL
      AND (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.is_super_admin(auth.uid())
      )
    )
  );
