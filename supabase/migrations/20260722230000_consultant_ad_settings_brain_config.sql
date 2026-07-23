-- Cérebro configurável na UI (budget, slots, idade, fila) sem redeploy.
ALTER TABLE public.consultant_ad_settings
  ADD COLUMN IF NOT EXISTS brain_config jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.consultant_ad_settings.brain_config IS
  'Cérebro/rotação: budgets, max exploradoras, idade preferida, preferred_slugs, extra_cities — editável na UI.';

DROP POLICY IF EXISTS "Admins manage ad settings" ON public.consultant_ad_settings;
CREATE POLICY "Admins manage ad settings"
  ON public.consultant_ad_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
