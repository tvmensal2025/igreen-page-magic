
CREATE TABLE public.ad_bonus_tiers (
  tier text PRIMARY KEY CHECK (tier IN ('alto','medio','sem_bonus')),
  label text NOT NULL,
  percent integer NOT NULL DEFAULT 0 CHECK (percent >= 0 AND percent <= 100),
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ad_bonus_tiers TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.ad_bonus_tiers TO authenticated;
GRANT ALL ON public.ad_bonus_tiers TO service_role;

ALTER TABLE public.ad_bonus_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read bonus tiers"
  ON public.ad_bonus_tiers FOR SELECT TO authenticated USING (true);

CREATE POLICY "Only admins can insert bonus tiers"
  ON public.ad_bonus_tiers FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can update bonus tiers"
  ON public.ad_bonus_tiers FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can delete bonus tiers"
  ON public.ad_bonus_tiers FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER ad_bonus_tiers_updated_at
  BEFORE UPDATE ON public.ad_bonus_tiers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.ad_bonus_tiers (tier, label, percent) VALUES
  ('alto', 'Bônus alto', 60),
  ('medio', 'Bônus médio', 30),
  ('sem_bonus', 'Sem bônus', 0);
