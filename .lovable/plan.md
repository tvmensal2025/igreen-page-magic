## Diagnóstico

Lead 11971254913 (Rafael Ferreira Dias) entrou no fluxo D, escolheu "Simulação rápida", digitou 600 e recebeu:

```text
💡 Sua conta hoje: *R$ R$ 600,00*
💚 Economia estimada: *{{economia_range}}* por mês
```

Dois bugs:

1. **R$ duplicado** — o template no DB é `*R$ {{valor_conta}}*`, mas o renderer em `conversational/templates.ts` (`fmtValor`, linhas 31–35) já devolve `R$ 600,00` (com prefixo). Saída: `R$ R$ 600,00`.
2. **`{{economia_range}}` literal** — esse renderer só conhece `valor_conta`, `economia_mensal`, `economia_anual`. A chave `economia_range` (suportada por `_shared/render-vars.ts` linhas 110-113) não existe aqui, então passa intacta.

Os logs confirmam: `[conversational] emitStep step=d_simular_resultado` → handler conversational, não o `_shared/render-vars.ts`.

## Mudanças

### 1. Adicionar `economia_range` nos dois `conversational/templates.ts`

Arquivos: `supabase/functions/whapi-webhook/handlers/conversational/templates.ts` e `supabase/functions/evolution-webhook/handlers/conversational/templates.ts`.

- Nova `fmtEconomiaRange(v)` que retorna `R$ {min} a R$ {max}` com `min = max(1, floor(valor*0.08))` e `max = max(min+1, ceil(valor*0.20))` — mesma fórmula de `_shared/render-vars.ts`, mantendo consistência (`mem://copy/discount-rate-20`).
- Adicionar `out = replaceVar(out, "economia_range", econRange)` e alias `economia_faixa`.

### 2. Migration: corrigir `message_text` do d_simular_resultado

Remover o `R$ ` literal antes de `{{valor_conta}}` no step id `b1a52222-2222-4222-8222-000000000002`. Novo texto:

```text
Olha que ótimo! ✨🎉

💡 Sua conta hoje: *{{valor_conta}}*

💚 Economia estimada: *{{economia_range}}* por mês

E o melhor:

✅ Sem investimento

✅ Sem obra

✅ Sem instalação

✅ *Mesma* distribuidora

Bora fazer seu *cadastro agora*? 🚀
```

Como `fmtValor` já formata como `R$ 600,00`, a saída final fica `*R$ 600,00*` — correto.

## Validação

- Resetar conversa do 11971254913, repetir o fluxo digitando 600.
- Conferir mensagem com `R$ 600,00` (uma vez) e `R$ 48 a R$ 120` em vez de `{{economia_range}}`.

## Fora de escopo

- Unificar `conversational/templates.ts` com `_shared/render-vars.ts` (refator maior).
- Caminho `bot-flow.ts` dispatch já usa `_shared/render-vars.ts` e suporta `economia_range`; sem alteração.
</parameter>
<parameter name="summary">Corrigir R$ duplicado e {{economia_range}} no d_simular_resultado