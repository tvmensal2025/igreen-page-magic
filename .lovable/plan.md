# Diagnóstico — conversa do 5511971254913 (BRUNO)

Olhando o histórico em `conversations` + `ai_decisions` do customer `df766412-…`:


| Hora     | Lead                | Bot                                     |
| -------- | ------------------- | --------------------------------------- |
| 15:02:14 | "Vai vir 2 boleto?" | **"Sim! Você continuará"** (cortado)    |
| 15:02:59 | "Continuará oque?"  | **"Olá! A *iGreen* conecta"** (cortado) |


Ambas as respostas vieram do `answer_faq_rag` (Gemini 3.1 Pro). O texto retornado pelo modelo está sendo **truncado no meio da primeira frase**, e nenhum botão do passo `d_duvidas` é reenviado, então o lead fica perdido.

## Causa raiz

Em `supabase/functions/_shared/ai-faq-answerer.ts:249` a chamada do Pro usa:

```ts
maxTokens: 500
```

Em `supabase/functions/_shared/ai-gateway.ts:31`, `isReasoningModel()` só reconhece `gpt-5*` / `o[134]*`. **Gemini 3 / 3.1 Pro também é modelo "thinking"**: consome boa parte do orçamento em tokens de raciocínio invisíveis. Resultado: sobra ~30-80 tokens para o JSON `{"text": "..."}` final, que sai cortado no primeiro split de frase.

Como o `formatReply` corta no último `.` antes do truncamento, o usuário vê só "Sim! Você continuará".

## Plano (escopo mínimo)

### 1. `supabase/functions/_shared/ai-gateway.ts`

- Estender `isReasoningModel()` para incluir famílias thinking do Google:
  ```ts
  return /^(openai\/)?(gpt-5|o[134])/i.test(model)
      || /^google\/gemini-3(\.\d+)?-pro/i.test(model);
  ```
  Isso já aplica o multiplicador `×8` e o piso de 2000 tokens que evita truncamento, mantendo o caminho normal para Flash e Gemini 2.5.

### 2. `supabase/functions/_shared/ai-faq-answerer.ts`

- Subir `maxTokens` da chamada do Pro de `500` → `1500` (com o multiplicador acima vira teto ~12k, mais que suficiente para uma resposta WhatsApp de 2-4 frases mesmo com thinking pesado).
- Sem mexer no rerank Flash (esse 120 está OK).

### 3. Voltar pro fluxo depois da FAQ

No `runOrchestrator` (`_shared/ai-orchestrator.ts`), quando `action === "answer_faq"` e o passo atual é um custom-step com botões (ex.: `d_duvidas`), além do `reply` retornar uma flag `reemitStep: true`. O `whapi-webhook` (handler conversational) hoje só envia `reply` quando a IA fala — adicionar um passo extra que, após enviar o texto da FAQ, reenfileira o `emitStep` do step atual (sem trocar o `conversation_step`). Assim o lead recebe a resposta da dúvida **e logo abaixo** os mesmos botões ("Quero economizar / Como funciona / Falar com humano") para continuar.

  Alternativa mais simples (recomendada): no `ai-faq-answerer`, anexar ao final do `text` um CTA curto reaproveitando o `currentStepLabel` ("Quer continuar de onde paramos? 👇") e disparar `reemitStep` direto do handler quando `tool_called === "answer_faq_rag"`. Confirma com você qual caminho prefere.

## Validação

1. Mandar de novo "Vai vir 2 boleto?" no número de teste → resposta deve vir completa (2-4 frases).
2. Conferir em `ai_decisions` que `ai_output` não é mais `""` (era sinal do JSON truncado).
3. Confirmar que após a resposta da FAQ o lead recebe os botões do `d_duvidas`  e de dcadsatrar novamente e clicar avança o fluxo normalmente.

## Fora do escopo

- Não mexer no orchestrator GPT-5.5 (já tem multiplicador ×8, 800 → 6400, está OK).
- Não mexer no rerank Flash.
- Não tocar em outras chamadas Gemini Pro (search/embeddings) — só FAQ.