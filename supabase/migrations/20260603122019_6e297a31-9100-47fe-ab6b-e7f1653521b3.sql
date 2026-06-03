-- Add video support to ad templates
ALTER TABLE public.ad_templates
  ADD COLUMN IF NOT EXISTS video_url text,
  ADD COLUMN IF NOT EXISTS video_thumb_url text,
  ADD COLUMN IF NOT EXISTS creative_mode text NOT NULL DEFAULT 'photo';

-- Cache de vídeos enviados ao Meta (espelha ad_image_library)
CREATE TABLE IF NOT EXISTS public.ad_video_library (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  consultant_id uuid NOT NULL,
  url text NOT NULL,
  storage_path text,
  thumb_url text,
  width integer,
  height integer,
  duration_seconds numeric,
  file_size bigint,
  content_type text,
  filename text,
  fb_video_id text,
  fb_video_id_synced_at timestamp with time zone,
  usage_count integer NOT NULL DEFAULT 0,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ad_video_library_consultant_url_idx
  ON public.ad_video_library(consultant_id, url);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_video_library TO authenticated;
GRANT ALL ON public.ad_video_library TO service_role;

ALTER TABLE public.ad_video_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Consultor gerencia sua biblioteca de vídeos"
ON public.ad_video_library
FOR ALL
TO authenticated
USING (consultant_id = auth.uid())
WITH CHECK (consultant_id = auth.uid());

CREATE POLICY "Service role acessa tudo em ad_video_library"
ON public.ad_video_library
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
