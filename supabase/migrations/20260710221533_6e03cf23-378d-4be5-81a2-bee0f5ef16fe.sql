
ALTER TABLE public.voice_campaigns
  ADD COLUMN IF NOT EXISTS dispatch_kind text NOT NULL DEFAULT 'audio',
  ADD COLUMN IF NOT EXISTS tts_text text,
  ADD COLUMN IF NOT EXISTS tts_voice text,
  ADD COLUMN IF NOT EXISTS caller_id text,
  ADD COLUMN IF NOT EXISTS dtmf_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS velip_campaign_id text,
  ADD COLUMN IF NOT EXISTS velip_base_id text,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;

ALTER TABLE public.voice_call_logs
  ADD COLUMN IF NOT EXISTS dtmf_responses jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS price_per_min numeric;

CREATE TABLE IF NOT EXISTS public.voice_contact_bases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  velip_base_id text,
  total int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_contact_bases TO authenticated;
GRANT ALL ON public.voice_contact_bases TO service_role;
ALTER TABLE public.voice_contact_bases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "voice_contact_bases owner all"
  ON public.voice_contact_bases FOR ALL
  USING (auth.uid() = consultant_id)
  WITH CHECK (auth.uid() = consultant_id);

CREATE TABLE IF NOT EXISTS public.voice_contact_base_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id uuid NOT NULL REFERENCES public.voice_contact_bases(id) ON DELETE CASCADE,
  phone text NOT NULL,
  name text,
  vars jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS voice_contact_base_items_base_id_idx
  ON public.voice_contact_base_items(base_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_contact_base_items TO authenticated;
GRANT ALL ON public.voice_contact_base_items TO service_role;
ALTER TABLE public.voice_contact_base_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "voice_contact_base_items via owner"
  ON public.voice_contact_base_items FOR ALL
  USING (EXISTS (SELECT 1 FROM public.voice_contact_bases b WHERE b.id = voice_contact_base_items.base_id AND b.consultant_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.voice_contact_bases b WHERE b.id = voice_contact_base_items.base_id AND b.consultant_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.voice_sms_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL,
  campaign_id uuid,
  phone text NOT NULL,
  message text NOT NULL,
  velip_sms_id text,
  velip_ctid text,
  status text NOT NULL DEFAULT 'queued',
  delivery_status text,
  delivered_at timestamptz,
  cost numeric,
  balance_after numeric,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS voice_sms_log_consultant_idx
  ON public.voice_sms_log(consultant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS voice_sms_log_velip_id_idx
  ON public.voice_sms_log(velip_sms_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_sms_log TO authenticated;
GRANT ALL ON public.voice_sms_log TO service_role;
ALTER TABLE public.voice_sms_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "voice_sms_log owner all"
  ON public.voice_sms_log FOR ALL
  USING (auth.uid() = consultant_id)
  WITH CHECK (auth.uid() = consultant_id);

CREATE OR REPLACE FUNCTION public.voice_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS voice_contact_bases_touch ON public.voice_contact_bases;
CREATE TRIGGER voice_contact_bases_touch BEFORE UPDATE ON public.voice_contact_bases
  FOR EACH ROW EXECUTE FUNCTION public.voice_touch_updated_at();

DROP TRIGGER IF EXISTS voice_sms_log_touch ON public.voice_sms_log;
CREATE TRIGGER voice_sms_log_touch BEFORE UPDATE ON public.voice_sms_log
  FOR EACH ROW EXECUTE FUNCTION public.voice_touch_updated_at();
