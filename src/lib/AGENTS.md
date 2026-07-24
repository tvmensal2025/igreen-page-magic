# AGENTS — bibliotecas do front

Utilitários compartilhados da UI. Antes de copiar regra de domínio, verifique `#helpers-canonicos` e o espelho edge correspondente.

## multichannelCadenceTexts.ts

Fonte de textos, botões e segmentos de áudio da conversão multicanal A/B/C.

### Regras

- Whapi aceita no máximo 3 botões e título de até 25 caracteres.
- Fluxo A começa coletando nome livre; não antecipe botão/faixa de conta.
- Áudios são TTS Sofia; ligação gravada só direciona ao WhatsApp, sem conversa simulada.
- Use segmentos reutilizáveis para preservar o cache de TTS.
- `{{nome}}` só é renderizado quando a fonte é segura; sem isso, remova a saudação.
- Grupo A é inbound e não conta no cap global; B/C são outreach com caps próprios.

### Alteração de textos

1. Atualize template, prévia e testes afetados juntos.
2. Preserve IDs de botão e `goto_step_key`: eles são contrato com o fluxo.
3. Mantenha compatibilidade de placeholders usados por `syncCadenceToBotFlow`.

## NÃO FAÇA

- Duplicar regra já existente em `_shared` sem espelho canônico.
- Criar botão além do limite Whapi ou texto que revele protocolo interno.
- Ligar envio, mudar caps ou alterar rota de motor por uma mudança de copy.
