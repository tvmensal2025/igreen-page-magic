
CREATE TABLE public.igreen_extension_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  consultant_id UUID NOT NULL,
  label TEXT NOT NULL DEFAULT 'Extensão',
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '90 days'),
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  last_used_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_igreen_extension_tokens_consultant ON public.igreen_extension_tokens(consultant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.igreen_extension_tokens TO authenticated;
GRANT ALL ON public.igreen_extension_tokens TO service_role;

ALTER TABLE public.igreen_extension_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Consultants see own ext tokens"
  ON public.igreen_extension_tokens FOR SELECT
  TO authenticated
  USING (consultant_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Consultants create own ext tokens"
  ON public.igreen_extension_tokens FOR INSERT
  TO authenticated
  WITH CHECK (consultant_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Consultants update own ext tokens"
  ON public.igreen_extension_tokens FOR UPDATE
  TO authenticated
  USING (consultant_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (consultant_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Consultants delete own ext tokens"
  ON public.igreen_extension_tokens FOR DELETE
  TO authenticated
  USING (consultant_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_igreen_extension_tokens_updated_at
  BEFORE UPDATE ON public.igreen_extension_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
