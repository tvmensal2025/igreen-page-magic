-- Passo 5 (Clientes interessados): deixa claro que todo lead novo entra no CRM automaticamente.

UPDATE public.tour_steps SET
  title = 'Clientes interessados',
  body = 'Todo lead que entra na plataforma passa automaticamente por este CRM.

Abra aqui para acompanhar cada contato: veja a conversa, os dados e em que etapa está o atendimento. Conforme a conversa avança, atualize o card para não perder ninguém de vista.',
  updated_at = now()
WHERE order_index = 5 AND is_active = true;
