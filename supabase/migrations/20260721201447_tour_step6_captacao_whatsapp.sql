-- Passo 6 (Captação): também é um resumo do WhatsApp; dá para conversar por aqui.

UPDATE public.tour_steps SET
  title = 'Captação',
  body = 'Veja de onde vieram os contatos (anúncios, páginas e outros canais). Filtre por período ou origem e acompanhe quem acabou de chegar.

Aqui também fica um resumo do WhatsApp: você pode abrir o contato e conversar por aqui, sem precisar sair desta área.',
  updated_at = now()
WHERE order_index = 6 AND is_active = true;
