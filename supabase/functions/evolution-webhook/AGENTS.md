# AGENTS — evolution-webhook (legado / paridade)

Whapi é o canal **primário**. Este webhook existe para consultores Evolution e **paridade** com `whapi-webhook`.

## Antes
1. `#wa-webhook` + `.kiro/steering/mapa-dominios.json` id `wa-webhook`
2. Qualquer mudança de comportamento: espelhar em `whapi-webhook` (checklist)

## NÃO FAÇA
- Tratar `needs_reconnect` como Zap offline do produto
- Quebrar paridade sem checklist
- Importar `_shared/vendedora/`

## Shared canônico
`_shared/bot/step-interaction.ts` · `holder-match.ts` · `confirmation-formatters.ts` · `channel-sender.ts`
