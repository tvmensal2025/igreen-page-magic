-- Link oficial iGreen Club no consultor (modelo: https://club.igreenenergy.com.br/?id=<igreen_id>)
-- Independente do Portal 2 / cadastro_url de energia.

ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS club_cadastro_url text;

COMMENT ON COLUMN public.consultants.club_cadastro_url IS
  'Link oficial Conexão Club / iGreen Club: https://club.igreenenergy.com.br/?id=<igreen_id>';

-- Backfill a partir do igreen_id (mesmo padrão do cadastro_url / licenciada)
UPDATE public.consultants
SET club_cadastro_url = 'https://club.igreenenergy.com.br/?id=' || NULLIF(btrim(igreen_id::text), '')
WHERE igreen_id IS NOT NULL
  AND btrim(igreen_id::text) <> ''
  AND (club_cadastro_url IS NULL OR btrim(club_cadastro_url) = '');

-- Expõe na view pública (preserva filtro atual da view)
DROP VIEW IF EXISTS public.consultants_public;
CREATE VIEW public.consultants_public
WITH (security_invoker = false) AS
SELECT
  c.id,
  c.license,
  c.name,
  c.phone,
  c.cadastro_url,
  c.photo_url,
  c.igreen_id,
  c.licenciada_cadastro_url,
  c.club_cadastro_url,
  c.facebook_pixel_id,
  c.google_analytics_id,
  c.created_at,
  c.referred_by
FROM public.consultants AS c
WHERE c.license IS NOT NULL AND c.license <> '';

GRANT SELECT ON TABLE public.consultants_public TO anon, authenticated;

-- Mesmos privilégios de coluna dos outros links de cadastro
GRANT SELECT (club_cadastro_url), INSERT (club_cadastro_url), UPDATE (club_cadastro_url)
  ON public.consultants TO authenticated;
GRANT SELECT (club_cadastro_url) ON public.consultants TO anon;
