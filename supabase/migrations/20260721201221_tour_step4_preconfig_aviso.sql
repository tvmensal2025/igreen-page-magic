-- Passo 4 (Agendamentos): aviso educado de que já está pré-configurado.

UPDATE public.tour_steps SET
  title = 'Central de automações',
  body = 'Em Agendamentos ficam os envios automáticos, mensagens programadas e o acompanhamento.

Tudo já vem 100% pré-configurado para você. Por favor, não altere nada sem ter certeza do que está fazendo — uma mudança sem querer pode pausar ou mudar o ritmo dos contatos. Se tiver dúvida, peça ajuda antes de mexer.',
  updated_at = now()
WHERE order_index = 4 AND is_active = true;
