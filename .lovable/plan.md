# Fluxo A = espelho do Fluxo D, renomeado para "CEMIG" (foco Minas Gerais)

## Objetivo
1. **Fluxo A** passa a rodar **100% idêntico ao Fluxo D** (mesmas mensagens, mídias, botões interativos) — sem duplicar dados no banco.
2. Onde hoje aparece **"Fluxo A"** na UI, passa a aparecer **"CEMIG"** (foco Minas Gerais).
3. Variante permanece `A` no banco/código (não mexe em enum, migração, dedup, seletor A/B, testes). Só o **rótulo visível** muda.

## Auditoria do plano anterior — pontos que precisavam ajuste
- ✅ `resolve-flow.ts` e `pickVariant` continuam sendo as duas únicas alterações de comportamento — correto e mínimo.
- ⚠️ Rótulo: `src/components/admin/flow-builder/flowTypes.ts` (`VARIANT_LABELS.A = "Fluxo A (com áudio)"`) e outros lugares com texto "Fluxo A" precisam virar "CEMIG".
- ⚠️ `flow_ab_mode` no `/admin/fluxos` hoje mostra "only_A / only_D / split" — o card `ConsultantVariantsCard.tsx` também referencia "Fluxo A" no texto do rádio.
- ⚠️ `CaptacaoPanel.tsx` tem fallback hardcoded `{ variant: "A", name: "Fluxo A" }` — trocar para "CEMIG".
- ⚠️ `FluxoAKeywordsCard.tsx` (title + label) usa "Fluxo A".
- ✅ Textos "Fluxo D" **não** mudam.
- ✅ Não há registro `bot_flows.variant='A'` no banco (verificado: 0 linhas). Logo, nenhum `bot_flows.name` a renomear via SQL. Se no futuro alguém criar um fluxo A próprio (`sync_mode='custom'`), o nome do registro é livre — o rótulo global "CEMIG" continua valendo na UI.

## Alterações (mínimas, sem quebrar nada)

### 1) Comportamento — A roda como D
**`supabase/functions/_shared/resolve-flow.ts`**
- `getPublicFlowId(v)` recebe a variante; quando `v='A'` e não há público A, faz fallback para público D.
- `resolveMediaOwnerId`: mesma regra — quando A e não há A público, retorna o dono do D público (mídias do Super Admin).

**`supabase/functions/_shared/engine/helpers.ts`**
- `pickVariant("A") → variantD` (aplica overlay de botões interativos/listas idêntico ao D).
- `B` continua `variantA`, `C` continua sentinela, `D` continua `variantD`.

### 2) Rótulo visível — "Fluxo A" vira "CEMIG"
- `src/components/admin/flow-builder/flowTypes.ts` → `VARIANT_LABELS.A = "CEMIG"`.
- `src/components/captacao/CaptacaoPanel.tsx` → fallback `{ variant: "A", name: "CEMIG" }`.
- `src/components/admin/fluxo-b-ia/FluxoAKeywordsCard.tsx` → título "Palavras-chave do CEMIG", `target_flow_label = "CEMIG — Cadastro direto"`.
- `src/components/admin/fluxo-b-ia/ConsultantVariantsCard.tsx` → textos "Fluxo A" → "CEMIG" nos rádios.
- Grep final por `"Fluxo A"` para pegar remanescentes (badges/toasts) e trocar por "CEMIG".

## O que NÃO muda
- Enum de variante (`A/B/C/D`) no banco e nos tipos TS.
- `pickFlowVariant` / `flow_ab_mode` (split 50/50 continua funcionando; A ≡ D torna o split neutro).
- Fluxo D em si (mensagens, mídias, botões) — permanece a fonte única de verdade.
- Webhooks (Whapi/Evolution), worker portal, monitor, testes de `flow-selector`.
- Nenhuma migração SQL. Nenhum dado copiado.

## Segurança / rollback
- 2 arquivos de backend + ~4 arquivos de UI. Sem migração.
- Rollback = reverter os arquivos.
- Consultores com fluxo próprio custom (`sync_mode='custom'`) continuam vencendo o fallback público — comportamento preservado.
- Se o Super Admin um dia criar um fluxo A público de verdade (foco CEMIG real), ele passa a vencer o fallback D automaticamente, sem alteração de código.

## Validação pós-deploy
1. `SELECT flow_variant, count(*) FROM customers GROUP BY 1` — confere distribuição.
2. Lead de teste marcado `flow_variant='A'` no Whapi/Evolution → deve receber o passo inicial do D com botões.
3. Abrir `/admin/fluxos` e `/admin/captacao` → badges e seletores mostram "CEMIG" no lugar de "Fluxo A".
4. Monitor `/admin/portal-monitor` sem novos erros de "flow_id nulo".

## Arquivos alterados (resumo)
```
supabase/functions/_shared/resolve-flow.ts
supabase/functions/_shared/engine/helpers.ts
src/components/admin/flow-builder/flowTypes.ts
src/components/captacao/CaptacaoPanel.tsx
src/components/admin/fluxo-b-ia/FluxoAKeywordsCard.tsx
src/components/admin/fluxo-b-ia/ConsultantVariantsCard.tsx
```
