# AGENTS — bulk-scheduler

Disparo PRO por cron. Não é cadência A/B/C, agenda manual nem pós-venda.

## Antes de editar

1. Leia `#helpers-canonicos`, `#wa-webhook` e as regras de envio automático.
2. Preserve `assertCronAuth`, `bulk_campaigns_runner` e os limites por tick.
3. Canal é resolvido por `resolveConsultantOutboundChannel`: Whapi é preferencial; Evolution é legado.

## Fluxo

- Promove campanhas vencidas de `scheduled` para `running`.
- Retoma somente targets `queued` e reconcilia `sending` preso.
- Limites atuais: até 5 campanhas e 25 mensagens por campanha por execução.
- Respeita janela BRT da campanha, anti-ban, DNC, guard proativo e quota.
- Sem canal, alvo válido ou janela: registra/pausa conforme o caso; não força envio.

## Guardas

- `assertCronAuth` antes de qualquer trabalho.
- `isAutomationEnabled(..., "bulk_campaigns_runner")` + `logSkipped`.
- `assertBotOutboundAllowed` antes do outbound.
- Guard de telefone só para Evolution; Whapi não depende de `whatsapp_instances`.

## NÃO FAÇA

- Aumentar volume, ligar campanha ou criar massa sem pedido explícito.
- Tratar `needs_reconnect` da Evolution como WhatsApp Whapi offline.
- Bypassar DNC, janela, quota, anti-ban ou status dos targets.
- Usar nome não seguro ao renderizar template.
