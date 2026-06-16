-- 1) Enum
CREATE TYPE public.sale_stage_status AS ENUM ('pendente','concluido');

-- 2) Templates
CREATE TABLE public.sale_stage_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position integer NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (position)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_stage_templates TO authenticated;
GRANT ALL ON public.sale_stage_templates TO service_role;
ALTER TABLE public.sale_stage_templates ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_sale_stage_templates_updated_at
  BEFORE UPDATE ON public.sale_stage_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_sale_stage_templates_position ON public.sale_stage_templates(position);

-- 3) Progress por venda
CREATE TABLE public.sale_stage_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  template_position integer NOT NULL,
  name_snapshot text NOT NULL,
  status public.sale_stage_status NOT NULL DEFAULT 'pendente',
  note text,
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_id, template_position)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_stage_progress TO authenticated;
GRANT ALL ON public.sale_stage_progress TO service_role;
ALTER TABLE public.sale_stage_progress ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_sale_stage_progress_updated_at
  BEFORE UPDATE ON public.sale_stage_progress
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_sale_stage_progress_sale ON public.sale_stage_progress(sale_id, template_position);

-- 4) Anexos
CREATE TABLE public.sale_stage_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_stage_id uuid NOT NULL REFERENCES public.sale_stage_progress(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime text NOT NULL,
  size_bytes bigint NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_stage_attachments TO authenticated;
GRANT ALL ON public.sale_stage_attachments TO service_role;
ALTER TABLE public.sale_stage_attachments ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_sale_stage_attachments_stage ON public.sale_stage_attachments(sale_stage_id);