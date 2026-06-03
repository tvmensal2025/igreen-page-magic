# Renomear "Variante" → "Fluxo" e confirmar capacidade/isolamento

## Análise

**Pode adicionar mais fluxos?** Sim. O schema (`bot_flows.variant CHECK IN ('A','B','C','D','E')`) suporta **até 5 fluxos por consultor**, um por letra. Para o Rafael hoje existem **B** (IA livre) e **D** (padrão). Sobram **A**, **C** e **E** para criar.

**Cada fluxo é 100% individual?** Sim, após a correção da rodada anterior:
- Cada `bot_flows.id` é único por `(consultant_id, variant)` (índice `uniq_bot_flows_active_per_consultant_variant`).
- `bot_flow_steps` referenciam `flow_id` específico — editar um nunca toca outro.
- `seed_default_camila_flow` agora filtra por `variant='D'` (não reaproveita outro fluxo).
- O builder não cria mais "A fantasma": só lista fluxos que existem de fato.

**Limite de 5** é uma constraint de banco. Aumentar exigiria nova migration (`bot_flows_variant_check` + `customers_flow_variant_check`). Não é necessário agora — o usuário só pediu para confirmar; vou deixar em 5 e informar.

## Mudança solicitada: renomear "Variante" → "Fluxo" na UI

Apenas labels/textos visíveis. As letras A-E continuam (são chaves técnicas no banco). O `type Variant` no código pode permanecer — não afeta o que o usuário vê.

### Arquivos editados

**`src/components/admin/flow-builder/VariantDistributionBar.tsx`** (todos os textos voltados ao usuário):
- "Distribuição" → "Distribuição de fluxos"
- Tooltip: "variantes ativas" → "fluxos ativos"; "Variantes pausadas" → "Fluxos pausados"
- Toast: "Variante X recebendo leads" → "Fluxo X recebendo leads"; "Variante X pausada" → "Fluxo X pausado"
- Toast: "Todas as variantes (A–E) já existem" → "Todos os fluxos (A–E) já foram criados (limite: 5)"
- Toast: "Variante X criada/excluída" → "Fluxo X criado/excluído"
- "Variante A não pode ser excluída" → "Fluxo A não pode ser excluído" (ajustar regra: hoje só D é o padrão; mudar para impedir exclusão do **último** fluxo restante em vez de fixar em "A", o que é mais correto após a refactor)
- Confirm: "Excluir variante X?" → "Excluir fluxo X?"; descrição: "passos desta variante" → "passos deste fluxo"
- Dropdown: "Excluir variante X" → "Excluir fluxo X"
- Botão: "Adicionar variante" → "Adicionar fluxo"
- Badge: "X ativa(s) · round-robin" → "X fluxo(s) ativo(s) · round-robin"

**`src/components/admin/flow-builder/flowTypes.ts`**:
- `VARIANT_LABEL`: trocar prefixos para soar como "Fluxo X — descrição":
  - A: "Fluxo A (com áudio)"
  - B: "Fluxo B (IA livre)"  ← corrigir descrição também
  - C: "Fluxo C (vídeo inicial)"
  - D: "Fluxo D (padrão Camila)"
  - E: "Fluxo E (personalizado)"

**`src/pages/FluxoBuilder.tsx`**:
- Linha 701: "Editando variante X — ..." → "Editando Fluxo X — ..."
- Linha 347 (toast de erro): "Não foi possível carregar a variante" → "Não foi possível carregar o fluxo"
- Comentários internos: podem permanecer "variante" (não são UI).

## Não muda

- Schema do banco (constraint fica em A-E).
- `type Variant`, nomes de variáveis, RPCs.
- Lógica de isolamento já corrigida.
- Variante/Fluxo **B** (IA livre) — só recebe novo label.
