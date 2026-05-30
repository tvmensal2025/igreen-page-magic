# PR5 — Diagrama Blueprint + Fullscreen + Edges legíveis

## Objetivo
Tornar o diagrama do FlowBuilder muito mais legível e profissional, no estilo n8n/Retool, com suporte real a tela cheia e edges monocromáticos com peso variável.

## Parte A — Visual "Blueprint técnico" (n8n/Retool)

Atualizar `ExpandableNode.tsx` e o canvas em `FlowDiagramV2.tsx`:

- **Fundo do canvas**: grid azulado sutil (substituir o `Background` atual por variant `lines` com cor `hsl(var(--primary) / 0.06)` + dots secundários).
- **Nós com header colorido por tipo**:
  - Header (top) com cor sólida do tipo (`color.accentBg` mais saturado) + ícone do tipo + título em branco/foreground-on-color.
  - Corpo em `bg-card` neutro com borda fina `border-border`.
  - Remover stripe lateral (redundante com o header).
  - Cantos `rounded-lg` (menos arredondado, mais técnico).
- **Handles maiores e visíveis**: 10x10px, com anel branco, posicionados nas laterais (left/right em vez de top/bottom) — fluxo horizontal fica mais legível como n8n.
- **Tipografia**: título 13px semibold, badges 10px uppercase tracking-wide.
- **Estado selecionado**: anel `ring-2 ring-primary` + leve `shadow-lg`, sem mudar borda (mantém leitura do tipo).
- **Estado início**: badge "INÍCIO" no header em vez de só ícone.

## Parte B — Fullscreen

Dois controles no `CanvasToolbar`:

1. **Toggle "Esconder lista"** (ícone `PanelLeftClose` / `PanelLeftOpen`):
   - Em `FluxoBuilder.tsx`, esconder a coluna esquerda da lista de steps, dando 100% da largura para o canvas.
   - Persistir em `localStorage` (`flow-list-hidden`).
   - Atalho: `\`.

2. **Botão "Tela cheia"** (ícone `Maximize2` / `Minimize2`):
   - Usa `element.requestFullscreen()` na div raiz do canvas.
   - ESC fecha (nativo do browser).
   - Atalho: `Shift+F`.
   - Esconde header do app porque o fullscreen é no elemento do canvas (a div toma 100vw/100vh do navegador).

Ambos podem coexistir (esconder lista + entrar em fullscreen).

## Parte C — Edges monocromáticos com peso

Reescrever a geração de edges em `useFlowGraphV2.ts`:

- **Cor única**: `hsl(var(--foreground))` para todos os edges válidos.
- **Peso por importância**:
  - Edge "ordem" (implícito): `strokeWidth: 1`, `opacity: 0.25`, dashed `4 4`.
  - Edge de transição "default": `strokeWidth: 1.5`, `opacity: 0.5`.
  - Edge de regra normal: `strokeWidth: 2`, `opacity: 0.75`.
  - Edge a partir de botão: `strokeWidth: 2.5`, `opacity: 1`.
  - Edge selecionado/hovered: `strokeWidth: 3`, `opacity: 1` + `markerEnd` com seta cheia.
  - Edge missing (alvo inexistente): único caso colorido — `hsl(var(--destructive))`, `strokeWidth: 2`, tracejado.
- **Tipo**: `smoothstep` mantém, mas com `pathOptions: { borderRadius: 12 }` para curvas mais suaves.
- **Labels**: fundo `bg-background` com `border` fina, padding maior, font 10px medium, só aparece em edges relevantes (esconder em "ordem" por padrão; mostrar no hover).
- **Setas (markerEnd)**: arrow simples em todos, mesma cor do edge.

## Parte D — Ajustes de layout

- Em `useAutoLayout`, considerar trocar direção para **horizontal (LR)** já que handles agora são laterais. Mais natural para fluxos conversacionais (esquerda → direita = início → fim).
- Aumentar espaçamento entre nós: `nodesep: 80`, `ranksep: 120`.

## Arquivos afetados

- `src/components/admin/flow-builder/diagram-v2/ExpandableNode.tsx` — redesign blueprint
- `src/components/admin/flow-builder/diagram-v2/FlowDiagramV2.tsx` — background, fullscreen API, toggle lista
- `src/components/admin/flow-builder/diagram-v2/CanvasToolbar.tsx` — botões + atalhos
- `src/components/admin/flow-builder/diagram-v2/useFlowGraphV2.ts` — edges monocromáticos
- `src/components/admin/flow-builder/diagram-v2/useAutoLayout.ts` — direção LR + espaçamento
- `src/pages/FluxoBuilder.tsx` — esconder coluna da lista quando toggle ativo

## Fora de escopo
- Lista de steps (já feita no PR4).
- Diagrama legacy (`FlowDiagram`).
- Edge functions, DB, IA.

## Validação
Após implementar: abrir `/admin` → FluxoBuilder, verificar grid azulado, nós com header colorido, edges em escala de cinza com pesos diferentes, botão maximizar funciona, ESC sai, toggle lista funciona.
