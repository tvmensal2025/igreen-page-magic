-- Preferência de idade (age_range Meta) vs hard Advantage+ (age_min/age_max).
ALTER TABLE public.facebook_campaigns
  ADD COLUMN IF NOT EXISTS age_min_preferred int;

COMMENT ON COLUMN public.facebook_campaigns.age_min_preferred IS
  'Preferência de idade enviada à Meta via age_range (ex. 30). age_min/age_max = hard Advantage+ (25/65).';
