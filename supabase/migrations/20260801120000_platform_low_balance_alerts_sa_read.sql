-- Super Admin pode ler avisos de iGreen Fone (modal de alertas).
-- service_role já bypassa RLS; authenticated super_admin precisa de SELECT.

ALTER TABLE public.platform_low_balance_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admin_read_platform_low_balance_alerts"
  ON public.platform_low_balance_alerts;

CREATE POLICY "super_admin_read_platform_low_balance_alerts"
  ON public.platform_low_balance_alerts
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role));

-- FK opcional para join consultants no modal (idempotente).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'platform_low_balance_alerts_consultant_id_fkey'
  ) THEN
    ALTER TABLE public.platform_low_balance_alerts
      ADD CONSTRAINT platform_low_balance_alerts_consultant_id_fkey
      FOREIGN KEY (consultant_id) REFERENCES public.consultants(id)
      ON DELETE CASCADE;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN others THEN
    RAISE NOTICE 'FK platform_low_balance_alerts: %', SQLERRM;
END $$;

COMMENT ON POLICY "super_admin_read_platform_low_balance_alerts"
  ON public.platform_low_balance_alerts IS
  'Super Admin lê último aviso iGreen Fone por consultor (modal OpsAlerts).';
