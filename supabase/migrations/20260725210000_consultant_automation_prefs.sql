-- Preferências de automação por consultor (opt-in).
-- Cadeado 2: global ON ≠ consultor ON. Default OFF; seed ON só quem já opera.

CREATE TABLE IF NOT EXISTS public.consultant_automation_prefs (
  consultant_id uuid PRIMARY KEY REFERENCES public.consultants(id) ON DELETE CASCADE,
  group_a_enabled boolean NOT NULL DEFAULT false,
  group_b_enabled boolean NOT NULL DEFAULT false,
  group_c_enabled boolean NOT NULL DEFAULT false,
  pos_venda_auto_enabled boolean NOT NULL DEFAULT false,
  reminders_auto_enabled boolean NOT NULL DEFAULT false,
  acked_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL
);

COMMENT ON TABLE public.consultant_automation_prefs IS
  'Opt-in por painel: outreach automático A/B/C, pós-venda e lembretes. Manual (chat/agenda) não usa esta tabela.';

CREATE INDEX IF NOT EXISTS idx_consultant_automation_prefs_acked
  ON public.consultant_automation_prefs (acked_at);

ALTER TABLE public.consultant_automation_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "consultant_automation_prefs_select_own" ON public.consultant_automation_prefs;
CREATE POLICY "consultant_automation_prefs_select_own"
  ON public.consultant_automation_prefs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = consultant_id);

DROP POLICY IF EXISTS "consultant_automation_prefs_insert_own" ON public.consultant_automation_prefs;
CREATE POLICY "consultant_automation_prefs_insert_own"
  ON public.consultant_automation_prefs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = consultant_id);

DROP POLICY IF EXISTS "consultant_automation_prefs_update_own" ON public.consultant_automation_prefs;
CREATE POLICY "consultant_automation_prefs_update_own"
  ON public.consultant_automation_prefs
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = consultant_id)
  WITH CHECK (auth.uid() = consultant_id);

GRANT SELECT, INSERT, UPDATE ON public.consultant_automation_prefs TO authenticated;
GRANT ALL ON public.consultant_automation_prefs TO service_role;

-- Seed ON: cadência viva OU outbound recente (14d).
INSERT INTO public.consultant_automation_prefs (
  consultant_id,
  group_a_enabled,
  group_b_enabled,
  group_c_enabled,
  pos_venda_auto_enabled,
  reminders_auto_enabled,
  acked_at,
  updated_at
)
SELECT
  c.id,
  true,
  true,
  true,
  true,
  true,
  now(),
  now()
FROM public.consultants c
WHERE EXISTS (
  SELECT 1 FROM public.lead_cadence_state lcs
  WHERE lcs.consultant_id = c.id
    AND lcs.stage::text NOT IN ('WON', 'CLOSE_LOST')
)
OR EXISTS (
  SELECT 1 FROM public.outbound_message_log oml
  WHERE oml.consultant_id = c.id
    AND oml.created_at > now() - interval '14 days'
)
OR EXISTS (
  SELECT 1 FROM public.cadence_action_log cal
  WHERE cal.consultant_id = c.id
    AND cal.created_at > now() - interval '14 days'
)
ON CONFLICT (consultant_id) DO NOTHING;
