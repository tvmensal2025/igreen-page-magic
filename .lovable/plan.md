# Plano de correção

## Objetivo

Deixar o Fluxo D novamente com todos os botões combinados e corrigir o erro de IA que gerou respostas truncadas como `Max 280 characters.`.

## 1. Restaurar botões do passo #3: Como funciona

Hoje o passo `d_como_funciona` ficou sem `captures._buttons`, então o WhatsApp envia só texto/mídia, sem os botões.

Vou atualizar o passo #3 para ter exatamente estes botões:


| Botão              | Destino                |
| ------------------ | ---------------------- |
| Quero simular      | #2 Enviar conta de luz |
| Ainda tenho dúvida | #8 Esclarecer dúvidas  |
| Falar com Rafael   | Humano                 |


As rotas/transições continuam únicas, sem duplicar e sem loop.

## 2. Confirmar botões do passo #8: Esclarecer dúvidas

Manter o passo #8 com os botões já combinados:


| Botão            | Destino                |
| ---------------- | ---------------------- |
| Quero simular    | #2 Enviar conta de luz |
| Quero cadastrar  | #5 Pedir documento     |
| Falar com Rafael | Humano                 |


## 3. Garantir compatibilidade Whapi + Evolution

A correção será feita na definição do fluxo, usando o padrão `_buttons` que os adapters já leem.

Isso deve funcionar tanto para:

- Whapi, quando `supports_buttons=true` e limite máximo de 3 botões.
- Evolution, usando o mesmo payload lógico de botões do fluxo.

Não vou criar 4+ botões em um passo, porque o Whapi suporta no máximo 3 botões rápidos. Para ter mais opções, teria que virar lista, mas você pediu para voltar igual antes.

## 4. Corrigir tokens da IA

O erro real nos logs é o uso de `max_tokens` com modelos de IA que exigem `max_completion_tokens`.

Vou corrigir os helpers de IA para:

- usar `max_completion_tokens` nos modelos reasoning;
- remover `temperature` nesses modelos quando necessário;
- aumentar bastante o teto de resposta para evitar corte no meio;
- preservar resposta final curta para WhatsApp, mas sem truncar errado.

Arquivos previstos:

- `supabase/functions/_shared/ai-gateway.ts`
- `supabase/functions/_shared/ai-answer.ts`
- `supabase/functions/_shared/ai-button-intent.ts`

## 5. Validação

Depois da correção:

1. Resetar lead `11971254913`.
2. Enviar `Oi`.
3. Clicar `Como funciona`.
4. Confirmar que aparecem os 3 botões do passo #3.
5. Enviar pergunta livre e confirmar que não sai mais `Max 280 characters.` nem resposta cortada.
6. Conferir logs do webhook sem erro de tokens.

## Resultado esperado

O fluxo volta a iniciar corretamente, os botões aparecem como combinado, e a IA para de responder mensagens truncadas.