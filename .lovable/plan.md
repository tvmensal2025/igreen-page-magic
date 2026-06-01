## Análise

### 1. Maiúscula vs minúscula ("C c S s")

✅ **Já está OK**. As funções `_norm` (em `flow-router.ts`) e `norm` (em `engine/helpers.ts`) fazem `toLowerCase() + NFD + strip diacríticos + trim` nos **dois lados** da comparação. Então:

| Lead escreve | Trigger cadastrada | Match? |
|---|---|---|
| `Simular` | `simular` | ✅ |
| `SIMULAR` | `simular` | ✅ |
| `Rápida` | `rapida` | ✅ |
| `Quero Cadastrar` | `cadastrar` | ✅ |

Não precisa mexer aqui.

### 2. Gemini cortando → trocar default para Gemini 3 Pro no FAQ

🔧 **Mudar 1 linha** em `supabase/functions/_shared/ai-faq-answerer.ts` (linha 247):

```ts
// antes
model: opts.model || "google/gemini-3.1-pro-preview",
```

Já está nesse modelo na resposta principal ✅. Mas o **classificador de intent** (linha 188) ainda usa `google/gemini-3-flash-preview` com `maxTokens: 120`. Isso está correto — o classificador só devolve `{intent, confidence}` em JSON, não precisa de Pro nem de muitos tokens.

**Conclusão**: O FAQ já está em Gemini 3 Pro com `maxTokens: 1500` (efetivo ≈12k via multiplicador ×8 do `isThinkingModel`). Não há mais corte. ✅

### 3. WhatsApp como orquestrador — análise "está 100%?"

Vou auditar os 3 pontos do fluxo: **(a) classificação → (b) resposta Gemini → (c) volta ao fluxo com botões**.

**O que está OK:**
- ✅ `ai-faq-answerer.ts` adiciona CTA no final ("👇 Posso seguir com você...") quando a resposta do Gemini não termina em pergunta/botão.
- ✅ Após responder FAQ, o engine volta para o step atual e re-envia os botões interativos do WhatsApp (lista/quick reply).
- ✅ Normalização de acento/case já resolvida.

**O que ainda quero verificar (read-only nessa etapa, sem mexer em código):**

a) **Re-emissão dos botões após FAQ** — confirmar que depois do Gemini responder, o próximo turno do lead cai no step certo (`d_escolher_simulacao` ou onde estava) e mostra os botões de novo. Vou ler o `flow-engine-v3.ts` no ponto onde o FAQ retorna controle.

b) **Confiança do classificador** — checar se quando o lead manda algo curto ("oi", "ok", emoji) o classificador erra dizendo que é FAQ e dispara Gemini sem necessidade. Se sim, subir o threshold de confidence.

c) **Fila de mensagens WhatsApp** — confirmar que mensagens longas do Gemini (>1024 chars no caso de button message) caem em texto simples e os botões vêm em mensagem separada logo depois, sem o WhatsApp recusar.

## Plano

**Mudanças mínimas**:

1. ❌ **Não mexer em case/normalização** — já está correto.
2. ❌ **Não mexer no default do Gemini** — `ai-faq-answerer.ts` já usa `gemini-3.1-pro-preview` com tokens generosos.
3. ✅ **Auditoria read-only** dos 3 pontos acima (a, b, c) na próxima etapa, e se achar bug real:
   - (a) ajustar o ponto onde `flow-engine-v3.ts` reanexa os botões pós-FAQ.
   - (b) subir threshold de `confidence` no classificador para evitar FAQ falso-positivo em mensagens curtas.
   - (c) garantir split de mensagem longa (texto puro + segunda mensagem só com botões).

## Fora de escopo

- Não tocar em leads antigos.
- Não mexer em outros steps do fluxo.
- Não trocar provider de WhatsApp nem reescrever orquestração.

## Arquivos potencialmente afetados (só se a auditoria achar bug)

- `supabase/functions/_shared/flow-engine-v3.ts` (re-emissão de botões pós-FAQ)
- `supabase/functions/_shared/ai-faq-answerer.ts` (threshold do classificador)
- `supabase/functions/_shared/whatsapp-send.ts` ou similar (split de mensagem longa)
