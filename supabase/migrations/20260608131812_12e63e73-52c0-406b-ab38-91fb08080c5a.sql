DROP POLICY IF EXISTS "Read own or public audios" ON public.audio_library;
CREATE POLICY "Read own, public or super admin" ON public.audio_library
FOR SELECT TO authenticated
USING (
  consultant_id = auth.uid()
  OR is_public = true
  OR public.is_super_admin(auth.uid())
);