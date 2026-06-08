CREATE TABLE public.consultant_network (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL,
  codigo_igreen text NOT NULL,
  nivel integer,
  nome text,
  patrocinador_codigo text,
  celular text,
  cidade text,
  uf text,
  graduacao text,
  gp_qualificados numeric,
  gl_qualificados numeric,
  mes_ref text,
  raw_json jsonb,
  source text NOT NULL DEFAULT 'igreen_extension_xlsx',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consultant_id, codigo_igreen)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultant_network TO authenticated;
GRANT ALL ON public.consultant_network TO service_role;

ALTER TABLE public.consultant_network ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Consultants view own network"
  ON public.consultant_network FOR SELECT
  TO authenticated
  USING (consultant_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Consultants insert own network"
  ON public.consultant_network FOR INSERT
  TO authenticated
  WITH CHECK (consultant_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Consultants update own network"
  ON public.consultant_network FOR UPDATE
  TO authenticated
  USING (consultant_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (consultant_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Consultants delete own network"
  ON public.consultant_network FOR DELETE
  TO authenticated
  USING (consultant_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_consultant_network_consultant ON public.consultant_network (consultant_id);
CREATE INDEX idx_consultant_network_codigo ON public.consultant_network (codigo_igreen);

CREATE TRIGGER trg_consultant_network_updated_at
  BEFORE UPDATE ON public.consultant_network
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();