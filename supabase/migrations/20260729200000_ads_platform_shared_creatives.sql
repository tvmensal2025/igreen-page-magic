-- Criativos oficiais compartilhados com todos os consultores (fotos/vídeos
-- já usados em anúncios). URLs públicas no Storage; RLS só liberava o dono.

ALTER TABLE public.ad_image_library
  ADD COLUMN IF NOT EXISTS is_platform_shared boolean NOT NULL DEFAULT false;

ALTER TABLE public.ad_video_library
  ADD COLUMN IF NOT EXISTS is_platform_shared boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ad_image_library.is_platform_shared IS
  'Se true, qualquer consultor autenticado pode ler/reusar no wizard (não editar/apagar).';
COMMENT ON COLUMN public.ad_video_library.is_platform_shared IS
  'Se true, qualquer consultor autenticado pode ler/reusar no wizard (não editar/apagar).';

DROP POLICY IF EXISTS "Consultants read platform shared ad images" ON public.ad_image_library;
CREATE POLICY "Consultants read platform shared ad images"
  ON public.ad_image_library
  FOR SELECT
  TO authenticated
  USING (is_platform_shared = true);

DROP POLICY IF EXISTS "Consultants read platform shared ad videos" ON public.ad_video_library;
CREATE POLICY "Consultants read platform shared ad videos"
  ON public.ad_video_library
  FOR SELECT
  TO authenticated
  USING (is_platform_shared = true);

-- Fotos oficiais (MG / winner / presets usados)
UPDATE public.ad_image_library
SET is_platform_shared = true
WHERE consultant_id = '0c2711ad-4836-41e6-afba-edd94f698ae3'
  AND (
    url LIKE '%/1783509775658-1000668870.png'
    OR url LIKE '%/1783483320894-1000668840.png'
    OR url LIKE '%/1783483323130-1000668859.png'
    OR url LIKE '%/1783483325381-1000668870.png'
    OR url LIKE '%/1783509773634-1000668859.png'
    OR url LIKE '%/1783509770991-1000668840.png'
    OR usage_count >= 2
  );

-- Vídeos oficiais (Reels Uberaba clean = versão limpa / “v2”, + Rodrigo_e_daine)
UPDATE public.ad_video_library
SET is_platform_shared = true
WHERE consultant_id = '0c2711ad-4836-41e6-afba-edd94f698ae3'
  AND (
    filename IN ('reels-uberaba-clean.mp4', 'reels-uberaba.mp4')
    OR url LIKE '%video-uberaba-reels-clean%'
    OR url LIKE '%video-uberaba-reels-1784763650%'
    OR url LIKE '%Rodrigo_e_daine.mp4'
  );

-- Template publicado com o vídeo limpo (Reels Uberaba) para 1-clique
INSERT INTO public.ad_templates (
  title,
  description,
  photos,
  headline,
  primary_text,
  description_text,
  age_min,
  age_max,
  genders,
  suggested_daily_budget_cents,
  status,
  created_by,
  creative_mode,
  video_url,
  video_thumb_url
)
SELECT
  'Reels Uberaba — vídeo limpo (oficial)',
  'Vídeo Reels oficial (versão limpa) para anúncio Click-to-WhatsApp. Use com a sua cidade/distribuidora.',
  '[]'::jsonb,
  'Conta de luz até 28% menor',
  'Moradores de {cidade} estão economizando na {distribuidora}. Fale no WhatsApp e veja se você também pode.',
  'Sem obras · Sem instalação · Resposta no Zap',
  25,
  55,
  ARRAY[]::integer[],
  5000,
  'published',
  '0c2711ad-4836-41e6-afba-edd94f698ae3'::uuid,
  'video',
  v.url,
  v.thumb_url
FROM public.ad_video_library v
WHERE v.id = '54874e84-5de4-49df-ad52-34e80c4222d2'
  AND NOT EXISTS (
    SELECT 1 FROM public.ad_templates t
    WHERE t.title = 'Reels Uberaba — vídeo limpo (oficial)'
      AND t.status = 'published'
  );
