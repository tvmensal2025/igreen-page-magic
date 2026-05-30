## Objetivo

Substituir a lista atual de `StepCard` por uma **Timeline Vertical Numerada** — uma "linha do roteiro" top‑down onde cada passo é uma estação do fluxo. Mais fácil de ler que o diagrama porque é linear, numerada e sem cruzamentos.

## Como vai parecer

```text
┌─ Timeline ──────────────────────────────┐
│                                         │
│  ●─① Boas-vindas               [Início] │
│  │   "Oi! Eu sou a Iggy, posso te…"     │
│  │   💬 3 botões  •  ⚡ 2 regras        │
│  │   → #2 Quero economizar              │
│  │   → #5 Já sou cliente                │
│  │                                       │
│  ●─② Quero economizar          [Pergunta]│
│  │   "Me conta seu consumo médio…"       │
│  │   📷 OCR conta  •  ⚡ 1 regra         │
│  │   → #3 Simulação                      │
│  │                                       │
│  ●─③ Simulação                  [IA]    │
│  ⋮   …                                   │
└─────────────────────────────────────────┘
```

- **Trilho vertical** à esquerda (1px, `border`) ligando todas as estações.
- **Bolinha numerada** (`●` com `#1`, `#2`…) ancorada no trilho. Tamanho 28px, fundo `primary/10`, número em `primary`. Passo inicial recebe anel `ring-2 ring-primary` + badge "Início".
- **Card médio (3 linhas)** ao lado:
  1. Título + tipo (badge pequeno à direita) + status (inativo, alerta)
  2. Preview da mensagem (1 linha, truncada em ~70 chars)
  3. Badges compactos: nº de botões, nº de regras, OCR/IA, mídia
- **Setas inline clicáveis** abaixo do card (uma por linha): `→ #5 Confirmação`. Clicar **rola e seleciona** o passo destino na própria timeline (scroll suave + highlight pulsante de 1s). Destinos quebrados em `text-destructive` com ⚠.
- **Selecionado**: bolinha vira sólida `primary`, card ganha `ring-2 ring-primary/30` e `bg-primary/5`.
- **Hover no card**: trilho do passo acende (`bg-primary/40`) e os destinos também (preview do caminho sem ir pro diagrama).

## Interações

- **Drag‑and‑drop** continua funcionando (já temos `dnd-kit`). Handle fica na bolinha numerada (cursor‑grab no hover).
- **Click no card** → seleciona (sincroniza com diagrama e inspector).
- **Double‑click** → abre inspector.
- **Click numa seta `→ #N`** → scroll suave até o passo + highlight de 1s.
- **Filtros/busca** da `StepListToolbar` (PR4) continuam por cima — quando filtra, as bolinhas dos passos ocultos somem mas o trilho permanece tracejado nos "gaps", deixando claro que há passos escondidos.

## Densidade

Card médio padrão (~96px de altura). Para fluxos grandes, o toggle "compacto" da toolbar reduz para 1 linha (só título + tipo + badge de contagem de destinos), mantendo o trilho.

## Arquivos a mudar

- **Novo**: `src/components/admin/flow-builder/StepTimeline.tsx` — container da timeline (trilho + map de estações).
- **Novo**: `src/components/admin/flow-builder/StepTimelineItem.tsx` — uma estação (bolinha + card + setas inline). Substitui o uso direto de `StepCard` na sidebar.
- **Editado**: `src/pages/FluxoBuilder.tsx` — trocar `<StepCard>` por `<StepTimelineItem>` dentro do `SortableContext`. Adicionar `scrollIntoView` + state de `pulseId` para o "clique pula".
- **Mantido**: `StepCard.tsx` continua existindo (usado em outros lugares? checar). Se só usado aqui, marca como legado mas não remove neste PR.
- **Mantido**: `StepListToolbar.tsx` (busca/filtros) sem mudanças.

## Fora de escopo

- Diagrama (sem alterações).
- Inspector lateral direito (sem alterações).
- Edge functions, banco, IA.
- Remover `StepCard.tsx` (fica para um PR de limpeza).

## Riscos

- `scrollIntoView` dentro de container com `overflow-auto` precisa de `block: "nearest"` pra não bagunçar a página inteira. Vou usar ref no container da timeline.
- Drag‑and‑drop: o `useSortable` precisa do mesmo `id` no item externo (timeline item), não no card interno. Vou mover os listeners pra bolinha numerada.
