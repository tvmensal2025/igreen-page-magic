
CREATE TABLE IF NOT EXISTS public.automation_toggles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'geral',
  enabled boolean NOT NULL DEFAULT false,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.automation_toggles TO authenticated;
GRANT ALL ON public.automation_toggles TO service_role;

ALTER TABLE public.automation_toggles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read automation_toggles"
  ON public.automation_toggles FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin manage automation_toggles"
  ON public.automation_toggles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.consultant_message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid,
  template_key text NOT NULL,
  label text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'geral',
  text_content text NOT NULL DEFAULT '',
  audio_url text,
  typing_delay_ms integer NOT NULL DEFAULT 1500,
  is_active boolean NOT NULL DEFAULT true,
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consultant_id, template_key)
);

CREATE INDEX IF NOT EXISTS consultant_message_templates_key_idx
  ON public.consultant_message_templates (template_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultant_message_templates TO authenticated;
GRANT ALL ON public.consultant_message_templates TO service_role;

ALTER TABLE public.consultant_message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read own or default templates"
  ON public.consultant_message_templates FOR SELECT TO authenticated
  USING (consultant_id IS NULL OR consultant_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "insert own templates"
  ON public.consultant_message_templates FOR INSERT TO authenticated
  WITH CHECK (consultant_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "update own templates"
  ON public.consultant_message_templates FOR UPDATE TO authenticated
  USING (consultant_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (consultant_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "delete own templates"
  ON public.consultant_message_templates FOR DELETE TO authenticated
  USING (consultant_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_automation_toggles_updated ON public.automation_toggles;
CREATE TRIGGER trg_automation_toggles_updated
  BEFORE UPDATE ON public.automation_toggles
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS trg_consultant_templates_updated ON public.consultant_message_templates;
CREATE TRIGGER trg_consultant_templates_updated
  BEFORE UPDATE ON public.consultant_message_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

INSERT INTO public.automation_toggles (key, label, description, category, enabled) VALUES
  ('cadence_engine', 'Motor de Cadência (global)', 'Liga/desliga o motor inteiro. Se desligado, nenhuma etapa dispara.', 'cadencia', false),
  ('cadence_cold_1', 'WhatsApp COLD_1', '1º re-engajamento WhatsApp.', 'cadencia', false),
  ('cadence_cold_2', 'WhatsApp COLD_2', '2º re-engajamento WhatsApp.', 'cadencia', false),
  ('cadence_cold_3', 'WhatsApp COLD_3', '3º re-engajamento WhatsApp.', 'cadencia', false),
  ('cadence_cold_4', 'WhatsApp COLD_4', '4º re-engajamento WhatsApp.', 'cadencia', false),
  ('cadence_call_1', 'Ligação Velip CALL_1', '1ª tentativa de ligação.', 'voz', false),
  ('cadence_call_2', 'Ligação Velip CALL_2', '2ª tentativa de ligação.', 'voz', false),
  ('cadence_call_3', 'Ligação Velip CALL_3', '3ª tentativa de ligação.', 'voz', false),
  ('cadence_sms_1', 'SMS Velip SMS_1', '1º SMS de fallback.', 'sms', false),
  ('cadence_sms_2', 'SMS Velip SMS_2', '2º SMS de fallback.', 'sms', false),
  ('facebook_retarget_sync', 'Retargeting Meta', 'Sincroniza leads frios para Custom Audience.', 'meta', false),
  ('send_scheduled_messages', 'Mensagens agendadas', 'Cron das mensagens agendadas manualmente.', 'manual', false),
  ('process_followups', 'Follow-ups IA', 'Cron de follow-ups gerados pela IA.', 'ia', false),
  ('reactivation_cron', 'Reaquecimento', 'Cron de reativação de leads antigos.', 'cadencia', false),
  ('bulk_campaigns_runner', 'Campanhas em massa', 'Executa campanhas em massa.', 'manual', false),
  ('pos_venda_auto_messages', 'Pós-venda automático', 'Mensagens D+0/D+30/D+60/D+90/D+120.', 'pos-venda', false),
  ('notify_partner_leads_batch', 'Notificação parceiros (lote)', 'Notificações de novos leads em lote.', 'parceiros', false),
  ('start_customer_attendance', 'Abrir chamado (Iniciar atendimento)', 'Mensagem quando consultor abre chamado.', 'manual', false)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.consultant_message_templates (consultant_id, template_key, label, description, category, text_content, variables) VALUES
  (NULL, 'start_attendance', 'Abrir chamado / Iniciar atendimento',
   'Mensagem enviada quando o consultor clica em "Iniciar atendimento" no chat.',
   'manual',
   E'{{saudacao}}! Aqui é {{consultor}} da iGreen 🌱\n\nSeu protocolo de atendimento é *{{protocolo}}*.\n\nMe conta como posso te ajudar?',
   '["saudacao","consultor","protocolo","nome"]'::jsonb),
  (NULL, 'greeting_morning', 'Saudação — Bom dia', 'Saudação matinal.', 'saudacao', 'Bom dia', '[]'::jsonb),
  (NULL, 'greeting_afternoon', 'Saudação — Boa tarde', 'Saudação vespertina.', 'saudacao', 'Boa tarde', '[]'::jsonb),
  (NULL, 'greeting_evening', 'Saudação — Boa noite', 'Saudação noturna.', 'saudacao', 'Boa noite', '[]'::jsonb),
  (NULL, 'partner_new_lead_notification', 'Notificação de novo lead ao parceiro',
   'Enviada ao parceiro quando um novo lead é atribuído.',
   'parceiros',
   E'🎯 *Novo lead recebido!*\n\n👤 {{nome}}\n📱 {{telefone}}\n📢 Campanha: {{campanha}}\n🔢 Posição no rodízio: {{posicao}}\n\nAcesse a plataforma para atender.',
   '["nome","telefone","campanha","posicao"]'::jsonb)
ON CONFLICT (consultant_id, template_key) DO NOTHING;
