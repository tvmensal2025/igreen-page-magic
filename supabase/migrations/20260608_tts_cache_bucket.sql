-- Bucket compartilhado para cache de trechos TTS (ElevenLabs)
-- Público para leitura, autenticado para upload.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tts-cache', 'tts-cache', true, 5242880, ARRAY['audio/mpeg'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read tts-cache" ON storage.objects;
CREATE POLICY "Public read tts-cache" ON storage.objects
  FOR SELECT USING (bucket_id = 'tts-cache');

DROP POLICY IF EXISTS "Auth upload tts-cache" ON storage.objects;
CREATE POLICY "Auth upload tts-cache" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'tts-cache');

DROP POLICY IF EXISTS "Auth update tts-cache" ON storage.objects;
CREATE POLICY "Auth update tts-cache" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'tts-cache');
