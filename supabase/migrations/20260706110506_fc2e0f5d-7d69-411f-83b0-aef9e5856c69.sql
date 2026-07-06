
-- Fila de jobs para recon do iGreen
CREATE TABLE IF NOT EXISTS public.igreen_recon_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('route','endpoint','nm_month')),
  target TEXT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','error','skipped')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  result_id UUID,
  claimed_at TIMESTAMPTZ,
  done_at TIMESTAMPTZ,
  priority INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, target, params)
);

GRANT SELECT ON public.igreen_recon_queue TO authenticated;
GRANT ALL ON public.igreen_recon_queue TO service_role;

ALTER TABLE public.igreen_recon_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view queue"
ON public.igreen_recon_queue
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS igreen_recon_queue_pending_idx
  ON public.igreen_recon_queue (priority ASC, created_at ASC)
  WHERE status = 'pending';

-- Colunas extras em igreen_recon_routes
ALTER TABLE public.igreen_recon_routes
  ADD COLUMN IF NOT EXISTS raw_response JSONB,
  ADD COLUMN IF NOT EXISTS suggested_columns JSONB,
  ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES public.igreen_recon_queue(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS kind TEXT;

CREATE INDEX IF NOT EXISTS igreen_recon_routes_job_idx ON public.igreen_recon_routes (job_id);

-- Trigger updated_at para a fila
CREATE TRIGGER update_igreen_recon_queue_updated_at
  BEFORE UPDATE ON public.igreen_recon_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Extensões para cron
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- View de progresso
CREATE OR REPLACE VIEW public.igreen_recon_queue_progress AS
SELECT
  kind,
  status,
  COUNT(*)::int AS count
FROM public.igreen_recon_queue
GROUP BY kind, status;

GRANT SELECT ON public.igreen_recon_queue_progress TO authenticated;
