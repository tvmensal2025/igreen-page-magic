-- Conversão Sprint 1: catálogo de frases, classification_source, triggers, settings, schema fixes

-- ─── 1) lead_insights: origem da classificação ───────────────────────────────
ALTER TABLE public.lead_insights
  ADD COLUMN IF NOT EXISTS classification_source TEXT;

ALTER TABLE public.lead_insights
  DROP CONSTRAINT IF EXISTS lead_insights_classification_source_chk;
ALTER TABLE public.lead_insights
  ADD CONSTRAINT lead_insights_classification_source_chk
  CHECK (classification_source IS NULL OR classification_source IN ('rules', 'ai_lite', 'ai_full', 'cache'));

COMMENT ON COLUMN public.lead_insights.classification_source IS
  'Como o insight foi gerado: rules (0 tokens), ai_lite, ai_full, cache (sem reprocessar).';

-- ─── 2) conversion_phrase_catalog ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversion_phrase_catalog (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shortcut            TEXT NOT NULL,
  category            TEXT NOT NULL CHECK (category IN ('followup', 'objection', 'step', 'rescue', 'hot', 'welcome')),
  conversation_step   TEXT,
  temperature         public.lead_temperature,
  trigger_keywords    TEXT[] NOT NULL DEFAULT '{}',
  message_text        TEXT NOT NULL CHECK (char_length(message_text) BETWEEN 1 AND 4096),
  next_action         TEXT NOT NULL,
  conversion_chance   SMALLINT NOT NULL DEFAULT 30 CHECK (conversion_chance BETWEEN 0 AND 100),
  priority            INT NOT NULL DEFAULT 100,
  is_system           BOOLEAN NOT NULL DEFAULT true,
  consultant_id       UUID REFERENCES public.consultants(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS conversion_phrase_catalog_system_shortcut
  ON public.conversion_phrase_catalog (shortcut)
  WHERE consultant_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS conversion_phrase_catalog_consultant_shortcut
  ON public.conversion_phrase_catalog (consultant_id, shortcut)
  WHERE consultant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversion_phrase_catalog_consultant
  ON public.conversion_phrase_catalog (consultant_id, category);

ALTER TABLE public.conversion_phrase_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone reads system phrases"
  ON public.conversion_phrase_catalog FOR SELECT TO authenticated
  USING (consultant_id IS NULL OR consultant_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Consultor manages own phrase overrides"
  ON public.conversion_phrase_catalog FOR ALL TO authenticated
  USING (consultant_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (consultant_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role manages conversion phrases"
  ON public.conversion_phrase_catalog FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT ON public.conversion_phrase_catalog TO authenticated;
GRANT ALL ON public.conversion_phrase_catalog TO service_role;

CREATE TRIGGER set_conversion_phrase_catalog_updated_at
  BEFORE UPDATE ON public.conversion_phrase_catalog
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed global (idempotente por shortcut)
INSERT INTO public.conversion_phrase_catalog
  (shortcut, category, conversation_step, temperature, trigger_keywords, message_text, next_action, conversion_chance, is_system)
SELECT * FROM (VALUES
  ('/fup1h', 'followup', NULL::text, 'warm'::public.lead_temperature, ARRAY[]::text[], '{{nome}}, ainda dá pra continuar de onde paramos? 🙂', 'Retomar conversa agora', 45),
  ('/fup24h', 'followup', NULL, 'warm', ARRAY[]::text[], '{{nome}}, ontem você perguntou sobre desconto na luz. Se quiser, te mando uma simulação rápida — só preciso do valor da conta 📊', 'Pedir valor da conta', 50),
  ('/fup72h', 'followup', NULL, 'cold', ARRAY[]::text[], '{{nome}}, vou separar 5 min hoje pra te montar a simulação. Manda só o valor da conta que eu cuido do resto 💚', 'Último empurrão suave', 35),
  ('/fup7d', 'followup', NULL, 'dead', ARRAY[]::text[], '{{nome}}, vou deixar essa porta aberta. Quando quiser, é só responder qualquer coisa que eu retomo.', 'Porta aberta', 15),
  ('/rescue_ghosted', 'rescue', NULL, 'rescue', ARRAY[]::text[], 'Oi {{nome}}! Vi sua mensagem e demorei pra responder — desculpa! Posso te ajudar agora?', 'Responder lead urgente', 75),
  ('/oi1', 'welcome', NULL, 'cold', ARRAY[]::text[], 'Oi {{nome}}! Vi que você se interessou pelo desconto na conta 💡 Quanto vem sua conta de luz hoje (média)?', 'Pedir valor da conta', 30),
  ('/oi2', 'welcome', NULL, 'cold', ARRAY[]::text[], 'Oi {{nome}}, na maioria dos casos reduzimos 15–20% na conta, sem obra e sem custo. Me manda o valor médio que eu vejo se rola 👇', 'Explicar benefício', 35),
  ('/oi3', 'welcome', NULL, 'cold', ARRAY[]::text[], 'Oi {{nome}} 👋 Já são +500 mil pessoas economizando com a iGreen. Me passa o valor médio da sua conta?', 'Prova social', 35),
  ('/golpe', 'objection', NULL, 'objection', ARRAY['golpe','fraude','furada'], 'Entendo sua preocupação, {{nome}}. A iGreen é regulamentada pela ANEEL (Lei 14.300), CNPJ ativo e +500 mil clientes. Você não paga nada extra — só sua conta, com desconto.', 'Responder objeção golpe', 45),
  ('/fidelidade', 'objection', NULL, 'objection', ARRAY['fidelidade','multa'], 'Sem fidelidade, {{nome}}. Cancela quando quiser, sem multa.', 'Responder objeção fidelidade', 50),
  ('/preco', 'objection', NULL, 'objection', ARRAY['caro','preço','preco'], 'Cadastro 100% gratuito, {{nome}}. Você continua pagando sua conta, mas com 15–20% de desconto.', 'Responder objeção preço', 50),
  ('/comofunciona', 'objection', NULL, 'objection', ARRAY['como funciona'], 'Simples: você continua com a mesma distribuidora, mas parte da energia vem limpa e mais barata. Sem obra, sem placa.', 'Explicar como funciona', 55),
  ('/problema', 'objection', NULL, 'objection', ARRAY['problema','errado'], 'Se algo der errado, {{nome}}, cancela sem multa. Sua conta com a distribuidora segue normal.', 'Acionar garantia/cancelamento', 40),
  ('/depois', 'objection', NULL, 'objection', ARRAY['depois','pensar'], 'Tranquilo, {{nome}}! Prefere que eu te chame amanhã ou semana que vem? Qual horário é melhor?', 'Agendar retorno', 40),
  ('/jadesconto', 'objection', NULL, 'objection', ARRAY['já tenho desconto'], 'Que ótimo! Posso simular se nossa proposta cobre o que você já tem? Sem compromisso — 2 minutos.', 'Comparar proposta', 45),
  ('/medo', 'objection', NULL, 'objection', ARRAY['medo','obra'], 'Você não mexe em nada da instalação, {{nome}}. Só muda quem fornece os créditos — tudo digital.', 'Responder medo de obra', 50),
  ('/quemsomos', 'objection', NULL, 'objection', ARRAY['quem são'], 'Somos parceiros oficiais iGreen Energy, {{nome}}. Te mando link com CNPJ e ANEEL se quiser confirmar.', 'Enviar prova social', 45),
  ('/dead_soft', 'objection', NULL, 'dead', ARRAY['não quero','para de'], 'Sem problemas, {{nome}}. Se mudar de ideia, estou por aqui 💚', 'Encerrar com porta aberta', 5),
  ('/step_aguardando_conta', 'step', 'aguardando_conta', 'warm', ARRAY[]::text[], '{{nome}}, falta só a foto da conta de luz pra eu te mostrar quanto dá pra economizar. Pode mandar aqui? 📸', 'Pedir foto da conta', 55),
  ('/step_aguardando_foto_conta', 'step', 'aguardando_foto_conta', 'warm', ARRAY[]::text[], '{{nome}}, sem a foto da conta não consigo simular seu desconto. Tira uma foto legível e manda aqui?', 'Reforçar foto da conta', 55),
  ('/step_confirmando_dados', 'step', 'confirmando_dados', 'warm', ARRAY[]::text[], '{{nome}}, confirma se os dados da conta estão certinhos? Se sim, responde "sim" que seguimos 👍', 'Confirmar dados OCR', 65),
  ('/step_aguardando_doc', 'step', 'aguardando_doc', 'warm', ARRAY[]::text[], '{{nome}}, estamos quase! Falta só foto do RG ou CNH (frente e verso). Pode mandar?', 'Pedir documento', 60),
  ('/step_aguardando_facial', 'step', 'aguardando_facial', 'hot', ARRAY[]::text[], '{{nome}}, último passo: selfie do rosto pra validação. Pode mandar agora?', 'Pedir selfie', 70),
  ('/step_portal', 'step', 'portal_submitting', 'hot', ARRAY[]::text[], '{{nome}}, seu cadastro está no portal iGreen. Precisa de ajuda em alguma tela?', 'Acompanhar portal', 90),
  ('/step_aguardando_humano', 'step', 'aguardando_humano', 'hot', ARRAY[]::text[], 'Oi {{nome}}! Sou {{representante}} e vou te acompanhar pessoalmente daqui. Como posso ajudar?', 'Assumir manualmente', 80),
  ('/hot_pedir_doc', 'hot', NULL, 'hot', ARRAY[]::text[], 'Perfeito, {{nome}}! Conta recebida ✅ Agora manda foto do RG/CNH que finalizamos rapidinho.', 'Pedir documento', 85),
  ('/warm_pedir_conta', 'hot', NULL, 'warm', ARRAY[]::text[], '{{nome}}, com o valor da conta (ou foto) eu te mostro a economia exata em 1 minuto. Manda aí?', 'Pedir valor/foto da conta', 60)
) AS v(shortcut, category, conversation_step, temperature, trigger_keywords, message_text, next_action, conversion_chance)
WHERE NOT EXISTS (
  SELECT 1 FROM public.conversion_phrase_catalog c
  WHERE c.shortcut = v.shortcut AND c.consultant_id IS NULL
);

-- ─── 3) Trigger: nova msg inbound → needs_reclassify ─────────────────────────
CREATE OR REPLACE FUNCTION public.mark_lead_needs_reclassify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.message_direction = 'inbound' THEN
    UPDATE public.lead_insights
       SET needs_reclassify = true,
           updated_at = now()
     WHERE customer_id = NEW.customer_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversations_mark_reclassify ON public.conversations;
CREATE TRIGGER conversations_mark_reclassify
  AFTER INSERT ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.mark_lead_needs_reclassify();

-- ─── 4) RPC: contagem inbound para score ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.count_inbound_messages(p_customer_ids uuid[])
RETURNS TABLE(customer_id uuid, cnt bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.customer_id, COUNT(*)::bigint
  FROM public.conversations c
  WHERE c.customer_id = ANY(p_customer_ids)
    AND c.message_direction = 'inbound'
    AND COALESCE(c.message_text, '') NOT LIKE '[__safety_ping__]%'
  GROUP BY c.customer_id;
$$;

GRANT EXECUTE ON FUNCTION public.count_inbound_messages(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_inbound_messages(uuid[]) TO service_role;

-- ─── 5) reactivation_settings (faltava no repo) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.reactivation_settings (
  consultant_id                 UUID PRIMARY KEY REFERENCES public.consultants(id) ON DELETE CASCADE,
  auto_enabled                  BOOLEAN NOT NULL DEFAULT false,
  horas_ate_primeiro_followup   INT NOT NULL DEFAULT 24 CHECK (horas_ate_primeiro_followup BETWEEN 1 AND 720),
  max_envios                    INT NOT NULL DEFAULT 3 CHECK (max_envios BETWEEN 1 AND 10),
  horas_entre_envios            INT NOT NULL DEFAULT 48 CHECK (horas_entre_envios BETWEEN 1 AND 336),
  janela_inicio                 INT NOT NULL DEFAULT 9 CHECK (janela_inicio BETWEEN 0 AND 23),
  janela_fim                    INT NOT NULL DEFAULT 20 CHECK (janela_fim BETWEEN 0 AND 23),
  enviar_fim_de_semana          BOOLEAN NOT NULL DEFAULT false,
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.reactivation_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Consultor manages own reactivation settings" ON public.reactivation_settings;
CREATE POLICY "Consultor manages own reactivation settings"
  ON public.reactivation_settings FOR ALL TO authenticated
  USING (consultant_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (consultant_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Service role manages reactivation settings" ON public.reactivation_settings;
CREATE POLICY "Service role manages reactivation settings"
  ON public.reactivation_settings FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reactivation_settings TO authenticated;
GRANT ALL ON public.reactivation_settings TO service_role;

-- ─── 6) reactivation_templates: multi-msg + mídia ────────────────────────────
DROP INDEX IF EXISTS public.reactivation_templates_active_unique;

ALTER TABLE public.reactivation_templates
  ADD COLUMN IF NOT EXISTS send_order INT NOT NULL DEFAULT 0;
ALTER TABLE public.reactivation_templates
  ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE public.reactivation_templates
  ADD COLUMN IF NOT EXISTS media_kind TEXT;

ALTER TABLE public.reactivation_templates
  DROP CONSTRAINT IF EXISTS reactivation_templates_media_kind_chk;
ALTER TABLE public.reactivation_templates
  ADD CONSTRAINT reactivation_templates_media_kind_chk
  CHECK (media_kind IS NULL OR media_kind IN ('image', 'video', 'document'));

-- Permite rascunho vazio no editor (FrasesPanel)
ALTER TABLE public.reactivation_templates
  DROP CONSTRAINT IF EXISTS reactivation_templates_message_text_check;
ALTER TABLE public.reactivation_templates
  ADD CONSTRAINT reactivation_templates_message_text_check
  CHECK (char_length(message_text) <= 4096);

CREATE INDEX IF NOT EXISTS idx_reactivation_templates_step_order
  ON public.reactivation_templates (consultant_id, conversation_step, send_order);
