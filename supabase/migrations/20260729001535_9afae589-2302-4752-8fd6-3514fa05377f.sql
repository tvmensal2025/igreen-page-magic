CREATE POLICY "Consultants can read shared Sofia library"
ON public.voice_audio_clips
FOR SELECT
TO authenticated
USING (
  consultant_id::text = (SELECT value FROM public.settings WHERE key = 'superadmin_consultant_id')
);