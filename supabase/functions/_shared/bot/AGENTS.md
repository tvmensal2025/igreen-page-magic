# AGENTS — helpers compartilhados do bot

Núcleo reutilizado por webhooks e automações. Leia `#helpers-canonicos` e `#fluxos` antes de alterar comportamento.

## Regra principal

Estenda o helper canônico e seus testes; não copie a lógica para handlers nem crie um segundo helper concorrente.

## Helpers obrigatórios

| Arquivo | Uso |
|---|---|
| `global-flag.ts` | `isBotGloballyEnabled`: kill switch de outbound automático |
| `dedupe.ts` | reserva atômica em `webhook_message_dedup` por mensagem + instância |
| `../customer-display-name.ts` | nome seguro via `safeFirstNameForAddress` |
| `step-interaction.ts` | interpretação canônica de interação por etapa |
| `holder-match.ts` | comparação de titular sem heurística paralela |
| `confirmation-formatters.ts` | texto de confirmação consistente |
| `flow-predicates.ts` | predicados puros Whapi↔Evolution (check-in/club/doc) |

## Contratos críticos

- Dedupe é **fail-open** em falha de banco/rede; não silencie inbound por erro transitório.
- A chave de dedupe é `(message_id, instance_name)`; não volte ao espelho `webhook_message_dedupe`.
- Kill switch impede fala automática, não impede persistir inbound ou avisar consultor.
- Nome sem fonte confiável: apenas corpo da mensagem, sem saudação personalizada.
- Mudança de parser, titular ou confirmação exige teste `*_test.ts` correspondente.

## NÃO FAÇA

- Ligar motores, bypassar DNC/toggles ou remover guards.
- Usar nome do perfil WhatsApp como nome confirmado.
- Duplicar o fluxo de etapa em `bot-flow.ts` ou em um webhook.
- Mudar fail-open/fail-closed sem decisão explícita de produto.
