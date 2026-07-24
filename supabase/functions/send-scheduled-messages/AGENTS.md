# AGENTS — send-scheduled-messages (agenda humana)

Domínio: `#agendamentos-hub`.

## Contrato
- Auth: `assertCronAuth`
- Claim: `claim_scheduled_messages` (SKIP LOCKED)
- Canal: `resolveConsultantOutboundChannel` (Whapi se Whapi)
- **NÃO** aplica quiet hours de bot (`:71–73`)

## NÃO FAÇA
- Copiar gates de `cadence-tick` / quiet-hours para cá
- Exigir Evolution no boot
