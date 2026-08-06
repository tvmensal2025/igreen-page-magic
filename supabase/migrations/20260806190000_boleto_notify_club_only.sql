-- Aviso boleto: só lembrar + iGreen Club. Empresa já manda o arquivo no Zap.
-- Sem botão / sem entrega de documento por este canal.
UPDATE public.boleto_notify_config
SET
  button_enabled = false,
  audio_script = 'seu boleto de energia do mês já está disponível. A iGreen cuida do envio oficial do boleto — e o lugar mais seguro e completo para você acompanhar tudo é o aplicativo iGreen Club. Lá você confere a fatura, o vencimento e ainda aproveita descontos em farmácias, restaurantes, cinemas e milhares de parceiros. Baixa o app, entra com o seu acesso e fica tranquilo. Qualquer dúvida, é só responder aqui.',
  wa_text = E'{{saudacao}}seu boleto de *{{mes}}* já está disponível 💚\n\nValor: *R$ {{valor}}*\nVencimento: *{{vencimento}}*\n\nA iGreen cuida do envio oficial do boleto. Aqui o nosso recado é te lembrar e te levar ao lugar mais completo: o app *iGreen Club* — fatura, vencimento e descontos em farmácia, restaurantes e milhares de parceiros.\n\n📱 *Baixe o app:*\n\n🤖 *Android — Play Store:*\n{{link_play}}\n\n🍎 *iPhone — App Store:*\n{{link_appstore}}\n\nSeu acesso no Club:\n{{link_club}}\n\nQualquer dúvida, responde aqui 💚',
  updated_at = now()
WHERE id = 'global';
