-- Auditoria IA do sync de carteira (espelha portal2_audit_traces, sem FK de customer).
CREATE TABLE IF NOT EXISTS public.sync_audit_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  consultant_email text NULL,
  consultor_id text NULL,
  route text NULL,
  status text NOT NULL DEFAULT 'ok',
  duration_ms integer NULL,
  error text NULL,
  input_summary jsonb NULL,
  result jsonb NULL,
  trace jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_summary text NULL,
  ai_findings jsonb NULL,
  ai_model text NULL,
  ai_tokens_in integer NULL,
  ai_tokens_out integer NULL,
  ai_cost_usd numeric NULL,
  skipped boolean NOT NULL DEFAULT false,
  skip_reason text NULL
);

CREATE INDEX IF NOT EXISTS sync_audit_traces_created_at_idx
  ON public.sync_audit_traces (created_at DESC);
CREATE INDEX IF NOT EXISTS sync_audit_traces_status_idx
  ON public.sync_audit_traces (status, created_at DESC);

ALTER TABLE public.sync_audit_traces ENABLE ROW LEVEL SECURITY;

-- Só service role / edges escrevem; sem policy anon/authenticated = deny by default.
COMMENT ON TABLE public.sync_audit_traces IS
  'Shadow review Gemini dos syncs de carteira (worker-igreen-sync). Limite SYNC_AI_AUDIT_LIMIT.';
