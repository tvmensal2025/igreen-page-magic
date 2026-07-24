# AGENTS — UI WhatsApp (`src/components/whatsapp`)

## Domínios
| Pedido | Steering |
|---|---|
| Chat / webhook comportamento | `#wa-webhook` |
| Hub / próximos envios | `#agendamentos-hub` |
| Pós-venda kanban | `#pos-venda` |
| Cross-sell card | `#cross-sell` |

## Regras UI
- Whapi primário; não assustar com Evolution `needs_reconnect`
- Sem sigla DNC — “bloqueado / nunca mais contatar / Não Perturbe”
- Pós-venda stages até **d210** + retentativa (não truncar em d120)

## Arquivos grandes
`AgendamentosHub.tsx` (~1.9k) · `ChatView.tsx` — mudar com cuidado; leia o steering do domínio primeiro.
