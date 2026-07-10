CREATE TABLE IF NOT EXISTS public.voice_contact_bases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id UUID NOT NULL,
  name TEXT NOT NULL,
  phones JSONB NOT NULL DEFAULT '[]'::jsonb,
  total INTEGER NOT NULL DEFAULT 0,
  velip_base_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_contact_bases TO authenticated;
GRANT ALL ON public.voice_contact_bases TO service_role;
ALTER TABLE public.voice_contact_bases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Consultants manage their voice bases"
  ON public.voice_contact_bases FOR ALL
  USING (consultant_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (consultant_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS idx_voice_contact_bases_consultant ON public.voice_contact_bases(consultant_id);