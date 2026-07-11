
-- Fase 2 do Motor "Zero Lead Perdido"
-- Tabela de configuração de estágios (delay + mensagem WhatsApp) por consultor.
-- consultant_id NULL = padrão global.
CREATE TABLE public.cadence_stage_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id UUID REFERENCES public.consultants(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  delay_hours INTEGER NOT NULL DEFAULT 24,
  message_text TEXT,
  media_url TEXT,
  media_type TEXT DEFAULT 'text',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(consultant_id, stage)
);
CREATE UNIQUE INDEX cadence_stage_config_global_uidx ON public.cadence_stage_config(stage) WHERE consultant_id IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cadence_stage_config TO authenticated;
GRANT ALL ON public.cadence_stage_config TO service_role;

ALTER TABLE public.cadence_stage_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read cadence_stage_config"
  ON public.cadence_stage_config FOR SELECT TO authenticated USING (true);

CREATE POLICY "consultant manages own cadence_stage_config"
  ON public.cadence_stage_config FOR ALL TO authenticated
  USING (consultant_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (consultant_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_cadence_stage_config_updated_at
  BEFORE UPDATE ON public.cadence_stage_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seeds padrão globais (COLD_1..COLD_4) — texto simples que o admin pode editar.
INSERT INTO public.cadence_stage_config (consultant_id, stage, delay_hours, message_text, media_type) VALUES
(NULL, 'COLD_1', 24,  'Oi {{nome}}! Passando aqui pra saber se ainda tem interesse em reduzir sua conta de luz. Me conta o valor da última conta? 🙂', 'text'),
(NULL, 'COLD_2', 48,  'Oi {{nome}}, tudo bem? Ainda dá tempo de ativar seu desconto de energia. Posso te enviar os detalhes?', 'text'),
(NULL, 'COLD_3', 72,  'Oi {{nome}}! Última semana com essas condições especiais. Bora aproveitar? Só preciso de 2 minutos seus.', 'text'),
(NULL, 'COLD_4', 120, 'Oi {{nome}}, se preferir a gente pode retomar mais pra frente. Me avisa quando fizer sentido pra você. 🙌', 'text');

-- Trigger 1: novo customer → cria estado de cadência (idempotente).
CREATE OR REPLACE FUNCTION public.cadence_ensure_state_from_customer()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.lead_cadence_state (customer_id, consultant_id, stage, next_action_at)
  VALUES (NEW.id, NEW.consultant_id, 'GREETED', now() + interval '24 hours')
  ON CONFLICT (customer_id) DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_cadence_ensure_state ON public.customers;
CREATE TRIGGER trg_cadence_ensure_state
  AFTER INSERT ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.cadence_ensure_state_from_customer();

-- Trigger 2: inbound do lead → reseta stage p/ AI_QUALIFYING e pausa 24h.
CREATE OR REPLACE FUNCTION public.cadence_on_inbound_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.message_direction = 'inbound' AND NEW.customer_id IS NOT NULL THEN
    UPDATE public.lead_cadence_state
      SET stage = 'AI_QUALIFYING',
          last_response_at = now(),
          next_action_at = now() + interval '24 hours',
          paused_reason = NULL,
          paused_until = NULL
      WHERE customer_id = NEW.customer_id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_cadence_on_inbound ON public.conversations;
CREATE TRIGGER trg_cadence_on_inbound
  AFTER INSERT ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.cadence_on_inbound_message();

-- Extensão do app_settings para janela útil configurável.
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS cadence_window JSONB
  DEFAULT '{"weekday_start":8,"weekday_end":20,"saturday_start":8,"saturday_end":14,"sunday_enabled":false,"tz":"America/Sao_Paulo"}'::jsonb;

-- Backfill estado inicial para leads existentes ativos (últimos 30d, sem venda).
INSERT INTO public.lead_cadence_state (customer_id, consultant_id, stage, next_action_at)
SELECT c.id, c.consultant_id, 'COLD_1', now() + interval '24 hours'
  FROM public.customers c
  LEFT JOIN public.lead_cadence_state s ON s.customer_id = c.id
 WHERE s.id IS NULL
   AND c.created_at > now() - interval '30 days'
   AND COALESCE(c.igreen_code, '') = ''
   AND COALESCE(c.status,'') NOT IN ('completed','cancelled')
 ON CONFLICT (customer_id) DO NOTHING;
