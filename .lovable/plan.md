## Objetivo
Deixar o editor `/admin/fluxos` mais limpo e amigável para leigos: barra de topo compacta, nada de jargão "variante", criação de fluxo sem bug "variante inválida" e ajuda contextual em cada passo.

> Aviso: `.lovable/` está no `.gitignore`, então este plano não persistirá após o próximo snapshot. Posso remover essa entrada se você quiser manter planos salvos.

## 1. Barra de topo compacta com tooltip (FluxoBuilder.tsx)
- Transformar **"Testar fluxo"**, **"Auto-corrigir"** e o **badge de alertas** em **botões-ícone** (apenas ícone visível ~32px). Ao passar o mouse, expandem em tooltip/label.
- Juntar tudo numa única linha à direita do título "Fluxo", liberando bastante espaço horizontal.
- Manter `disabled` quando `steps.length === 0` ou sem auto-fixes.

## 2. Remover o termo "Variante" da UI
Substituir por "Fluxo" em todos os textos visíveis (sem mexer no schema/coluna `variant` do banco):
- `VariantDistributionBar.tsx`: trocar "Distribuição de fluxos" (ok) e remover "round-robin 1 a 1" pesado → algo como "Revezando entre fluxos ativos". Tooltip em linguagem leiga.
- `CreateFlowFromTemplateDialog.tsx`:
  - Label "Variante (A/B/C/D)" → **"Identificação do fluxo"** com texto explicativo: "Letra usada só pra identificar internamente. Crie quantos fluxos quiser."
  - Texto "Variantes permitem A/B testing…" → "Cada cliente novo entra em um dos fluxos ativos, alternando. Isso te ajuda a comparar resultados."
  - Mensagens de erro/sucesso (`toast`, `Alert`) trocar "variante X" → "fluxo X".
- `FlowSimulator.tsx`, `VariantsPanel.tsx`, demais labels visíveis: mesma troca textual.

## 3. Corrigir "variante inválida" ao criar fluxo (CreateFlowFromTemplateDialog.tsx)
Hoje o dialog trava nas letras `A/B/C/D` (linha 307: `(["A", "B", "C", "D"] as const)`), por isso clicar em "Criar fluxo E/F…" devolve "variante inválida".

Correção:
- Importar `ALL_VARIANTS` de `flowTypes.ts` e renderizar **todas as letras livres** (não usadas) como opções de seleção, em grid responsivo.
- Pré-selecionar automaticamente a próxima letra livre quando o dialog abre (em vez de "A").
- Mostrar letras já em uso como `disabled` com badge "Em uso" (comportamento já existe, só ampliar).
- Validar `variant` contra `ALL_VARIANTS` antes do submit.

## 4. Ajuda em cada passo (botão "?")
Em `StepTimelineItem` (cards da lista) e/ou `StepInspector`:
- Adicionar pequeno botão `<HelpCircle className="h-3 w-3" />` (ghost, 20px) ao lado do tipo do passo.
- Click abre `Popover` curto explicando o tipo daquele passo, usando a `hint` que já existe em `STEP_TYPE_OPTIONS` (flowTypes.ts), mais 1-2 exemplos práticos do que o leigo pode fazer ali (ex.: "Use este passo para enviar um áudio de boas-vindas").
- Mesma ajuda para os campos do inspetor: botão `?` ao lado de "Regras", "Mídias", "Botões" com texto curto e claro.

## 5. Garantia de não quebrar nada
- Schema do banco intacto (`variant`, `active_variants`, RPCs `ensure_bot_flow_variant`/`seed_default_camila_flow` continuam recebendo letras A–Z como já aceitam).
- Código de Diagrama e Planilha permanece guardado (sem alteração).
- Lógica de round-robin, RLS e edge functions não tocadas — apenas textos e UI.

## Arquivos a alterar
- `src/pages/FluxoBuilder.tsx` (barra superior compacta)
- `src/components/admin/flow-builder/VariantDistributionBar.tsx` (textos)
- `src/components/admin/flow-builder/CreateFlowFromTemplateDialog.tsx` (todas letras + textos)
- `src/components/admin/flow-builder/StepTimelineItem.tsx` (botão de ajuda)
- `src/components/admin/flow-builder/StepInspector.tsx` (botões de ajuda nas abas)
- `src/components/admin/flow-builder/FlowSimulator.tsx` e `VariantsPanel.tsx` (apenas labels visíveis)
