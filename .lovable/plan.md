# PR4 — Lista + Diagrama mais fáceis de usar

Foco em reduzir atrito sem mexer em regras de negócio. Tudo frontend.

## Parte A — Lista de steps

**1. Barra de busca + filtros (sticky no topo da coluna)**
- Campo de busca por título, conteúdo da mensagem e botões.
- Chips de filtro por tipo de step (mensagem, pergunta, condição, ação, etc.) — multi-seleção.
- Contador "X de Y passos" + botão "Limpar".
- Atalho `/` foca a busca; `Esc` limpa.

**2. Agrupamento e colapso**
- Agrupar steps por seção (usar tag/categoria existente; se não houver, derivar do tipo).
- Cabeçalhos de grupo colapsáveis, com contagem e ação rápida "Adicionar passo neste grupo".
- Estado de colapso persistido em `localStorage` por fluxo.

**3. Preview de conteúdo no card**
- Mostrar 1ª linha da mensagem (truncada) + ícones para mídia/botões/regras.
- Badge do step inicial e dos steps "órfãos" (sem entrada).
- Ícone clicável que abre o inspector direto na aba relevante.

**4. Reordenar mais claro**
- Handle de arraste dedicado (ícone à esquerda) em vez de arrastar o card inteiro.
- Linha-guia azul indicando posição de drop.
- Suporte a teclado: `↑/↓` com handle focado move o item.
- Manter `@dnd-kit` já em uso.

## Parte B — Diagrama (FlowDiagramV2)

**1. Nós mais compactos**
- Modo padrão "compacto": só ícone + título + badges (mídia/botões/regras).
- Expandir on-hover mostrando preview da mensagem; clique abre inspector.
- Toggle global "Compacto / Detalhado" na `CanvasToolbar`.

**2. Conexões mais limpas**
- Arestas com roteamento `smoothstep` + offset por handle para evitar sobreposição.
- Cor/estilo por tipo de transição (default, condicional, fallback).
- Highlight do caminho ao passar o mouse num nó (in/out edges destacadas, demais esmaecidas).

**3. Navegação**
- MiniMap (já existe no React Flow) habilitado no canto.
- Botões na toolbar: `Fit`, `Zoom 100%`, `Centralizar no início`, `Centralizar no selecionado`.
- Atalhos: `F` = fit, `0` = 100%, `H` = ir ao início, `/` = abrir busca de nó com lista filtrável (pula e seleciona).

**4. Ponto de partida visível**
- Nó inicial com anel/badge "Início" e cor de destaque.
- Realçar o "caminho principal" (mais provável) com traço mais grosso; ramificações secundárias em traço fino.
- Ao abrir o diagrama pela 1ª vez, auto `fitView` + leve pan para o início.

## Arquivos afetados

- `src/pages/FluxoBuilder.tsx` — barra de busca/filtros, grupos colapsáveis na lista, persistência.
- `src/components/admin/flow-builder/StepCard.tsx` — handle de drag, preview, badges, ícones de atalho.
- `src/components/admin/flow-builder/diagram-v2/ExpandableNode.tsx` — modo compacto + hover preview + destaque do início.
- `src/components/admin/flow-builder/diagram-v2/FlowDiagramV2.tsx` — minimap, highlight de caminho ao hover, fitView inicial, busca de nó.
- `src/components/admin/flow-builder/diagram-v2/CanvasToolbar.tsx` — toggle compacto/detalhado, botões Fit/100%/Início, atalhos.
- Novo: `src/components/admin/flow-builder/StepListToolbar.tsx` — busca + chips de filtro reutilizáveis.

## Fora de escopo
- Remover `FlowDiagram` legado (fica para PR de cleanup).
- Mudanças em edge functions / banco / regras de IA.

Quer que eu siga assim ou ajustar alguma parte?
