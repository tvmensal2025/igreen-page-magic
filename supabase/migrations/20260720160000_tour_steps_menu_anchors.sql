-- Reescreve passos do tour: rotas com ?tab=, seletores menu-* reais e textos leigos.
-- Não apaga a migration original; apenas atualiza os steps ativos por order_index.

UPDATE public.tour_steps SET
  route = '/admin?tab=dashboard',
  selector = NULL,
  title = 'Bem-vindo à plataforma',
  body = 'Aqui você recebe contatos, conversa pelo WhatsApp, acompanha clientes e fecha vendas — tudo em um só lugar. Vamos passar pelas áreas principais, uma de cada vez.',
  cta_label = 'Abrir o Painel',
  cta_href = '/admin?tab=dashboard',
  updated_at = now()
WHERE order_index = 1 AND is_active = true;

UPDATE public.tour_steps SET
  route = '/admin?tab=dashboard',
  selector = '[data-tour="menu-lateral"]',
  title = 'Este é o seu menu',
  body = 'Todas as áreas ficam neste menu à esquerda. Em celular, abra pelo ícone de menu. Vamos destacar cada item importante.',
  cta_label = NULL,
  cta_href = NULL,
  updated_at = now()
WHERE order_index = 2 AND is_active = true;

UPDATE public.tour_steps SET
  route = '/admin?tab=whatsapp',
  selector = '[data-tour="menu-whatsapp"]',
  title = 'Conecte seu WhatsApp',
  body = 'Sem WhatsApp conectado, você não recebe nem responde contatos pela plataforma. Abra WhatsApp, entre em Configuração e leia o QR Code com o celular do número desejado.',
  cta_label = 'Abrir WhatsApp',
  cta_href = '/admin?tab=whatsapp',
  updated_at = now()
WHERE order_index = 3 AND is_active = true;

UPDATE public.tour_steps SET
  route = '/admin?tab=agendamentos',
  selector = '[data-tour="menu-agendamentos"]',
  title = 'Central de automações',
  body = 'Em Agendamentos você liga ou desliga envios automáticos, mensagens programadas e acompanhamento. Nada dispara sem o seu controle. Revise antes de ativar.',
  cta_label = 'Abrir Agendamentos',
  cta_href = '/admin?tab=agendamentos',
  updated_at = now()
WHERE order_index = 4 AND is_active = true;

UPDATE public.tour_steps SET
  route = '/admin?tab=crm',
  selector = '[data-tour="menu-crm"]',
  title = 'Clientes interessados',
  body = 'Aqui ficam os novos contatos em conversa. Abra um card para ver a conversa e os dados. Atualize a etapa conforme o atendimento avança.',
  cta_label = 'Abrir interessados',
  cta_href = '/admin?tab=crm',
  updated_at = now()
WHERE order_index = 5 AND is_active = true;

UPDATE public.tour_steps SET
  route = '/admin?tab=captacao',
  selector = '[data-tour="menu-captacao"]',
  title = 'Captação',
  body = 'Veja de onde vieram os contatos (anúncios, páginas e outros canais). Filtre por período ou origem e acompanhe quem acabou de chegar.',
  cta_label = 'Abrir Captação',
  cta_href = '/admin?tab=captacao',
  updated_at = now()
WHERE order_index = 6 AND is_active = true;

UPDATE public.tour_steps SET
  route = '/admin?tab=conversao',
  selector = '[data-tour="menu-conversao"]',
  title = 'Conversão',
  body = 'Lista contatos que pararam de responder. Use para retomar a conversa com a próxima ação sugerida, pelo WhatsApp.',
  cta_label = 'Abrir Conversão',
  cta_href = '/admin?tab=conversao',
  updated_at = now()
WHERE order_index = 7 AND is_active = true;

UPDATE public.tour_steps SET
  route = '/admin/motor',
  selector = NULL,
  title = 'Motor de cadência',
  body = 'Se o contato não responde, o motor tenta WhatsApp, ligação e SMS em sequência, nos horários que você definir. Revise as etapas antes de ampliar o uso.',
  cta_label = 'Abrir Motor',
  cta_href = '/admin/motor',
  updated_at = now()
WHERE order_index = 8 AND is_active = true;

UPDATE public.tour_steps SET
  route = '/admin?tab=central-anuncios',
  selector = '[data-tour="menu-central-anuncios"]',
  title = 'Central de anúncios',
  body = 'Acompanhe campanhas do Facebook e Instagram, custo e contatos. Para criar ou corrigir uma campanha, use também a área Meta Ads.',
  cta_label = 'Abrir anúncios',
  cta_href = '/admin?tab=central-anuncios',
  updated_at = now()
WHERE order_index = 9 AND is_active = true;

UPDATE public.tour_steps SET
  route = '/admin?tab=financeiro',
  selector = '[data-tour="menu-financeiro"]',
  title = 'Financeiro',
  body = 'Consulte carteira de anúncios, comissões e recebíveis. Sempre confira o período antes de comparar valores.',
  cta_label = 'Abrir Financeiro',
  cta_href = '/admin?tab=financeiro',
  updated_at = now()
WHERE order_index = 10 AND is_active = true;

UPDATE public.tour_steps SET
  route = '/admin?tab=academy',
  selector = '[data-tour="menu-academy"]',
  title = 'Academy',
  body = 'Aulas e avaliações para aprender o negócio e a plataforma. Assista, anote e acompanhe seu progresso.',
  cta_label = 'Abrir Academy',
  cta_href = '/admin?tab=academy',
  updated_at = now()
WHERE order_index = 11 AND is_active = true;

UPDATE public.tour_steps SET
  route = '/admin?tab=dashboard',
  selector = '[data-tour="help-fab"]',
  title = 'Precisa de ajuda?',
  body = 'Este botão verde fica sempre no canto da tela. Com ele você reinicia esta orientação, busca um passo a passo ou pergunta ao suporte com IA.',
  cta_label = 'Abrir Central de ajuda',
  cta_href = '/ajuda',
  updated_at = now()
WHERE order_index = 12 AND is_active = true;

-- Histórico persistente do suporte com IA (por consultor autenticado)
CREATE TABLE IF NOT EXISTS public.support_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_chat_messages_user_created_idx
  ON public.support_chat_messages (user_id, created_at DESC);

ALTER TABLE public.support_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "support_chat_messages select own" ON public.support_chat_messages;
CREATE POLICY "support_chat_messages select own"
  ON public.support_chat_messages FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "support_chat_messages insert own" ON public.support_chat_messages;
CREATE POLICY "support_chat_messages insert own"
  ON public.support_chat_messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "support_chat_messages delete own" ON public.support_chat_messages;
CREATE POLICY "support_chat_messages delete own"
  ON public.support_chat_messages FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT, INSERT, DELETE ON public.support_chat_messages TO authenticated;
GRANT ALL ON public.support_chat_messages TO service_role;
