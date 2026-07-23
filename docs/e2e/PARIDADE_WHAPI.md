# Paridade Whapi ↔ Evolution (rescue + reativação)

Data: 2026-07-22

## Problema
`bot-stuck-recovery` e `reactivation-cron` enviavam **só via Evolution**.
Consultor Whapi (ex.: Rafael) era tratado como offline por `whatsapp_instances.status=needs_reconnect` → rescue/reativação não rodavam de verdade.

## Correção
Ambos usam o mesmo resolvedor dos outros motores:
- `loadChannelEnv` (token Whapi em `settings` + Evolution em env)
- `resolveChannelForCustomerWithFailover` / `resolveConsultantOutboundChannel`
- envio via `channel.adapter.sendText`

## Deploy
- `bot-stuck-recovery` — deployado
- `reactivation-cron` — deployado

## O que NÃO mudou
- Toggles / kill switch / quiet hours / DNC
- Agenda (`send-scheduled-messages`) já era híbrida
- Sem `E2E_STRICT` (produção normal)
