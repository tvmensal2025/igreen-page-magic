
CREATE TABLE public.igreen_endpoint_discovery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  category TEXT,
  status INT,
  content_type TEXT,
  bytes INT,
  ms INT,
  sample_body TEXT,
  is_alive BOOLEAN NOT NULL DEFAULT false,
  bucket TEXT,
  notes TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (method, path)
);

GRANT SELECT ON public.igreen_endpoint_discovery TO authenticated;
GRANT ALL ON public.igreen_endpoint_discovery TO service_role;

ALTER TABLE public.igreen_endpoint_discovery ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read discovery"
ON public.igreen_endpoint_discovery
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "service role manages discovery"
ON public.igreen_endpoint_discovery
FOR ALL
TO service_role
USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.tg_igreen_endpoint_discovery_touch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_igreen_endpoint_discovery_touch
BEFORE UPDATE ON public.igreen_endpoint_discovery
FOR EACH ROW EXECUTE FUNCTION public.tg_igreen_endpoint_discovery_touch();
