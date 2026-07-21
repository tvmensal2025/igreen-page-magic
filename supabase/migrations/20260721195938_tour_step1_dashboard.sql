-- Passo 1 do tour: destaca o Dashboard (Painel) com explicação, em vez de overlay genérico.

UPDATE public.tour_steps SET
  route = '/admin?tab=dashboard',
  selector = '[data-tour="dashboard"]',
  title = 'Bem-vindo — este é o Painel',
  body = 'Você começa pelo Dashboard. Aqui fica o resumo da operação: cadastros, desempenho e o que precisa de atenção no dia. Sempre que abrir a plataforma, use este Painel como ponto de partida — depois siga para WhatsApp, clientes e as outras áreas pelo menu.',
  cta_label = NULL,
  cta_href = NULL,
  updated_at = now()
WHERE order_index = 1 AND is_active = true;
