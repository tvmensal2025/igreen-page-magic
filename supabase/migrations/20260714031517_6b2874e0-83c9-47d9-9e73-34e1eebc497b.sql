
CREATE TABLE public.tour_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_index integer NOT NULL UNIQUE,
  route text NOT NULL,
  selector text,
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  cta_label text,
  cta_href text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tour_steps TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.tour_steps TO authenticated;
GRANT ALL ON public.tour_steps TO service_role;
ALTER TABLE public.tour_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tour_steps read all" ON public.tour_steps FOR SELECT USING (true);
CREATE POLICY "tour_steps admin write" ON public.tour_steps FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.tour_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  video_url text,
  related_tour_step_id uuid REFERENCES public.tour_steps(id) ON DELETE SET NULL,
  order_index integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tour_articles TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.tour_articles TO authenticated;
GRANT ALL ON public.tour_articles TO service_role;
ALTER TABLE public.tour_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tour_articles read all" ON public.tour_articles FOR SELECT USING (true);
CREATE POLICY "tour_articles admin write" ON public.tour_articles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.user_tour_progress (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  current_step integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  dismissed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_tour_progress TO authenticated;
GRANT ALL ON public.user_tour_progress TO service_role;
ALTER TABLE public.user_tour_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tour_progress own" ON public.user_tour_progress FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.tour_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER tour_steps_updated_at BEFORE UPDATE ON public.tour_steps
  FOR EACH ROW EXECUTE FUNCTION public.tour_touch_updated_at();
CREATE TRIGGER tour_articles_updated_at BEFORE UPDATE ON public.tour_articles
  FOR EACH ROW EXECUTE FUNCTION public.tour_touch_updated_at();
CREATE TRIGGER user_tour_progress_updated_at BEFORE UPDATE ON public.user_tour_progress
  FOR EACH ROW EXECUTE FUNCTION public.tour_touch_updated_at();

INSERT INTO public.tour_steps (order_index, route, selector, title, body, cta_label, cta_href) VALUES
  (1,  '/admin', NULL, 'Bem-vindo à plataforma', 'Aqui você capta leads, conversa via WhatsApp com IA, fecha vendas no CRM e acompanha o pós-venda — tudo em um lugar.', NULL, NULL),
  (2,  '/admin', '[data-tour="menu-lateral"]', 'Este é o seu menu', 'Todas as áreas da plataforma ficam aqui. Vamos passar pelas mais importantes.', NULL, NULL),
  (3,  '/admin', '[data-tour="wa-connect"]', 'Conecte seu WhatsApp', 'Sem WhatsApp conectado nada roda. Escaneie o QR code para vincular seu número.', 'Abrir WhatsApp', '/admin?tab=whatsapp'),
  (4,  '/admin', '[data-tour="bot-toggle"]', 'Ligue o robô', 'O robô responde 24/7. Você pode desligar a qualquer momento sem perder mensagens.', NULL, NULL),
  (5,  '/admin', '[data-tour="kanban"]', 'CRM Kanban', 'Arraste os cards entre colunas para acompanhar cada lead. O robô já faz isso sozinho quando o cliente avança no fluxo.', NULL, NULL),
  (6,  '/admin', '[data-tour="captacao"]', 'Captação de leads', 'Aqui ficam os leads que chegaram dos anúncios. Selecione vários e envie mensagem em lote.', NULL, NULL),
  (7,  '/admin', '[data-tour="conversao"]', 'Conversão (leads parados)', 'Leads dos últimos 120 dias que esfriaram. Reative com um clique.', NULL, NULL),
  (8,  '/admin/motor-cadencia', NULL, 'Motor de Cadência', 'Se o lead não responde, o motor tenta WhatsApp, ligação e SMS em sequência. Nunca deixa esfriar.', 'Abrir Motor', '/admin/motor-cadencia'),
  (9,  '/admin', '[data-tour="meta-ads"]', 'Meta Ads + Carteira', 'Crie campanhas do Facebook direto daqui. Precisa de saldo mínimo de 7 dias na carteira.', 'Abrir Meta Ads', '/admin/meta-ads'),
  (10, '/admin/agendamentos-central', NULL, 'Hub de textos (100% editável)', 'Cada frase que o robô fala está nesta tela, organizada em 15 abas. Edite e salva na hora.', 'Abrir Hub', '/admin/agendamentos-central'),
  (11, '/admin/agendamentos-central', '[data-tour="central-automacoes"]', 'Central de Automações', 'Interruptores grandes para ligar/desligar cada automação. Nada dispara sem seu OK.', NULL, NULL),
  (12, '/admin', '[data-tour="help-fab"]', 'Precisa de ajuda?', 'Este botão fica sempre visível. Reabre este tour, abre a Central de Ajuda ou chama o suporte.', 'Ver Ajuda', '/ajuda');
