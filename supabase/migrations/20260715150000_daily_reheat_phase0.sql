-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 0 — Ciclo diário (daily-reheat) Fila A/B
-- 100% ADITIVA. Toggles OFF. Cron só chama dry-run (sem WhatsApp/SMS/ligação).
-- Live dispatch NÃO está implementado na edge até validação explícita.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Settings globais do ciclo ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_reheat_settings (
  id text PRIMARY KEY DEFAULT 'global',
  enabled boolean NOT NULL DEFAULT false,
  daily_whapi_cap int NOT NULL DEFAULT 60
    CHECK (daily_whapi_cap BETWEEN 1 AND 600),
  queue_a_wait_minutes int NOT NULL DEFAULT 5
    CHECK (queue_a_wait_minutes BETWEEN 1 AND 120),
  queue_a_silence_hours numeric NOT NULL DEFAULT 2
    CHECK (queue_a_silence_hours BETWEEN 0.5 AND 48),
  cooldown_hours numeric NOT NULL DEFAULT 72
    CHECK (cooldown_hours BETWEEN 1 AND 720),
  cold_min_age_hours numeric NOT NULL DEFAULT 72
    CHECK (cold_min_age_hours BETWEEN 24 AND 2160),
  window_start_brt time NOT NULL DEFAULT '09:00',
  window_end_brt time NOT NULL DEFAULT '18:30',
  weekdays_only boolean NOT NULL DEFAULT true,
  flow_variant text NOT NULL DEFAULT 'F',
  priority_queue text NOT NULL DEFAULT 'A_then_B'
    CHECK (priority_queue IN ('A_then_B', 'B_then_A', 'A_only', 'B_only')),
  pilot_consultant_ids uuid[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.daily_reheat_settings (id) VALUES ('global')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.daily_reheat_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read daily_reheat_settings" ON public.daily_reheat_settings;
CREATE POLICY "auth read daily_reheat_settings"
  ON public.daily_reheat_settings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admin manage daily_reheat_settings" ON public.daily_reheat_settings;
CREATE POLICY "admin manage daily_reheat_settings"
  ON public.daily_reheat_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.daily_reheat_settings TO authenticated;
GRANT ALL ON public.daily_reheat_settings TO service_role;

-- ── 2. Log de cada tick (dry-run ou futuro live) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_reheat_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamptz NOT NULL DEFAULT now(),
  dry_run boolean NOT NULL DEFAULT true,
  candidates_a int NOT NULL DEFAULT 0,
  candidates_b int NOT NULL DEFAULT 0,
  would_send_whapi int NOT NULL DEFAULT 0,
  would_call int NOT NULL DEFAULT 0,
  would_sms int NOT NULL DEFAULT 0,
  skipped_cap int NOT NULL DEFAULT 0,
  skipped_guards int NOT NULL DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_daily_reheat_runs_run_at
  ON public.daily_reheat_runs (run_at DESC);

ALTER TABLE public.daily_reheat_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read daily_reheat_runs" ON public.daily_reheat_runs;
CREATE POLICY "auth read daily_reheat_runs"
  ON public.daily_reheat_runs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admin manage daily_reheat_runs" ON public.daily_reheat_runs;
CREATE POLICY "admin manage daily_reheat_runs"
  ON public.daily_reheat_runs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.daily_reheat_runs TO authenticated;
GRANT ALL ON public.daily_reheat_runs TO service_role;

-- ── 3. Fila diária por lead (1 row / customer / dia BRT) ───────────────────
CREATE TABLE IF NOT EXISTS public.daily_reheat_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  consultant_id uuid REFERENCES public.consultants(id) ON DELETE SET NULL,
  queue text NOT NULL CHECK (queue IN ('A', 'B')),
  cycle_date date NOT NULL,
  step text NOT NULL DEFAULT 'planned',
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'claimed', 'done', 'skipped', 'blocked')),
  skip_reason text,
  planned_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  run_id uuid REFERENCES public.daily_reheat_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, cycle_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_reheat_queue_cycle_status
  ON public.daily_reheat_queue (cycle_date, status, queue);

CREATE INDEX IF NOT EXISTS idx_daily_reheat_queue_consultant
  ON public.daily_reheat_queue (consultant_id, cycle_date);

ALTER TABLE public.daily_reheat_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read daily_reheat_queue" ON public.daily_reheat_queue;
CREATE POLICY "auth read daily_reheat_queue"
  ON public.daily_reheat_queue FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admin manage daily_reheat_queue" ON public.daily_reheat_queue;
CREATE POLICY "admin manage daily_reheat_queue"
  ON public.daily_reheat_queue FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.daily_reheat_queue TO authenticated;
GRANT ALL ON public.daily_reheat_queue TO service_role;

DROP TRIGGER IF EXISTS trg_daily_reheat_queue_updated ON public.daily_reheat_queue;
CREATE TRIGGER trg_daily_reheat_queue_updated
  BEFORE UPDATE ON public.daily_reheat_queue
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS trg_daily_reheat_settings_updated ON public.daily_reheat_settings;
CREATE TRIGGER trg_daily_reheat_settings_updated
  BEFORE UPDATE ON public.daily_reheat_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- ── 4. Toggle OFF na Central ───────────────────────────────────────────────
INSERT INTO public.automation_toggles (key, label, description, category, enabled) VALUES
  ('daily_reheat', 'Ciclo diário (Fila A/B)',
   'Motor do ciclo diário: lead novo (espera 5min → abre → fluxo) e frio (liga → áudio). Fase 0 = só dry-run. NÃO ligar junto com cadence_engine + reactivation_cron no mesmo lead.',
   'cadencia', false)
ON CONFLICT (key) DO NOTHING;

-- Prioridade no orquestrador (só vale se retention_orchestrator ON).
-- Append idempotente — não sobrescreve ordem customizada do admin.
UPDATE public.retention_settings
SET priority_order = priority_order || '["daily_reheat"]'::jsonb,
    updated_at = now()
WHERE id = 'global'
  AND NOT (priority_order @> '"daily_reheat"'::jsonb);

-- ── 5. Cron: a cada 15 min, SEMPRE dryRun=true ─────────────────────────────
-- Com toggle OFF a edge retorna skipped (sem envio). Preview manual: body preview=true.
DO $$ BEGIN PERFORM cron.unschedule('daily-reheat-tick'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'daily-reheat-tick',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/daily-reheat-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo',
      'x-internal-secret', COALESCE(
        (SELECT trim(both '"' from value::text) FROM public.settings WHERE key = 'embed_internal_token' LIMIT 1),
        ''
      )
    ),
    body := concat('{"dryRun": true, "time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);
