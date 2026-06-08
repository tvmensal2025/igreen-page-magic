
-- ============ remote_support_sessions ============
CREATE TABLE public.remote_support_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL,
  operator_id uuid,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','pending_code','active','ended','rejected','expired')),
  initiated_by text NOT NULL DEFAULT 'requester' CHECK (initiated_by IN ('requester','operator')),
  started_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  ip_requester text,
  ip_operator text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.remote_support_sessions TO authenticated;
GRANT ALL ON public.remote_support_sessions TO service_role;

ALTER TABLE public.remote_support_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "requester sees own sessions"
ON public.remote_support_sessions FOR SELECT TO authenticated
USING (requester_id = auth.uid() OR public.is_super_admin(auth.uid()));

CREATE POLICY "requester creates own session"
ON public.remote_support_sessions FOR INSERT TO authenticated
WITH CHECK (requester_id = auth.uid());

CREATE POLICY "super admin updates any session"
ON public.remote_support_sessions FOR UPDATE TO authenticated
USING (public.is_super_admin(auth.uid()) OR requester_id = auth.uid())
WITH CHECK (public.is_super_admin(auth.uid()) OR requester_id = auth.uid());

-- ============ remote_support_codes ============
CREATE TABLE public.remote_support_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.remote_support_sessions(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  rotates_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.remote_support_codes TO service_role;
-- Sem grants para anon/authenticated: só edge functions tocam aqui.

ALTER TABLE public.remote_support_codes ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_remote_support_codes_session ON public.remote_support_codes(session_id);

-- ============ remote_support_logs ============
CREATE TABLE public.remote_support_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.remote_support_sessions(id) ON DELETE CASCADE,
  actor text NOT NULL CHECK (actor IN ('operator','requester','system')),
  action text NOT NULL,
  target text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.remote_support_logs TO authenticated;
GRANT ALL ON public.remote_support_logs TO service_role;

ALTER TABLE public.remote_support_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_remote_support_logs_session ON public.remote_support_logs(session_id, created_at DESC);

CREATE POLICY "view logs of own session or super admin"
ON public.remote_support_logs FOR SELECT TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR session_id IN (SELECT id FROM public.remote_support_sessions WHERE requester_id = auth.uid())
);

CREATE POLICY "insert logs into own or operated session"
ON public.remote_support_logs FOR INSERT TO authenticated
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR session_id IN (SELECT id FROM public.remote_support_sessions WHERE requester_id = auth.uid())
);

-- Logs imutáveis: bloqueia UPDATE/DELETE para todos (service_role bypassa RLS).
CREATE POLICY "logs are immutable - no update"
ON public.remote_support_logs FOR UPDATE TO authenticated
USING (false);

CREATE POLICY "logs are immutable - no delete"
ON public.remote_support_logs FOR DELETE TO authenticated
USING (false);

-- ============ updated_at trigger ============
CREATE OR REPLACE FUNCTION public.touch_remote_support_session()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_remote_support_sessions_updated
BEFORE UPDATE ON public.remote_support_sessions
FOR EACH ROW EXECUTE FUNCTION public.touch_remote_support_session();

-- ============ Realtime ============
ALTER PUBLICATION supabase_realtime ADD TABLE public.remote_support_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.remote_support_logs;
