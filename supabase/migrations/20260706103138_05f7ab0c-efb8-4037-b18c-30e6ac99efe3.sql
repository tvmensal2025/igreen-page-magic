
CREATE TABLE IF NOT EXISTS public.igreen_recon_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  consultant_id uuid,
  consultant_email text,
  route text NOT NULL,
  final_path text,
  title text,
  screenshot_path text,
  html_length integer,
  html_snippet text,
  dom_outline jsonb,
  new_endpoints jsonb,
  ai_summary text,
  ai_fields jsonb,
  elapsed_ms integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.igreen_recon_routes TO authenticated;
GRANT ALL ON public.igreen_recon_routes TO service_role;

ALTER TABLE public.igreen_recon_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read recon routes"
  ON public.igreen_recon_routes FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_recon_routes_run ON public.igreen_recon_routes(run_id, route);

-- Storage policies para bucket privado igreen-recon (admins leem)
CREATE POLICY "Admins read igreen-recon"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'igreen-recon' AND public.has_role(auth.uid(), 'admin'::app_role));
