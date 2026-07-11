## Alargar sidebars e adicionar botão de recolher (WhatsApp + Captação)

Padrão Kommo/Watikit: lista lateral mais larga por padrão + botão dedicado para colapsar/expandir a lista quando o consultor quer mais espaço na conversa.

### 1. WhatsApp — `src/components/whatsapp/WhatsAppTab.tsx`
- Aumentar `--wa-side-w` inicial de **240px → 360px**.
- `DragResizer`: `defaultPx=360`, `minPx=280`, `maxPx=560`.
- Adicionar estado `waSideCollapsed` (persistido em `localStorage: igreen:wa-side-collapsed`).
- Quando colapsado: sidebar recebe `md:w-0 overflow-hidden` e o `DragResizer` some.
- Botão flutuante ("«" / "»") fixado na borda esquerda do painel de conversa (topo do header do chat), com `Tooltip` "Recolher lista" / "Expandir lista". Usar ícones `PanelLeftClose` / `PanelLeftOpen` do `lucide-react`.

### 2. Captação — `src/components/captacao/CaptacaoPanel.tsx`
- Aumentar `--cap-list-w` inicial de **22rem (352px) → 26rem (416px)**.
- `DragResizer`: `defaultPx=416`, `minPx=300`, `maxPx=720`.
- Mesmo mecanismo de colapso (`igreen:cap-list-collapsed`) com botão gêmeo posicionado no topo do `CaptureSheet` (quando um lead está aberto) ou no header da lista quando nada está selecionado.

### 3. Consistência visual
- Ambos os botões usam o mesmo componente inline (não precisa novo arquivo): `Button variant="ghost" size="icon-sm"` com `PanelLeftClose/Open`, ancorado com `absolute` na borda interna esquerda do painel direito.
- Quando `locked` (LayoutLock global) estiver ON, o `DragResizer` já se esconde — o botão de colapso permanece funcional (é feature de UX, não de resize).

### Fora do escopo
- Backend, edge functions, lógica de mensagens/rodízio.
- Redesenhar cards de lead ou feed de conversa.

### Arquivos afetados
- `src/components/whatsapp/WhatsAppTab.tsx`
- `src/components/captacao/CaptacaoPanel.tsx`

### Critérios de aceite
- Lista do WhatsApp inicia com 360px (arrastável até 560px).
- Lista da Captação inicia com 416px (arrastável até 720px).
- Cada painel tem um botão que colapsa/expande a lista lateral com estado persistido entre reloads.
- Nenhuma alteração em lógica de dados, seleção ou envio.
