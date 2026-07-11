
CREATE TABLE IF NOT EXISTS public.ctwa_referral_probe_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  had_ctwa_phrase boolean NOT NULL DEFAULT false,
  matched_paths text[] NOT NULL DEFAULT '{}',
  extracted jsonb,
  payload jsonb NOT NULL,
  customer_id uuid,
  consultant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ctwa_referral_probe_log TO authenticated;
GRANT ALL ON public.ctwa_referral_probe_log TO service_role;
ALTER TABLE public.ctwa_referral_probe_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read probe log" ON public.ctwa_referral_probe_log FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS ctwa_probe_created_idx ON public.ctwa_referral_probe_log (created_at DESC);
CREATE INDEX IF NOT EXISTS ctwa_probe_source_idx ON public.ctwa_referral_probe_log (source, created_at DESC);
