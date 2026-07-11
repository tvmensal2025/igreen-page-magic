
DO $$ BEGIN
  CREATE TYPE public.cadence_stage AS ENUM (
    'NEW','GREETED','AI_QUALIFYING',
    'COLD_1','COLD_2','CALL_1','SMS_1',
    'COLD_3','CALL_2','SMS_2',
    'COLD_4','CALL_3',
    'CLOSE_LOST','RETARGET_META','PAUSED','WON'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.cadence_channel AS ENUM ('whatsapp','voice','sms','meta_audience','system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.lead_cadence_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL UNIQUE,
  consultant_id uuid,
  stage public.cadence_stage NOT NULL DEFAULT 'NEW',
  next_action_at timestamptz,
  last_action_at timestamptz,
  last_response_at timestamptz,
  attempts_by_channel jsonb NOT NULL DEFAULT '{}'::jsonb,
  temperature text NOT NULL DEFAULT 'warm',
  paused_reason text,
  paused_until timestamptz,
  retarget_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lcs_next_action
  ON public.lead_cadence_state (next_action_at)
  WHERE stage NOT IN ('CLOSE_LOST','WON','PAUSED');
CREATE INDEX IF NOT EXISTS idx_lcs_consultant ON public.lead_cadence_state (consultant_id);
CREATE INDEX IF NOT EXISTS idx_lcs_stage ON public.lead_cadence_state (stage);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_cadence_state TO authenticated;
GRANT ALL ON public.lead_cadence_state TO service_role;
ALTER TABLE public.lead_cadence_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cadence_state_owner_or_admin"
  ON public.lead_cadence_state
  FOR ALL
  USING (consultant_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (consultant_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.cadence_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  consultant_id uuid,
  stage public.cadence_stage NOT NULL,
  channel public.cadence_channel NOT NULL,
  status text NOT NULL DEFAULT 'sent',
  cost_cents integer NOT NULL DEFAULT 0,
  provider_ref text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cadence_action_stage_channel
  ON public.cadence_action_log (customer_id, stage, channel)
  WHERE status IN ('sent','delivered','answered');

CREATE INDEX IF NOT EXISTS idx_cal_customer ON public.cadence_action_log (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cal_consultant ON public.cadence_action_log (consultant_id, created_at DESC);

GRANT SELECT ON public.cadence_action_log TO authenticated;
GRANT ALL ON public.cadence_action_log TO service_role;
ALTER TABLE public.cadence_action_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cadence_log_owner_or_admin_read"
  ON public.cadence_action_log
  FOR SELECT
  USING (consultant_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.tg_lead_cadence_state_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_lcs_updated_at ON public.lead_cadence_state;
CREATE TRIGGER trg_lcs_updated_at
  BEFORE UPDATE ON public.lead_cadence_state
  FOR EACH ROW EXECUTE FUNCTION public.tg_lead_cadence_state_updated_at();

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS cadence_engine_enabled boolean NOT NULL DEFAULT false;
