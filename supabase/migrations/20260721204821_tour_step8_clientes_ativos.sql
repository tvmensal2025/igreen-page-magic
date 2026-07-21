-- Passo 8: troca Motor de cadência (não mexer) por Clientes ativos.

UPDATE public.tour_steps SET
  route = '/admin?tab=crm-clientes',
  selector = '[data-tour="menu-crm-clientes"]',
  title = 'Clientes ativos',
  body = 'Depois que o cadastro avança no iGreen, o contato aparece aqui.

Acompanhe quem está em espera, aprovado ou reprovado, e a progressão ao longo dos dias. Use esta área para o pós-venda — sem misturar com os leads novos do CRM de interessados.',
  cta_label = 'Abrir clientes ativos',
  cta_href = '/admin?tab=crm-clientes',
  updated_at = now()
WHERE order_index = 8 AND is_active = true;
