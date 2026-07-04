## Objetivo

Trocar o cálculo de desconto/economia **apenas no Fluxo M (variant="M", Minas Gerais)** de **8%–20%** para **10%–28%**. Nenhum outro fluxo (A/B/C/D/E) muda — continuam com 8%–20% / 20%.

## Onde o cálculo aparece hoje (todas hardcoded em 0.20 / 0.08)

1. `supabase/functions/_shared/render-vars.ts` — helper central que renderiza `{{economia_mensal}}`, `{{economia_anual}}`, `{{economia_range}}`, `{{economia_faixa}}`.
2. `supabase/functions/_shared/fluxo-b-prompt.ts` — prompt IA Fluxo B fala "entre 8% e 20%".
3. `src/lib/captacao/postBillConfirm.ts` — fallback de simulação após "Eu confirmo" no OCR.
4. `supabase/functions/whapi-webhook/handlers/bot-flow.ts` — mapa de substituição de `{economia_mensal|anual}` + simulação inline (min 8% / max 20%).
5. `supabase/functions/evolution-webhook/handlers/bot-flow.ts` — idem whapi.

## Estratégia

Criar helper único **`supabase/functions/_shared/discount-rates.ts`** com:

```ts
export type FlowVariant = "A" | "B" | "C" | "D" | "E" | "M";
export function discountRates(variant?: string | null) {
  const v = String(variant || "A").toUpperCase();
  if (v === "M") return { min: 0.10, max: 0.28, label: "até 28%", rangeLabel: "10% e 28%" };
  return { min: 0.08, max: 0.20, label: "até 20%", rangeLabel: "8% e 20%" };
}
```

Refatorar os 5 pontos acima para usar `discountRates(variant)`:

- `render-vars.ts`: aceitar `variant` no `RenderVars` e usar `rates.max` / `rates.min` no lugar de `0.20` / `0.08`. Todos os call sites que hoje passam `RenderVars` recebem também `variant` (pegar de `customer.flow_variant`).
- `postBillConfirm.ts`: ler `customer.flow_variant`, usar `rates.max` no cálculo e trocar o texto "(até 20%)" por `(${rates.label})`.
- Webhooks whapi + evolution: nos dois blocos de substituição `_valor * 0.20`, ler `_flowVariant` (já disponível no escopo) e usar rates; na simulação inline com `0.08` / `0.20`, mesma coisa; ajustar o texto fixo "(até 20%)" e "entre 8% e 20%" para usar `rates.label` / `rates.rangeLabel`.
- `fluxo-b-prompt.ts`: **não mexer** — Fluxo B nunca é M. Só documentar no memory.

## Mudanças no frontend

Nenhuma. LP/FAQ/copy pública continuam "até 20%" (regra atual mem://copy/discount-rate-20). A regra só muda dentro do runtime do Fluxo M.

## Memory

Atualizar `mem/copy/discount-rate-20.md`: adicionar exceção "Fluxo M (MG) usa 10%–28% em todas as simulações do bot (render-vars, postBillConfirm, webhooks). Superfícies públicas continuam 20%."

## Não muda

- Regra geral "até 20%" pra LP, WhatsApp bot A/B/C/D/E, FAQ.
- Comissão de licenciado (15%).
- Cálculo do simulador solar (`economics-br.ts`) — outro domínio.

## Fora de escopo

- Não alterar textos dos steps já salvos em `bot_flow_steps` do Fluxo M (usuário faz isso pelo builder se quiser). Só o cálculo automático das variáveis muda.
