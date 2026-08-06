# AGENTS — igreen-boleto-notify

Domínio: `#igreen-sync-oficial` (aviso carteira).

## Papel
- Tick horário: se `boleto_notify_config.cron_hour_brt` bater → `sync_boletos`
- Processa fila `customer_auto_message_log` (`boleto_chegou:*`, status `claimed`)
- Envia áudio Sofia + texto Club + botão “Receber boleto” (sem palavra PDF ao cliente)

## Cadeados
- Toggle `auto_wa_boleto_chegou` (default OFF)
- `bot_global_enabled`, DNC, quiet hours 08–20 BRT
- Sync full continua bloqueado por Evomi; só `sync_boletos` no cron

## NÃO
- Anexar documento na 1ª mensagem
- Usar “PDF” em copy ao cliente
- Ligar toggle em massa sem pedido
