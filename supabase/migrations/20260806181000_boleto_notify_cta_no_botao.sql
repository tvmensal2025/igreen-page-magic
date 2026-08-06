-- O convite do botão agora vai em mensagem própria (buildBoletoButtonPrompt).
-- Mantê-lo no corpo duplicava o "toque em Receber boleto" na conversa.
UPDATE public.boleto_notify_config
SET
  wa_text = E'{{saudacao}}seu boleto de *{{mes}}* já está disponível 💚\n\nValor: *R$ {{valor}}*\nVencimento: *{{vencimento}}*\n\nO lugar oficial é o app *iGreen Club* — lá você vê a fatura e os descontos (farmácia e parceiros).\n\n📱 *Baixe o app no seu celular:*\n\n🤖 *Android — Play Store:*\n{{link_play}}\n\n🍎 *iPhone — App Store:*\n{{link_appstore}}\n\nSeu acesso no Club:\n{{link_club}}',
  updated_at = now()
WHERE id = 'global';
