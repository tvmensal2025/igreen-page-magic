# AGENTS — igreen-boleto-notify

Domínio: `#igreen-sync-oficial` (aviso carteira).

## Papel
- Tick horário: se `boleto_notify_config.cron_hour_brt` bater → `sync_boletos`
- Processa fila `customer_auto_message_log` (`boleto_chegou:*`, status `claimed`)
- Pacote por toggle: áudio (IA do consultor) + texto + imagem + apps Android/iOS;
  botão “Receber boleto” só com `button_enabled` (sem palavra PDF ao cliente)

## Imagem (opt-in, tudo pela UI)
- `send_image` (default off) + `image_url` (https) + `image_caption` + `image_position`
- Posições: `first` (default) · `after_audio` · `after_text` · `last`
- Mensagem própria; legenda aceita as variáveis do texto
- Toggle ligado sem imagem válida = aviso sai sem ela (`shouldSendBoletoImage`)
- Upload pela UI (`uploadMedia`, kind=image) ou URL colada — nunca hardcode

## Acesso ao Club = e-mail, nunca link
- `buildClubAccessLine(email)` — e-mail do cadastro (`customers.email`)
- Sem e-mail: só orienta “use o e-mail do seu cadastro”; nunca cai no link
- `{{email_acesso}}` no texto; `{{link_club}}` é legado e também rende e-mail
- `buildClubLink` está `@deprecated` para mensagem ao cliente

## Boleto pago não vira aviso
- `isBoletoStatusPago` (pago/baixado/liquidado/quitado)
- Sync não enfileira (`skipped_pago` no retorno de `enqueueBoletoChegouCandidates`)
- Dispatcher confere de novo antes de enviar → marca `skipped_pago`

## Cadeados
- Toggle `auto_wa_boleto_chegou` (default OFF)
- `bot_global_enabled`, DNC, quiet hours 08–20 BRT
- Sync full continua bloqueado por Evomi; só `sync_boletos` no cron

## NÃO
- Anexar documento na 1ª mensagem
- Usar “PDF” em copy ao cliente
- Mandar `club.igreenenergy.com.br/?id=…` ao cliente
- Avisar boleto já quitado
- Ligar toggle em massa sem pedido
