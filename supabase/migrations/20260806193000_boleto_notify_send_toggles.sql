-- Toggles do pacote: áudio e/ou texto; botão do arquivo opcional.
-- Convite Android/iOS do app Club é sempre enviado (código), não é coluna.
ALTER TABLE public.boleto_notify_config
  ADD COLUMN IF NOT EXISTS send_audio boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS send_text boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.boleto_notify_config.send_audio IS
  'Enviar áudio Sofia no aviso boleto chegou.';
COMMENT ON COLUMN public.boleto_notify_config.send_text IS
  'Enviar mensagem de texto do aviso (valor/vencimento/Club).';
COMMENT ON COLUMN public.boleto_notify_config.button_enabled IS
  'Opt-in: botão Receber boleto (arquivo no Zap). Default off — empresa já manda o boleto.';

UPDATE public.boleto_notify_config
SET
  send_audio = true,
  send_text = true,
  button_enabled = false,
  wa_text = E'{{saudacao}}seu boleto de *{{mes}}* já está disponível 💚\n\nValor: *R$ {{valor}}*\nVencimento: *{{vencimento}}*\n\nA iGreen cuida do envio oficial do boleto. Aqui o nosso recado é te lembrar e te levar ao lugar mais completo: o app *iGreen Club*.\n\nSeu acesso no Club:\n{{link_club}}\n\nQualquer dúvida, responde aqui 💚',
  updated_at = now()
WHERE id = 'global';
