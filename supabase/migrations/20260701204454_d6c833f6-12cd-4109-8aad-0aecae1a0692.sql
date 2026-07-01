
-- Histórico de sincronizações iGreen por consultor
CREATE TABLE IF NOT EXISTS public.igreen_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  mode text NOT NULL,
  status text NOT NULL DEFAULT 'running', -- running | ok | failed | waf_blocked | invalid_credentials
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_igreen_sync_runs_consultant_started
  ON public.igreen_sync_runs (consultant_id, started_at DESC);

GRANT SELECT ON public.igreen_sync_runs TO authenticated;
GRANT ALL ON public.igreen_sync_runs TO service_role;

ALTER TABLE public.igreen_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Consultants read own sync runs"
  ON public.igreen_sync_runs FOR SELECT
  TO authenticated
  USING (auth.uid() = consultant_id OR public.has_role(auth.uid(), 'admin'));

-- Status de credenciais no consultor
ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS igreen_credential_status text,
  ADD COLUMN IF NOT EXISTS igreen_credential_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS igreen_credential_error text;
