# Bot WhatsApp respondendo "Boa pergunta, já explico melhor" em vez de responder

## Diagnóstico

No log do `whapi-webhook` ficou claro o que acontece (lead 5511971254913, passo `ask_email`):

```
[midflow-qa] hit=false step="ask_email" → respondAndReentry (IA + reentry)
[respondAndReentry] reason=midflow_qa_miss source=fallback detour=1 step=ask_email
✅ [whapi:sendText] → "Boa pergunta! Já explico melhor 💬\n\n📋 Voltando: ASSOCIACAO, me passa seu *e-mail*..."
```

`source=fallback` significa que tanto o **FAQ** quanto o **IA** falharam — então o bot caiu no texto fixo "Boa pergunta! Já explico melhor 💬". Investigando:

1. **`respondAndReentry`** (em `supabase/functions/whapi-webhook/handlers/bot-flow.ts:665` e o gêmeo em `evolution-webhook/handlers/bot-flow.ts:662`) tenta nesta ordem:
   - `matchQA` (FAQ do fluxo) → sem hit.
   - `ai-sales-agent` com `mode: "answer_only"` e timeout de **8 s**.
   - Texto fixo "Boa pergunta! Já explico melhor 💬".

2. **`ai-sales-agent` não tem nenhum branch para `mode === "answer_only"`.** O código só conhece `reply`, `closer`, `rescue` (linha 499). Quando recebe `answer_only`, segue o pipeline completo de orquestração de vendas com tool calling. O modelo acaba escolhendo uma tool que **não** preenche `decision.args.message`, então `respondAndReentry` lê string vazia em `body?.decision?.args?.message || body?.reply || body?.message` e cai no fallback.

3. Reforçando o problema: o log mostra que a função `ai-sales-agent` **boot** começou em `19:12:26` (cold start de ~3 s) e a chamada do `respondAndReentry` saiu logo antes — com timeout de 8 s não sobra margem para cold start + 1 round-trip ao Gemini, então em muitos casos nem chega a responder.

Resultado: o bot soa evasivo ("Boa pergunta, já explico melhor") sem nunca explicar, e ainda incrementa `detour_count` — depois de 5 dessas ele faz handoff para humano sem motivo real.

## Correção

### 1. `supabase/functions/ai-sales-agent/index.ts` — implementar `mode: "answer_only"`

Adicionar, logo depois das guardas (`isCustomerPausedByHuman`, `isConsultantAIDisabled`, validação de input) e **antes** de `loadContext`/intent-detection, um branch dedicado:

```text
if (mode === "answer_only") {
  → call Lovable AI Gateway diretamente (google/gemini-2.5-flash)
  → system: "Você é o atendente do consultor iGreen. Responda à dúvida do
             cliente em PT-BR, 1-2 frases curtas e humanas, sem emoji
             excessivo. NÃO peça dados, NÃO ofereça produto, NÃO mande
             saudação. Se a pergunta for fora do escopo iGreen
             (energia/cashback/club), responda com empatia e brevidade."
  → user: user_input
  → 1 chamada, sem tools, sem histórico longo (max últimos 4 turnos)
  → resposta: { reply: <texto>, mode: "answer_only", latency_ms }
}
```

Carregar `LOVABLE_API_KEY` de `Deno.env`. Já é o padrão usado em outras edge functions do projeto.

Vantagens: ~1 s de latência, custo desprezível, resposta sempre preenchida, sem efeitos colaterais (não muda `customers`, não muda `customer_flow_state`, não dispara handoff).

### 2. `respondAndReentry` nos dois webhooks

Arquivos: `supabase/functions/whapi-webhook/handlers/bot-flow.ts` e `supabase/functions/evolution-webhook/handlers/bot-flow.ts`.

- **Aumentar o timeout** do `AbortController` de `8000` → `15000` ms para tolerar cold start do `ai-sales-agent`.
- **Reler a resposta**: o novo retorno é `{ reply }`. O parser atual já cobre (`body?.reply`), então nenhuma mudança extra.
- **Fallback mais honesto**: quando `answer` continuar vazio depois de FAQ + IA, em vez de "Boa pergunta! Já explico melhor 💬" enviar apenas o reentry (`📋 Voltando: …`) — assim o cliente vê a pergunta de volta sem a frase de evasão. Concretamente:

```text
if (!answer) {
  // Não inventa "já explico melhor" — apenas reconduz ao passo.
  answer = "";
  source = "fallback";
}
...
const finalMsg = answer
  ? `${answer}${reentryLine}${courtesyTail}`
  : `${reentryFull}${courtesyTail}`;  // reentry completo, sem prefixo evasivo
```

Isso evita o efeito "gaslighting" do bot prometendo explicar e nunca explicando, e mantém o detour suave (handoff humano só após 5 desvios reais).

### 3. Não mexer em nada de UI / frontend

Esse fix é 100% backend (edge functions). Deploy automático faz o resto.

## Validação

1. **Curl direto na função** depois do deploy:
   ```
   POST /functions/v1/ai-sales-agent
   body: { customer_id: "<id>", user_input: "vocês são confiáveis?", mode: "answer_only" }
   esperado: { reply: "<resposta curta em pt-BR>", mode: "answer_only", latency_ms: <1500 }
   ```
2. **Conversa real** no WhatsApp: lead em `ask_email` digita "vocês são confiáveis?" → bot responde com 1-2 frases reais sobre confiança e reapresenta a pergunta do email. `source=ai` nos logs.
3. **Quando o gateway falhar** (cortar `LOVABLE_API_KEY` em teste): bot apenas reapresenta a pergunta sem a frase "já explico melhor". `source=fallback`, mas a UX continua limpa.
4. **Métrica**: nos logs `[respondAndReentry] source=ai` deve passar a dominar; `source=fallback` deve cair drasticamente.

## Arquivos tocados

- `supabase/functions/ai-sales-agent/index.ts` — branch `mode === "answer_only"`.
- `supabase/functions/whapi-webhook/handlers/bot-flow.ts` — timeout 15 s + fallback sem "Boa pergunta".
- `supabase/functions/evolution-webhook/handlers/bot-flow.ts` — mesmas duas mudanças (mantém paridade com Evolution).
