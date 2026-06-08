
CREATE TABLE public.audio_library (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  consultant_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('mutirao','comercio')),
  city TEXT NOT NULL DEFAULT '',
  street TEXT NOT NULL DEFAULT '',
  time_slot TEXT NOT NULL DEFAULT '',
  place_name TEXT NOT NULL DEFAULT '',
  script_text TEXT NOT NULL DEFAULT '',
  audio_url TEXT NOT NULL,
  audio_hash TEXT NOT NULL DEFAULT '',
  is_public BOOLEAN NOT NULL DEFAULT false,
  play_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audio_library_lookup_idx ON public.audio_library (kind, lower(city), is_public, created_at DESC);
CREATE INDEX audio_library_owner_idx ON public.audio_library (consultant_id, kind, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audio_library TO authenticated;
GRANT ALL ON public.audio_library TO service_role;

ALTER TABLE public.audio_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read own or public audios"
  ON public.audio_library FOR SELECT
  TO authenticated
  USING (consultant_id = auth.uid() OR is_public = true);

CREATE POLICY "Insert own audios"
  ON public.audio_library FOR INSERT
  TO authenticated
  WITH CHECK (consultant_id = auth.uid());

CREATE POLICY "Update own audios"
  ON public.audio_library FOR UPDATE
  TO authenticated
  USING (consultant_id = auth.uid())
  WITH CHECK (consultant_id = auth.uid());

CREATE POLICY "Delete own audios"
  ON public.audio_library FOR DELETE
  TO authenticated
  USING (consultant_id = auth.uid());

CREATE OR REPLACE FUNCTION public.audio_library_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER audio_library_updated_at
  BEFORE UPDATE ON public.audio_library
  FOR EACH ROW EXECUTE FUNCTION public.audio_library_set_updated_at();

-- RPC para incrementar play_count sem precisar de SELECT prévio
CREATE OR REPLACE FUNCTION public.audio_library_increment_play(_id UUID)
RETURNS VOID AS $$
  UPDATE public.audio_library SET play_count = play_count + 1 WHERE id = _id;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.audio_library_increment_play(UUID) TO authenticated;
