-- ═══════════════════════════════════════════════════════════════════════════
-- Fundação: orquestrador de retenção + SLA + gates novos
-- 100% ADITIVA. Todos os toggles nascem OFF.
-- Nada envia até o admin configurar templates e ligar na Central.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Settings editáveis (SLA, cooldown, prioridades) ─────────────────────
CREATE TABLE IF NOT EXISTS public.retention_settings (
  id text PRIMARY KEY DEFAULT 'global',
  speed_to_lead_minutes int NOT NULL DEFAULT 5
    CHECK (speed_to_lead_minutes BETWEEN 1 AND 120),
  orchestrator_cooldown_hours numeric NOT NULL DEFAULT 6
    CHECK (orchestrator_cooldown_hours BETWEEN 0.5 AND 168),
  -- Ordem: menor índice = maior prioridade. Só vale com retention_orchestrator ON.
  priority_order jsonb NOT NULL DEFAULT '[
    "process_followups",
    "bot_stuck_recovery",
    "faq_reengagement_nudge",
    "bot_followup_checker",
    "cadence_engine",
    "reactivation_cron",
    "portal_abandon_sequence"
  ]'::jsonb,
  portal_abandon_hours numeric NOT NULL DEFAULT 2
    CHECK (portal_abandon_hours BETWEEN 0.5 AND 72),
  call_answered_pause_hours numeric NOT NULL DEFAULT 24
    CHECK (call_answered_pause_hours BETWEEN 1 AND 168),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.retention_settings (id) VALUES ('global')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.retention_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read retention_settings" ON public.retention_settings;
CREATE POLICY "auth read retention_settings"
  ON public.retention_settings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admin manage retention_settings" ON public.retention_settings;
CREATE POLICY "admin manage retention_settings"
  ON public.retention_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.retention_settings TO authenticated;
GRANT ALL ON public.retention_settings TO service_role;

-- ── 2. Log de toques proativos (orquestrador) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.proactive_touch_log (
  id bigserial PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_proactive_touch_customer_created
  ON public.proactive_touch_log (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_proactive_touch_created
  ON public.proactive_touch_log (created_at DESC);

ALTER TABLE public.proactive_touch_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read proactive_touch_log" ON public.proactive_touch_log;
CREATE POLICY "auth read proactive_touch_log"
  ON public.proactive_touch_log FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.proactive_touch_log TO authenticated;
GRANT ALL ON public.proactive_touch_log TO service_role;

-- ── 3. Toggles novos (todos OFF) ───────────────────────────────────────────
INSERT INTO public.automation_toggles (key, label, description, category, enabled) VALUES
  ('retention_orchestrator', 'Orquestrador de retenção',
   'Quando ligado: impede vários crons de cutucar o mesmo lead no cooldown. Configure prioridade em retention_settings antes de ligar.',
   'ia', false),
  ('bot_stuck_recovery', 'Resgate de lead travado (IA)',
   'Cron que manda mensagem personalizada se o lead parar no meio do fluxo. Antes só respeitava kill switch global.',
   'ia', false),
  ('bot_loop_watchdog', 'Watchdog de loop / step órfão',
   'Detecta loop, pausa bot e avisa consultor (pode enviar msg). Ligue só após revisar.',
   'ia', false),
  ('speed_to_lead_sla', 'Alerta SLA speed-to-lead',
   'Cria alerta no painel se lead novo ficar sem 1ª resposta além do limite (minutos em retention_settings). NÃO envia WhatsApp sozinho.',
   'ia', false),
  ('call_outcome_sms_branch', 'SMS automático após NA na ligação',
   'Se a ligação não for atendida e a campanha tiver texto SMS, envia fallback. Desligado = nunca manda SMS pós-NA.',
   'sms', false),
  ('call_answered_pause_cadence', 'Pausar cadência se ligação atendida',
   'Quando o lead atende a ligação, pausa a cadência multi-canal pelo tempo configurado.',
   'voz', false),
  ('portal_abandon_sequence', 'Sequência abandono de portal',
   'Reservado: sequência dedicada a quem parou no portal/fatura. Ainda exige config de templates antes de ligar.',
   'ia', false),
  ('wa_window_priority', 'Priorizar janela aberta WhatsApp',
   'Reservado: preferir free-form enquanto a janela 24h/72h estiver aberta. Ligar só após config.',
   'ia', false)
ON CONFLICT (key) DO NOTHING;

-- ── 4. Templates editáveis (substituem textos hardcoded) ───────────────────
INSERT INTO public.consultant_message_templates
  (consultant_id, template_key, label, description, category, text_content, variables)
VALUES
  (NULL, 'bot_followup_sumiu', 'Follow-up quem sumiu (6–48h)',
   'Usado pelo cron bot-followup-checker. Edite antes de ligar o toggle.',
   'ia',
   E'Oi {{nome}}, aqui é da *iGreen*.\n\nVi que sua simulação da conta de luz ficou pendente. Posso retomar de onde paramos — é só responder por aqui.',
   '["nome"]'::jsonb),
  (NULL, 'faq_reengagement_nudge', 'Nudge pós-FAQ (±20 min)',
   'Usado pelo cron faq-reengagement-nudge. Edite antes de ligar o toggle.',
   'ia',
   E'{{nome}}, qualquer outra dúvida, é só perguntar. Estou por aqui.',
   '["nome"]'::jsonb),
  (NULL, 'speed_to_lead_alert', 'Texto interno alerta SLA',
   'Só aparece no alerta do painel (não vai ao cliente).',
   'ia',
   E'Lead {{nome}} ({{telefone}}) sem 1ª resposta há mais de {{minutos}} min. Priorize o atendimento.',
   '["nome","telefone","minutos"]'::jsonb)
ON CONFLICT (consultant_id, template_key) DO NOTHING;

-- ── 5. Cron SLA (só cria alerta se toggle ON) ──────────────────────────────
DO $$ BEGIN PERFORM cron.unschedule('speed-to-lead-check-5min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'speed-to-lead-check-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/speed-to-lead-check',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body := concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);
