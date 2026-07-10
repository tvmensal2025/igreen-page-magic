
CREATE TABLE IF NOT EXISTS public.voice_dnc_list (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  consultant_id UUID NOT NULL,
  phone TEXT NOT NULL,
  reason TEXT,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (consultant_id, phone)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_dnc_list TO authenticated;
GRANT ALL ON public.voice_dnc_list TO service_role;

ALTER TABLE public.voice_dnc_list ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consultants manage own dnc" ON public.voice_dnc_list
  FOR ALL
  USING (auth.uid() = consultant_id)
  WITH CHECK (auth.uid() = consultant_id);

CREATE INDEX IF NOT EXISTS idx_voice_dnc_consultant_phone
  ON public.voice_dnc_list (consultant_id, phone);

ALTER TABLE public.voice_campaigns
  ADD COLUMN IF NOT EXISTS sms_on_no_answer_text TEXT;
